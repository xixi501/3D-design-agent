import asyncio
import contextlib
import json
import os
from contextlib import asynccontextmanager
from importlib.metadata import version
from pathlib import Path

import httpx
from fastapi import FastAPI, Header, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from .capability_registry import capability_document
from .config import model_settings, state_directory
from .floorplan_vision import get_provider_registry
from .manager import TaskManager
from .schemas import ResumeInput, TaskInput
from .skill_registry import get_registry
from .store import TERMINAL, TaskError
from .versions import runtime_versions
from .vision_client import vision_service_status


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

    app = FastAPI(title="ActiScape local-edit agents", version="0.3.0", lifespan=lifespan)

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
    async def skills(
        mode: str | None = None,
        roomKind: str | None = None,
        area: float | None = Query(default=None, ge=0),
        kind: str | None = None,
        status: str | None = None,
        activation: str | None = Query(default="active"),
    ):
        registry = get_registry()
        items = []
        for snapshot in registry.all():
            applies = snapshot["appliesTo"]
            if mode and mode not in applies["modes"]:
                continue
            if (
                roomKind
                and "any" not in applies["roomKinds"]
                and roomKind not in applies["roomKinds"]
            ):
                continue
            if area is not None and not (applies["areaM2"][0] <= area <= applies["areaM2"][1]):
                continue
            if kind and snapshot["kind"] != kind:
                continue
            if status and snapshot["status"] != status:
                continue
            if activation and activation != "all" and snapshot["activation"] != activation:
                continue
            items.append(registry.public_record(snapshot))
        return {
            "pool": registry.pool_summary(),
            "items": items,
        }

    @app.get("/vision/providers")
    async def vision_providers(status: str = "all"):
        return {
            "schemaVersion": "actiscape.vision-provider-list.v1",
            "items": get_provider_registry().public_records(status=status),
        }

    @app.get("/capabilities")
    async def capabilities():
        return capability_document()

    @app.get("/skills/{skill_id}")
    async def skill(skill_id: str):
        return get_registry().public_record(get_registry().load(skill_id))

    @app.get("/health")
    async def health():
        vision = await vision_service_status()
        return {
            "ok": True,
            "service": "ActiScape agents",
            "modelConfigured": bool(os.environ.get("DEEPSEEK_API_KEY")),
            "visionConfigured": vision["configured"],
            "visionAvailable": vision["available"],
            "visionModel": vision["model"],
            "visionBaseUrl": vision["baseUrl"],
            "model": model_settings()["model"],
            "langgraph": version("langgraph"),
            "langchain": version("langchain"),
            "skillPool": get_registry().pool_summary(),
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
