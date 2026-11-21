"""Evidence-preservation unit tests for FloorplanEvidence (V2 dead flow removed)."""

import hashlib

import pytest

from actiscape_agent.floorplan_evidence import FloorplanEvidence, FloorplanPipelineBase
from actiscape_agent.store import TaskError, TaskStore


class DummyClient:
    def __init__(self, image_bytes: bytes):
        self.image_bytes = image_bytes
        self.sha = hashlib.sha256(image_bytes).hexdigest()
        self.crops = 0

    async def image(self, _path: str) -> bytes:
        return self.image_bytes

    async def request(self, path: str, body: dict | None = None):
        if path.endswith("/crops"):
            self.crops += 1
            return {
                "id": f"crop-{self.crops}",
                "box": body["box"],
                "cropToPixel": [1, 0, 0, 1, body["box"][0], body["box"][1]],
                "path": f"/crops/{self.crops}.png",
                "sha256": self.sha,
            }
        raise AssertionError(f"Unexpected request: {path}")


class DummyBase:
    def __init__(self, store, client):
        self.store = store
        self.client = client


@pytest.mark.asyncio
async def test_floorplan_evidence_shared_crop_budget_and_integrity(tmp_path):
    store = TaskStore(tmp_path)
    conv = store.create_conversation("proj-1")
    task = store.create_task(
        conv["id"],
        {
            "requestId": "req-ev-1",
            "input": "复现户型",
            "mode": "reconstruct_floorplan",
            "imageId": "img-1",
        },
    )
    png = b"\x89PNG\r\n\x1a\nshared-evidence-test"
    client = DummyClient(png)
    base = DummyBase(store, client)
    image = {"id": "img-1", "sha256": client.sha, "width": 800, "height": 600}

    main = FloorplanEvidence(base, task, image, "main")
    design = FloorplanEvidence(base, task, image, "design")

    main_crop = main.crop_tool()
    design_crop = design.crop_tool()

    await main_crop.ainvoke({"x0": 0, "y0": 0, "x1": 100, "y1": 100})
    # Duplicate box reuses logical slot without extra HTTP crop
    await main_crop.ainvoke({"x0": 0, "y0": 0, "x1": 100, "y1": 100})
    assert client.crops == 1

    await main_crop.ainvoke({"x0": 100, "y0": 0, "x1": 200, "y1": 100})
    # Main role cap is 2 crops -> returns CROP_LIMIT notice gracefully
    third_main = await main_crop.ainvoke({"x0": 200, "y0": 0, "x1": 300, "y1": 100})
    assert "CROP_LIMIT" in third_main[0]["text"]

    # Design/check share the remaining 2 slots up to 4 total
    await design_crop.ainvoke({"x0": 200, "y0": 0, "x1": 300, "y1": 100})
    await design_crop.ainvoke({"x0": 300, "y0": 0, "x1": 400, "y1": 100})

    restored = FloorplanEvidence(base, task, image, "check")
    ctx = await restored.context()
    assert ctx["cropBudget"] == {"total": 4, "used": 4}
    imgs = await restored.images()
    assert imgs == [png]

    pipeline = FloorplanPipelineBase(store, client, base)
    pipeline.patch(task["id"], customMarker="ok")
    assert store.task(task["id"], internal=True)["generation"]["customMarker"] == "ok"
    store.close()
