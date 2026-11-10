import json
from pathlib import Path

import pytest

from actiscape_agent.floorplan_schemas import (
    CategoryCode,
    FurnitureActivityRecognition,
    StructureSelectionV42,
)
from actiscape_agent.floorplan_v3 import (
    _assemble_activity_symbols,
    _consolidate_open_room_labels,
    _normalize_v4_rooms,
    _v4_target_room_ids,
)
from actiscape_agent.floorplan_v4 import FloorplanV4
from actiscape_agent.floorplan_v4_2 import FloorplanV42
from actiscape_agent.scene_registry import get_scene_registry
from actiscape_agent.store import TaskError, TaskStore

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = json.loads((ROOT / "fixtures/s2c-synthetic.floorplan.json").read_text())


def reconstruct_task(tmp_path):
    store = TaskStore(tmp_path)
    conversation = store.create_conversation("project")
    task = store.create_task(
        conversation["id"],
        {
            "requestId": "whole-home-v4",
            "input": "按原图复现整层住宅和全部可见家具",
            "mode": "reconstruct_floorplan",
            "imageId": "image",
        },
    )
    return store, task


def test_new_floorplan_tasks_pin_v4_and_geometry_only_policy(tmp_path):
    store, task = reconstruct_task(tmp_path)
    try:
        generation = store.task(task["id"], internal=True)["generation"]
        assert generation == {
            "imageId": "image",
            "phase": "recognizing",
            "workflowVersion": 4,
            "recognitionVersion": 4,
            "floorplanVersion": "s2c-floorplan-v4-2",
            "candidatePolicyVersion": "geometry-only",
            "floorplanScope": {
                "roomSelection": "all_visible",
                "functionalAreas": [],
                "excludeFunctionalAreas": [],
            },
        }
    finally:
        store.close()


def test_floorplan_category_enum_contains_the_scene_registry_catalogue():
    registry_categories = {
        category["id"]
        for category in get_scene_registry().public_categories()
        if category["catalogKeys"]
    }
    assert registry_categories <= set(CategoryCode.__args__)


def test_floorplan_scope_is_pinned_on_task_creation(tmp_path):
    store = TaskStore(tmp_path)
    try:
        conversation = store.create_conversation("project")
        task = store.create_task(
            conversation["id"],
            {
                "requestId": "whole-home-scope",
                "input": "只复现卧室和卫浴家具",
                "mode": "reconstruct_floorplan",
                "imageId": "image",
                "floorplanScope": {
                    "roomSelection": "functional_areas",
                    "functionalAreas": ["bedroom", "bathroom"],
                    "excludeFunctionalAreas": [],
                },
            },
        )
        assert store.task(task["id"], internal=True)["generation"][
            "floorplanScope"
        ] == {
            "roomSelection": "functional_areas",
            "functionalAreas": ["bedroom", "bathroom"],
            "excludeFunctionalAreas": [],
        }
    finally:
        store.close()


def test_v4_prompts_cover_whole_home_without_legacy_living_room_scope():
    helper = object.__new__(FloorplanV4)
    structure = helper.prompt("STRUCTURE", None)
    furniture = helper.prompt("VISION_ACTIVITY", None)
    assert "不因房间是卧室、厨房、卫生间" in structure
    assert "geometry-only" in furniture
    assert "群组" not in structure
    assert "不输出 chain-of-thought" in structure


def test_v4_2_uses_dedicated_structure_role_without_free_anchors():
    helper = object.__new__(FloorplanV42)
    structure = helper.prompt("STRUCTURE", None)
    assert helper.recognition_role(None) == "structure"
    assert helper.measurement_role(None) == "structure"
    assert helper.structure_schema(None) is StructureSelectionV42
    assert "只选择 structureSkeleton.candidateWalls" in structure
    assert "不要返回 anchors" in structure


def test_v4_room_normalization_preserves_bedroom_and_kitchen_labels():
    walls = FIXTURE["walls"]
    rooms = [
        {"id": "living", "name": "客餐厅", "at": {"x": 350, "y": 550}},
        {
            "id": "bedroom",
            "name": "主卧",
            "roomType": "master_bedroom",
            "at": {"x": 800, "y": 250},
        },
        {
            "id": "kitchen",
            "name": "厨房",
            "roomType": "kitchen",
            "at": {"x": 800, "y": 550},
        },
    ]
    normalized, targets, _notes = _consolidate_open_room_labels(
        walls,
        rooms,
        ["living", "bedroom", "kitchen"],
        1000,
        800,
        whole_home=True,
    )
    normalized = _normalize_v4_rooms(normalized)
    assert {room["name"] for room in normalized} == {"客餐厅", "主卧", "厨房"}
    assert set(targets) == {"living", "bedroom", "kitchen"}
    assert next(room for room in normalized if room["id"] == "bedroom")[
        "roomType"
    ] == "master_bedroom"
    assert next(room for room in normalized if room["id"] == "bedroom")[
        "functionalArea"
    ] == "bedroom"
    assert next(room for room in normalized if room["id"] == "kitchen")[
        "functionalArea"
    ] == "kitchen"
    assert _v4_target_room_ids(
        normalized,
        {
            "roomSelection": "functional_areas",
            "functionalAreas": ["bedroom", "kitchen"],
            "excludeFunctionalAreas": ["kitchen"],
        },
    ) == ["bedroom"]
    assert _v4_target_room_ids(
        normalized,
        {
            "roomSelection": "all_visible",
            "functionalAreas": [],
            "excludeFunctionalAreas": ["other"],
        },
        ) == ["living", "bedroom", "kitchen"]


def activity_objects():
    def candidate(object_id, room_id, bbox):
        return {
            "objectCandidateId": object_id,
            "bbox": bbox,
            "kind": "atomic",
            "roomIds": [room_id],
            "categoryHints": [],
            "contextTags": [],
            "containsObjectCandidateIds": [],
            "containedByObjectCandidateIds": [],
            "selectable": True,
            "requiredForCoverage": True,
        }

    return [
        candidate("fo_bed", "bedroom", [10, 10, 120, 90]),
        candidate("fo_ns1", "bedroom", [2, 12, 18, 18]),
        candidate("fo_ns2", "bedroom", [120, 12, 18, 18]),
    ]


def activity_value(room_id="bedroom"):
    return {
        "status": "draft",
        "question": "",
        "symbols": [
            {
                "id": "bed",
                "roomId": room_id,
                "categoryCode": "bed",
                "sourceLabel": "双人床",
                "functionalArea": "bedroom",
                "objectCandidateId": "fo_bed",
                "rot": 0,
            },
            {
                "id": "ns1",
                "roomId": room_id,
                "categoryCode": "nightstand",
                "sourceLabel": "床头柜",
                "functionalArea": "bedroom",
                "objectCandidateId": "fo_ns1",
                "rot": 0,
            },
            {
                "id": "ns2",
                "roomId": room_id,
                "categoryCode": "nightstand",
                "sourceLabel": "床头柜",
                "functionalArea": "bedroom",
                "objectCandidateId": "fo_ns2",
                "rot": 0,
            },
        ],
        "activityGroups": [
            {
                "id": "sleep-1",
                "candidateId": "agc_000",
                "type": "group_sleep",
                "primarySymbolId": "bed",
                "memberSymbolIds": ["bed", "ns1", "ns2"],
                "roles": {"bed": "primary", "ns1": "satellite", "ns2": "satellite"},
                "excludedObjectCandidateIds": [],
                "exclusionReasons": {},
            }
        ],
        "excludedObjectCandidates": [],
    }


def test_v4_activity_group_can_model_bed_and_nightstands():
    objects = activity_objects()
    groups = [
        {
            "activityGroupCandidateId": "agc_000",
            "kind": "radial_cluster",
            "primaryObjectCandidateIds": ["fo_bed"],
            "satelliteObjectCandidateIds": ["fo_ns1", "fo_ns2"],
        }
    ]
    draft = {
        "data": {
            "targetRoomIds": ["bedroom"],
            "rooms": [
                {
                    "id": "bedroom",
                    "name": "卧室",
                    "functionalArea": "bedroom",
                    "at": {"x": 60, "y": 60},
                }
            ],
            "walls": [],
            "candidatePolicyVersion": "geometry-only",
        }
    }
    value = FurnitureActivityRecognition.model_validate(activity_value()).model_dump(
        exclude_none=True, by_alias=True
    )
    symbols, saved = _assemble_activity_symbols(
        value, objects, groups, draft, "objects"
    )
    assert {symbol["categoryCode"] for symbol in symbols} == {
        "bed",
        "nightstand",
    }
    assert saved[0]["type"] == "group_sleep"

    wrong = activity_value(room_id="living")
    wrong = FurnitureActivityRecognition.model_validate(wrong).model_dump(
        exclude_none=True, by_alias=True
    )
    with pytest.raises(TaskError, match="房间"):
        _assemble_activity_symbols(wrong, objects, groups, draft, "objects")


def test_v4_room_normalization_keeps_functional_area_when_type_is_missing():
    normalized = _normalize_v4_rooms(
        [
            {
                "id": "bed",
                "name": "卧室",
                "functionalArea": "bedroom",
                "at": {"x": 300, "y": 300},
            },
            {
                "id": "hall",
                "name": "过道",
                "functionalArea": "circulation",
                "at": {"x": 500, "y": 300},
            },
        ]
    )
    assert next(room for room in normalized if room["id"] == "bed")[
        "roomType"
    ] == "guest_bedroom"
    assert next(room for room in normalized if room["id"] == "bed")[
        "functionalArea"
    ] == "bedroom"
    assert next(room for room in normalized if room["id"] == "hall")[
        "roomType"
    ] == "circulation"
