import json
import math
from pathlib import Path

import pytest
from PIL import Image

from actiscape_agent.floorplan_candidates import contour_candidates
from actiscape_agent.floorplan_candidates_v4 import structure_candidates_v4
from actiscape_agent.floorplan_v3 import _object_symbol_geometry

ROOT = Path(__file__).resolve().parents[3]
IMAGE = (
    ROOT / "data/floorplan-images/"
    "fp-d824f172b4d05e64863ca853033311558412979a0ed6e6cb3bbae44fa246d5c7/"
    "normalized.png"
)
CAPTURE = ROOT / "docs/evidence/s2c-v3-5-second-image-20261108/run1-result.json"
REFERENCE = ROOT / "fixtures/s2c-real/ninety-two.evaluation-only.json"
MANIFEST = ROOT / "fixtures/s2c-real/ninety-two.evaluation-manifest.json"


def find_raw(value):
    if isinstance(value, dict):
        if isinstance(value.get("segments_px"), list) and isinstance(value.get("outline_px"), list):
            return value
        for child in value.values():
            found = find_raw(child)
            if found:
                return found
    elif isinstance(value, list):
        for child in value:
            found = find_raw(child)
            if found:
                return found
    return None


def union(intervals):
    result = []
    for start, end in sorted(intervals):
        if result and start <= result[-1][1] + 0.01:
            result[-1][1] = max(result[-1][1], end)
        else:
            result.append([start, end])
    return result


def wall_lines(items):
    groups = []
    for item in items:
        if "orient" in item:
            orient = item["orient"]
            line = float(item["line"])
            start, end = sorted((float(item["s0"]), float(item["s1"])))
        else:
            orient = "v" if abs(item["a"]["x"] - item["b"]["x"]) <= 1 else "h"
            if orient == "v":
                line = (item["a"]["x"] + item["b"]["x"]) / 2
                start, end = sorted((item["a"]["y"], item["b"]["y"]))
            else:
                line = (item["a"]["y"] + item["b"]["y"]) / 2
                start, end = sorted((item["a"]["x"], item["b"]["x"]))
        same = next(
            (
                group
                for group in groups
                if group["orient"] == orient and abs(group["line"] - line) <= 6
            ),
            None,
        )
        if same:
            same["intervals"].append((start, end))
            same["line"] = sum(same["lines"] + [line]) / (len(same["lines"]) + 1)
            same["lines"].append(line)
        else:
            groups.append(
                {
                    "orient": orient,
                    "line": line,
                    "lines": [line],
                    "intervals": [(start, end)],
                }
            )
    for group in groups:
        group["intervals"] = union(group["intervals"])
        group["length"] = sum(end - start for start, end in group["intervals"])
    return groups


def wall_match(actual, expected):
    actual_lines = wall_lines(actual)
    expected_lines = wall_lines(expected)

    def coverage(source, target):
        matched = 0
        total = 0
        for line in source:
            total += line["length"]
            candidates = [
                other
                for other in target
                if other["orient"] == line["orient"] and abs(other["line"] - line["line"]) <= 6
            ]
            hits = []
            for interval in line["intervals"]:
                for other in candidates:
                    for other_interval in other["intervals"]:
                        start = max(interval[0], other_interval[0])
                        end = min(interval[1], other_interval[1])
                        if end > start:
                            hits.append((start, end))
            matched += sum(end - start for start, end in union(hits))
        return matched / total if total else 1

    return coverage(actual_lines, expected_lines), coverage(expected_lines, actual_lines)


def opening_points(items):
    walls = {wall["candidateWallId"]: wall for wall in items["candidateWalls"]}
    output = []
    for opening in items["openingCandidates"]:
        wall = walls[opening["candidateWallId"]]
        output.append(
            {
                "type": ("window" if opening["typeHint"] == "window" else "door"),
                "x": (opening["center"] if wall["orient"] == "h" else wall["line"]),
                "y": (wall["line"] if wall["orient"] == "h" else opening["center"]),
                "width": opening["width"],
            }
        )
    return output


def reference_opening_points(reference):
    walls = {wall["id"]: wall for wall in reference["walls"]}
    output = []
    for opening in reference["openings"]:
        wall = walls[opening["wallId"]]
        length = math.hypot(
            wall["b"]["x"] - wall["a"]["x"],
            wall["b"]["y"] - wall["a"]["y"],
        )
        output.append(
            {
                "type": "window" if opening["type"] == "window" else "door",
                "x": wall["a"]["x"]
                + (wall["b"]["x"] - wall["a"]["x"]) * opening["offset"] / length,
                "y": wall["a"]["y"]
                + (wall["b"]["y"] - wall["a"]["y"]) * opening["offset"] / length,
                "width": opening["width"],
            }
        )
    return output


def opening_match(actual, expected):
    edges = []
    for left, first in enumerate(actual):
        for right, second in enumerate(expected):
            distance = math.hypot(first["x"] - second["x"], first["y"] - second["y"])
            width_delta = abs(first["width"] - second["width"])
            if first["type"] == second["type"] and distance <= 8 and width_delta <= 8:
                edges.append((distance + width_delta / 10, left, right))
    used_left, used_right = set(), set()
    matches = []
    for _cost, left, right in sorted(edges):
        if left in used_left or right in used_right:
            continue
        used_left.add(left)
        used_right.add(right)
        matches.append((left, right))
    return (
        len(matches) / len(actual),
        len(matches) / len(expected),
        matches,
    )


def candidate_draft(candidate, reference):
    walls = []
    for wall in candidate["candidateWalls"]:
        walls.append(
            {
                "id": wall["candidateWallId"],
                "a": (
                    {"x": wall["s0"], "y": wall["line"]}
                    if wall["orient"] == "h"
                    else {"x": wall["line"], "y": wall["s0"]}
                ),
                "b": (
                    {"x": wall["s1"], "y": wall["line"]}
                    if wall["orient"] == "h"
                    else {"x": wall["line"], "y": wall["s1"]}
                ),
                "thicknessPx": wall["t"],
            }
        )
    by_id = {wall["candidateWallId"]: wall for wall in candidate["candidateWalls"]}
    openings = []
    for opening in candidate["openingCandidates"]:
        wall = by_id[opening["candidateWallId"]]
        openings.append(
            {
                "id": opening["candidateId"],
                "wallId": wall["candidateWallId"],
                "type": opening["typeHint"],
                "offset": opening["center"] - wall["s0"],
                "width": opening["width"],
            }
        )
    return {
        "image": reference["image"],
        "name": "V3-6 candidate replay",
        "anchors": [reference["anchors"][0]],
        "walls": walls,
        "openings": openings,
        "rooms": reference["rooms"],
        "targetRoomIds": reference["targetRoomIds"],
        "symbols": [],
        "uncertainties": [],
    }


@pytest.mark.skipif(
    not IMAGE.exists() or not CAPTURE.exists(),
    reason="frozen 92 image or captured source analysis is unavailable",
)
def test_v36_source_mask_candidates_compile_geometrically_and_score_walls_openings():
    reference = json.loads(REFERENCE.read_text())
    candidate = structure_candidates_v4(
        Image.open(IMAGE).convert("RGB"),
        find_raw(json.loads(CAPTURE.read_text())),
    )
    mask = candidate.pop("_mask")
    assert mask.size == (736, 673)
    assert candidate["structureSkeletonVersion"] == 4
    assert "fallback" not in candidate["candidateSummary"]
    assert len(candidate["candidateWalls"]) == 18
    assert len(candidate["openingCandidates"]) == 12
    assert len(candidate["dimensionCandidates"]) == 1
    west = next(
        wall
        for wall in candidate["candidateWalls"]
        if wall["orient"] == "v" and abs(wall["line"] - 91.5) <= 2
    )
    east = next(
        wall
        for wall in candidate["candidateWalls"]
        if wall["orient"] == "v" and abs(wall["line"] - 625) <= 2
    )
    assert west["sourceIndices"]
    assert east["sourceIndices"]
    assert not any(
        wall["role"] in ("top", "bottom", "left", "right") and wall["s0"] < 50 and wall["s1"] > 650
        for wall in candidate["candidateWalls"]
    )
    precision, recall = wall_match(candidate["candidateWalls"], reference["walls"])
    assert precision >= 0.9
    assert recall >= 0.9
    opening_precision, opening_recall, _matches = opening_match(
        opening_points(candidate),
        reference_opening_points(reference),
    )
    assert opening_precision >= 0.9
    assert opening_recall >= 0.9
    dimension = candidate["dimensionCandidates"][0]
    assert dimension["unitHint"] == "mm"
    assert dimension["at"] < min(wall["line"] for wall in candidate["candidateWalls"])
    assert dimension["b"]["x"] - dimension["a"]["x"] == pytest.approx(546, abs=2)
    json.dumps(candidate)
    graph = contour_candidates(
        Image.open(IMAGE).convert("RGB"),
        candidate_draft(candidate, reference),
    )
    selectable = [
        object_candidate
        for object_candidate in graph["objectCandidates"]
        if object_candidate["selectable"]
    ]
    assert len(selectable) == 11
    assert all(len(object_candidate["categoryHints"]) == 1 for object_candidate in selectable)
    assert len(graph["activityGroupCandidates"]) == 1
    group = graph["activityGroupCandidates"][0]
    assert len(group["satelliteObjectCandidateIds"]) == 4
    table = next(
        object_candidate
        for object_candidate in selectable
        if "diningTable" in object_candidate["categoryHints"]
    )
    assert table["bbox"][2] >= 70 and table["bbox"][3] >= 40
    assert any("tvCabinet" in object_candidate["categoryHints"] for object_candidate in selectable)
    assert any(
        "coffeeTable" in object_candidate["categoryHints"] for object_candidate in selectable
    )
    assert any("sideTable" in object_candidate["categoryHints"] for object_candidate in selectable)
    assert (
        sum("floorLamp" in object_candidate["categoryHints"] for object_candidate in selectable)
        == 2
    )
    assert not any(
        any(tag.get("tag") == "fixed_entry" for tag in object_candidate["contextTags"])
        for object_candidate in selectable
    )
    edges = []
    for reference_index, symbol in enumerate(reference["symbols"]):
        for object_index, object_candidate in enumerate(selectable):
            distance = math.hypot(
                object_candidate["center"]["x"] - symbol["x"],
                object_candidate["center"]["y"] - symbol["y"],
            )
            edges.append((distance, reference_index, object_index))
    used_reference, used_objects = set(), set()
    matches = []
    for distance, reference_index, object_index in sorted(edges):
        if reference_index in used_reference or object_index in used_objects:
            continue
        used_reference.add(reference_index)
        used_objects.add(object_index)
        matches.append((reference_index, object_index, distance))
    assert len(matches) == len(reference["symbols"])
    for reference_index, object_index, distance in matches:
        symbol = reference["symbols"][reference_index]
        object_candidate = selectable[object_index]
        geometry = _object_symbol_geometry(
            object_candidate,
            symbol["categoryCode"],
            symbol["rot"],
        )
        rotation_error = abs(((geometry["rot"] - symbol["rot"] + 540) % 360) - 180)
        assert distance <= 150 / 17.7656
        assert rotation_error <= 10
        assert abs(geometry["w"] - symbol["w"]) <= max(100 / 17.7656, symbol["w"] * 0.15)
        assert abs(geometry["d"] - symbol["d"]) <= max(100 / 17.7656, symbol["d"] * 0.15)


def test_v36_reference_hash_is_frozen():
    import hashlib

    manifest = json.loads(MANIFEST.read_text())
    assert hashlib.sha256(REFERENCE.read_bytes()).hexdigest() == manifest["referenceSha256"]
