from actiscape_agent.floorplan_hybrid import compile_hybrid_housespec
from actiscape_agent.generation_schemas import is_autonomous_delegation, resolve_request
from actiscape_agent.multiroom_generator import (
    _build_two_bed_spec,
    _select_archetype,
    is_multiroom_generation_request,
)
from actiscape_agent.style_packs import match_style_pack


def test_autonomous_european_banquet_dining_expands_without_interrogation():
    prompt = "生成一个有几张桌子的餐厅，风格为欧式，然后剩余的你自由发挥"
    assert is_autonomous_delegation(prompt) is True
    assert match_style_pack(None, prompt)["id"] == "european"

    # Simulate brief LLM returning clarify status with missing geometry & vague furniture query
    raw = {
        "status": "clarify",
        "purpose": "dining_hall",
        "furniture": [{"query": "餐桌", "count": 1}],
        "style": "欧式",
        "evidence": {"purpose": "餐厅"},
    }
    resolved = resolve_request(raw, prompt)
    assert resolved["unsupported"] is False
    assert resolved["missing"] == []
    assert resolved["brief"]["roomType"] == "dining_hall"
    assert resolved["styleId"] == "european"
    # Multi-table load-aware geometry expansion (>= 7.8m wide)
    assert resolved["brief"]["width"]["value"] >= 7.8
    assert resolved["brief"]["depth"]["value"] >= 5.5

    queries = {item["query"]: item["count"] for item in resolved["furniture"]}
    assert queries.get("圆餐桌", 0) >= 3 or queries.get("餐桌", 0) >= 3
    assert queries.get("扶手餐椅", 0) >= 12
    # Complementary soft furnishings preserved (not discarded!)
    assert "定制餐边柜" in queries or "餐边柜" in queries


def test_multiroom_detection_and_housespec_builders():
    assert is_multiroom_generation_request("生成一套新中式两室两厅一厨一卫全屋方案，自由发挥") is True
    assert is_multiroom_generation_request("生成一个主卧带衣帽间独卫的康养套间") is True
    assert is_multiroom_generation_request("生成一室一厅一卫青年公寓") is True
    assert is_multiroom_generation_request("生成一个欧式餐厅，自由发挥") is False

    assert _select_archetype("生成一套新中式两室两厅一厨一卫全屋方案") == "two-bed-fullhome"
    assert _select_archetype("生成一个主卧带衣帽间独卫的康养套间") == "elderly-master-suite"
    assert _select_archetype("生成一室一厅一卫青年公寓") == "youth-studio-suite"
    assert _select_archetype("生成一套现代三室两厅大平层") == "modern-3bhk-fullhome"

    spec_2b = _build_two_bed_spec(match_style_pack("chinese", "新中式"))
    assert len(spec_2b["rooms"]) == 5
    assert len(spec_2b["furniture"]) >= 18


def test_hybrid_floorplan_three_tier_scale_and_wall_welding():
    base_vlm = {
        "rooms": [
            {"id": "r1", "name": "客餐厅", "roomType": "living_dining", "x1": 100, "y1": 100, "x2": 548, "y2": 850},
            {"id": "r2", "name": "主卧", "roomType": "master_bedroom", "x1": 552, "y1": 100, "x2": 900, "y2": 500, "annotatedAreaM2": 16.0},
            {"id": "r3", "name": "卫生间", "roomType": "bathroom", "x1": 552, "y1": 504, "x2": 900, "y2": 850},
        ],
        "openings": [
            {"type": "door", "x": 320, "y": 850, "span": 75},
            {"type": "sliding", "x": 550, "y": 300, "span": 85},
            {"type": "sliding", "x": 550, "y": 660, "span": 80},
            {"type": "window", "x": 320, "y": 100, "span": 180},
        ],
        "furniture": [
            {"category": "sofa", "x": 280, "y": 260, "rot": 0},
            {"category": "double_bed", "x": 740, "y": 280, "rot": 90},
        ],
    }
    cv_axes = {"xAxes1000": [100, 550, 900], "yAxes1000": [100, 502, 850]}

    # Tier 1: Explicit linear dimension
    vlm_t1 = {**base_vlm, "scaleInfo": {"outerWidthMm": 9600}}
    spec_t1, meta_t1 = compile_hybrid_housespec(vlm_t1, cv_axes)
    assert "第1级" in meta_t1["scaleBasis"]
    assert len(spec_t1["rooms"]) == 3
    # Verify x=550 shared interior wall was welded into ONE continuous partition wall with shifted openings!
    v_interior_walls = [w for w in spec_t1["walls"] if w["a"][0] == w["b"][0] and not w["bearing"]]
    assert len(v_interior_walls) == 1
    assert len(v_interior_walls[0]["openings"]) == 2

    # Tier 2: Room area (㎡) calibration when linear dimensions are absent
    spec_t2, meta_t2 = compile_hybrid_housespec(base_vlm, cv_axes, match_style_pack("japanese", "日式"))
    assert "第2级" in meta_t2["scaleBasis"]

    # Tier 3: Door 900mm fallback when neither linear dims nor annotatedAreaM2 exist
    vlm_t3 = {
        **base_vlm,
        "rooms": [{k: v for k, v in r.items() if k != "annotatedAreaM2"} for r in base_vlm["rooms"]],
    }
    spec_t3, meta_t3 = compile_hybrid_housespec(vlm_t3, cv_axes)
    assert "第3级" in meta_t3["scaleBasis"]
def test_repair_layout_skips_ambiguous_name_and_allows_rotation():
    from actiscape_agent.edit_execution import compile_scope
    from actiscape_agent.workflow import ambiguous_name

    project = {
        "id": "p1",
        "revision": 3,
        "plan": {
            "furniture": [
                {"id": "sofa1", "key": "sofa", "type": "sofa", "name": "三人沙发", "x": 2000, "y": 2000, "w": 2000, "d": 900, "h": 850, "rot": 0},
                {"id": "ct1", "key": "coffeeTable", "type": "table", "name": "茶几", "x": 2000, "y": 2100, "w": 1200, "d": 600, "h": 450, "rot": 0},
                {"id": "c1", "key": "chair", "type": "chair", "name": "餐椅", "x": 5000, "y": 2000, "w": 480, "d": 480, "h": 850, "rot": 0},
                {"id": "c2", "key": "chair", "type": "chair", "name": "餐椅", "x": 5600, "y": 2000, "w": 480, "d": 480, "h": 850, "rot": 0},
            ],
            "rooms": [{"id": "r1", "name": "客厅", "x": 2000, "y": 2000}],
        },
    }
    task = {
        "mode": "repair_layout",
        "selectedIds": ["sofa1", "ct1"],
        "input": "修复三人沙发与茶几重叠；对餐椅优先围绕餐桌布置",
    }
    assert ambiguous_name(task, project, {"focusIds": []}) is None

    scope = compile_scope(
        project,
        {
            "target_ids": ["sofa1", "ct1"],
            "delete_ids": [],
            "additions": [],
            "reference_ids": [],
            "area": "local",
            "field_permissions": {"sofa1": ["x", "y"], "ct1": ["x", "y"]},
            "operations": [],
        },
        {"choices": [], "candidate_keys": []},
        {},
        task_mode="repair_layout",
        task=task,
    )
    assert "rot" in scope["fieldMask"]["sofa1"]
    assert "rot" in scope["fieldMask"]["ct1"]
    assert "targetBounds" not in scope


def test_repair_layout_resume_preserves_selected_ids_and_strips_operations(tmp_path):
    from actiscape_agent.edit_execution import compile_scope
    from actiscape_agent.store import TaskStore

    # 1. compile_scope strips fabricated operations on repair_layout
    project = {
        "plan": {
            "furniture": [
                {"id": "sofa1", "name": "三人沙发", "key": "sofa", "x": 4600, "y": 2100, "w": 2200, "d": 950, "rot": 180},
                {"id": "dt1", "name": "餐桌", "key": "diningTable", "x": 4600, "y": 2100, "w": 1600, "d": 900, "rot": 0},
                {"id": "ct1", "name": "茶几", "key": "coffeeTable", "x": 1750, "y": 2050, "w": 1200, "d": 600, "rot": 0},
            ],
            "source": {},
        }
    }
    intent = {
        "target_ids": ["sofa1", "dt1"],
        "reference_ids": ["ct1"],
        "delete_ids": [],
        "field_permissions": {"sofa1": ["x", "y"]},
        "additions": [],
        "operations": [{"target_id": "dt1", "action": "update", "values": {"y": 3000}, "quote": "fabricated"}],
        "area": "local",
    }
    scope = compile_scope(
        project,
        intent,
        {"choices": []},
        {},
        task_mode="repair_layout",
        task={"selectedIds": ["sofa1", "dt1"]},
    )
    assert set(scope["targetIds"]) == {"sofa1", "dt1"}
    assert "rot" in scope["fieldMask"]["sofa1"]

    # 2. TaskStore.resume preserves original repair_layout selectedIds on empty-input retry
    store = TaskStore(tmp_path)
    conv = store.create_conversation("p1")
    task = store.create_task(
        conv["id"],
        {
            "requestId": "req-1",
            "input": "修复沙发与餐桌重叠",
            "selectedIds": ["sofa1", "dt1"],
            "mode": "repair_layout",
        },
    )
    store.update(task["id"], status="failed", error="temporary error")
    # Simulate retry while user has unrelated coffeeTable (ct1) selected on canvas!
    resumed = store.resume(
        task["id"],
        {"requestId": "req-retry-1", "input": "", "selectedIds": ["ct1"]},
    )
    assert resumed["selectedIds"] == ["sofa1", "dt1"]
    store.close()
