"""LangGraph state-machine orchestrator delegating mode specifics to flows/."""

from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from .client import SceneClient, SceneFailure
from .edit_execution import authorize_edit, compile_scope, submit_candidate
from .edit_results import completion_result, conversation_focus
from .exact_edits import no_change
from .floorplan_flow import FloorplanFlow
from .floorplan_roles import FloorplanRoles
from .flows import LayoutTaskHandler, resolve_task_handler
from .generation_flow import COLLECTIONS, GenerationFlow
from .generation_roles import GenerationRoles
from .interactive_flow import InteractiveFlow
from .photo_flow import PhotoFlow
from .policy import PolicyController
from .roles import Roles
from .skill_registry import get_registry
from .store import TaskError, TaskStore

__all__ = [
    "COLLECTIONS",
    "FloorplanFlow",
    "FloorplanRoles",
    "GenerationFlow",
    "GenerationRoles",
    "InteractiveFlow",
    "PhotoFlow",
    "State",
    "Workflow",
    "ambiguous_name",
    "authorize_edit",
    "compile_scope",
    "submit_candidate",
]


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

    @staticmethod
    def handler(task: dict) -> LayoutTaskHandler:
        return resolve_task_handler(task.get("mode"))

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
        generation["authorizationVersion"] = (
            int(generation.get("authorizationVersion", 1)) + 1
        )
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
                    for id, fields in state["intent"]
                    .get("field_permissions", {})
                    .items()
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
        decision = PolicyController().decide(task, state["project"], conversation).model_dump()
        generation = dict(task.get("generation") or {})
        generation["policy"] = decision
        self.store.update(task["id"], generation=generation, mode=decision["mode"])
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
            task, state["project"], state["policy"]
        )

    async def photo(self, state: State):
        task = self.task(state, "acting")
        return await PhotoFlow(self.store, self.client).candidate(
            task, state["project"], state["policy"]
        )

    async def ground(self, state: State):
        task = self.task(state, "understanding")
        return await self.handler(task).ground(self, state, task)

    async def assets(self, state: State):
        task = self.task(state, "choosing_assets")
        return await self.handler(task).assets(self, state, task)

    async def scope(self, state: State):
        task = self.task(state, "scoping")
        return await self.handler(task).scope(self, state, task)

    async def design(self, state: State):
        task = self.task(state, "designing")
        return await self.handler(task).design(self, state, task)

    async def prepare(self, state: State):
        task = self.task(state, "prechecking")
        if state.get("proposal", {}).get("noChange"):
            return {"route": "end", "final": no_change(state["project"])}
        try:
            c = await self.handler(task).create_candidate(self, state, task)
            self.store.event(
                task["id"],
                "candidate",
                {
                    "id": c["id"],
                    "hash": c["hash"],
                    "diff": c["diff"],
                    "checks": c["checks"],
                },
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
        deterministic = state["candidate"].get("verification") == "deterministic"
        task = self.task(state, "checking_parameters" if deterministic else "rendering")
        if deterministic:
            self.store.event(
                task["id"],
                "evidence",
                {
                    "candidateId": state["candidate"]["id"],
                    "evidence": [],
                    "mode": "deterministic",
                },
            )
            return {"evidence": []}
        evidence = await self.client.request(
            self.path(state) + f"/candidates/{state['candidate']['id']}/render", {}
        )
        self.store.event(
            task["id"],
            "evidence",
            {"candidateId": state["candidate"]["id"], "evidence": evidence},
        )
        return {"evidence": evidence}

    async def inspect(self, state: State):
        deterministic = state["candidate"].get("verification") == "deterministic"
        task = self.task(state, "checking_parameters" if deterministic else "checking")
        if deterministic:
            review = {
                "passed": bool(state["candidate"]["checks"]["passed"]),
                "summary": "精确编辑已通过确定性字段与几何检查。",
                "issues": [],
            }
        else:
            stored = state["candidate"].get("review")
            evidence_hashes = sorted(e["sha256"] for e in state["evidence"])
            if (
                stored
                and stored.get("passed") is True
                and stored.get("source") == "agent"
                and not stored.get("issues")
                and sorted(stored.get("evidenceHashes") or []) == evidence_hashes
            ):
                review = {
                    "passed": True,
                    "summary": stored.get("summary") or "复用已完成且证据一致的独立检查",
                    "issues": [],
                }
                self.store.event(
                    task["id"],
                    "review_reused",
                    {
                        "candidateId": state["candidate"]["id"],
                        "evidenceHashes": evidence_hashes,
                    },
                )
            else:
                review = await self.handler(task).inspect_visual(self, state, task)

        valid_ids = {
            o["id"]
            for k in COLLECTIONS
            for o in state["candidate"]["state"]["plan"].get(k, [])
        } | set(state["candidate"]["diff"]["deleted"])
        blocking_issues = [
            issue
            for issue in review["issues"]
            if issue.get("severity", "blocking") == "blocking"
        ]
        reported = [id for issue in blocking_issues for id in issue["object_ids"]]
        if any(id not in valid_ids for id in reported):
            raise TaskError("INVALID_REVIEW", "检查角色返回未知对象身份，候选没有提交")
        passed = (
            review["passed"]
            and not blocking_issues
            and state["candidate"]["checks"]["passed"]
        )
        body = {
            "passed": passed,
            "source": "deterministic" if deterministic else "agent",
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
            "last_report": {
                "codeChecks": state["candidate"]["checks"],
                "visualReview": review,
            },
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
        task = self.store.task(state["task_id"], internal=True)
        count = state.get("repairs", 0)
        if count >= 3:
            return self.handler(task).exhausted_repair(self, state, task)

        self.store.event(
            state["task_id"],
            "repair",
            {"round": count + 1, "report": state.get("last_report")},
        )
        generation = task.get("generation", {})
        if (
            task["mode"]
            not in ("reconstruct_floorplan", "interactive_action", "photo_to_scene")
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

        return self.handler(task).route_repair(self, state, task, count)

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
            "scope",
            lambda s: s["route"],
            {"end": END, "design": "design", "rebase": "snapshot"},
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
            "repair",
            lambda s: s["route"],
            {"end": END, "design": "design", "assets": "assets"},
        )
        builder.add_conditional_edges(
            "commit", lambda s: s["route"], {"end": END, "rebase": "snapshot"}
        )
        return builder.compile(checkpointer=checkpointer)
