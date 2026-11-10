"""Code-level deterministic fallback for whole-home rectangular rooms.

The fallback reuses the positive L3 examples as pinned layout templates and
scales their positions into the frozen rectangular shell. It never invents new
catalogue keys: every create key must already be in the candidate scope.
"""

from __future__ import annotations

import json
from pathlib import Path

TEMPLATES = {
    "master_bedroom": ("master-bedroom", "MBR-dev-01"),
    "guest_bedroom": ("guest-bedroom", "GBR-dev-01"),
    "study": ("home-office", "HOF-dev-01"),
    "kitchen": ("kitchen-line-l-u", "KIT-dev-01"),
    "bathroom": ("bathroom-standard", "BAT-dev-01"),
    "entry": ("entry-storage", "ENT-dev-01"),
}

SKILLS = Path(__file__).resolve().parent / "skills"


def _polygon_box(points):
    xs = [float(point[0]) for point in points]
    ys = [float(point[1]) for point in points]
    return min(xs), min(ys), max(xs), max(ys)


def _plan(layout):
    return layout.get("plan", layout) if isinstance(layout, dict) else {}


def _target_box(layout, generation):
    plan = _plan(layout)
    rooms = plan.get("rooms") or []
    if rooms and rooms[0].get("polygon"):
        return _polygon_box(rooms[0]["polygon"])
    dims = generation.get("dimensions") or {}
    if dims.get("width") and dims.get("depth"):
        return 0.0, 0.0, float(dims["width"]), float(dims["depth"])
    return None


def _template_box(scene):
    rooms = scene.get("rooms") or []
    if rooms and rooms[0].get("polygon"):
        return _polygon_box(rooms[0]["polygon"])
    nodes = scene.get("walls") or []
    points = [point for wall in nodes for point in (wall.get("a"), wall.get("b"))]
    if points:
        return _polygon_box(points)
    return None


def _load_template(room_type):
    item = TEMPLATES.get(room_type)
    if not item:
        return None
    skill, case = item
    path = SKILLS / skill / "examples" / case / "ops.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if data.get("kind") != "positive" or not (data.get("expect") or {}).get("pass"):
        return None
    return data


def _generic_room(room_type, target, allow):
    """Last-resort layouts for rooms without a positive Skill example."""
    x0, y0, x1, y1 = target
    width, depth = x1 - x0, y1 - y0
    edits = []
    if room_type == "circulation":
        for key, x, y, rot in (
            ("consoleTable", x0 + width / 2, y0 + 350, 0),
            ("plant", x0 + width - 350, y1 - 450, 0),
        ):
            if key in allow:
                edits.append(
                    {
                        "type": "create",
                        "key": key,
                        "values": {"x": x, "y": y, "rot": rot},
                    }
                )
    return edits


def deterministic_proposal(task: dict, layout: dict, scope: dict) -> dict | None:
    generation = task.get("generation") or {}
    brief = generation.get("brief") or generation.get("frozenBrief") or {}
    room_type = brief.get("roomType") or brief.get("purpose") or ""
    if room_type in ("living_dining", "reading_lounge"):
        room_type = "circulation" if room_type == "circulation" else room_type
    target = _target_box(layout, generation)
    allow = set(scope.get("allowAddKeys") or [])
    if not target or not allow:
        return None
    template = _load_template(room_type)
    if template is None:
        edits = _generic_room(room_type, target, allow)
        return (
            {"summary": f"确定性兜底布局：{room_type}", "edits": edits}
            if edits
            else None
        )
    scene = template.get("scene") or {}
    source = _template_box(scene)
    if not source:
        return None
    sx = (target[2] - target[0]) / max(1.0, source[2] - source[0])
    sy = (target[3] - target[1]) / max(1.0, source[3] - source[1])
    edits = []
    for edit in template.get("edits") or []:
        if edit.get("op") != "add":
            continue
        raw = edit.get("object") or {}
        key = raw.get("key")
        if key not in allow:
            continue
        at = raw.get("at") or [0, 0]
        values = {
            "x": target[0] + (float(at[0]) - source[0]) * sx,
            "y": target[1] + (float(at[1]) - source[1]) * sy,
            "rot": float(raw.get("rot") or 0),
        }
        for field in ("w", "d", "h", "color"):
            if raw.get(field) is not None:
                values[field] = raw[field]
        # The shell has no pre-existing host objects; surface metadata from the
        # example is only reusable when this exact host is in the target.
        if raw.get("on"):
            continue
        edits.append({"type": "create", "key": key, "values": values})
    if not edits:
        edits = _generic_room(room_type, target, allow)
    return (
        {"summary": f"确定性兜底布局：{room_type}", "edits": edits}
        if edits
        else None
    )


ASSET_KEYWORDS = {
    "床": "bed18",
    "双人床": "bed18",
    "床头柜": "nightstand",
    "衣柜": "wardrobe",
    "书桌": "desk",
    "办公椅": "officeChair",
    "书柜": "cabTall",
    "书架": "cabTall",
    "橱柜": "lCounter",
    "冰箱": "fridge",
    "马桶": "toilet",
    "浴室柜": "vanity",
    "淋浴房": "shower",
    "鞋柜": "cabShoe",
    "换鞋凳": "entryBench",
    "玄关桌": "consoleTable",
    "绿植": "plant",
}


def deterministic_assets(intent: dict, catalogue: dict) -> dict | None:
    """Map common Chinese furniture requests to real catalog keys."""
    choices = []
    for index, addition in enumerate(intent.get("additions") or []):
        query = str(addition.get("query") or "")
        key = next(
            (
                value
                for token, value in sorted(
                    ASSET_KEYWORDS.items(), key=lambda item: -len(item[0])
                )
                if token in query
            ),
            None,
        )
        if key is None or key not in catalogue:
            matches = [
                item
                for item in catalogue.values()
                if query and query.casefold() in (item.get("name", "") + item.get("type", "")).casefold()
            ]
            key = matches[0]["key"] if matches else None
        if key is None:
            return None
        choices.append(
            {
                "request_index": index,
                "key": key,
                "reason": "确定性资产兜底",
            }
        )
    return {"choices": choices} if choices else None
