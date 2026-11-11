from actiscape_agent.policy import PolicyController, RepairPolicyRouter


def scene():
    return {
        "plan": {
            "furniture": [
                {
                    "id": "w1",
                    "key": "wardrobe",
                    "type": "wardrobe",
                    "name": "衣柜",
                    "x": 2000,
                    "y": 500,
                    "rot": 0,
                    "opt": {"open": False},
                },
                {
                    "id": "t1",
                    "key": "coffeeTable",
                    "type": "coffeeTable",
                    "name": "茶几",
                    "x": 1800,
                    "y": 2200,
                    "rot": 0,
                },
                {
                    "id": "l1",
                    "key": "floorLamp",
                    "type": "floorLamp",
                    "name": "落地灯（可点亮）",
                    "opt": {"on": True},
                },
                {
                    "id": "w2",
                    "key": "wardrobe",
                    "type": "wardrobe",
                    "name": "衣柜",
                    "opt": {"open": False},
                },
            ],
            "openings": [
                {"id": "d1", "type": "door", "open": False},
            ],
        }
    }


def task(text, mode="edit", selected=None, generation=None):
    return {
        "id": "t1",
        "input": text,
        "mode": mode,
        "selectedIds": selected or [],
        "generation": generation or {},
    }


def test_explicit_modes_always_win():
    controller = PolicyController()
    assert (
        controller.decide(task("随便说", "generate_rectangular"), scene()).route
        == "generate_rectangular"
    )
    assert (
        controller.decide(task("随便说", "reconstruct_floorplan"), scene()).route
        == "reconstruct_floorplan"
    )
    assert controller.decide(task("随便说", "interactive_action"), scene()).route == "waiting"


def test_action_routes_by_selection_and_name():
    controller = PolicyController()
    selected = controller.decide(task("打开它", selected=["w1"]), scene())
    assert selected.route == "interactive_action"
    assert selected.targetId == "w1" and selected.collection == "furniture"
    assert selected.action == "toggle_open"

    by_name = controller.decide(task("把衣柜门打开"), scene())
    assert by_name.route == "waiting"  # two wardrobes, do not guess

    single = controller.decide(task("打开门"), scene())
    assert single.route == "interactive_action"
    assert single.targetId == "d1" and single.collection == "openings"

    lamp = controller.decide(task("关灯", selected=["l1"]), scene())
    assert lamp.route == "interactive_action"
    assert lamp.action == "toggle_on"

    all_open = controller.decide(task("一键全开门柜检验布局"), scene())
    assert all_open.route == "interactive_action"
    assert all_open.action == "open_all"


def test_photo_requires_asset_and_keeps_host():
    controller = PolicyController()
    missing = controller.decide(task("把这张照片放到茶几上"), scene())
    assert missing.route == "waiting"
    assert "assetId" in missing.question or "资产" in missing.question

    ready = controller.decide(
        task("把照片放到茶几上", mode="photo_to_scene", generation={"assetId": "asset-1"}),
        scene(),
    )
    assert ready.route == "photo_to_scene"
    assert ready.assetId == "asset-1"


def test_generation_is_detected_only_with_room_and_dimensions():
    controller = PolicyController()
    assert (
        controller.decide(task("生成一个主卧，宽3600毫米深4200毫米"), scene()).route
        == "generate_rectangular"
    )
    assert controller.decide(task("把主卧的衣柜打开"), scene()).route == "waiting"  # two wardrobes
    assert controller.decide(task("把墙上的挂画换个位置"), scene()).route == "edit"


def test_repair_router_maps_action_and_surface_codes():
    router = RepairPolicyRouter()
    directive = router.route(
        {
            "codeChecks": {
                "issues": [
                    {
                        "code": "OPENABLE_FRONT_BLOCKED",
                        "objectIds": ["w1", "bed"],
                        "message": "衣柜开启净空不足",
                    }
                ]
            }
        }
    )
    assert directive is not None
    assert directive.targetRole == "design"
    assert directive.action == "clear_openable_envelope"
    assert directive.objectIds == ["bed", "w1"]

    surface = router.route({"issues": [{"code": "SURFACE_ITEM_OVERHANG", "objectIds": ["vase"]}]})
    assert surface is not None and surface.maxDeltaMm == 0
    assert surface.action == "rehost_or_floor_surface_item"

    assert router.route({"issues": []}) is None
    stop = router.route({"issues": [{"code": "E_CONSTRAINT_UNSATISFIABLE", "objectIds": []}]})
    assert stop is not None and stop.targetRole == "coordinator"


def test_fast_edit_parses_move_rotate_and_color():
    controller = PolicyController()
    move = controller.decide(task("把茶几往左移200毫米", selected=["w1"]), scene())
    # Explicit object name outranks the current wardrobe selection.
    assert move.route == "interactive_action"
    assert move.targetId == "t1"
    assert move.fastEdit["values"]["x"] == 1600

    rotate = controller.decide(task("顺时针旋转90度", selected=["w1"]), scene())
    assert rotate.route == "interactive_action"
    assert rotate.fastEdit["values"]["rot"] == 90

    color = controller.decide(task("把它改成蓝色", selected=["w1"]), scene())
    assert color.route == "interactive_action"
    assert color.fastEdit["values"]["color"] == "#2f5f9f"
