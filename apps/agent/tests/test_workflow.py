"""Controlled transport/role substitutions exercise real LangGraph checkpoint and recovery semantics."""

import asyncio
import copy
import json
from pathlib import Path

import httpx
import pytest

from actiscape_agent.client import SceneFailure
from actiscape_agent.manager import TaskManager

FIXTURE = json.loads(
    (Path(__file__).resolve().parents[3] / "fixtures/living-dining.plan.json").read_text()
)
CHAIR = next(f["id"] for f in FIXTURE["furniture"] if f["key"] == "armchair")


class FakeScene:
    def __init__(self, *, lost_response=False, conflicts=0, bad_checks=False, suspend_design=False):
        self.project = {
            "id": "p",
            "revision": 0,
            "plan": copy.deepcopy(FIXTURE),
            "roomLabelArchive": [],
        }
        self.candidates = {}
        self.ledger = {}
        self.lost_response = lost_response
        self.conflicts = conflicts
        self.bad_checks = bad_checks
        self.suspend_design = suspend_design
        self.design_entered = asyncio.Event()
        self.ground_calls = 0
        self.design_calls = 0

    async def request(self, path, body=None):
        if path == "/projects/p":
            return copy.deepcopy(self.project)
        if path == "/catalog":
            return {"items": {"armchair": {"name": "chair"}}}
        if path == "/projects/p/candidates" and body is not None:
            id = body["requestId"]
            if id in self.candidates:
                return copy.deepcopy(self.candidates[id])
            state = {"plan": copy.deepcopy(self.project["plan"]), "roomLabelArchive": []}
            chair = next(f for f in state["plan"]["furniture"] if f["id"] == CHAIR)
            chair["x"] = body["x"]
            c = {
                "id": id,
                "state": state,
                "baseRevision": self.project["revision"],
                "hash": "fixed-hash",
                "operationId": "commit-" + id,
                "scope": body["scope"],
                "checks": {
                    "passed": not self.bad_checks,
                    "issues": [],
                    "coverage": [],
                    "limitations": [],
                },
                "diff": {"added": [], "deleted": [], "updated": [CHAIR]},
                "summary": "controlled test",
                "committed": None,
            }
            self.candidates[id] = c
            return copy.deepcopy(c)
        id = path.split("/")[4]
        c = self.candidates[id]
        if path.endswith("/render"):
            return [{"view": "top", "sha256": "top"}, {"view": "oblique", "sha256": "oblique"}]
        if path.endswith("/review"):
            c["review"] = body
            return copy.deepcopy(c)
        if path.endswith("/commit"):
            operation = body["operationId"]
            if operation in self.ledger:
                return {"project": copy.deepcopy(self.ledger[operation]), "replayed": True}
            if self.conflicts:
                self.conflicts -= 1
                self.project["revision"] += 1
                next(f for f in self.project["plan"]["furniture"] if f["id"] == CHAIR)["x"] += 100
                raise SceneFailure(409, {"error": "REVISION_CONFLICT", "message": "changed"})
            self.project["plan"] = copy.deepcopy(c["state"]["plan"])
            self.project["revision"] += 1
            c["committed"] = self.project["revision"]
            self.ledger[operation] = copy.deepcopy(self.project)
            if self.lost_response:
                self.lost_response = False
                raise httpx.ReadTimeout("controlled response loss after actual commit")
            return {"project": copy.deepcopy(self.project), "replayed": False}
        return copy.deepcopy(c)


class FakeRoles:
    def __init__(self, store, client):
        self.client = client

    async def ground(self, *args):
        self.client.ground_calls += 1
        return {
            "status": "ready",
            "summary": "move chair",
            "question": "",
            "target_ids": [CHAIR],
            "reference_ids": [],
            "delete_ids": [],
            "field_permissions": {CHAIR: ["x"]},
            "additions": [],
            "area": "local",
        }

    async def design(self, task, project, intent, scope, last_report, round):
        self.client.design_calls += 1
        if self.client.suspend_design:
            self.client.suspend_design = False
            self.client.design_entered.set()
            await asyncio.Event().wait()
        chair = next(f for f in project["plan"]["furniture"] if f["id"] == CHAIR)
        return {"summary": "controlled", "x": chair["x"] - 200}

    async def candidate(self, task, project, scope, proposal, round):
        return await self.client.request(
            "/projects/p/candidates",
            {
                "requestId": task["id"] + ":" + str(project["revision"]) + ":" + str(round),
                "x": proposal["x"],
                "scope": scope,
            },
        )

    async def inspect(self, *args):
        return {"passed": True, "summary": "controlled check", "issues": []}


class AdvisoryRoles(FakeRoles):
    async def inspect(self, *args):
        return {
            "passed": True,
            "summary": "code arbitrated model advisory",
            "issues": [
                {
                    "code": "REVIEW_CONFLICT",
                    "source": "model",
                    "severity": "advisory",
                    "object_ids": [CHAIR],
                    "description": "model concern contradicted by deterministic checks",
                }
            ],
        }


async def start_task(manager):
    await manager.start()
    c = manager.store.create_conversation("p")
    task = manager.store.create_task(
        c["id"], {"requestId": "task", "input": "move selected chair", "selectedIds": [CHAIR]}
    )
    manager.enqueue(task["id"])
    return task


async def finished(manager, id):
    for _ in range(400):
        task = manager.store.task(id)
        if task["status"] in ("completed", "failed", "cancelled", "conflict"):
            return task
        await asyncio.sleep(0.01)
    raise AssertionError("controlled task did not finish")


@pytest.mark.asyncio
async def test_lost_commit_response_is_reconciled_without_duplicate(tmp_path):
    client = FakeScene(lost_response=True)
    manager = TaskManager(tmp_path, client, FakeRoles)
    try:
        task = await start_task(manager)
        result = await finished(manager, task["id"])
        assert result["status"] == "completed", result
        assert client.project["revision"] == 1 and len(client.ledger) == 1
        assert any(e["kind"] == "commit_reconciled" for e in manager.store.events(task["id"]))
    finally:
        await manager.close()


@pytest.mark.asyncio
async def test_advisory_review_issues_do_not_enter_passed_candidate_review(tmp_path):
    client = FakeScene()
    manager = TaskManager(tmp_path, client, AdvisoryRoles)
    try:
        task = await start_task(manager)
        result = await finished(manager, task["id"])
        assert result["status"] == "completed", result
        candidate = next(iter(client.candidates.values()))
        assert candidate["review"]["passed"] is True
        assert candidate["review"]["issues"] == []
        assert candidate["review"]["objectIds"] == []
    finally:
        await manager.close()


@pytest.mark.asyncio
async def test_checkpoint_restart_resumes_pending_node(tmp_path):
    client = FakeScene(suspend_design=True)
    manager = TaskManager(tmp_path, client, FakeRoles)
    task = await start_task(manager)
    await asyncio.wait_for(client.design_entered.wait(), 5)
    await manager.close()
    manager = TaskManager(tmp_path, client, FakeRoles)
    try:
        await manager.start()
        result = await finished(manager, task["id"])
        assert result["status"] == "completed", result
        assert client.ground_calls == 1 and client.design_calls == 2
        assert len(client.ledger) == 1
    finally:
        await manager.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("conflicts,expected", [(1, "completed"), (2, "conflict")])
async def test_only_one_revision_replan_is_allowed(tmp_path, conflicts, expected):
    client = FakeScene(conflicts=conflicts)
    manager = TaskManager(tmp_path, client, FakeRoles)
    try:
        task = await start_task(manager)
        result = await finished(manager, task["id"])
        assert result["status"] == expected, result
        assert len(client.ledger) == (1 if expected == "completed" else 0)
        assert client.ground_calls == 2
    finally:
        await manager.close()


@pytest.mark.asyncio
async def test_failed_candidate_repairs_stop_after_three_and_keep_scene(tmp_path):
    client = FakeScene(bad_checks=True)
    manager = TaskManager(tmp_path, client, FakeRoles)
    try:
        task = await start_task(manager)
        result = await finished(manager, task["id"])
        assert result["status"] == "failed" and client.design_calls == 4
        assert client.project["revision"] == 0 and not client.ledger
    finally:
        await manager.close()


@pytest.mark.asyncio
async def test_cancel_before_commit_keeps_project_unchanged(tmp_path):
    client = FakeScene(suspend_design=True)
    manager = TaskManager(tmp_path, client, FakeRoles)
    task = await start_task(manager)
    await asyncio.wait_for(client.design_entered.wait(), 5)
    manager.store.cancel(task["id"])
    await manager.close()
    manager = TaskManager(tmp_path, client, FakeRoles)
    try:
        await manager.start()
        result = await finished(manager, task["id"])
        assert result["status"] == "cancelled" and client.project["revision"] == 0
    finally:
        await manager.close()


@pytest.mark.asyncio
async def test_render_failure_reports_error_without_commit(tmp_path):
    class RenderFailureScene(FakeScene):
        async def request(self, path, body=None):
            if path.endswith("/render"):
                raise SceneFailure(503, {"error": "RENDER_FAILED", "message": "截图失败"})
            return await super().request(path, body)

    client = RenderFailureScene()
    manager = TaskManager(tmp_path, client, FakeRoles)
    try:
        task = await start_task(manager)
        result = await finished(manager, task["id"])
        assert result["status"] == "failed"
        assert result["result"]["errorCode"] == "RENDER_FAILED"
        assert client.project["revision"] == 0 and not client.ledger
        assert len(client.candidates) == 1
    finally:
        await manager.close()
