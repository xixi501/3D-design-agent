"""Controlled roles/scene transport test the actual generation graph and SQLite recovery.

Geometry and HTTP transactions have separate TypeScript and real-WebGL acceptance.
"""

import asyncio
import copy

import pytest
from test_workflow import CHAIR, FIXTURE, FakeScene, finished

from actiscape_agent.client import SceneFailure
from actiscape_agent.generation_roles import GenerationRoles
from actiscape_agent.manager import TaskManager
from actiscape_agent.skill_registry import GENERATION_TOOLS, load_design_skill
from actiscape_agent.store import TaskStore

COLLECTIONS = (
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
)
TEXT = "阅读会客间，宽9000毫米，深6000毫米，南墙门居中，没有窗，只要一把单人沙发。"


class GenerationScene(FakeScene):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        for key in COLLECTIONS:
            self.project["plan"][key] = []
        self.interfere = False
        self.scene_draft = None

    async def image(self, path):
        return b"controlled-image-transport"

    async def request(self, path, body=None):
        if path == "/projects/p/scene-drafts" and body is not None:
            if self.scene_draft is None:
                self.scene_draft = {
                    "id": "scene-draft-1",
                    "revision": 0,
                    "hash": "a" * 64,
                    "draft": body["draft"],
                }
            return {
                "id": self.scene_draft["id"],
                "revision": self.scene_draft["revision"],
                "hash": self.scene_draft["hash"],
            }
        if path.endswith("/scene-drafts/scene-draft-1/patches") and body is not None:
            assert body["draftRevision"] == self.scene_draft["revision"]
            self.scene_draft["revision"] += 1
            self.scene_draft["hash"] = f"{self.scene_draft['revision']:064x}"
            return {
                "id": self.scene_draft["id"],
                "revision": self.scene_draft["revision"],
                "hash": self.scene_draft["hash"],
            }
        if path.endswith("/initialization-preview"):
            shell = copy.deepcopy(FIXTURE)
            shell["furniture"] = []
            return {
                "state": {"plan": shell, "roomLabelArchive": []},
                "dimensions": {"width": 9000, "depth": 6000, "height": 2800, "wallThickness": 200},
                "openings": [],
                "defaults": ["controlled defaults"],
            }
        if path == "/projects/p/candidates" and body is not None:
            id = body["requestId"]
            if id not in self.candidates:
                plan = copy.deepcopy(FIXTURE)
                chair = next(f for f in plan["furniture"] if f["id"] == CHAIR)
                chair["id"] = id + ":new"
                chair.update(body["edits"][0]["values"])
                plan["furniture"] = [chair]
                self.candidates[id] = {
                    "id": id,
                    "kind": "initialize",
                    "state": {"plan": plan, "roomLabelArchive": []},
                    "baseRevision": self.project["revision"],
                    "hash": "controlled-hash",
                    "operationId": "commit-" + id,
                    "scope": body["scope"],
                    "checks": {"passed": True, "issues": [], "coverage": [], "limitations": []},
                    "diff": {"added": [chair["id"]], "updated": [], "deleted": []},
                    "summary": "controlled generation",
                    "generation": {
                        "brief": body["brief"],
                        "dimensions": {"width": 9000, "depth": 6000},
                        "openings": [],
                        "defaults": [],
                    },
                    "structure": {"walls": {"added": [w["id"] for w in plan["walls"]]}},
                    "committed": None,
                }
                if self.bad_checks:
                    self.candidates[id]["checks"] = {
                        "passed": False,
                        "issues": [
                            {
                                "code": "OUTSIDE_ROOM",
                                "objectIds": [chair["id"]],
                                "message": "家具超出固定房间",
                                "blocking": True,
                            }
                        ],
                        "coverage": [],
                        "limitations": [],
                    }
            return copy.deepcopy(self.candidates[id])
        if path.endswith("/commit") and self.interfere:
            self.interfere = False
            self.project["revision"] += 1
            self.project["plan"]["furniture"] = [
                copy.deepcopy(next(f for f in FIXTURE["furniture"] if f["id"] == CHAIR))
            ]
            raise SceneFailure(
                409, {"error": "REVISION_CONFLICT", "message": "controlled manual edit"}
            )
        return await super().request(path, body)


class ControlledRoles:
    def __init__(self, store, client):
        self.store, self.client = store, client

    def scene_tools(self, project):
        return []

    async def invoke(self, role, prompt, schema, tools, payload, task_id, images=None, **kwargs):
        self.store.count_model_call(task_id, role)
        if role == "main":
            self.client.ground_calls += 1
            if "宽9000毫米" not in payload["userRequest"]:
                return {
                    "status": "clarify",
                    "purpose": "reading_lounge",
                    "evidence": {"purpose": "阅读会客间"},
                }
            return {
                "status": "ready",
                "purpose": "reading_lounge",
                "width": {"value": 9000, "unit": "mm"},
                "depth": {"value": 6000, "unit": "mm"},
                "doors": [{"side": "south", "position": "center"}],
                "windows": [],
                "furniture": [{"query": "单人沙发", "count": 1}],
                "evidence": {
                    "purpose": "阅读会客间",
                    "width": "宽9000毫米",
                    "depth": "深6000毫米",
                    "doors": "南墙门居中",
                    "windows": "没有窗",
                },
                "skillSelection": {
                    "primarySkillId": "rectangular-living-reading",
                    "modifierSkillIds": [],
                    "reason": "矩形阅读会客间",
                },
            }
        if role == "assets":
            return {"choices": [{"request_index": 0, "key": "armchair", "reason": "controlled"}]}
        if role == "design":
            self.client.design_calls += 1
            if self.client.suspend_design:
                self.client.suspend_design = False
                self.client.design_entered.set()
                await asyncio.Event().wait()
            return {
                "summary": "controlled generation",
                "edits": [{"type": "create", "key": "armchair", "values": {"x": 6600, "y": 4900}}],
            }
        return {"passed": True, "summary": "controlled review", "issues": []}


async def start_generation(manager, text=TEXT):
    await manager.start()
    c = manager.store.create_conversation("p")
    task = manager.store.create_task(
        c["id"],
        {"requestId": "generate", "input": text, "selectedIds": [], "mode": "generate_rectangular"},
    )
    manager.enqueue(task["id"])
    return task


@pytest.mark.asyncio
async def test_generation_clarifies_then_resumes_same_task_without_changing_project(tmp_path):
    client = GenerationScene()
    manager = TaskManager(tmp_path, client, ControlledRoles)
    try:
        task = await start_generation(manager, "阅读会客间")
        for _ in range(300):
            result = manager.store.task(task["id"])
            if result["status"] == "waiting_input":
                break
            await asyncio.sleep(0.01)
        assert result["status"] == "waiting_input" and client.project["revision"] == 0
        assert "横向净宽" in result["generation"]["missing"]
        calls = result["modelCalls"]
        manager.store.resume(task["id"], {"requestId": "clarify", "input": TEXT, "selectedIds": []})
        manager.enqueue(task["id"])
        result = await finished(manager, task["id"])
        assert result["status"] == "completed", result
        assert result["modelCalls"] > calls and client.project["revision"] == 1
        assert result["generation"]["sceneDraftId"] == "scene-draft-1"
        assert result["generation"]["sceneDraftRevision"] >= 2
        assert result["result"]["skillSelection"]["primarySkillId"] == "rectangular-living-reading"
        primary = next(item for item in result["result"]["skillsUsed"] if item["role"] == "primary")
        assert primary["contentHash"] == load_design_skill(GENERATION_TOOLS)["contentHash"]
        assert [item["role"] for item in result["result"]["skillsUsed"]] == [
            "universal",
            "primary",
        ]
        assert "content" not in result["generation"]["skillBundle"]["primary"]
    finally:
        await manager.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("cancel", [False, True])
async def test_generation_checkpoint_pins_skill_and_reconciles_commit_or_cancellation(
    tmp_path, monkeypatch, cancel
):
    client = GenerationScene(suspend_design=True, lost_response=True)
    manager = TaskManager(tmp_path, client, ControlledRoles)
    task = await start_generation(manager)
    await asyncio.wait_for(client.design_entered.wait(), 5)
    pinned_generation = manager.store.task(task["id"], internal=True)["generation"]
    pinned = pinned_generation["skillSnapshot"]
    pinned_bundle = pinned_generation["skillBundle"]
    if cancel:
        manager.store.cancel(task["id"])
    await manager.close()

    def future_skill_unavailable(*args):
        raise AssertionError("Recovered task must use pinned content, not read a new Skill")

    monkeypatch.setattr("actiscape_agent.generation_flow.get_registry", future_skill_unavailable)
    manager = TaskManager(tmp_path, client, ControlledRoles)
    try:
        await manager.start()
        result = await finished(manager, task["id"])
        assert result["status"] == ("cancelled" if cancel else "completed"), result
        assert (
            manager.store.task(task["id"], internal=True)["generation"]["skillSnapshot"] == pinned
        )
        assert (
            manager.store.task(task["id"], internal=True)["generation"]["skillBundle"]
            == pinned_bundle
        )
        assert len(client.ledger) == (0 if cancel else 1)
        assert client.ground_calls == 1
    finally:
        await manager.close()


@pytest.mark.asyncio
async def test_manual_edit_stops_initialization_without_overwrite(tmp_path):
    client = GenerationScene()
    client.interfere = True
    manager = TaskManager(tmp_path, client, ControlledRoles)
    try:
        task = await start_generation(manager)
        result = await finished(manager, task["id"])
        assert result["status"] == "failed", result
        assert result["result"]["errorCode"] == "PROJECT_NOT_EMPTY"
        assert client.project["revision"] == 1 and len(client.ledger) == 0
        assert not client.project["plan"]["walls"]
        assert len(client.project["plan"]["furniture"]) == 1
    finally:
        await manager.close()


@pytest.mark.asyncio
async def test_generation_budget_failure_keeps_specific_candidate_problem(tmp_path):
    class BudgetRoles(ControlledRoles):
        async def invoke(self, role, *args, **kwargs):
            if role == "design" and self.client.design_calls:
                task_id = args[4]
                self.store.db.execute("UPDATE tasks SET model_calls=24 WHERE id=?", (task_id,))
            return await super().invoke(role, *args, **kwargs)

    client = GenerationScene(bad_checks=True)
    manager = TaskManager(tmp_path, client, BudgetRoles)
    try:
        task = await start_generation(manager)
        result = await finished(manager, task["id"])
        assert result["status"] == "failed", result
        assert result["result"]["errorCode"] == "BUDGET_EXHAUSTED"
        assert result["result"]["candidateId"]
        assert "家具超出固定房间" in result["result"]["message"]
        assert client.project["revision"] == 0 and not client.ledger
    finally:
        await manager.close()


class PatchRecordingScene(GenerationScene):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.patch_request_ids = []

    async def request(self, path, body=None):
        if path.endswith("/patches") and body is not None:
            self.patch_request_ids.append(body["requestId"])
            return {
                "id": "scene-draft-1",
                "revision": len(self.patch_request_ids),
                "hash": f"{len(self.patch_request_ids):064x}",
            }
        return await super().request(path, body)


@pytest.mark.asyncio
async def test_scene_patch_identity_is_candidate_bound_not_round_bound(tmp_path):
    client = PatchRecordingScene()
    store = TaskStore(tmp_path)
    try:

        class Base:
            pass

        base = Base()
        base.store = store
        base.client = client
        roles = GenerationRoles(base)
        conversation = store.create_conversation("p")
        task = store.create_task(
            conversation["id"],
            {
                "requestId": "candidate-patch-identity",
                "input": "生成主卧",
                "selectedIds": [],
                "mode": "generate_rectangular",
            },
        )
        store.update(
            task["id"],
            generation={
                "sceneDraftId": "scene-draft-1",
                "sceneDraftRevision": 0,
                "frozenBrief": {"roomType": "master_bedroom"},
            },
        )
        task = store.task(task["id"], internal=True)
        scope = {"allowAddKeys": ["armchair"], "requirements": []}
        for x in (100, 200):
            await roles.candidate(
                task,
                {"revision": 0},
                scope,
                {
                    "summary": f"candidate at {x}",
                    "edits": [
                        {
                            "type": "create",
                            "key": "armchair",
                            "values": {"x": x, "y": x},
                        }
                    ],
                },
                0,
            )
        assert len(client.patch_request_ids) == 2
        assert len(set(client.patch_request_ids)) == 2
    finally:
        store.close()
