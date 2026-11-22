"""Deterministic neuro-symbolic layout harmonizer & fast-track synthesizer for autonomous generation."""

from __future__ import annotations

import copy
from typing import Any

_TABLE_KEYS = {
    "diningTable",
    "diningTable4",
    "diningTable6",
    "diningTable8",
    "roundTable",
    "ovalTable",
    "teaTable",
    "squareTable",
    "barTable",
}

_CHAIR_KEYS = {
    "chair",
    "armDiningChair",
    "diningChair",
    "teaChair",
    "teaStool",
    "barStool",
}

_WALL_ART_KEYS = {"wallArt", "wallArt3"}

_OPENABLE_KEYS = {
    "sideboard",
    "customSideboard",
    "displayCab",
    "tvCabinet",
    "bookshelf",
    "bookshelfLow",
    "cabSlide",
    "wardrobe",
    "shoeCabinet",
    "dresser",
    "nightstand",
}

_CORNER_DECOR_KEYS = {"plant", "bigPlant", "floorLamp"}


def synthesize_initial_proposal_from_scope(
    scope: dict[str, Any],
    catalogue: dict[str, dict[str, Any]],
    dimensions: dict[str, Any],
) -> dict[str, Any]:
    """Build a complete create-edit proposal directly from asset requirements and harmonize geometry."""
    edits: list[dict[str, Any]] = []
    for req in scope.get("requirements") or []:
        keys = req.get("keys") or ([req["key"]] if req.get("key") else [])
        if not keys:
            continue
        key = keys[0]
        count = int(req.get("count") or 1)
        for _ in range(count):
            edits.append({
                "type": "create",
                "key": key,
                "values": {"x": 2000, "y": 2000, "rot": 0},
            })
    raw_proposal = {
        "summary": "按建筑尺度先验与中轴对称美学完成成套家具与软装排布，留足开启包络与环绕通道。",
        "edits": edits,
    }
    return harmonize_autonomous_proposal(raw_proposal, catalogue, dimensions)


def harmonize_autonomous_proposal(
    proposal: dict[str, Any],
    catalogue: dict[str, dict[str, Any]],
    dimensions: dict[str, Any],
) -> dict[str, Any]:
    """Return a copy of proposal with collision-free, inward-facing coordinates."""
    room_w = float(dimensions.get("width") or 0)
    room_d = float(dimensions.get("depth") or 0)
    if room_w < 2000 or room_d < 2000:
        return proposal

    out = copy.deepcopy(proposal)
    edits: list[dict[str, Any]] = out.get("edits") or []
    if not edits:
        return out

    def _spec(k: str) -> dict[str, Any]:
        return catalogue.get(k) or {}

    table_edits = [
        e for e in edits
        if e.get("type") == "create"
        and (e.get("key") in _TABLE_KEYS or _spec(e.get("key", "")).get("type") in ("diningTable", "roundTable", "teaTable"))
    ]
    chair_edits = [
        e for e in edits
        if e.get("type") == "create"
        and (e.get("key") in _CHAIR_KEYS or "餐椅" in str(_spec(e.get("key", "")).get("name", "")))
    ]
    art_edits = [
        e for e in edits
        if e.get("type") == "create"
        and (e.get("key") in _WALL_ART_KEYS or _spec(e.get("key", "")).get("type") == "wallArt")
    ]
    cabinet_edits = [
        e for e in edits
        if e.get("type") == "create"
        and (e.get("key") in _OPENABLE_KEYS or _spec(e.get("key", "")).get("type") in ("sideboard", "wardrobe", "bookshelf", "tvCabinet"))
    ]
    corner_edits = [
        e for e in edits
        if e.get("type") == "create"
        and (e.get("key") in _CORNER_DECOR_KEYS or _spec(e.get("key", "")).get("type") in ("plant", "floorLamp"))
    ]

    # 1. Harmonize dining tables + adaptive chair arrangement
    if table_edits:
        n_t = len(table_edits)
        # Keep tables in central banquet band (min y=2950 when cabinets exist so North sideboard has >=850mm front clearance!)
        y_table = int(round(max(room_d * 0.50, 2950.0 if cabinet_edits and room_d >= 5600 else room_d * 0.47)))
        max_tw = max(float(_spec(te["key"]).get("w") or 1350) for te in table_edits)
        sample_cd = float(_spec(chair_edits[0]["key"]).get("d") or 560) if chair_edits else 560.0
        gap = 85.0

        # Check if 4-way (N/S/E/W) chairs fit horizontally across all N tables with >=260mm gap between chair backs
        ew_group_w = max_tw + 2.0 * (sample_cd + gap)
        use_four_way = (n_t * ew_group_w + max(0, n_t - 1) * 260.0) <= (room_w - 500.0)

        if n_t >= 2:
            margin_x = (ew_group_w / 2 + 280.0) if use_four_way else (max_tw / 2 + 450.0)
            span_x = max(1000.0, room_w - 2.0 * margin_x)
            for idx, te in enumerate(table_edits):
                vals = te.setdefault("values", {})
                vals["x"] = int(round(margin_x + (span_x * idx / (n_t - 1))))
                vals["y"] = y_table
                vals["rot"] = 0
        else:
            vals = table_edits[0].setdefault("values", {})
            tx = float(vals.get("x") or room_w / 2)
            ty = float(vals.get("y") or y_table)
            vals["x"] = int(round(max(1350.0, min(room_w - 1350.0, tx))))
            vals["y"] = int(round(max(1650.0, min(room_d - 1850.0, ty))))
            vals["rot"] = 0

        if chair_edits:
            for c_idx, ce in enumerate(chair_edits):
                t_idx = c_idx % n_t
                slot = c_idx // n_t
                te = table_edits[t_idx]
                t_spec = _spec(te["key"])
                tw = float(t_spec.get("w") or 1350)
                td = float(t_spec.get("d") or 1350)
                tx = float(te["values"]["x"])
                ty = float(te["values"]["y"])

                c_spec = _spec(ce["key"])
                cw = float(c_spec.get("w") or 540)
                cd = float(c_spec.get("d") or 560)
                c_vals = ce.setdefault("values", {})

                if use_four_way:
                    if slot == 0:
                        c_vals.update(x=int(round(tx)), y=int(round(ty - td / 2 - cd / 2 - gap)), rot=0)
                    elif slot == 1:
                        c_vals.update(x=int(round(tx)), y=int(round(ty + td / 2 + cd / 2 + gap)), rot=180)
                    elif slot == 2:
                        c_vals.update(x=int(round(tx - tw / 2 - cd / 2 - gap)), y=int(round(ty)), rot=270)
                    else:
                        c_vals.update(x=int(round(tx + tw / 2 + cd / 2 - gap)), y=int(round(ty)), rot=90)
                else:
                    # 2 chairs North + 2 chairs South (ideal for wide rectangular tables in multi-table rows)
                    dx = max(cw / 2 + 70.0, min(tw / 2 - cw / 2 - 40.0, tw * 0.26))
                    if slot == 0:
                        c_vals.update(x=int(round(tx - dx)), y=int(round(ty - td / 2 - cd / 2 - gap)), rot=0)
                    elif slot == 1:
                        c_vals.update(x=int(round(tx + dx)), y=int(round(ty - td / 2 - cd / 2 - gap)), rot=0)
                    elif slot == 2:
                        c_vals.update(x=int(round(tx - dx)), y=int(round(ty + td / 2 + cd / 2 + gap)), rot=180)
                    else:
                        c_vals.update(x=int(round(tx + dx)), y=int(round(ty + td / 2 + cd / 2 + gap)), rot=180)

    # 2. Harmonize wall art onto clear West/East wall at eye level z=1480
    for idx, ae in enumerate(art_edits):
        a_vals = ae.setdefault("values", {})
        a_vals["z"] = 1480
        if idx % 2 == 0:
            a_vals.update(x=75, y=int(round(room_d * 0.50)), rot=270)
        else:
            a_vals.update(x=int(round(room_w - 75)), y=int(round(room_d * 0.50)), rot=90)

    # 3. Harmonize openable cabinets (inward rotation + clear of centered North window & centered South door)
    for idx, cab in enumerate(cabinet_edits):
        spec = _spec(cab["key"])
        fw = float(spec.get("w") or 1600)
        fd = float(spec.get("d") or 450)
        fh = float(spec.get("h") or 900)
        vals = cab.setdefault("values", {})

        if table_edits and len(table_edits) >= 2:
            safe_x = min(room_w / 2 - 950 - fw / 2, max(fw / 2 + 850, 2000.0))
            if safe_x < fw / 2 + 250:
                safe_x = fw / 2 + 250
            vals["x"] = int(round(safe_x if idx % 2 == 0 else room_w - safe_x))
            vals["y"] = int(round(fd / 2 + 50))
            vals["rot"] = 0
            continue

        cx = float(vals.get("x") or room_w / 2)
        cy = float(vals.get("y") or fd / 2 + 50)
        dists = [
            ("north", cy),
            ("south", room_d - cy),
            ("west", cx),
            ("east", room_w - cx),
        ]
        nearest_wall = min(dists, key=lambda item: item[1])[0]
        if nearest_wall == "west":
            vals["rot"] = 270
            vals["x"] = int(round(fd / 2 + 50))
            vals["y"] = int(round(max(fw / 2 + 650, min(room_d - fw / 2 - 650, cy))))
        elif nearest_wall == "east":
            vals["rot"] = 90
            vals["x"] = int(round(room_w - fd / 2 - 50))
            vals["y"] = int(round(max(fw / 2 + 650, min(room_d - fw / 2 - 650, cy))))
        elif nearest_wall == "north":
            vals["rot"] = 0
            vals["y"] = int(round(fd / 2 + 50))
            if fh > 850 and abs(cx - room_w / 2) < (850 + fw / 2):
                cx = max(fw / 2 + 300, room_w / 2 - 950 - fw / 2)
            vals["x"] = int(round(max(fw / 2 + 250, min(room_w - fw / 2 - 250, cx))))
        else:
            vals["rot"] = 180
            vals["y"] = int(round(room_d - fd / 2 - 50))
            if abs(cx - room_w / 2) < (950 + fw / 2):
                cx = max(fw / 2 + 300, room_w / 2 - 1050 - fw / 2)
            vals["x"] = int(round(max(fw / 2 + 250, min(room_w - fw / 2 - 250, cx))))

    # 4. Place plants / floor lamps into clean room corners (clear of North-West sideboard if placed at x~2000)
    corners = [
        (int(round(room_w - 480)), 480),
        (480, int(round(room_d - 480))),
        (int(round(room_w - 480)), int(round(room_d - 480))),
        (480, 480),
    ]
    for idx, ce in enumerate(corner_edits):
        cx, cy = corners[idx % len(corners)]
        c_vals = ce.setdefault("values", {})
        c_vals.update(x=cx, y=cy, rot=0)

    return out
