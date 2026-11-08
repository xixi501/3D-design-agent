"""Deterministic structural and furniture candidates for S2-C V3-3."""

from __future__ import annotations

import math
import statistics
from collections import Counter

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont


def _font(size: int = 12):
    try:
        return ImageFont.truetype("DejaVuSans.ttf", size)
    except OSError:
        return ImageFont.load_default()


def _runs(values, minimum_gap: int = 2):
    output: list[list[int]] = []
    for index in np.nonzero(values)[0]:
        index = int(index)
        if output and index <= output[-1][1] + minimum_gap:
            output[-1][1] = index
        else:
            output.append([index, index])
    return output


def _near(a: float, b: float, tolerance: float = 2.0):
    return abs(float(a) - float(b)) <= tolerance


def _measure_wall(
    gray: np.ndarray,
    orient: str,
    line: float,
    start: float,
    end: float,
    search: int = 25,
):
    """Measure a solid or outlined wall band across repeated cross-sections."""
    values = []
    lo, hi = round(min(start, end)), round(max(start, end))
    for along in range(lo + 6, hi - 5, 3):
        center = round(line)
        left = max(0, center - search)
        right = min(
            gray.shape[0] if orient == "h" else gray.shape[1],
            center + search + 1,
        )
        profile = gray[along, left:right] if orient == "v" else gray[left:right, along]
        dark = profile < 150
        solid = [run for run in _runs(dark) if run[1] - run[0] + 1 >= 7]
        best = None
        for run in solid:
            midpoint = left + (run[0] + run[1]) / 2
            distance = abs(midpoint - line)
            if best is None or distance < best[0]:
                best = (distance, left + run[0] - 0.5, left + run[1] + 0.5, "solid")
        if best is None:
            thin = [run for run in _runs(dark) if run[1] - run[0] + 1 <= 3]
            for first in range(len(thin)):
                for second in range(first + 1, len(thin)):
                    gap = thin[second][0] - thin[first][1] - 1
                    if not 6 <= gap <= 24:
                        continue
                    face_a = left + (thin[first][0] + thin[first][1]) / 2
                    face_b = left + (thin[second][0] + thin[second][1]) / 2
                    midpoint = (face_a + face_b) / 2
                    distance = abs(midpoint - line)
                    if distance <= 12 and (best is None or distance < best[0]):
                        best = (distance, face_a, face_b, "outline")
        if best:
            values.append(best[1:])
    if not values:
        return None
    faces = (
        float(np.median([item[0] for item in values])),
        float(np.median([item[1] for item in values])),
    )
    kinds = [item[2] for item in values]
    return {
        "center": round((faces[0] + faces[1]) / 2, 1),
        "thick_px": round(faces[1] - faces[0], 1),
        "faces": [round(faces[0], 1), round(faces[1], 1)],
        "kind": Counter(kinds).most_common(1)[0][0],
        "n": len(values),
    }


def _segment_groups(segments: list[dict], gaps: list[dict]):
    parent = list(range(len(segments)))

    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left, right):
        left, right = find(left), find(right)
        if left != right:
            parent[max(left, right)] = min(left, right)

    for left, first in enumerate(segments):
        for right in range(left + 1, len(segments)):
            second = segments[right]
            if first["orient"] != second["orient"]:
                continue
            tolerance = max(2.0, min(float(first["t"]), float(second["t"])) / 2)
            if abs(float(first["line"]) - float(second["line"])) > tolerance:
                continue
            if (
                max(float(first["s0"]), float(second["s0"]))
                <= min(float(first["s1"]), float(second["s1"])) + 2
            ):
                union(left, right)
    for gap in gaps:
        left, right = gap.get("a"), gap.get("b")
        if not (
            isinstance(left, int)
            and isinstance(right, int)
            and 0 <= left < len(segments)
            and 0 <= right < len(segments)
        ):
            continue
        first, second = segments[left], segments[right]
        if first["orient"] == second["orient"] and abs(
            float(first["line"]) - float(second["line"])
        ) <= max(3.0, min(float(first["t"]), float(second["t"])) * 0.75):
            union(left, right)
    groups: dict[int, list[int]] = {}
    for index in range(len(segments)):
        groups.setdefault(find(index), []).append(index)
    return [sorted(indices) for indices in groups.values()]


def _perimeter_wall(
    gray: np.ndarray,
    role: str,
    outline: list[int],
    search: int = 18,
):
    x0, y0, x1, y1 = [float(value) for value in outline]
    orient = "h" if role in ("top", "bottom") else "v"
    line = (
        y0 + 4
        if role == "top"
        else y1 - 4
        if role == "bottom"
        else x0 + 4
        if role == "left"
        else x1 - 4
    )
    start, end = (x0, x1) if orient == "h" else (y0, y1)
    measured = _measure_wall(gray, orient, line, start, end, search=search)
    thickness = float(measured["thick_px"]) if measured and measured["thick_px"] >= 3 else 8.0
    center = (
        float(measured["center"])
        if measured and measured["n"] >= 5
        else (
            y0 + thickness / 2
            if role == "top"
            else y1 - thickness / 2
            if role == "bottom"
            else x0 + thickness / 2
            if role == "left"
            else x1 - thickness / 2
        )
    )
    return {
        "candidateWallId": "cw_" + role,
        "role": role,
        "orient": orient,
        "line": round(center, 1),
        "s0": round(
            (x0 if orient == "h" else y0) + thickness / 2,
            1,
        ),
        "s1": round(
            (x1 if orient == "h" else y1) - thickness / 2,
            1,
        ),
        "t": round(thickness, 1),
        "faces": measured["faces"] if measured else None,
        "measurement": measured,
        "sourceIndices": [],
    }


def _snap(candidate: dict, others: list[dict], tolerance: float = 30.0):
    output = dict(candidate)
    for key in ("s0", "s1"):
        value = float(output[key])
        matches = []
        for other in others:
            if other is candidate or (
                candidate.get("candidateWallId")
                and other.get("candidateWallId") == candidate.get("candidateWallId")
            ):
                continue
            if other["orient"] == candidate["orient"]:
                continue
            across = float(other["line"])
            other_lo, other_hi = sorted((float(other["s0"]), float(other["s1"])))
            if (
                abs(value - across) <= tolerance
                and other_lo - tolerance <= float(output["line"]) <= other_hi + tolerance
            ):
                matches.append((abs(value - across), across))
        if matches:
            output[key] = round(min(matches)[1], 1)
    return output


def _connect_perimeter(perimeter: list[dict]):
    walls = {wall["role"]: wall for wall in perimeter}
    if set(walls) != {"top", "bottom", "left", "right"}:
        return perimeter
    walls["top"]["s0"] = walls["left"]["line"]
    walls["top"]["s1"] = walls["right"]["line"]
    walls["bottom"]["s0"] = walls["left"]["line"]
    walls["bottom"]["s1"] = walls["right"]["line"]
    walls["left"]["s0"] = walls["top"]["line"]
    walls["left"]["s1"] = walls["bottom"]["line"]
    walls["right"]["s0"] = walls["top"]["line"]
    walls["right"]["s1"] = walls["bottom"]["line"]
    return perimeter


def _opening_candidates(gray: np.ndarray, walls: list[dict]):
    ink = gray < 225
    output = []
    for wall in walls:
        orient = wall["orient"]
        line = float(wall["line"])
        start, end = sorted((float(wall["s0"]), float(wall["s1"])))
        thickness = max(3.0, float(wall["t"]))
        half = thickness / 2 + 3.5
        states = []
        for along in range(round(start), round(end) + 1):
            lo = math.floor(line - half)
            hi = math.ceil(line + half)
            profile = ink[lo:hi, along] if orient == "h" else ink[along, lo:hi]
            if not len(profile):
                states.append("open")
                continue
            runs = _runs(profile)
            faces = bool(profile[:4].any() and profile[-4:].any())
            if float(profile.mean()) >= 0.35:
                states.append("solid")
            elif faces and len(runs) >= 2:
                states.append("window")
            else:
                states.append("open")
        smoothed = []
        for index in range(len(states)):
            window = states[max(0, index - 2) : min(len(states), index + 3)]
            smoothed.append(Counter(window).most_common(1)[0][0])
        intervals = []
        for index, state in enumerate(smoothed):
            position = round(start) + index
            if intervals and intervals[-1]["state"] == state:
                intervals[-1]["end"] = position
            else:
                intervals.append({"start": position, "end": position, "state": state})
        for interval in intervals:
            length = interval["end"] - interval["start"] + 1
            if interval["state"] == "solid" or length < 10:
                continue
            opening_start = interval["start"]
            opening_end = interval["end"]
            if interval["state"] == "window" and length < 35:
                opening_start = max(round(start), opening_start - 5)
                opening_end = min(round(end), opening_end + 5)
            width = opening_end - opening_start + 1
            center = (opening_start + opening_end) / 2
            output.append(
                {
                    "candidateId": "op_" + str(len(output)),
                    "candidateWallId": wall["candidateWallId"],
                    "wallId": wall["candidateWallId"],
                    "orient": orient,
                    "line": line,
                    "start": round(float(opening_start), 1),
                    "end": round(float(opening_end), 1),
                    "center": round(center, 1),
                    "width": float(width),
                    "typeHint": "window" if interval["state"] == "window" else "door",
                    "confidence": round(
                        min(
                            0.99,
                            0.58
                            + min(width, 80) / 200
                            + (0.12 if (wall.get("measurement") or {}).get("n", 0) > 10 else 0),
                        ),
                        2,
                    ),
                }
            )
    return output


def _green_mask(rgb: np.ndarray):
    red, green, blue = (rgb[..., index].astype(int) for index in range(3))
    return (green > red + 12) & (green > blue + 8) & (green > 70) & (red > 10)


def _dimension_lines(image: Image.Image, outline: list[int]):
    width, height = image.size
    rgb = np.asarray(image.convert("RGB"))
    mask = _green_mask(rgb)
    x0, y0, x1, y1 = [float(value) for value in outline]
    seed = []
    horizontal = cv2.morphologyEx(
        mask.astype(np.uint8),
        cv2.MORPH_CLOSE,
        np.ones((1, 81), np.uint8),
    )
    vertical = cv2.morphologyEx(
        mask.astype(np.uint8),
        cv2.MORPH_CLOSE,
        np.ones((81, 1), np.uint8),
    )
    for at in range(height):
        runs = _runs(horizontal[at] > 0, minimum_gap=2)
        if not runs:
            continue
        lo, hi = max(runs, key=lambda run: run[1] - run[0])
        if hi - lo + 1 < max(100, int(width * 0.35)):
            continue
        if at < y0 - 2:
            side = "top"
        elif at > y1 + 2:
            side = "bottom"
        else:
            continue
        seed.append(
            {
                "orient": "h",
                "axis": "h",
                "side": side,
                "at": float(at),
                "from": float(lo),
                "to": float(hi),
            }
        )
    for at in range(width):
        runs = _runs(vertical[:, at] > 0, minimum_gap=2)
        if not runs:
            continue
        lo, hi = max(runs, key=lambda run: run[1] - run[0])
        if hi - lo + 1 < max(100, int(height * 0.35)):
            continue
        if at < x0 - 2:
            side = "left"
        elif at > x1 + 2:
            side = "right"
        else:
            continue
        seed.append(
            {
                "orient": "v",
                "axis": "v",
                "side": side,
                "at": float(at),
                "from": float(lo),
                "to": float(hi),
            }
        )
    grouped = []
    for item in sorted(seed, key=lambda value: (value["side"], value["at"])):
        same = next(
            (
                group
                for group in grouped
                if group["side"] == item["side"] and _near(group["at"], item["at"], 3)
            ),
            None,
        )
        if same:
            same["rows"].append(item)
        else:
            grouped.append({**item, "rows": [item]})
    output = []
    for side in ("top", "bottom", "left", "right"):
        side_groups = [group for group in grouped if group["side"] == side]
        side_groups.sort(key=lambda group: group["at"])
        if side in ("bottom", "right"):
            side_groups.sort(key=lambda group: -group["at"])
        for slot, group in enumerate(side_groups):
            at = statistics.median(row["at"] for row in group["rows"])
            lo = min(row["from"] for row in group["rows"])
            hi = max(row["to"] for row in group["rows"])
            output.append(
                {
                    "candidateId": f"dim_{side}_{slot}",
                    "axis": "h" if side in ("top", "bottom") else "v",
                    "side": side,
                    "at": round(float(at), 1),
                    "ticks": [round(float(lo), 1), round(float(hi), 1)],
                    "suggestedWallRole": {
                        "top": "top",
                        "bottom": "bottom",
                        "left": "left",
                        "right": "right",
                    }[side],
                    "suggestedBasis": "exterior" if slot == 0 else "interior",
                    "evidence": f"{side} exterior dimension line {slot + 1}",
                }
            )
    return output


def structure_candidates(image: Image.Image, raw: dict):
    """Return deterministic wall groups, openings and external dimension lines."""
    rgb = np.asarray(image.convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    outline = raw.get("outline_px")
    if not isinstance(outline, list) or len(outline) != 4:
        raise ValueError("墙线分析缺少有效外轮廓")
    x0, y0, x1, y1 = [round(float(value)) for value in outline]
    perimeter = [
        _perimeter_wall(gray, role, [x0, y0, x1, y1]) for role in ("top", "left", "bottom", "right")
    ]
    perimeter = _connect_perimeter(perimeter)
    segments = list(raw.get("segments_px") or [])
    gaps = list(raw.get("gaps_px") or [])
    interior = []
    for indices in _segment_groups(segments, gaps):
        pieces = [segments[index] for index in indices]
        orient = pieces[0]["orient"]
        if any(piece["orient"] != orient for piece in pieces):
            continue
        line = float(statistics.median(float(piece["line"]) for piece in pieces))
        start = min(float(piece["s0"]) for piece in pieces)
        end = max(float(piece["s1"]) for piece in pieces)
        if end - start < 80:
            continue
        if orient == "h" and (
            abs(line - perimeter[0]["line"]) <= 24 or abs(line - perimeter[2]["line"]) <= 24
        ):
            continue
        if orient == "v" and (
            abs(line - perimeter[1]["line"]) <= 24 or abs(line - perimeter[3]["line"]) <= 24
        ):
            continue
        measured = _measure_wall(gray, orient, line, start, end)
        if not measured or measured["n"] < 4 or measured["thick_px"] < 4:
            continue
        interior.append(
            {
                "candidateWallId": "",
                "role": "interior",
                "orient": orient,
                "line": round(float(measured["center"]), 1),
                "s0": round(start, 1),
                "s1": round(end, 1),
                "t": round(float(measured["thick_px"]), 1),
                "faces": measured["faces"],
                "measurement": measured,
                "sourceIndices": indices,
            }
        )
    provisional = [*perimeter, *interior]
    connected = []
    for wall in interior:
        wall = _snap(wall, provisional)
        connections = 0
        for other in provisional:
            if other["orient"] == wall["orient"]:
                continue
            lo, hi = sorted((float(other["s0"]), float(other["s1"])))
            across = float(other["line"])
            for endpoint in (float(wall["s0"]), float(wall["s1"])):
                if abs(endpoint - across) <= 30 and lo - 30 <= float(wall["line"]) <= hi + 30:
                    connections += 1
        if connections >= 2:
            connected.append(wall)
    interior = connected
    for orient in ("h", "v"):
        ordered = sorted(
            [wall for wall in interior if wall["orient"] == orient],
            key=lambda wall: (wall["line"], wall["s0"]),
        )
        for index, wall in enumerate(ordered):
            wall["candidateWallId"] = f"cw_int_{orient}_{index}"
    walls = [*perimeter, *interior]
    for wall in walls:
        if not wall.get("sourceIndices"):
            wall["sourceIndices"] = [
                index
                for index, segment in enumerate(segments)
                if segment["orient"] == wall["orient"]
                and abs(float(segment["line"]) - float(wall["line"])) <= 3
                and min(float(segment["s1"]), float(wall["s1"]))
                >= max(float(segment["s0"]), float(wall["s0"])) - 2
            ]
        wall["evidence"] = f"{wall['role']} wall, center={wall['line']}, thickness={wall['t']}"
    openings = _opening_candidates(gray, walls)
    dimensions = _dimension_lines(image, [x0, y0, x1, y1])
    return {
        "structureSkeletonVersion": 3,
        "candidateWalls": walls,
        "openingCandidates": openings,
        "dimensionCandidates": dimensions,
        "lineCandidates": [
            {
                "id": f"line_{index}",
                "orient": wall["orient"],
                "at": wall["line"],
                "from": wall["s0"],
                "to": wall["s1"],
                "wallCandidateId": wall["candidateWallId"],
            }
            for index, wall in enumerate(walls)
        ],
        "candidateSummary": {
            "walls": len(walls),
            "openings": len(openings),
            "dimensionLines": len(dimensions),
        },
    }


def structure_overlay(image: Image.Image, candidates: dict):
    output = image.convert("RGB").copy()
    draw = ImageDraw.Draw(output, "RGBA")
    font = _font(11)
    colors = {
        "top": (214, 44, 44),
        "bottom": (214, 44, 44),
        "left": (214, 44, 44),
        "right": (214, 44, 44),
        "interior": (25, 150, 85),
    }
    for wall in candidates.get("candidateWalls", []):
        color = colors.get(wall.get("role"), colors["interior"])
        if wall["orient"] == "h":
            points = [(wall["s0"], wall["line"]), (wall["s1"], wall["line"])]
        else:
            points = [(wall["line"], wall["s0"]), (wall["line"], wall["s1"])]
        draw.line(points, fill=color + (210,), width=3)
        draw.text(
            (points[0][0] + 2, points[0][1] + 2),
            wall["candidateWallId"],
            fill=color + (255,),
            font=font,
        )
    for opening in candidates.get("openingCandidates", []):
        color = (235, 140, 20) if opening["typeHint"] == "door" else (25, 100, 220)
        if opening["orient"] == "h":
            box = [
                opening["start"],
                opening["line"] - 10,
                opening["end"],
                opening["line"] + 10,
            ]
        else:
            box = [
                opening["line"] - 10,
                opening["start"],
                opening["line"] + 10,
                opening["end"],
            ]
        draw.rectangle(box, outline=color + (240,), width=2)
        draw.text((box[0] + 2, box[1] + 2), opening["candidateId"], fill=color + (255,), font=font)
    for dimension in candidates.get("dimensionCandidates", []):
        color = (160, 40, 180)
        if dimension["axis"] == "h":
            draw.line(
                [
                    (dimension["ticks"][0], dimension["at"]),
                    (dimension["ticks"][1], dimension["at"]),
                ],
                fill=color + (220,),
                width=2,
            )
            draw.text(
                (dimension["ticks"][0] + 4, dimension["at"] - 15),
                dimension["candidateId"],
                fill=color + (255,),
                font=font,
            )
        else:
            draw.line(
                [
                    (dimension["at"], dimension["ticks"][0]),
                    (dimension["at"], dimension["ticks"][1]),
                ],
                fill=color + (220,),
                width=2,
            )
            draw.text(
                (dimension["at"] + 4, dimension["ticks"][0] + 4),
                dimension["candidateId"],
                fill=color + (255,),
                font=font,
            )
    return output


def _room_region(gray: np.ndarray, spec: dict):
    height, width = gray.shape
    barrier = np.zeros((height, width), np.uint8)
    walls = {wall["id"]: wall for wall in spec.get("walls", [])}
    for wall in walls.values():
        thickness = max(5, round(float(wall.get("thicknessPx") or 8)))
        first = (round(wall["a"]["x"]), round(wall["a"]["y"]))
        second = (round(wall["b"]["x"]), round(wall["b"]["y"]))
        cv2.line(barrier, first, second, 1, thickness + 2)
    free = (barrier == 0).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(free, 8)
    rooms = {room["id"]: room for room in spec.get("rooms", [])}
    regions = {}
    for room_id in spec.get("targetRoomIds", []):
        room = rooms.get(room_id)
        if not room:
            continue
        x = min(width - 1, max(0, round(room["at"]["x"])))
        y = min(height - 1, max(0, round(room["at"]["y"])))
        label = int(labels[y, x])
        if label == 0 or label >= count:
            continue
        region = labels == label
        if int(stats[label, cv2.CC_STAT_AREA]) < 400:
            continue
        regions[room_id] = region
    return regions


def _inside_region(region: np.ndarray, x: float, y: float):
    height, width = region.shape
    px, py = round(x), round(y)
    return 0 <= px < width and 0 <= py < height and bool(region[py, px])


def _dedupe_candidates(candidates: list[dict]):
    deduped = []
    for candidate in sorted(
        candidates,
        key=lambda item: (
            item["bbox"][1],
            item["bbox"][0],
            -item["bbox"][2] * item["bbox"][3],
            -item["area"],
        ),
    ):
        duplicate = False
        for saved in deduped:
            if all(abs(candidate["bbox"][index] - saved["bbox"][index]) <= 2 for index in range(4)):
                if candidate["area"] > saved["area"]:
                    saved.update(candidate)
                duplicate = True
                break
        if not duplicate:
            deduped.append(dict(candidate))
    deduped.sort(key=lambda item: (item["bbox"][1], item["bbox"][0], -item["area"]))
    for index, candidate in enumerate(deduped):
        candidate["candidateId"] = f"fc_{index:03d}"
        candidate["center"] = {
            "x": round(candidate["bbox"][0] + candidate["bbox"][2] / 2, 1),
            "y": round(candidate["bbox"][1] + candidate["bbox"][3] / 2, 1),
        }
    return deduped


def contour_candidates(image: Image.Image, spec: dict):
    rgb = np.asarray(image.convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    regions = _room_region(gray, spec)
    if not regions:
        raise ValueError("目标房间没有形成可扫描的封闭区域")
    region = np.zeros_like(gray, dtype=bool)
    for target in regions.values():
        region |= target
    ink = ((gray < 215) & region).astype(np.uint8) * 255
    closed = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, np.ones((2, 2), np.uint8))
    contours, _ = cv2.findContours(closed, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    candidates = []
    for contour in contours:
        x, y, width, height = cv2.boundingRect(contour)
        area = float(abs(cv2.contourArea(contour)))
        if not (6 <= width <= 300 and 5 <= height <= 300 and area >= 12):
            continue
        if not _inside_region(region, x + width / 2, y + height / 2):
            continue
        patch = region[y : y + height, x : x + width]
        if patch.size == 0 or patch.mean() < 0.35:
            continue
        candidates.append(
            {
                "bbox": [int(x), int(y), int(width), int(height)],
                "area": area,
                "shape": "contour",
            }
        )
    for kernel in (3, 5):
        grouped = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, np.ones((kernel, kernel), np.uint8))
        count, _labels, stats, _ = cv2.connectedComponentsWithStats(grouped, 8)
        for index in range(1, count):
            x, y, width, height, area = [int(value) for value in stats[index]]
            if not (8 <= width <= 320 and 6 <= height <= 260 and area >= 40):
                continue
            if not _inside_region(region, x + width / 2, y + height / 2):
                continue
            if width * height > int(region.sum() * 0.65):
                continue
            candidates.append(
                {
                    "bbox": [x, y, width, height],
                    "area": float(area),
                    "shape": "group",
                }
            )
    candidates = _dedupe_candidates(candidates)[:80]
    overlay = image.convert("RGB").copy()
    draw = ImageDraw.Draw(overlay, "RGBA")
    font = _font(10)
    for candidate in candidates:
        x, y, width, height = candidate["bbox"]
        color = (220, 45, 100) if candidate["shape"] == "contour" else (20, 145, 170)
        draw.rectangle(
            [x, y, x + width, y + height],
            outline=color + (210,),
            width=1,
        )
        draw.text(
            (x + 1, y + 1),
            candidate["candidateId"],
            fill=color + (255,),
            font=font,
        )
    region_union = np.zeros_like(gray, dtype=bool)
    for mask in regions.values():
        region_union |= mask
    ys, xs = np.nonzero(region_union)
    margin = 12
    crop_box = (
        max(0, int(xs.min()) - margin),
        max(0, int(ys.min()) - margin),
        min(image.width, int(xs.max() + 1) + margin),
        min(image.height, int(ys.max() + 1) + margin),
    )
    target_overlay = overlay.crop(crop_box)
    factor = min(2.5, 1600 / max(target_overlay.size))
    if factor > 1:
        target_overlay = target_overlay.resize(
            (
                round(target_overlay.width * factor),
                round(target_overlay.height * factor),
            ),
            Image.Resampling.LANCZOS,
        )
    return {
        "contourCandidates": candidates,
        "targetRegions": {
            room_id: {
                "bbox": [
                    int(np.nonzero(mask)[1].min()),
                    int(np.nonzero(mask)[0].min()),
                    int(np.nonzero(mask)[1].max() + 1),
                    int(np.nonzero(mask)[0].max() + 1),
                ],
                "pixels": int(mask.sum()),
            }
            for room_id, mask in regions.items()
        },
        "overlay": overlay,
        "targetOverlay": target_overlay,
    }
