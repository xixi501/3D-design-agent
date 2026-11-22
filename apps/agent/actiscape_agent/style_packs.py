"""Structured Style Theme Packs bridging user style intent, Skill modifiers, and 3D scene materials/geometry."""

from __future__ import annotations

from typing import Any

STYLE_PACKS: dict[str, dict[str, Any]] = {
    "european": {
        "id": "european",
        "label": "欧式古典",
        "furnitureStyle": "luxury",
        "floorMaterial": "marble",
        "wallMaterial": "latexWarm",
        "ceiling": {"type": "edge", "drop": 160, "edgeW": 400, "cove": True},
        "modifierSkills": ["style-coherence", "lighting-color"],
        "keywords": ("欧式", "法式古典", "宫廷", "轻奢", "美式", "古典", "巴洛克", "european", "luxury", "classic"),
        "diningChairQuery": "扶手餐椅",
        "decorQueries": [
            {"query": "定制餐边柜", "count": 1, "rooms": ("dining_hall", "living_dining")},
            {"query": "装饰画", "count": 1, "rooms": ("dining_hall", "living_dining", "master_bedroom", "study", "reading_lounge")},
            {"query": "大型绿植", "count": 1, "rooms": ("dining_hall", "living_dining", "reading_lounge")},
            {"query": "落地灯", "count": 1, "rooms": ("living_dining", "master_bedroom", "reading_lounge", "study")},
        ],
        "promptGuidance": "欧式古典/轻奢风：讲求中轴对称与仪式感，选用胡桃木鎏金质感（luxury）、扶手餐椅、餐边柜、边吊灯槽与装饰画点缀，留足宽敞环绕动线。",
    },
    "chinese": {
        "id": "chinese",
        "label": "新中式",
        "furnitureStyle": "chinese",
        "floorMaterial": "#7c583c",
        "wallMaterial": "latexWarm",
        "ceiling": {"type": "edge", "drop": 140, "edgeW": 360, "cove": True},
        "modifierSkills": ["style-coherence", "lighting-color"],
        "keywords": ("新中式", "中式", "现代东方", "东方", "禅意", "国风", "宋式", "明式", "茶韵", "chinese"),
        "diningChairQuery": "扶手餐椅",
        "decorQueries": [
            {"query": "展示柜", "count": 1, "rooms": ("tea_room", "study", "living_dining", "dining_hall")},
            {"query": "绿植", "count": 1, "rooms": ("tea_room", "living_dining", "dining_hall", "study")},
            {"query": "装饰画", "count": 1, "rooms": ("tea_room", "living_dining", "master_bedroom", "study")},
            {"query": "落地灯", "count": 1, "rooms": ("tea_room", "living_dining", "master_bedroom")},
        ],
        "promptGuidance": "新中式雅致风：采用深胡桃木框与格栅铜饰（chinese），遵循主次对称与留白借景，搭配博古展示柜、茶席器物、绿植与国风挂画。",
    },
    "modern": {
        "id": "modern",
        "label": "现代极简",
        "furnitureStyle": "modern",
        "floorMaterial": "oak",
        "wallMaterial": "latexWhite",
        "ceiling": {"type": "flat", "drop": 80, "edgeW": 300, "cove": False},
        "modifierSkills": ["style-coherence", "lighting-color"],
        "keywords": ("现代极简", "暖木极简", "现代简约", "现代", "极简", "简约", "工业风", "modern", "minimal"),
        "diningChairQuery": "餐椅",
        "decorQueries": [
            {"query": "落地灯", "count": 1, "rooms": ("living_dining", "reading_lounge", "master_bedroom", "study")},
            {"query": "装饰画", "count": 1, "rooms": ("living_dining", "dining_hall", "study")},
            {"query": "绿植", "count": 1, "rooms": ("living_dining", "dining_hall", "study")},
        ],
        "promptGuidance": "现代极简风：强调干净利落的几何线条与高柜贴墙收纳，采用中性灰白与暖橡木对比（modern），保持中心开阔留白。",
    },
    "japanese": {
        "id": "japanese",
        "label": "日式原木",
        "furnitureStyle": "japanese",
        "floorMaterial": "oak",
        "wallMaterial": "latexWarm",
        "ceiling": {"type": "none", "drop": 0, "edgeW": 300, "cove": False},
        "modifierSkills": ["style-coherence", "lighting-color"],
        "keywords": ("日式原木", "日式", "原木", "北欧", "侘寂", "自然原木", "muji", "japanese", "nordic", "wabi"),
        "diningChairQuery": "餐椅",
        "decorQueries": [
            {"query": "矮书架", "count": 1, "rooms": ("reading_lounge", "study", "multipurpose")},
            {"query": "绿植", "count": 1, "rooms": ("living_dining", "dining_hall", "tea_room", "master_bedroom")},
            {"query": "落地灯", "count": 1, "rooms": ("living_dining", "master_bedroom", "reading_lounge")},
        ],
        "promptGuidance": "日式原木/侘寂风：采用低矮重心家具与温润浅原木色系（japanese），减少高大压迫感，注重自然采光与通透呼吸感。",
    },
    "cream": {
        "id": "cream",
        "label": "法式奶油",
        "furnitureStyle": "cream",
        "floorMaterial": "#e5dacb",
        "wallMaterial": "#f6f1ea",
        "ceiling": {"type": "edge", "drop": 120, "edgeW": 340, "cove": True},
        "modifierSkills": ["style-coherence", "lighting-color"],
        "keywords": ("法式奶油", "奶油自然", "奶油风", "奶油", "温柔风", "侘寂奶油", "cream"),
        "diningChairQuery": "餐椅",
        "decorQueries": [
            {"query": "纱帘", "count": 1, "rooms": ("living_dining", "master_bedroom", "media_room", "dining_hall")},
            {"query": "圆地毯", "count": 1, "rooms": ("living_dining", "media_room", "reading_lounge")},
            {"query": "落地灯", "count": 1, "rooms": ("living_dining", "master_bedroom", "media_room")},
        ],
        "promptGuidance": "法式奶油风：采用高圆润度羊羔绒米杏色调（cream），搭配柔纱窗帘、圆润茶几地毯与柔和漫反射灯槽。",
    },
    "aging_care": {
        "id": "aging_care",
        "label": "适老康养",
        "furnitureStyle": "nordic",
        "floorMaterial": "oak",
        "wallMaterial": "latexWarm",
        "ceiling": {"type": "flat", "drop": 80, "edgeW": 300, "cove": True},
        "modifierSkills": ["aging-friendly", "lighting-color"],
        "keywords": ("适老康养", "适老化", "适老", "康养", "养老", "老人", "无障碍", "轮椅", "鸿蒙看护", "elderly"),
        "diningChairQuery": "扶手餐椅",
        "decorQueries": [
            {"query": "扶手餐椅", "count": 1, "rooms": ("master_bedroom", "guest_bedroom")},
        ],
        "enableSafetyProfile": True,
        "promptGuidance": "适老无障碍康养风：家具全部贴墙布置以释放中心 >=1500mm 轮椅回转圆与 >=900mm 通道，禁铺易绊倒松散地毯，高柜避开床头与门洞并入墙锚固。",
    },
}


def match_style_pack(style_text: str | None, user_input: str = "") -> dict[str, Any] | None:
    """Resolve user style description or prompt text into a structured Style Theme Pack."""
    combined = f"{style_text or ''} {user_input or ''}".strip().lower()
    if not combined:
        return None
    # Check explicit aging/wheelchair cues first if strongly emphasized, unless explicit aesthetic style overrides
    for pack_id in ("european", "chinese", "cream", "japanese", "aging_care", "modern"):
        pack = STYLE_PACKS[pack_id]
        if any(kw.lower() in combined for kw in pack["keywords"]):
            return dict(pack)
    return None


def list_public_style_packs() -> list[dict[str, Any]]:
    return [
        {
            "id": p["id"],
            "label": p["label"],
            "furnitureStyle": p["furnitureStyle"],
            "floorMaterial": p["floorMaterial"],
            "wallMaterial": p["wallMaterial"],
            "modifierSkills": p["modifierSkills"],
        }
        for p in STYLE_PACKS.values()
    ]
