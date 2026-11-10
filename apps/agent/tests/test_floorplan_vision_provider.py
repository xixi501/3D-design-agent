from pathlib import Path

from actiscape_agent.app import create_app
from actiscape_agent.capability_registry import capability_document
from actiscape_agent.floorplan_vision import (
    get_provider_registry,
    run_floorplan_provider,
)

ROOT = Path(__file__).resolve().parents[3]


def test_provider_registry_is_static_and_capability_bounded():
    registry = get_provider_registry()
    manifest = registry.get("hpd-adapter-6-1")
    assert manifest.status == "experimental"
    assert manifest.isolation == "subprocess"
    assert manifest.capabilities.walls
    assert not manifest.capabilities.symbols
    assert [item.id for item in registry.candidates("structure.walls")] == ["hpd-adapter-6-1"]
    assert registry.candidates("furniture.symbols") == []


def test_capability_matrix_does_not_claim_unverified_v4_or_photos():
    matrix = capability_document()
    floorplan = next(item for item in matrix["inputs"] if item["kind"] == "floorplan_image")
    assert floorplan["status"] == "verified_limited"
    assert floorplan["experimentalVersion"] == "s2c-floorplan-v4-2"
    assert (
        next(item for item in matrix["inputs"] if item["kind"] == "reference_photo")["status"]
        == "reserved"
    )
    assert matrix["scene"]["multiLevel"] == "reserved"


def test_provider_and_capability_routes_are_exposed(tmp_path):
    app = create_app(tmp_path)
    paths = {route.path for route in app.routes}
    assert "/vision/providers" in paths
    assert "/capabilities" in paths


def test_hpd_provider_returns_sealed_pixel_artifact(tmp_path):
    image = (ROOT / "fixtures/s2c-synthetic.png").read_bytes()
    result = run_floorplan_provider(
        "hpd-adapter-6-1",
        image,
        scope={
            "roomSelection": "all_visible",
            "functionalAreas": [],
            "excludeFunctionalAreas": [],
        },
        output_dir=tmp_path,
        timeout=90,
    )
    assert result.status == "completed", result.error
    assert result.modelCalls == 0
    assert result.envelope is not None
    assert result.envelope.inputSha256 == result.inputSha256
    artifact = result.envelope.artifact
    assert artifact["provider"]["id"] == "hpd-adapter-6-1"
    assert artifact["input"]["imageSha256"] == result.inputSha256
    assert artifact["candidates"]["walls"]
    assert artifact["candidates"]["rooms"] == []
    assert artifact["audit"]["referenceAccess"] == "denied-and-audited"
    assert artifact["audit"]["runtimeGuard"]["attemptCount"] == 0
    assert artifact["evidenceFiles"]
    rendered = str(artifact).lower()
    assert "evaluation-only" not in rendered
    assert "targetroomids" not in rendered
    assert "'anchors'" not in rendered


def test_remote_runner_uses_gateway_envelope_and_never_spawns_node(monkeypatch):
    import base64
    import json
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    from actiscape_agent.store import fingerprint

    scope = {
        "roomSelection": "all_visible",
        "functionalAreas": [],
        "excludeFunctionalAreas": [],
    }
    image = b"remote-png-bytes"
    input_sha = __import__("hashlib").sha256(image).hexdigest()
    artifact = {
        "schemaVersion": "actiscape.floorplan-vision-artifact.v1",
        "artifactId": "remote:test",
        "provider": {
            "id": "hpd-adapter-6-1",
            "version": "hpd-adapter-6-1",
            "repository": "test",
            "commit": "test",
            "license": "MIT",
        },
        "input": {
            "imageSha256": input_sha,
            "width": 100,
            "height": 100,
            "coordinateSpace": "exif-oriented-original-pixels",
        },
        "scope": scope,
        "capabilities": {
            "walls": True,
            "openings": True,
            "dimensions": True,
            "rooms": False,
            "symbols": False,
        },
        "candidates": {"walls": [], "openings": [], "dimensions": [], "rooms": [], "symbols": []},
        "evidenceFiles": [],
        "limitations": [],
        "audit": {"modelCalls": 0, "referenceAccess": "denied-and-audited", "candidateInputs": ["image.bytes"]},
    }
    envelope = {
        "schemaVersion": "actiscape.artifact-envelope.v1",
        "kind": "floorplan-vision",
        "providerId": "hpd-adapter-6-1",
        "providerVersion": "hpd-adapter-6-1",
        "inputSha256": input_sha,
        "scopeHash": fingerprint(scope),
        "artifact": artifact,
        "artifactSha256": fingerprint(artifact),
    }
    seen = {}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            seen["path"] = self.path
            seen["body"] = json.loads(self.rfile.read(int(self.headers["content-length"])))
            payload = json.dumps(envelope).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        monkeypatch.setenv("ACTISCAPE_VISION_RUNNER", "remote")
        monkeypatch.setenv("ACTISCAPE_SCENE_URL", f"http://127.0.0.1:{server.server_port}")
        result = run_floorplan_provider("hpd-adapter-6-1", image, scope=scope, timeout=10)
    finally:
        server.shutdown()
        thread.join(timeout=2)
    assert result.status == "completed", result.error
    assert result.envelope is not None
    assert seen["path"] == "/api/tools/floorplan-candidate"
    assert seen["body"]["imageBase64"] == base64.b64encode(image).decode()
    assert seen["body"]["adapterVersion"] == "hpd-adapter-6-1"
    assert seen["body"]["scope"] == scope
