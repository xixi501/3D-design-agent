from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from .client import SceneClient, SceneFailure
from .floorplan_flow import FloorplanFlow
from .floorplan_roles import FloorplanRoles
from .generation_flow import COLLECTIONS, GenerationFlow
from .generation_roles import GenerationRoles
from .roles import Roles
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


def ambiguous_name(task: dict, project: dict, conversation: dict) -> str | None:
    """Conservative guard for duplicated, unqualified display names, independent of model confidence."""
    if task["selectedIds"]:
        return None
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


def conversation_focus(candidate: dict):
    if (
        candidate.get("kind") == "initialize"
        and candidate["generation"]["brief"]["purpose"] == "reading_lounge"
    ):
        chairs = [f for f in candidate["state"]["plan"]["furniture"] if f["type"] == "armchair"]
        g = candidate["generation"]
        if chairs:
            windows = [o for o in g["openings"] if o["type"] == "window"]
            if windows:
                o = windows[0]
                w, d = g["dimensions"]["width"], g["dimensions"]["depth"]
                x, y = {
                    "north": (o["from"] + o["width"] / 2, 0),
                    "south": (o["from"] + o["width"] / 2, d),
                    "east": (w, o["from"] + o["width"] / 2),
                    "west": (0, o["from"] + o["width"] / 2),
                }[o["side"]]
                chairs.sort(key=lambda f: (f["x"] - x) ** 2 + (f["y"] - y) ** 2)
            return [chairs[0]["id"]]
    return candidate["diff"]["added"] or candidate["diff"]["updated"]


def completion_result(task: dict, state: dict, candidate: dict, revision: int):
    before = {f["id"]: f for f in state["project"]["plan"]["furniture"]}
    after = {f["id"]: f for f in candidate["state"]["plan"]["furniture"]}
    changes = []
    for action, ids in candidate["diff"].items():
        for id in ids:
            old, new = before.get(id), after.get(id)
            fields = [
                {"field": key, "before": (old or {}).get(key), "after": (new or {}).get(key)}
                for key in ("x", "y", "z", "rot", "w", "d", "h", "color")
                if (old or {}).get(key) != (new or {}).get(key)
            ]
            changes.append(
                {"action": action, "id": id, "name": (new or old)["name"], "fields": fields}
            )
    path = f"/api/projects/{task['projectId']}/candidates/{candidate['id']}"
    result = {
        "status": "completed",
        "message": f"已保存：{candidate['summary'].rstrip('。；; .')}。本次修改作为一个事务提交，可撤销。",
        "projectId": task["projectId"],
        "candidateId": candidate["id"],
        "baseRevision": candidate["baseRevision"],
        "committedRevision": revision,
        "diff": candidate["diff"],
        "changes": changes,
        "checks": candidate["checks"],
        "review": state.get("review") or candidate.get("review"),
        "evidence": [
            {**e, "url": path + f"/evidence/{e['view']}"}
            for e in state.get("evidence") or candidate.get("evidence", [])
        ],
        "repairs": state.get("repairs", 0),
        "versionRetries": state.get("version_retries", 0),
    }
    if candidate.get("kind") == "initialize_floorplan":
        g = task.get("generation", {})
        result.update(
            generation={**candidate["generation"], "skillsUsed": g.get("skillsUsed", [])},
            skillsUsed=g.get("skillsUsed", []),
            structure=candidate["structure"],
            focusIds=conversation_focus(candidate),
        )
        result["message"] += " 整层结构及客餐厅原图布局已保留，可继续选择家具进行局部编辑。"
    if candidate.get("kind") == "initialize":
        g = task.get("generation", {})
        result.update(
            generation={
                **candidate["generation"],
                "style": g.get("style"),
                "furniture": g.get("furniture", []),
                "skillsUsed": g.get("skillsUsed", []),
            },
            skillsUsed=g.get("skillsUsed", []),
            structure=candidate["structure"],
            focusIds=conversation_focus(candidate),
        )
        if candidate["generation"]["brief"]["purpose"] == "reading_lounge" and result["focusIds"]:
            result["message"] += " 已将一把单人沙发设为主要阅读座位，可继续说“把它……”调整。"
    return result


def compile_scope(project: dict, intent: dict, assets: dict, catalogue: dict) -> dict:
    furniture = {f["id"]: f for f in project["plan"]["furniture"]}
    targets = intent["target_ids"]
    references = intent["reference_ids"]
    if (
        len(targets) > 20
        or len(set(targets)) != len(targets)
        or any(id not in furniture for id in targets + references)
    ):
        raise TaskError("NEEDS_INPUT", "目标不存在或不够明确，请重新选择家具")
    if any(id not in targets for id in intent["delete_ids"]):
        raise TaskError("NEEDS_INPUT", "删除对象未获得明确授权")
    permissions = intent.get("field_permissions", {})
    if any(id not in targets for id in permissions):
        raise TaskError("NEEDS_INPUT", "字段授权与目标不一致")
    if any(not permissions.get(id) for id in targets if id not in intent["delete_ids"]):
        raise TaskError("NEEDS_INPUT", "请说明这些对象需要移动、旋转、改尺寸还是改颜色")
    choices = assets.get("choices", [])
    if len(choices) != len(intent["additions"]) or {c["request_index"] for c in choices} != set(
        range(len(intent["additions"]))
    ):
        raise TaskError("ASSET_SELECTION", "新增请求与目录选择不一致")
    counts = {}
    for choice in choices:
        key = choice["key"]
        if key not in catalogue:
            raise TaskError("ASSET_SELECTION", "资产角色返回了不存在的目录配方")
        counts[key] = counts.get(key, 0) + intent["additions"][choice["request_index"]]["count"]
    scope = {
        "targetIds": targets,
        "allowDeleteIds": intent["delete_ids"],
        "allowAddKeys": list(counts),
        "fieldMask": permissions,
        "requirements": [
            {
                "key": key,
                "count": sum(f["key"] == key for f in furniture.values()) + count,
                "scope": "project",
            }
            for key, count in counts.items()
        ],
    }
    if counts and intent["area"] == "local":
        anchors = [furniture[id] for id in set(references + targets)]
        if not anchors:
            raise TaskError("NEEDS_INPUT", "请选中新增家具附近的参考对象，或说明放在房间哪个区域")
        scope["additionBounds"] = {
            "x0": min(f["x"] - f["w"] / 2 for f in anchors) - 1000,
            "y0": min(f["y"] - f["d"] / 2 for f in anchors) - 1000,
            "x1": max(f["x"] + f["w"] / 2 for f in anchors) + 1000,
            "y1": max(f["y"] + f["d"] / 2 for f in anchors) + 1000,
        }
    return scope


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
        return {
            "project": project,
            "candidate": None,
            "review": None,
            "evidence": [],
            "route": "ground",
        }

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
        intent = await self.roles.ground(
            task,
            state["project"],
            conversation,
            history,
            skill_candidates,
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
        catalogue = (await self.client.request("/catalog"))["items"]
        try:
            scope = compile_scope(state["project"], state["intent"], state["assets"], catalogue)
        except TaskError as e:
            return {
                "route": "end",
                "final": {
                    "status": "waiting_input" if e.code == "NEEDS_INPUT" else "failed",
                    "message": str(e),
                },
            }
        self.store.event(state["task_id"], "scope", scope)
        return {"scope": scope, "route": "design"}

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
        try:
            role = (
                FloorplanRoles(self.roles)
                if task.get("mode") == "reconstruct_floorplan"
                else GenerationRoles(self.roles)
                if task.get("mode") == "generate_rectangular"
                else self.roles
            )
            c = await role.candidate(
                task, state["project"], state["scope"], state["proposal"], state.get("repairs", 0)
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
        task = self.task(state, "rendering")
        evidence = await self.client.request(
            self.path(state) + f"/candidates/{state['candidate']['id']}/render", {}
        )
        self.store.event(
            task["id"], "evidence", {"candidateId": state["candidate"]["id"], "evidence": evidence}
        )
        return {"evidence": evidence}

    async def inspect(self, state: State):
        task = self.task(state, "checking")
        review = (
            await FloorplanRoles(self.roles).inspect(task, state["candidate"], state["evidence"])
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
            "source": "agent",
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
        result = completion_result(task, state, c, committed["project"]["revision"])
        generation = task.get("generation", {})
        result["skillsUsed"] = generation.get("skillsUsed", [])
        result["skillSelection"] = generation.get("skillSelection")
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
            "ground",
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
        builder.add_edge("snapshot", "ground")
        builder.add_conditional_edges(
            "ground",
            lambda s: s["route"],
            {"end": END, "assets": "assets", "scope": "scope", "rebase": "snapshot"},
        )
        builder.add_edge("assets", "scope")
        builder.add_conditional_edges(
            "scope", lambda s: s["route"], {"end": END, "design": "design"}
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
