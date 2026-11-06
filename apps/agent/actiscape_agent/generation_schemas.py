from typing import Literal

from pydantic import Field, FiniteFloat, field_validator

from .schemas import Addition, AssetChoice, AssetSelection, StrictModel


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
    purpose: Literal["living_dining", "reading_lounge"] | None = None
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


DEFAULT_FURNITURE = {
    "living_dining": [
        ("三人沙发", 1),
        ("茶几", 1),
        ("电视柜", 1),
        ("餐桌", 1),
        ("餐椅", 4),
        ("落地灯", 1),
    ],
    "reading_lounge": [("单人沙发", 2), ("茶几", 1), ("书柜", 1), ("落地灯", 1)],
}


def resolve_request(value: dict, user_input: str) -> dict:
    """Preserve raw units; geometry and conversion remain in TypeScript."""
    request = GenerationRequest.model_validate(value)
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
    if not furniture and request.purpose:
        furniture = [{"query": q, "count": n} for q, n in DEFAULT_FURNITURE[request.purpose]]
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
    return {
        "brief": brief,
        "furniture": furniture,
        "style": request.style or "简约中性配色",
        "missing": list(dict.fromkeys(missing)),
        "defaults": defaults,
        "evidence": request.evidence,
        "unsupported": request.status == "unsupported",
        "question": request.question,
    }
