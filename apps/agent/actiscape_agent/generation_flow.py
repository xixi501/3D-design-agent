from .client import SceneFailure
from .generation_roles import GenerationRoles
from .generation_schemas import resolve_request
from .scene_projection import ensure_text_scene_draft, sync_text_scene_program
from .scene_registry import get_scene_registry
from .skill_registry import get_registry
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
            registry = get_registry()
            initial_candidates = registry.candidates(
                "generate_rectangular",
                project_state="empty",
            )
            generation = resolve_request(
                await self.roles.ground(task, project, initial_candidates),
                task["input"],
            )
            # A changed requirement is re-grounded and its Skill applicability
            # is checked again. The same requirement keeps the persisted
            # frozen snapshot/bundle through the early reuse branch above.
            if old.get("skillSnapshot") and not old.get("skillBundle"):
                # Legacy V1 tasks retain their frozen content but still have to
                # be applicable to the current room and area.
                generation["skillSnapshot"] = old["skillSnapshot"]
            generation["frozen"] = False
            self.store.update(task["id"], generation=generation)
            public_generation = {k: v for k, v in generation.items() if k != "skillSnapshot"}
            if public_generation.get("skillBundle"):
                public_generation["skillBundle"] = registry.public_bundle(
                    public_generation["skillBundle"]
                )
            self.store.event(task["id"], "brief", public_generation)
            if generation["unsupported"]:
                return {
                    "route": "end",
                    "final": {
                        "status": "failed",
                        "message": generation["question"]
                        or "当前房间用途不在已启用范围，或输入包含多房间/不规则轮廓",
                        "generation": {k: v for k, v in generation.items() if k != "skillSnapshot"},
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
        room_type = brief.get("roomType") or brief.get("purpose")
        room = get_scene_registry().room(room_type)
        if room is None and room_type:
            label_id = get_scene_registry().room_type_for_label(str(room_type))
            if label_id != "other":
                room = get_scene_registry().room(label_id)
        if room is None:
            raise TaskError("ROOM_TYPE_UNRESOLVED", "任务房间类型不在场景注册表中")
        generation = await ensure_text_scene_draft(
            store=self.store,
            client=self.client,
            task=task,
            project=project,
            generation=generation,
            room_type=room.id,
        )
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
        generation = await sync_text_scene_program(
            store=self.store,
            client=self.client,
            task=task,
            plan=preview["state"]["plan"],
            selection_id="shell",
            room_type=room.id,
            stage="shell",
        )
        records = []
        if generation.get("skillBundle"):
            bundle = generation["skillBundle"]
            snapshot = bundle["primary"]
            records = generation.get("skillsUsed", [])
        elif generation.get("skillSnapshot"):
            # Tasks frozen before Skill Pool v1 keep their original snapshot.
            snapshot = generation["skillSnapshot"]
            if brief["purpose"] not in snapshot.get("appliesTo", []):
                raise TaskError("SKILL_NOT_APPLICABLE", "当前 Skill 不支持该房间用途")
            bundle = None
        else:
            registry = get_registry()
            area_m2 = None
            width, depth = brief.get("width"), brief.get("depth")
            if width and depth:
                factors = {"mm": 0.001, "cm": 0.01, "m": 1.0}
                area_m2 = (
                    width["value"]
                    * factors[width["unit"]]
                    * depth["value"]
                    * factors[depth["unit"]]
                )
            candidates = registry.candidates(
                "generate_rectangular",
                project_state="empty",
                room_kind=room.skillRoomKind,
                area_m2=area_m2,
            )
            selection = registry.validate_selection(
                generation.get("skillSelection", {}),
                candidates,
                mode="generate_rectangular",
            )
            bundle = registry.compose(
                mode="generate_rectangular",
                selection=selection,
                include_intake=False,
            )
            snapshot = bundle["primary"]
            if (
                "any" not in snapshot["appliesTo"]["roomKinds"]
                and room.skillRoomKind not in snapshot["appliesTo"]["roomKinds"]
            ):
                raise TaskError("SKILL_NOT_APPLICABLE", "当前 Skill 不支持该房间用途")
            generation["skillSelection"] = selection.model_dump()
            generation["skillBundle"] = bundle
            records = registry.records(bundle)
            generation["skillsUsed"] = records
        applies = snapshot.get("appliesTo", {})
        kinds = applies.get("roomKinds") or []
        if kinds and "any" not in kinds and room.skillRoomKind not in kinds:
            raise TaskError("SKILL_NOT_APPLICABLE", "当前 Skill 不支持该房间用途")
        generation.update(
            frozen=True,
            frozenBrief=brief,
            sourceInputHash=source_hash,
            dimensions=preview["dimensions"],
            openings=preview["openings"],
            defaults=list(dict.fromkeys(generation["defaults"] + preview["defaults"])),
            skillSnapshot=snapshot,
            skillsUsed=generation.get("skillsUsed")
            or next((item for item in records if item["role"] == "primary"), []),
        )
        self.store.update(task["id"], generation=generation)
        self.store.event(
            task["id"],
            "skill_loaded",
            {
                "selection": generation.get("skillSelection"),
                "skills": generation["skillsUsed"],
                "bundleHash": (bundle or {}).get("contentHash"),
            },
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
