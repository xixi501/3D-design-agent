from .client import SceneFailure
from .generation_roles import GenerationRoles
from .generation_schemas import resolve_request
from .skill_registry import GENERATION_TOOLS, load_design_skill, skill_record
from .store import TaskError, fingerprint

COLLECTIONS = (
    "nodes",
    "walls",
    "openings",
    "furniture",
    "structs",
    "beams",
    "rooms",
    "measures",
    "elec",
    "voids",
    "comments",
)


class GenerationFlow:
    def __init__(self, store, client, roles):
        self.store, self.client = store, client
        self.roles = GenerationRoles(roles)

    async def ground(self, state, task):
        project = state["project"]
        if any(project["plan"].get(k) for k in COLLECTIONS) or project.get("roomLabelArchive"):
            raise TaskError(
                "PROJECT_NOT_EMPTY", "文字生成仅用于空白项目，请新建项目；现有内容没有被覆盖", 409
            )
        old = task.get("generation", {})
        source_hash = fingerprint(task["input"])
        if old.get("frozen") and old.get("sourceInputHash") == source_hash:
            generation = dict(old)
        else:
            generation = resolve_request(await self.roles.ground(task, project), task["input"])
            if old.get("skillSnapshot"):
                generation["skillSnapshot"] = old["skillSnapshot"]
            generation["frozen"] = False
            self.store.update(task["id"], generation=generation)
            self.store.event(
                task["id"], "brief", {k: v for k, v in generation.items() if k != "skillSnapshot"}
            )
            if generation["unsupported"]:
                return {
                    "route": "end",
                    "final": {
                        "status": "failed",
                        "message": generation["question"] or "当前仅支持单个矩形客餐厅或阅读会客间",
                        "generation": generation,
                    },
                }
            if generation["missing"]:
                return {
                    "route": "end",
                    "final": {
                        "status": "waiting_input",
                        "message": "请补充或确认：" + "；".join(generation["missing"]),
                        "generation": {k: v for k, v in generation.items() if k != "skillSnapshot"},
                    },
                }
        brief = generation["brief"]
        try:
            preview = await self.client.request(
                f"/projects/{task['projectId']}/initialization-preview",
                {"taskId": task["id"], "baseRevision": project["revision"], "brief": brief},
            )
        except SceneFailure as e:
            if e.code == "REVISION_CONFLICT" or e.status >= 500:
                raise
            generation.update(frozen=False, missing=[str(e)])
            self.store.update(task["id"], generation=generation)
            return {
                "route": "end",
                "final": {"status": "waiting_input", "message": "房间结构需要调整：" + str(e)},
            }
        snapshot = generation.get("skillSnapshot") or load_design_skill(GENERATION_TOOLS)
        if brief["purpose"] not in snapshot["appliesTo"]:
            raise TaskError("SKILL_NOT_APPLICABLE", "当前 Skill 不支持该房间用途")
        generation.update(
            frozen=True,
            frozenBrief=brief,
            sourceInputHash=source_hash,
            dimensions=preview["dimensions"],
            openings=preview["openings"],
            defaults=list(dict.fromkeys(generation["defaults"] + preview["defaults"])),
            skillSnapshot=snapshot,
            skillsUsed=[skill_record(snapshot)],
        )
        self.store.update(task["id"], generation=generation)
        self.store.event(
            task["id"],
            "skill_loaded",
            {**skill_record(snapshot), "requiredTools": snapshot["requiredTools"]},
        )
        self.store.event(
            task["id"],
            "brief_frozen",
            {k: v for k, v in generation.items() if k != "skillSnapshot"},
        )
        intent = {
            "status": "ready",
            "summary": "生成矩形房间与家具布局",
            "target_ids": [],
            "reference_ids": [],
            "delete_ids": [],
            "field_permissions": {},
            "additions": generation["furniture"],
            "area": "room",
        }
        return {
            "intent": intent,
            "generation": generation,
            "layout_project": {**project, **preview["state"]},
            "assets": {"choices": []},
            "route": "assets",
        }
