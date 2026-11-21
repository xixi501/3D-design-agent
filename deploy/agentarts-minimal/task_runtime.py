"""AgentArts task runtime adapter around the multi-agent Workflow and MCP tools.

Supports full task lifecycle operations inside the AgentArts container:
- ``run_task``    : execute a read-only MCP check or multi-agent scene task
- ``resume_task`` : supply clarification input to a ``waiting_input`` task
- ``cancel_task`` : cancel an active or ``waiting_input`` task (preventing ``PROJECT_BUSY``)
"""

from __future__ import annotations

import asyncio
import os
import tempfile
import time
import uuid
from pathlib import Path

from actiscape_agent.manager import TaskManager

import mcp_gateway

TERMINAL = {"completed", "failed", "waiting_input", "cancelled", "conflict"}
_READONLY_PREFIXES = ("只检查", "仅检查", "只做检查", "仅做场景检查")
_RUNTIME_MANAGER: TaskManager | None = None
_RUNTIME_LOCK: asyncio.Lock | None = None


async def _runtime_manager() -> TaskManager:
    """One process-local TaskStore so requestId remains idempotent within a warm instance."""
    global _RUNTIME_MANAGER, _RUNTIME_LOCK
    if _RUNTIME_LOCK is None:
        _RUNTIME_LOCK = asyncio.Lock()
    async with _RUNTIME_LOCK:
        if _RUNTIME_MANAGER is None:
            _RUNTIME_MANAGER = TaskManager(
                Path(tempfile.mkdtemp(prefix="agentarts-task-"))
            )
            await _RUNTIME_MANAGER.start()
        return _RUNTIME_MANAGER


def _body(payload: dict) -> dict:
    if not isinstance(payload.get("projectId"), str) or not payload["projectId"]:
        raise ValueError("run_task 需要 projectId")
    if not isinstance(payload.get("input", ""), str):
        raise TypeError("run_task.input 必须是字符串")
    body = {
        "requestId": str(payload.get("requestId") or uuid.uuid4()),
        "input": payload.get("input", ""),
        "selectedIds": list(payload.get("selectedIds") or []),
        "mode": payload.get("mode") or "edit",
    }
    for key in ("imageId", "assetId", "hostId", "floorplanScope"):
        if payload.get(key) is not None:
            body[key] = payload[key]
    return body


def _is_check_intent(text: str, mode: str | None = None) -> bool:
    """True for explicit read-only scene-check requests without hijacking edit commands."""
    if mode == "check":
        return True
    value = (text or "").strip()
    if not value:
        return False
    return value.startswith(_READONLY_PREFIXES)


async def _run_scene_check(project_id: str, body: dict, timeout: float) -> dict:
    """Read-only check through the AgentArts MCP gateway (no scene mutation)."""
    task_id = str(uuid.uuid4())
    outcome = await mcp_gateway.call_scene_checks(
        project_id, timeout=min(max(timeout, 5.0), 60.0)
    )
    issues = outcome.get("issues") or []
    codes: list[str] = [
        str(issue["code"])
        for issue in issues
        if isinstance(issue, dict) and issue.get("code")
    ]
    revision = outcome.get("revision")
    if outcome.get("ok"):
        detail = "、".join(codes) if codes else "未发现冲突"
        summary = (
            f"只读检查完成：场景版本 revision={revision}，检出 {len(issues)} 项冲突（{detail}）"
        )
        status = "completed"
        error = None
    else:
        summary = f"MCP 网关检查失败：{outcome.get('error')} {outcome.get('message') or ''}"
        status = "failed"
        error = summary.strip()
    print(
        "[mcp] tool=%s request=%s mcpRequestId=%s revision=%s codes=%s status=%s ms=%s"
        % (
            mcp_gateway.TOOL_NAME,
            body.get("requestId"),
            outcome.get("request_id"),
            revision,
            ",".join(codes),
            "ok" if outcome.get("ok") else "error",
            outcome.get("ms"),
        ),
        flush=True,
    )
    return {
        "status": status,
        "taskId": task_id,
        "result": {
            "kind": "scene_check",
            "projectId": project_id,
            "requestId": body.get("requestId"),
            "tool": mcp_gateway.TOOL_NAME,
            "mcpRequestId": outcome.get("request_id"),
            "revision": revision,
            "issues": issues,
            "codes": codes,
            "message": summary,
            "latencyMs": outcome.get("ms"),
        },
        "error": error,
        "generation": None,
        "mode": "check",
        "cloud": True,
    }


async def _await_terminal(manager: TaskManager, task_id: str, timeout: float) -> dict:
    started = time.monotonic()
    while time.monotonic() - started < timeout:
        current = manager.store.task(task_id, internal=True)
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

    manager.store.cancel(task_id)
    deadline = time.monotonic() + min(2.0, max(0.5, timeout * 0.1))
    while time.monotonic() < deadline:
        current = manager.store.task(task_id, internal=True)
        if current["status"] in TERMINAL:
            break
        await asyncio.sleep(0.05)
    current = manager.store.task(task_id, internal=True)
    return {
        "status": "timeout" if current["status"] not in TERMINAL else current["status"],
        "taskId": current["id"],
        "result": current.get("result"),
        "error": (
            f"task exceeded {timeout:g}s"
            if current["status"] == "timeout" or current["status"] not in TERMINAL
            else current.get("error")
        ),
        "generation": current.get("generation"),
        "mode": current.get("mode"),
        "cloud": True,
    }


async def run_task(
    payload: dict,
    *,
    manager: TaskManager | None = None,
    timeout: float | None = None,
) -> dict:
    """Run one real Workflow task inside the AgentArts container."""
    body = _body(payload)
    resolved_timeout = float(
        timeout
        if timeout is not None
        else os.environ.get("AGENTARTS_TASK_TIMEOUT", "240")
    )
    if _is_check_intent(body.get("input", ""), body.get("mode")):
        return await _run_scene_check(payload["projectId"], body, resolved_timeout)
    if manager is None:
        manager = await _runtime_manager()
    elif manager.worker is None:
        await manager.start()
    conversation = manager.store.conversation_for_project(payload["projectId"])
    task = manager.store.create_task(conversation["id"], body)
    manager.enqueue(task["id"])
    return await _await_terminal(manager, task["id"], resolved_timeout)


async def resume_task(
    payload: dict,
    *,
    manager: TaskManager | None = None,
    timeout: float | None = None,
) -> dict:
    """Resume a waiting_input task inside the warm AgentArts session."""
    task_id = str(payload.get("taskId") or "").strip()
    if not task_id:
        raise ValueError("resume_task 需要 taskId")
    resolved_timeout = float(
        timeout
        if timeout is not None
        else os.environ.get("AGENTARTS_TASK_TIMEOUT", "240")
    )
    if manager is None:
        manager = await _runtime_manager()
    elif manager.worker is None:
        await manager.start()
    resumed = await manager.resume(
        task_id,
        {
            "requestId": str(payload.get("requestId") or uuid.uuid4()),
            "input": str(payload.get("input") or ""),
            "selectedIds": list(payload.get("selectedIds") or []),
        },
    )
    return await _await_terminal(manager, resumed["id"], resolved_timeout)


async def cancel_task(
    payload: dict,
    *,
    manager: TaskManager | None = None,
) -> dict:
    """Cancel a running or waiting_input task, releasing any PROJECT_BUSY lock."""
    task_id = str(payload.get("taskId") or "").strip()
    if not task_id:
        raise ValueError("cancel_task 需要 taskId")
    if manager is None:
        manager = await _runtime_manager()
    try:
        cancelled = manager.store.cancel(task_id)
        return {
            "status": cancelled["status"],
            "taskId": cancelled["id"],
            "cloud": True,
        }
    except Exception:
        return {"status": "cancelled", "taskId": task_id, "cloud": True}
