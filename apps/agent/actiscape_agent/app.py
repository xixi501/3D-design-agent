import asyncio
import contextlib
import json
import os
from contextlib import asynccontextmanager
from importlib.metadata import version
from pathlib import Path

import httpx
from fastapi import FastAPI, Header, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from .config import model_settings, state_directory
from .manager import TaskManager
from .schemas import ResumeInput, TaskInput
from .skill_registry import FLOORPLAN_TOOLS, GENERATION_TOOLS, load_design_skill, skill_record
from .store import TERMINAL, TaskError
from .versions import runtime_versions


class FloorplanConfirmInput(BaseModel):
    requestId: str = Field(min_length=1, max_length=200)
    draftId: str = Field(min_length=1, max_length=200)
    draftRevision: int = Field(ge=0)
    draftHash: str = Field(pattern=r"^[a-f0-9]{64}$")


class ConversationInput(BaseModel):
    projectId: str = Field(min_length=1, max_length=200)


def create_app(directory: Path | None = None, manager_factory=TaskManager):
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        manager = manager_factory(directory or state_directory())
        app.state.manager = manager
        await manager.start()
        try:
            yield
        finally:
            await manager.close()

    app = FastAPI(title="ActiScape local-edit agents", version="0.2.0", lifespan=lifespan)

    @app.exception_handler(TaskError)
    async def task_error(_request: Request, error: TaskError):
        return JSONResponse(
            status_code=error.status,
            content={
                "error": error.code,
                "message": str(error),
                **({"details": error.details} if error.details else {}),
            },
        )

    def manager():
        return app.state.manager

    @app.get("/skills")
    async def skills():
        snapshot = load_design_skill(GENERATION_TOOLS)
        other = load_design_skill(FLOORPLAN_TOOLS, skill_id="floorplan-reconstruction")
        return {
            "items": [
                {
                    **skill_record(other),
                    "description": other["description"],
                    "appliesTo": other["appliesTo"],
                    "requiredTools": other["requiredTools"],
                },
                {
                    **skill_record(snapshot),
                    "description": snapshot["description"],
                    "appliesTo": snapshot["appliesTo"],
                    "requiredTools": snapshot["requiredTools"],
                },
            ]
        }

    @app.get("/health")
    async def health():
        return {
            "ok": True,
            "service": "ActiScape agents",
            "modelConfigured": bool(os.environ.get("DEEPSEEK_API_KEY")),
            "model": model_settings()["model"],
            "langgraph": version("langgraph"),
            "langchain": version("langchain"),
            "versions": runtime_versions(),
        }

    @app.get("/conversations")
    async def conversations(projectId: str):
        return manager().store.conversations(projectId)

    @app.post("/conversations", status_code=201)
    async def create_conversation(body: ConversationInput):
        from .client import SceneFailure

        try:
            await manager().client.request(f"/projects/{body.projectId}")
        except SceneFailure as e:
            raise TaskError(e.code, str(e), e.status) from None
        return manager().store.create_conversation(body.projectId)

    @app.get("/conversations/{id}")
    async def conversation(id: str):
        return manager().store.conversation(id)

    @app.get("/conversations/{id}/tasks")
    async def conversation_tasks(id: str):
        return manager().store.tasks(id)

    @app.post("/conversations/{id}/tasks", status_code=202)
    async def create_task(id: str, body: TaskInput):
        task = manager().store.create_task(id, body.model_dump())
        manager().enqueue(task["id"])
        return task

    async def reconcile(id: str):
        from .client import SceneFailure

        with contextlib.suppress(SceneFailure, TaskError, httpx.HTTPError):
            await manager().reconcile_floorplan_confirmation(id)

    @app.get("/tasks/{id}")
    async def task(id: str):
        await reconcile(id)
        return manager().store.task(id)

    @app.get("/tasks/{id}/trace")
    async def trace(id: str, after: int = 0):
        return manager().store.events(id, max(0, after))

    @app.post("/tasks/{id}/confirm-floorplan", status_code=202)
    async def confirm_floorplan(id: str, body: FloorplanConfirmInput):
        return await manager().confirm_floorplan(id, body.model_dump())

    @app.post("/tasks/{id}/recheck-floorplan")
    async def recheck_floorplan(id: str, body: FloorplanConfirmInput):
        return await manager().recheck_floorplan(id, body.model_dump())

    @app.post("/tasks/{id}/resume", status_code=202)
    async def resume(id: str, body: ResumeInput):
        task = manager().store.resume(id, body.model_dump())
        manager().enqueue(id)
        return task

    @app.post("/tasks/{id}/cancel")
    async def cancel(id: str):
        return manager().store.cancel(id)

    @app.get("/tasks/{id}/events")
    async def events(
        id: str, request: Request, after: int = 0, last_event_id: str | None = Header(default=None)
    ):
        manager().store.task(id)
        try:
            cursor = max(0, after, int(last_event_id or "0"))
        except ValueError:
            raise TaskError("INVALID_CURSOR", "事件游标无效") from None

        async def stream():
            nonlocal cursor
            while not await request.is_disconnected():
                await reconcile(id)
                for event in manager().store.events(id, cursor):
                    cursor = event["seq"]
                    yield f"id: {cursor}\nevent: progress\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
                task = manager().store.task(id)
                yield f"event: snapshot\ndata: {json.dumps(task, ensure_ascii=False)}\n\n"
                if task["status"] in TERMINAL:
                    break
                await asyncio.sleep(1)

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"cache-control": "no-cache", "x-accel-buffering": "no"},
        )

    return app


app = create_app()
