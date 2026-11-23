"""Handler for local furniture edits, layout repairs, and post-action checks."""

from __future__ import annotations

from typing import Any

from ..client import SceneFailure
from ..exact_edits import exact_proposal, no_change, parse_exact
from ..policy import RepairPolicyRouter
from ..scene_projection import ensure_edit_scene_draft, sync_edit_scene_program
from ..skill_registry import get_registry
from ..store import TaskError
from ..memory_profile import recall_and_update_household_memory
from ..procurement_client import generate_procurement_quote
from ..rag_standards import retrieve_standard_citations
from ..sandbox_solver import solve_safe_placements
from ..telemetry import trace_stage
from .base import LayoutTaskHandler


class EditTaskHandler(LayoutTaskHandler):
    async def ground(self, wf, state: dict[str, Any], task: dict[str, Any]) -> dict:
        from .. import workflow as wf_mod

        conversation = wf.store.conversation(task["conversationId"])
        history = [
            {
                "user": t["input"],
                "assistant": (t["result"] or {}).get("message", t["error"]),
            }
            for t in wf.store.tasks(task["conversationId"])
            if t["id"] != task["id"] and t["status"] == "completed"
        ][-6:]
        registry = get_registry()
        skill_candidates = registry.candidates("edit", project_state="existing")
        intent = (
            parse_exact(task, state["project"], conversation)
            if task.get("mode") == "edit"
            else None
        )
        if intent and intent.get("noChange"):
            return {"route": "end", "final": no_change(state["project"], intent["summary"])}
        if state.get("version_retries", 0) and state.get("intent"):
            intent = state["intent"]
        if intent is None and task.get("mode") == "repair_layout":
            furniture_list = (state["project"].get("plan") or {}).get("furniture") or []
            furniture_ids = {f["id"] for f in furniture_list}
            valid_selected = [
                tid for tid in (task.get("selectedIds") or []) if tid in furniture_ids
            ]
            if valid_selected:
                safety_active = bool(
                    ((state["project"].get("plan") or {}).get("source") or {})
                    .get("safetyProfile", {})
                    .get("enabled")
                )
                allowed_fields = ["x", "y", "rot"] + (["opt"] if safety_active else [])
                reference_ids = [
                    f["id"] for f in furniture_list if f["id"] not in valid_selected
                ][:20]
                intent = {
                    "status": "ready",
                    "summary": f"布局深度重排修复（授权目标 {len(valid_selected)} 件，结合房间功能分区与朝向重排）",
                    "question": "",
                    "target_ids": valid_selected,
                    "reference_ids": reference_ids,
                    "delete_ids": [],
                    "field_permissions": {tid: list(allowed_fields) for tid in valid_selected},
                    "additions": [],
                    "operations": [],
                    "area": "room",
                    "skillSelection": {
                        "primarySkillId": None,
                        "modifierSkillIds": [],
                        "reason": "结构化布局修复：跳过冗余识别，直达空间设计重排阶段",
                    },
                }
        if intent is None:
            intent = await wf.roles.ground(
                task, state["project"], conversation, history, skill_candidates
            )
        if intent["status"] == "ready":
            selection = registry.validate_selection(
                intent.get("skillSelection", {}),
                skill_candidates,
                mode="edit",
                allow_no_primary=True,
            )
            bundle = registry.compose(
                mode="edit",
                selection=selection,
                include_intake=False,
            )
            generation = wf.store.task(task["id"], internal=True)["generation"]
            generation.update(
                skillSelection=selection.model_dump(),
                skillBundle=bundle,
                skillsUsed=registry.records(bundle),
            )
            wf.store.update(task["id"], generation=generation)
            await ensure_edit_scene_draft(
                store=wf.store,
                client=wf.client,
                task=task,
                project=state["project"],
                intent=intent,
            )
            wf.store.event(
                task["id"],
                "skill_loaded",
                {
                    "selection": selection.model_dump(),
                    "skills": generation["skillsUsed"],
                    "bundleHash": bundle["contentHash"],
                },
            )
        ambiguous = wf_mod.ambiguous_name(task, state["project"], conversation)
        if intent["status"] == "ready" and ambiguous and intent["target_ids"]:
            return {
                "intent": intent,
                "route": "end",
                "final": {
                    "status": "waiting_input",
                    "message": f"场景中有多件“{ambiguous}”，请先选中要修改的那件，再补充说明。",
                },
            }
        if intent["status"] != "ready":
            return {
                "intent": intent,
                "route": "end",
                "final": {
                    "status": "waiting_input"
                    if intent["status"] == "clarify"
                    else "failed",
                    "message": intent.get("question") or intent["summary"],
                },
            }
        if not intent["target_ids"] and not intent["additions"]:
            return {
                "intent": intent,
                "route": "end",
                "final": {
                    "status": "waiting_input",
                    "message": "请指定要修改的家具或需要新增的物品",
                },
            }
        return {
            "intent": intent,
            "assets": {"choices": []},
            "route": "assets" if intent["additions"] else "scope",
        }

    async def assets(self, wf, state: dict[str, Any], task: dict[str, Any]) -> dict:
        return {"assets": await wf.roles.assets(task, state["intent"])}

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
                kind="edit",
                brief=None,
            )
        except SceneFailure as error:
            if error.code == "REVISION_CONFLICT":
                return wf.conflict(state)
            raise
        return {"scope": scope, "authorization": authorization, "route": "design"}

    async def design(self, wf, state: dict[str, Any], task: dict[str, Any]) -> dict:
        with trace_stage(
            "edit.design_proposal",
            {"task_id": task.get("id"), "repairs": state.get("repairs", 0)},
        ):
            if state.get("intent", {}).get("operations") and not state["intent"].get(
                "additions"
            ):
                return {"proposal": exact_proposal(state["project"], state["intent"])}
            if task.get("mode") == "repair_layout" and state.get("repairs", 0) == 0:
                scope = state.get("scope") or {}
                allowed_targets = set(scope.get("targetIds") or [])
                field_mask = scope.get("fieldMask") or {}
                if allowed_targets:
                    try:
                        safety_active = bool(
                            ((state["project"].get("plan") or {}).get("source") or {})
                            .get("safetyProfile", {})
                            .get("enabled")
                        )
                        allowed_rooms = scope.get("allowedRoomIds") or []
                        req_body: dict[str, Any] = {
                            "dryRun": True,
                            "targetIds": list(allowed_targets),
                            "includeSafety": safety_active,
                        }
                        if len(allowed_rooms) == 1:
                            req_body["roomId"] = allowed_rooms[0]
                        solved = await wf.client.request(
                            f"/projects/{task['projectId']}/auto-repair",
                            req_body,
                        )
                        if (
                            isinstance(solved, dict)
                            and solved.get("fixableAfter") == 0
                            and solved.get("commands")
                        ):
                            edits = []
                            for cmd in solved["commands"]:
                                if (
                                    cmd.get("type") != "update"
                                    or cmd.get("collection") != "furniture"
                                ):
                                    continue
                                cid = cmd.get("id")
                                if cid not in allowed_targets:
                                    continue
                                allowed_fields = set(field_mask.get(cid) or [])
                                values = {
                                    k: v
                                    for k, v in (cmd.get("patch") or {}).items()
                                    if k in allowed_fields
                                }
                                if values:
                                    edits.append({"type": "update", "id": cid, "values": values})
                            if edits:
                                return {
                                    "proposal": {
                                        "summary": str(
                                            solved.get("summary")
                                            or "语义布局求解器生成零冲突方案并交由视觉复核"
                                        )[:200],
                                        "edits": edits,
                                        "noChange": False,
                                    }
                                }
                    except Exception:
                        pass
            text = str(task.get("input") or "")
            safety_cues = any(
                kw in text for kw in ("适老", "轮椅", "无障碍", "防震", "抗震", "地震", "雷达", "看护")
            )
            last_issues = (state.get("last_report") or {}).get("issues") or []
            safety_codes = [
                str(i.get("code"))
                for i in last_issues
                if isinstance(i, dict)
                and str(i.get("code") or "")
                in {
                    "WHEELCHAIR_TURNING_BLOCKED",
                    "SEISMIC_TOPPLE_BED_HAZARD",
                    "SEISMIC_TOPPLE_EXIT_BLOCKED",
                    "SENSOR_BLIND_SPOT",
                }
            ]
            if safety_cues or safety_codes:
                household = await recall_and_update_household_memory(
                    text, scope_key=str(task.get("conversationId") or task.get("projectId") or "default")
                )
                solved = await solve_safe_placements(
                    state["project"]["plan"],
                    target_ids=list((state.get("scope") or {}).get("targetIds") or []),
                )
                citations = await retrieve_standard_citations(
                    safety_codes
                    or [
                        "WHEELCHAIR_TURNING_BLOCKED",
                        "SEISMIC_TOPPLE_BED_HAZARD",
                        "SENSOR_BLIND_SPOT",
                    ]
                )
                quote = await generate_procurement_quote(
                    str(task.get("projectId") or ""),
                    state["project"]["plan"],
                    issue_codes=safety_codes,
                )
                gen = dict(task.get("generation") or {})
                gen["householdMemory"] = household
                gen["sandboxSolver"] = solved
                gen["standardCitations"] = citations
                gen["procurementQuote"] = quote
                task["generation"] = gen
            proposal = await wf.roles.design(
                task,
                state["project"],
                state["intent"],
                state["scope"],
                state.get("last_report"),
                state.get("repairs", 0),
            )
            return {"proposal": proposal}

    async def create_candidate(
        self, wf, state: dict[str, Any], task: dict[str, Any]
    ) -> dict:
        from .. import workflow as wf_mod

        if task.get("mode") in ("edit", "repair_layout"):
            c = await wf_mod.submit_candidate(
                wf.client,
                task,
                state["project"],
                state["scope"],
                state["proposal"],
                state.get("repairs", 0),
                state.get("authorization"),
            )
        else:
            c = await wf.roles.candidate(
                task,
                state["project"],
                state["scope"],
                state["proposal"],
                state.get("repairs", 0),
                state.get("authorization"),
            )
        await sync_edit_scene_program(
            store=wf.store,
            client=wf.client,
            task=task,
            plan=c["state"]["plan"],
            selection_id=f"candidate-{state.get('repairs', 0)}",
        )
        return c

    async def inspect_visual(
        self, wf, state: dict[str, Any], task: dict[str, Any]
    ) -> dict:
        return await wf.roles.inspect(
            task, state["intent"], state["candidate"], state["evidence"]
        )

    def exhausted_repair(
        self, wf, state: dict[str, Any], task: dict[str, Any]
    ) -> dict:
        return {
            "route": "end",
            "final": {
                "status": "failed",
                "message": "初稿后已修复三轮，仍有未解决问题，未修改正式场景",
                "candidateId": (state.get("candidate") or {}).get("id"),
                "report": state.get("last_report"),
            },
        }

    def route_repair(
        self, wf, state: dict[str, Any], task: dict[str, Any], count: int
    ) -> dict:
        if task["mode"] in ("interactive_action", "photo_to_scene"):
            return {
                "route": "end",
                "final": {
                    "status": "waiting_input",
                    "message": "快速动作/照片资产候选未通过确定性检查，正式场景未改变。",
                    "candidateId": (state.get("candidate") or {}).get("id"),
                    "report": state.get("last_report"),
                },
            }
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
