import asyncio
import json
import shutil
from pathlib import Path

import pytest
from pydantic import ValidationError

from actiscape_agent.generation_schemas import resolve_request
from actiscape_agent.scene_contracts import (
    EvidenceGraph,
    IntentSpec,
    SceneDraftPayload,
    contract_hash,
)
from actiscape_agent.scene_projection import (
    plan_to_scene_program,
    project_floorplan_candidate,
)
from actiscape_agent.scene_registry import SCENE_REGISTRY_PATH, SceneRegistry

ROOT = Path(__file__).resolve().parents[3]


def test_scene_registry_is_versioned_data_and_catalogue_keys_are_real():
    registry = SceneRegistry()
    assert registry.document.schemaVersion == "actiscape.scene-registry.v1"
    assert {item["id"] for item in registry.public_rooms()} == {
        "living_dining",
        "reading_lounge",
    }
    catalogue = json.loads((ROOT / "fixtures/catalog.json").read_text())
    unknown = {
        key
        for category in registry.document.categories
        for key in category.catalogKeys
        if key not in catalogue
    }
    assert unknown == set()


def test_new_room_and_category_are_data_only_extensions(tmp_path):
    path = tmp_path / "scene-registry.v1.json"
    shutil.copyfile(SCENE_REGISTRY_PATH, path)
    value = json.loads(path.read_text())
    value["roomTypes"].append(
        {
            "id": "craft_room",
            "label": "手工房",
            "status": "active",
            "skillRoomKind": "craft_room",
            "skillIds": ["future-craft-room"],
            "floorMaterial": "oak",
            "wallMaterial": "latexWhite",
            "policy": {"geometry": "rectangular_v1", "checks": []},
            "defaultFurniture": [{"query": "工作台", "count": 1}],
        }
    )
    value["categories"].append(
        {
            "id": "craftTable",
            "label": "手工桌",
            "parent": "table",
            "catalogKeys": ["workbench"],
        }
    )
    path.write_text(json.dumps(value, ensure_ascii=False))
    registry = SceneRegistry(path)
    assert registry.room("craft_room").status == "active"
    assert registry.category("craftTable").catalogKeys == ["workbench"]


def test_reserved_room_is_not_presented_as_generation_support():
    text = "设计一间主卧，宽4米，深3.6米，南墙门居中，有窗"
    requested = {
        "status": "ready",
        "purpose": "master_bedroom",
        "width": {"value": 4, "unit": "m"},
        "depth": {"value": 3.6, "unit": "m"},
        "doors": [{"side": "south", "position": "center"}],
        "windows": [{"side": "north", "position": "center"}],
        "evidence": {
            "purpose": "主卧",
            "width": "宽4米",
            "depth": "深3.6米",
            "doors": "南墙门居中",
            "windows": "有窗",
        },
    }
    result = resolve_request(requested, text)
    assert result["unsupported"] is True
    assert "reserved" in result["question"]


def test_contracts_keep_evidence_intent_and_authority_separate():
    bundle = {
        "sources": [
            {
                "sourceId": "text-1",
                "kind": "text_brief",
                "adapterVersion": "text-v1",
                "uri": "task:input",
            },
            {
                "sourceId": "plan-1",
                "kind": "floorplan_image",
                "adapterVersion": "floorplan-v4",
                "sha256": "a" * 64,
            },
        ]
    }
    intent = IntentSpec(
        request="保留布局",
        constraints=[
            {
                "id": "intent-1",
                "kind": "preserve_layout",
                "text": "保留布局",
                "strict": True,
                "sourceRefs": ["text-1"],
            }
        ],
    )
    evidence = EvidenceGraph(
        facts=[
            {
                "id": "fact-1",
                "sourceId": "plan-1",
                "kind": "room_label",
                "data": {"name": "客餐厅"},
            }
        ]
    )
    draft = SceneDraftPayload(
        projectId="p",
        baseProjectRevision=0,
        inputBundle=bundle,
        evidenceGraph=evidence,
        intentSpec=intent,
        program={"schemaVersion": "actiscape.scene-program.v1"},
        fieldAuthorities=[
            {
                "path": "program.levels.0.walls",
                "authority": "observed",
                "sourceIds": ["plan-1"],
            }
        ],
    )
    assert len(contract_hash(draft)) == 64
    with pytest.raises(ValidationError, match="第二版场景草稿需要识别块"):
        SceneDraftPayload(
            **{
                **draft.model_dump(),
                "schemaVersion": "actiscape.scene-draft.v2",
            }
        )
    v2 = SceneDraftPayload(
        **{
            **draft.model_dump(),
            "schemaVersion": "actiscape.scene-draft.v2",
            "recognition": {
                "schemaVersion": "actiscape.floorplan-recognition.v1",
                "kind": "floorplan",
                "sourceId": "plan-1",
            },
        }
    )
    assert v2.recognition["kind"] == "floorplan"
    with pytest.raises(ValidationError, match="不能写入事实证据"):
        SceneDraftPayload(
            **{
                **draft.model_dump(),
                "evidenceGraph": {
                    "schemaVersion": "actiscape.evidence-graph.v1",
                    "facts": [
                        {
                            "id": "bad",
                            "sourceId": "text-1",
                            "kind": "wall",
                            "data": {},
                        }
                    ],
                },
            }
        )


def test_scene_projection_prefers_compiled_object_room_ownership():
    plan = {
        "height": 2800,
        "nodes": [],
        "walls": [],
        "openings": [],
        "rooms": [
            {"id": "s:r:living", "name": "客餐厅", "x": 0, "y": 0},
            {"id": "s:r:bedroom", "name": "主卧", "x": 5000, "y": 0},
        ],
        "furniture": [
            {
                "id": "s:f:bed",
                "key": "bed15",
                "name": "双人床",
                "x": 100,
                "y": 0,
                "w": 1500,
                "d": 2000,
                "h": 500,
                "rot": 0,
            }
        ],
        "source": {
            "objectRooms": {"s:f:bed": "s:r:bedroom"},
        },
    }
    program = plan_to_scene_program(
        plan,
        source_id="floorplan:test",
        authority="observed",
        room_type=None,
    )
    assert program["objects"][0]["roomSeedId"] == "s:r:bedroom"


def test_v4_floorplan_projection_requires_one_scene_draft_identity():
    generation = {
        "workflowVersion": 4,
        "draftId": "draft-1",
        "sceneDraftId": "draft-1",
    }

    class Store:
        def task(self, task_id, internal=False):
            return {"generation": generation}

    class Client:
        async def request(self, *args, **kwargs):
            raise AssertionError("V4 projection must not create a second draft")

    task = {"id": "task-1", "projectId": "project-1", "generation": generation}
    assert (
        asyncio.run(
            project_floorplan_candidate(
                store=Store(),
                client=Client(),
                task=task,
                plan={},
                selection_id="selection",
                project_revision=0,
            )
        )
        is generation
    )
    generation["sceneDraftId"] = "draft-2"
    with pytest.raises(ValueError, match="两个不同的草稿身份"):
        asyncio.run(
            project_floorplan_candidate(
                store=Store(),
                client=Client(),
                task=task,
                plan={},
                selection_id="selection",
                project_revision=0,
            )
        )
