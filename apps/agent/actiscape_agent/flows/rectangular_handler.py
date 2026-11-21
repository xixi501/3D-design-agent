"""Handler for natural-language rectangular room generation tasks."""

from __future__ import annotations

from typing import Any

from ..client import SceneFailure
from ..policy import RepairPolicyRouter
from ..store import TaskError
from .base import LayoutTaskHandler


class RectangularTaskHandler(LayoutTaskHandler):
    async def ground(self, wf, state: dict[str, Any], task: dict[str, Any]) -> dict:
        from .. import workflow as wf_mod

        try:
            return await wf_mod.GenerationFlow(wf.store, wf.client, wf.roles).ground(
                state, task
            )
        except SceneFailure as e:
            if e.code == "REVISION_CONFLICT":
                return wf.conflict(state)
            raise

    async def assets(self, wf, state: dict[str, Any], task: dict[str, Any]) -> dict:
        from .. import workflow as wf_mod

        return {
            "assets": await wf_mod.GenerationRoles(wf.roles).assets(
                task, state["intent"]
            )
        }

    async def scope(self, wf, state: dict[str, Any], task: dict[str, Any]) -> dict:
        from .. import workflow as wf_mod

        task_generation = wf.store.task(task["id"], internal=True).get("generation") or {}
        authorization_version = int(task_generation.get("authorizationVersion", 1))
        if task_generation.get("authorizationScope") and (
            task_generation.get("authorizationScopeVersion") == authorization_version
            or state.get("version_retries", 0)
        ):
            scope = task_generation["authorizationScope"]
        else:
            catalogue = (await wf.client.request("/catalog"))["items"]
            try:
                scope = wf_mod.compile_scope(
                    state["project"],
                    state["intent"],
                    state["assets"],
                    catalogue,
                    task_mode=task.get("mode"),
                    task=task,
                )
            except TaskError as e:
                return {
                    "route": "end",
                    "final": {
                        "status": "waiting_input" if e.code == "NEEDS_INPUT" else "failed",
                        "message": str(e),
                    },
                }
        wf.store.event(state["task_id"], "scope", scope)
        try:
            authorization = await wf_mod.authorize_edit(
                wf.store,
                wf.client,
                task,
                state["project"],
                scope,
                state["intent"],
                kind="initialize",
                brief=task_generation.get("frozenBrief") or task_generation.get("brief"),
            )
        except SceneFailure as error:
            if error.code == "REVISION_CONFLICT":
                return wf.conflict(state)
            raise
        return {"scope": scope, "authorization": authorization, "route": "design"}

    async def design(self, wf, state: dict[str, Any], task: dict[str, Any]) -> dict:
        from .. import workflow as wf_mod

        return {
            "proposal": await wf_mod.GenerationRoles(wf.roles).design(
                task,
                state["layout_project"],
                state["scope"],
                state.get("last_report"),
                state.get("repairs", 0),
            )
        }

    async def create_candidate(
        self, wf, state: dict[str, Any], task: dict[str, Any]
    ) -> dict:
        from .. import workflow as wf_mod

        return await wf_mod.GenerationRoles(wf.roles).candidate(
            task,
            state["project"],
            state["scope"],
            state["proposal"],
            state.get("repairs", 0),
            state.get("authorization"),
        )

    async def inspect_visual(
        self, wf, state: dict[str, Any], task: dict[str, Any]
    ) -> dict:
        from .. import workflow as wf_mod

        return await wf_mod.GenerationRoles(wf.roles).inspect(
            task, state["candidate"], state["evidence"]
        )

    def exhausted_repair(
        self, wf, state: dict[str, Any], task: dict[str, Any]
    ) -> dict:
        report = state.get("last_report") or {}
        issues = report.get("issues") or (report.get("codeChecks") or {}).get(
            "issues", []
        )
        blocking = [issue["message"] for issue in issues if issue.get("blocking")]
        detail = "；".join(blocking[:3])
        return {
            "route": "end",
            "final": {
                "status": "waiting_input",
                "message": (
                    "在固定尺寸与家具要求下，初稿后三轮修复仍未得到通过检查的布局。"
                    + (f"尚未解决：{detail}。" if detail else "")
                    + "请调整家具清单或房间净尺寸后继续；正式项目未改变。"
                ),
                "candidateId": (state.get("candidate") or {}).get("id"),
                "report": state.get("last_report"),
            },
        }

    def route_repair(
        self, wf, state: dict[str, Any], task: dict[str, Any], count: int
    ) -> dict:
        generation = task.get("generation", {})
        directive = RepairPolicyRouter().route(state.get("last_report"))
        if directive is not None:
            generation["repairDirective"] = directive.model_dump()
            wf.store.update(task["id"], generation=generation)
            wf.store.event(task["id"], "repair_routed", directive.model_dump())
            if directive.targetRole == "coordinator" or directive.action == "stop":
                return {
                    "route": "end",
                    "final": {
                        "status": "waiting_input",
                        "message": f"检查问题需要人工确认：{directive.message}；正式项目未改变。",
                        "candidateId": (state.get("candidate") or {}).get("id"),
                        "report": state.get("last_report"),
                        "repairDirective": directive.model_dump(),
                    },
                }
            return {
                "repairs": count + 1,
                "route": directive.targetRole,
                "repairDirective": directive.model_dump(),
            }
        return {"repairs": count + 1, "route": "design"}
