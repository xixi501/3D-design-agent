"""V3 bounded recognition tests; controlled data never counts as live-image acceptance."""

import hashlib
import json
from pathlib import Path

import pytest
from PIL import Image
from pydantic import ValidationError

from actiscape_agent.config import FLOORPLAN_REVIEW_OPTIONS
from actiscape_agent.floorplan_candidates import (
    contour_candidates,
    furniture_object_candidates,
    structure_candidates,
)
from actiscape_agent.floorplan_roles import normalize_floorplan_asset_choices
from actiscape_agent.floorplan_schemas import (
    FloorplanReview,
    FurnitureActivityRecognition,
    FurnitureContourRecognition,
    FurnitureRecognition,
    MeasuredDraftProposal,
    MeasuredDraftUpdate,
    RecognitionV3,
)
from actiscape_agent.floorplan_tools import FloorplanToolset
from actiscape_agent.floorplan_v3 import (
    STRUCTURE,
    FloorplanV3,
    _arbitrate_review,
    _assemble_activity_symbols,
    _assemble_contour_symbols,
    _assemble_structure,
    _deterministic_measurement_bindings,
    _finalize_measured_update,
    _parse_structured_content,
    _repair_activity_object_bindings,
    _should_run_initial_review,
    build_structure_skeleton,
)
from actiscape_agent.manager import TaskManager
from actiscape_agent.store import TaskError, TaskStore
from actiscape_agent.vision_client import VisionModelClient, VisionModelFailure


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
                    "a": 0,
                    "b": 1,
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
                "candidateWallIds": ["cw_0_1"],
            },
            {"id": "south", "candidateWallIds": ["cw_2_2"]},
            {"id": "west", "candidateWallIds": ["cw_3_3"]},
            {"id": "east", "candidateWallIds": ["cw_4_4"]},
        ],
        "openings": [
            {
                "id": "window",
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


def vision_recognition_fixture(tmp_path):
    image = {"id": "image", "sha256": "a" * 64, "width": 400, "height": 300}
    store = TaskStore(tmp_path)
    conversation = store.create_conversation("project")
    task = store.create_task(
        conversation["id"],
        {
            "requestId": "vision-furniture",
            "input": "复现客餐厅家具",
            "mode": "reconstruct_floorplan",
            "imageId": image["id"],
        },
    )
    generation = store.task(task["id"], internal=True)["generation"]
    generation["workflowVersion"] = 3
    store.update(task["id"], generation=generation)
    draft = {
        "id": "draft",
        "data": {
            "targetRoomIds": ["living"],
            "rooms": [
                {
                    "id": "living",
                    "name": "客餐厅",
                    "at": {"x": 100, "y": 100},
                    "width": 200,
                    "depth": 200,
                }
            ],
            "walls": [],
            "openings": [],
            "uncertainties": [],
        },
    }
    record = {
        "id": "contours",
        "contourCandidates": [
            {
                "candidateId": "fc_001",
                "bbox": [10, 10, 20, 20],
                "center": {"x": 20, "y": 20},
                "area": 400,
                "shape": "contour",
            },
            {
                "candidateId": "fc_002",
                "bbox": [40, 40, 20, 20],
                "center": {"x": 50, "y": 50},
                "area": 400,
                "shape": "contour",
            },
        ],
        "targetRegions": {"living": {"bbox": [0, 0, 200, 200], "pixels": 40000}},
        "files": [],
    }
    raw = {
        "candidates.png": b"candidates",
        "target_contours.png": b"target-contours",
        "contours.png": b"contours",
    }
    evidence = {
        "evidence": [
            {
                "files": [
                    {
                        "name": name,
                        "path": "/" + name,
                        "sha256": hashlib.sha256(content).hexdigest(),
                    }
                    for name, content in raw.items()
                ]
            }
        ]
    }

    class Evidence:
        async def context(self):
            return evidence

    class Client:
        async def image(self, path):
            if path.endswith("/file"):
                return b"original"
            return raw[path.lstrip("/")]

    class Base:
        pass

    client = Client()
    base = Base()
    base.store, base.client = store, client
    return store, task, image, draft, record, Evidence(), client, base


def vision_response(*symbols):
    return {
        "content": json.dumps({"status": "draft", "question": "", "symbols": list(symbols)}),
        "model": "controlled-vision",
        "usage": {"prompt_tokens": 10, "completion_tokens": 5},
        "seconds": 0.25,
        "structuredMode": "json_schema",
    }


def vision_symbol(candidate_id="fc_001", symbol_id="chair"):
    return {
        "id": symbol_id,
        "roomId": "living",
        "categoryCode": "chair",
        "sourceLabel": "chair",
        "included": True,
        "contourCandidateIds": [candidate_id],
        "rot": 0,
    }


def test_skeleton_and_structure_assembly_use_real_candidates_only():
    image = {"id": "image", "sha256": "a" * 64, "width": 400, "height": 300}
    skeleton = build_structure_skeleton(analysis_record(), image)
    assert [wall["candidateWallId"] for wall in skeleton["candidateWalls"]] == [
        "cw_0_1",
        "cw_2_2",
        "cw_3_3",
        "cw_4_4",
    ]
    assert skeleton["gaps"][0]["candidateWallId"] == "cw_0_1"
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


def test_measurement_bindings_use_opposite_wall_faces():
    data = {
        "walls": [
            {"id": "top", "a": {"x": 10, "y": 10}, "b": {"x": 110, "y": 10}},
            {"id": "left", "a": {"x": 10, "y": 10}, "b": {"x": 10, "y": 110}},
            {"id": "bottom", "a": {"x": 10, "y": 110}, "b": {"x": 110, "y": 110}},
            {"id": "right", "a": {"x": 110, "y": 10}, "b": {"x": 110, "y": 110}},
        ],
        "anchors": [
            {
                "a": {"x": 6, "y": 6},
                "b": {"x": 114, "y": 6},
                "distance": {"value": 104, "unit": "mm"},
                "basis": "exterior",
                "evidence": "horizontal",
            },
            {
                "a": {"x": 12, "y": 6},
                "b": {"x": 108, "y": 6},
                "distance": {"value": 96, "unit": "mm"},
                "basis": "interior",
                "evidence": "horizontal interior",
            },
            {
                "a": {"x": 6, "y": 6},
                "b": {"x": 6, "y": 114},
                "distance": {"value": 104, "unit": "mm"},
                "basis": "exterior",
                "evidence": "vertical",
            },
            {
                "a": {"x": 12, "y": 6},
                "b": {"x": 12, "y": 108},
                "distance": {"value": 96, "unit": "mm"},
                "basis": "interior",
                "evidence": "vertical interior",
            },
        ],
    }
    measurements = [
        {
            "id": wall["id"],
            "center": 10 if wall["id"] in ("top", "left") else 110,
            "faces": [8, 12] if wall["id"] in ("top", "left") else [108, 112],
        }
        for wall in data["walls"]
    ]
    features, dimensions = _deterministic_measurement_bindings(
        data,
        measurements,
        "wall-record",
        {0: "dim-record", 1: "dim-record", 2: "dim-record", 3: "dim-record"},
    )
    assert len(features) == 8
    assert len(dimensions) == 4
    assert len({feature["id"] for feature in features}) == len(features)
    assert len({dimension["id"] for dimension in dimensions}) == len(dimensions)
    exterior = dimensions[0]
    low, high = (
        next(feature for feature in features if feature["id"] == exterior["from"]),
        next(feature for feature in features if feature["id"] == exterior["to"]),
    )
    assert (low["objectId"], low["side"]) == ("left", "min")
    assert (high["objectId"], high["side"]) == ("right", "max")
    interior = dimensions[1]
    low, high = (
        next(feature for feature in features if feature["id"] == interior["from"]),
        next(feature for feature in features if feature["id"] == interior["to"]),
    )
    assert (low["objectId"], low["side"]) == ("left", "max")
    assert (high["objectId"], high["side"]) == ("right", "min")
    vertical = dimensions[2]
    low, high = (
        next(feature for feature in features if feature["id"] == vertical["from"]),
        next(feature for feature in features if feature["id"] == vertical["to"]),
    )
    assert (low["objectId"], low["side"]) == ("top", "min")
    assert (high["objectId"], high["side"]) == ("bottom", "max")
    interior_vertical = dimensions[3]
    low, high = (
        next(feature for feature in features if feature["id"] == interior_vertical["from"]),
        next(feature for feature in features if feature["id"] == interior_vertical["to"]),
    )
    assert (low["objectId"], low["side"]) == ("top", "max")
    assert (high["objectId"], high["side"]) == ("bottom", "min")
    assert all(feature["evidenceRefs"] for feature in features)
    assert all(dimension["evidenceRefs"] for dimension in dimensions)


def test_measurement_proposal_cannot_submit_code_owned_collections():
    with pytest.raises(ValidationError):
        MeasuredDraftProposal.model_validate(
            {
                "baseDraftRevision": 0,
                "baseDraftHash": "a" * 64,
                "commands": [
                    {
                        "type": "upsert",
                        "collection": "features",
                        "object": {
                            "id": "feature",
                            "objectId": "wall",
                            "kind": "wall_face",
                            "axis": "x",
                            "side": "min",
                            "evidenceRefs": ["record"],
                        },
                    }
                ],
                "changeReasons": [],
                "evidenceRefs": [],
                "summary": "invalid model-owned measurement",
            }
        )


@pytest.mark.parametrize(
    "command",
    [
        {
            "type": "patch",
            "collection": "rooms",
            "id": "living",
            "patch": {"name": "expanded label"},
        },
        {
            "type": "patch",
            "collection": "symbols",
            "id": "sofa",
            "patch": {"rot": 180},
        },
        {
            "type": "upsert",
            "collection": "walls",
            "object": {
                "id": "new-wall",
                "a": {"x": 0, "y": 0},
                "b": {"x": 100, "y": 0},
            },
        },
        {
            "type": "calibrate",
            "anchors": [],
        },
    ],
)
def test_measurement_proposal_rejects_semantic_or_topology_mutations(command):
    with pytest.raises(ValidationError):
        MeasuredDraftProposal.model_validate(
            {
                "baseDraftRevision": 0,
                "baseDraftHash": "a" * 64,
                "commands": [command],
                "changeReasons": [],
                "evidenceRefs": [],
                "summary": "invalid semantic mutation",
            }
        )


def test_finalized_measurement_overrides_revision_and_appends_code_bindings():
    draft = {"revision": 4, "hash": "d" * 64}
    features = [
        {
            "id": "feat_low",
            "objectId": "left",
            "kind": "wall_face",
            "axis": "x",
            "side": "min",
            "evidenceRefs": ["wall-record"],
        },
        {
            "id": "feat_high",
            "objectId": "right",
            "kind": "wall_face",
            "axis": "x",
            "side": "max",
            "evidenceRefs": ["wall-record"],
        },
    ]
    dimensions = [
        {
            "id": "dim_anchor_0",
            "anchorIndex": 0,
            "from": "feat_low",
            "to": "feat_high",
            "distance": {"value": 100, "unit": "mm"},
            "basis": "exterior",
            "evidenceRefs": ["dim-record"],
        }
    ]
    value = {
        "baseDraftRevision": 0,
        "baseDraftHash": "0" * 64,
        "commands": [
            {
                "type": "patch",
                "collection": "walls",
                "id": "left",
                "patch": {"a": {"x": 8, "y": 10}, "thickness": None},
            },
            {
                "type": "patch",
                "collection": "rooms",
                "id": "living",
                "patch": {"name": "expanded room label"},
            },
            {
                "type": "patch",
                "collection": "symbols",
                "id": "sofa",
                "patch": {"rot": 180},
            },
            {
                "type": "calibrate",
                "anchors": [
                    {
                        "a": {"x": 0, "y": 0},
                        "b": {"x": 100, "y": 0},
                        "distance": {"value": 100, "unit": "mm"},
                        "basis": "exterior",
                        "evidence": "model-owned calibration",
                    }
                ],
            },
            {
                "type": "upsert",
                "collection": "features",
                "object": {"id": "model-owned"},
            },
            {
                "type": "patch",
                "collection": "dimensions",
                "id": "model-owned",
                "patch": {},
            },
            {
                "type": "upsert",
                "collection": "dimensionObservations",
                "object": {"id": "model-owned"},
            },
        ],
        "changeReasons": [
            {
                "collection": "walls",
                "id": "left",
                "reason": "measured wall center",
                "evidenceRefs": ["wall-record"],
            },
            {
                "collection": "features",
                "id": "model-owned",
                "reason": "must be discarded",
                "evidenceRefs": ["wall-record"],
            },
            {
                "collection": "rooms",
                "id": "living",
                "reason": "must be discarded",
                "evidenceRefs": ["wall-record"],
            },
        ],
        "evidenceRefs": ["wall-record"],
        "summary": "measured",
    }
    result = _finalize_measured_update(value, draft, features, dimensions)
    assert result["baseDraftRevision"] == 4
    assert result["baseDraftHash"] == "d" * 64
    assert [command["collection"] for command in result["commands"]] == [
        "walls",
        "features",
        "features",
        "dimensions",
    ]
    assert result["commands"][0]["patch"] == {"a": {"x": 8, "y": 10}}
    assert not any(
        command["collection"] in ("rooms", "symbols", "dimensionObservations")
        or command.get("id") == "model-owned"
        for command in result["commands"]
    )
    assert "忽略了 6 条" in result["summary"]
    assert result["evidenceRefs"] == ["wall-record", "dim-record"]
    MeasuredDraftUpdate.model_validate(result)


def test_prompt_version_keeps_frozen_floorplan_task_version(tmp_path):
    store = TaskStore(tmp_path)
    conversation = store.create_conversation("project")
    task = store.create_task(
        conversation["id"],
        {
            "requestId": "frozen-version",
            "input": "test",
            "mode": "reconstruct_floorplan",
            "imageId": "image",
        },
    )
    generation = store.task(task["id"], internal=True)["generation"]
    generation["floorplanVersion"] = "s2c-floorplan-v3-3"
    store.update(task["id"], generation=generation)

    class Base:
        pass

    base = Base()
    base.store, base.client = store, object()
    helper = FloorplanV3(store, base.client, base)
    assert helper.prompt_version(store.task(task["id"], internal=True)) == "s2c-floorplan-v3-3"
    store.close()


def test_structure_prompt_requires_verbatim_room_labels():
    assert "逐字复制原图可见标签" in STRUCTURE
    assert "不翻译、不扩写、不拼接中英文" in STRUCTURE


def test_captured_real_candidates_are_grouped_before_model_selection():
    record = {
        "id": "real-analysis",
        "result": {
            "segments_px": [
                {"orient": "h", "line": 108.5, "s0": 370, "s1": 468, "t": 9},
                {"orient": "h", "line": 108.5, "s0": 568, "s1": 734, "t": 9},
                {"orient": "h", "line": 108.5, "s0": 811, "s1": 870, "t": 9},
                {"orient": "h", "line": 138.5, "s0": 484, "s1": 552, "t": 5},
                {"orient": "h", "line": 345.6, "s0": 672, "s1": 870, "t": 9},
                {"orient": "h", "line": 503.4, "s0": 534, "s1": 879, "t": 9},
                {"orient": "v", "line": 365.1, "s0": 367, "s1": 508, "t": 9},
                {"orient": "v", "line": 676.5, "s0": 113, "s1": 203, "t": 9},
                {"orient": "v", "line": 676.5, "s0": 447, "s1": 499, "t": 9},
                {"orient": "v", "line": 874.4, "s0": 448, "s1": 499, "t": 9},
            ],
            "gaps_px": [
                {
                    "orient": "h",
                    "line": 108.5,
                    "s0": 468,
                    "s1": 568,
                    "t": 9,
                    "a": 0,
                    "b": 1,
                },
                {
                    "orient": "h",
                    "line": 108.5,
                    "s0": 734,
                    "s1": 811,
                    "t": 9,
                    "a": 1,
                    "b": 2,
                },
                {
                    "orient": "v",
                    "line": 676.5,
                    "s0": 203,
                    "s1": 447,
                    "t": 9,
                    "a": 7,
                    "b": 8,
                },
            ],
            "dims_px": {},
        },
    }
    skeleton = build_structure_skeleton(
        record, {"id": "image", "sha256": "a" * 64, "width": 1200, "height": 630}
    )
    groups = {
        wall["candidateWallId"]: (wall["indices"], wall["gapIndices"])
        for wall in skeleton["candidateWalls"]
    }
    assert groups["cw_0_2"] == ([0, 1, 2], [0, 1])
    assert groups["cw_7_8"] == ([7, 8], [2])
    assert skeleton["gaps"][0]["candidateWallId"] == "cw_0_2"
    assert skeleton["gaps"][2]["candidateWallId"] == "cw_7_8"


def test_missing_crop_evidence_rejects_custom_wall():
    image = {"id": "image", "sha256": "a" * 64, "width": 400, "height": 300}
    skeleton = build_structure_skeleton(analysis_record(), image)
    value = structure_response()
    value["walls"][0] = {
        "id": "north",
        "candidateWallIds": [],
        "customSegments": [{"cropId": "missing", "kind": "H", "c": 10, "p0": 0, "p1": 400}],
    }
    with pytest.raises(TaskError, match="裁剪证据"):
        _assemble_structure(skeleton, value, {})


def test_v33_candidate_layer_closes_walls_and_finds_opening_intervals():
    raw = {
        "outline_px": [40, 41, 961, 760],
        "segments_px": [
            {"orient": "h", "line": 51, "s0": 60, "s1": 275, "t": 20},
            {"orient": "h", "line": 51, "s0": 426, "s1": 641, "t": 20},
            {"orient": "h", "line": 51, "s0": 661, "s1": 941, "t": 20},
            {"orient": "h", "line": 401, "s0": 661, "s1": 941, "t": 20},
            {"orient": "h", "line": 750, "s0": 60, "s1": 155, "t": 20},
            {"orient": "h", "line": 750, "s0": 246, "s1": 641, "t": 20},
            {"orient": "h", "line": 750, "s0": 661, "s1": 941, "t": 20},
            {"orient": "v", "line": 50, "s0": 41, "s1": 760, "t": 20},
            {"orient": "v", "line": 651, "s0": 41, "s1": 760, "t": 20},
            {"orient": "v", "line": 951, "s0": 41, "s1": 760, "t": 20},
        ],
        "gaps_px": [
            {"orient": "h", "line": 51, "s0": 275, "s1": 426, "t": 20, "a": 0, "b": 1},
            {"orient": "h", "line": 750, "s0": 155, "s1": 246, "t": 20, "a": 4, "b": 5},
        ],
    }
    candidates = structure_candidates(Image.open("fixtures/s2c-synthetic.png").convert("RGB"), raw)
    assert len(candidates["candidateWalls"]) == 6
    assert {candidate["candidateWallId"] for candidate in candidates["candidateWalls"]} == {
        "cw_top",
        "cw_bottom",
        "cw_left",
        "cw_right",
        "cw_int_h_0",
        "cw_int_v_0",
    }
    assert len(candidates["openingCandidates"]) == 2
    assert candidates["dimensionCandidates"] == []


@pytest.mark.skipif(
    not Path(
        "data/floorplan-images/"
        "fp-7ffeba5739402634c8744d723125c134e722d794f55ebd5140246b76681841aa/"
        "normalized.png"
    ).exists(),
    reason="frozen real image is kept outside the repository",
)
def test_v33_frozen_real_candidates_replay_known_failure():
    image_path = Path(
        "data/floorplan-images/"
        "fp-7ffeba5739402634c8744d723125c134e722d794f55ebd5140246b76681841aa/"
        "normalized.png"
    )
    captured_path = Path("test-results/floorplan-tool-live/2026-11-08T03-04-42-162Z/1-result.json")
    assert captured_path.exists()
    captured = json.loads(captured_path.read_text())

    def find_raw(value):
        if isinstance(value, dict):
            if isinstance(value.get("segments_px"), list) and isinstance(
                value.get("outline_px"), list
            ):
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

    candidates = structure_candidates(Image.open(image_path).convert("RGB"), find_raw(captured))
    assert len(candidates["candidateWalls"]) == 6
    assert len(candidates["openingCandidates"]) == 7
    assert len(candidates["dimensionCandidates"]) == 4
    assert [opening["typeHint"] for opening in candidates["openingCandidates"]].count("door") == 3
    assert [opening["typeHint"] for opening in candidates["openingCandidates"]].count("window") == 4
    assert {dimension["suggestedBasis"] for dimension in candidates["dimensionCandidates"]} == {
        "exterior",
        "interior",
    }


def test_v33_assembly_generates_anchor_and_dimension_observations_from_ids():
    skeleton = {
        "structureSkeletonVersion": 3,
        "analysisId": "analysis",
        "candidateWalls": [
            {
                "candidateWallId": "cw_top",
                "role": "top",
                "orient": "h",
                "line": 10,
                "s0": 10,
                "s1": 390,
                "t": 8,
            },
            {
                "candidateWallId": "cw_left",
                "role": "left",
                "orient": "v",
                "line": 10,
                "s0": 10,
                "s1": 290,
                "t": 8,
            },
        ],
        "openingCandidates": [
            {
                "candidateId": "op_0",
                "candidateWallId": "cw_top",
                "orient": "h",
                "line": 10,
                "start": 100,
                "end": 150,
                "center": 125,
                "typeHint": "window",
            }
        ],
        "dimensionCandidates": [
            {
                "candidateId": "dim_top_0",
                "axis": "h",
                "side": "top",
                "at": 0,
                "ticks": [0, 400],
                "suggestedWallRole": "top",
                "suggestedBasis": "exterior",
            },
            {
                "candidateId": "dim_top_1",
                "axis": "h",
                "side": "top",
                "at": 0,
                "ticks": [0, 400],
                "suggestedWallRole": "top",
                "suggestedBasis": "interior",
            },
            {
                "candidateId": "dim_left_0",
                "axis": "v",
                "side": "left",
                "at": 0,
                "ticks": [10, 290],
                "suggestedWallRole": "left",
                "suggestedBasis": "exterior",
            },
            {
                "candidateId": "dim_left_1",
                "axis": "v",
                "side": "left",
                "at": 0,
                "ticks": [10, 290],
                "suggestedWallRole": "left",
                "suggestedBasis": "interior",
            },
        ],
    }
    recognition = {
        "status": "draft",
        "name": "offline candidate assembly",
        "walls": [
            {"id": "north", "candidateWallIds": ["cw_top"]},
            {"id": "west", "candidateWallIds": ["cw_left"]},
        ],
        "openings": [{"id": "window", "candidateId": "op_0", "type": "window"}],
        "rooms": [{"id": "living", "at": {"x": 200, "y": 150}, "name": "Living"}],
        "targetRoomIds": ["living"],
        "dimensionReads": [
            {"candidateId": "dim_top_0", "label": "4000 mm"},
            {"candidateId": "dim_top_1", "label": "3800 mm"},
            {"candidateId": "dim_left_0", "label": "2800 mm"},
            {"candidateId": "dim_left_1", "label": "2600 mm"},
        ],
        "uncertainties": [],
    }
    value = _assemble_structure(skeleton, recognition, {})
    assert len(value["anchors"]) == 4
    assert value["anchors"][0]["distance"] == {"value": 4000, "unit": "mm"}
    assert len(value["dimensionObservations"]) == 4
    assert value["dimensionObservations"][0]["scaleReference"] is True
    assert sum(observation["scaleReference"] for observation in value["dimensionObservations"]) == 1
    value["uncertainties"] = [
        {
            "id": "u_door_swing",
            "message": "门开向待确认",
            "blocking": False,
            "code": "DOOR_SWING",
            "objectIds": ["window"],
            "evidenceRefs": ["analysis"],
        }
    ]
    RecognitionV3.model_validate(value)


def test_v33_furniture_contours_and_review_arbitration():
    with open("fixtures/s2c-v2-synthetic.floorplan.json", encoding="utf-8") as source:
        spec = json.load(source)
    candidates = contour_candidates(Image.open("fixtures/s2c-synthetic.png").convert("RGB"), spec)
    assert len(candidates["contourCandidates"]) >= 4
    with pytest.raises(ValidationError):
        FurnitureContourRecognition.model_validate(
            {
                "status": "draft",
                "symbols": [
                    {
                        "id": "sofa",
                        "roomId": "living",
                        "categoryCode": "sofa",
                        "sourceLabel": "sofa",
                        "included": True,
                        "contourCandidateIds": ["fc_000"],
                        "rot": 0,
                        "x": 100,
                    }
                ],
            }
        )
    draft = {
        "hash": "a" * 64,
        "data": {
            "uncertainties": [],
            "symbols": [{"id": "sofa"}],
            "anchors": [],
            "dimensionObservations": [],
            "walls": [],
            "openings": [],
        },
    }
    diagnostics = {"id": "diagnostic", "checks": {"passed": True, "issues": []}}
    review = {
        "passed": False,
        "summary": "model-only concern",
        "issues": [
            {
                "code": "OPENING_MISMATCH",
                "object_ids": ["window"],
                "description": "model saw a mismatch",
            }
        ],
    }
    arbitrated = _arbitrate_review(review, draft, diagnostics, {})
    assert arbitrated["passed"] is True
    assert any(
        issue["code"] == "REVIEW_CONFLICT" and issue["severity"] == "advisory"
        for issue in arbitrated["issues"]
    )


def test_review_downgrades_dimension_uncertainty_resolved_by_code_bindings():
    draft = {
        "data": {
            "uncertainties": [
                {
                    "id": "u_dim_basis",
                    "message": "dimensions 集合为空，尺寸基准待确认",
                    "blocking": True,
                }
            ],
            "symbols": [{"id": "sofa"}],
            "anchors": [
                {
                    "a": {"x": 0, "y": 0},
                    "b": {"x": 100, "y": 0},
                    "distance": {"value": 1000, "unit": "mm"},
                    "basis": "exterior",
                    "evidence": "dimension",
                }
            ],
            "features": [{"id": "left"}, {"id": "right"}],
            "dimensions": [{"id": "dim", "anchorIndex": 0}],
            "walls": [],
            "openings": [],
        }
    }
    diagnostics = {"id": "diagnostic", "checks": {"passed": True, "issues": []}}
    review = {"passed": True, "summary": "ok", "issues": []}
    arbitrated = _arbitrate_review(review, draft, diagnostics, {})
    assert arbitrated["passed"] is True
    assert any(
        issue["object_ids"] == ["u_dim_basis"]
        and issue["severity"] == "advisory"
        and "代码证据已覆盖" in issue["description"]
        for issue in arbitrated["issues"]
    )


def test_review_keeps_uncertainty_blocking_without_code_resolution():
    draft = {
        "data": {
            "uncertainties": [
                {
                    "id": "u_dim_basis",
                    "message": "dimensions 集合为空，尺寸基准待确认",
                    "blocking": True,
                }
            ],
            "symbols": [{"id": "sofa"}],
            "anchors": [
                {
                    "a": {"x": 0, "y": 0},
                    "b": {"x": 100, "y": 0},
                    "distance": {"value": 1000, "unit": "mm"},
                    "basis": "exterior",
                    "evidence": "dimension",
                }
            ],
            "features": [],
            "dimensions": [],
            "walls": [],
            "openings": [],
        }
    }
    diagnostics = {"id": "diagnostic", "checks": {"passed": True, "issues": []}}
    review = {"passed": True, "summary": "ok", "issues": []}
    arbitrated = _arbitrate_review(review, draft, diagnostics, {})
    assert arbitrated["passed"] is False
    assert any(
        issue["object_ids"] == ["u_dim_basis"] and issue["severity"] == "blocking"
        for issue in arbitrated["issues"]
    )


def test_initial_review_runs_only_after_deterministic_checks_pass():
    generation = {}
    failed = {"checks": {"passed": False, "issues": []}}
    passed = {"checks": {"passed": True, "issues": []}}
    assert _should_run_initial_review(generation, failed) is False
    assert _should_run_initial_review(generation, passed) is True
    generation["initialReview"] = {"draftHash": "a" * 64}
    assert _should_run_initial_review(generation, passed) is False


def test_review_downgrades_opening_uncertainty_when_candidates_all_match():
    draft = {
        "data": {
            "uncertainties": [
                {
                    "id": "u_int_v_split",
                    "message": "门洞 openings 候选仍需拆分",
                    "blocking": True,
                    "code": "OPENING_TYPE",
                }
            ],
            "symbols": [{"id": "sofa"}],
            "anchors": [],
            "features": [],
            "dimensions": [],
            "walls": [
                {
                    "id": "north",
                    "a": {"x": 0, "y": 0},
                    "b": {"x": 100, "y": 0},
                }
            ],
            "openings": [
                {
                    "id": "window",
                    "wallId": "north",
                    "offset": 50,
                    "width": 20,
                }
            ],
        }
    }
    skeleton = {
        "structureSkeletonVersion": 3,
        "analysisId": "analysis",
        "openingCandidates": [
            {
                "candidateId": "op_0",
                "line": 0,
                "start": 40,
                "end": 60,
                "orient": "h",
            }
        ],
    }
    diagnostics = {"id": "diagnostic", "checks": {"passed": True, "issues": []}}
    review = {"passed": True, "summary": "ok", "issues": []}
    arbitrated = _arbitrate_review(review, draft, diagnostics, skeleton)
    assert arbitrated["passed"] is True
    assert any(
        issue["object_ids"] == ["u_int_v_split"] and issue["severity"] == "advisory"
        for issue in arbitrated["issues"]
    )
    hard = {
        **draft,
        "data": {
            **draft["data"],
            "uncertainties": [
                {
                    "id": "u_wall_geometry",
                    "message": "墙体几何无法确认",
                    "blocking": True,
                    "code": "WALL_GEOMETRY",
                }
            ],
        },
    }
    blocked = _arbitrate_review(review, hard, diagnostics, skeleton)
    assert blocked["passed"] is False
    assert any(
        issue["object_ids"] == ["u_wall_geometry"] and issue["severity"] == "blocking"
        for issue in blocked["issues"]
    )


def test_activity_binding_repair_uses_missing_satellite_without_reusing_table():
    satellites = ["fo_010", "fo_011", "fo_013", "fo_015", "fo_014", "fo_016"]
    value = {
        "symbols": [
            {
                "id": "table",
                "categoryCode": "diningTable",
                "objectCandidateId": "fo_012",
            },
            *[
                {
                    "id": f"chair-{index}",
                    "categoryCode": "chair",
                    "objectCandidateId": ("fo_012" if index == 3 else satellites[index]),
                }
                for index in range(6)
            ],
        ],
        "activityGroups": [
            {
                "candidateId": "agc_000",
                "type": "group_seated",
                "primarySymbolId": "table",
                "memberSymbolIds": [
                    "table",
                    *[f"chair-{index}" for index in range(6)],
                ],
            }
        ],
    }
    group_candidates = [
        {
            "activityGroupCandidateId": "agc_000",
            "kind": "radial_cluster",
            "primaryObjectCandidateIds": ["fo_012"],
            "satelliteObjectCandidateIds": satellites,
        }
    ]
    repairs = _repair_activity_object_bindings(value, group_candidates)
    assert repairs == [
        {
            "symbolId": "chair-3",
            "before": "fo_012",
            "after": "fo_015",
            "reason": "activity-satellite",
        }
    ]
    assert value["symbols"][4]["objectCandidateId"] == "fo_015"
    assert value["objectCandidateRepairs"] == repairs


def test_review_downgrades_open_kitchen_scope_when_target_room_is_valid():
    draft = {
        "data": {
            "uncertainties": [
                {
                    "id": "u_room_label",
                    "message": "Living Room 与厨房在同一封闭区域内，是否合并需确认",
                    "blocking": True,
                }
            ],
            "symbols": [{"id": "sofa"}],
            "rooms": [
                {
                    "id": "living",
                    "name": "Living Room",
                    "functionalArea": "living",
                }
            ],
            "targetRoomIds": ["living"],
            "anchors": [],
            "features": [],
            "dimensions": [],
            "walls": [],
            "openings": [],
        }
    }
    diagnostics = {"id": "diagnostic", "checks": {"passed": True, "issues": []}}
    review = {"passed": True, "summary": "ok", "issues": []}
    arbitrated = _arbitrate_review(review, draft, diagnostics, {})
    assert arbitrated["passed"] is True
    assert any(
        issue["object_ids"] == ["u_room_label"] and issue["severity"] == "advisory"
        for issue in arbitrated["issues"]
    )


def test_floorplan_asset_choice_is_normalized_by_confirmed_footprint():
    catalogue = {
        "sofa": {"w": 2200, "d": 950, "h": 820},
        "fourSofa": {"w": 2800, "d": 1000, "h": 820},
        "bookshelf": {"w": 900, "d": 350, "h": 2000},
        "cabTall": {"w": 1200, "d": 400, "h": 2400},
        "plant": {"w": 500, "d": 500, "h": 1400},
        "bigPlant": {"w": 800, "d": 800, "h": 1800},
    }
    task = {
        "generation": {
            "symbolGroups": [["sofa"], ["books"], ["plant"]],
            "compiledSymbols": [
                {
                    "id": "sofa",
                    "categoryCode": "sofa",
                    "w": 2124,
                    "d": 920,
                },
                {
                    "id": "books",
                    "categoryCode": "bookshelf",
                    "w": 1239,
                    "d": 389,
                },
                {
                    "id": "plant",
                    "categoryCode": "plant",
                    "w": 478,
                    "d": 496,
                },
            ],
        }
    }
    selection = {
        "choices": [
            {"request_index": 0, "key": "fourSofa", "reason": "sofa"},
            {"request_index": 1, "key": "bookshelf", "reason": "shelf"},
            {"request_index": 2, "key": "plant", "reason": "plant"},
        ]
    }
    normalized, overrides = normalize_floorplan_asset_choices(selection, task, catalogue)
    assert [choice["key"] for choice in normalized["choices"]] == [
        "sofa",
        "cabTall",
        "plant",
    ]
    assert [(item["before"], item["after"]) for item in overrides] == [
        ("fourSofa", "sofa"),
        ("bookshelf", "cabTall"),
    ]


def test_floorplan_asset_normalization_preserves_user_catalog_key():
    catalogue = {
        "sofa": {"w": 2200, "d": 950, "h": 820},
        "fourSofa": {"w": 2800, "d": 1000, "h": 820},
    }
    task = {
        "generation": {
            "symbolGroups": [["sofa"]],
            "compiledSymbols": [
                {
                    "id": "sofa",
                    "categoryCode": "sofa",
                    "catalogKey": "fourSofa",
                    "w": 2124,
                    "d": 920,
                    "h": 820,
                }
            ],
        }
    }
    selection = {"choices": [{"request_index": 0, "key": "fourSofa", "reason": "user selected"}]}
    normalized, overrides = normalize_floorplan_asset_choices(selection, task, catalogue)
    assert normalized["choices"][0]["key"] == "fourSofa"
    assert overrides == []


@pytest.mark.asyncio
async def test_code_reconciliation_patches_only_resolved_uncertainties(tmp_path):
    store = TaskStore(tmp_path)
    conversation = store.create_conversation("project")
    task = store.create_task(
        conversation["id"],
        {
            "requestId": "uncertainty-reconcile",
            "input": "复现户型",
            "mode": "reconstruct_floorplan",
            "imageId": "image",
        },
    )
    generation = store.task(task["id"], internal=True)["generation"]
    generation["structureSkeleton"] = {
        "structureSkeletonVersion": 3,
        "analysisId": "analysis",
        "openingCandidates": [],
        "dimensionCandidates": [],
    }
    store.update(task["id"], generation=generation)
    draft = {
        "id": "draft",
        "revision": 2,
        "hash": "a" * 64,
        "data": {
            "rooms": [
                {
                    "id": "living",
                    "name": "Living Room",
                    "functionalArea": "living",
                }
            ],
            "targetRoomIds": ["living"],
            "uncertainties": [
                {
                    "id": "u_room_label",
                    "message": "Living Room 与厨房是否为同一区域",
                    "blocking": True,
                    "code": "ROOM_SCOPE_OPEN_KITCHEN",
                },
                {
                    "id": "u_wall_geometry",
                    "message": "墙体几何待确认",
                    "blocking": True,
                    "code": "WALL_GEOMETRY",
                },
            ],
        },
    }
    diagnostics = {
        "id": "diagnostic",
        "checks": {
            "passed": False,
            "issues": [
                {
                    "code": "FLOORPLAN_UNCERTAIN",
                    "blocking": True,
                    "message": "uncertain",
                }
            ],
        },
    }
    requests = []

    class Client:
        async def request(self, path, body=None):
            requests.append((path, body))
            if path.endswith("/measurement-updates"):
                assert body["commands"] == [
                    {
                        "type": "patch",
                        "collection": "uncertainties",
                        "id": "u_room_label",
                        "patch": {"blocking": False},
                    }
                ]
                return {
                    **draft,
                    "revision": 3,
                    "hash": "b" * 64,
                    "data": {
                        **draft["data"],
                        "uncertainties": [
                            {
                                **draft["data"]["uncertainties"][0],
                                "blocking": False,
                            },
                            draft["data"]["uncertainties"][1],
                        ],
                    },
                }
            if path.endswith("/diagnostics"):
                return {**diagnostics, "checks": {"passed": True, "issues": []}}
            raise AssertionError(path)

    client = Client()
    helper = FloorplanV3(store, client, object())
    updated, checks = await helper.reconcile_code_uncertainties(
        store.task(task["id"], internal=True),
        "/projects/project/floorplan-drafts",
        draft,
        diagnostics,
    )
    assert updated["revision"] == 3
    assert updated["data"]["uncertainties"][0]["blocking"] is False
    assert updated["data"]["uncertainties"][1]["blocking"] is True
    assert checks["checks"]["passed"] is True
    assert any(
        event["kind"] == "code_uncertainties_resolved"
        and event["data"]["uncertaintyIds"] == ["u_room_label"]
        for event in store.events(task["id"])
    )
    store.close()


def test_vision_parser_and_contour_ownership_reject_duplicate_symbols():
    parsed = _parse_structured_content(
        '```json\n{"status":"draft","question":"","symbols":[]}\n```'
    )
    assert parsed["status"] == "draft"
    draft = {"data": {"targetRoomIds": ["living"]}}
    candidates = [
        {
            "candidateId": "fc_001",
            "bbox": [10, 10, 20, 20],
            "center": {"x": 20, "y": 20},
        }
    ]
    value = {
        "status": "draft",
        "symbols": [
            {
                "id": "table",
                "roomId": "living",
                "categoryCode": "diningTable",
                "sourceLabel": "table",
                "included": True,
                "contourCandidateIds": ["fc_001"],
                "rot": 0,
            },
            {
                "id": "chair",
                "roomId": "living",
                "categoryCode": "chair",
                "sourceLabel": "chair",
                "included": True,
                "contourCandidateIds": ["fc_001"],
                "rot": 0,
            },
        ],
    }
    with pytest.raises(TaskError, match="重复使用"):
        _assemble_contour_symbols(value, candidates, draft, "contours")
    nested = {
        "status": "draft",
        "symbols": [
            {
                "id": "sofa",
                "roomId": "living",
                "categoryCode": "sofa",
                "sourceLabel": "sofa",
                "included": True,
                "contourCandidateIds": ["sofa_outer"],
                "rot": 0,
            },
            {
                "id": "cushion",
                "roomId": "living",
                "categoryCode": "chair",
                "sourceLabel": "chair",
                "included": True,
                "contourCandidateIds": ["cushion"],
                "rot": 0,
            },
        ],
    }
    nested_candidates = [
        {"candidateId": "sofa_outer", "bbox": [0, 0, 100, 60]},
        {"candidateId": "cushion", "bbox": [40, 20, 20, 20]},
    ]
    with pytest.raises(TaskError, match="吞入.*独立座椅"):
        _assemble_contour_symbols(nested, nested_candidates, draft, "contours")


def test_v35_object_graph_splits_sofa_rug_and_dining_chairs():
    raw = [
        ("fc_010", [453, 194, 132, 133]),
        ("fc_011", [468, 195, 103, 8]),
        ("fc_012", [459, 198, 12, 42]),
        ("fc_013", [568, 198, 11, 42]),
        ("fc_014", [474, 199, 30, 34]),
        ("fc_015", [505, 199, 30, 34]),
        ("fc_016", [537, 199, 30, 34]),
        ("fc_017", [471, 234, 97, 6]),
        ("fc_018", [459, 239, 12, 8]),
        ("fc_019", [470, 239, 98, 8]),
        ("fc_020", [568, 239, 11, 8]),
        ("fc_022", [462, 249, 114, 73]),
        ("fc_025", [487, 278, 64, 36]),
        ("fc_026", [492, 282, 55, 27]),
        ("fc_036", [466, 358, 118, 84]),
        ("fc_037", [494, 365, 23, 13]),
        ("fc_038", [533, 365, 23, 13]),
        ("fc_039", [480, 378, 90, 50]),
        ("fc_041", [467, 392, 13, 22]),
        ("fc_042", [570, 392, 13, 22]),
        ("fc_044", [494, 428, 23, 13]),
        ("fc_045", [533, 428, 23, 13]),
        ("fc_023", [627, 272, 22, 70]),
        ("fc_024", [628, 273, 20, 17]),
        ("fc_027", [628, 290, 20, 17]),
        ("fc_028", [628, 307, 20, 17]),
        ("fc_029", [628, 324, 20, 17]),
        ("fc_001", [633, 129, 27, 28]),
        ("fc_002", [642, 130, 10, 11]),
        ("fc_003", [634, 133, 12, 9]),
        ("fc_004", [649, 133, 10, 12]),
        ("fc_006", [634, 141, 10, 12]),
        ("fc_007", [647, 144, 12, 9]),
        ("fc_008", [641, 145, 11, 11]),
    ]
    candidates = [
        {
            "candidateId": candidate_id,
            "bbox": bbox,
            "area": bbox[2] * bbox[3],
            "shape": "contour",
        }
        for candidate_id, bbox in raw
    ]
    graph = furniture_object_candidates(candidates)
    by_members = {
        tuple(candidate["contourCandidateIds"]): candidate
        for candidate in graph["objectCandidates"]
    }
    sofa = by_members[tuple(f"fc_{index:03d}" for index in range(11, 21))]
    assert sofa["kind"] == "composite"
    assert sofa["bbox"] == [459, 195, 120, 52]
    assert ("fc_022",) in by_members
    assert by_members[("fc_025", "fc_026")]["kind"] == "composite"
    group = graph["activityGroupCandidates"][0]
    assert by_members[("fc_039",)]["objectCandidateId"] in group["primaryObjectCandidateIds"]
    assert len(group["satelliteObjectCandidateIds"]) == 6


def activity_object_graph():
    raw = [
        ("fc_000", [70, 90, 160, 170]),
        ("fc_001", [90, 140, 120, 70]),
        ("fc_002", [100, 110, 23, 13]),
        ("fc_003", [177, 110, 23, 13]),
        ("fc_004", [75, 165, 13, 22]),
        ("fc_005", [212, 165, 13, 22]),
        ("fc_006", [100, 225, 23, 13]),
        ("fc_007", [177, 225, 23, 13]),
    ]
    candidates = [
        {
            "candidateId": candidate_id,
            "bbox": bbox,
            "area": bbox[2] * bbox[3],
            "shape": "contour",
        }
        for candidate_id, bbox in raw
    ]
    return candidates, furniture_object_candidates(candidates)


def activity_response(group_members):
    graph = activity_object_graph()[1]
    table = next(
        candidate
        for candidate in graph["objectCandidates"]
        if candidate["contourCandidateIds"] == ["fc_001"]
    )
    chairs = [candidate for candidate in graph["objectCandidates"] if candidate is not table]
    symbols = [
        {
            "id": "table",
            "roomId": "living",
            "categoryCode": "diningTable",
            "sourceLabel": "table",
            "included": True,
            "objectCandidateId": table["objectCandidateId"],
            "rot": 0,
        },
        *[
            {
                "id": f"chair-{index}",
                "roomId": "living",
                "categoryCode": "chair",
                "sourceLabel": "chair",
                "included": True,
                "objectCandidateId": candidate["objectCandidateId"],
                "rot": 0,
            }
            for index, candidate in enumerate(chairs, 1)
        ],
    ]
    members = [f"chair-{index}" for index in group_members]
    return {
        "status": "draft",
        "question": "",
        "symbols": symbols,
        "activityGroups": [
            {
                "id": "ag-dining",
                "candidateId": graph["activityGroupCandidates"][0]["activityGroupCandidateId"],
                "type": "group_seated",
                "primarySymbolId": "table",
                "memberSymbolIds": members,
                "roles": {
                    "table": "primary",
                    **{f"chair-{index}": "satellite" for index in group_members},
                },
            }
        ],
    }


def test_v35_activity_assembly_requires_every_group_satellite():
    _, graph = activity_object_graph()
    assert graph["activityGroupCandidates"]
    draft = {"data": {"targetRoomIds": ["living"]}}
    with pytest.raises(TaskError) as raised:
        _assemble_activity_symbols(
            activity_response([1, 2, 3, 4]),
            graph["objectCandidates"],
            graph["activityGroupCandidates"],
            draft,
            "objects",
        )
    assert raised.value.code == "ACTIVITY_GROUP_INCOMPLETE"
    symbols, groups = _assemble_activity_symbols(
        activity_response([1, 2, 3, 4, 5, 6]),
        graph["objectCandidates"],
        graph["activityGroupCandidates"],
        draft,
        "objects",
    )
    assert len([symbol for symbol in symbols if symbol["categoryCode"] == "chair"]) == 6
    assert groups[0]["type"] == "group_seated"
    assert groups[0]["roles"]["table"] == "primary"
    FurnitureActivityRecognition.model_validate(activity_response([1, 2, 3, 4, 5, 6]))


def activity_vision_fixture(tmp_path):
    image = {"id": "image", "sha256": "a" * 64, "width": 800, "height": 600}
    store = TaskStore(tmp_path)
    conversation = store.create_conversation("project")
    task = store.create_task(
        conversation["id"],
        {
            "requestId": "activity-vision",
            "input": "复现客餐厅家具",
            "mode": "reconstruct_floorplan",
            "imageId": image["id"],
        },
    )
    generation = store.task(task["id"], internal=True)["generation"]
    generation.update(workflowVersion=3, floorplanVersion="s2c-floorplan-v3-5")
    store.update(task["id"], generation=generation)
    raw_candidates, graph = activity_object_graph()
    draft = {
        "id": "draft",
        "data": {
            "targetRoomIds": ["living"],
            "rooms": [
                {
                    "id": "living",
                    "name": "客餐厅",
                    "at": {"x": 150, "y": 175},
                    "width": 200,
                    "depth": 200,
                }
            ],
            "walls": [],
            "openings": [],
            "uncertainties": [],
        },
    }
    record = {
        "id": "objects",
        "contourCandidates": raw_candidates,
        "objectCandidates": graph["objectCandidates"],
        "activityGroupCandidates": graph["activityGroupCandidates"],
        "targetRegions": {"living": {"bbox": [0, 0, 300, 300], "pixels": 90000}},
        "files": [],
    }
    raw = {
        "candidates.png": b"candidates",
        "objects.png": b"objects",
        "groups.png": b"groups",
    }
    evidence = {
        "evidence": [
            {
                "files": [
                    {
                        "name": name,
                        "path": "/" + name,
                        "sha256": hashlib.sha256(content).hexdigest(),
                    }
                    for name, content in raw.items()
                ]
            }
        ]
    }

    class Evidence:
        async def context(self):
            return evidence

    class Client:
        async def image(self, path):
            if path.endswith("/file"):
                return b"original"
            return raw[path.lstrip("/")]

    class Base:
        pass

    client = Client()
    base = Base()
    base.store, base.client = store, client
    return store, task, image, draft, record, Evidence(), client, base


@pytest.mark.asyncio
async def test_v35_vision_uses_object_and_group_images(tmp_path, monkeypatch):
    store, task, image, draft, record, evidence, client, base = activity_vision_fixture(tmp_path)
    captured = {}

    async def fake_context(self, *_args):
        return evidence, None

    async def fake_request(self, mode, parameters):
        assert mode == "contours"
        assert parameters == {"spec": draft["data"]}
        return record

    async def fake_result(self, name, value, pictures=True):
        assert name == "furniture_contours"
        assert value is record
        assert pictures is False
        return []

    async def fake_complete(self, prompt, payload, images, schema, **kwargs):
        captured.update(
            {
                "prompt": prompt,
                "payload": payload,
                "images": images,
                "schema": schema,
            }
        )
        return {
            "content": json.dumps(activity_response([1, 2, 3, 4, 5, 6])),
            "model": "controlled-vision",
            "usage": {"prompt_tokens": 10, "completion_tokens": 20},
            "seconds": 0.25,
            "structuredMode": "json_schema",
        }

    monkeypatch.setattr(FloorplanV3, "context", fake_context)
    monkeypatch.setattr(FloorplanToolset, "request", fake_request)
    monkeypatch.setattr(FloorplanToolset, "result", fake_result)
    monkeypatch.setattr(VisionModelClient, "complete", fake_complete)

    helper = FloorplanV3(store, client, base)
    symbols, groups = await helper.recognize_furniture_activity(
        store.task(task["id"], internal=True), image, draft, {"files": []}
    )
    assert len(captured["images"]) == 4
    assert captured["payload"]["objectCandidates"] == record["objectCandidates"]
    assert captured["schema"]["properties"]["symbols"]["minItems"] == 7
    assert captured["schema"]["properties"]["symbols"]["maxItems"] == 7
    assert {"symbols", "activityGroups"}.issubset(set(captured["schema"]["required"]))
    assert len(symbols) == 7
    assert len(groups) == 1
    saved = store.task(task["id"], internal=True)["generation"]
    assert saved["furnitureModel"]["configVersion"] == "activity-unit-1"
    assert saved["furnitureModel"]["modelCalls"] == 1
    assert saved["phase"] == "recognizing_furniture"
    store.close()


@pytest.mark.asyncio
async def test_vision_furniture_uses_four_images_and_records_budget_metadata(tmp_path, monkeypatch):
    store, task, image, draft, record, evidence, client, base = vision_recognition_fixture(tmp_path)
    monkeypatch.setenv("ACTISCAPE_VISION_MODEL", "controlled-vision")
    for _ in range(23):
        store.count_model_call(task["id"], "setup")
    captured = {}

    async def fake_context(self, *_args):
        return evidence, None

    async def fake_request(self, mode, parameters):
        assert mode == "contours"
        assert parameters == {"spec": draft["data"]}
        return record

    async def fake_result(self, name, value, pictures=True):
        assert name == "furniture_contours"
        assert value is record
        assert pictures is False
        return []

    async def fake_complete(self, prompt, payload, images, schema, **kwargs):
        captured.update(
            {
                "images": images,
                "payload": payload,
                "schema": schema,
                "kwargs": kwargs,
            }
        )
        return vision_response(vision_symbol())

    monkeypatch.setattr(FloorplanV3, "context", fake_context)
    monkeypatch.setattr(FloorplanToolset, "request", fake_request)
    monkeypatch.setattr(FloorplanToolset, "result", fake_result)
    monkeypatch.setattr(VisionModelClient, "complete", fake_complete)

    helper = FloorplanV3(store, client, base)
    symbols = await helper.recognize_furniture_vision(
        store.task(task["id"], internal=True), image, draft, {"files": []}
    )
    assert len(captured["images"]) == 4
    assert captured["payload"]["contourCandidates"] == record["contourCandidates"]
    assert captured["kwargs"] == {"previous": None, "parse_error": None}
    assert symbols[0]["id"] == "chair"
    assert symbols[0]["categoryCode"] == "chair"
    saved = store.task(task["id"], internal=True)
    assert saved["modelCalls"] == 24
    assert saved["generation"]["furnitureModel"]["modelCalls"] == 1
    assert saved["generation"]["furnitureModel"]["status"] == "completed"
    assert saved["generation"]["furnitureModel"]["model"] == "controlled-vision"
    store.close()


@pytest.mark.asyncio
async def test_vision_furniture_retries_contour_ownership_once(tmp_path, monkeypatch):
    store, task, image, draft, record, evidence, client, base = vision_recognition_fixture(tmp_path)
    responses = [
        vision_response(
            vision_symbol("fc_001", "chair-a"),
            vision_symbol("fc_001", "chair-b"),
        ),
        vision_response(vision_symbol()),
    ]
    calls = []

    async def fake_context(self, *_args):
        return evidence, None

    async def fake_request(self, *_args):
        return record

    async def fake_result(self, *_args, **_kwargs):
        return []

    async def fake_complete(self, prompt, payload, images, schema, **kwargs):
        calls.append(kwargs)
        return responses[len(calls) - 1]

    monkeypatch.setattr(FloorplanV3, "context", fake_context)
    monkeypatch.setattr(FloorplanToolset, "request", fake_request)
    monkeypatch.setattr(FloorplanToolset, "result", fake_result)
    monkeypatch.setattr(VisionModelClient, "complete", fake_complete)

    helper = FloorplanV3(store, client, base)
    symbols = await helper.recognize_furniture_vision(
        store.task(task["id"], internal=True), image, draft, {"files": []}
    )
    assert [symbol["id"] for symbol in symbols] == ["chair"]
    assert len(calls) == 2
    assert calls[1]["previous"] == responses[0]["content"]
    assert "重复使用" in calls[1]["parse_error"]
    saved = store.task(task["id"], internal=True)
    assert saved["modelCalls"] == 2
    assert len(saved["generation"]["furnitureVisionAttempts"]) == 2
    assert saved["generation"]["furnitureModel"]["modelCalls"] == 2
    store.close()


@pytest.mark.asyncio
async def test_vision_furniture_retries_missing_response_envelope_once(tmp_path, monkeypatch):
    store, task, image, draft, record, evidence, client, base = vision_recognition_fixture(tmp_path)
    calls = []

    async def fake_context(self, *_args):
        return evidence, None

    async def fake_request(self, *_args):
        return record

    async def fake_result(self, *_args, **_kwargs):
        return []

    async def fake_complete(self, *args, **kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            raise VisionModelFailure(
                "VISION_MODEL_FORMAT",
                "视觉模型返回缺少结构化正文",
                {"model": "controlled-vision", "seconds": 0.5},
            )
        return vision_response(vision_symbol())

    monkeypatch.setattr(FloorplanV3, "context", fake_context)
    monkeypatch.setattr(FloorplanToolset, "request", fake_request)
    monkeypatch.setattr(FloorplanToolset, "result", fake_result)
    monkeypatch.setattr(VisionModelClient, "complete", fake_complete)

    helper = FloorplanV3(store, client, base)
    symbols = await helper.recognize_furniture_vision(
        store.task(task["id"], internal=True), image, draft, {"files": []}
    )
    assert symbols[0]["id"] == "chair"
    assert len(calls) == 2
    saved = store.task(task["id"], internal=True)
    assert saved["modelCalls"] == 2
    assert saved["generation"]["furnitureVisionAttempts"][0]["errorCode"] == ("VISION_MODEL_FORMAT")
    assert saved["generation"]["furnitureModel"]["modelCalls"] == 2
    assert saved["generation"]["furnitureModel"]["status"] == "completed"
    store.close()


@pytest.mark.asyncio
async def test_vision_furniture_rejects_free_coordinates_after_one_repair(tmp_path, monkeypatch):
    store, task, image, draft, record, evidence, client, base = vision_recognition_fixture(tmp_path)
    invalid = vision_symbol()
    invalid["x"] = 10
    responses = [vision_response(invalid), vision_response(invalid)]
    calls = []

    async def fake_context(self, *_args):
        return evidence, None

    async def fake_request(self, *_args):
        return record

    async def fake_result(self, *_args, **_kwargs):
        return []

    async def fake_complete(self, *args, **kwargs):
        calls.append(kwargs)
        return responses[len(calls) - 1]

    monkeypatch.setattr(FloorplanV3, "context", fake_context)
    monkeypatch.setattr(FloorplanToolset, "request", fake_request)
    monkeypatch.setattr(FloorplanToolset, "result", fake_result)
    monkeypatch.setattr(VisionModelClient, "complete", fake_complete)

    helper = FloorplanV3(store, client, base)
    with pytest.raises(TaskError, match="合法家具结构"):
        await helper.recognize_furniture_vision(
            store.task(task["id"], internal=True), image, draft, {"files": []}
        )
    assert len(calls) == 2
    saved = store.task(task["id"], internal=True)
    assert saved["modelCalls"] == 2
    assert saved["generation"]["furnitureModel"]["status"] == "format_failed"
    store.close()


def test_mixed_orientation_candidates_are_rejected_offline():
    image = {"id": "image", "sha256": "a" * 64, "width": 400, "height": 300}
    skeleton = build_structure_skeleton(analysis_record(), image)
    value = structure_response()
    value["walls"][0]["candidateWallIds"] = ["cw_0_1"]
    value["walls"][0]["customSegments"] = [
        {"cropId": "crop", "kind": "V", "c": 200, "p0": 10, "p1": 290}
    ]
    with pytest.raises(TaskError, match="混合了水平和竖直候选"):
        _assemble_structure(skeleton, value, {"crop": {"id": "crop"}})


def test_opening_outside_wall_range_is_rejected_offline():
    image = {"id": "image", "sha256": "a" * 64, "width": 400, "height": 300}
    skeleton = build_structure_skeleton(analysis_record(), image)
    value = structure_response()
    skeleton["gaps"][0]["s1"] = 500
    with pytest.raises(TaskError, match="超出所属墙范围"):
        _assemble_structure(skeleton, value, {})


def test_opening_requires_both_gap_sides_in_one_business_wall():
    image = {"id": "image", "sha256": "a" * 64, "width": 400, "height": 300}
    skeleton = build_structure_skeleton(analysis_record(), image)
    value = structure_response()
    value["walls"][0] = {
        "id": "north",
        "candidateWallIds": [],
        "customSegments": [{"cropId": "crop", "kind": "H", "c": 10, "p0": 0, "p1": 400}],
    }
    with pytest.raises(TaskError, match="两侧候选墙未被同一业务墙选中"):
        _assemble_structure(skeleton, value, {"crop": {"id": "crop"}})


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


@pytest.mark.asyncio
@pytest.mark.parametrize("repair_succeeds", [True, False])
async def test_structure_repair_is_bounded_and_persisted(tmp_path, repair_succeeds):
    image = {
        "id": "image",
        "sha256": "a" * 64,
        "width": 400,
        "height": 300,
    }
    skeleton = build_structure_skeleton(analysis_record(), image)
    store = TaskStore(tmp_path)
    conversation = store.create_conversation("project")
    task = store.create_task(
        conversation["id"],
        {
            "requestId": "repair",
            "input": "test",
            "mode": "reconstruct_floorplan",
            "imageId": image["id"],
        },
    )
    generation = store.task(task["id"], internal=True)["generation"]
    generation.update(
        workflowVersion=3,
        skillSnapshot={},
        upstreamTools=[
            {
                "role": "main",
                "tool": "analyze_floorplan",
                "record": {
                    "id": skeleton["analysisId"],
                    "result": analysis_record()["result"],
                    "files": [],
                },
            }
        ],
        evidenceIndex={},
    )
    store.update(task["id"], generation=generation)

    invalid = structure_response()
    invalid["walls"][0]["candidateWallIds"] = ["cw_missing"]
    calls = []

    class Base:
        async def invoke(self, role, prompt, schema, tools, payload, task_id, images, **kwargs):
            store.count_model_call(task_id, role)
            calls.append((prompt, payload))
            if len(calls) == 1 or not repair_succeeds:
                return invalid
            return structure_response()

    class Client:
        async def image(self, path):
            assert path.endswith("/file")
            return b"\x89PNG"

    client = Client()
    base = Base()
    base.store, base.client = store, client
    helper = FloorplanV3(store, client, base)
    if repair_succeeds:
        result = await helper.recognize_structure(
            store.task(task["id"], internal=True), image, skeleton
        )
        assert result["walls"][0]["id"] == "north"
        saved = store.task(task["id"], internal=True)["generation"]
        assert saved["structureRepairAttempts"] == 1
        assert len(saved["structureAttempts"]) == 2
        assert len(calls) == 2
        assert calls[1][1]["errorCode"] == "UNKNOWN_WALL_GROUP"
    else:
        with pytest.raises(TaskError, match="未知候选墙"):
            await helper.recognize_structure(store.task(task["id"], internal=True), image, skeleton)
        saved = store.task(task["id"], internal=True)["generation"]
        assert saved["structureRepairAttempts"] == 1
        assert len(saved["structureErrors"]) == 2
        assert len(calls) == 2
    assert store.task(task["id"])["modelCalls"] == 2
    store.close()


@pytest.mark.asyncio
async def test_structure_repair_resumes_from_pending_first_result(tmp_path):
    image = {"id": "image", "sha256": "a" * 64, "width": 400, "height": 300}
    skeleton = build_structure_skeleton(analysis_record(), image)
    store = TaskStore(tmp_path)
    conversation = store.create_conversation("project")
    task = store.create_task(
        conversation["id"],
        {
            "requestId": "repair-resume",
            "input": "test",
            "mode": "reconstruct_floorplan",
            "imageId": image["id"],
        },
    )
    invalid = structure_response()
    invalid["walls"][0]["candidateWallIds"] = ["cw_missing"]
    generation = store.task(task["id"], internal=True)["generation"]
    generation.update(
        workflowVersion=3,
        skillSnapshot={},
        upstreamTools=[
            {
                "role": "main",
                "tool": "analyze_floorplan",
                "record": {
                    "id": skeleton["analysisId"],
                    "result": analysis_record()["result"],
                    "files": [],
                },
            }
        ],
        evidenceIndex={},
        structureSkeleton=skeleton,
        structureAttempts=[invalid],
        pendingStructure=invalid,
        structureRepairAttempts=1,
        structureErrors=[
            {
                "code": "UNKNOWN_WALL_GROUP",
                "message": "墙 north 引用了未知候选墙 cw_missing",
                "skeletonVersion": 2,
            }
        ],
    )
    store.update(task["id"], generation=generation)
    prompts = []

    class Base:
        async def invoke(self, role, prompt, schema, tools, payload, task_id, images, **kwargs):
            store.count_model_call(task_id, role)
            prompts.append(prompt)
            return structure_response()

    class Client:
        async def image(self, _path):
            return b"\x89PNG"

    client = Client()
    base = Base()
    base.store, base.client = store, client
    result = await FloorplanV3(store, client, base).recognize_structure(
        store.task(task["id"], internal=True), image, skeleton
    )
    assert result["walls"][0]["id"] == "north"
    assert len(prompts) == 1
    assert "上一轮结构结果无法由固定代码组装" in prompts[0]
    saved = store.task(task["id"], internal=True)["generation"]
    assert len(saved["structureAttempts"]) == 2
    assert saved["structureRepairResponse"] is None
    assert store.task(task["id"])["modelCalls"] == 1
    store.close()


@pytest.mark.asyncio
async def test_manual_recheck_binds_current_hash_and_is_idempotent(tmp_path, monkeypatch):
    draft = {
        "id": "draft",
        "revision": 2,
        "hash": "b" * 64,
        "data": {
            "measurementVersion": 2,
            "image": {"id": "image", "sha256": "a" * 64, "width": 400, "height": 300},
        },
        "sourceReview": None,
    }
    request_log = []

    class Client:
        async def request(self, path, body=None):
            request_log.append((path, body))
            if path.endswith("/floorplan-drafts/draft") and body is None:
                return {**draft}
            if path.endswith("/floorplan-images/image"):
                return {**draft["data"]["image"]}
            if path.endswith("/diagnostics"):
                return {"id": "diagnostic", "files": [], "checks": {"passed": True}}
            if path.endswith("/review"):
                return {
                    **draft,
                    "sourceReview": {
                        "hash": body["draftHash"],
                        "review": body["review"],
                    },
                }
            raise AssertionError(path)

    client = Client()
    manager = TaskManager(tmp_path, client=client)
    conversation = manager.store.create_conversation("project")
    task = manager.store.create_task(
        conversation["id"],
        {
            "requestId": "recheck-create",
            "input": "test",
            "mode": "reconstruct_floorplan",
            "imageId": "image",
        },
    )
    generation = manager.store.task(task["id"], internal=True)["generation"]
    generation.update(draftId="draft", imageId="image", workflowVersion=3)
    manager.store.update(
        task["id"],
        status="waiting_input",
        generation=generation,
        result={"status": "waiting_input", "draftId": "draft"},
    )

    async def review(*_args, **_kwargs):
        return {"passed": True, "summary": "controlled", "issues": []}

    monkeypatch.setattr(FloorplanV3, "review", review)
    body = {
        "requestId": "recheck-request",
        "draftId": "draft",
        "draftRevision": 2,
        "draftHash": "b" * 64,
    }
    result = await manager.recheck_floorplan(task["id"], body)
    assert result["status"] == "waiting_input"
    assert result["result"]["report"]["passed"]
    saved = manager.store.task(task["id"], internal=True)
    assert saved["generation"]["floorplan"]["sourceReview"]["hash"] == "b" * 64
    assert len(saved["generation"]["manualRechecks"]) == 1
    before = len(request_log)
    replay = await manager.recheck_floorplan(task["id"], body)
    assert replay["status"] == "waiting_input"
    assert len(request_log) == before
    manager.store.close()
