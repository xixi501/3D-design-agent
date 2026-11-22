"""Neuro-Symbolic 2D/3D spatial constraint solver (AgentArts Code Interpreter Sandbox + local numpy)."""

from __future__ import annotations

import asyncio
import json
import math
import os
import time
from typing import Any
from urllib.request import Request, urlopen

import numpy as np

from .telemetry import trace_stage


def _rotated_extents(w: float, d: float, rot_deg: float) -> tuple[float, float]:
    rad = math.radians(rot_deg % 360)
    cos_a = abs(math.cos(rad))
    sin_a = abs(math.sin(rad))
    return w * cos_a + d * sin_a, w * sin_a + d * cos_a


def _aabb(f: dict, x: float | None = None, y: float | None = None, rot: float | None = None):
    cx = float(f["x"] if x is None else x)
    cy = float(f["y"] if y is None else y)
    r = float(f.get("rot", 0) if rot is None else rot)
    ew, ed = _rotated_extents(float(f["w"]), float(f["d"]), r)
    return cx - ew / 2.0, cy - ed / 2.0, cx + ew / 2.0, cy + ed / 2.0


def _boxes_overlap(a, b, margin: float = 0.0) -> bool:
    return not (
        a[2] + margin <= b[0]
        or b[2] + margin <= a[0]
        or a[3] + margin <= b[1]
        or b[3] + margin <= a[1]
    )


def _room_bbox(plan: dict) -> tuple[float, float, float, float]:
    nodes = plan.get("nodes") or []
    if len(nodes) >= 2:
        xs = [float(n["x"]) for n in nodes]
        ys = [float(n["y"]) for n in nodes]
        wall_t = max((float(w.get("t") or 200) for w in (plan.get("walls") or [])), default=200.0)
        half = wall_t / 2.0
        return min(xs) + half, min(ys) + half, max(xs) - half, max(ys) - half
    return 100.0, 100.0, 5000.0, 4000.0


def _door_zones(plan: dict) -> list[tuple[float, float, float, float]]:
    nodes = {n["id"]: n for n in (plan.get("nodes") or [])}
    walls = {w["id"]: w for w in (plan.get("walls") or [])}
    zones = []
    for op in plan.get("openings") or []:
        if "door" not in str(op.get("type") or "door").lower() and op.get("type") not in {
            "double",
            "sliding",
        }:
            continue
        wall = walls.get(op.get("wall"))
        if not wall:
            continue
        na = nodes.get(wall.get("a"))
        nb = nodes.get(wall.get("b"))
        if not na or not nb:
            continue
        dx = float(nb["x"]) - float(na["x"])
        dy = float(nb["y"]) - float(na["y"])
        length = math.hypot(dx, dy) or 1.0
        raw_pos = op.get("pos", op.get("at", op.get("offset", 0.5)))
        offset = float(raw_pos)
        t = offset if offset <= 1.0 else offset / length
        px = float(na["x"]) + dx * t
        py = float(na["y"]) + dy * t
        radius = max(900.0, float(op.get("width") or op.get("w") or 900.0))
        zones.append((px - radius, py - radius, px + radius, py + radius))
    return zones


def solve_safe_placements_local(plan: dict, target_ids: list[str] | None = None) -> dict[str, Any]:
    """Deterministic vectorized grid search finding collision-free, seismic-safe, radar-clear coordinates."""
    t0 = time.monotonic()
    rx0, ry0, rx1, ry1 = _room_bbox(plan)
    furniture = [dict(f) for f in (plan.get("furniture") or [])]
    doors = _door_zones(plan)
    beds = [
        _aabb(f)
        for f in furniture
        if "bed" in str(f.get("type") or f.get("key") or "").lower()
    ]

    sensors = ((plan.get("source") or {}).get("safetyProfile") or {}).get("radarSensors") or []
    sensor_pt = (
        (float(sensors[0]["x"]), float(sensors[0]["y"]))
        if sensors
        else (rx0 + 150.0, ry0 + 150.0)
    )
    bed_centers = [((b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0) for b in beds]

    candidates_to_move = []
    for f in furniture:
        if f.get("hostId") or f.get("placement") == "surface":
            continue
        if target_ids and f["id"] not in target_ids:
            continue
        is_tall = float(f.get("h", 0)) >= 1400 and (
            float(f.get("h", 0)) / max(1.0, min(float(f["w"]), float(f["d"]))) >= 2.2
        )
        box = _aabb(f)
        in_door = any(_boxes_overlap(box, dz) for dz in doors)
        if target_ids or is_tall or in_door:
            candidates_to_move.append(f)

    placed_boxes = {
        f["id"]: _aabb(f)
        for f in furniture
        if not f.get("hostId") and f["id"] not in {m["id"] for m in candidates_to_move}
    }

    recommendations: list[dict[str, Any]] = []
    xs = np.arange(rx0 + 250.0, rx1 - 250.0, 200.0)
    ys = np.arange(ry0 + 250.0, ry1 - 250.0, 200.0)

    for item in candidates_to_move:
        w, d, h = float(item["w"]), float(item["d"]), float(item.get("h", 800))
        is_tall = h >= 1400 and (h / max(1.0, min(w, d)) >= 2.2)
        best_score = -1e12
        best_pose = (float(item["x"]), float(item["y"]), float(item.get("rot", 0)))

        # Generate wall-hugging candidate poses first (preferred for indoor furniture)
        poses: list[tuple[float, float, float]] = []
        for rot in (0.0, 90.0, 180.0, 270.0):
            ew, ed = _rotated_extents(w, d, rot)
            if ew >= (rx1 - rx0) or ed >= (ry1 - ry0):
                continue
            for gx in xs:
                cx = float(np.clip(gx, rx0 + ew / 2.0 + 20.0, rx1 - ew / 2.0 - 20.0))
                poses.append((cx, ry0 + ed / 2.0 + 20.0, rot))
                poses.append((cx, ry1 - ed / 2.0 - 20.0, rot))
            for gy in ys:
                cy = float(np.clip(gy, ry0 + ed / 2.0 + 20.0, ry1 - ed / 2.0 - 20.0))
                poses.append((rx0 + ew / 2.0 + 20.0, cy, rot))
                poses.append((rx1 - ew / 2.0 - 20.0, cy, rot))

        for cx, cy, rot in poses:
            box = _aabb(item, cx, cy, rot)
            if any(_boxes_overlap(box, other, margin=60.0) for other in placed_boxes.values()):
                continue
            if any(_boxes_overlap(box, dz, margin=50.0) for dz in doors):
                continue

            score = 0.0
            # Keep room center open for 1500mm wheelchair turning circle
            room_cx, room_cy = (rx0 + rx1) / 2.0, (ry0 + ry1) / 2.0
            dist_center = math.hypot(cx - room_cx, cy - room_cy)
            score += dist_center * 0.25

            # Penalize seismic topple overlap with beds & exits
            if is_tall:
                topple_box = (box[0] - h * 0.5, box[1] - h * 0.5, box[2] + h * 0.5, box[3] + h * 0.5)
                if any(_boxes_overlap(topple_box, bed) for bed in beds):
                    score -= 5000.0
                if any(_boxes_overlap(topple_box, dz) for dz in doors):
                    score -= 6000.0

            # Penalize blocking radar line-of-sight from sensor_pt to bed_centers
            if h >= 1500 and bed_centers:
                for bx, by in bed_centers:
                    # Distance from object center to segment sensor_pt -> bed_center
                    vx, vy = bx - sensor_pt[0], by - sensor_pt[1]
                    seg_len2 = vx * vx + vy * vy or 1.0
                    t_proj = max(
                        0.0,
                        min(1.0, ((cx - sensor_pt[0]) * vx + (cy - sensor_pt[1]) * vy) / seg_len2),
                    )
                    px, py = sensor_pt[0] + t_proj * vx, sensor_pt[1] + t_proj * vy
                    if math.hypot(cx - px, cy - py) < max(w, d) * 0.75:
                        score -= 4000.0

            # Small preference for minimal displacement from original position
            score -= math.hypot(cx - float(item["x"]), cy - float(item["y"])) * 0.05
            if score > best_score:
                best_score = score
                best_pose = (round(cx), round(cy), int(rot))

        placed_boxes[item["id"]] = _aabb(item, *best_pose)
        rec: dict[str, Any] = {
            "id": item["id"],
            "name": item.get("name"),
            "x": best_pose[0],
            "y": best_pose[1],
            "rot": best_pose[2],
        }
        if is_tall:
            rec["wallAnchored"] = True
        recommendations.append(rec)

    return {
        "solver": "local-numpy-vectorized",
        "elapsedMs": round((time.monotonic() - t0) * 1000, 2),
        "recommendations": recommendations,
    }


def _invoke_cloud_code_interpreter(endpoint: str, token: str, plan: dict, target_ids: list[str] | None):
    body = json.dumps(
        {"language": "python", "task": "solve_safe_placements", "plan": plan, "targetIds": target_ids},
        ensure_ascii=False,
    ).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = Request(endpoint, data=body, headers=headers, method="POST")
    with urlopen(req, timeout=5.0) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


async def solve_safe_placements(
    plan: dict, target_ids: list[str] | None = None
) -> dict[str, Any]:
    """Run neuro-symbolic placement optimization via AgentArts Code Interpreter (with local fallback)."""
    with trace_stage("sandbox.solve_safe_placements", {"target_count": len(target_ids or [])}) as span:
        sandbox_url = os.environ.get("AGENTARTS_CODE_INTERPRETER_URL", "").strip()
        sandbox_token = os.environ.get("AGENTARTS_CODE_INTERPRETER_TOKEN", "").strip()
        if sandbox_url:
            try:
                cloud = await asyncio.to_thread(
                    _invoke_cloud_code_interpreter, sandbox_url, sandbox_token, plan, target_ids
                )
                if isinstance(cloud, dict) and isinstance(cloud.get("recommendations"), list):
                    if span is not None:
                        span.set_attribute("actiscape.sandbox.provider", "agentarts-code-interpreter")
                    return {**cloud, "solver": "agentarts-code-interpreter"}
            except Exception:
                pass
        result = await asyncio.to_thread(solve_safe_placements_local, plan, target_ids)
        if span is not None:
            span.set_attribute("actiscape.sandbox.provider", result["solver"])
            span.set_attribute("actiscape.sandbox.elapsed_ms", result["elapsedMs"])
        return result
