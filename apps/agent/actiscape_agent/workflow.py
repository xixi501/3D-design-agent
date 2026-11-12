from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from .client import SceneClient, SceneFailure
from .edit_execution import authorize_edit, compile_scope, submit_candidate
from .edit_results import completion_result, conversation_focus
from .exact_edits import exact_proposal, no_change, parse_exact
from .floorplan_flow import FloorplanFlow
from .floorplan_roles import FloorplanRoles
from .generation_flow import COLLECTIONS, GenerationFlow
from .generation_roles import GenerationRoles
from .interactive_flow import InteractiveFlow
from .photo_flow import PhotoFlow
from .policy import PolicyController, RepairPolicyRouter
from .role_contracts import (
    RepairBudgetState,
    ReviewIssueV1,
    build_repair_request,
)
from .roles import Roles
from .scene_projection import ensure_edit_scene_draft, sync_edit_scene_program
from .skill_registry import get_registry
from .store import TaskError, TaskStore


class State(TypedDict, total=False):
    task_id: str
    input_hash: str
    project: dict
    intent: dict
    assets: dict
    scope: dict
    proposal: dict
    candidate: dict | None
    evidence: list[dict]
    review: dict | None
    last_report: dict | None
    repairs: int
    version_retries: int
    route: str
    final: dict | None
    generation: dict
    layout_project: dict
    policy: dict
    authorization: dict | None


def ambiguous_name(task: dict, project: dict, conversation: dict) -> str | None:
    """Conservative guard for duplicated, unqualified display names, independent of model confidence."""
    text = task["input"]
    if conversation["focusIds"] and any(
        word in text for word in ("它", "这把", "这盏", "这件", "刚才")
    ):
        return None
    groups = {}
    for f in project["plan"]["furniture"]:
        name = f["name"].split("（")[0].split("(")[0]
        groups.setdefault(name, []).append(f["id"])
    for name, ids in groups.items():
        if len(ids) < 2 or name not in text:
            continue
        if len(set(ids) & set(task["selectedIds"])) == 1:
            continue
        if any(word in text for word in ("所有", "全部", "每一", "一起")):
            continue
        # Position qualifiers are meaningful before the object name; movement directions after it are not.
        prefix = text[: text.index(name)]
        if any(
            word in prefix
            for word in (
                "靠",
                "旁",
                "最左",
                "最右",
                "左边",
                "右边",
                "左侧",
                "右侧",
                "上方",
                "下方",
                "第",
            )
        ):
            continue
        return name
    return None


class Workflow:
    def __init__(self, store: TaskStore, client: SceneClient, roles: Roles):
        self.store, self.client, self.roles = store, client, roles

    def task(self, state: State, phase: str, committing=False):
        task = self.store.task(state["task_id"], internal=True)
        if task["cancelRequested"] and not committing:
            raise TaskError("CANCELLED", "任务已取消，未提交候选")
        self.store.event(task["id"], "phase", {"phase": phase})
        return task

    def path(self, state: State):
        return f"/projects/{self.store.task(state['task_id'])['projectId']}"

    def conflict(self, state: State):
        if state.get("version_retries", 0) >= 1:
            return {
                "route": "end",
                "final": {
                    "status": "conflict",
                    "message": "项目再次发生版本变化，已暂停，请读取最新场景后重试",
                    "candidateId": (state.get("candidate") or {}).get("id"),
                },
            }
        task = self.store.task(state["task_id"], internal=True)
        generation = dict(task.get("generation") or {})
        generation["authorizationVersion"] = int(generation.get("authorizationVersion", 1)) + 1
        self.store.update(task["id"], generation=generation)
        return {
            "route": "rebase",
            "version_retries": state.get("version_retries", 0) + 1,
            "last_report": {"message": "手工编辑改变了项目版本，基于最新场景重新生成候选"},
            "candidate": None,
            "review": None,
            "evidence": [],
        }

    async def snapshot(self, state: State):
        task = self.task(state, "reading")
        project = await self.client.request(f"/projects/{task['projectId']}")
        if state.get("version_retries") and state.get("intent"):
            old = {f["id"]: f for f in state["project"]["plan"]["furniture"]}
            current = {f["id"]: f for f in project["plan"]["furniture"]}
            # Relative operations may be recalculated from the latest scene.
            # Absolute values and model placements must not overwrite a manual
            # change to an authorized field while the task was running.
            operations = state["intent"].get("operations") or []
            protected = {}
            for op in operations:
                protected.setdefault(op["target_id"], set()).update(
                    old.get(op["target_id"], {})
                    if op["action"] == "delete"
                    else op.get("values") or {}
                )
            if not operations:
                protected = {
                    id: set(fields)
                    for id, fields in state["intent"].get("field_permissions", {}).items()
                }
            if any(
                id not in current
                or any(old.get(id, {}).get(key) != current[id].get(key) for key in fields)
                for id, fields in protected.items()
            ):
                return {
                    "route": "end",
                    "final": {
                        "status": "conflict",
                        "message": "目标或待修改字段已被手工编辑，请确认最新状态后继续。",
                    },
                }
        return {
            "project": project,
            "candidate": None,
            "review": None,
            "evidence": [],
            "route": "policy",
        }

    async def policy(self, state: State):
        task = self.task(state, "policy")
        conversation = self.store.conversation(task["conversationId"])
        decision = (
            PolicyController()
            .decide(
                task,
                state["project"],
                conversation,
            )
            .model_dump()
        )
        generation = dict(task.get("generation") or {})
        generation["policy"] = decision
        self.store.update(
            task["id"],
            generation=generation,
            mode=decision["mode"],
        )
        self.store.event(task["id"], "policy", decision)
        if decision["route"] == "waiting":
            return {
                "policy": decision,
                "route": "end",
                "final": {
                    "status": "waiting_input",
                    "message": decision["question"],
                    "policy": decision,
                },
            }
        return {"policy": decision, "route": decision["route"]}

    async def interactive(self, state: State):
        task = self.task(state, "acting")
        return await InteractiveFlow(self.store, self.client).candidate(
            task,
            state["project"],
            state["policy"],
        )

    async def photo(self, state: State):
        task = self.task(state, "acting")
        return await PhotoFlow(self.store, self.client).candidate(
            task,
            state["project"],
            state["policy"],
        )

    async def ground(self, state: State):
        task = self.task(state, "understanding")
        if task.get("mode") == "reconstruct_floorplan":
            return await FloorplanFlow(self.store, self.client, self.roles).ground(state, task)
        if task.get("mode") == "generate_rectangular":
            try:
                return await GenerationFlow(self.store, self.client, self.roles).ground(state, task)
            except SceneFailure as e:
                if e.code == "REVISION_CONFLICT":
                    return self.conflict(state)
                raise
        conversation = self.store.conversation(task["conversationId"])
        history = [
            {"user": t["input"], "assistant": (t["result"] or {}).get("message", t["error"])}
            for t in self.store.tasks(task["conversationId"])
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
        if intent is None:
            intent = await self.roles.ground(
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
            generation = self.store.task(task["id"], internal=True)["generation"]
            generation.update(
                skillSelection=selection.model_dump(),
                skillBundle=bundle,
                skillsUsed=registry.records(bundle),
            )
            self.store.update(task["id"], generation=generation)
            await ensure_edit_scene_draft(
                store=self.store,
                client=self.client,
                task=task,
                project=state["project"],
                intent=intent,
            )
            self.store.event(
                task["id"],
                "skill_loaded",
                {
                    "selection": selection.model_dump(),
                    "skills": generation["skillsUsed"],
                    "bundleHash": bundle["contentHash"],
                },
            )
        ambiguous = ambiguous_name(task, state["project"], conversation)
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
                    "status": "waiting_input" if intent["status"] == "clarify" else "failed",
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

    async def assets(self, state: State):
        task = self.task(state, "choosing_assets")
        if task.get("mode") == "reconstruct_floorplan":
            return {
                "assets": await FloorplanRoles(self.roles).assets(
                    task, state["intent"], state.get("last_report")
                )
            }
        if task.get("mode") == "generate_rectangular":
            return {"assets": await GenerationRoles(self.roles).assets(task, state["intent"])}
        return {"assets": await self.roles.assets(task, state["intent"])}

    async def scope(self, state: State):
        task = self.task(state, "scoping")
        if task.get("mode") == "reconstruct_floorplan":
            return await FloorplanFlow(self.store, self.client, self.roles).scope(state, task)
        task_generation = self.store.task(task["id"], internal=True).get("generation") or {}
        authorization_version = int(task_generation.get("authorizationVersion", 1))
        if task_generation.get("authorizationScope") and (
            task_generation.get("authorizationScopeVersion") == authorization_version
            or state.get("version_retries", 0)
        ):
            # Repairs reuse the exact original authorization. Asset repair may
            # choose another item only inside the pool already recorded there.
            scope = task_generation["authorizationScope"]
        else:
            catalogue = (await self.client.request("/catalog"))["items"]
            try:
                scope = compile_scope(
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
        self.store.event(state["task_id"], "scope", scope)
        try:
            authorization = await authorize_edit(
                self.store, self.client, task, state["project"], scope, state["intent"]
            )
        except SceneFailure as error:
            if error.code == "REVISION_CONFLICT":
                return self.conflict(state)
            raise
        return {"scope": scope, "authorization": authorization, "route": "design"}

    async def design(self, state: State):
        task = self.task(state, "designing")
        if task.get("mode") == "reconstruct_floorplan":
            return {
                "proposal": await FloorplanRoles(self.roles).design(
                    task,
                    state["project"],
                    state["scope"],
                    state.get("last_report"),
                    state.get("repairs", 0),
                )
            }
        if task.get("mode") == "generate_rectangular":
            return {
                "proposal": await GenerationRoles(self.roles).design(
                    task,
                    state["layout_project"],
                    state["scope"],
                    state.get("last_report"),
                    state.get("repairs", 0),
                )
            }
        # Grounding has already produced absolute values/deltas.  Keep the
        # execution path code-only so a design model cannot reinterpret them.
        if state.get("intent", {}).get("operations") and not state["intent"].get("additions"):
            return {"proposal": exact_proposal(state["project"], state["intent"])}
        proposal = await self.roles.design(
            task,
            state["project"],
            state["intent"],
            state["scope"],
            state.get("last_report"),
            state.get("repairs", 0),
        )
        return {"proposal": proposal}

    async def prepare(self, state: State):
        task = self.task(state, "prechecking")
        if state.get("proposal", {}).get("noChange"):
            return {"route": "end", "final": no_change(state["project"])}
        try:
            role = (
                FloorplanRoles(self.roles)
                if task.get("mode") == "reconstruct_floorplan"
                else GenerationRoles(self.roles)
                if task.get("mode") == "generate_rectangular"
                else self.roles
            )
            if task.get("mode") in ("edit", "repair_layout"):
                c = await submit_candidate(
                    self.client,
                    task,
                    state["project"],
                    state["scope"],
                    state["proposal"],
                    state.get("repairs", 0),
                    state.get("authorization"),
                )
            else:
                c = await role.candidate(
                    task,
                    state["project"],
                    state["scope"],
                    state["proposal"],
                    state.get("repairs", 0),
                )
            if task.get("mode") not in (
                "reconstruct_floorplan",
                "generate_rectangular",
            ):
                await sync_edit_scene_program(
                    store=self.store,
                    client=self.client,
                    task=task,
                    plan=c["state"]["plan"],
                    selection_id=f"candidate-{state.get('repairs', 0)}",
                )
            self.store.event(
                task["id"],
                "candidate",
                {"id": c["id"], "hash": c["hash"], "diff": c["diff"], "checks": c["checks"]},
            )
            return {
                "candidate": c,
                "last_report": c["checks"],
                "route": "render" if c["checks"]["passed"] else "repair",
            }
        except TaskError as e:
            if e.code == "FROZEN_ASSETS":
                return {
                    "route": "repair",
                    "last_report": {"error": e.code, "message": str(e)},
                    "candidate": None,
                }
            raise
        except SceneFailure as e:
            if e.code == "NO_CHANGE":
                return {"route": "end", "final": no_change(state["project"])}
            if e.code == "REVISION_CONFLICT":
                return self.conflict(state)
            if e.status in (400, 404, 422):
                return {
                    "route": "repair",
                    "last_report": {
                        "error": e.code,
                        "message": str(e),
                        "details": e.data.get("details"),
                    },
                    "candidate": None,
                }
            raise

    async def render(self, state: State):
        task = self.task(
            state,
            "checking_parameters"
            if state["candidate"].get("verification") == "deterministic"
            else "rendering",
        )
        if state["candidate"].get("verification") == "deterministic":
            self.store.event(
                task["id"],
                "evidence",
                {"candidateId": state["candidate"]["id"], "evidence": [], "mode": "deterministic"},
            )
            return {"evidence": []}
        evidence = await self.client.request(
            self.path(state) + f"/candidates/{state['candidate']['id']}/render", {}
        )
        self.store.event(
            task["id"], "evidence", {"candidateId": state["candidate"]["id"], "evidence": evidence}
        )
        return {"evidence": evidence}

    async def inspect(self, state: State):
        task = self.task(
            state,
            "checking_parameters"
            if state["candidate"].get("verification") == "deterministic"
            else "checking",
        )
        if state["candidate"].get("verification") == "deterministic":
            # Code-derived exact edits and manual action/photo paths have no
            # visual design judgment to perform. The immutable candidate and
            # deterministic checks are the review evidence.
            review = {
                "passed": bool(state["candidate"]["checks"]["passed"]),
                "summary": "精确编辑已通过确定性字段与几何检查。",
                "issues": [],
            }
        else:
            review = (
                await FloorplanRoles(self.roles).inspect(
                    task, state["candidate"], state["evidence"]
                )
                if task.get("mode") == "reconstruct_floorplan"
                else await GenerationRoles(self.roles).inspect(
                    task, state["candidate"], state["evidence"]
                )
                if task.get("mode") == "generate_rectangular"
                else await self.roles.inspect(
                    task, state["intent"], state["candidate"], state["evidence"]
                )
            )
        valid_ids = {
            o["id"] for k in COLLECTIONS for o in state["candidate"]["state"]["plan"].get(k, [])
        } | set(state["candidate"]["diff"]["deleted"])
        blocking_issues = [
            issue for issue in review["issues"] if issue.get("severity", "blocking") == "blocking"
        ]
        reported = [id for issue in blocking_issues for id in issue["object_ids"]]
        if any(id not in valid_ids for id in reported):
            raise TaskError("INVALID_REVIEW", "检查角色返回未知对象身份，候选没有提交")
        passed = review["passed"] and not blocking_issues and state["candidate"]["checks"]["passed"]
        body = {
            "passed": passed,
            "source": "deterministic"
            if state["candidate"].get("verification") == "deterministic"
            else "agent",
            "summary": review["summary"],
            "objectIds": list(dict.fromkeys(reported)),
            "issues": [i["description"] for i in blocking_issues],
            "evidenceHashes": [e["sha256"] for e in state["evidence"]],
        }
        await self.client.request(
            self.path(state) + f"/candidates/{state['candidate']['id']}/review", body
        )
        return {
            "review": review,
            "route": "commit" if passed else "repair",
            "last_report": {"codeChecks": state["candidate"]["checks"], "visualReview": review},
        }

    async def repair(self, state: State):
        self.task(state, "repairing")
        if state.get("intent", {}).get("operations"):
            return {
                "route": "end",
                "final": {
                    "status": "waiting_input",
                    "reason": "check_failed",
                    "message": "精确要求未通过检查；请调整要求或目标后继续，正式场景未改变。",
                    "candidateId": (state.get("candidate") or {}).get("id"),
                    "report": state.get("last_report"),
                },
            }
        count = state.get("repairs", 0)
        if count >= 3:
            if self.store.task(state["task_id"])["mode"] == "reconstruct_floorplan":
                return {
                    "route": "end",
                    "final": {
                        "status": "waiting_input",
                        "phase": "reviewing_floorplan",
                        "draftId": self.store.task(state["task_id"])["generation"].get("draftId"),
                        "message": "原图布局在三轮检查修复后仍有冲突，请明确校正草稿后重新确认；正式项目未改变。",
                        "candidateId": (state.get("candidate") or {}).get("id"),
                        "report": state.get("last_report"),
                    },
                }
            if self.store.task(state["task_id"])["mode"] == "generate_rectangular":
                return {
                    "route": "end",
                    "final": {
                        "status": "waiting_input",
                        "message": "在固定尺寸与家具要求下，初稿后三轮修复仍未得到通过检查的布局。请调整家具清单或尺寸后继续；正式项目未改变。",
                        "candidateId": (state.get("candidate") or {}).get("id"),
                        "report": state.get("last_report"),
                    },
                }
            return {
                "route": "end",
                "final": {
                    "status": "failed",
                    "message": "初稿后已修复三轮，仍有未解决问题，未修改正式场景",
                    "candidateId": (state.get("candidate") or {}).get("id"),
                    "report": state.get("last_report"),
                },
            }
        self.store.event(
            state["task_id"], "repair", {"round": count + 1, "report": state.get("last_report")}
        )
        task = self.store.task(state["task_id"], internal=True)
        generation = task.get("generation", {})
        if (
            task["mode"] not in ("reconstruct_floorplan", "interactive_action", "photo_to_scene")
            and generation.get("skillBundle")
            and not generation["skillBundle"].get("repair")
        ):
            registry = get_registry()
            bundle = registry.with_repair(generation["skillBundle"], task["mode"])
            generation.update(
                skillBundle=bundle,
                skillsUsed=registry.records(bundle),
            )
            self.store.update(task["id"], generation=generation)
            self.store.event(
                task["id"],
                "skill_repair_loaded",
                {
                    "id": bundle["repair"]["id"],
                    "contentHash": bundle["repair"]["contentHash"],
                    "bundleHash": bundle["contentHash"],
                },
            )
            task = self.store.task(state["task_id"], internal=True)
            generation = task.get("generation", {})
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
        if task["mode"] != "reconstruct_floorplan":
            directive = RepairPolicyRouter().route(state.get("last_report"))
            if directive is not None:
                generation["repairDirective"] = directive.model_dump()
                self.store.update(task["id"], generation=generation)
                self.store.event(
                    task["id"],
                    "repair_routed",
                    directive.model_dump(),
                )
                if directive.targetRole == "coordinator" or directive.action == "stop":
                    return {
                        "route": "end",
                        "final": {
                            "status": "waiting_input",
                            "message": (
                                f"检查问题需要人工确认：{directive.message}；正式项目未改变。"
                            ),
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
        if generation.get("floorplanVersion") == "s2c-floorplan-v4-2":
            raw_issues = (state.get("last_report") or {}).get("visualReview", {}).get(
                "issues"
            ) or []
            issues = [
                ReviewIssueV1(
                    code=str(item.get("code") or "OTHER"),
                    source=item.get("source") or "model",
                    severity=item.get("severity") or "blocking",
                    objectIds=list(item.get("object_ids") or item.get("objectIds") or []),
                    evidenceRefs=list(item.get("evidenceRefs") or []),
                    message=str(item.get("description") or item.get("message") or item.get("code")),
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
            budget = RepairBudgetState.model_validate(generation.get("repairBudget") or {})
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
                self.store.update(task["id"], generation=generation)
                self.store.event(
                    task["id"],
                    "repair_routed",
                    {
                        **request.model_dump(),
                        "issueCodes": codes,
                    },
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
                self.store.update(task["id"], generation=generation)
                self.store.event(
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
            self.store.update(task["id"], generation=generation)
            self.store.event(
                task["id"],
                "skill_repair_loaded",
                {
                    "id": bundle["repair"]["id"],
                    "contentHash": bundle["repair"]["contentHash"],
                    "bundleHash": bundle["contentHash"],
                },
            )
            task = self.store.task(state["task_id"], internal=True)
        if task["mode"] == "reconstruct_floorplan":
            generation = task["generation"]
            generation["repairsUsed"] = count + 1
            self.store.update(task["id"], generation=generation)
        return {
            "repairs": count + 1,
            "route": "assets" if task["mode"] == "reconstruct_floorplan" else "design",
        }

    async def commit(self, state: State):
        task = self.task(
            state,
            "committing",
            committing=self.store.task(state["task_id"])["status"] == "committing",
        )
        self.store.update(task["id"], status="committing")
        c = state["candidate"]
        request = {
            "operationId": c["operationId"],
            "baseRevision": c["baseRevision"],
            "candidateHash": c["hash"],
        }
        try:
            committed = await self.client.request(
                self.path(state) + f"/candidates/{c['id']}/commit", request
            )
        except SceneFailure as e:
            self.store.update(task["id"], status="running")
            if e.code == "REVISION_CONFLICT":
                return self.conflict(state)
            raise
        task = self.store.task(task["id"], internal=True)
        result = completion_result(task, state, c, committed["project"]["revision"])
        self.store.event(
            task["id"],
            "committed",
            {
                "revision": result["committedRevision"],
                "candidateId": c["id"],
                "replayed": committed["replayed"],
            },
        )
        self.store.focus(task["conversationId"], conversation_focus(c))
        return {"route": "end", "final": result}

    def compile(self, checkpointer):
        builder = StateGraph(State)
        for name in (
            "snapshot",
            "policy",
            "ground",
            "interactive",
            "photo",
            "assets",
            "scope",
            "design",
            "prepare",
            "render",
            "inspect",
            "repair",
            "commit",
        ):
            builder.add_node(name, getattr(self, name))
        builder.add_edge(START, "snapshot")
        builder.add_conditional_edges(
            "snapshot", lambda s: s["route"], {"policy": "policy", "end": END}
        )
        builder.add_conditional_edges(
            "policy",
            lambda s: s["route"],
            {
                "ground": "ground",
                "interactive_action": "interactive",
                "photo_to_scene": "photo",
                "edit": "ground",
                "generate_rectangular": "ground",
                "reconstruct_floorplan": "ground",
                "end": END,
            },
        )
        builder.add_conditional_edges(
            "interactive",
            lambda s: s["route"],
            {"render": "render", "end": END},
        )
        builder.add_conditional_edges(
            "photo",
            lambda s: s["route"],
            {"render": "render", "end": END},
        )
        builder.add_conditional_edges(
            "ground",
            lambda s: s["route"],
            {"end": END, "assets": "assets", "scope": "scope", "rebase": "snapshot"},
        )
        builder.add_edge("assets", "scope")
        builder.add_conditional_edges(
            "scope", lambda s: s["route"], {"end": END, "design": "design", "rebase": "snapshot"}
        )
        builder.add_edge("design", "prepare")
        builder.add_conditional_edges(
            "prepare",
            lambda s: s["route"],
            {"end": END, "rebase": "snapshot", "repair": "repair", "render": "render"},
        )
        builder.add_edge("render", "inspect")
        builder.add_conditional_edges(
            "inspect", lambda s: s["route"], {"repair": "repair", "commit": "commit"}
        )
        builder.add_conditional_edges(
            "repair", lambda s: s["route"], {"end": END, "design": "design", "assets": "assets"}
        )
        builder.add_conditional_edges(
            "commit", lambda s: s["route"], {"end": END, "rebase": "snapshot"}
        )
        return builder.compile(checkpointer=checkpointer)
