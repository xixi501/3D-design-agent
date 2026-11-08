import shutil

import pytest
from pydantic import ValidationError

from actiscape_agent.generation_schemas import asset_selection_schema, resolve_request
from actiscape_agent.skill_registry import GENERATION_TOOLS, SKILL_ROOT, load_design_skill
from actiscape_agent.store import TaskError, TaskStore, fingerprint


def test_missing_geometry_cannot_be_filled_by_model_defaults():
    input = "设计一个温馨的客餐厅"
    resolved = resolve_request(
        {
            "status": "ready",
            "purpose": "living_dining",
            "width": {"value": 6, "unit": "m"},
            "depth": {"value": 4, "unit": "m"},
            "doors": [],
            "windows": [],
            "evidence": {"purpose": "客餐厅", "width": "编造", "depth": "编造"},
        },
        input,
    )
    assert "横向净宽" in resolved["missing"] and "纵向净深" in resolved["missing"]
    assert "是否有窗及窗的位置" in resolved["missing"]
    assert "width" not in resolved["brief"]
    assert resolved["furniture"] and "层高 2800 mm" in resolved["defaults"]


def test_asset_choices_are_per_request_not_per_instance():
    schema = asset_selection_schema(2, {"chair", "floorLamp"})
    good = [
        {"request_index": 0, "key": "chair", "reason": "four instances, one recipe"},
        {"request_index": 1, "key": "floorLamp", "reason": "one lamp"},
    ]
    assert len(schema.model_validate({"choices": good}).choices) == 2
    with pytest.raises(ValidationError):
        schema.model_validate({"choices": good + [good[0]]})
    with pytest.raises(ValidationError):
        schema.model_validate({"choices": [good[0], good[0]]})
    with pytest.raises(ValidationError):
        schema.model_validate({"choices": [good[0], {**good[1], "key": "invented"}]})


def test_explicit_geometry_and_corrections_preserve_units_and_no_window():
    text = "阅读会客间，宽500厘米，深3.6米，南墙门居中，没有窗"
    value = {
        "status": "ready",
        "purpose": "reading_lounge",
        "width": {"value": 500, "unit": "cm"},
        "depth": {"value": 3.6, "unit": "m"},
        "doors": [{"side": "south", "position": "center"}],
        "windows": [],
        "evidence": {
            "purpose": "阅读会客间",
            "width": "宽500厘米",
            "depth": "深3.6米",
            "doors": "南墙门居中",
            "windows": "没有窗",
        },
    }
    resolved = resolve_request(value, text)
    assert resolved["missing"] == []
    assert resolved["brief"]["width"] == {"value": 500, "unit": "cm"}
    assert resolved["brief"]["windows"] == []
    assert resolved["furniture"][0] == {"query": "单人沙发", "count": 2}
    value["doors"][0]["position"] = "offset"
    assert resolve_request(value, text)["missing"]


def test_real_skill_checks_tools_and_snapshot_is_independent_of_later_files(tmp_path):
    skill = load_design_skill(GENERATION_TOOLS)
    assert "800 mm" in skill["content"] and len(skill["contentHash"]) == 64
    with pytest.raises(TaskError, match="能力"):
        load_design_skill(set())
    root = tmp_path / "skills"
    shutil.copytree(SKILL_ROOT, root)
    original = load_design_skill(GENERATION_TOOLS, root)
    (root / "rectangular-living-reading/SKILL.md").write_text("changed future content")
    assert original["contentHash"] != load_design_skill(GENERATION_TOOLS, root)["contentHash"]
    store = TaskStore(tmp_path / "store")
    c = store.create_conversation("p")
    task = store.create_task(
        c["id"],
        {"requestId": "r", "input": "generate", "selectedIds": [], "mode": "generate_rectangular"},
    )
    store.update(
        task["id"],
        generation={
            "skillSnapshot": original,
            "skillsUsed": [{"id": original["id"], "contentHash": original["contentHash"]}],
        },
    )
    store.close()
    store = TaskStore(tmp_path / "store")
    try:
        assert store.task(task["id"], internal=True)["generation"]["skillSnapshot"] == original
        assert "skillSnapshot" not in store.task(task["id"])["generation"]
    finally:
        store.close()


def test_old_edit_request_hash_and_mode_survive_migration(tmp_path):
    store = TaskStore(tmp_path)
    try:
        c = store.create_conversation("p")
        old = {"requestId": "legacy", "input": "move", "selectedIds": []}
        task = store.create_task(c["id"], old)
        assert store.db.execute(
            "SELECT request_hash FROM tasks WHERE id=?", (task["id"],)
        ).fetchone()[0] == fingerprint(old)
        store.db.execute("ALTER TABLE tasks DROP COLUMN mode")
        store.db.execute("ALTER TABLE tasks DROP COLUMN generation")
        store.db.execute("PRAGMA user_version=0")
        store.close()
        store = TaskStore(tmp_path)
        assert store.task(task["id"])["mode"] == "edit"
        assert store.create_task(c["id"], {**old, "mode": "edit"})["id"] == task["id"]
        with pytest.raises(TaskError, match="不同内容"):
            store.create_task(c["id"], {**old, "mode": "generate_rectangular"})
    finally:
        store.close()
