"""Controlled role/transport tests of the real LangGraph, task store and restart logic.
These are not floorplan recognition accuracy or real-model acceptance evidence.
"""

import asyncio
import copy
import io
import json
from pathlib import Path

import pytest
from PIL import Image
from test_workflow import FIXTURE, FakeScene, finished

from actiscape_agent.client import SceneFailure
from actiscape_agent.floorplan_image import crop_image, decode_image, inspect_image
from actiscape_agent.manager import TaskManager
from actiscape_agent.store import TaskError, fingerprint, task_fingerprint

DATA = json.loads(
    (Path(__file__).resolve().parents[3] / "fixtures/s2c-synthetic.floorplan.json").read_text()
)
KEYS = {"三人沙发": "sofa", "茶几": "coffeeTable", "单人沙发": "armchair", "落地灯": "floorLamp"}


class FloorplanScene(FakeScene):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        for key in (
            "nodes",
            "walls",
            "openings",
            "furniture",
            "structs",
            "beams",
            "rooms",
            "measures",
            "elec",
            "voids",
            "comments",
        ):
            self.project["plan"][key] = []
        self.draft = None
        self.confirmations = {}
        self.paths = []

    async def image(self, path):
        self.paths.append(path)
        return ("controlled-image:" + path).encode()

    async def request(self, path, body=None):
        if path == "/catalog":
            return {
                "items": {
                    key: {"key": key, "name": name, "type": key, "w": 800, "d": 600, "h": 900}
                    for name, key in KEYS.items()
                }
            }
        if path.startswith("/floorplan-images/"):
            return {
                **DATA["image"],
                "normalizedWidth": 1000,
                "normalizedHeight": 800,
                "normalizedToPixel": {"x": 1, "y": 1},
                "lineCandidates": [],
            }
        root = "/projects/p/floorplan-drafts"
        if path == root:
            if not self.draft:
                self.draft = {
                    "id": "draft",
                    "projectId": "p",
                    "baseRevision": self.project["revision"],
                    "revision": 0,
                    "hash": "0" * 64,
                    "data": body["data"],
                    "confirmed": None,
                    "corrections": 0,
                }
            return copy.deepcopy(self.draft)
        if path.startswith(root + "/draft"):
            if path.endswith("/preview"):
                plan = copy.deepcopy(FIXTURE)
                plan["furniture"] = []
                return {
                    "state": {"plan": plan, "roomLabelArchive": []},
                    "checks": {"passed": True, "issues": []},
                    "defaults": ["controlled defaults"],
                }
            if path.endswith("/confirm"):
                if body["requestId"] in self.confirmations:
                    old = self.confirmations[body["requestId"]]
                    if old["body"] != body:
                        raise SceneFailure(
                            409,
                            {"error": "OPERATION_CONFLICT", "message": "different confirmation"},
                        )
                    return copy.deepcopy(old["record"])
                if (
                    self.draft["hash"] != body["draftHash"]
                    or self.draft["revision"] != body["draftRevision"]
                ):
                    raise SceneFailure(409, {"error": "DRAFT_CONFLICT", "message": "stale draft"})
                self.draft["confirmed"] = {
                    **body,
                    "revision": body["draftRevision"],
                    "hash": body["draftHash"],
                }
                self.confirmations[body["requestId"]] = {
                    "body": copy.deepcopy(body),
                    "record": copy.deepcopy(self.draft),
                }
            if path.endswith("/commands"):
                self.draft["data"]["height"] = 3000
                self.draft["revision"] += 1
                self.draft["hash"] = "1" * 64
                self.draft["confirmed"] = None
            return copy.deepcopy(self.draft)
        if path == "/projects/p/candidates" and body is not None:
            id = body["requestId"]
            if id not in self.candidates:
                plan = copy.deepcopy(FIXTURE)
                plan["furniture"] = []
                for m in body["matches"]:
                    f = copy.deepcopy(FIXTURE["furniture"][0])
                    f.update(id=body["taskId"] + ":f:" + m["symbolId"], key=m["key"])
                    plan["furniture"].append(f)
                self.candidates[id] = {
                    "id": id,
                    "kind": "initialize_floorplan",
                    "baseRevision": self.project["revision"],
                    "hash": "controlled-candidate-hash",
                    "operationId": "commit-" + id,
                    "state": {"plan": plan, "roomLabelArchive": []},
                    "scope": {},
                    "diff": {
                        "added": [f["id"] for f in plan["furniture"]],
                        "updated": [],
                        "deleted": [],
                    },
                    "checks": {
                        "passed": not self.bad_checks,
                        "issues": [
                            {
                                "code": "DOORWAY_BLOCKED",
                                "message": "controlled source conflict",
                                "blocking": True,
                            }
                        ]
                        if self.bad_checks
                        else [],
                        "coverage": [],
                        "limitations": [],
                    },
                    "generation": {"mode": "reconstruct_floorplan", "image": DATA["image"]},
                    "structure": {},
                    "committed": None,
                    "summary": body["summary"],
                }
            return copy.deepcopy(self.candidates[id])
        return await super().request(path, body)


class ControlledFloorplanRoles:
    def __init__(self, store, client):
        self.store, self.client = store, client

    async def invoke(self, role, prompt, schema, tools, payload, task_id, images=None, **kwargs):
        self.store.count_model_call(task_id, role)
        self.store.event(task_id, "agent_start", {"role": role, "controlled": True})
        if role == "main":
            if schema.__name__ == "DraftCorrections":
                return {
                    "question": "",
                    "commands": [{"type": "defaults", "values": {"height": 3000}}],
                }
            self.client.ground_calls += 1
            return {
                "status": "draft",
                **{k: copy.deepcopy(v) for k, v in DATA.items() if k != "image"},
            }
        if role == "assets":
            return {
                "choices": [
                    {
                        "request_index": r["request_index"],
                        "key": KEYS[r["query"]],
                        "reason": "controlled catalogue selection",
                    }
                    for r in payload["requests"]
                ]
            }
        if role == "design":
            self.client.design_calls += 1
            if self.client.suspend_design:
                self.client.suspend_design = False
                self.client.design_entered.set()
                await asyncio.Event().wait()
            return {
                "summary": "controlled source reconstruction",
                "matches": payload["sourceMatches"],
            }
        assert len(images) == 4
        return {"passed": True, "summary": "controlled four-image review", "issues": []}


async def waiting(manager, id):
    for _ in range(300):
        task = manager.store.task(id)
        if task["status"] in ("waiting_input", "failed", "completed", "cancelled"):
            return task
        await asyncio.sleep(0.01)
    raise AssertionError("task never reached a safe boundary")


async def start(manager):
    await manager.start()
    conversation = manager.store.create_conversation("p")
    task = manager.store.create_task(
        conversation["id"],
        {
            "requestId": "floorplan",
            "mode": "reconstruct_floorplan",
            "imageId": DATA["image"]["id"],
            "input": "复现客餐厅原图",
            "selectedIds": [],
        },
    )
    manager.enqueue(task["id"])
    return await waiting(manager, task["id"])


def confirmation(task, request_id="confirm"):
    d = task["generation"]["floorplan"]
    return {
        "requestId": request_id,
        "draftId": d["id"],
        "draftRevision": d["revision"],
        "draftHash": d["hash"],
    }


@pytest.mark.asyncio
async def test_confirmation_is_required_and_four_roles_commit_once_after_lost_response(tmp_path):
    client = FloorplanScene(lost_response=True)
    manager = TaskManager(tmp_path, client, ControlledFloorplanRoles)
    try:
        task = await start(manager)
        assert task["status"] == "waiting_input", task
        assert task["modelCalls"] == 1 and client.project["revision"] == 0 and not client.candidates
        body = confirmation(task)
        await manager.confirm_floorplan(task["id"], body)
        result = await finished(manager, task["id"])
        assert result["status"] == "completed", result
        assert len(client.ledger) == 1 and client.project["revision"] == 1
        assert len(result["result"]["changes"]) == 4
        roles = {
            e["data"]["role"]
            for e in manager.store.events(task["id"])
            if e["kind"] == "agent_start"
        }
        assert roles == {"main", "assets", "design", "check"}
        assert result["result"]["skillsUsed"][0]["id"] == "floorplan-reconstruction"
        assert (await manager.confirm_floorplan(task["id"], body))["status"] == "completed"
        assert len(client.ledger) == 1
    finally:
        await manager.close()


@pytest.mark.asyncio
async def test_restart_between_node_confirmation_and_python_resume_reconciles_same_action(
    tmp_path, monkeypatch
):
    client = FloorplanScene()
    manager = TaskManager(tmp_path, client, ControlledFloorplanRoles)
    task = await start(manager)
    body = confirmation(task)
    pinned = manager.store.task(task["id"], internal=True)["generation"]["skillSnapshot"]
    await client.request(
        "/projects/p/floorplan-drafts/draft/confirm",
        {k: v for k, v in body.items() if k != "draftId"},
    )
    await manager.close()
    monkeypatch.setattr(
        "actiscape_agent.floorplan_flow.load_design_skill",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("must use pinned Skill")),
    )
    manager = TaskManager(tmp_path, client, ControlledFloorplanRoles)
    try:
        await manager.start()
        result = await finished(manager, task["id"])
        assert result["status"] == "completed", result
        assert client.ground_calls == 1 and len(client.ledger) == 1
        assert (
            manager.store.task(task["id"], internal=True)["generation"]["skillSnapshot"] == pinned
        )
    finally:
        await manager.close()


@pytest.mark.asyncio
async def test_stale_confirmation_cancellation_and_budget_never_commit(tmp_path):
    client = FloorplanScene()
    manager = TaskManager(tmp_path, client, ControlledFloorplanRoles)
    try:
        task = await start(manager)
        body = confirmation(task)
        await client.request("/projects/p/floorplan-drafts/draft/commands", {})
        with pytest.raises(SceneFailure):
            await manager.confirm_floorplan(task["id"], body)
        assert client.project["revision"] == 0
        manager.store.db.execute("UPDATE tasks SET model_calls=24 WHERE id=?", (task["id"],))
        with pytest.raises(TaskError, match="预算"):
            await manager.confirm_floorplan(task["id"], confirmation(task, "budget"))
        manager.store.cancel(task["id"])
        with pytest.raises(TaskError, match="不能确认"):
            await manager.confirm_floorplan(task["id"], body)
        assert not client.ledger
    finally:
        await manager.close()


@pytest.mark.asyncio
async def test_source_layout_conflict_uses_three_repairs_then_waits_without_automatic_retry(
    tmp_path,
):
    client = FloorplanScene(bad_checks=True)
    manager = TaskManager(tmp_path, client, ControlledFloorplanRoles)
    try:
        task = await start(manager)
        await manager.confirm_floorplan(task["id"], confirmation(task))
        # Let the resumed task actually leave waiting_input before observing its next boundary.
        await asyncio.sleep(0.05)
        result = await waiting(manager, task["id"])
        assert result["status"] == "waiting_input", result
        assert client.design_calls == 4 and not client.ledger and client.project["revision"] == 0
        calls = result["modelCalls"]
        await manager.reconcile_floorplan_confirmation(task["id"])
        await asyncio.sleep(0.05)
        assert manager.store.task(task["id"])["modelCalls"] == calls
    finally:
        await manager.close()


def test_image_decoder_preserves_orientation_and_crop_pixels_and_rejects_bad_inputs(monkeypatch):
    image = Image.new("RGB", (80, 40), "white")
    for x in range(8, 16):
        for y in range(8, 16):
            image.putpixel((x, y), (255, 0, 0))
    out = io.BytesIO()
    image.save(out, format="PNG")
    content = out.getvalue()
    info = inspect_image(content)
    assert info["width"] == 80 and info["height"] == 40
    with Image.open(io.BytesIO(crop_image(content, [0, 0, 40, 20]))) as cropped:
        assert cropped.size == (160, 80) and cropped.getpixel((48, 48)) == (255, 0, 0)
    jpeg = io.BytesIO()
    exif = Image.Exif()
    exif[274] = 6
    image.save(jpeg, format="JPEG", exif=exif)
    decoded, _, orientation = decode_image(jpeg.getvalue())
    assert orientation == 6 and decoded.size == (40, 80)
    transparent = io.BytesIO()
    Image.new("RGBA", (30, 20), (0, 0, 0, 0)).save(transparent, format="PNG")
    assert decode_image(transparent.getvalue())[0].getpixel((10, 10)) == (255, 255, 255)
    with pytest.raises(Exception):
        decode_image(b"not an image")
    with pytest.raises(ValueError):
        crop_image(content, [0, 0, 1000, 20])
    monkeypatch.setattr("actiscape_agent.floorplan_image.MAX_PIXELS", 100)
    with pytest.raises(ValueError, match="像素"):
        decode_image(content)


def test_new_optional_image_field_preserves_old_request_fingerprints():
    old = {"mode": "edit", "requestId": "r", "input": "move", "selectedIds": []}
    assert task_fingerprint(old) == task_fingerprint({**old, "imageId": None})
    original = {"requestId": "r", "input": "move", "selectedIds": []}
    assert task_fingerprint(old) == fingerprint(original)


@pytest.mark.asyncio
async def test_new_confirmation_and_restart_do_not_reset_global_repair_budget(tmp_path):
    client = FloorplanScene(bad_checks=True)
    manager = TaskManager(tmp_path, client, ControlledFloorplanRoles)
    task = await start(manager)
    await manager.confirm_floorplan(task["id"], confirmation(task))
    await asyncio.sleep(0.05)
    first = await waiting(manager, task["id"])
    assert first["status"] == "waiting_input" and first["generation"]["repairsUsed"] == 3
    await client.request("/projects/p/floorplan-drafts/draft/commands", {})
    await manager.close()
    manager = TaskManager(tmp_path, client, ControlledFloorplanRoles)
    try:
        await manager.start()
        latest = manager.store.task(task["id"])
        body = {
            "requestId": "confirm-new-draft",
            "draftId": "draft",
            "draftRevision": 1,
            "draftHash": "1" * 64,
        }
        await manager.confirm_floorplan(task["id"], body)
        await asyncio.sleep(0.05)
        result = await waiting(manager, task["id"])
        assert result["status"] == "waiting_input", result
        assert client.design_calls == 5
        assert result["generation"]["repairsUsed"] == 3
        assert result["modelCalls"] > latest["modelCalls"] and not client.ledger
    finally:
        await manager.close()


@pytest.mark.asyncio
async def test_manual_edit_during_confirmation_wait_stops_initialization(tmp_path):
    client = FloorplanScene()
    manager = TaskManager(tmp_path, client, ControlledFloorplanRoles)
    try:
        task = await start(manager)
        client.project["revision"] = 1
        client.project["plan"]["furniture"] = [copy.deepcopy(FIXTURE["furniture"][0])]
        await manager.reconcile_floorplan_confirmation(task["id"])
        result = manager.store.task(task["id"])
        assert result["status"] == "failed" and result["result"]["errorCode"] == "PROJECT_NOT_EMPTY"
        assert len(client.project["plan"]["furniture"]) == 1 and not client.ledger
    finally:
        await manager.close()


@pytest.mark.asyncio
async def test_design_cannot_replace_frozen_asset_choices_before_candidate_creation():
    from types import SimpleNamespace

    from actiscape_agent.floorplan_roles import FloorplanRoles

    class Client:
        async def request(self, *args):
            raise AssertionError("Unauthorized asset changes must be rejected before HTTP")

    role = FloorplanRoles(SimpleNamespace(store=None, client=Client()))
    task = {"generation": {"matches": [{"symbolId": "sofa", "key": "sofa"}]}}
    with pytest.raises(TaskError, match="资产角色"):
        await role.candidate(task, {}, {}, {"matches": [{"symbolId": "sofa", "key": "bed"}]}, 0)
