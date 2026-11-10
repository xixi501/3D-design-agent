"""Bounded provider execution. Providers never receive evaluation references."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import time

import httpx

from ..config import scene_url
from ..store import fingerprint
from .contracts import (
    ArtifactEnvelopeV1,
    ProviderManifest,
    ProviderRunRecord,
)
from .registry import get_provider_registry


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _provider_env() -> dict[str, str]:
    root = pathlib.Path(__file__).resolve().parents[4]
    return {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "PYTHONPATH": os.pathsep.join(
            [
                str(root / "apps/agent"),
                str(root / "apps/agent/actiscape_agent"),
            ]
        ),
        "PYTHONHASHSEED": "0",
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "ACTISCAPE_FORBIDDEN_EVIDENCE_ROOTS": os.pathsep.join(
            [
                str(root / "fixtures/full-home-candidates"),
                str(root / "fixtures/s2c-real"),
            ]
        ),
    }


def _normalize_response(manifest: ProviderManifest, raw: dict, scope: dict) -> dict:
    result = raw.get("result") or {}
    width, height = result.get("size") or [0, 0]
    if not isinstance(width, int) or not isinstance(height, int) or width < 1 or height < 1:
        raise ValueError("provider 没有返回有效图片尺寸")
    walls = []
    for candidate in result.get("candidateWalls") or []:
        walls.append(
            {
                "id": str(candidate["candidateWallId"]),
                "orientation": candidate["orient"],
                "line": float(candidate["line"]),
                "start": float(candidate["s0"]),
                "end": float(candidate["s1"]),
                "thickness": float(candidate["t"]),
                **(
                    {"confidence": float(candidate["confidence"])}
                    if candidate.get("confidence") is not None
                    else {}
                ),
                "evidenceRefs": [
                    f"provider:wall:{candidate['candidateWallId']}",
                    "artifact:wallmask.png",
                ],
            }
        )
    openings = []
    for candidate in result.get("openingCandidates") or []:
        openings.append(
            {
                "id": str(candidate["candidateId"]),
                "wallCandidateId": candidate.get("candidateWallId"),
                "orientation": candidate["orient"],
                "line": float(candidate["line"]),
                "start": float(candidate["start"]),
                "end": float(candidate["end"]),
                "typeHint": candidate.get("typeHint")
                if candidate.get("typeHint") in ("door", "window", "sliding", "hole")
                else "unknown",
                **(
                    {"confidence": float(candidate["confidence"])}
                    if candidate.get("confidence") is not None
                    else {}
                ),
                "evidenceRefs": [
                    f"provider:opening:{candidate['candidateId']}",
                    "artifact:candidates.png",
                ],
            }
        )
    dimensions = []
    for candidate in result.get("dimensionCandidates") or []:
        a, b = candidate.get("a") or {}, candidate.get("b") or {}
        axis = candidate.get("axis")
        if axis == "v":
            start, end = sorted((float(a["y"]), float(b["y"])))
            at = float(a["x"])
        else:
            start, end = sorted((float(a["x"]), float(b["x"])))
            at = float(a["y"])
        dimensions.append(
            {
                "id": str(candidate["candidateId"]),
                "axis": axis,
                "side": candidate.get("side")
                if candidate.get("side") in ("top", "bottom", "left", "right")
                else "unknown",
                "at": at,
                "start": start,
                "end": end,
                "unitHint": candidate.get("unitHint"),
                **(
                    {"confidence": float(candidate["confidence"])}
                    if candidate.get("confidence") is not None
                    else {}
                ),
                "evidenceRefs": [f"provider:dimension:{candidate['candidateId']}"],
            }
        )
    return {
        "schemaVersion": "actiscape.floorplan-vision-artifact.v1",
        "artifactId": f"{manifest.id}:{result.get('size', [0, 0])[0]}x{result.get('size', [0, 0])[1]}",
        "provider": {
            "id": manifest.id,
            "version": manifest.version,
            "repository": manifest.repository,
            "commit": manifest.commit,
            "license": manifest.license,
        },
        "input": {
            "imageSha256": "",
            "width": width,
            "height": height,
            "coordinateSpace": "exif-oriented-original-pixels",
        },
        "scope": {
            "roomSelection": (
                "selected"
                if scope.get("roomSelection") in ("selected", "functional_areas")
                or scope.get("functionalAreas")
                else "all_visible"
            ),
            "functionalAreas": list(scope.get("functionalAreas") or []),
            "excludeFunctionalAreas": list(scope.get("excludeFunctionalAreas") or []),
        },
        "capabilities": {
            "walls": manifest.capabilities.walls,
            "openings": manifest.capabilities.openings,
            "dimensions": manifest.capabilities.dimensions,
            "rooms": manifest.capabilities.rooms,
            "symbols": manifest.capabilities.symbols,
        },
        "candidates": {
            "walls": walls,
            "openings": openings,
            "dimensions": dimensions,
            "rooms": [],
            "symbols": [],
        },
        "evidenceFiles": [],
        "limitations": list(raw.get("limitations") or []),
        "audit": {
            "modelCalls": 0,
            "referenceAccess": "denied-and-audited",
            "candidateInputs": ["image.bytes", "scope", "adapterVersion"],
        },
    }


def _remote_enabled() -> bool:
    """Containers without Node use the gateway; explicit local/remote wins."""
    mode = os.environ.get("ACTISCAPE_VISION_RUNNER", "auto").strip().lower()
    if mode == "remote":
        return True
    if mode == "local":
        return False
    return shutil.which("node") is None


def _remote_run(
    manifest: ProviderManifest,
    image: bytes,
    scope: dict,
    parameters: dict | None,
    *,
    output_dir: pathlib.Path | None,
    timeout: float,
    input_sha: str,
    scope_hash: str,
) -> ProviderRunRecord:
    started = time.monotonic()
    base = scene_url()
    token = os.environ.get("ACTISCAPE_TOOL_TOKEN")
    try:
        with httpx.Client(timeout=timeout, trust_env=False) as client:
            response = client.post(
                base + "/api/tools/floorplan-candidate",
                headers=(
                    {"Authorization": "Bearer " + token} if token else {}
                ),
                json={
                    "imageBase64": base64.b64encode(image).decode(),
                    "scope": scope,
                    "adapterVersion": manifest.id,
                    "parameters": parameters or {},
                },
            )
    except httpx.HTTPError as error:
        return ProviderRunRecord(
            provider=manifest,
            status="failed",
            inputSha256=input_sha,
            scopeHash=scope_hash,
            seconds=round(time.monotonic() - started, 3),
            error={"message": f"remote candidate unavailable: {error}"},
        )
    elapsed = round(time.monotonic() - started, 3)
    if not response.is_success:
        try:
            detail = response.json()
        except ValueError:
            detail = {"message": response.text[-1000:]}
        return ProviderRunRecord(
            provider=manifest,
            status="failed",
            inputSha256=input_sha,
            scopeHash=scope_hash,
            seconds=elapsed,
            error={"status": response.status_code, **detail},
        )
    try:
        value = response.json()
        envelope = ArtifactEnvelopeV1.model_validate(value)
    except Exception as error:  # noqa: BLE001 - provider boundary
        return ProviderRunRecord(
            provider=manifest,
            status="failed",
            inputSha256=input_sha,
            scopeHash=scope_hash,
            seconds=elapsed,
            error={"message": f"invalid remote envelope: {error}"},
        )
    if (
        envelope.providerId != manifest.id
        or envelope.inputSha256 != input_sha
        or envelope.scopeHash != scope_hash
        or fingerprint(envelope.artifact) != envelope.artifactSha256
    ):
        return ProviderRunRecord(
            provider=manifest,
            status="failed",
            inputSha256=input_sha,
            scopeHash=scope_hash,
            seconds=elapsed,
            error={"message": "remote envelope identity/hash mismatch"},
        )
    if output_dir is not None:
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / "candidate-envelope.json").write_text(
            json.dumps(value, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return ProviderRunRecord(
        provider=manifest,
        status="completed",
        inputSha256=input_sha,
        scopeHash=scope_hash,
        seconds=elapsed,
        envelope=envelope,
    )


def run_floorplan_provider(
    provider_id: str,
    image: bytes,
    scope: dict | None = None,
    parameters: dict | None = None,
    *,
    output_dir: pathlib.Path | None = None,
    timeout: float = 120,
) -> ProviderRunRecord:
    manifest = get_provider_registry().get(provider_id)
    if manifest.isolation != "subprocess":
        raise ValueError("provider 必须使用子进程隔离")
    if not manifest.capabilities.walls:
        raise ValueError("PROVIDER_CAPABILITY_MISSING")
    scope = scope or {
        "roomSelection": "all_visible",
        "functionalAreas": [],
        "excludeFunctionalAreas": [],
    }
    input_sha = sha256_bytes(image)
    scope_hash = fingerprint(scope)
    if _remote_enabled():
        return _remote_run(
            manifest,
            image,
            scope,
            parameters,
            output_dir=output_dir,
            timeout=timeout,
            input_sha=input_sha,
            scope_hash=scope_hash,
        )
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="actiscape-provider-") as temporary:
        try:
            result = subprocess.run(
                [
                    os.environ.get(
                        "ACTISCAPE_PYTHON",
                        str(pathlib.Path(__file__).resolve().parents[4] / ".venv/bin/python"),
                    ),
                    "-m",
                    "actiscape_agent.floorplan_vision.hpd_worker",
                ],
                input=json.dumps(
                    {
                        "image": base64.b64encode(image).decode(),
                        "scope": scope,
                        "adapterVersion": provider_id,
                        "parameters": parameters or {},
                    }
                ),
                text=True,
                capture_output=True,
                cwd=temporary,
                env=_provider_env(),
                timeout=timeout,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return ProviderRunRecord(
                provider=manifest,
                status="failed",
                inputSha256=input_sha,
                scopeHash=scope_hash,
                seconds=round(time.monotonic() - started, 3),
                error={"message": "provider timeout", "timeout": timeout},
            )
        if result.returncode:
            return ProviderRunRecord(
                provider=manifest,
                status="failed",
                inputSha256=input_sha,
                scopeHash=scope_hash,
                seconds=round(time.monotonic() - started, 3),
                error={
                    "message": (result.stderr or result.stdout)[-1000:],
                    "returnCode": result.returncode,
                },
            )
        try:
            value = json.loads(result.stdout)
        except json.JSONDecodeError as error:
            return ProviderRunRecord(
                provider=manifest,
                status="failed",
                inputSha256=input_sha,
                scopeHash=scope_hash,
                seconds=round(time.monotonic() - started, 3),
                error={"message": f"invalid provider JSON: {error}"},
            )
        if value.get("error"):
            return ProviderRunRecord(
                provider=manifest,
                status="failed",
                inputSha256=input_sha,
                scopeHash=scope_hash,
                seconds=round(time.monotonic() - started, 3),
                error=value,
            )
        runtime_guard = value.get("guard") or {}
        if (
            runtime_guard.get("referenceAccess") != "denied-and-audited"
            or not isinstance(runtime_guard.get("attemptCount"), int)
            or runtime_guard["attemptCount"] != 0
        ):
            return ProviderRunRecord(
                provider=manifest,
                status="failed",
                inputSha256=input_sha,
                scopeHash=scope_hash,
                seconds=round(time.monotonic() - started, 3),
                error={
                    "code": "PROVIDER_EVIDENCE_GUARD_INVALID",
                    "message": "provider 没有提供有效的参考访问守卫结果",
                    "guard": runtime_guard,
                },
            )
        artifact = _normalize_response(manifest, value["response"], value.get("scope") or scope)
        artifact["input"]["imageSha256"] = input_sha
        artifact["artifactId"] = f"{manifest.id}:{input_sha[:16]}"
        artifact["audit"]["runtimeGuard"] = runtime_guard
        if output_dir is not None:
            output_dir.mkdir(parents=True, exist_ok=True)
            evidence = []
            for name, file_value in (value["response"].get("files") or {}).items():
                data = base64.b64decode(file_value["data"])
                path = output_dir / name
                path.write_bytes(data)
                evidence.append(
                    {
                        "id": name,
                        "kind": "mask"
                        if "mask" in name
                        else "overlay"
                        if name == "candidates.png"
                        else "diagnostic",
                        "path": name,
                        "sha256": sha256_bytes(data),
                        "mediaType": "image/png",
                    }
                )
            artifact["evidenceFiles"] = evidence
        artifact_hash = fingerprint(artifact)
        envelope = ArtifactEnvelopeV1(
            providerId=manifest.id,
            providerVersion=manifest.version,
            inputSha256=input_sha,
            scopeHash=scope_hash,
            artifact=artifact,
            artifactSha256=artifact_hash,
        )
        return ProviderRunRecord(
            provider=manifest,
            status="completed",
            inputSha256=input_sha,
            scopeHash=scope_hash,
            seconds=round(time.monotonic() - started, 3),
            envelope=envelope,
        )
