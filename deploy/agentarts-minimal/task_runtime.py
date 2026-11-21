"""AgentArts stateless task adapter around the real multi-agent Workflow."""

from __future__ import annotations

import asyncio
import tempfile
import time
import uuid
from pathlib import Path

from actiscape_agent.manager import TaskManager

import mcp_gateway

TERMINAL = {"completed", "failed", "waiting_input", "cancelled", "conflict"}
_RUNTIME_MANAGER: TaskManager | None = None
_RUNTIME_LOCK: asyncio.Lock | None = None


async def _runtime_manager() -> TaskManager:
    """One process-local TaskStore so requestId remains idempotent.

    The AgentArts container is intentionally stateless across restarts; within a
    warm process, repeated requests must not create a second project revision.
    """
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


def _is_check_intent(text: str) -> bool:
    """True only for the read-only scene-check phrasing used by the workbench."""
    value = (text or "").strip()
    if not value:
        return False
    return value.startswith("只检查")


async def _run_scene_check(project_id: str, body: dict, timeout: float) -> dict:
    """Read-only check through the AgentArts MCP gateway (no scene mutation)."""
    task_id = str(uuid.uuid4())
    outcome = await mcp_gateway.call_scene_checks(
        project_id, timeout=min(max(timeout, 5.0), 60.0)
    )
    issues = outcome.get("issues") or []
    codes: list[str] = []
    for issue in issues:
        if isinstance(issue, dict) and issue.get("code"):
            codes.append(str(issue["code"]))
    revision = outcome.get("revision")
    if outcome.get("ok"):
        detail = "、".join(codes) if codes else "未发现冲突"
        summary = (
            "只读检查完成：场景版本 revision=%s，检出 %d 项冲突（%s）"
            % (revision, len(issues), detail)
        )
        status = "completed"
        error = None
    else:
        summary = "MCP 网关检查失败：%s %s" % (
            outcome.get("error"),
            outcome.get("message") or "",
        )
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
    if _is_check_intent(body.get("input", "")):
        return await _run_scene_check(payload["projectId"], body, timeout)
    if manager is None:
        manager = await _runtime_manager()
    elif manager.worker is None:
        await manager.start()
    started = time.monotonic()
    # A process-level manager is intentionally kept warm; its temp SQLite is
    # lost only when the stateless container itself exits.
    conversation = manager.store.conversation_for_project(payload["projectId"])
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
    # A caller timeout must also stop the queued/running workflow.  Returning
    # while the worker continues would allow a late candidate commit after the
    # platform has already reported failure to its caller.
    manager.store.cancel(task["id"])
    deadline = time.monotonic() + min(2.0, max(0.5, timeout * 0.1))
    while time.monotonic() < deadline:
        current = manager.store.task(task["id"], internal=True)
        if current["status"] in TERMINAL:
            break
        await asyncio.sleep(0.05)
    current = manager.store.task(task["id"], internal=True)
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
