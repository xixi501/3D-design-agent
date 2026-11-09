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


def _overlap(first, second, padding: int = 0):
    return not (
        first[2] + padding < second[0]
        or second[2] + padding < first[0]
        or first[3] + padding < second[1]
        or second[3] + padding < first[1]
    )


def _union_bbox(candidates):
    return [
        min(candidate["bbox"][0] for candidate in candidates),
        min(candidate["bbox"][1] for candidate in candidates),
        max(candidate["bbox"][0] + candidate["bbox"][2] for candidate in candidates)
        - min(candidate["bbox"][0] for candidate in candidates),
        max(candidate["bbox"][1] + candidate["bbox"][3] for candidate in candidates)
        - min(candidate["bbox"][1] for candidate in candidates),
    ]


def _bbox_contains(outer, inner, tolerance: int = 1):
    return (
        outer[0] <= inner[0] + tolerance
        and outer[1] <= inner[1] + tolerance
        and outer[0] + outer[2] >= inner[0] + inner[2] - tolerance
        and outer[1] + outer[3] >= inner[1] + inner[3] - tolerance
    )


def _bbox_touches(first, second):
    return (
        first[0] <= second[0] + second[2]
        and second[0] <= first[0] + first[2]
        and first[1] <= second[1] + second[3]
        and second[1] <= first[1] + first[3]
    )


def _center(candidate):
    return (
        candidate["bbox"][0] + candidate["bbox"][2] / 2,
        candidate["bbox"][1] + candidate["bbox"][3] / 2,
    )


def _tight_long_group_bbox(candidate, image: Image.Image | None):
    bbox = list(candidate["bbox"])
    if image is None:
        return bbox
    x, y, width, height = bbox
    crop = np.asarray(image.convert("L").crop((x, y, x + width, y + height)))
    ink = crop < 215
    if height >= width * 2.3:
        columns = np.nonzero(ink.sum(0) >= max(4, height * 0.25))[0]
        if len(columns) < 2:
            return bbox
        left, right = int(columns.min()), int(columns.max()) + 1
        rows = np.nonzero(ink[:, left:right].any(1))[0]
        if len(rows):
            return [
                x + left,
                y + int(rows.min()),
                max(8, right - left),
                max(8, int(rows.max() - rows.min() + 1)),
            ]
    elif width >= height * 2.3:
        rows = np.nonzero(ink.sum(1) >= max(4, width * 0.25))[0]
        if len(rows) < 2:
            return bbox
        top, bottom = int(rows.min()), int(rows.max()) + 1
        columns = np.nonzero(ink[top:bottom, :].any(0))[0]
        if len(columns):
            return [
                x + int(columns.min()),
                y + top,
                max(8, int(columns.max() - columns.min() + 1)),
                max(8, bottom - top),
            ]
    return bbox


def _trim_aligned_composite(candidate, by_id):
    if candidate.get("kind") != "composite":
        return candidate
    members = [
        by_id[contour_id] for contour_id in candidate["contourCandidateIds"] if contour_id in by_id
    ]
    if len(members) < 3:
        return candidate
    largest = max(float(member.get("area") or 0) for member in members)
    large = [
        member for member in members if float(member.get("area") or 0) >= max(80, largest * 0.18)
    ]
    if len(large) < 2:
        return candidate
    centers = [_center(member) for member in large]
    x_spread = max(value[0] for value in centers) - min(value[0] for value in centers)
    y_spread = max(value[1] for value in centers) - min(value[1] for value in centers)
    if min(x_spread, y_spread) > 8 or max(x_spread, y_spread) < 12:
        return candidate
    axis = 0 if x_spread <= y_spread else 1
    center = statistics.median(value[axis] for value in centers)
    sizes = [member["bbox"][2 if axis == 0 else 3] for member in large]
    tolerance = max(6, statistics.median(sizes) * 0.22)
    kept = [member for member in members if abs(_center(member)[axis] - center) <= tolerance]
    if len(kept) < 2 or len(kept) == len(members):
        return candidate
    candidate = dict(candidate)
    candidate["contourCandidateIds"] = sorted(member["candidateId"] for member in kept)
    candidate["bbox"] = _union_bbox(kept)
    return candidate


def _descendant_contours(candidate, children):
    output = [candidate["candidateId"]]
    for child in children.get(candidate["candidateId"], []):
        output.extend(_descendant_contours(child, children))
    return output


def _similar_repeated_parts(candidate, children):
    if len(children) < 2:
        return False
    widths = [child["bbox"][2] for child in children]
    heights = [child["bbox"][3] for child in children]
    median_width = statistics.median(widths)
    median_height = statistics.median(heights)
    similar = sum(
        abs(child["bbox"][2] - median_width) <= max(2, median_width * 0.25)
        and abs(child["bbox"][3] - median_height) <= max(2, median_height * 0.25)
        for child in children
    )
    child_area = sum(child["bbox"][2] * child["bbox"][3] for child in children)
    parent_area = candidate["bbox"][2] * candidate["bbox"][3]
    return similar / len(children) >= 0.75 and child_area / parent_area >= 0.45


def _concentric_children(candidate, children):
    if len(children) != 1:
        return False
    parent_x, parent_y = _center(candidate)
    child_x, child_y = _center(children[0])
    tolerance = max(2, min(candidate["bbox"][2], candidate["bbox"][3]) * 0.1)
    return math.hypot(parent_x - child_x, parent_y - child_y) <= tolerance


def _child_families(children):
    parent = list(range(len(children)))

    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    for first in range(len(children)):
        for second in range(first + 1, len(children)):
            if _bbox_touches(children[first]["bbox"], children[second]["bbox"]):
                a, b = find(first), find(second)
                parent[b] = a
    groups = {}
    for index, child in enumerate(children):
        groups.setdefault(find(index), []).append(child)
    return list(groups.values())


def _radial_candidate(candidate, children):
    if len(children) < 4:
        return None
    primary = max(
        children,
        key=lambda child: child["bbox"][2] * child["bbox"][3],
    )
    parent_area = candidate["bbox"][2] * candidate["bbox"][3]
    primary_area = primary["bbox"][2] * primary["bbox"][3]
    if primary_area < parent_area * 0.25:
        return None
    parent_x, parent_y = _center(candidate)
    primary_x, primary_y = _center(primary)
    if (
        abs(parent_x - primary_x) > candidate["bbox"][2] * 0.15
        or abs(parent_y - primary_y) > candidate["bbox"][3] * 0.15
    ):
        return None
    satellites = [
        child
        for child in children
        if child is not primary and child["bbox"][2] * child["bbox"][3] <= primary_area * 0.35
    ]
    if len(satellites) < 3:
        return None
    directions = set()
    for satellite in satellites:
        x, y = _center(satellite)
        dx, dy = x - primary_x, y - primary_y
        directions.add("e" if dx > abs(dy) else "w" if -dx > abs(dy) else "s" if dy > 0 else "n")
    if len(directions) < 3:
        return None
    return primary, satellites


def _quad_seating_cluster(candidate, children, children_map):
    """Infer a table body from two opposite rows of independent chairs."""
    if len(children) < 5:
        return None
    parent_area = candidate["bbox"][2] * candidate["bbox"][3]
    _parent_x, parent_y = _center(candidate)
    small = []
    for child in children:
        width, height = child["bbox"][2], child["bbox"][3]
        area = width * height
        ratio = width / max(1, height)
        if area >= 80 and area <= parent_area * 0.22 and 0.45 <= ratio <= 2.2:
            small.append(child)
    top = [child for child in small if _center(child)[1] < parent_y - candidate["bbox"][3] * 0.08]
    bottom = [
        child for child in small if _center(child)[1] > parent_y + candidate["bbox"][3] * 0.08
    ]
    if len(top) < 2 or len(bottom) < 2:
        return None

    def similar(items):
        widths = [item["bbox"][2] for item in items]
        heights = [item["bbox"][3] for item in items]
        return max(widths) - min(widths) <= max(4, statistics.median(widths) * 0.35) and max(
            heights
        ) - min(heights) <= max(4, statistics.median(heights) * 0.35)

    if not similar(top) or not similar(bottom):
        return None
    top_y = max(item["bbox"][1] + item["bbox"][3] for item in top)
    bottom_y = min(item["bbox"][1] for item in bottom)
    if bottom_y - top_y < candidate["bbox"][3] * 0.18:
        return None
    satellites = {item["candidateId"]: item for item in [*top, *bottom]}
    inner = [child for child in children if child["candidateId"] not in satellites]
    primary_ids = list(_descendant_contours(candidate, children_map))
    primary_ids = [candidate_id for candidate_id in primary_ids if candidate_id not in satellites]
    table_bbox = [
        candidate["bbox"][0],
        round(top_y),
        candidate["bbox"][2],
        max(1, round(bottom_y - top_y)),
    ]
    return {
        "bbox": table_bbox,
        "kind": "composite",
        "contourCandidateIds": primary_ids,
        "satellites": [*top, *bottom],
        "innerContours": inner,
    }


def furniture_object_candidates(
    candidates: list[dict],
    image: Image.Image | None = None,
    target_bbox: list[int] | None = None,
    policy_version: str = "legacy-room-semantics",
):
    if policy_version not in ("legacy-room-semantics", "geometry-only"):
        raise ValueError("未知家具候选语义策略")
    legacy_semantics = policy_version == "legacy-room-semantics"
    contours = [dict(candidate) for candidate in candidates if candidate["shape"] == "contour"]
    by_id = {candidate["candidateId"]: candidate for candidate in contours}
    children = {candidate["candidateId"]: [] for candidate in contours}
    parents = {}
    for candidate in contours:
        containers = [
            other
            for other in contours
            if other is not candidate and _bbox_contains(other["bbox"], candidate["bbox"])
        ]
        parent = (
            min(
                containers,
                key=lambda other: other["bbox"][2] * other["bbox"][3],
            )
            if containers
            else None
        )
        if parent is not None:
            parents[candidate["candidateId"]] = parent["candidateId"]
            children[parent["candidateId"]].append(candidate)
    for values in children.values():
        values.sort(key=lambda item: (item["bbox"][1], item["bbox"][0]))

    objects = []
    radial_groups = []

    def append_object(members, kind):
        bbox = _union_bbox(members)
        room_ids = sorted(
            {
                room_id
                for member in members
                for room_id in (member.get("roomIds") or [])
            }
        )
        objects.append(
            {
                "bbox": bbox,
                "kind": kind,
                "roomIds": room_ids,
                "contourCandidateIds": sorted(
                    {
                        candidate_id
                        for member in members
                        for candidate_id in (
                            _descendant_contours(member, children)
                            if kind == "composite"
                            else [member["candidateId"]]
                        )
                    }
                ),
            }
        )

    def materialize(candidate):
        direct = children[candidate["candidateId"]]
        if not direct:
            append_object([candidate], "atomic")
            return [candidate["candidateId"]]
        radial = _radial_candidate(candidate, direct)
        if radial:
            primary, satellites = radial
            members = materialize(primary)
            satellite_members = []
            for satellite in satellites:
                satellite_members.extend(materialize(satellite))
            radial_groups.append(
                {
                    "primaryContourIds": members,
                    "satelliteContourIds": satellite_members,
                }
            )
            return _descendant_contours(candidate, children)
        quad = _quad_seating_cluster(candidate, direct, children)
        if quad:
            objects.append(
                {
                    "bbox": quad["bbox"],
                    "kind": quad["kind"],
                    "roomIds": sorted(
                        {
                            room_id
                            for member in [candidate, *quad["satellites"]]
                            for room_id in (member.get("roomIds") or [])
                        }
                    ),
                    "contourCandidateIds": sorted(quad["contourCandidateIds"]),
                }
            )
            satellite_members = []
            for satellite in quad["satellites"]:
                satellite_members.extend(materialize(satellite))
            radial_groups.append(
                {
                    "primaryContourIds": quad["contourCandidateIds"],
                    "satelliteContourIds": satellite_members,
                }
            )
            return _descendant_contours(candidate, children)
        if _similar_repeated_parts(candidate, direct) or _concentric_children(candidate, direct):
            append_object([candidate, *direct], "composite")
            return _descendant_contours(candidate, children)
        if len(direct) == 1:
            append_object([candidate], "atomic")
            return [candidate["candidateId"], *materialize(direct[0])]
        families = _child_families(direct)
        if len(families) > 1:
            materialized = []
            for family in families:
                if len(family) == 1:
                    materialized.extend(materialize(family[0]))
                else:
                    append_object(family, "composite")
                    materialized.extend(
                        candidate_id
                        for member in family
                        for candidate_id in _descendant_contours(member, children)
                    )
            return materialized
        append_object([candidate, *direct], "composite")
        return _descendant_contours(candidate, children)

    roots = [candidate for candidate in contours if candidate["candidateId"] not in parents]
    for root in roots:
        materialize(root)

    unique = {}
    for candidate in objects:
        key = tuple(candidate["contourCandidateIds"])
        existing = unique.get(key)
        if existing is None or candidate["kind"] == "composite":
            unique[key] = candidate
    filtered = []
    for candidate in unique.values():
        candidate = _trim_aligned_composite(candidate, by_id)
        members = [
            by_id[candidate_id]
            for candidate_id in candidate["contourCandidateIds"]
            if candidate_id in by_id
        ]
        bbox_area = max(1, candidate["bbox"][2] * candidate["bbox"][3])
        member_area = sum(float(member.get("area") or 0) for member in members)
        candidate["fillRatio"] = round(min(1.0, member_area / bbox_area), 4)
        candidate["requiredForCoverage"] = (
            candidate["kind"] == "composite" or candidate["fillRatio"] >= 0.75
        )
        if candidate["kind"] == "atomic" and bbox_area >= 200 and candidate["fillRatio"] < 0.08:
            continue
        filtered.append(candidate)
    group_objects = []
    used_group_ids = set()
    selected_group_bboxes = []
    for group in candidates:
        if group.get("shape") != "group":
            continue
        x, y, width, height = group["bbox"]
        short, long = sorted((width, height))
        area = float(group.get("area") or 0)
        if not (
            20 <= short <= 45
            and 60 <= long <= 140
            and area >= 300
            and area / max(1, width * height) >= 0.08
        ):
            continue
        group_objects.append(
            {
                "bbox": _tight_long_group_bbox(group, image),
                "kind": "composite",
                "roomIds": list(group.get("roomIds") or []),
                "contourCandidateIds": [group["candidateId"]],
                "sourceGroupId": group["candidateId"],
                "fillRatio": round(area / max(1, width * height), 4),
                "requiredForCoverage": True,
            }
        )
        used_group_ids.add(group["candidateId"])
        selected_group_bboxes.append((group["bbox"], area))
    for group in candidates:
        if group.get("shape") != "group" or group["candidateId"] in used_group_ids:
            continue
        x, y = _center(group)
        group_area = float(group.get("area") or 0)
        if any(
            bbox[0] <= x <= bbox[0] + bbox[2]
            and bbox[1] <= y <= bbox[1] + bbox[3]
            and group_area <= selected_area
            for bbox, selected_area in selected_group_bboxes
        ):
            used_group_ids.add(group["candidateId"])
    filtered.extend(group_objects)
    objects = sorted(
        filtered,
        key=lambda item: (
            item["bbox"][1],
            item["bbox"][0],
            item["bbox"][2],
            item["bbox"][3],
            tuple(item["contourCandidateIds"]),
        ),
    )
    for index, candidate in enumerate(objects):
        candidate["objectCandidateId"] = f"fo_{index:03d}"
        candidate["center"] = {
            "x": round(candidate["bbox"][0] + candidate["bbox"][2] / 2, 1),
            "y": round(candidate["bbox"][1] + candidate["bbox"][3] / 2, 1),
        }
        candidate["contextTags"] = []
        candidate["colorTags"] = []
        candidate["categoryHints"] = []
        if image is not None:
            x, y, width, height = candidate["bbox"]
            crop = np.asarray(image.convert("RGB").crop((x, y, x + width, y + height)))
            if crop.size:
                hsv = cv2.cvtColor(crop, cv2.COLOR_RGB2HSV)
                green = (
                    (hsv[:, :, 0] >= 35)
                    & (hsv[:, :, 0] <= 95)
                    & (hsv[:, :, 1] >= 40)
                    & (hsv[:, :, 2] >= 30)
                )
                if float(green.mean()) >= 0.08:
                    candidate["colorTags"].append("green")
    for group in radial_groups:
        primary_key = tuple(sorted(group["primaryContourIds"]))
        satellite_ids = set(group["satelliteContourIds"])
        for candidate in objects:
            key = tuple(sorted(candidate["contourCandidateIds"]))
            if key == primary_key:
                candidate["categoryHints"].append("diningTable")
            if satellite_ids.intersection(candidate["contourCandidateIds"]):
                candidate["categoryHints"].append("chair")
    fixed_runs = (
        [
            candidate
            for candidate in candidates
            if candidate.get("shape") == "group"
            and candidate["candidateId"] not in used_group_ids
            and max(
                candidate["bbox"][2] / max(1, candidate["bbox"][3]),
                candidate["bbox"][3] / max(1, candidate["bbox"][2]),
            )
            >= 3
        ]
        if legacy_semantics
        else []
    )
    for candidate in objects:
        x, y = candidate["center"]["x"], candidate["center"]["y"]
        for run in fixed_runs:
            rx, ry, rw, rh = run["bbox"]
            if rx <= x <= rx + rw and ry <= y <= ry + rh:
                candidate["contextTags"].append(
                    {
                        "tag": "fixed_run",
                        "sourceGroupId": run["candidateId"],
                    }
                )
                break
        candidate["selectable"] = candidate["requiredForCoverage"] and not any(
            tag.get("tag") == "fixed_run" for tag in candidate["contextTags"]
        )
        width, depth = candidate["bbox"][2], candidate["bbox"][3]
        if target_bbox and legacy_semantics:
            x0, y0, x1, y1 = target_bbox
            if (
                candidate["center"]["x"] <= x0 + (x1 - x0) * 0.25
                and candidate["center"]["y"] <= y0 + (y1 - y0) * 0.35
            ):
                candidate["contextTags"].append({"tag": "fixed_entry"})
                candidate["selectable"] = False
        members = [
            by_id[candidate_id]
            for candidate_id in candidate["contourCandidateIds"]
            if candidate_id in by_id
        ]
        if (
            width >= depth * 3
            and depth >= 10
            and any(
                member["bbox"][2] >= max(24, width * 0.35) and member["bbox"][3] <= 10
                for member in members
            )
        ):
            candidate["categoryHints"].append("tvCabinet")
        if (
            candidate.get("sourceGroupId")
            and 2.3 <= max(width / max(1, depth), depth / max(1, width)) <= 6.0
        ):
            candidate["categoryHints"].append("tvCabinet")
        if "green" in candidate["colorTags"] and max(width, depth) <= min(width, depth) * 1.3:
            candidate["categoryHints"].append("plant")
        repeated = []
        for member in members:
            same = [
                other
                for other in members
                if abs(other["bbox"][2] - member["bbox"][2]) <= max(2, member["bbox"][2] * 0.25)
                and abs(other["bbox"][3] - member["bbox"][3]) <= max(2, member["bbox"][3] * 0.25)
            ]
            if len(same) > len(repeated):
                repeated = same
        if 1.8 <= width / max(1, depth) <= 3.2 and len(repeated) >= 3:
            candidate["categoryHints"].append("sofa")
        if depth >= width * 2.5 and len(repeated) >= 3:
            candidate["categoryHints"].append("bookshelf")
        if (
            not candidate["categoryHints"]
            and candidate["kind"] == "composite"
            and min(width, depth) >= 35
            and max(width, depth) >= 80
            and "green" not in candidate["colorTags"]
        ):
            candidate["categoryHints"].append("sofa")
        if not candidate["categoryHints"] and 30 <= min(width, depth) and max(width, depth) <= 85:
            candidate["categoryHints"].append("coffeeTable")
        if (
            not candidate["categoryHints"]
            and candidate["kind"] == "atomic"
            and 18 <= min(width, depth)
            and max(width, depth) <= 30
            and "green" not in candidate["colorTags"]
        ):
            candidate["categoryHints"].append("sideTable")
        if (
            not candidate["categoryHints"]
            and candidate["kind"] == "composite"
            and max(width, depth) <= 28
            and len(candidate["contourCandidateIds"]) >= 2
        ):
            candidate["categoryHints"].append("floorLamp")
        candidate["categoryHints"] = list(dict.fromkeys(candidate["categoryHints"]))
    for candidate in objects:
        candidate["containsObjectCandidateIds"] = []
        candidate["containedByObjectCandidateIds"] = []
    for candidate in objects:
        area = candidate["bbox"][2] * candidate["bbox"][3]
        for other in objects:
            if other is candidate:
                continue
            ox, oy = other["center"]["x"], other["center"]["y"]
            other_area = other["bbox"][2] * other["bbox"][3]
            if (
                candidate["bbox"][0] <= ox <= candidate["bbox"][0] + candidate["bbox"][2]
                and candidate["bbox"][1] <= oy <= candidate["bbox"][1] + candidate["bbox"][3]
                and other_area < area * 0.8
            ):
                candidate["containsObjectCandidateIds"].append(other["objectCandidateId"])
                other["containedByObjectCandidateIds"].append(candidate["objectCandidateId"])
    if not legacy_semantics:
        for candidate in objects:
            candidate["categoryHints"] = []
            candidate["contextTags"] = [
                tag
                for tag in candidate.get("contextTags") or []
                if tag.get("tag") not in ("fixed_run", "fixed_entry")
            ]
            candidate["selectable"] = bool(candidate["requiredForCoverage"])
    selectable_ids = {
        candidate["objectCandidateId"] for candidate in objects if candidate["selectable"]
    }
    object_by_id = {candidate["objectCandidateId"]: candidate for candidate in objects}
    for candidate in objects:
        selectable_children = [
            object_id
            for object_id in candidate["containsObjectCandidateIds"]
            if object_id in selectable_ids
        ]
        if len(selectable_children) == 1:
            child = object_by_id[selectable_children[0]]
            child_area = child["bbox"][2] * child["bbox"][3]
            area = candidate["bbox"][2] * candidate["bbox"][3]
            if child_area <= area * 0.5:
                candidate["categoryHints"].append("rug")
                child["categoryHints"].append("coffeeTable")
        candidate["categoryHints"] = list(dict.fromkeys(candidate["categoryHints"]))
    if not legacy_semantics:
        for candidate in objects:
            candidate["categoryHints"] = []
    contour_object = {
        contour_id: candidate["objectCandidateId"]
        for candidate in objects
        for contour_id in candidate["contourCandidateIds"]
    }
    groups = []
    for group in radial_groups:
        primary = [
            contour_object[contour_id]
            for contour_id in group["primaryContourIds"]
            if contour_id in contour_object
        ]
        satellites = [
            contour_object[contour_id]
            for contour_id in group["satelliteContourIds"]
            if contour_id in contour_object
        ]
        primary = list(dict.fromkeys(primary))
        satellites = list(dict.fromkeys(satellites))
        if not primary or len(satellites) < 3:
            continue
        groups.append(
            {
                "activityGroupCandidateId": f"agc_{len(groups):03d}",
                "kind": "radial_cluster",
                "primaryObjectCandidateIds": primary,
                "satelliteObjectCandidateIds": satellites,
                "bbox": _union_bbox(
                    [
                        next(
                            candidate
                            for candidate in objects
                            if candidate["objectCandidateId"] == object_id
                        )
                        for object_id in [*primary, *satellites]
                    ]
                ),
            }
        )
    return {
        "objectCandidates": objects,
        "activityGroupCandidates": groups,
    }


def _candidate_overlay(image: Image.Image, candidates: list[dict], crop_box):
    target = image.crop(crop_box).convert("RGB")
    factor = min(3.0, 1800 / max(target.size))
    if factor > 1:
        target = target.resize(
            (round(target.width * factor), round(target.height * factor)),
            Image.Resampling.LANCZOS,
        )
    overlay = target.copy()
    draw = ImageDraw.Draw(overlay, "RGBA")
    font = _font(12)
    placed: list[tuple[int, int, int, int]] = []
    origin_x, origin_y = crop_box[0], crop_box[1]
    shapes = []
    for candidate in candidates:
        x, y, width, height = candidate["bbox"]
        box = (
            round((x - origin_x) * factor),
            round((y - origin_y) * factor),
            round((x + width - origin_x) * factor),
            round((y + height - origin_y) * factor),
        )
        shape = candidate.get("shape", candidate.get("kind", "contour"))
        color = (220, 45, 100, 225) if shape in ("contour", "atomic") else (16, 139, 168, 225)
        draw.rectangle(box, outline=color, width=2)
        shapes.append((candidate, box, color))

    def clamp(box):
        left = max(1, min(overlay.width - (box[2] - box[0]) - 1, box[0]))
        top = max(1, min(overlay.height - (box[3] - box[1]) - 1, box[1]))
        return left, top, left + (box[2] - box[0]), top + (box[3] - box[1])

    for candidate, box, color in shapes:
        text = candidate.get("candidateId", candidate.get("objectCandidateId"))
        text_box = draw.textbbox((0, 0), text, font=font, stroke_width=1)
        label_width = text_box[2] - text_box[0] + 6
        label_height = text_box[3] - text_box[1] + 4
        anchor_x = (box[0] + box[2]) // 2
        anchor_y = (box[1] + box[3]) // 2
        choices = []
        for offset in (4, 15, 27, 40):
            choices.extend(
                [
                    (box[2] + offset, anchor_y - label_height // 2),
                    (box[0] - label_width - offset, anchor_y - label_height // 2),
                    (anchor_x - label_width // 2, box[1] - label_height - offset),
                    (anchor_x - label_width // 2, box[3] + offset),
                    (box[2] + offset, box[1] - label_height - 2),
                    (box[0] - label_width - offset, box[3] + 2),
                ]
            )
        label = None
        for left, top in choices:
            proposal = clamp((left, top, left + label_width, top + label_height))
            if any(_overlap(proposal, other, padding=2) for other in placed):
                continue
            label = proposal
            break
        if label is None:
            label = clamp(
                (
                    box[2] + 3,
                    anchor_y - label_height // 2,
                    box[2] + 3 + label_width,
                    anchor_y + label_height // 2,
                )
            )
        placed.append(label)
        attach_x = min(max(anchor_x, label[0]), label[2])
        attach_y = min(max(anchor_y, label[1]), label[3])
        draw.line((anchor_x, anchor_y, attach_x, attach_y), fill=color, width=1)
        draw.rounded_rectangle(label, radius=2, fill=(255, 255, 255, 225), outline=color, width=1)
        draw.text(
            (label[0] + 3, label[1] + 1),
            text,
            fill=color,
            font=font,
            stroke_width=1,
            stroke_fill=(255, 255, 255, 230),
        )
    return overlay


def _activity_group_overlay(
    image: Image.Image,
    object_candidates: list[dict],
    group_candidates: list[dict],
    crop_box,
):
    overlay = _candidate_overlay(image, object_candidates, crop_box)
    draw = ImageDraw.Draw(overlay, "RGBA")
    font = _font(13)
    origin_x, origin_y = crop_box[0], crop_box[1]
    factor = min(3.0, 1800 / max(crop_box[2] - crop_box[0], crop_box[3] - crop_box[1]))
    for group in group_candidates:
        x, y, width, height = group["bbox"]
        box = [
            round((x - origin_x) * factor),
            round((y - origin_y) * factor),
            round((x + width - origin_x) * factor),
            round((y + height - origin_y) * factor),
        ]
        draw.rectangle(box, outline=(235, 120, 20, 245), width=4)
        text = group["activityGroupCandidateId"]
        text_box = draw.textbbox((0, 0), text, font=font, stroke_width=1)
        label = (
            max(1, box[0]),
            max(1, box[1] - (text_box[3] - text_box[1]) - 8),
        )
        draw.rounded_rectangle(
            [
                label[0],
                label[1],
                label[0] + text_box[2] - text_box[0] + 8,
                label[1] + text_box[3] - text_box[1] + 6,
            ],
            radius=2,
            fill=(255, 248, 235, 240),
            outline=(235, 120, 20, 245),
            width=1,
        )
        draw.text(
            (label[0] + 4, label[1] + 2),
            text,
            fill=(160, 70, 5, 255),
            font=font,
            stroke_width=1,
            stroke_fill=(255, 255, 255, 230),
        )
    return overlay


def contour_candidates(
    image: Image.Image,
    spec: dict,
    policy_version: str = "legacy-room-semantics",
):
    if policy_version not in ("legacy-room-semantics", "geometry-only"):
        raise ValueError("未知家具候选语义策略")
    geometry_only = policy_version == "geometry-only"
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
        max_side = 600 if geometry_only else 300
        if not (6 <= width <= max_side and 5 <= height <= max_side and area >= 12):
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
            max_width, max_height = (600, 500) if geometry_only else (320, 260)
            if not (8 <= width <= max_width and 6 <= height <= max_height and area >= 40):
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
    candidates = _dedupe_candidates(candidates)
    candidate_limit = 300 if geometry_only else 80
    if len(candidates) > candidate_limit:
        raise ValueError(f"家具原始轮廓候选超过 {candidate_limit} 个上限")
    for candidate in candidates:
        x, y, width, height = candidate["bbox"]
        cx, cy = x + width / 2, y + height / 2
        candidate["roomIds"] = [
            room_id
            for room_id, mask in regions.items()
            if _inside_region(mask, cx, cy)
        ]
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
    target_overlay = _candidate_overlay(image, candidates, crop_box)
    target_bbox = [
        int(xs.min()),
        int(ys.min()),
        int(xs.max() + 1),
        int(ys.max() + 1),
    ]
    graph = furniture_object_candidates(
        candidates,
        image,
        target_bbox,
        policy_version=policy_version,
    )
    if len(graph["objectCandidates"]) > 300:
        raise ValueError("家具对象候选超过 300 个上限")
    selectable_objects = [
        candidate for candidate in graph["objectCandidates"] if candidate.get("selectable")
    ]
    object_overlay = _candidate_overlay(image, selectable_objects, crop_box)
    group_overlay = _activity_group_overlay(
        image,
        selectable_objects,
        graph["activityGroupCandidates"],
        crop_box,
    )
    return {
        "contourCandidates": candidates,
        **graph,
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
        "objectOverlay": object_overlay,
        "groupOverlay": group_overlay,
    }
