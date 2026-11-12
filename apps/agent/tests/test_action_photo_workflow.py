"""Action/photo deterministic subgraphs through the real LangGraph manager."""

import asyncio
import copy

import pytest

from actiscape_agent.manager import TaskManager

PLAN = {
    "version": 2,
    "name": "主卧",
    "height": 2800,
    "nodes": [
        {"id": "n0", "x": 0, "y": 0},
        {"id": "n1", "x": 4000, "y": 0},
        {"id": "n2", "x": 4000, "y": 4000},
        {"id": "n3", "x": 0, "y": 4000},
    ],
    "walls": [
        {"id": "north", "a": "n0", "b": "n1", "t": 200, "status": "existing"},
        {"id": "east", "a": "n1", "b": "n2", "t": 200, "status": "existing"},
        {"id": "south", "a": "n2", "b": "n3", "t": 200, "status": "existing"},
        {"id": "west", "a": "n3", "b": "n0", "t": 200, "status": "existing"},
    ],
    "openings": [
        {
            "id": "door",
            "wall": "south",
            "type": "door",
            "pos": 2000,
            "width": 900,
            "sill": 0,
            "head": 2100,
            "hinge": 0,
        }
    ],
    "furniture": [
        {
            "id": "w1",
            "key": "wardrobe",
            "type": "wardrobe",
            "name": "衣柜",
            "x": 2000,
            "y": 400,
            "z": 0,
            "rot": 0,
            "w": 2000,
            "d": 600,
            "h": 2400,
            "color": "#ffffff",
            "opt": {"open": False},
        },
        {
            "id": "bed",
            "key": "bed18",
            "type": "bed",
            "name": "双人床 1.8m",
            "x": 2000,
            "y": 1300,
            "z": 0,
            "rot": 0,
            "w": 1800,
            "d": 2000,
            "h": 950,
            "color": "#ffffff",
        },
        {
            "id": "t1",
            "key": "coffeeTable",
            "type": "coffeeTable",
            "name": "茶几",
            "x": 2000,
            "y": 2200,
            "z": 0,
            "rot": 0,
            "w": 1200,
            "d": 600,
            "h": 400,
            "color": "#ffffff",
        },
    ],
    "rooms": [
        {
            "id": "room",
            "x": 2000,
            "y": 2000,
            "name": "主卧",
            "mat": "oak",
            "ceil": {"type": "none", "drop": 0},
        }
    ],
    "structs": [],
    "beams": [],
    "measures": [],
    "elec": [],
    "voids": [],
    "comments": [],
}


class FlowScene:
    def __init__(self, *, blocked=False, block_once=False):
        self.project = {
            "id": "p",
            "revision": 0,
            "plan": copy.deepcopy(PLAN),
            "roomLabelArchive": [],
        }
        self.candidates = {}
        self.blocked = blocked
        self.block_once = block_once
        self.blocked_once_used = False

    async def request(self, path, body=None):
        if path == "/projects/p":
            return copy.deepcopy(self.project)
        if path == "/assets/asset-demo":
            return {
                "id": "asset-demo",
                "name": "照片花瓶",
                "w": 224,
                "d": 224,
                "h": 280,
            }
        if path == "/projects/p/candidates" and body is not None:
            state = copy.deepcopy(self.project["plan"])
            edits = body.get("edits") or []
            added = []
            updated = []
            for edit in edits:
                if edit["type"] == "action":
                    if edit["collection"] == "furniture":
                        f = next(x for x in state["furniture"] if x["id"] == edit["id"])
                        current = bool((f.get("opt") or {}).get("open"))
                        f.setdefault("opt", {})["open"] = (
                            edit["desiredState"]
                            if isinstance(edit.get("desiredState"), bool)
                            else not current
                        )
                        updated.append(f["id"])
                    else:
                        o = next(x for x in state["openings"] if x["id"] == edit["id"])
                        o["open"] = (
                            edit["desiredState"]
                            if isinstance(edit.get("desiredState"), bool)
                            else not o.get("open")
                        )
                elif edit["type"] == "update":
                    f = next(x for x in state["furniture"] if x["id"] == edit["id"])
                    f.update(edit["values"])
                    updated.append(f["id"])
                elif edit["type"] == "placeAsset":
                    values = edit["values"]
                    state["furniture"].append(
                        {
                            "id": "model-1",
                            "key": f"model:{edit['assetId']}",
                            "type": "model",
                            "modelId": edit["assetId"],
                            "name": "照片花瓶",
                            "x": values["x"],
                            "y": values["y"],
                            "z": values.get("z", 0),
                            "rot": 0,
                            "w": 224,
                            "d": 224,
                            "h": 280,
                            "color": "#ffffff",
                            "placement": values["placement"],
                            **(
                                {"parentObjectId": values["parentObjectId"]}
                                if values.get("parentObjectId")
                                else {}
                            ),
                        }
                    )
                    added.append("model-1")
            c = {
                "id": body["requestId"],
                "state": {"plan": state, "roomLabelArchive": []},
                "baseRevision": self.project["revision"],
                "hash": "candidate-hash",
                "operationId": "commit-" + body["requestId"],
                "scope": body["scope"],
                "checks": {
                    "passed": not (
                        self.blocked or (self.block_once and not self.blocked_once_used)
                    ),
                    "issues": (
                        [
                            {
                                "code": "OPENABLE_FRONT_BLOCKED",
                                "objectIds": ["w1", "bed"],
                                "message": "衣柜开启净空仅 0 mm（需 600 mm），被 双人床 1.8m 占用",
                                "level": "error",
                                "blocking": True,
                                "metric": 600,
                            }
                        ]
                        if self.blocked or (self.block_once and not self.blocked_once_used)
                        else []
                    ),
                    "coverage": [],
                    "limitations": [],
                },
                "diff": {"added": added, "deleted": [], "updated": updated},
                "summary": body.get("summary", ""),
                "committed": None,
            }
            self.candidates[c["id"]] = c
            if self.block_once and not self.blocked_once_used:
                self.blocked_once_used = True
            return copy.deepcopy(c)
        parts = path.split("/")
        cid = parts[4]
        candidate = self.candidates[cid]
        if path.endswith("/render"):
            return [
                {"view": "top", "sha256": "a" * 64},
                {"view": "oblique", "sha256": "b" * 64},
            ]
        if path.endswith("/review"):
            candidate["review"] = body
            return copy.deepcopy(candidate)
        if path.endswith("/commit"):
            self.project["plan"] = copy.deepcopy(candidate["state"]["plan"])
            self.project["revision"] += 1
            candidate["committed"] = self.project["revision"]
            return {
                "project": copy.deepcopy(self.project),
                "replayed": False,
            }
        return copy.deepcopy(candidate)


class NoopRoles:
    def __init__(self, store, client):
        self.store, self.client = store, client


async def start(manager, body):
    await manager.start()
    conversation = manager.store.create_conversation("p")
    task = manager.store.create_task(conversation["id"], body)
    manager.enqueue(task["id"])
    for _ in range(400):
        result = manager.store.task(task["id"])
        if result["status"] in ("completed", "failed", "waiting_input", "cancelled", "conflict"):
            return result
        await asyncio.sleep(0.01)
    raise AssertionError("controlled task did not finish")


@pytest.mark.asyncio
async def test_interactive_action_commits_through_candidate_gate(tmp_path):
    client = FlowScene()
    manager = TaskManager(tmp_path, client, NoopRoles)
    try:
        task = await start(
            manager,
            {
                "requestId": "action-1",
                "input": "打开衣柜门",
                "mode": "interactive_action",
                "selectedIds": ["w1"],
            },
        )
        assert task["status"] == "completed", task
        assert client.project["plan"]["furniture"][0]["opt"]["open"] is True
        assert client.project["revision"] == 1
        assert task["result"]["policy"]["route"] == "interactive_action"
    finally:
        await manager.close()


@pytest.mark.asyncio
async def test_blocked_action_does_not_mutate_project(tmp_path):
    client = FlowScene(blocked=True)
    manager = TaskManager(tmp_path, client, NoopRoles)
    try:
        task = await start(
            manager,
            {
                "requestId": "action-2",
                "input": "打开衣柜门",
                "mode": "interactive_action",
                "selectedIds": ["w1"],
            },
        )
        assert task["status"] == "waiting_input", task
        assert client.project["revision"] == 0
        assert "OPENABLE_FRONT_BLOCKED" in task["result"]["report"]["issues"][0]["code"]
    finally:
        await manager.close()


@pytest.mark.asyncio
async def test_photo_asset_is_placed_on_surface_through_candidate(tmp_path):
    client = FlowScene()
    manager = TaskManager(tmp_path, client, NoopRoles)
    try:
        task = await start(
            manager,
            {
                "requestId": "photo-1",
                "input": "把照片花瓶放到茶几上",
                "mode": "photo_to_scene",
                "selectedIds": ["t1"],
                "assetId": "asset-demo",
                "hostId": "t1",
            },
        )
        assert task["status"] == "completed", task
        model = next(f for f in client.project["plan"]["furniture"] if f["type"] == "model")
        assert model["parentObjectId"] == "t1"
        assert model["z"] == 400
        assert model["h"] == 280
        assert client.project["revision"] == 1
    finally:
        await manager.close()


@pytest.mark.asyncio
async def test_policy_auto_routes_an_edit_request_to_interactive_action(tmp_path):
    client = FlowScene()
    manager = TaskManager(tmp_path, client, NoopRoles)
    try:
        task = await start(
            manager,
            {
                "requestId": "auto-action",
                "input": "把衣柜门打开",
                "selectedIds": ["w1"],
            },
        )
        assert task["status"] == "completed", task
        assert task["result"]["policy"]["route"] == "interactive_action"
        assert client.project["plan"]["furniture"][0]["opt"]["open"] is True
    finally:
        await manager.close()


@pytest.mark.asyncio
async def test_policy_auto_routes_an_edit_request_with_asset_to_photo_flow(tmp_path):
    client = FlowScene()
    manager = TaskManager(tmp_path, client, NoopRoles)
    try:
        task = await start(
            manager,
            {
                "requestId": "auto-photo",
                "input": "把照片花瓶放到茶几上",
                "selectedIds": ["t1"],
                "assetId": "asset-demo",
                "hostId": "t1",
            },
        )
        assert task["status"] == "completed", task
        assert task["result"]["policy"]["route"] == "photo_to_scene"
        model = next(f for f in client.project["plan"]["furniture"] if f["type"] == "model")
        assert model["parentObjectId"] == "t1" and model["z"] == 400
    finally:
        await manager.close()


@pytest.mark.asyncio
async def test_compound_quick_action_waits_without_expanding_scope(tmp_path):
    client = FlowScene(block_once=True)
    manager = TaskManager(tmp_path, client, NoopRoles)
    try:
        task = await start(
            manager,
            {
                "requestId": "action-repair",
                "input": "打开衣柜门，把挡住柜门的家具移开一点",
                "mode": "interactive_action",
                "selectedIds": ["w1"],
            },
        )
        assert task["status"] == "waiting_input", task
        assert client.project["revision"] == 0
        bed = next(f for f in client.project["plan"]["furniture"] if f["id"] == "bed")
        assert bed["y"] == 1300
    finally:
        await manager.close()


@pytest.mark.asyncio
async def test_blocked_action_without_repair_authorization_does_not_move_blocker(tmp_path):
    client = FlowScene(block_once=True)
    manager = TaskManager(tmp_path, client, NoopRoles)
    try:
        task = await start(
            manager,
            {
                "requestId": "action-no-repair-auth",
                "input": "打开衣柜门",
                "mode": "interactive_action",
                "selectedIds": ["w1"],
            },
        )
        assert task["status"] == "waiting_input", task
        assert client.project["revision"] == 0
        bed = next(f for f in client.project["plan"]["furniture"] if f["id"] == "bed")
        assert bed["y"] == 1300
    finally:
        await manager.close()


@pytest.mark.asyncio
async def test_close_already_closed_is_idempotent_without_revision(tmp_path):
    client = FlowScene()
    manager = TaskManager(tmp_path, client, NoopRoles)
    try:
        task = await start(
            manager,
            {
                "requestId": "action-close-idempotent",
                "input": "关闭衣柜门",
                "mode": "interactive_action",
                "selectedIds": ["w1"],
            },
        )
        assert task["status"] == "completed", task
        assert client.project["revision"] == 0
        assert client.project["plan"]["furniture"][0]["opt"]["open"] is False
    finally:
        await manager.close()


@pytest.mark.asyncio
async def test_fast_single_object_move_commits_without_model(tmp_path):
    client = FlowScene()
    manager = TaskManager(tmp_path, client, NoopRoles)
    try:
        task = await start(
            manager,
            {
                "requestId": "fast-move",
                "input": "把茶几往左移200毫米",
                "selectedIds": ["t1"],
            },
        )
        assert task["status"] == "completed", task
        assert task["result"]["policy"]["fastEdit"]["values"]["x"] == 1800
        table = next(f for f in client.project["plan"]["furniture"] if f["id"] == "t1")
        assert table["x"] == 1800
        assert client.project["revision"] == 1
    finally:
        await manager.close()


@pytest.mark.asyncio
async def test_fast_single_object_dimension_commits_without_model(tmp_path):
    client = FlowScene()
    manager = TaskManager(tmp_path, client, NoopRoles)
    try:
        task = await start(
            manager,
            {
                "requestId": "fast-width",
                "input": "把茶几宽度改为1.2米",
                "selectedIds": ["t1"],
            },
        )
        assert task["status"] == "completed", task
        table = next(f for f in client.project["plan"]["furniture"] if f["id"] == "t1")
        assert table["w"] == 1200
        assert client.project["revision"] == 1
    finally:
        await manager.close()
