"""Handler for 2D floorplan reconstruction tasks (V3 / V4 / V4.2)."""

from __future__ import annotations

from typing import Any

from ..role_contracts import (
    RepairBudgetState,
    ReviewIssueV1,
    build_repair_request,
)
from ..skill_registry import get_registry
from .base import LayoutTaskHandler


class FloorplanTaskHandler(LayoutTaskHandler):
    async def ground(self, wf, state: dict[str, Any], task: dict[str, Any]) -> dict:
        from .. import workflow as wf_mod

        return await wf_mod.FloorplanFlow(wf.store, wf.client, wf.roles).ground(
            state, task
        )

    async def assets(self, wf, state: dict[str, Any], task: dict[str, Any]) -> dict:
        from .. import workflow as wf_mod

        return {
            "assets": await wf_mod.FloorplanRoles(wf.roles).assets(
                task, state["intent"], state.get("last_report")
            )
        }

    async def scope(self, wf, state: dict[str, Any], task: dict[str, Any]) -> dict:
        from .. import workflow as wf_mod

        return await wf_mod.FloorplanFlow(wf.store, wf.client, wf.roles).scope(
            state, task
        )

    async def design(self, wf, state: dict[str, Any], task: dict[str, Any]) -> dict:
        from .. import workflow as wf_mod

        return {
            "proposal": await wf_mod.FloorplanRoles(wf.roles).design(
                task,
                state["project"],
                state["scope"],
                state.get("last_report"),
                state.get("repairs", 0),
            )
        }

    async def create_candidate(
        self, wf, state: dict[str, Any], task: dict[str, Any]
    ) -> dict:
        from .. import workflow as wf_mod

        return await wf_mod.FloorplanRoles(wf.roles).candidate(
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

        return await wf_mod.FloorplanRoles(wf.roles).inspect(
            task, state["candidate"], state["evidence"]
        )

    def exhausted_repair(
        self, wf, state: dict[str, Any], task: dict[str, Any]
    ) -> dict:
        return {
            "route": "end",
            "final": {
                "status": "waiting_input",
                "phase": "reviewing_floorplan",
                "draftId": wf.store.task(state["task_id"])["generation"].get("draftId"),
                "message": "原图布局在三轮检查修复后仍有冲突，请明确校正草稿后重新确认；正式项目未改变。",
                "candidateId": (state.get("candidate") or {}).get("id"),
                "report": state.get("last_report"),
            },
        }

    def route_repair(
        self, wf, state: dict[str, Any], task: dict[str, Any], count: int
    ) -> dict:
        generation = task.get("generation", {})
        if generation.get("floorplanVersion") == "s2c-floorplan-v4-2":
            raw_issues = (
                (state.get("last_report") or {})
                .get("visualReview", {})
                .get("issues")
                or []
            )
            issues = [
                ReviewIssueV1(
                    code=str(item.get("code") or "OTHER"),
                    source=item.get("source") or "model",
                    severity=item.get("severity") or "blocking",
                    objectIds=list(item.get("object_ids") or item.get("objectIds") or []),
                    evidenceRefs=list(item.get("evidenceRefs") or []),
                    message=str(
                        item.get("description") or item.get("message") or item.get("code")
                    ),
                    bbox=item.get("bbox"),
                )
                for item in raw_issues
                if isinstance(item, dict)
            ]
            draft_hash = (
                (state.get("candidate") or {})
                .get("floorplan", {})
                .get("binding", {})
                .get("draftHash")
                or generation.get("sceneDraftHash")
                or ""
            )
            if issues and len(draft_hash) != 64:
                return {
                    "route": "end",
                    "final": {
                        "status": "waiting_input",
                        "phase": "reviewing_floorplan",
                        "draftId": generation.get("draftId"),
                        "candidateId": (state.get("candidate") or {}).get("id"),
                        "message": "检查问题未绑定当前草稿哈希，不能回溯或提交。",
                        "report": state.get("last_report"),
                    },
                }
            budget = RepairBudgetState.model_validate(
                generation.get("repairBudget") or {}
            )
            request, next_budget, codes = build_repair_request(
                task_id=task["id"],
                source_stage="check",
                draft_hash=draft_hash,
                issues=issues,
                budget=budget,
            )
            generation["repairBudget"] = next_budget.model_dump()
            if request is not None:
                generation["repairRequests"] = [
                    *generation.get("repairRequests", []),
                    request.model_dump(),
                ]
                wf.store.update(task["id"], generation=generation)
                wf.store.event(
                    task["id"],
                    "repair_routed",
                    {**request.model_dump(), "issueCodes": codes},
                )
                if request.targetRole in ("assets", "design"):
                    return {
                        "repairs": count + 1,
                        "route": request.targetRole,
                    }
                return {
                    "route": "end",
                    "final": {
                        "status": "waiting_input",
                        "phase": "reviewing_floorplan",
                        "draftId": generation.get("draftId"),
                        "candidateId": (state.get("candidate") or {}).get("id"),
                        "message": (
                            f"检查问题需要由 {request.targetRole} 角色处理，"
                            "当前候选不会循环重放或自动提交。"
                        ),
                        "repairRequest": request.model_dump(),
                        "report": state.get("last_report"),
                    },
                }
            if codes:
                wf.store.update(task["id"], generation=generation)
                wf.store.event(
                    task["id"],
                    "repair_stopped",
                    {"codes": codes, "report": state.get("last_report")},
                )
                return {
                    "route": "end",
                    "final": {
                        "status": "waiting_input",
                        "phase": "reviewing_floorplan",
                        "draftId": generation.get("draftId"),
                        "candidateId": (state.get("candidate") or {}).get("id"),
                        "message": "检查问题缺少可验证证据或修复预算已耗尽；正式项目未改变。",
                        "report": state.get("last_report"),
                    },
                }

        if generation.get("skillBundle") and not generation["skillBundle"].get("repair"):
            registry = get_registry()
            bundle = registry.with_repair(generation["skillBundle"], task["mode"])
            generation.update(
                skillBundle=bundle,
                skillsUsed=registry.records(bundle),
            )
            wf.store.update(task["id"], generation=generation)
            wf.store.event(
                task["id"],
                "skill_repair_loaded",
                {
                    "id": bundle["repair"]["id"],
                    "contentHash": bundle["repair"]["contentHash"],
                    "bundleHash": bundle["contentHash"],
                },
            )
            task = wf.store.task(state["task_id"], internal=True)
            generation = task["generation"]

        generation["repairsUsed"] = count + 1
        wf.store.update(task["id"], generation=generation)
        return {"repairs": count + 1, "route": "assets"}
