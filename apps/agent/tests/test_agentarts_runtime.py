"""AgentArts /invocations adapter: probe compatibility + full Workflow task."""

import importlib.util
import sys
from pathlib import Path

import pytest

from actiscape_agent.manager import TaskManager

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_action_photo_workflow import FlowScene, NoopRoles  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
RUNTIME_DIR = ROOT / "deploy/agentarts-minimal"
sys.path.insert(0, str(RUNTIME_DIR))


def load(name: str, file: str):
    spec = importlib.util.spec_from_file_location(name, RUNTIME_DIR / file)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


task_runtime = load("agentarts_task_runtime", "task_runtime.py")
agentarts_agent = load("agentarts_agent_entry", "agent.py")


@pytest.mark.asyncio
async def test_agentarts_run_task_executes_the_real_workflow(tmp_path):
    client = FlowScene()
    manager = TaskManager(tmp_path, client, NoopRoles)
    try:
        result = await task_runtime.run_task(
            {
                "action": "run_task",
                "projectId": "p",
                "requestId": "agentarts-action-1",
                "mode": "interactive_action",
                "input": "打开衣柜门",
                "selectedIds": ["w1"],
            },
            manager=manager,
            timeout=10,
        )
        assert result["status"] == "completed", result
        assert result["result"]["policy"]["route"] == "interactive_action"
        assert client.project["plan"]["furniture"][0]["opt"]["open"] is True
        assert client.project["revision"] == 1
    finally:
        await manager.close()


@pytest.mark.asyncio
async def test_agentarts_handler_routes_run_task_without_probe_validation(monkeypatch):
    seen = {}

    async def fake_run_task(payload):
        seen.update(payload)
        return {"status": "completed", "taskId": "cloud-1", "cloud": True}

    monkeypatch.setattr(agentarts_agent, "run_task", fake_run_task)
    result = await agentarts_agent.handler(
        {
            "action": "run_task",
            "projectId": "project-1",
            "mode": "photo_to_scene",
            "input": "把照片放到茶几上",
            "selectedIds": ["table"],
            "assetId": "asset-1",
            "hostId": "table",
        },
        None,
    )
    assert result["status"] == "completed"
    assert seen["projectId"] == "project-1"
    assert seen["mode"] == "photo_to_scene"


def test_runtime_preserves_floorplan_scope():
    body = task_runtime._body(
        {
            "projectId": "p",
            "mode": "reconstruct_floorplan",
            "imageId": "image-1",
            "floorplanScope": {
                "roomSelection": "selected",
                "functionalAreas": ["kitchen"],
                "excludeFunctionalAreas": ["balcony"],
            },
        }
    )
    assert body["floorplanScope"]["functionalAreas"] == ["kitchen"]
    assert body["imageId"] == "image-1"


@pytest.mark.asyncio
async def test_agentarts_run_task_is_idempotent_for_same_project_request(tmp_path):
    client = FlowScene()
    manager = TaskManager(tmp_path, client, NoopRoles)
    payload = {
        "action": "run_task",
        "projectId": "p",
        "requestId": "agentarts-idempotent-1",
        "mode": "interactive_action",
        "input": "打开衣柜门",
        "selectedIds": ["w1"],
    }
    try:
        first = await task_runtime.run_task(payload, manager=manager, timeout=10)
        revision = client.project["revision"]
        second = await task_runtime.run_task(payload, manager=manager, timeout=10)
        assert first["status"] == "completed" and second["status"] == "completed"
        assert first["taskId"] == second["taskId"]
        assert client.project["revision"] == revision == 1
    finally:
        await manager.close()
