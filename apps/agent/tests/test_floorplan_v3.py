"""V3 bounded recognition tests; controlled data never counts as live-image acceptance."""

import pytest
from pydantic import ValidationError

from actiscape_agent.config import FLOORPLAN_REVIEW_OPTIONS
from actiscape_agent.floorplan_schemas import (
    FloorplanReview,
    FurnitureRecognition,
    RecognitionV3,
)
from actiscape_agent.floorplan_v3 import _assemble_structure, build_structure_skeleton
from actiscape_agent.store import TaskError


def analysis_record():
    return {
        "id": "analysis-1",
        "result": {
            "outline_px": [0, 0, 400, 300],
            "segments_px": [
                {"orient": "h", "line": 10, "s0": 0, "s1": 100, "t": 8},
                {"orient": "h", "line": 10, "s0": 150, "s1": 400, "t": 8},
                {"orient": "h", "line": 290, "s0": 0, "s1": 400, "t": 8},
                {"orient": "v", "line": 10, "s0": 10, "s1": 290, "t": 8},
                {"orient": "v", "line": 390, "s0": 10, "s1": 290, "t": 8},
            ],
            "gaps_px": [
                {
                    "orient": "h",
                    "line": 10,
                    "s0": 100,
                    "s1": 150,
                    "t": 8,
                    "guess": "window",
                }
            ],
            "dims_px": {"top": [], "bottom": [], "left": [], "right": []},
        },
        "files": [],
    }


def structure_response():
    return {
        "status": "draft",
        "name": "controlled V3",
        "walls": [
            {
                "id": "north",
                "segments": [
                    {"analysisId": "analysis-1", "index": 0},
                    {"analysisId": "analysis-1", "index": 1},
                ],
            },
            {"id": "south", "segments": [{"analysisId": "analysis-1", "index": 2}]},
            {"id": "west", "segments": [{"analysisId": "analysis-1", "index": 3}]},
            {"id": "east", "segments": [{"analysisId": "analysis-1", "index": 4}]},
        ],
        "openings": [
            {
                "id": "window",
                "wallId": "north",
                "analysisId": "analysis-1",
                "index": 0,
                "type": "window",
                "evidenceRefs": ["analysis-1"],
            }
        ],
        "rooms": [
            {
                "id": "living",
                "at": {"x": 200, "y": 150},
                "name": "客餐厅",
                "functionalArea": "living",
            }
        ],
        "targetRoomIds": ["living"],
        "anchors": [],
        "uncertainties": [],
    }


def test_skeleton_and_structure_assembly_use_real_candidates_only():
    image = {"id": "image", "sha256": "a" * 64, "width": 400, "height": 300}
    skeleton = build_structure_skeleton(analysis_record(), image)
    value = _assemble_structure(skeleton, structure_response(), {})
    assert value["recognitionVersion"] == 3
    assert value["measurementVersion"] == 2
    assert value["walls"][0]["a"] == {"x": 10, "y": 10}
    assert value["walls"][0]["b"] == {"x": 390, "y": 10}
    assert value["openings"][0] == {
        "id": "window",
        "wallId": "north",
        "type": "window",
        "offset": 115,
        "width": 50,
    }
    assert value["symbols"] == []
    RecognitionV3.model_validate(value)


def test_missing_crop_evidence_rejects_custom_wall():
    image = {"id": "image", "sha256": "a" * 64, "width": 400, "height": 300}
    skeleton = build_structure_skeleton(analysis_record(), image)
    value = structure_response()
    value["walls"][0] = {
        "id": "north",
        "customSegments": [{"cropId": "missing", "kind": "H", "c": 10, "p0": 0, "p1": 400}],
    }
    with pytest.raises(TaskError, match="裁剪证据"):
        _assemble_structure(skeleton, value, {})


def test_mixed_orientation_candidates_are_rejected_offline():
    image = {"id": "image", "sha256": "a" * 64, "width": 400, "height": 300}
    skeleton = build_structure_skeleton(analysis_record(), image)
    value = structure_response()
    value["walls"][0]["segments"] = [
        {"analysisId": "analysis-1", "index": 0},
        {"analysisId": "analysis-1", "index": 3},
    ]
    with pytest.raises(TaskError, match="混合了水平和竖直候选"):
        _assemble_structure(skeleton, value, {})


def test_opening_outside_wall_range_is_rejected_offline():
    image = {"id": "image", "sha256": "a" * 64, "width": 400, "height": 300}
    skeleton = build_structure_skeleton(analysis_record(), image)
    value = structure_response()
    value["walls"][0]["segments"] = [{"analysisId": "analysis-1", "index": 0}]
    with pytest.raises(TaskError, match="超出所属墙范围"):
        _assemble_structure(skeleton, value, {})


def test_category_enum_and_review_bounds():
    base = {
        "status": "draft",
        "symbols": [
            {
                "id": "sofa",
                "roomId": "living",
                "categoryCode": "sofa",
                "sourceLabel": "三人沙发",
                "included": True,
                "evidenceRefs": ["image:" + "a" * 64],
                "x": 100,
                "y": 100,
                "w": 80,
                "d": 40,
                "rot": 0,
            }
        ],
    }
    FurnitureRecognition.model_validate(base)
    with pytest.raises(ValidationError):
        FurnitureRecognition.model_validate(
            {
                **base,
                "symbols": [{**base["symbols"][0], "categoryCode": "三人沙发（靠北）"}],
            }
        )
    review = FloorplanReview.model_validate(
        {
            "passed": False,
            "summary": "controlled",
            "issues": [
                {
                    "code": "FURNITURE_MISSING",
                    "object_ids": ["sofa"],
                    "description": "原图靠北墙还有一张沙发",
                }
            ],
        }
    )
    assert review.issues[0].code == "FURNITURE_MISSING"
    assert FLOORPLAN_REVIEW_OPTIONS["max_tokens"] == 16384
    assert FLOORPLAN_REVIEW_OPTIONS["extra_body"]["thinking"]["type"] == "disabled"
