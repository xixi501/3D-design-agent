"""Offline furniture-grounding model comparison against one frozen reference."""

from __future__ import annotations

import argparse
import asyncio
import io
import json
import math
from pathlib import Path

from actiscape_agent.floorplan_candidates import contour_candidates
from actiscape_agent.floorplan_schemas import (
    CategoryCode,
    FurnitureActivityRecognition,
    FurnitureContourRecognition,
)
from actiscape_agent.floorplan_v3 import (
    VISION_ACTIVITY,
    VISION_FURNITURE,
    _assemble_activity_symbols,
    _assemble_contour_symbols,
    _parse_structured_content,
)
from actiscape_agent.store import TaskError
from actiscape_agent.vision_client import VisionModelClient
from PIL import Image
from pydantic import ValidationError


def response_box(symbol):
    angle = math.radians(float(symbol["rot"]))
    half_w = (
        abs(math.cos(angle)) * float(symbol["w"])
        + abs(math.sin(angle)) * float(symbol["d"])
    ) / 2
    half_d = (
        abs(math.sin(angle)) * float(symbol["w"])
        + abs(math.cos(angle)) * float(symbol["d"])
    ) / 2
    x, y = float(symbol["x"]), float(symbol["y"])
    return [x - half_w, y - half_d, x + half_w, y + half_d]


def center(box):
    return ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)


def distance(a, b):
    first, second = center(a), center(b)
    return math.hypot(first[0] - second[0], first[1] - second[1])


def score(actual, reference, scale_mm):
    edges = sorted(
        (
            {
                "actual": ai,
                "reference": ri,
                "distance": distance(response_box(a), response_box(r)),
            }
            for ai, a in enumerate(actual)
            for ri, r in enumerate(reference)
            if a["categoryCode"] == r["category"]
        ),
        key=lambda item: item["distance"],
    )
    used_actual, used_reference, matches = set(), set(), []
    for edge in edges:
        if edge["actual"] in used_actual or edge["reference"] in used_reference:
            continue
        used_actual.add(edge["actual"])
        used_reference.add(edge["reference"])
        matches.append(edge)
    layout = []
    for match in matches:
        a, r = actual[match["actual"]], reference[match["reference"]]
        angle = abs(((a["rot"] - r["rot"] + 540) % 360) - 180)
        width_error = abs(a["w"] - r["w"]) * scale_mm
        depth_error = abs(a["d"] - r["d"]) * scale_mm
        layout.append(
            {
                **match,
                "actualId": a["id"],
                "referenceId": r["id"],
                "centerErrorMm": match["distance"] * scale_mm,
                "rotationError": angle,
                "widthErrorMm": width_error,
                "depthErrorMm": depth_error,
                "passed": (
                    match["distance"] * scale_mm <= 150
                    and angle <= 10
                    and width_error <= max(100, r["w"] * scale_mm * 0.15)
                    and depth_error <= max(100, r["d"] * scale_mm * 0.15)
                ),
            }
        )
    precision = len(matches) / len(actual) if actual else 0
    recall = len(matches) / len(reference) if reference else 1
    chairs = sum(symbol["categoryCode"] == "chair" for symbol in actual)
    passed = (
        precision >= 0.9
        and recall >= 0.9
        and len(actual) == 13
        and chairs == 6
        and len(layout) == len(reference)
        and all(item["passed"] for item in layout)
    )
    return {
        "passed": passed,
        "categoryPrecision": precision,
        "categoryRecall": recall,
        "actualCount": len(actual),
        "referenceCount": len(reference),
        "chairCount": chairs,
        "layout": layout,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--result", required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--reference", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument(
        "--protocol", choices=("activity", "contours"), default="activity"
    )
    parser.add_argument("--structure-overlay")
    args = parser.parse_args()

    result = json.loads(Path(args.result).read_text())
    structure = result["task"]["generation"]["structure"]
    reference_document = json.loads(Path(args.reference).read_text())
    reference = reference_document["symbols"]
    image = Image.open(args.image).convert("RGB")
    contours = contour_candidates(image, structure)
    candidates = contours["contourCandidates"]
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    contours["overlay"].save(output / "contours.png")
    contours["targetOverlay"].save(output / "target_contours.png")
    contours["objectOverlay"].save(output / "objects.png")
    contours["groupOverlay"].save(output / "groups.png")
    payload = {
        "userRequest": result["task"]["input"],
        "targetRoomIds": structure["targetRoomIds"],
        "roomLabels": [
            room
            for room in structure["rooms"]
            if room["id"] in structure["targetRoomIds"]
        ],
        "structure": {
            key: structure.get(key)
            for key in ("walls", "openings", "rooms", "targetRoomIds", "uncertainties")
        },
        "targetRegions": contours["targetRegions"],
        "allowedRooms": structure["targetRoomIds"],
        "allowedCategories": list(CategoryCode.__args__),
    }
    if args.protocol == "activity":
        selectable_objects = [
            candidate
            for candidate in contours["objectCandidates"]
            if candidate.get("selectable")
        ]
        payload.update(
            {
                "objectCandidates": selectable_objects,
                "activityGroupCandidates": contours["activityGroupCandidates"],
            }
        )
        structure_overlay = (
            Image.open(args.structure_overlay).convert("RGB")
            if args.structure_overlay
            else image
        )
        images = [
            image,
            structure_overlay,
            contours["objectOverlay"],
            contours["groupOverlay"],
        ]
        schema_model = FurnitureActivityRecognition
        prompt = VISION_ACTIVITY
    else:
        payload["contourCandidates"] = candidates
        images = [image, contours["targetOverlay"], contours["overlay"]]
        schema_model = FurnitureContourRecognition
        prompt = VISION_FURNITURE
    buffers = []
    for item in images:
        buffer = io.BytesIO()
        item.save(buffer, format="PNG")
        buffers.append(buffer.getvalue())
    client = VisionModelClient()
    responses = []
    actual = None
    value = None
    previous = None
    parse_error = None
    for _attempt in range(2):
        response = asyncio.run(
            client.complete(
                prompt,
                payload,
                buffers,
                schema_model.model_json_schema(),
                previous=previous,
                parse_error=parse_error,
            )
        )
        responses.append(response)
        try:
            value = schema_model.model_validate(
                _parse_structured_content(response["content"])
            ).model_dump(exclude_none=True, by_alias=True)
            if args.protocol == "activity":
                actual, activity_groups = _assemble_activity_symbols(
                    value,
                    selectable_objects,
                    contours["activityGroupCandidates"],
                    {"data": structure},
                    "vision-probe",
                )
            else:
                actual = _assemble_contour_symbols(
                    value, candidates, {"data": structure}, "vision-probe"
                )
                activity_groups = []
            break
        except (json.JSONDecodeError, ValidationError, ValueError, TaskError) as error:
            previous = response["content"]
            parse_error = str(error)[:800]
    (output / "raw-responses.json").write_text(
        json.dumps(responses, ensure_ascii=False, indent=2)
    )
    if actual is None:
        report = {
            "model": client.record(),
            "attempts": len(responses),
            "usage": [response["usage"] for response in responses],
            "seconds": round(sum(response["seconds"] for response in responses), 3),
            "error": parse_error,
            "score": {"passed": False},
        }
        (output / "report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2)
        )
        print(json.dumps(report))
        raise SystemExit(1)
    anchor = reference_document["anchors"][0]
    pixel_length = math.hypot(
        anchor["b"]["x"] - anchor["a"]["x"],
        anchor["b"]["y"] - anchor["a"]["y"],
    )
    scale_mm = (
        anchor["distance"]["value"]
        * {"mm": 1, "cm": 10, "m": 1000}[anchor["distance"]["unit"]]
        / pixel_length
    )
    report = {
        "model": client.record(),
        "attempts": len(responses),
        "usage": [response["usage"] for response in responses],
        "seconds": round(sum(response["seconds"] for response in responses), 3),
        "symbols": actual,
        "activityGroups": activity_groups,
        "score": score(actual, reference, scale_mm),
    }
    (output / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2)
    )
    print(json.dumps({key: report[key] for key in ("model", "usage", "score")}))
    if not report["score"]["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
