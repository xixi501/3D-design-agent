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
