import re
from typing import Literal

from pydantic import Field, FiniteFloat, field_validator

from .scene_registry import get_scene_registry
from .schemas import Addition, AssetChoice, AssetSelection, SkillSelection, StrictModel


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


def _dimension_from_quote(quote: str) -> Dimension | None:
    """Recover a dimension only when the model's own verbatim evidence has it.

    This is a code-side repair for a model that returns the evidence quote but
    leaves the structured value null. It never invents a dimension: the quote
    has already been checked to be a contiguous part of the user request.
    """
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
    """Preserve raw units; geometry and conversion remain in TypeScript."""
    request = GenerationRequest.model_validate(value)
    room = get_scene_registry().room(request.purpose) if request.purpose else None
    if room is None and request.purpose:
        # Accept the registry's human label as well as its stable room-type ID.
        label_id = get_scene_registry().room_type_for_label(request.purpose)
        if label_id != "other":
            room = get_scene_registry().room(label_id)
    if request.purpose and room is None:
        supported = "、".join(item["label"] for item in get_scene_registry().public_rooms())
        return {
            "brief": {},
            "furniture": [],
            "style": request.style or "简约中性配色",
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
                missing.append(f"{kind}{i + 1}的墙面与位置（居中或距左/上墙的距离）")
    missing.extend(request.conflicts)
    if request.status == "clarify" and request.question and not missing:
        missing.append(request.question)
    defaults = []
    for key, text in (("height", "层高 2800 mm"), ("wallThickness", "墙厚 200 mm")):
        if getattr(request, key) is None:
            defaults.append(text)
    if not request.style:
        defaults.append("简约中性配色")
    furniture = [a.model_dump() for a in request.furniture]
    if not furniture and room is not None:
        furniture = [item.model_dump() for item in room.defaultFurniture]
        defaults.append("采用该用途的基础家具清单，数量可在对话中调整")
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
            floorMaterial=room.floorMaterial,
            wallMaterial=room.wallMaterial,
        )
    return {
        "brief": brief,
        "furniture": furniture,
        "style": request.style or "简约中性配色",
        "missing": list(dict.fromkeys(missing)),
        "defaults": defaults,
        "evidence": request.evidence,
        "unsupported": request.status == "unsupported",
        "question": request.question,
        "skillSelection": request.skillSelection.model_dump(),
    }
