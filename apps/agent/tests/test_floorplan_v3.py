"""V3 bounded recognition tests; controlled data never counts as live-image acceptance."""

import pytest
from pydantic import ValidationError

from actiscape_agent.config import FLOORPLAN_REVIEW_OPTIONS
from actiscape_agent.floorplan_schemas import (
    FloorplanReview,
    FurnitureRecognition,
    RecognitionV3,
)
from actiscape_agent.floorplan_v3 import (
    FloorplanV3,
    _assemble_structure,
    build_structure_skeleton,
)
from actiscape_agent.manager import TaskManager
from actiscape_agent.store import TaskError, TaskStore


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
