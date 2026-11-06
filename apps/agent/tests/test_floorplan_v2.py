"""Version-two workflow tests use controlled inputs, never live-image acceptance."""

import asyncio
import base64
import hashlib
from types import SimpleNamespace

import pytest

from actiscape_agent.floorplan_evidence import FloorplanEvidence
from actiscape_agent.store import TaskError, TaskStore


@pytest.mark.asyncio
async def test_four_concurrent_crops_are_atomic_shared_idempotent_and_restartable(tmp_path):
    class Client:
        calls = 0

        async def request(self, path, body):
            self.calls += 1
            await asyncio.sleep(0.01 if body["box"][0] == 1 else 0.02)
            key = str(body["box"][0])
            raw = ("controlled crop " + key).encode()
            return {
                "id": key,
                "box": body["box"],
                "cropToPixel": {"x0": body["box"][0], "y0": 0, "scaleX": 1, "scaleY": 1},
                "path": key,
                "sha256": hashlib.sha256(raw).hexdigest(),
            }

        async def image(self, path):
            return ("controlled crop " + path).encode()

    store = TaskStore(tmp_path)
    c = store.create_conversation("p")
    task = store.create_task(c["id"], {"requestId": "crops", "input": "test"})
    client = Client()
    base = SimpleNamespace(store=store, client=client)
    image = {"id": "image", "sha256": "a" * 64}
    main = FloorplanEvidence(base, task, image, "main")
    design = FloorplanEvidence(base, task, image, "design")
    await asyncio.gather(
        *[
            owner.crop_tool().ainvoke({"x0": i, "y0": 0, "x1": i + 1, "y1": 1})
            for owner, i in [(main, 1), (main, 2), (design, 3), (design, 4)]
        ]
    )
    g = store.task(task["id"], internal=True)["generation"]
    assert len(g["evidenceIndex"]) == 4 and len(g["cropRequests"]) == 4
    assert len(await design.images()) == 4
    with pytest.raises(TaskError, match="预算"):
        await design.crop_tool().ainvoke({"x0": 5, "y0": 0, "x1": 6, "y1": 1})
    store.close()
    store = TaskStore(tmp_path)
    try:
        base.store = store
        restored = FloorplanEvidence(base, task, image, "check")
        parts = await restored.crop_tool().ainvoke({"x0": 1, "y0": 0, "x1": 2, "y1": 1})
        assert (
            base64.b64decode(parts[1]["image_url"]["url"].split(",")[1]) == b"controlled crop 1.0"
        )
        assert client.calls == 4
    finally:
        store.close()
