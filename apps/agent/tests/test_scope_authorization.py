import pytest

from actiscape_agent.policy import RepairPolicyRouter
from actiscape_agent.store import TaskError
from actiscape_agent.workflow import compile_scope


def project():
    return {
        "plan": {
            "furniture": [
                {"id": "f1", "key": "bed18", "name": "床"},
                {"id": "f2", "key": "wardrobe", "name": "衣柜"},
                {"id": "f3", "key": "sofa", "name": "沙发"},
            ]
        }
    }


def intent(targets):
    return {
        "target_ids": targets,
        "reference_ids": [],
        "delete_ids": [],
        "field_permissions": {target: ["x", "y"] for target in targets},
        "additions": [],
        "area": "room",
    }


def test_repair_targets_are_intersected_with_selected_ids():
    scope = compile_scope(
        project(),
        intent(["f1", "f2"]),
        {"choices": []},
        {},
        task_mode="repair_layout",
        task={"selectedIds": ["f1"], "allowedRoomIds": ["room-a"]},
    )
    assert scope["targetIds"] == ["f1"]
    assert scope["allowedRoomIds"] == ["room-a"]
    assert scope["checkProfile"] == "strict-repair"


def test_repair_with_no_overlap_is_rejected():
    with pytest.raises(TaskError) as error:
        compile_scope(
            project(),
            intent(["f1"]),
            {"choices": []},
            {},
            task_mode="repair_layout",
            task={"selectedIds": ["f3"]},
        )
    assert error.value.code == "NEEDS_INPUT"


def test_repair_without_selected_ids_is_rejected():
    with pytest.raises(TaskError) as error:
        compile_scope(
            project(),
            intent(["f1"]),
            {"choices": []},
            {},
            task_mode="repair_layout",
            task={"selectedIds": []},
        )
    assert error.value.code == "NEEDS_INPUT"


def test_non_repair_scope_keeps_existing_behavior():
    scope = compile_scope(
        project(),
        intent(["f1", "f2"]),
        {"choices": []},
        {},
        task_mode="edit",
        task={"selectedIds": ["f1"]},
    )
    assert scope["targetIds"] == ["f1", "f2"]
    assert "checkProfile" not in scope
    assert "allowedRoomIds" not in scope


def test_structural_issue_routes_to_coordinator_stop():
    directive = RepairPolicyRouter().route(
        {
            "codeChecks": {
                "issues": [
                    {
                        "code": "STRUCT_DOOR_CLEAR_WIDTH",
                        "category": "structure",
                        "fixableByFurniture": False,
                        "objectIds": ["door"],
                        "message": "门宽不足",
                    }
                ]
            }
        }
    )
    assert directive is not None
    assert directive.targetRole == "coordinator"
    assert directive.action == "stop"
    assert directive.objectIds == ["door"]


def test_furniture_issue_still_routes_to_design():
    directive = RepairPolicyRouter().route(
        {
            "codeChecks": {
                "issues": [
                    {
                        "code": "OPENABLE_FRONT_BLOCKED",
                        "category": "furniture",
                        "fixableByFurniture": True,
                        "objectIds": ["f1", "f2"],
                        "message": "柜门被挡",
                    }
                ]
            }
        }
    )
    assert directive is not None
    assert directive.targetRole == "design"
