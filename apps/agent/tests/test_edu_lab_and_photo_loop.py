"""Unit & contract tests for zero-to-one teaching lab generation and photo auto-placement."""

from actiscape_agent.generation_schemas import GenerationRequest, resolve_request
from actiscape_agent.photo_flow import _find_surface_spot, _host, _pick_auto_host
from actiscape_agent.policy import PolicyController
from actiscape_agent.scene_registry import SceneRegistry


def _empty_project():
    return {
        "id": "p-empty",
        "revision": 0,
        "plan": {"nodes": [], "walls": [], "openings": [], "furniture": [], "rooms": []},
        "roomLabelArchive": [],
    }


def test_policy_routes_teaching_lab_and_seminar_to_generate_rectangular():
    ctrl = PolicyController()
    lab = ctrl.decide(
        {"input": "生成一个 9.0×6.6 米的基础理化教学实验室", "mode": "edit"},
        _empty_project(),
    )
    assert lab.route == "generate_rectangular"

    sem = ctrl.decide(
        {"input": "设计一间 7.2×5.6 米的多媒体研讨室", "mode": "edit"},
        _empty_project(),
    )
    assert sem.route == "generate_rectangular"

    inst = ctrl.decide(
        {
            "input": "把刚生成的光学显微镜放到实验台上",
            "mode": "edit",
            "generation": {"assetId": "asset-microscope"},
        },
        _empty_project(),
    )
    assert inst.route == "photo_to_scene"
    assert inst.assetId == "asset-microscope"


def test_scene_registry_and_autonomous_resolution_for_edu_rooms():
    reg = SceneRegistry()
    assert reg.room("teaching_lab") is not None
    assert reg.room("seminar_classroom") is not None
    assert reg.room_type_for_label("基础理化与生物教学实验室") == "teaching_lab"
    assert reg.room_type_for_label("跨学科多媒体研讨室") == "seminar_classroom"

    req = GenerationRequest(status="clarify", purpose="teaching_lab")
    resolved = resolve_request(req, "生成一个基础理化教学实验室，自由发挥")
    assert resolved["unsupported"] is False
    assert resolved["missing"] == []
    assert resolved["brief"]["roomType"] == "teaching_lab"
    assert resolved["brief"]["width"]["value"] == 9.0
    assert resolved["brief"]["depth"]["value"] == 6.6
    queries = [f["query"] for f in resolved["furniture"]]
    assert "上下升降黑板" in queries
    assert "中岛台" in queries
    assert "餐桌" not in queries


def test_photo_flow_rotated_host_sibling_avoidance_and_auto_host():
    lab_plan = {
        "furniture": [
            {
                "id": "bench_rot",
                "key": "kitchenIsland",
                "type": "kitchenIsland",
                "name": "教师演示实验台",
                "x": 3000,
                "y": 2000,
                "z": 0,
                "rot": 90,
                "w": 1800,
                "d": 900,
                "h": 860,
            },
            {
                "id": "bench_free",
                "key": "kitchenIsland",
                "type": "kitchenIsland",
                "name": "学生实验台 A1",
                "x": 5500,
                "y": 3000,
                "z": 0,
                "rot": 0,
                "w": 1800,
                "d": 900,
                "h": 820,
            },
            {
                "id": "micro_1",
                "key": "model:asset-micro",
                "type": "model",
                "name": "教学光学显微镜",
                "x": 3000,
                "y": 2000,
                "z": 860,
                "rot": 0,
                "w": 238,
                "d": 128,
                "h": 360,
                "placement": "surface",
                "parentObjectId": "bench_rot",
            },
        ],
        "rooms": [{"id": "r1", "x": 4500, "y": 3300}],
    }
    assert _host(lab_plan["furniture"][0]) is True

    flask = {"w": 122, "d": 121, "h": 220}
    # On bench_rot (rot=90 -> eff_w=900, eff_d=1800) with microscope at center (3000, 2000),
    # flask must find an offset spot that stays within [2570..3430] x [1120..2880] and avoids center!
    spot = _find_surface_spot(lab_plan["furniture"][0], flask, lab_plan)
    assert spot is not None
    fx, fy = spot
    assert abs(fx - 3000) > 100 or abs(fy - 2000) > 100
    assert 3000 - 450 + 20 <= fx - 61 and fx + 61 <= 3000 + 450 - 20
    assert 2000 - 900 + 20 <= fy - 60.5 and fy + 60.5 <= 2000 + 900 - 20

    # Auto-host should prefer bench_free (0 siblings) over bench_rot (1 sibling)
    auto = _pick_auto_host(lab_plan, flask)
    assert auto is not None
    best_host, best_spot = auto
    assert best_host["id"] == "bench_free"
    assert best_spot == (5500, 3000)
