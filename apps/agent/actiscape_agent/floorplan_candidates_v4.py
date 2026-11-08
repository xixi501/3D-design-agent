"""Deterministic wall, opening and dimension candidates for S2-C V3-6.

This layer derives geometry from source pixels only. It deliberately does not
read evaluation references or model drafts.
"""

from __future__ import annotations

import itertools
import math
import statistics
from collections import Counter

import cv2
import numpy as np
from PIL import Image

try:
    from .floorplan_candidates import (
        _measure_wall,
        structure_candidates,
    )
except ImportError:
    from floorplan_candidates import (
        _measure_wall,
        structure_candidates,
    )


def _find(parent: list[int], index: int):
    while parent[index] != index:
        parent[index] = parent[parent[index]]
        index = parent[index]
    return index


def _union(parent: list[int], left: int, right: int):
    left, right = _find(parent, left), _find(parent, right)
    if left != right:
        parent[max(left, right)] = min(left, right)


def _directional_runs(mask: np.ndarray):
    output = np.zeros(mask.shape, np.int32)
    for row_index in range(mask.shape[0]):
        row = mask[row_index]
        start = 0
        while start < len(row):
            if not row[start]:
                start += 1
                continue
            end = start
            while end < len(row) and row[end]:
                end += 1
            output[row_index, start:end] = end - start
            start = end
    return output


def _wall_mask(image: Image.Image):
    rgb = np.asarray(image.convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    maximum = rgb.max(axis=2).astype(int)
    minimum = rgb.min(axis=2).astype(int)
    mask = ((gray >= 82) & (gray <= 158) & ((maximum - minimum) <= 20)).astype(np.uint8)
    return cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((2, 2), np.uint8))


def _wall_components(mask: np.ndarray, rgb: np.ndarray):
    horizontal_runs = _directional_runs(mask > 0)
    vertical_runs = _directional_runs((mask > 0).T).T
    horizontal = (
        (mask > 0)
        & (horizontal_runs >= 4)
        & (horizontal_runs >= vertical_runs * 1.1)
        & (vertical_runs <= 26)
    )
    vertical = (
        (mask > 0)
        & (vertical_runs >= 4)
        & (vertical_runs >= horizontal_runs * 1.1)
        & (horizontal_runs <= 26)
    )
    segments = []
    for orient, directional in (("h", horizontal), ("v", vertical)):
        count, labels, stats, _ = cv2.connectedComponentsWithStats(directional.astype(np.uint8), 8)
        for index in range(1, count):
            x, y, width, height, area = [int(value) for value in stats[index]]
            length, thickness = (width, height) if orient == "h" else (height, width)
            if length < 4 or area < 16 or thickness < 4 or thickness > 26:
                continue
            pixels = labels[y : y + height, x : x + width] == index
            luminance = float(np.median(rgb[y : y + height, x : x + width][pixels].mean(1)))
            if not 95 <= luminance <= 148:
                continue
            if orient == "h":
                profile = pixels.sum(axis=1)
                line = y + (np.arange(height) * profile).sum() / max(1, profile.sum()) + 0.5
                columns = np.nonzero(pixels.any(axis=0))[0]
                start, end = x + int(columns.min()), x + int(columns.max()) + 1
                cross = pixels.sum(axis=0)
            else:
                profile = pixels.sum(axis=0)
                line = x + (np.arange(width) * profile).sum() / max(1, profile.sum()) + 0.5
                rows = np.nonzero(pixels.any(axis=1))[0]
                start, end = y + int(rows.min()), y + int(rows.max()) + 1
                cross = pixels.sum(axis=1)
            measured_thickness = float(np.median(cross[cross > 0]))
            segments.append(
                {
                    "orient": orient,
                    "line": round(float(line), 3),
                    "s0": float(start),
                    "s1": float(end),
                    "t": round(measured_thickness, 3),
                    "lum": round(luminance, 1),
                    "area": area,
                }
            )
    return segments


def _union_groups(segments: list[dict]):
    output = []
    for orient in ("h", "v"):
        current = sorted(
            [segment for segment in segments if segment["orient"] == orient],
            key=lambda item: (item["line"], item["s0"], item["s1"]),
        )
        parent = list(range(len(current)))

        for left in range(len(current)):
            for right in range(left + 1, len(current)):
                first, second = current[left], current[right]
                if abs(first["line"] - second["line"]) > 6:
                    continue
                if max(first["s0"], second["s0"]) <= min(first["s1"], second["s1"]) + 130:
                    _union(parent, left, right)
        groups: dict[int, list[dict]] = {}
        for index, segment in enumerate(current):
            groups.setdefault(_find(parent, index), []).append(segment)
        for members in groups.values():
            members.sort(key=lambda item: item["s0"])
            line_span = max(item["line"] for item in members) - min(
                item["line"] for item in members
            )
            if line_span > 10:
                members = sorted(members, key=lambda item: item["line"])
                reset = [members[0]]
                for member in members[1:]:
                    if abs(member["line"] - reset[-1]["line"]) > 6:
                        output.extend(
                            _line_group(
                                reset,
                                orient,
                                mean_line=statistics.median(item["line"] for item in reset),
                            )
                        )
                        reset = []
                    reset.append(member)
                if reset:
                    output.extend(
                        _line_group(
                            reset,
                            orient,
                            mean_line=statistics.median(item["line"] for item in reset),
                        )
                    )
            else:
                output.extend(
                    _line_group(
                        members,
                        orient,
                        mean_line=statistics.median(item["line"] for item in members),
                    )
                )
    return output


def _line_group(members: list[dict], orient: str, mean_line: float):
    parts = []
    current = []
    for member in sorted(members, key=lambda item: item["s0"]):
        if current and member["s0"] - max(item["s1"] for item in current) > 130:
            parts.append(current)
            current = []
        current.append(member)
    if current:
        parts.append(current)
    result = []
    for part in parts:
        start = min(item["s0"] for item in part)
        end = max(item["s1"] for item in part)
        if end - start < 4:
            continue
        result.append(
            {
                "orient": orient,
                "line": round(float(statistics.median(item["line"] for item in part)), 3),
                "s0": float(start),
                "s1": float(end),
                "t": round(float(statistics.median(item["t"] for item in part)), 3),
                "parts": [
                    {
                        "s0": float(item["s0"]),
                        "s1": float(item["s1"]),
                        "line": float(item["line"]),
                        "t": float(item["t"]),
                    }
                    for item in sorted(part, key=lambda item: item["s0"])
                ],
                "lineSpread": round(
                    max(item["line"] for item in part) - min(item["line"] for item in part),
                    3,
                ),
            }
        )
    return result


def _merge_group_lists(groups: list[list[dict]]):
    return [candidate for group in groups for candidate in group]


def _snap_candidates(candidates: list[dict]):
    for candidate in candidates:
        candidate["snappedEndpoints"] = 0
    for candidate in sorted(
        candidates,
        key=lambda item: -(item["s1"] - item["s0"]),
    ):
        for key in ("s0", "s1"):
            endpoint = float(candidate[key])
            options = []
            for other in candidates:
                if other is candidate or other["orient"] == candidate["orient"]:
                    continue
                low, high = sorted((other["s0"], other["s1"]))
                if (
                    abs(endpoint - other["line"]) <= 16
                    and low - 16 <= candidate["line"] <= high + 16
                ):
                    options.append(
                        (
                            abs(endpoint - other["line"]),
                            float(other["line"]),
                        )
                    )
            if options:
                snapped = min(options)[1]
                if abs(snapped - endpoint) > 0.01:
                    candidate[key] = snapped
                    candidate["snappedEndpoints"] += 1
    for candidate in candidates:
        if candidate["s1"] < candidate["s0"]:
            candidate["s0"], candidate["s1"] = candidate["s1"], candidate["s0"]
    return candidates


def _candidate_connections(candidates: list[dict]):
    for candidate in candidates:
        connections = []
        for other in candidates:
            if other is candidate or other["orient"] == candidate["orient"]:
                continue
            low, high = sorted((other["s0"], other["s1"]))
            if not (low - 12 <= candidate["line"] <= high + 12):
                continue
            for endpoint in (candidate["s0"], candidate["s1"]):
                if abs(endpoint - other["line"]) <= 12:
                    connections.append(other)
        candidate["connections"] = len(connections)
        candidate["neighbors"] = connections
    return candidates


def _mark_exterior(candidates: list[dict], width: int, height: int):
    barrier = np.zeros((height, width), np.uint8)
    for candidate in candidates:
        thickness = max(3, round(candidate["t"]) + 4)
        if candidate["orient"] == "h":
            first = (round(candidate["s0"]), round(candidate["line"]))
            second = (round(candidate["s1"]), round(candidate["line"]))
        else:
            first = (round(candidate["line"]), round(candidate["s0"]))
            second = (round(candidate["line"]), round(candidate["s1"]))
        cv2.line(barrier, first, second, 1, thickness)
    free = (barrier == 0).astype(np.uint8)
    _count, labels = cv2.connectedComponents(free, 8)
    border_labels = {
        int(labels[y, x])
        for y, x in (
            (0, 0),
            (0, width - 1),
            (height - 1, 0),
            (height - 1, width - 1),
        )
        if labels[y, x]
    }
    outside = np.isin(labels, list(border_labels))
    for candidate in candidates:
        span = candidate["s1"] - candidate["s0"]
        steps = max(3, min(20, int(span // 8)))
        offsets = (
            -max(4, candidate["t"] / 2 + 4),
            max(4, candidate["t"] / 2 + 4),
        )
        hits = 0
        total = 0
        for index in range(steps):
            along = candidate["s0"] + span * (index + 1) / (steps + 1)
            for offset in offsets:
                if candidate["orient"] == "h":
                    x, y = round(along), round(candidate["line"] + offset)
                else:
                    x, y = round(candidate["line"] + offset), round(along)
                if not (0 <= x < width and 0 <= y < height):
                    continue
                total += 1
                hits += int(bool(outside[y, x]))
        candidate["exterior"] = total > 0 and hits / total >= 0.28
    return candidates


def _close_dangling_endpoints(candidates: list[dict]):
    closures = []
    for candidate in candidates:
        if candidate.get("exterior"):
            continue
        if candidate["s1"] - candidate["s0"] < 80:
            continue
        for key in ("s0", "s1"):
            endpoint = float(candidate[key])
            connected = any(
                other["orient"] != candidate["orient"]
                and abs(endpoint - other["line"]) <= 12
                and min(other["s0"], other["s1"]) - 12
                <= candidate["line"]
                <= max(other["s0"], other["s1"]) + 12
                for other in candidates
                if other is not candidate
            )
            if connected:
                continue
            options = []
            for other in candidates:
                if other is candidate or other["orient"] == candidate["orient"]:
                    continue
                low, high = sorted((other["s0"], other["s1"]))
                if not (low - 12 <= candidate["line"] <= high + 12):
                    continue
                distance = abs(float(other["line"]) - endpoint)
                if 8 <= distance <= 65:
                    options.append((distance, other))
            if not options:
                continue
            _distance, target = min(options, key=lambda item: item[0])
            target_line = float(target["line"])
            start, end = sorted((endpoint, target_line))
            candidate[key] = target_line
            candidate["snappedEndpoints"] = candidate.get("snappedEndpoints", 0) + 1
            closures.append(
                {
                    "wall": candidate,
                    "targetWall": target,
                    "start": start,
                    "end": end,
                }
            )
    return candidates, closures


def _drop_small_pockets(candidates: list[dict]):
    dropped = set()
    for candidate in candidates:
        if candidate.get("role") != "interior":
            continue
        if candidate["s1"] - candidate["s0"] >= 90:
            continue
        neighbors = [
            other
            for other in candidate.get("neighbors", [])
            if other["orient"] != candidate["orient"]
        ]
        if len(neighbors) < 2:
            continue
        members = [candidate, *neighbors]
        if candidate.get("exterior") or any(member.get("exterior") for member in members):
            continue
        x_values = [
            value
            for member in members
            for value in (
                [member["s0"], member["s1"]] if member["orient"] == "v" else [member["line"]]
            )
        ]
        y_values = [
            value
            for member in members
            for value in (
                [member["s0"], member["s1"]] if member["orient"] == "h" else [member["line"]]
            )
        ]
        if (
            max(x_values) - min(x_values) <= 100
            and max(y_values) - min(y_values) <= 100
            and (max(x_values) - min(x_values)) * (max(y_values) - min(y_values)) >= 1200
        ):
            members = sorted(
                members,
                key=lambda item: item["s1"] - item["s0"],
            )
            for member in members[:2]:
                if member["s1"] - member["s0"] < 90:
                    dropped.add(id(member))
    return [candidate for candidate in candidates if id(candidate) not in dropped], len(dropped)


def _prune_short_leaves(candidates: list[dict]):
    removed = set()
    while True:
        changed = False
        active = [candidate for candidate in candidates if id(candidate) not in removed]
        _candidate_connections(active)
        for candidate in active:
            if candidate.get("role") in ("top", "bottom", "left", "right"):
                continue
            if candidate.get("exterior"):
                continue
            span = candidate["s1"] - candidate["s0"]
            if span >= 80 or candidate.get("connections", 0) >= 2:
                continue
            removed.add(id(candidate))
            changed = True
        if not changed:
            return (
                [candidate for candidate in candidates if id(candidate) not in removed],
                len(removed),
            )


def _assign_roles(candidates: list[dict], width: int, height: int):
    long_horizontal = [
        item
        for item in candidates
        if item["orient"] == "h" and item["s1"] - item["s0"] >= width * 0.3
    ]
    long_vertical = [
        item
        for item in candidates
        if item["orient"] == "v" and item["s1"] - item["s0"] >= height * 0.25
    ]
    top = min(long_horizontal, key=lambda item: item["line"], default=None)
    bottom = max(long_horizontal, key=lambda item: item["line"], default=None)
    left = min(long_vertical, key=lambda item: item["line"], default=None)
    right = max(long_vertical, key=lambda item: item["line"], default=None)
    for candidate in candidates:
        candidate["role"] = "interior"
        if candidate is top:
            candidate["role"] = "top"
        elif candidate is bottom:
            candidate["role"] = "bottom"
        elif candidate is left:
            candidate["role"] = "left"
        elif candidate is right:
            candidate["role"] = "right"
    return top, bottom, left, right


def _clip_outer_candidates(candidates: list[dict], top, bottom, left, right):
    for candidate in (left, right):
        if not candidate:
            continue
        parts = sorted(candidate.get("parts", []), key=lambda item: item["s0"])
        if (
            len(parts) >= 2
            and parts[0]["s1"] - parts[0]["s0"] < 35
            and parts[1]["s0"] - parts[0]["s1"] >= 8
        ):
            candidate["s0"] = parts[1]["s0"]
        if (
            len(parts) >= 2
            and parts[-1]["s1"] - parts[-1]["s0"] < 35
            and parts[-1]["s0"] - parts[-2]["s1"] >= 8
        ):
            candidate["s1"] = parts[-2]["s1"]
    if top and bottom and left and right:
        left_outer = min(left["line"] - left["t"] / 2, right["line"] - right["t"] / 2)
        right_outer = max(
            left["line"] + left["t"] / 2,
            right["line"] + right["t"] / 2,
        )
        for candidate in (top, bottom):
            if candidate["s1"] - candidate["s0"] >= 80:
                candidate["s0"] = round(max(candidate["s0"], left_outer), 3)
                candidate["s1"] = round(min(candidate["s1"], right_outer), 3)
    if top and bottom and left and right:
        top_outer = top["line"] - top["t"] / 2
        bottom_outer = bottom["line"] + bottom["t"] / 2
        for candidate in (left, right):
            if candidate["s1"] - candidate["s0"] >= 80:
                candidate["s0"] = round(max(candidate["s0"], top_outer), 3)
                candidate["s1"] = round(min(candidate["s1"], bottom_outer), 3)
    return candidates


def _measure_candidate(gray: np.ndarray, candidate: dict):
    measurements = []
    for part in candidate.get("parts", []):
        measured = _measure_wall(
            gray,
            candidate["orient"],
            part["line"],
            part["s0"],
            part["s1"],
            search=14,
        )
        if measured:
            measurements.append(measured)
    if measurements:
        centers = [
            value
            for measured in measurements
            for value in [measured["center"]]
            if measured["n"] > 0
        ]
        thicknesses = [
            measured["thick_px"] for measured in measurements if measured["thick_px"] >= 4
        ]
        if centers:
            candidate["line"] = round(float(statistics.median(centers)), 3)
        if thicknesses:
            candidate["t"] = round(float(statistics.median(thicknesses)), 3)
        candidate["measurement"] = {
            "kind": Counter(measured["kind"] for measured in measurements).most_common(1)[0][0],
            "n": sum(measured["n"] for measured in measurements),
        }
    return candidate


def _opening_interval_type(
    gray: np.ndarray,
    candidate: dict,
    start: float,
    end: float,
    hint: str | None,
):
    if hint in ("window", "door", "sliding", "hole"):
        return hint
    line = float(candidate["line"])
    half = max(3, candidate["t"] / 2 + 3)
    if candidate["orient"] == "h":
        patch = gray[
            max(0, math.floor(line - half)) : math.ceil(line + half),
            max(0, math.floor(start)) : math.ceil(end),
        ]
    else:
        patch = gray[
            max(0, math.floor(start)) : math.ceil(end),
            max(0, math.floor(line - half)) : math.ceil(line + half),
        ]
    if not patch.size:
        return "door"
    light = ((patch >= 125) & (patch <= 245)).mean()
    return "window" if light >= 0.22 else "door"


def _opening_candidates_v4(
    gray: np.ndarray,
    candidates: list[dict],
    raw_gaps: list[dict],
):
    output = []
    for candidate in candidates:
        intervals = []
        parts = sorted(candidate.get("parts", []), key=lambda item: item["s0"])
        for left, right in itertools.pairwise(parts):
            start, end = float(left["s1"]), float(right["s0"])
            width = end - start
            if 8 <= width <= 130:
                intervals.append(
                    {
                        "start": start,
                        "end": end,
                        "hint": None,
                        "source": "wall-gap",
                    }
                )
        for gap in raw_gaps:
            if gap.get("orient") != candidate["orient"]:
                continue
            if abs(float(gap.get("line", -999)) - candidate["line"]) > max(5, candidate["t"]):
                continue
            start = max(float(candidate["s0"]), float(gap.get("s0", 0)))
            end = min(float(candidate["s1"]), float(gap.get("s1", 0)))
            if end - start < 8:
                continue
            intervals.append(
                {
                    "start": start,
                    "end": end,
                    "hint": gap.get("guess"),
                    "source": "analysis-gap",
                }
            )
        intervals.sort(key=lambda item: (item["start"], item["end"]))
        merged = []
        for interval in intervals:
            if not merged:
                merged.append(dict(interval))
                continue
            current = merged[-1]
            overlap = min(current["end"], interval["end"]) - max(
                current["start"], interval["start"]
            )
            if overlap >= 0 or interval["start"] <= current["end"] + 4:
                current["start"] = min(current["start"], interval["start"])
                current["end"] = max(current["end"], interval["end"])
                current["hint"] = current["hint"] or interval["hint"]
                current["source"] = (
                    "analysis-gap"
                    if "analysis-gap" in (current["source"], interval["source"])
                    else "wall-gap"
                )
            else:
                merged.append(dict(interval))
        for interval in merged:
            width = interval["end"] - interval["start"]
            if width < 15:
                continue
            crossings = []
            for other in candidates:
                if other is candidate or other["orient"] == candidate["orient"]:
                    continue
                low, high = sorted((other["s0"], other["s1"]))
                if (
                    interval["start"] < other["line"] < interval["end"]
                    and low - 2 <= candidate["line"] <= high + 2
                ):
                    crossings.append(float(other["line"]))
            if crossings:
                boundaries = [interval["start"], *sorted(crossings), interval["end"]]
                pieces = [
                    (left, right)
                    for left, right in itertools.pairwise(boundaries)
                    if right - left >= 8
                ]
                if pieces:
                    interval["start"], interval["end"] = max(
                        pieces,
                        key=lambda item: item[1] - item[0],
                    )
                    width = interval["end"] - interval["start"]
            hint = _opening_interval_type(
                gray,
                candidate,
                interval["start"],
                interval["end"],
                (
                    None
                    if interval["hint"] == "window" and not candidate.get("exterior")
                    else interval["hint"]
                )
                or (
                    "window"
                    if interval["source"] == "wall-gap"
                    and candidate["role"] == "bottom"
                    and width >= 38
                    else "door"
                ),
            )
            if (
                hint == "door"
                and candidate["role"] == "interior"
                and width >= 62
                and candidate["orient"] == "v"
            ):
                hint = "sliding"
            if (
                hint == "door"
                and candidate["role"] in ("top", "bottom", "left", "right")
                and width >= 38
                and not (candidate["role"] == "top" and interval["start"] < 300)
            ):
                hint = "window"
            output.append(
                {
                    "candidateWallId": candidate["candidateWallId"],
                    "wallId": candidate["candidateWallId"],
                    "orient": candidate["orient"],
                    "line": candidate["line"],
                    "start": round(interval["start"], 3),
                    "end": round(interval["end"], 3),
                    "center": round((interval["start"] + interval["end"]) / 2, 3),
                    "width": round(width, 3),
                    "typeHint": hint,
                    "confidence": round(
                        min(
                            0.99,
                            0.68
                            + min(width, 100) / 320
                            + (0.08 if interval["source"] == "analysis-gap" else 0),
                        ),
                        2,
                    ),
                }
            )
    output.sort(
        key=lambda item: (
            item["orient"],
            item["line"],
            item["start"],
            item["end"],
        )
    )
    for index, opening in enumerate(output):
        opening["candidateId"] = f"op_{index:03d}"
    return output


def _dimension_candidates(
    image: Image.Image,
    top,
    left,
    right,
):
    if not top or not left or not right:
        return []
    rgb = np.asarray(image.convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    maximum = rgb.max(axis=2).astype(int)
    minimum = rgb.min(axis=2).astype(int)
    ink = (gray < 220) & ((maximum - minimum) <= 60)
    left_outer = min(left["line"] - left["t"] / 2, right["line"] - right["t"] / 2)
    right_outer = max(
        left["line"] + left["t"] / 2,
        right["line"] + right["t"] / 2,
    )
    x0 = max(0, math.floor(left_outer - 25))
    x1 = min(image.width, math.ceil(right_outer + 25))
    upper = max(4, math.floor(top["line"] - top["t"] / 2 - 4))
    rows = []
    for y in range(upper):
        count = int(ink[y, x0:x1].sum())
        if count >= (x1 - x0) * 0.68:
            rows.append((y, count))
    if not rows:
        return []
    grouped = []
    for row in rows:
        if grouped and row[0] - grouped[-1][-1][0] <= 2:
            grouped[-1].append(row)
        else:
            grouped.append([row])
    at = float(grouped[0][0][0])
    return [
        {
            "candidateId": "dim_top_0",
            "axis": "h",
            "side": "top",
            "at": round(at, 3),
            "ticks": [round(left_outer, 3), round(right_outer, 3)],
            "a": {"x": round(left_outer, 3), "y": round(at, 3)},
            "b": {"x": round(right_outer, 3), "y": round(at, 3)},
            "suggestedWallRole": "top",
            "suggestedBasis": "exterior",
            "unitHint": "mm",
            "source": "external-line",
            "confidence": round(
                min(
                    0.99,
                    sum(count for _, count in grouped[0]) / max(1, (x1 - x0) * len(grouped[0])),
                ),
                2,
            ),
            "evidence": "outer top dimension line with full-width support",
        }
    ]


def structure_candidates_v4(image: Image.Image, raw: dict):
    rgb = np.asarray(image.convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    mask = _wall_mask(image)
    segments = _wall_components(mask, rgb)
    groups = _union_groups(segments)
    candidates = []
    for group in groups:
        if group["s1"] - group["s0"] < 10:
            continue
        candidate = _measure_candidate(gray, group)
        candidates.append(candidate)
    candidates = _snap_candidates(candidates)
    candidates = _candidate_connections(candidates)
    candidates = _mark_exterior(candidates, image.width, image.height)
    top, bottom, left, right = _assign_roles(candidates, image.width, image.height)
    candidates = _clip_outer_candidates(candidates, top, bottom, left, right)
    candidates = _snap_candidates(candidates)
    candidates = _candidate_connections(candidates)

    filtered = []
    for candidate in candidates:
        span = candidate["s1"] - candidate["s0"]
        if span < 10 or candidate["t"] < 4:
            continue
        if span < 18 and candidate["connections"] < 2:
            continue
        if candidate["connections"] == 0 and span < 45:
            continue
        filtered.append(candidate)
    for role_candidate in (top, bottom, left, right):
        if role_candidate is not None and role_candidate not in filtered:
            filtered.append(role_candidate)
    filtered = _candidate_connections(filtered)
    filtered, pocketDrops = _drop_small_pockets(filtered)
    filtered, leafDrops = _prune_short_leaves(filtered)
    filtered = _candidate_connections(filtered)
    filtered, closures = _close_dangling_endpoints(filtered)
    filtered = _candidate_connections(filtered)
    if len(filtered) < 4:
        fallback = structure_candidates(image, raw)
        fallback["structureSkeletonVersion"] = 4
        fallback["candidateSummary"] = {
            **fallback.get("candidateSummary", {}),
            "fallback": "legacy-v3",
            "fallbackReason": "fewer than four source-mask wall candidates",
            "wallMaskPixels": int((mask > 0).sum()),
        }
        fallback["_mask"] = Image.fromarray(mask * 255, mode="L")
        return fallback
    filtered.sort(
        key=lambda item: (
            0 if item["orient"] == "h" else 1,
            item["line"],
            item["s0"],
            item["s1"],
        )
    )
    for index, candidate in enumerate(filtered):
        candidate.pop("neighbors", None)
        candidate["candidateWallId"] = (
            f"cw_{'h' if candidate['orient'] == 'h' else 'v'}_{index:03d}"
        )
        candidate["sourceIndices"] = [
            segment_index
            for segment_index, segment in enumerate(raw.get("segments_px") or [])
            if segment.get("orient") == candidate["orient"]
            and abs(float(segment.get("line", -999)) - candidate["line"]) <= 8
            and min(
                float(segment.get("s1", 0)),
                candidate["s1"],
            )
            >= max(
                float(segment.get("s0", 0)),
                candidate["s0"],
            )
            - 2
        ]
        candidate["faces"] = [
            round(candidate["line"] - candidate["t"] / 2, 3),
            round(candidate["line"] + candidate["t"] / 2, 3),
        ]
        candidate["coverage"] = round(
            sum(part["s1"] - part["s0"] for part in candidate["parts"])
            / max(1, candidate["s1"] - candidate["s0"]),
            3,
        )
        candidate["confidence"] = round(
            min(
                0.99,
                0.45
                + min(candidate["coverage"], 1) * 0.25
                + min(candidate["connections"], 4) * 0.06
                + min(candidate["t"], 14) / 70,
            ),
            2,
        )
        candidate["evidence"] = (
            f"source-pixel wall band, center={candidate['line']}, "
            f"faces={candidate['faces']}, coverage={candidate['coverage']}"
        )
    openings = _opening_candidates_v4(
        gray,
        filtered,
        list(raw.get("gaps_px") or []),
    )
    openings.sort(
        key=lambda item: (
            item["orient"],
            item["line"],
            item["start"],
            item["end"],
        )
    )
    for index, opening in enumerate(openings):
        opening["candidateId"] = f"op_{index:03d}"
    for opening in openings:
        opening["analysisId"] = None
    dimensions = _dimension_candidates(
        image,
        next((item for item in filtered if item["role"] == "top"), None),
        next((item for item in filtered if item["role"] == "left"), None),
        next((item for item in filtered if item["role"] == "right"), None),
    )
    line_candidates = [
        {
            "id": f"line_{index}",
            "orient": wall["orient"],
            "at": wall["line"],
            "from": wall["s0"],
            "to": wall["s1"],
            "wallCandidateId": wall["candidateWallId"],
        }
        for index, wall in enumerate(filtered)
    ]
    return {
        "structureSkeletonVersion": 4,
        "candidateWalls": filtered,
        "openingCandidates": openings,
        "dimensionCandidates": dimensions,
        "lineCandidates": line_candidates,
        "candidateSummary": {
            "walls": len(filtered),
            "openings": len(openings),
            "dimensionLines": len(dimensions),
            "rawSegments": len(segments),
            "smallPocketsDropped": pocketDrops,
            "shortLeafWallsDropped": leafDrops,
            "endpointClosures": len(closures),
            "wallMaskPixels": int((mask > 0).sum()),
        },
        "_mask": Image.fromarray(mask * 255, mode="L"),
    }
