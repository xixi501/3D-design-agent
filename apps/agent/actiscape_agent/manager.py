import asyncio
import contextlib
import traceback
from pathlib import Path

import httpx
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from .client import SceneClient, SceneFailure
from .edit_results import completion_result, conversation_focus
from .roles import Roles
from .store import TaskError, TaskStore, fingerprint
from .workflow import Workflow


class TaskManager:
    def __init__(self, directory: Path, client: SceneClient | None = None, roles_factory=Roles):
        self.directory = directory
        self.store = TaskStore(directory)
        self.client = client or SceneClient()
        self.roles = roles_factory(self.store, self.client)
        self.queue = asyncio.Queue()
        self.queued = set()
        self.worker = None
        self.graph = None
        self.checkpoint_context = None
        self.delayed = set()

    async def start(self):
        self.checkpoint_context = AsyncSqliteSaver.from_conn_string(
            str(self.directory / "checkpoints.sqlite")
        )
        saver = await self.checkpoint_context.__aenter__()
        self.graph = Workflow(self.store, self.client, self.roles).compile(saver)
        self.worker = asyncio.create_task(self.work())
        for id in self.store.recoverable():
            self.enqueue(id)
        for row in self.store.db.execute(
            "SELECT id FROM tasks WHERE mode='reconstruct_floorplan' AND status='waiting_input'"
        ).fetchall():
            with contextlib.suppress(SceneFailure, TaskError, httpx.HTTPError):
                await self.reconcile_floorplan_confirmation(row["id"])

    async def resume(self, id, body):
        task = self.store.resume(id, body)
        # The new user requirement invalidates old candidate references even
        # while grounding/clarification has not produced a replacement yet.
        if task["mode"] in ("edit", "repair_layout", "interactive_action", "photo_to_scene"):
            await self.client.request(
                f"/projects/{task['projectId']}/edit-authorizations/invalidate",
                {"taskId": id, "version": task["generation"]["authorizationVersion"]},
            )
        self.enqueue(id)
        return task

    async def confirm_floorplan(self, id: str, body: dict):
        task = self.store.task(id, internal=True)
        if task["mode"] != "reconstruct_floorplan" or task["cancelRequested"]:
            raise TaskError("INVALID_STATE", "此任务不能确认户型", 409)
        g = dict(task["generation"])
        if g.get("draftId") != body["draftId"]:
            raise TaskError("DRAFT_CONFLICT", "草稿不属于此任务", 409)
        previous = g.get("confirmation")
        if task["status"] not in ("waiting_input", "failed", "conflict"):
            if previous == body:
                return self.store.task(id)
            raise TaskError("INVALID_STATE", "当前任务不能重新确认", 409)
        if task["modelCalls"] >= 24 or task["elapsedSeconds"] >= 600:
            raise TaskError("BUDGET_EXHAUSTED", "本任务预算已耗尽，请新建任务", 409)
        record = await self.client.request(
            f"/projects/{task['projectId']}/floorplan-drafts/{body['draftId']}/confirm",
            {k: v for k, v in body.items() if k != "draftId"},
        )
        current = self.store.task(id, internal=True)
        if current["cancelRequested"] or current["status"] == "cancelled":
            raise TaskError("CANCELLED", "任务已取消，未提交场景", 409)
        if current["status"] not in ("waiting_input", "failed", "conflict"):
            if current["generation"].get("confirmation") == body:
                return self.store.task(id)
            raise TaskError("INVALID_STATE", "任务已经恢复，请读取当前进度", 409)
        g = dict(current["generation"])
        g.update(confirmation=body, floorplan=record)
        self.store.update(id, generation=g)
        resumed = self.store.resume(
            id, {"requestId": body["requestId"], "input": "", "selectedIds": []}
        )
        self.enqueue(id)
        self.store.event(
            id,
            "floorplan_confirmed",
            {
                "draftId": record["id"],
                "draftRevision": record["revision"],
                "draftHash": record["hash"],
            },
        )
        return resumed

    async def reconcile_floorplan_confirmation(self, id: str):
        task = self.store.task(id, internal=True)
        if (
            task["mode"] != "reconstruct_floorplan"
            or task["status"] != "waiting_input"
            or not task["generation"].get("draftId")
        ):
            return
        project = await self.client.request(f"/projects/{task['projectId']}")
        if self.store.task(id)["status"] != "waiting_input":
            return
        if any(
            project["plan"].get(k)
            for k in (
                "nodes",
                "walls",
                "openings",
                "furniture",
                "rooms",
                "structs",
                "beams",
                "measures",
                "elec",
                "voids",
                "comments",
            )
        ) or project.get("roomLabelArchive"):
            result = {
                "status": "failed",
                "errorCode": "PROJECT_NOT_EMPTY",
                "message": "手工编辑使项目非空，户型初始化已停止；现有场景没有被覆盖。",
            }
            self.store.update(id, status="failed", result=result, error=result["message"])
            self.store.event(id, "status", result)
            return
        d = await self.client.request(
            f"/projects/{task['projectId']}/floorplan-drafts/{task['generation']['draftId']}"
        )
        c = d.get("confirmed")
        applied = (
            self.store.db.execute(
                "SELECT 1 FROM actions WHERE task_id=? AND request_id=?", (id, c["requestId"])
            ).fetchone()
            if c
            else None
        )
        if c and not applied and c["revision"] == d["revision"] and c["hash"] == d["hash"]:
            await self.confirm_floorplan(
                id,
                {
                    "requestId": c["requestId"],
                    "draftId": d["id"],
                    "draftRevision": d["revision"],
                    "draftHash": d["hash"],
                },
            )

    async def recheck_floorplan(self, id: str, body: dict):
        from .floorplan_v3 import FloorplanV3

        task = self.store.task(id, internal=True)
        if task["mode"] != "reconstruct_floorplan":
            raise TaskError("INVALID_STATE", "此任务不是户型图任务", 409)
        if task["status"] != "waiting_input":
            raise TaskError("INVALID_STATE", "只有等待确认的草稿可以重新审核", 409)
        generation = task["generation"]
        if generation.get("draftId") != body["draftId"]:
            raise TaskError("DRAFT_CONFLICT", "草稿不属于此任务", 409)
        if task["modelCalls"] >= 24 or task["elapsedSeconds"] >= 600:
            raise TaskError("BUDGET_EXHAUSTED", "本任务预算已耗尽，请新建任务", 409)
        if not self.store.claim_action(id, body):
            return self.store.task(id)

        previous_result = task["result"]
        self.store.start(id)
        try:
            draft = await self.client.request(
                f"/projects/{task['projectId']}/floorplan-drafts/{body['draftId']}"
            )
            if draft["revision"] != body["draftRevision"] or draft["hash"] != body["draftHash"]:
                raise TaskError("DRAFT_CONFLICT", "审核草稿版本或哈希已失效", 409)
            image = await self.client.request(f"/floorplan-images/{generation['imageId']}")
            diagnostics = await self.client.request(
                f"/projects/{task['projectId']}/floorplan-drafts/{body['draftId']}/diagnostics",
                {},
            )
            reviewer = FloorplanV3(self.store, self.client, self.roles)
            review = await reviewer.review(
                self.store.task(id, internal=True),
                image,
                draft,
                diagnostics,
                "manual-recheck",
            )
            updated = await self.client.request(
                f"/projects/{task['projectId']}/floorplan-drafts/{body['draftId']}/review",
                {
                    "requestId": body["requestId"],
                    "draftRevision": body["draftRevision"],
                    "draftHash": body["draftHash"],
                    "review": review,
                    "evidenceRefs": [diagnostics["id"]],
                },
            )
            current = self.store.task(id, internal=True)
            current_generation = dict(current["generation"])
            current_generation.update(
                floorplan=updated,
                diagnostics=diagnostics,
                phase="reviewing_floorplan",
                manualRechecks=[
                    *current_generation.get("manualRechecks", []),
                    {
                        "draftId": body["draftId"],
                        "draftRevision": body["draftRevision"],
                        "draftHash": body["draftHash"],
                        "review": review,
                    },
                ],
            )
            result = {
                "status": "waiting_input",
                "phase": "reviewing_floorplan",
                "draftId": body["draftId"],
                "report": review,
                "message": "当前草稿原图审核通过，可以确认。"
                if review["passed"]
                else "当前草稿原图审核未通过，请继续修正后重新审核。",
            }
            self.store.update(
                id,
                status="waiting_input",
                generation=current_generation,
                result=result,
                error=None,
            )
            self.store.event(
                id,
                "floorplan_rechecked",
                {
                    "draftId": body["draftId"],
                    "draftRevision": body["draftRevision"],
                    "draftHash": body["draftHash"],
                    "passed": review["passed"],
                },
            )
            return self.store.task(id)
        except BaseException as error:
            self.store.update(
                id,
                status="waiting_input",
                result=previous_result,
                error=str(error),
            )
            raise
        finally:
            self.store.pause_clock(id)

    async def close(self):
        for task in self.delayed:
            task.cancel()
        if self.worker:
            self.worker.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.worker
        if self.checkpoint_context:
            await self.checkpoint_context.__aexit__(None, None, None)
        self.store.close()

    def retry_later(self, id: str):
        async def retry():
            await asyncio.sleep(3)
            self.enqueue(id)

        task = asyncio.create_task(retry())
        self.delayed.add(task)
        task.add_done_callback(self.delayed.discard)

    async def reconcile_commit(self, id: str, config: dict):
        saved = await self.graph.aget_state(config)
        state = saved.values
        c = state.get("candidate")
        if not c:
            return None
        task = self.store.task(id, internal=True)
        path = f"/projects/{task['projectId']}/candidates/{c['id']}"
        current = await self.client.request(path)
        if current.get("committed") is None:
            response = await self.client.request(
                path + "/commit",
                {
                    "operationId": c["operationId"],
                    "baseRevision": c["baseRevision"],
                    "candidateHash": c["hash"],
                },
            )
            revision = response["project"]["revision"]
        else:
            revision = current["committed"]
        task = self.store.task(id, internal=True)
        result = completion_result(task, state, c, revision)
        self.store.focus(task["conversationId"], conversation_focus(c))
        self.store.event(id, "commit_reconciled", {"candidateId": c["id"], "revision": revision})
        return result

    def enqueue(self, id: str):
        if id not in self.queued:
            self.queued.add(id)
            self.queue.put_nowait(id)

    async def work(self):
        while True:
            id = await self.queue.get()
            try:
                task = self.store.task(id)
                if task["status"] not in ("queued", "running", "committing"):
                    continue
                self.store.start(id)
                config = {"configurable": {"thread_id": id}, "recursion_limit": 100}
                if task["status"] == "committing":
                    final = await self.reconcile_commit(id, config)
                    if final:
                        self.store.update(id, status="completed", result=final, error=None)
                        self.store.event(
                            id, "status", {"status": "completed", "message": final["message"]}
                        )
                        continue
                previous = await self.graph.aget_state(config)
                input_hash = fingerprint(
                    {
                        "input": task["input"],
                        "selected": task["selectedIds"],
                        "resumeNonce": task["generation"].get("resumeNonce"),
                    }
                )
                if task.get("mode") in ("generate_rectangular", "reconstruct_floorplan"):
                    input_hash = fingerprint(
                        {
                            "input": task["input"],
                            "selected": task["selectedIds"],
                            "mode": task["mode"],
                            **(
                                {
                                    "resumeNonce": task["generation"].get("resumeNonce"),
                                    "imageId": task["generation"].get("imageId"),
                                }
                                if task["mode"] == "reconstruct_floorplan"
                                else {}
                            ),
                        }
                    )
                fresh = not previous.values or previous.values.get("input_hash") != input_hash
                if fresh:
                    state = {
                        "task_id": id,
                        "input_hash": input_hash,
                        "repairs": task["generation"].get("repairsUsed", 0)
                        if task.get("mode") == "reconstruct_floorplan"
                        else 0,
                        "version_retries": 0,
                        "candidate": None,
                        "review": None,
                        "evidence": [],
                        "last_report": None,
                        "final": None,
                        "authorization": None,
                        "intent": {},
                        "scope": {},
                        "assets": {},
                        "proposal": {},
                    }
                    result = await asyncio.wait_for(
                        self.graph.ainvoke(state, config),
                        timeout=max(0.1, 600 - self.store.task(id)["elapsedSeconds"]),
                    )
                elif previous.next:
                    self.store.event(
                        id, "recovering", {"message": "从已持久化检查点继续；提交使用固定操作身份"}
                    )
                    result = await asyncio.wait_for(
                        self.graph.ainvoke(None, config),
                        timeout=max(0.1, 600 - self.store.task(id)["elapsedSeconds"]),
                    )
                else:
                    result = previous.values
                final = result.get("final")
                if not final:
                    raise TaskError("TASK_INCOMPLETE", "流程结束但没有可验证结果")
                self.store.update(
                    id,
                    status=final["status"],
                    result=final,
                    error=None if final["status"] == "completed" else final["message"],
                )
                self.store.event(
                    id, "status", {"status": final["status"], "message": final["message"]}
                )
            except asyncio.CancelledError:
                self.store.event(
                    id, "interrupted", {"message": "服务关闭，任务检查点保留，重启后恢复"}
                )
                raise
            except Exception as error:  # noqa: BLE001 -- task boundary persists all failures
                if self.store.task(id)["status"] == "committing":
                    try:
                        reconciled = await self.reconcile_commit(id, config)
                        if reconciled:
                            self.store.update(id, status="completed", result=reconciled, error=None)
                            self.store.event(
                                id,
                                "status",
                                {"status": "completed", "message": reconciled["message"]},
                            )
                            continue
                    except SceneFailure as commit_error:
                        if commit_error.code == "REVISION_CONFLICT":
                            self.store.update(
                                id,
                                status="conflict",
                                error="恢复确认时版本已变化，候选未提交",
                                result={
                                    "status": "conflict",
                                    "message": "恢复确认时版本已变化，候选未提交",
                                },
                            )
                            self.store.event(
                                id, "status", {"status": "conflict", "message": "候选未提交"}
                            )
                            continue
                        if commit_error.status < 500:
                            self.store.update(
                                id,
                                status="failed",
                                error=str(commit_error),
                                result={"status": "failed", "message": str(commit_error)},
                            )
                            self.store.event(
                                id, "status", {"status": "failed", "message": str(commit_error)}
                            )
                            continue
                    except Exception as reconcile_error:  # noqa: BLE001 -- keep uncertain commits recoverable
                        self.store.event(
                            id,
                            "commit_confirmation_error",
                            {"type": type(reconcile_error).__name__},
                        )
                    self.store.update(id, error="正在确认原子提交结果，恢复时复用原操作身份")
                    self.store.event(
                        id, "confirming_commit", {"message": "提交结果待确认，不会重复新增"}
                    )
                    self.retry_later(id)
                    continue
                code = (
                    error.code
                    if isinstance(error, (TaskError, SceneFailure))
                    else "BUDGET_EXHAUSTED"
                    if isinstance(error, TimeoutError)
                    else "TASK_ERROR"
                )
                if code == "TASK_ERROR":
                    traceback.print_exc()
                message = (
                    str(error)
                    if isinstance(error, (TaskError, SceneFailure))
                    else "任务达到时间上限"
                    if isinstance(error, TimeoutError)
                    else f"任务未完成（{type(error).__name__}）"
                )
                status = "cancelled" if code == "CANCELLED" else "failed"
                result = {"status": status, "message": message, "errorCode": code}
                current = self.store.task(id)
                if (
                    current.get("mode") in ("generate_rectangular", "reconstruct_floorplan")
                    and status == "failed"
                ):
                    generation = current.get("generation", {})
                    if generation.get("lastCandidateId"):
                        result.update(
                            candidateId=generation["lastCandidateId"],
                            report=generation.get("lastChecks"),
                            generation=generation,
                        )
                        blocking = [
                            i["message"]
                            for i in (generation.get("lastChecks") or {}).get("issues", [])
                            if i.get("blocking")
                        ]
                        if blocking:
                            message += (
                                "。尚未解决："
                                + "；".join(blocking[:3])
                                + "。本任务没有提交，请调整家具清单或尺寸后重新提交需求。"
                            )
                            result["message"] = message
                self.store.update(
                    id,
                    status=status,
                    error=message,
                    result=result,
                )
                self.store.event(
                    id, "status", {"status": status, "message": message, "errorCode": code}
                )
            finally:
                self.store.pause_clock(id)
                self.queued.discard(id)
                self.queue.task_done()
                if self.store.task(id)["status"] == "queued":
                    self.enqueue(id)
