import asyncio
import contextlib
from pathlib import Path

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from .client import SceneClient, SceneFailure
from .roles import Roles
from .store import TaskError, TaskStore, fingerprint
from .workflow import Workflow, completion_result, conversation_focus


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
                input_hash = fingerprint({"input": task["input"], "selected": task["selectedIds"]})
                if task.get("mode") == "generate_rectangular":
                    input_hash = fingerprint(
                        {
                            "input": task["input"],
                            "selected": task["selectedIds"],
                            "mode": task["mode"],
                        }
                    )
                fresh = not previous.values or previous.values.get("input_hash") != input_hash
                if fresh:
                    state = {
                        "task_id": id,
                        "input_hash": input_hash,
                        "repairs": 0,
                        "version_retries": 0,
                        "candidate": None,
                        "review": None,
                        "evidence": [],
                        "last_report": None,
                        "final": None,
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
            except Exception as error:
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
                    except Exception:
                        pass
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
                message = (
                    str(error)
                    if isinstance(error, (TaskError, SceneFailure))
                    else "任务达到时间上限"
                    if isinstance(error, TimeoutError)
                    else f"任务未完成（{type(error).__name__}）"
                )
                status = "cancelled" if code == "CANCELLED" else "failed"
                self.store.update(
                    id,
                    status=status,
                    error=message,
                    result={"status": status, "message": message, "errorCode": code},
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
