"""Hybrid VLM + OpenCV Edge-Snapped + 3-Tier Auto-Scale Full-Home Floorplan Reconstruction (Module E)."""

from __future__ import annotations

import base64
import io
import json
import math
import statistics
from pathlib import Path
from typing import Any

import cv2
import httpx
import numpy as np
from PIL import Image

from .config import state_directory, vision_model_settings
from .skill_registry import get_registry
from .style_packs import match_style_pack

HYBRID_PROMPT = """你是建筑户型图高精度结构化重建专家。请仔细观察输入的单层建筑平面图（可能为黑白CAD施工图或彩色房产营销彩平图），输出严格的 JSON 对象（不要包裹 Markdown 代码块，不要任何多余解释）。

坐标系规定：整张图片左上角为 (0, 0)，右下角为 (1000, 1000)，所有 x, y 均使用 [0, 1000] 整数归一化坐标。

请提取以下完整结构（必须覆盖图中所有可见封闭房间，不要遗漏厨卫、次卧、阳台与入户门窗）：
{
  "scaleInfo": {
    "outerWidthMm": <若图上有整层总横向尺寸数字如 10200 或各开间之和，填毫米整数，否则填 null>,
    "outerDepthMm": <若图上有整层总纵向进深数字如 12300 或各进深之和，填毫米整数，否则填 null>
  },
  "rooms": [
    {
      "name": "<房间中文名，如 客厅 / 餐厅 / 客餐厅 / 主卧 / 次卧 / 卧室 / 厨房 / 卫生间 / 书房 / 玄关 / 阳台>",
      "kind": "<living_dining | bedroom | study | kitchen | bathroom | entry | balcony>",
      "x1": <房间左墙中线 0..1000>,
      "y1": <房间上墙中线 0..1000>,
      "x2": <房间右墙中线 0..1000>,
      "y2": <房间下墙中线 0..1000>,
      "annotatedWidthMm": <若房间内或墙边标了该房间宽度如 3600 或 3.6m 转毫米，否则 null>,
      "annotatedDepthMm": <若标了进深毫米，否则 null>,
      "annotatedAreaM2": <若房间内写了面积如 14.5㎡ 则填 14.5，否则 null>
    }
  ],
  "openings": [
    {
      "type": "<door | sliding | window>",
      "x": <洞口中心 x 0..1000>,
      "y": <洞口中心 y 0..1000>,
      "span": <洞口沿墙宽度占整图千分比 20..280>,
      "orient": "<h 表示在水平横墙上 | v 表示在竖直纵墙上>"
    }
  ],
  "furniture": [
    {
      "key": "<严格从以下真实目录 key 选择：sofa | loveseat | coffeeTable | roundCoffee | tvCabinet | diningTable | diningTable4 | roundTable | chair | bed18 | bed15 | bed12 | nightstand | cabSlide | desk | officeChair | bookshelf | counter | fridge | vanity | toilet | shower | bathtub | shoeCabinet | plant>",
      "x": <家具中心 x 0..1000>,
      "y": <家具中心 y 0..1000>,
      "rot": <朝向角度：0=朝下/+Y, 90=朝左/-X, 180=朝上/-Y, 270=朝右/+X>
    }
  ]
}

关键几何准则：
1. 相邻房间必须严丝合缝共享隔墙坐标（例如左房间 x2=420、右房间 x1=420），不能在客厅与主卧/次卧之间留下狭长空白缝隙；若客厅与卧室之间有走道，请将走道并入客厅/餐厅或明确标注相连，确保所有房间连通成一个完整户型，严禁孤立房间。
2. 必须完整列出图上全部可见门窗：入户门、每一间卧室门、卫生间门、厨房门/推拉门、阳台推拉门以及所有外墙窗户（卧室窗、客厅/阳台窗、厨房窗、卫浴小窗）。
3. 严禁漏掉任何卧室里的床（三间卧室都要各自提取对应的床与衣柜），也不要编造图中不存在的多余房间。
"""

VALID_HYBRID_KEYS = {
    "sofa", "loveseat", "coffeeTable", "roundCoffee", "tvCabinet",
    "diningTable", "diningTable4", "roundTable", "chair",
    "bed18", "bed15", "bed12", "nightstand", "cabSlide",
    "desk", "officeChair", "bookshelf", "counter", "fridge",
    "vanity", "toilet", "shower", "bathtub", "shoeCabinet", "plant",
}

CATEGORY_TO_KEY = {
    "double_bed": "bed18",
    "queen_bed": "bed15",
    "single_bed": "bed12",
    "bed": "bed15",
    "wardrobe": "cabSlide",
    "closet": "cabSlide",
    "dining_table": "diningTable",
    "coffee_table": "coffeeTable",
    "tv_cabinet": "tvCabinet",
    "dining_chair": "chair",
    "office_chair": "officeChair",
    "kitchen_counter": "counter",
    "refrigerator": "fridge",
    "washbasin": "vanity",
    "sink": "vanity",
}


def detect_cv_wall_axes(image_bytes: bytes) -> dict[str, Any]:
    """Extract strong horizontal and vertical structural wall centerlines in [0..1000] space via OpenCV."""
    with Image.open(io.BytesIO(image_bytes)) as im:
        rgb = np.array(im.convert("RGB"))
    h_px, w_px = rgb.shape[:2]
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    inv = 255 - gray
    _, th_otsu = cv2.threshold(inv, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    edges = cv2.Canny(gray, 50, 150)
    combined = cv2.bitwise_or(th_otsu, edges)

    h_len = max(20, w_px // 14)
    v_len = max(20, h_px // 14)
    h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (h_len, 1))
    v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, v_len))
    h_lines = cv2.morphologyEx(combined, cv2.MORPH_OPEN, h_kernel)
    v_lines = cv2.morphologyEx(combined, cv2.MORPH_OPEN, v_kernel)

    y_proj = np.sum(h_lines > 0, axis=1) / max(1, w_px)
    x_proj = np.sum(v_lines > 0, axis=0) / max(1, h_px)

    def _peaks(proj: np.ndarray, size: int, min_ratio: float = 0.12) -> list[int]:
        raw = [int(round(i * 1000.0 / max(1, size))) for i, val in enumerate(proj) if val >= min_ratio]
        if not raw:
            return []
        clusters: list[list[int]] = [[raw[0]]]
        for v in raw[1:]:
            if v - clusters[-1][-1] <= 14:
                clusters[-1].append(v)
            else:
                clusters.append([v])
        return [int(round(sum(c) / len(c))) for c in clusters][:28]

    return {
        "widthPx": w_px,
        "heightPx": h_px,
        "xAxes1000": _peaks(x_proj, w_px),
        "yAxes1000": _peaks(y_proj, h_px),
    }


def _snap_and_weld_axis(
    coords: list[float],
    cv_axes: list[int],
    snap_tol: float = 18.0,
    weld_tol: float = 28.0,
) -> dict[float, float]:
    """Snap VLM coordinates to nearby OpenCV wall peaks, then weld close coordinates together."""
    snapped: dict[float, float] = {}
    for c in coords:
        best_cv = min(cv_axes, key=lambda ax: abs(ax - c)) if cv_axes else None
        snapped[c] = float(best_cv) if (best_cv is not None and abs(best_cv - c) <= snap_tol) else float(c)

    unique_vals = sorted(set(snapped.values()))
    if not unique_vals:
        return {}
    groups: list[list[float]] = [[unique_vals[0]]]
    for v in unique_vals[1:]:
        if v - groups[-1][-1] <= weld_tol:
            groups[-1].append(v)
        else:
            groups.append([v])
    group_rep = {v: sum(g) / len(g) for g in groups for v in g}
    return {orig: group_rep[s_val] for orig, s_val in snapped.items()}


def _is_living_or_circulation(r: dict[str, Any]) -> bool:
    kind = str(r.get("kind") or r.get("roomType") or "").lower()
    name = str(r.get("name") or "")
    return kind in ("living_dining", "living", "dining", "entry", "hallway", "corridor") or any(
        k in name for k in ("客", "餐", "厅", "玄关", "走道", "过道")
    )


def _is_bedroom(r: dict[str, Any]) -> bool:
    kind = str(r.get("kind") or r.get("roomType") or "").lower()
    name = str(r.get("name") or "")
    return "bed" in kind or (
        any(k in name for k in ("卧", "房"))
        and not any(k in name for k in ("厨", "卫", "浴", "厕", "阳", "客", "餐", "书", "房间"))
    )


def _rooms_touch(a: dict[str, Any], b: dict[str, Any], eps: float = 1.0, min_overlap: float = 25.0) -> bool:
    y_ov = min(a["y2"], b["y2"]) - max(a["y1"], b["y1"])
    x_ov = min(a["x2"], b["x2"]) - max(a["x1"], b["x1"])
    if y_ov >= min_overlap and (abs(a["x2"] - b["x1"]) <= eps or abs(b["x2"] - a["x1"]) <= eps):
        return True
    if x_ov >= min_overlap and (abs(a["y2"] - b["y1"]) <= eps or abs(b["y2"] - a["y1"]) <= eps):
        return True
    return False


def _connected_components(rooms: list[dict[str, Any]], eps: float = 1.0) -> list[list[int]]:
    n = len(rooms)
    visited = [False] * n
    comps: list[list[int]] = []
    for i in range(n):
        if visited[i]:
            continue
        comp: list[int] = []
        queue = [i]
        visited[i] = True
        while queue:
            cur = queue.pop(0)
            comp.append(cur)
            for j in range(n):
                if not visited[j] and _rooms_touch(rooms[cur], rooms[j], eps=eps):
                    visited[j] = True
                    queue.append(j)
        comps.append(comp)
    comps.sort(key=len, reverse=True)
    return comps


def _heal_room_connectivity_and_slivers(rooms: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Eliminate narrow corridor slivers and weld disconnected room islands onto the main floorplan graph."""
    if len(rooms) <= 1:
        return rooms
    out = [dict(r) for r in rooms]

    # 1. Close narrow horizontal/vertical non-room gaps (< 95 normalized units) between facing rooms
    for _ in range(2):
        for i in range(len(out)):
            for j in range(i + 1, len(out)):
                a, b = out[i], out[j]
                y_ov = min(a["y2"], b["y2"]) - max(a["y1"], b["y1"])
                if y_ov >= 45:
                    left, right = (a, b) if a["x2"] <= b["x1"] else (b, a)
                    gap = right["x1"] - left["x2"]
                    if 1.0 < gap <= 95.0:
                        ov_y1, ov_y2 = max(left["y1"], right["y1"]), min(left["y2"], right["y2"])
                        occupied = any(
                            k not in (i, j)
                            and min(out[k]["x2"], right["x1"]) - max(out[k]["x1"], left["x2"]) > 15
                            and min(out[k]["y2"], ov_y2) - max(out[k]["y1"], ov_y1) > 25
                            for k in range(len(out))
                        )
                        if not occupied:
                            if _is_living_or_circulation(left) and not _is_living_or_circulation(right):
                                left["x2"] = right["x1"]
                            elif _is_living_or_circulation(right) and not _is_living_or_circulation(left):
                                right["x1"] = left["x2"]
                            else:
                                mid = (left["x2"] + right["x1"]) / 2.0
                                left["x2"] = mid
                                right["x1"] = mid
                x_ov = min(a["x2"], b["x2"]) - max(a["x1"], b["x1"])
                if x_ov >= 45:
                    top, bot = (a, b) if a["y2"] <= b["y1"] else (b, a)
                    gap = bot["y1"] - top["y2"]
                    if 1.0 < gap <= 95.0:
                        ov_x1, ov_x2 = max(top["x1"], bot["x1"]), min(top["x2"], bot["x2"])
                        occupied = any(
                            k not in (i, j)
                            and min(out[k]["y2"], bot["y1"]) - max(out[k]["y1"], top["y2"]) > 15
                            and min(out[k]["x2"], ov_x2) - max(out[k]["x1"], ov_x1) > 25
                            for k in range(len(out))
                        )
                        if not occupied:
                            if _is_living_or_circulation(top) and not _is_living_or_circulation(bot):
                                top["y2"] = bot["y1"]
                            elif _is_living_or_circulation(bot) and not _is_living_or_circulation(top):
                                bot["y1"] = top["y2"]
                            else:
                                mid = (top["y2"] + bot["y1"]) / 2.0
                                top["y2"] = mid
                                bot["y1"] = mid

    # 2. Weld any remaining disconnected room islands onto the largest connected component
    for _ in range(len(out)):
        comps = _connected_components(out)
        if len(comps) <= 1:
            break
        main_set = set(comps[0])
        iso_comp = comps[1]
        best: tuple[float, str, int, int] | None = None
        for idx_iso in iso_comp:
            ri = out[idx_iso]
            for idx_m in main_set:
                rm = out[idx_m]
                y_ov = min(ri["y2"], rm["y2"]) - max(ri["y1"], rm["y1"])
                if y_ov >= 30:
                    if ri["x1"] >= rm["x2"]:
                        gap = ri["x1"] - rm["x2"]
                        if gap <= 160 and (best is None or gap < best[0]):
                            best = (gap, "x_right", idx_m, idx_iso)
                    elif rm["x1"] >= ri["x2"]:
                        gap = rm["x1"] - ri["x2"]
                        if gap <= 160 and (best is None or gap < best[0]):
                            best = (gap, "x_left", idx_m, idx_iso)
                x_ov = min(ri["x2"], rm["x2"]) - max(ri["x1"], rm["x1"])
                if x_ov >= 30:
                    if ri["y1"] >= rm["y2"]:
                        gap = ri["y1"] - rm["y2"]
                        if gap <= 160 and (best is None or gap < best[0]):
                            best = (gap, "y_down", idx_m, idx_iso)
                    elif rm["y1"] >= ri["y2"]:
                        gap = rm["y1"] - ri["y2"]
                        if gap <= 160 and (best is None or gap < best[0]):
                            best = (gap, "y_up", idx_m, idx_iso)
        if best is None:
            break
        _, direction, idx_m, idx_iso = best
        rm, ri = out[idx_m], out[idx_iso]
        if direction == "x_right":
            if _is_living_or_circulation(rm):
                rm["x2"] = ri["x1"]
            else:
                shift = ri["x1"] - rm["x2"]
                for k in iso_comp:
                    out[k]["x1"] -= shift
                    out[k]["x2"] -= shift
        elif direction == "x_left":
            if _is_living_or_circulation(rm):
                rm["x1"] = ri["x2"]
            else:
                shift = rm["x1"] - ri["x2"]
                for k in iso_comp:
                    out[k]["x1"] += shift
                    out[k]["x2"] += shift
        elif direction == "y_down":
            if _is_living_or_circulation(rm):
                rm["y2"] = ri["y1"]
            else:
                shift = ri["y1"] - rm["y2"]
                for k in iso_comp:
                    out[k]["y1"] -= shift
                    out[k]["y2"] -= shift
        elif direction == "y_up":
            if _is_living_or_circulation(rm):
                rm["y1"] = ri["y2"]
            else:
                shift = rm["y1"] - ri["y2"]
                for k in iso_comp:
                    out[k]["y1"] += shift
                    out[k]["y2"] += shift
    return out


def _calibrate_scale_mm_per_unit(
    vlm_data: dict[str, Any],
    rooms_welded: list[dict[str, Any]],
    openings_raw: list[dict[str, Any]],
    width_px: float = 1000.0,
    height_px: float = 1000.0,
) -> tuple[float, float, str]:
    """3-Tier Aspect-Aware Auto-Scale Calibration returning (mm_per_unit_x, mm_per_unit_y, basis).

    Because VLM coordinates normalize BOTH X and Y independently to [0..1000], a non-square image
    (e.g. portrait 1020x1230) has different mm/unit along X vs Y! Calibrating in isotropic pixel
    space (mm_per_px) eliminates aspect-ratio distortion.
    """
    w_px = max(1.0, float(width_px or 1000.0))
    h_px = max(1.0, float(height_px or 1000.0))
    px_per_ux = w_px / 1000.0
    px_per_uy = h_px / 1000.0

    xs = [r["x1"] for r in rooms_welded] + [r["x2"] for r in rooms_welded]
    ys = [r["y1"] for r in rooms_welded] + [r["y2"] for r in rooms_welded]
    span_x = max(100.0, max(xs) - min(xs))
    span_y = max(100.0, max(ys) - min(ys))

    scale_info = vlm_data.get("scaleInfo") or {}
    outer_w = scale_info.get("outerWidthMm")
    outer_d = scale_info.get("outerDepthMm")
    has_outer_w = isinstance(outer_w, (int, float)) and 2500 <= outer_w <= 35000
    has_outer_d = isinstance(outer_d, (int, float)) and 2500 <= outer_d <= 35000

    # If BOTH outer dimensions are explicitly annotated on the drawing, fit X and Y directly
    # (within a 25% sanity envelope around isotropic pixel scaling to guard against misread labels).
    if has_outer_w and has_outer_d:
        ux = float(outer_w) / span_x
        uy = float(outer_d) / span_y
        mm_px_x = ux / px_per_ux
        mm_px_y = uy / px_per_uy
        ratio_diff = max(mm_px_x, mm_px_y) / max(1e-6, min(mm_px_x, mm_px_y))
        if ratio_diff <= 1.25:
            return (
                max(4.0, min(35.0, ux)),
                max(4.0, min(35.0, uy)),
                "第1级：图面标注总长宽尺寸双轴精确校准",
            )

    px_ratios: list[float] = []
    if has_outer_w:
        px_ratios.append(float(outer_w) / (span_x * px_per_ux))
    if has_outer_d:
        px_ratios.append(float(outer_d) / (span_y * px_per_uy))

    for r in rooms_welded:
        rw_px = max(40.0, (r["x2"] - r["x1"]) * px_per_ux)
        rd_px = max(40.0, (r["y2"] - r["y1"]) * px_per_uy)
        aw = r.get("annotatedWidthMm")
        ad = r.get("annotatedDepthMm")
        if isinstance(aw, (int, float)) and 1000 <= aw <= 18000:
            px_ratios.append(float(aw) / rw_px)
        if isinstance(ad, (int, float)) and 1000 <= ad <= 18000:
            px_ratios.append(float(ad) / rd_px)

    if px_ratios:
        mm_per_px = float(statistics.median(px_ratios))
        ux = max(4.0, min(35.0, mm_per_px * px_per_ux))
        uy = max(4.0, min(35.0, mm_per_px * px_per_uy))
        return ux, uy, "第1级：图面标注长宽尺寸等比像素精确反算"

    # Tier 2: Room area annotations (m²) in real pixel area space
    area_px_ratios: list[float] = []
    for r in rooms_welded:
        area_m2 = r.get("annotatedAreaM2")
        px_area = (r["x2"] - r["x1"]) * px_per_ux * (r["y2"] - r["y1"]) * px_per_uy
        if isinstance(area_m2, (int, float)) and 2.0 <= area_m2 <= 100.0 and px_area >= 1500:
            area_px_ratios.append(math.sqrt((float(area_m2) * 1_000_000.0) / px_area))
    if area_px_ratios:
        mm_per_px = float(statistics.median(area_px_ratios))
        ux = max(4.0, min(35.0, mm_per_px * px_per_ux))
        uy = max(4.0, min(35.0, mm_per_px * px_per_uy))
        return ux, uy, "第2级：图面房间面积(㎡)等比自动标定"

    # Tier 3: Standard 900mm single door span or room-count bounding heuristic
    door_px_ratios = []
    for op in openings_raw:
        if op.get("type") == "door" and 25 <= float(op.get("span") or 0) <= 140:
            orient = str(op.get("orient") or "h")
            span_px = float(op["span"]) * (px_per_ux if orient == "h" else px_per_uy)
            if span_px > 10:
                door_px_ratios.append(900.0 / span_px)
    if door_px_ratios:
        mm_per_px = float(statistics.median(door_px_ratios))
        ux = mm_per_px * px_per_ux
        uy = mm_per_px * px_per_uy
        if 5.0 <= min(ux, uy) and max(ux, uy) <= 28.0:
            return ux, uy, "第3级：基于国标 900mm 标准平开门洞物理标尺自动标定"

    target_total_mm = 7200.0 if len(rooms_welded) <= 2 else (10200.0 if len(rooms_welded) <= 4 else 12400.0)
    max_span_px = max(span_x * px_per_ux, span_y * px_per_uy)
    mm_per_px = target_total_mm / max(100.0, max_span_px)
    return (
        max(4.0, min(35.0, mm_per_px * px_per_ux)),
        max(4.0, min(35.0, mm_per_px * px_per_uy)),
        "第3级：基于住宅户型开间先验尺度自动标定",
    )


def _normalize_furniture_key(f: dict[str, Any]) -> str:
    raw = str(f.get("key") or f.get("category") or "").strip()
    if raw in VALID_HYBRID_KEYS:
        return raw
    return CATEGORY_TO_KEY.get(raw.lower(), "")


def compile_hybrid_housespec(
    vlm_data: dict[str, Any],
    cv_axes: dict[str, Any],
    style_pack: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Weld orthogonal shared walls, calibrate 3-tier aspect-correct scale, snap openings & furniture into clean HouseSpec."""
    raw_rooms = [
        r for r in (vlm_data.get("rooms") or [])
        if isinstance(r, dict)
        and isinstance(r.get("x1"), (int, float))
        and isinstance(r.get("x2"), (int, float))
        and isinstance(r.get("y1"), (int, float))
        and isinstance(r.get("y2"), (int, float))
    ]
    cleaned_rooms = []
    for r in raw_rooms:
        x1, x2 = sorted([max(0.0, min(1000.0, float(r["x1"]))), max(0.0, min(1000.0, float(r["x2"])))])
        y1, y2 = sorted([max(0.0, min(1000.0, float(r["y1"]))), max(0.0, min(1000.0, float(r["y2"])))])
        if (x2 - x1) >= 45 and (y2 - y1) >= 45:
            cleaned_rooms.append({**r, "x1": x1, "y1": y1, "x2": x2, "y2": y2})

    if not cleaned_rooms:
        raise ValueError("未能从户型图中识别出有效封闭房间区域")

    x_map = _snap_and_weld_axis(
        [r["x1"] for r in cleaned_rooms] + [r["x2"] for r in cleaned_rooms],
        cv_axes.get("xAxes1000", []),
    )
    y_map = _snap_and_weld_axis(
        [r["y1"] for r in cleaned_rooms] + [r["y2"] for r in cleaned_rooms],
        cv_axes.get("yAxes1000", []),
    )

    welded_rooms = []
    for r in cleaned_rooms:
        wx1, wx2 = sorted([x_map[r["x1"]], x_map[r["x2"]]])
        wy1, wy2 = sorted([y_map[r["y1"]], y_map[r["y2"]]])
        if (wx2 - wx1) >= 45 and (wy2 - wy1) >= 45:
            welded_rooms.append({**r, "x1": wx1, "y1": wy1, "x2": wx2, "y2": wy2})

    # Remove duplicate/heavily overlapping room boxes
    dedup_rooms: list[dict[str, Any]] = []
    for r in welded_rooms:
        cx, cy = (r["x1"] + r["x2"]) / 2, (r["y1"] + r["y2"]) / 2
        if any(d["x1"] + 15 < cx < d["x2"] - 15 and d["y1"] + 15 < cy < d["y2"] - 15 for d in dedup_rooms):
            continue
        dedup_rooms.append(r)

    # Weld disconnected rooms & close spurious narrow corridor slivers
    dedup_rooms = _heal_room_connectivity_and_slivers(dedup_rooms)
    x_map2 = _snap_and_weld_axis([r["x1"] for r in dedup_rooms] + [r["x2"] for r in dedup_rooms], [], snap_tol=0.0, weld_tol=12.0)
    y_map2 = _snap_and_weld_axis([r["y1"] for r in dedup_rooms] + [r["y2"] for r in dedup_rooms], [], snap_tol=0.0, weld_tol=12.0)
    for r in dedup_rooms:
        r["x1"], r["x2"] = sorted([x_map2[r["x1"]], x_map2[r["x2"]]])
        r["y1"], r["y2"] = sorted([y_map2[r["y1"]], y_map2[r["y2"]]])

    comps_after = _connected_components(dedup_rooms, eps=2.0)
    disconnected_names = [
        str(dedup_rooms[idx].get("name") or f"房间{idx + 1}")
        for comp in comps_after[1:]
        for idx in comp
    ]

    openings_raw = [op for op in (vlm_data.get("openings") or []) if isinstance(op, dict)]
    mm_per_ux, mm_per_uy, scale_basis = _calibrate_scale_mm_per_unit(
        vlm_data,
        dedup_rooms,
        openings_raw,
        width_px=float(cv_axes.get("widthPx") or 1000.0),
        height_px=float(cv_axes.get("heightPx") or 1000.0),
    )

    min_x = min(r["x1"] for r in dedup_rooms)
    min_y = min(r["y1"] for r in dedup_rooms)

    def _to_mm_x(val: float) -> int:
        return int(round(((val - min_x) * mm_per_ux) / 50.0) * 50)

    def _to_mm_y(val: float) -> int:
        return int(round(((val - min_y) * mm_per_uy) / 50.0) * 50)

    mm_rooms = []
    for r in dedup_rooms:
        rx1 = _to_mm_x(r["x1"])
        rx2 = _to_mm_x(r["x2"])
        ry1 = _to_mm_y(r["y1"])
        ry2 = _to_mm_y(r["y2"])
        if rx2 - rx1 < 1200:
            rx2 = rx1 + 1400
        if ry2 - ry1 < 1200:
            ry2 = ry1 + 1400
        mm_rooms.append({**r, "mx1": rx1, "my1": ry1, "mx2": rx2, "my2": ry2})

    all_xs = sorted({r["mx1"] for r in mm_rooms} | {r["mx2"] for r in mm_rooms})
    all_ys = sorted({r["my1"] for r in mm_rooms} | {r["my2"] for r in mm_rooms})

    h_segments: dict[tuple[int, int, int], int] = {}
    v_segments: dict[tuple[int, int, int], int] = {}

    for r in mm_rooms:
        for y_edge in (r["my1"], r["my2"]):
            xs_in = [x for x in all_xs if r["mx1"] <= x <= r["mx2"]]
            for i in range(len(xs_in) - 1):
                seg = (y_edge, xs_in[i], xs_in[i + 1])
                if seg[2] - seg[1] >= 150:
                    h_segments[seg] = h_segments.get(seg, 0) + 1
        for x_edge in (r["mx1"], r["mx2"]):
            ys_in = [y for y in all_ys if r["my1"] <= y <= r["my2"]]
            for i in range(len(ys_in) - 1):
                seg = (x_edge, ys_in[i], ys_in[i + 1])
                if seg[2] - seg[1] >= 150:
                    v_segments[seg] = v_segments.get(seg, 0) + 1

    raw_walls: list[dict[str, Any]] = []
    for (y_val, xs0, xs1), adj_count in sorted(h_segments.items()):
        raw_walls.append({
            "a": [xs0, y_val],
            "b": [xs1, y_val],
            "t": 200 if adj_count == 1 else 160,
            "bearing": adj_count == 1,
            "openings": [],
            "_orient": "h",
            "_len": xs1 - xs0,
        })
    for (x_val, ys0, ys1), adj_count in sorted(v_segments.items()):
        raw_walls.append({
            "a": [x_val, ys0],
            "b": [x_val, ys1],
            "t": 200 if adj_count == 1 else 160,
            "bearing": adj_count == 1,
            "openings": [],
            "_orient": "v",
            "_len": ys1 - ys0,
        })

    # Merge contiguous collinear segments of identical (orient, t, bearing) BEFORE placing openings
    # so T-junctions do not fragment doorway walls into unplaceable <1100mm stubs!
    walls: list[dict[str, Any]] = []
    for orient in ("h", "v"):
        group = [w for w in raw_walls if w["_orient"] == orient]
        group.sort(key=(lambda w: (w["a"][1], w["a"][0])) if orient == "h" else (lambda w: (w["a"][0], w["a"][1])))
        for w in group:
            if (
                walls
                and walls[-1]["_orient"] == orient
                and walls[-1]["t"] == w["t"]
                and walls[-1]["bearing"] == w["bearing"]
                and walls[-1]["b"] == w["a"]
            ):
                walls[-1]["b"] = list(w["b"])
                walls[-1]["_len"] = (
                    (walls[-1]["b"][0] - walls[-1]["a"][0])
                    if orient == "h"
                    else (walls[-1]["b"][1] - walls[-1]["a"][1])
                )
            else:
                walls.append(dict(w))

    placed_openings = 0
    cx_all = sum((r["mx1"] + r["mx2"]) / 2 for r in mm_rooms) / len(mm_rooms)
    cy_all = sum((r["my1"] + r["my2"]) / 2 for r in mm_rooms) / len(mm_rooms)

    def _try_add_opening(w: dict[str, Any], op_type: str, pos_mm: float, desired_w: int) -> bool:
        nonlocal placed_openings
        margin = 100 if w["_len"] < 1250 else 180
        max_avail = w["_len"] - margin * 2
        if max_avail < 700:
            return False
        w_mm = int(max(700, min(desired_w, max_avail)))
        start_mm = int(max(margin, min(w["_len"] - margin - w_mm, round(pos_mm - w_mm / 2))))
        end_mm = start_mm + w_mm
        if any(min(ex["to"], end_mm) - max(ex["from"], start_mm) > -80 for ex in w["openings"]):
            return False
        entry: dict[str, Any] = {"type": op_type, "from": start_mm, "to": end_mm}
        if op_type == "window":
            entry.update(sill=850, head=2400)
        elif op_type == "door":
            entry["into"] = [int(cx_all), int(cy_all)]
        w["openings"].append(entry)
        placed_openings += 1
        return True

    for op in openings_raw:
        ox = _to_mm_x(float(op.get("x") or 0))
        oy = _to_mm_y(float(op.get("y") or 0))
        op_type = str(op.get("type") or "door")
        if op_type not in ("door", "sliding", "window"):
            op_type = "door"
        hint_orient = str(op.get("orient") or "").lower()
        best_wall = None
        best_score = 999999.0
        best_pos = 0.0
        for w in walls:
            if w["_len"] < 900:
                continue
            orient_pen = 0.0 if (not hint_orient or hint_orient == w["_orient"]) else 220.0
            if w["_orient"] == "h":
                x0, y0 = w["a"]
                x1, _ = w["b"]
                if x0 - 350 <= ox <= x1 + 350:
                    dist = abs(oy - y0)
                    if dist <= 950 and (dist + orient_pen) < best_score:
                        best_score = dist + orient_pen
                        best_wall = w
                        best_pos = float(max(x0, min(x1, ox)) - x0)
            else:
                x0, y0 = w["a"]
                _, y1 = w["b"]
                if y0 - 350 <= oy <= y1 + 350:
                    dist = abs(ox - x0)
                    if dist <= 950 and (dist + orient_pen) < best_score:
                        best_score = dist + orient_pen
                        best_wall = w
                        best_pos = float(max(y0, min(y1, oy)) - y0)
        if best_wall is None:
            continue
        is_exterior = bool(best_wall["bearing"])
        if op_type == "window" and not is_exterior:
            op_type = "sliding"
        elif op_type == "door" and not is_exterior:
            op_type = "sliding"
        span_u = float(op.get("span") or 0)
        span_mm = int(round(span_u * (mm_per_ux if best_wall["_orient"] == "h" else mm_per_uy) / 50.0) * 50)
        if op_type == "window":
            desired_w = max(900, min(2400, span_mm)) if 500 <= span_mm <= 3200 else 1400
        elif op_type == "sliding":
            desired_w = max(850, min(2000, span_mm)) if 600 <= span_mm <= 2600 else 1000
        else:
            desired_w = max(800, min(1100, span_mm)) if 650 <= span_mm <= 1400 else 900
        _try_add_opening(best_wall, op_type, best_pos, desired_w)

    def _wall_borders_room(w: dict[str, Any], r: dict[str, Any]) -> tuple[bool, int, int]:
        if w["_orient"] == "h" and w["a"][1] in (r["my1"], r["my2"]):
            ov0, ov1 = max(w["a"][0], r["mx1"]), min(w["b"][0], r["mx2"])
            if ov1 - ov0 >= 850:
                return True, ov0 - w["a"][0], ov1 - w["a"][0]
        if w["_orient"] == "v" and w["a"][0] in (r["mx1"], r["mx2"]):
            ov0, ov1 = max(w["a"][1], r["my1"]), min(w["b"][1], r["my2"])
            if ov1 - ov0 >= 850:
                return True, ov0 - w["a"][1], ov1 - w["a"][1]
        return False, 0, 0

    for r1 in mm_rooms:
        has_door = False
        has_window = False
        interior_cands: list[tuple[int, dict[str, Any], int, int]] = []
        exterior_cands: list[tuple[int, dict[str, Any], int, int]] = []
        for w in walls:
            ok, s0, s1 = _wall_borders_room(w, r1)
            if not ok:
                continue
            for op in w["openings"]:
                mid_op = (op["from"] + op["to"]) / 2
                if s0 - 50 <= mid_op <= s1 + 50:
                    if op["type"] in ("door", "sliding", "double"):
                        has_door = True
                    if op["type"] == "window":
                        has_window = True
            if not w["bearing"]:
                interior_cands.append((s1 - s0, w, s0, s1))
            else:
                exterior_cands.append((s1 - s0, w, s0, s1))
        if not has_door and interior_cands:
            interior_cands.sort(key=lambda item: item[0], reverse=True)
            for span_len, cw, s0, s1 in interior_cands:
                if span_len >= 950 and _try_add_opening(cw, "sliding", (s0 + s1) / 2.0, min(950, span_len - 200)):
                    has_door = True
                    break
        rname = str(r1.get("name") or "")
        wants_window = _is_bedroom(r1) or _is_living_or_circulation(r1) or any(
            k in rname for k in ("厨", "阳", "书")
        )
        if wants_window and not has_window and exterior_cands:
            exterior_cands.sort(key=lambda item: item[0], reverse=True)
            for span_len, ew, s0, s1 in exterior_cands:
                if span_len >= 1300 and _try_add_opening(ew, "window", (s0 + s1) / 2.0, min(1500, span_len - 400)):
                    break

    floor_default = (style_pack or {}).get("floorMaterial", "oak")
    wall_default = (style_pack or {}).get("wallMaterial", "latexWhite")
    spec_rooms = []
    for r in mm_rooms:
        rname = str(r.get("name") or "房间")[:40]
        is_wet = any(k in rname for k in ("厨", "卫", "浴", "厕", "阳"))
        spec_rooms.append({
            "at": [(r["mx1"] + r["mx2"]) // 2, (r["my1"] + r["my2"]) // 2],
            "name": rname,
            "mat": "tile" if is_wet else floor_default,
            "wallMat": "wallTile" if is_wet else wall_default,
            "ceil": {"type": "none"},
        })

    spec_furniture: list[dict[str, Any]] = []
    room_furniture_keys: dict[int, set[str]] = {i: set() for i in range(len(mm_rooms))}
    for f in vlm_data.get("furniture") or []:
        if not isinstance(f, dict):
            continue
        key = _normalize_furniture_key(f)
        if not key:
            continue
        fx = _to_mm_x(float(f.get("x") or 0))
        fy = _to_mm_y(float(f.get("y") or 0))
        rot = int(round(float(f.get("rot") or 0) / 90.0) * 90) % 360
        host_idx = next(
            (
                i for i, r in enumerate(mm_rooms)
                if r["mx1"] - 200 <= fx <= r["mx2"] + 200 and r["my1"] - 200 <= fy <= r["my2"] + 200
            ),
            None,
        )
        if host_idx is None:
            continue
        host_room = mm_rooms[host_idx]
        pad = 450
        if host_room["mx2"] - host_room["mx1"] > pad * 2:
            fx = max(host_room["mx1"] + pad, min(host_room["mx2"] - pad, fx))
        else:
            fx = (host_room["mx1"] + host_room["mx2"]) // 2
        if host_room["my2"] - host_room["my1"] > pad * 2:
            fy = max(host_room["my1"] + pad, min(host_room["my2"] - pad, fy))
        else:
            fy = (host_room["my1"] + host_room["my2"]) // 2
        spec_furniture.append({"key": key, "at": [int(fx), int(fy)], "rot": rot})
        room_furniture_keys[host_idx].add(key)

    # Bedroom essential completeness fallback: ensure EVERY recognized bedroom gets an appropriately sized bed!
    for i, r in enumerate(mm_rooms):
        if not _is_bedroom(r):
            continue
        if room_furniture_keys[i] & {"bed18", "bed15", "bed12"}:
            continue
        rw = r["mx2"] - r["mx1"] - 320
        rd = r["my2"] - r["my1"] - 320
        if max(rw, rd) < 2000 or min(rw, rd) < 1500:
            continue
        if rw >= 2600 and rd >= 2500:
            bed_key, bd = "bed18", 2100
        elif max(rw, rd) >= 2400 and min(rw, rd) >= 2000:
            bed_key, bd = "bed15", 2000
        else:
            bed_key, bd = "bed12", 2000
        cx = (r["mx1"] + r["mx2"]) // 2
        cy = (r["my1"] + r["my2"]) // 2
        if rd >= rw:
            rot = 0
            bx = cx
            by = int(r["my1"] + 200 + bd // 2)
        else:
            rot = 270
            bx = int(r["mx1"] + 200 + bd // 2)
            by = cy
        spec_furniture.append({"key": bed_key, "at": [bx, by], "rot": rot})
        room_furniture_keys[i].add(bed_key)

    for w in walls:
        w.pop("_orient", None)
        w.pop("_len", None)

    style_label = (style_pack or {}).get("label", "原图还原")
    house_spec = {
        "name": f"AI户型图重建 · {style_label}（{len(spec_rooms)}室全屋）",
        "height": 2850,
        "phase": "renovate",
        "autoElec": False,
        "walls": walls,
        "rooms": spec_rooms,
        "furniture": spec_furniture,
    }
    meta = {
        "scaleMmPerUnit": round((mm_per_ux + mm_per_uy) / 2.0, 3),
        "scaleMmPerUnitX": round(mm_per_ux, 3),
        "scaleMmPerUnitY": round(mm_per_uy, 3),
        "scaleBasis": scale_basis,
        "roomCount": len(spec_rooms),
        "openingCount": placed_openings,
        "rawFurnitureCount": len(spec_furniture),
        "totalWidthMm": max(all_xs) - min(all_xs),
        "totalDepthMm": max(all_ys) - min(all_ys),
        "connectedComponents": len(comps_after),
        "disconnectedRooms": disconnected_names,
        "weldedRooms": [
            {
                "name": str(r.get("name") or "房间"),
                "kind": str(r.get("kind") or r.get("roomType") or "other"),
                "x1": round(r["x1"], 1),
                "y1": round(r["y1"], 1),
                "x2": round(r["x2"], 1),
                "y2": round(r["y2"], 1),
                "widthMm": r["mx2"] - r["mx1"],
                "depthMm": r["my2"] - r["my1"],
            }
            for r in mm_rooms
        ],
    }
    return house_spec, meta


async def commit_hybrid_floorplan(
    *,
    store: Any,
    client: Any,
    task: dict[str, Any],
    project: dict[str, Any],
    vlm_json: dict[str, Any],
    cv_axes: dict[str, Any],
    style_pack: dict[str, Any] | None,
    gen: dict[str, Any],
) -> dict[str, Any]:
    """Compile confirmed/auto hybrid floorplan JSON into HouseSpec and initialize the 3D scene."""
    spec, meta = compile_hybrid_housespec(vlm_json, cv_axes, style_pack)

    registry = get_registry()
    try:
        from .schemas import SkillSelection
        bundle = registry.compose(
            mode="reconstruct_floorplan",
            selection=SkillSelection(
                primarySkillId="floorplan-reconstruction",
                modifierSkillIds=[],
                reason="VLM+CV 混合全屋户型高精度重建与三级比例尺自标定",
            ),
            include_intake=True,
        )
        skills_used = registry.records(bundle)
        public_bundle = registry.public_bundle(bundle)
    except Exception:
        skills_used = [
            {"id": "universal-spatial-base", "version": "0.1.0", "role": "universal"},
            {"id": "floorplan-reconstruction", "version": "0.2.0", "role": "primary"},
            *(
                [{"id": "style-coherence", "version": "0.1.0", "role": "modifier"}]
                if style_pack
                else []
            ),
        ]
        public_bundle = None

    res = await client.request(
        f"/projects/{task['projectId']}/initialize-housespec",
        {
            "operationId": f"hybrid-fp-{task['id']}-r{project['revision']}",
            "baseRevision": project["revision"],
            "spec": spec,
            **({"styleId": style_pack["id"]} if style_pack else {}),
            "anchorTallCabinets": True,
            "autoHealCollisions": True,
            "summary": f"AI户型图混合高精度重建（{meta['roomCount']}空间）",
        },
    )
    after_project = res["project"]
    after_plan = after_project["plan"]
    changes = [
        {"action": "added", "id": f["id"], "name": f["name"], "key": f["key"]}
        for f in after_plan.get("furniture", [])
    ]
    generation_out = {
        **gen,
        "mode": "reconstruct_floorplan_hybrid",
        "floorplanMode": "hybrid-v5",
        "hybridReviewPending": False,
        "hybridConfirmed": True,
        "hybridDraft": None,
        "roomCount": meta["roomCount"],
        "openingCount": meta["openingCount"],
        "connectedComponents": meta["connectedComponents"],
        "dimensions": {
            "width": meta["totalWidthMm"],
            "depth": meta["totalDepthMm"],
            "height": after_plan.get("height", 2850),
        },
        "scaleBasis": meta["scaleBasis"],
        "skillsUsed": skills_used,
        **({"skillBundle": public_bundle} if public_bundle else {}),
        "defaults": [
            meta["scaleBasis"],
            f"OpenCV 墙轴线吸附 + 连通性焊接（共闭合 {len(after_plan.get('rooms', []))} 个房间，{meta['openingCount']} 处门窗）",
            f"自动完成全屋门窗嵌入与 {len(changes)} 件家具防穿模净化",
        ],
    }
    store.update(task["id"], generation=generation_out)
    store.event(task["id"], "brief_frozen", generation_out)

    room_list = "、".join(r.get("name", "房间") for r in after_plan.get("rooms", []))
    msg = (
        f"已完成户型图高精度三维重建：共识别闭合 {len(after_plan.get('rooms', []))} 个空间（{room_list}），"
        f"总尺度 {meta['totalWidthMm']/1000:.1f}m × {meta['totalDepthMm']/1000:.1f}m（{meta['scaleBasis']}），"
        f"嵌入 {meta['openingCount']} 处门窗并自动装配 {len(changes)} 件全屋家具！"
    )
    return {
        "route": "end",
        "final": {
            "status": "completed",
            "committedRevision": after_project["revision"],
            "message": msg,
            "generation": generation_out,
            "changes": changes,
            "checks": res.get("checks") or {"passed": True, "issues": []},
        },
    }


async def run_hybrid_floorplan_reconstruction(
    *,
    store: Any,
    client: Any,
    task: dict[str, Any],
    project: dict[str, Any],
) -> dict[str, Any]:
    """End-to-end VLM + OpenCV hybrid full-home floorplan reconstruction with optional side-by-side draft confirmation."""
    gen = store.task(task["id"], internal=True).get("generation") or {}
    image_id = gen.get("imageId") or task.get("imageId")
    if not image_id:
        raise ValueError("缺少上传的户型图 imageId")

    style_pack = match_style_pack(None, task.get("input", ""))

    # If user already confirmed the side-by-side hybrid draft, build 3D directly from confirmed JSON!
    if gen.get("hybridConfirmed") and isinstance(gen.get("hybridVlm"), dict) and isinstance(gen.get("hybridCvAxes"), dict):
        return await commit_hybrid_floorplan(
            store=store,
            client=client,
            task=task,
            project=project,
            vlm_json=gen["hybridVlm"],
            cv_axes=gen["hybridCvAxes"],
            style_pack=style_pack,
            gen=gen,
        )

    data_root = Path(state_directory()).parent
    img_dir = data_root / "floorplan-images" / image_id
    img_bytes: bytes | None = None
    if img_dir.is_dir():
        for ext in ("source.png", "source.jpg", "source.jpeg", "original.png", "original.jpg"):
            cand = img_dir / ext
            if cand.is_file():
                img_bytes = cand.read_bytes()
                break
        if img_bytes is None:
            files = [p for p in img_dir.iterdir() if p.is_file() and p.suffix.lower() in (".png", ".jpg", ".jpeg")]
            if files:
                img_bytes = files[0].read_bytes()
    if img_bytes is None:
        img_bytes = await client.bytes(f"/floorplan-images/{image_id}/file")

    cv_axes = detect_cv_wall_axes(img_bytes)
    with Image.open(io.BytesIO(img_bytes)) as im:
        rgb_im = im.convert("RGB")
        rgb_im.thumbnail((1600, 1600))
        buf = io.BytesIO()
        rgb_im.save(buf, format="PNG")
        png_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    v_settings = vision_model_settings()
    user_payload = json.dumps(
        {
            "task": "reconstruct_whole_floorplan",
            "imageAspect": {"widthPx": cv_axes["widthPx"], "heightPx": cv_axes["heightPx"]},
            "cvAxisHints1000": {
                "verticalWallsX": cv_axes["xAxes1000"],
                "horizontalWallsY": cv_axes["yAxes1000"],
            },
            "userHint": task.get("input", ""),
        },
        ensure_ascii=False,
    )
    req_body = {
        "model": v_settings["model"],
        "temperature": 0,
        "max_tokens": 4096,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": HYBRID_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_payload},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{png_b64}"}},
                ],
            },
        ],
    }
    async with httpx.AsyncClient(timeout=v_settings.get("timeout", 120)) as hc:
        resp = await hc.post(
            v_settings["base_url"].rstrip("/") + "/chat/completions",
            headers={
                "authorization": "Bearer " + v_settings["api_key"],
                "content-type": "application/json",
            },
            json=req_body,
        )
    resp.raise_for_status()
    resp_data = resp.json()
    raw_txt = resp_data["choices"][0]["message"]["content"]
    if isinstance(raw_txt, list):
        raw_txt = "".join(part.get("text", "") for part in raw_txt if isinstance(part, dict))
    s_idx, e_idx = raw_txt.find("{"), raw_txt.rfind("}")
    vlm_json = json.loads(raw_txt[s_idx : e_idx + 1])

    wants_review = "[先校对草稿]" in str(task.get("input") or "") or bool(gen.get("requireHybridReview"))
    if wants_review:
        spec, meta = compile_hybrid_housespec(vlm_json, cv_axes, style_pack)
        draft_payload = {
            "imageId": image_id,
            "vlm": vlm_json,
            "cvAxes": cv_axes,
            "previewSpec": spec,
            "meta": meta,
        }
        generation_wait = {
            **gen,
            "mode": "reconstruct_floorplan_hybrid",
            "floorplanMode": "hybrid-v5",
            "hybridReviewPending": True,
            "hybridConfirmed": False,
            "hybridVlm": vlm_json,
            "hybridCvAxes": cv_axes,
            "hybridDraft": draft_payload,
            "roomCount": meta["roomCount"],
            "openingCount": meta["openingCount"],
            "connectedComponents": meta["connectedComponents"],
            "disconnectedRooms": meta["disconnectedRooms"],
            "dimensions": {
                "width": meta["totalWidthMm"],
                "depth": meta["totalDepthMm"],
                "height": 2850,
            },
            "scaleBasis": meta["scaleBasis"],
        }
        store.update(task["id"], generation=generation_wait)
        store.event(task["id"], "brief_frozen", generation_wait)
        conn_tip = (
            f"检测到 {len(meta['disconnectedRooms'])} 处未连通房间（{'、'.join(meta['disconnectedRooms'])}），请校对后确认。"
            if meta["disconnectedRooms"]
            else "所有房间已自动连通闭合。"
        )
        return {
            "route": "end",
            "final": {
                "status": "waiting_input",
                "message": (
                    f"已识别户型结构草稿：{meta['roomCount']} 个房间、{meta['openingCount']} 处门窗，"
                    f"总尺度 {meta['totalWidthMm']/1000:.1f}m × {meta['totalDepthMm']/1000:.1f}m（{meta['scaleBasis']}）。"
                    f"{conn_tip}请点击「并排校对原图与草稿」核对尺寸与门窗后再生成 3D。"
                ),
                "generation": generation_wait,
            },
        }

    return await commit_hybrid_floorplan(
        store=store,
        client=client,
        task=task,
        project=project,
        vlm_json=vlm_json,
        cv_axes=cv_axes,
        style_pack=style_pack,
        gen=gen,
    )
