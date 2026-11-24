"""Deterministic outer policy: routing and bounded repair directives.

The controller never calls an LLM. It decides which existing subgraph to run
and, after a failed check, which role may perform the smallest safe repair.
Scene writes still go through Candidate -> CheckScene -> Commit.
"""

from __future__ import annotations

import re
from typing import ClassVar, Literal

from pydantic import Field

from .schemas import StrictModel

PolicyRoute = Literal[
    "ground",
    "interactive_action",
    "photo_to_scene",
    "generate_rectangular",
    "reconstruct_floorplan",
    "edit",
    "waiting",
]
PolicyMode = Literal[
    "edit",
    "interactive_action",
    "photo_to_scene",
    "generate_rectangular",
    "reconstruct_floorplan",
    "repair_layout",
]

ROOM_WORDS = (
    "客餐厅",
    "客厅",
    "餐厅",
    "阅读会客间",
    "主卧",
    "次卧",
    "卧室",
    "书房",
    "厨房",
    "卫生间",
    "玄关",
    "过道",
    "走廊",
    "阳台",
    "房间",
    "实验室",
    "理化室",
    "化学室",
    "生物室",
    "物理室",
    "教学室",
    "教室",
    "研讨室",
    "实训室",
    "会议室",
    "培训室",
)
GENERATION_WORDS = ("生成", "设计", "布置", "新建", "来一间", "做一个", "做一个房间")
DIMENSION_WORDS = ("宽", "深", "mm", "毫米", "厘米", "米", "面积")
ACTION_WORDS = (
    "打开",
    "关上",
    "关闭",
    "关掉",
    "开启",
    "拉开",
    "拉出",
    "开灯",
    "关灯",
    "开电视",
    "关电视",
    "开窗帘",
    "关窗帘",
    "一键全开",
    "全开",
)
PHOTO_WORDS = ("照片", "图片", "花瓶", "摆件", "花盆", "台灯", "物品", "显微镜", "锥形瓶", "烧杯", "器材", "仪器", "教具", "标本", "实验器具", "模型")
OPENABLE_KEYS = {
    "wardrobe",
    "wardrobe2",
    "wardrobe3",
    "cabWardrobe",
    "cabSlide",
    "fridge",
    "fridgeDouble",
    "fridgeFrench",
    "freezer",
    "cabTall",
    "cabBase",
    "cabWall",
    "cabCorner",
    "cabShoe",
    "cabSideboard",
    "cabTV",
    "tvCabinet",
    "sideboard",
    "displayCabinet",
    "fileCabinet",
    "wineCabinet",
    "lockers",
    "shoeCabinet",
    "hallCabinet",
    "nightstand",
    "desk",
    "island",
}
DOOR_TYPES = {"door", "double", "unequal", "sliding", "folding", "pocket", "garage"}
TOGGLE_WORDS = ("灯", "电视", "窗帘", "屏幕")


class PolicyDecision(StrictModel):
    route: PolicyRoute
    mode: PolicyMode
    reason: str
    question: str = ""
    targetId: str | None = None
    collection: Literal["openings", "furniture"] | None = None
    action: Literal["toggle_open", "toggle_on", "open_all"] | None = None
    desiredState: bool | None = None
    assetId: str | None = None
    hostId: str | None = None


def _names(furniture: dict) -> str:
    return (furniture.get("name") or "").split("（")[0].split("(")[0]


class PolicyController:
    """Rule-based intent router. Explicit task.mode always wins."""

    def decide(
        self, task: dict, project: dict, conversation: dict | None = None
    ) -> PolicyDecision:
        generation = task.get("generation") or {}
        text = task.get("input") or ""
        mode = task.get("mode") or "edit"
        project_plan = project["plan"]

        if task.get("imageId"):
            return PolicyDecision(
                route="reconstruct_floorplan",
                mode="reconstruct_floorplan",
                reason="任务携带户型图",
            )
        if mode == "reconstruct_floorplan":
            return PolicyDecision(
                route="reconstruct_floorplan",
                mode="reconstruct_floorplan",
                reason="显式户型图模式",
            )
        if mode == "repair_layout":
            return PolicyDecision(
                route="edit",
                mode="repair_layout",
                reason="显式布局修复任务，进入可检查的编辑候选流程",
            )
        if mode == "generate_rectangular":
            return PolicyDecision(
                route="generate_rectangular",
                mode="generate_rectangular",
                reason="显式文字生成模式",
            )
        if mode == "interactive_action":
            action = self._action(text, task, project)
            if action is not None:
                return action
            return PolicyDecision(
                route="waiting",
                mode="interactive_action",
                reason="显式快速动作模式缺少可执行动作",
                question="请说明要打开/关闭哪扇门、柜门、抽屉或电器，并先选中目标。",
            )
        if mode == "photo_to_scene" or generation.get("assetId"):
            asset_id = generation.get("assetId")
            if not asset_id:
                return PolicyDecision(
                    route="waiting",
                    mode="photo_to_scene",
                    reason="照片资产任务缺少 assetId",
                    question="请先在资产库生成物品照片资产，再告诉我放到哪个台面。",
                )
            return PolicyDecision(
                route="photo_to_scene",
                mode="photo_to_scene",
                reason="已有照片资产，进入资产入场子流程",
                assetId=asset_id,
                hostId=generation.get("hostId")
                or next(
                    (
                        id
                        for id in task.get("selectedIds") or []
                        if any(f["id"] == id for f in project_plan.get("furniture", []))
                    ),
                    None,
                ),
            )

        action = self._action(text, task, project)
        if action is not None:
            return action

        if self._looks_like_generation(text):
            return PolicyDecision(
                route="generate_rectangular",
                mode="generate_rectangular",
                reason="文字包含房间用途与尺寸，进入矩形房间生成",
            )

        if any(word in text for word in PHOTO_WORDS) and any(
            word in text for word in ("放到", "放在", "摆到", "摆上", "落位", "吸附")
        ):
            if generation.get("assetId"):
                return PolicyDecision(
                    route="photo_to_scene",
                    mode="photo_to_scene",
                    reason="文字请求放置照片物品",
                    assetId=generation["assetId"],
                    hostId=generation.get("hostId"),
                )
            return PolicyDecision(
                route="waiting",
                mode="photo_to_scene",
                reason="文字提到照片物品，但任务没有绑定 assetId",
                question="请先在资产库生成物品照片资产，再告诉我放到哪个台面。",
            )

        return PolicyDecision(
            route="edit",
            mode="edit",
            reason="未命中快速动作/照片/生成规则，保留现有局部编辑流程",
        )

    def _looks_like_generation(self, text: str) -> bool:
        return (
            any(word in text for word in GENERATION_WORDS)
            and any(word in text for word in ROOM_WORDS)
            and any(word in text for word in DIMENSION_WORDS)
        )

    def _action(self, text: str, task: dict, project: dict) -> PolicyDecision | None:
        if not any(word in text for word in ACTION_WORDS):
            return None
        plan = project["plan"]
        # Negation, multiple actions and unconsumed qualifiers require the
        # normal intent/authorization flow, never a partial quick action.
        names = sorted(
            {_names(f) for f in plan.get("furniture", []) if _names(f)},
            key=len,
            reverse=True,
        )
        target = (
            "(?:"
            + "|".join(
                re.escape(n)
                for n in names + ["它", "门", "柜门", "抽屉", "灯", "电视", "窗帘"]
            )
            + ")(?:的)?(?:柜门|抽屉|门)?"
        )
        verb = r"(?:打开|关闭|关上|关掉|开启|拉开|拉出)"
        simple = re.fullmatch(
            r"\s*(?:请)?(?:帮我)?(?:把|将)?(?:"
            + verb
            + target
            + "|"
            + target
            + verb
            + r"|开灯|关灯|开电视|关电视|开窗帘|关窗帘)\s*[。！!]?\s*",
            text,
        )
        all_open = re.fullmatch(
            r"\s*(?:一键全开(?:门柜检验布局)?|全开|全部打开)\s*[。！!]?\s*", text
        )
        if not simple and not all_open:
            return None
        if all_open:
            return PolicyDecision(
                route="interactive_action",
                mode="interactive_action",
                reason="一键开启全部门柜，进入快速动作子流程",
                action="open_all",
            )
        action = "toggle_on" if any(word in text for word in TOGGLE_WORDS) else "toggle_open"
        closing = any(
            word in text for word in ("关闭", "关上", "关掉", "关灯", "关电视", "关窗帘")
        )
        opening = any(
            word in text for word in ("打开", "开启", "拉开", "拉出", "开灯", "开电视", "开窗帘")
        )
        desired_state = not (closing and not opening)
        selected = list(task.get("selectedIds") or [])
        named = [f for f in plan.get("furniture", []) if _names(f) and _names(f) in text]
        target_id = None
        collection = None
        if len(named) == 1:
            target_id, collection = named[0]["id"], "furniture"
        elif len(named) > 1 and len(selected) == 1 and any(
            f["id"] == selected[0] for f in named
        ):
            target_id, collection = selected[0], "furniture"
        elif len(named) > 1:
            return PolicyDecision(
                route="waiting",
                mode="interactive_action",
                reason="同名对象不唯一",
                question="请明确要操作的对象，或选中后用“它”指代。",
            )
        elif len(selected) == 1:
            target_id = selected[0]
            if any(f["id"] == target_id for f in plan.get("furniture", [])):
                collection = "furniture"
            elif any(o["id"] == target_id for o in plan.get("openings", [])):
                collection = "openings"
        if target_id is None:
            candidates = []
            for f in plan.get("furniture", []):
                name = _names(f)
                if name and name in text:
                    candidates.append(("furniture", f))
            for opening in plan.get("openings", []):
                if "门" in text and "柜门" not in text and opening.get("type") in DOOR_TYPES:
                    candidates.append(("openings", opening))
            if "柜门" in text or "抽屉" in text:
                for f in plan.get("furniture", []):
                    if f.get("key") in OPENABLE_KEYS:
                        candidates.append(("furniture", f))
            unique = {(kind, item["id"]): (kind, item) for kind, item in candidates}
            if len(unique) == 1:
                collection, item = next(iter(unique.values()))
                target_id = item["id"]
            elif len(unique) > 1:
                names_str = "、".join(
                    _names(item) if kind == "furniture" else "门"
                    for kind, item in unique.values()
                )
                return PolicyDecision(
                    route="waiting",
                    mode="interactive_action",
                    reason="快速动作目标不唯一",
                    question=f"场景里有多个可能目标（{names_str}），请先选中要操作的那一个。",
                    action=action,
                    desiredState=desired_state,
                )
        if target_id is None:
            return PolicyDecision(
                route="waiting",
                mode="interactive_action",
                reason="快速动作没有目标",
                question="请先选中要打开/关闭的门、柜门、抽屉或电器。",
                action=action,
                desiredState=desired_state,
            )
        item = (
            next(
                (f for f in plan.get("furniture", []) if f["id"] == target_id),
                None,
            )
            if collection == "furniture"
            else next(
                (o for o in plan.get("openings", []) if o["id"] == target_id),
                None,
            )
        )
        if item is None:
            return PolicyDecision(
                route="waiting",
                mode="interactive_action",
                reason="快速动作目标不在当前场景",
                question="目标对象已不存在，请重新选择。",
                action=action,
                desiredState=desired_state,
            )
        if collection == "furniture":
            if action == "toggle_open" and item.get("key") not in OPENABLE_KEYS:
                return PolicyDecision(
                    route="waiting",
                    mode="interactive_action",
                    reason="目标没有可开启柜门/抽屉",
                    question=f"{_names(item)}没有可开启的柜门或抽屉，请选择衣柜/柜体/冰箱/抽屉。",
                    action=action,
                )
            if action == "toggle_on" and not (
                re.search(
                    r"lamp|light|tv|curtain|screen", item.get("type", ""), re.IGNORECASE
                )
                or "on" in (item.get("opt") or {})
            ):
                return PolicyDecision(
                    route="waiting",
                    mode="interactive_action",
                    reason="目标没有可切换电器状态",
                    question=f"{_names(item)}没有可切换的灯光/电视/窗帘状态。",
                    action=action,
                )
        elif item.get("type") not in DOOR_TYPES:
            return PolicyDecision(
                route="waiting",
                mode="interactive_action",
                reason="目标不是可开启门扇",
                question="请选择一扇可开启的门。",
                action=action,
            )
        return PolicyDecision(
            route="interactive_action",
            mode="interactive_action",
            reason="命中快速开关动作",
            targetId=target_id,
            collection=collection,
            action=action,
            desiredState=desired_state,
        )


class RepairDirective(StrictModel):
    code: str
    targetRole: Literal["assets", "design", "coordinator"]
    action: str
    objectIds: list[str] = Field(default_factory=list, max_length=100)
    message: str
    maxDeltaMm: int = Field(default=600, ge=0, le=5000)


class RepairPolicyRouter:
    """Map deterministic check codes to the smallest role-scoped repair."""

    ROUTES: ClassVar[dict[str, tuple[str, str]]] = {
        "SEISMIC_TOPPLE_EXIT_BLOCKED": ("design", "anchor_or_relocate_tall_furniture"),
        "SEISMIC_TOPPLE_BED_HAZARD": ("design", "anchor_or_relocate_tall_furniture"),
        "WHEELCHAIR_TURNING_BLOCKED": ("design", "clear_wheelchair_turning_circle"),
        "SENSOR_BLIND_SPOT": ("design", "clear_mmwave_radar_los"),
        "OPENABLE_FRONT_BLOCKED": ("design", "clear_openable_envelope"),
        "DOOR_CABINET_CONFLICT": ("design", "move_cabinet_out_of_door_swing"),
        "SURFACE_ITEM_OVERHANG": ("design", "rehost_or_floor_surface_item"),
        "SURFACE_ITEM_COLLISION": ("design", "separate_surface_items"),
        "SURFACE_ITEM_HOST_MISSING": ("design", "rehost_surface_item"),
        "DOORWAY_BLOCKED": ("design", "move_out_of_door_zone"),
        "CIR-02": ("design", "move_out_of_door_zone"),
        "FURNITURE_IN_WALL": ("design", "pull_from_wall"),
        "POSSIBLE_OVERLAP": ("design", "separate_objects"),
        "ASSET_SELECTION": ("assets", "replace_catalog_key"),
        "UNKNOWN_TYPE": ("assets", "replace_catalog_key"),
        "CHECK_FAILED": ("coordinator", "stop"),
        "DRAFT_CONFLICT": ("coordinator", "stop"),
        "EVIDENCE_INVALID": ("coordinator", "stop"),
        "E_CONSTRAINT_UNSATISFIABLE": ("coordinator", "stop"),
    }

    def route(self, report: dict | None) -> RepairDirective | None:
        if not report:
            return None
        issues = self._issues(report)
        structural = next(
            (
                issue
                for issue in issues
                if issue.get("fixableByFurniture") is False
                or issue.get("category") == "structure"
            ),
            None,
        )
        if structural is not None:
            return RepairDirective(
                code=str(structural.get("code") or "STRUCTURE"),
                targetRole="coordinator",
                action="stop",
                objectIds=sorted(
                    {
                        str(object_id)
                        for object_id in (
                            structural.get("object_ids")
                            or structural.get("objectIds")
                            or []
                        )
                    }
                )[:100],
                message=str(
                    structural.get("message")
                    or structural.get("description")
                    or "结构尺寸不足，需要人工调整墙体或门窗"
                ),
                maxDeltaMm=0,
            )
        for code, (role, action) in self.ROUTES.items():
            matches = [issue for issue in issues if issue.get("code") == code]
            if not matches:
                continue
            return RepairDirective(
                code=code,
                targetRole=role,
                action=action,
                objectIds=sorted(
                    {
                        str(object_id)
                        for issue in matches
                        for object_id in (
                            issue.get("object_ids") or issue.get("objectIds") or []
                        )
                    }
                )[:100],
                message=str(
                    matches[0].get("message") or matches[0].get("description") or code
                ),
                maxDeltaMm=0
                if action in ("rehost_or_floor_surface_item", "stop")
                else (
                    2400
                    if action
                    in (
                        "anchor_or_relocate_tall_furniture",
                        "clear_wheelchair_turning_circle",
                        "clear_mmwave_radar_los",
                    )
                    else 600
                ),
            )
        return None

    @staticmethod
    def _issues(report: dict) -> list[dict]:
        result: list[dict] = []
        code_checks = report.get("codeChecks") or {}
        visual = report.get("visualReview") or {}
        for group in (report, code_checks, visual):
            for issue in group.get("issues") or []:
                if isinstance(issue, dict):
                    result.append(issue)
        return result
