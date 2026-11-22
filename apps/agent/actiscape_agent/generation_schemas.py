import re
from typing import Any, Literal

from pydantic import Field, FiniteFloat, field_validator

from .scene_registry import get_scene_registry
from .schemas import Addition, AssetChoice, AssetSelection, SkillSelection, StrictModel
from .style_packs import match_style_pack


def asset_selection_schema(count: int, allowed_keys: set[str]):
    class GenerationAssetSelection(AssetSelection):
        choices: list[AssetChoice] = Field(min_length=count, max_length=count)

        @field_validator("choices")
        @classmethod
        def exact_requests(cls, choices):
            if sorted(c.request_index for c in choices) != list(range(count)):
                raise ValueError(
                    "每项请求只返回一个配方，request_index 必须完整对应给定的零基索引；不要按实例数量展开"
                )
            if any(c.key not in allowed_keys for c in choices):
                raise ValueError("key 必须来自真实目录查询")
            return choices

    return GenerationAssetSelection


class Dimension(StrictModel):
    value: FiniteFloat = Field(ge=0)
    unit: Literal["mm", "cm", "m"]


class OpeningBrief(StrictModel):
    side: Literal["north", "east", "south", "west"] | None = None
    position: Literal["center", "offset"] | None = None
    offset: Dimension | None = None
    width: Dimension | None = None
    sill: Dimension | None = None
    head: Dimension | None = None


class GenerationRequest(StrictModel):
    status: Literal["ready", "clarify", "unsupported"]
    question: str = ""
    purpose: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, max_length=100)
    width: Dimension | None = None
    depth: Dimension | None = None
    height: Dimension | None = None
    wallThickness: Dimension | None = None
    doors: list[OpeningBrief] | None = Field(default=None, max_length=8)
    windows: list[OpeningBrief] | None = Field(default=None, max_length=8)
    furniture: list[Addition] = Field(default_factory=list, max_length=20)
    style: str | None = Field(default=None, max_length=200)
    conflicts: list[str] = Field(default_factory=list, max_length=10)
    evidence: dict[str, str] = Field(
        default_factory=dict,
        description="purpose/width/depth/doors/windows 各自对应用户原话的原文摘录；不得编造尺寸或门窗",
    )
    skillSelection: SkillSelection = Field(default_factory=SkillSelection)


_UNIT_ALIASES = {
    "毫米": "mm",
    "mm": "mm",
    "厘米": "cm",
    "cm": "cm",
    "米": "m",
    "m": "m",
}

_AUTONOMOUS_CUES = (
    "自由发挥",
    "自己发挥",
    "任意发挥",
    "随意发挥",
    "你定",
    "你来定",
    "你决定",
    "看着办",
    "看着安排",
    "随便",
    "默认即可",
    "默认就行",
    "按默认",
    "自动补全",
    "自己安排",
    "帮我配",
    "一键生成",
    "剩余的你",
    "其余的你",
    "其他的你",
    "几张",
    "几把",
    "若干",
    "[自主发挥]",
)

_ROOM_PRIORS_M: dict[str, tuple[float, float]] = {
    "dining_hall": (5.6, 4.4),
    "living_dining": (6.6, 4.8),
    "reading_lounge": (5.0, 3.8),
    "tea_room": (5.8, 4.4),
    "media_room": (6.2, 4.6),
    "master_bedroom": (4.8, 4.2),
    "guest_bedroom": (4.0, 3.6),
    "kids_room": (3.8, 3.4),
    "study": (4.2, 3.6),
    "kitchen": (3.8, 2.8),
    "bathroom": (2.8, 2.4),
    "entry": (2.6, 2.2),
    "multipurpose": (4.2, 3.6),
    "circulation": (4.0, 1.6),
}


def is_autonomous_delegation(user_input: str) -> bool:
    text = (user_input or "").strip()
    return any(cue in text for cue in _AUTONOMOUS_CUES)


def _infer_room_purpose_from_text(user_input: str) -> str:
    t = (user_input or "").strip()
    if "客餐厅" in t or ("客厅" in t and "餐" in t):
        return "living_dining"
    if any(k in t for k in ("餐厅", "饭厅", "宴会厅", "餐饮", "餐桌")):
        return "dining_hall"
    if any(k in t for k in ("茶室", "茶空间", "品茗", "茶斋", "茶台")):
        return "tea_room"
    if any(k in t for k in ("影音", "影院", "视听")):
        return "media_room"
    if any(k in t for k in ("儿童房", "小孩房", "男孩房", "女孩房")):
        return "kids_room"
    if any(k in t for k in ("榻榻米", "多功能")):
        return "multipurpose"
    if "主卧" in t or ("大卧" in t) or ("老人" in t and "房" in t):
        return "master_bedroom"
    if any(k in t for k in ("次卧", "客房", "卧室", "睡房")):
        return "guest_bedroom"
    if any(k in t for k in ("书房", "工作室", "办公")):
        return "study"
    if "厨房" in t:
        return "kitchen"
    if any(k in t for k in ("卫生间", "浴室", "洗手间", "公卫", "独卫")):
        return "bathroom"
    if any(k in t for k in ("玄关", "门厅", "入户")):
        return "entry"
    if any(k in t for k in ("阅读", "会客")):
        return "reading_lounge"
    return "living_dining"


def _parse_cn_count(text: str, noun_pattern: str, default_vague: int = 3) -> int | None:
    cn_nums = {"一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6}
    m_digit = re.search(rf"(\d+)\s*[张把套个台]\s*(?:{noun_pattern})", text)
    if m_digit:
        return max(1, min(8, int(m_digit.group(1))))
    m_cn = re.search(rf"([一二两三四五六])\s*[张把套个台]\s*(?:{noun_pattern})", text)
    if m_cn:
        return cn_nums[m_cn.group(1)]
    if re.search(rf"(?:几|若干|多)\s*[张把套个]?\s*(?:{noun_pattern})", text):
        return default_vague
    return None


def _enrich_autonomous_furniture(
    base_furniture: list[dict[str, Any]],
    room: Any,
    user_input: str,
    style_pack: dict[str, Any] | None,
) -> tuple[list[dict[str, Any]], int]:
    """Keep user-specified items, expand vague counts, and auto-pair chairs + complementary soft decor."""
    merged: list[dict[str, Any]] = [dict(item) for item in base_furniture]
    chair_q = (style_pack or {}).get("diningChairQuery", "餐椅")

    table_count_override = _parse_cn_count(user_input, "餐桌|圆桌|长桌|桌子", default_vague=3)
    has_table = any("桌" in item["query"] and "书桌" not in item["query"] for item in merged)
    if table_count_override is not None:
        preferred_table_q = "圆餐桌" if (table_count_override >= 2 and "长桌" not in user_input) else "餐桌"
        if has_table:
            for item in merged:
                if "桌" in item["query"] and "书桌" not in item["query"]:
                    item["count"] = table_count_override
                    item["query"] = preferred_table_q
                    break
        else:
            merged.insert(0, {"query": preferred_table_q, "count": table_count_override})

    total_dining_tables = sum(
        int(item["count"])
        for item in merged
        if any(k in item["query"] for k in ("餐桌", "圆桌", "桌子")) and "书桌" not in item["query"]
    )
    has_chairs = any("椅" in item["query"] for item in merged)
    if total_dining_tables > 0 and not has_chairs:
        merged.append({"query": chair_q, "count": min(12, total_dining_tables * 4)})

    existing_queries = {item["query"] for item in merged}
    if room is not None:
        for df in room.defaultFurniture:
            dq = df.query
            if dq in existing_queries:
                continue
            if "桌" in dq and total_dining_tables > 0:
                continue
            if "椅" in dq and any("椅" in q for q in existing_queries):
                continue
            if "餐边柜" in dq and any("餐边柜" in q for q in existing_queries):
                continue
            if "绿植" in dq and any("绿植" in q for q in existing_queries):
                continue
            merged.append({"query": dq, "count": df.count})
            existing_queries.add(dq)

    if style_pack:
        for dec in style_pack.get("decorQueries", []):
            dq = dec["query"]
            if room and room.id in dec.get("rooms", ()) and dq not in existing_queries:
                if "餐边柜" in dq and any("餐边柜" in q for q in existing_queries):
                    continue
                if "绿植" in dq and any("绿植" in q for q in existing_queries):
                    continue
                if len(merged) < 7:
                    merged.append({"query": dq, "count": dec["count"]})
                    existing_queries.add(dq)
                    existing_queries.add(dec["query"])

    return merged, total_dining_tables


def _dimension_from_quote(quote: str) -> Dimension | None:
    match = re.search(
        r"(\d+(?:\.\d+)?)\s*(毫米|mm|厘米|cm|米|m)(?![a-zA-Z])",
        quote,
        re.IGNORECASE,
    )
    if not match:
        return None
    return Dimension(
        value=float(match.group(1)),
        unit=_UNIT_ALIASES[match.group(2).casefold()],
    )


def resolve_request(value: dict, user_input: str) -> dict:
    """Preserve raw units; support strict mode by default and architectural prior auto-completion in autonomous mode."""
    request = GenerationRequest.model_validate(value)
    autonomous = is_autonomous_delegation(user_input)
    style_pack = match_style_pack(request.style, user_input)

    room = get_scene_registry().room(request.purpose) if request.purpose else None
    if room is None and request.purpose:
        label_id = get_scene_registry().room_type_for_label(request.purpose)
        if label_id != "other":
            room = get_scene_registry().room(label_id)
    if room is None and autonomous:
        inferred_id = _infer_room_purpose_from_text(user_input)
        room = get_scene_registry().room(inferred_id)
        if room is not None:
            request.purpose = room.id

    if request.purpose and room is None and not autonomous:
        supported = "、".join(item["label"] for item in get_scene_registry().public_rooms())
        return {
            "brief": {},
            "furniture": [],
            "style": request.style or (style_pack["label"] if style_pack else "简约中性配色"),
            "missing": [],
            "defaults": [],
            "evidence": request.evidence,
            "unsupported": True,
            "question": f"未知房间类型：{request.purpose}；当前支持：{supported}",
            "skillSelection": request.skillSelection.model_dump(),
        }
    if room is not None and room.status != "active":
        return {
            "brief": {},
            "furniture": [],
            "style": request.style or "简约中性配色",
            "missing": [],
            "defaults": [],
            "evidence": request.evidence,
            "unsupported": True,
            "question": f"{room.label}仍处于 reserved 状态，尚未通过真实房间生成验收",
            "skillSelection": request.skillSelection.model_dump(),
        }

    missing = []
    labels = {
        "purpose": "房间用途",
        "width": "横向净宽",
        "depth": "纵向净深",
        "doors": "入口墙面与位置",
        "windows": "是否有窗及窗的位置",
    }
    for key, label in labels.items():
        supplied = getattr(request, key)
        quote = request.evidence.get(key, "")
        if supplied is None and key in ("width", "depth") and quote and quote in user_input:
            supplied = _dimension_from_quote(quote)
            if supplied is not None:
                setattr(request, key, supplied)
        if supplied is None or not quote or quote not in user_input:
            if not (autonomous and key == "purpose" and room is not None):
                missing.append(label)
                setattr(request, key, None)
    if request.doors == []:
        missing.append("至少一个入口的位置")
    for kind, openings in (("入口", request.doors), ("窗", request.windows)):
        for i, opening in enumerate(openings or []):
            if (
                opening.side is None
                or opening.position is None
                or (opening.position == "offset" and opening.offset is None)
            ):
                if autonomous and opening.side is not None:
                    opening.position = "center"
                    opening.offset = None
                else:
                    missing.append(f"{kind}{i + 1}的墙面与位置（居中或距左/上墙的距离）")
    missing.extend(request.conflicts)
    if request.status == "clarify" and request.question and not missing and not autonomous:
        missing.append(request.question)

    defaults = []
    furniture = [a.model_dump() for a in request.furniture]

    if autonomous and room is not None:
        furniture, total_tables = _enrich_autonomous_furniture(
            furniture, room, user_input, style_pack
        )
        prior_w, prior_d = _ROOM_PRIORS_M.get(room.id, (5.4, 4.2))
        if total_tables >= 3:
            prior_w, prior_d = max(prior_w, 9.8), max(prior_d, 6.4)
        elif total_tables == 2:
            prior_w, prior_d = max(prior_w, 7.8), max(prior_d, 5.6)

        if request.width is None:
            request.width = Dimension(value=prior_w, unit="m")
            defaults.append(f"自主补全横向净宽 {prior_w} m")
        if request.depth is None:
            request.depth = Dimension(value=prior_d, unit="m")
            defaults.append(f"自主补全纵向净深 {prior_d} m")
        if not request.doors:
            request.doors = [OpeningBrief(side="south", position="center")]
            defaults.append("自主设置南墙居中入口门洞")
        if request.windows is None:
            request.windows = [OpeningBrief(side="north", position="center")]
            defaults.append("自主设置北墙居中采光窗")
        missing = [m for m in missing if m in request.conflicts]
        request.status = "ready"
        defaults.append("已按自主发挥模式配齐核心家具与软装搭配")
    else:
        if not furniture and room is not None:
            furniture = [item.model_dump() for item in room.defaultFurniture]
            defaults.append("采用该用途的基础家具清单，数量可在对话中调整")

    for key, text in (("height", "层高 2800 mm"), ("wallThickness", "墙厚 200 mm")):
        if getattr(request, key) is None:
            defaults.append(text)
    resolved_style = (
        style_pack["label"]
        if style_pack
        else (request.style or "简约中性配色")
    )
    if not request.style and not style_pack:
        defaults.append("简约中性配色")
    elif style_pack:
        defaults.append(f"套用「{style_pack['label']}」硬装材质与三维家具风格包")

    brief = request.model_dump(
        exclude_none=True,
        include={
            "purpose",
            "name",
            "width",
            "depth",
            "height",
            "wallThickness",
            "doors",
            "windows",
        },
    )
    if room is not None:
        brief.update(
            roomType=room.id,
            roomName=room.label,
            floorMaterial=style_pack["floorMaterial"] if style_pack else room.floorMaterial,
            wallMaterial=style_pack["wallMaterial"] if style_pack else room.wallMaterial,
        )
    return {
        "brief": brief,
        "furniture": furniture,
        "style": resolved_style,
        **({"styleId": style_pack["id"], "styleGuidance": style_pack["promptGuidance"]} if style_pack else {}),
        "autonomous": autonomous,
        "missing": list(dict.fromkeys(missing)),
        "defaults": defaults,
        "evidence": request.evidence,
        "unsupported": (request.status == "unsupported") and not autonomous,
        "question": request.question,
        "skillSelection": request.skillSelection.model_dump(),
    }
