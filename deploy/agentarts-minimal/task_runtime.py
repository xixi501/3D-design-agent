"""AgentArts stateless task adapter around the real multi-agent Workflow."""

from __future__ import annotations

import asyncio
import tempfile
import time
import uuid
from pathlib import Path

from actiscape_agent.manager import TaskManager

TERMINAL = {"completed", "failed", "waiting_input", "cancelled", "conflict"}


def _body(payload: dict) -> dict:
    if not isinstance(payload.get("projectId"), str) or not payload["projectId"]:
        raise ValueError("run_task 需要 projectId")
    if not isinstance(payload.get("input", ""), str):
        raise ValueError("run_task.input 必须是字符串")
    body = {
        "requestId": str(payload.get("requestId") or uuid.uuid4()),
        "input": payload.get("input", ""),
        "selectedIds": list(payload.get("selectedIds") or []),
        "mode": payload.get("mode") or "edit",
    }
    for key in ("imageId", "assetId", "hostId"):
        if payload.get(key) is not None:
            body[key] = payload[key]
    return body


async def run_task(
    payload: dict,
    *,
    manager: TaskManager | None = None,
    timeout: float | None = None,
) -> dict:
    """Run one real Workflow task inside the stateless AgentArts container."""
    body = _body(payload)
    timeout = float(
        timeout
        if timeout is not None
        else __import__("os").environ.get("AGENTARTS_TASK_TIMEOUT", "240")
    )
    owns = manager is None
    if manager is None:
        manager = TaskManager(Path(tempfile.mkdtemp(prefix="agentarts-task-")))
    started = time.monotonic()
    try:
        await manager.start()
        conversation = manager.store.create_conversation(payload["projectId"])
        task = manager.store.create_task(conversation["id"], body)
        manager.enqueue(task["id"])
        while time.monotonic() - started < timeout:
            current = manager.store.task(task["id"], internal=True)
            if current["status"] in TERMINAL:
                return {
                    "status": current["status"],
                    "taskId": current["id"],
                    "result": current.get("result"),
                    "error": current.get("error"),
                    "generation": current.get("generation"),
                    "mode": current.get("mode"),
                    "cloud": True,
                }
            await asyncio.sleep(0.2)
        current = manager.store.task(task["id"], internal=True)
        return {
            "status": "timeout",
            "taskId": current["id"],
            "result": current.get("result"),
            "error": f"task exceeded {timeout:g}s",
            "generation": current.get("generation"),
            "mode": current.get("mode"),
            "cloud": True,
        }
    finally:
        if owns:
            await manager.close()
