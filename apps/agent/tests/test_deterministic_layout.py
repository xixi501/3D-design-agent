import json
from pathlib import Path

import pytest

from actiscape_agent.deterministic_layout import deterministic_proposal
from actiscape_agent.generation_roles import GenerationRoles

ROOT = Path(__file__).resolve().parents[1] / "actiscape_agent/skills"
CASES = {
    "master_bedroom": ("master-bedroom", "MBR-dev-01"),
    "guest_bedroom": ("guest-bedroom", "GBR-dev-01"),
    "study": ("home-office", "HOF-dev-01"),
    "kitchen": ("kitchen-line-l-u", "KIT-dev-01"),
    "bathroom": ("bathroom-standard", "BAT-dev-01"),
    "entry": ("entry-storage", "ENT-dev-01"),
}


def example(room_type):
    skill, case = CASES[room_type]
    path = ROOT / skill / "examples" / case / "ops.json"
    return json.loads(path.read_text())


def task_for(room_type, scene):
    room = scene["rooms"][0]
    points = room["polygon"]
    return {
        "generation": {
            "brief": {"roomType": room_type},
            "dimensions": {
                "width": max(p[0] for p in points) - min(p[0] for p in points),
                "depth": max(p[1] for p in points) - min(p[1] for p in points),
            },
        }
    }


@pytest.mark.parametrize("room_type", CASES)
def test_deterministic_layout_covers_all_main_room_types(room_type):
    case = example(room_type)
    scene = case["scene"]
    keys = [
        edit["object"]["key"]
        for edit in case["edits"]
        if edit.get("op") == "add" and edit["object"].get("key")
    ]
    task = task_for(room_type, scene)
    proposal = deterministic_proposal(
        task,
        {"plan": {"rooms": scene["rooms"]}},
        {"allowAddKeys": keys},
    )
    assert proposal is not None
    assert proposal["edits"]
    assert {edit["key"] for edit in proposal["edits"]} <= set(keys)
    for edit in proposal["edits"]:
        assert edit["type"] == "create"
        assert isinstance(edit["values"]["x"], float)
        assert isinstance(edit["values"]["y"], float)


def test_circulation_has_a_safe_generic_layout():
    layout = {
        "plan": {
            "rooms": [
                {
                    "polygon": [
                        [0, 0],
                        [1400, 0],
                        [1400, 3000],
                        [0, 3000],
                    ]
                }
            ]
        }
    }
    task = {"generation": {"brief": {"roomType": "circulation"}}}
    proposal = deterministic_proposal(
        task, layout, {"allowAddKeys": ["consoleTable", "plant"]}
    )
    assert proposal is not None
    assert [edit["key"] for edit in proposal["edits"]] == [
        "consoleTable",
        "plant",
    ]


class FailingBase:
    def __init__(self):
        self.events = []

    def scene_tools(self, _layout):
        return []

    class _Store:
        def __init__(self, parent):
            self.parent = parent

        def event(self, _task_id, kind, data):
            self.parent.events.append((kind, data))

    @property
    def store(self):
        return self._Store(self)


class FailingClient:
    async def request(self, path, _body=None):
        if path == "/catalog":
            case = example("master_bedroom")
            return {
                "items": {
                    edit["object"]["key"]: {
                        "key": edit["object"]["key"],
                        "name": edit["object"]["key"],
                    }
                    for edit in case["edits"]
                    if edit.get("op") == "add" and edit["object"].get("key")
                }
            }
        raise AssertionError(path)

    async def invoke(self, *_args, **_kwargs):
        raise RuntimeError("fake model timeout")


@pytest.mark.asyncio
async def test_design_falls_back_when_model_times_out():
    case = example("master_bedroom")
    scene = case["scene"]
    keys = [
        edit["object"]["key"]
        for edit in case["edits"]
        if edit.get("op") == "add" and edit["object"].get("key")
    ]
    base = FailingBase()
    base.client = FailingClient()
    roles = GenerationRoles(base)
    task = {
        "id": "fallback-task",
        "input": "生成主卧",
        **task_for("master_bedroom", scene),
    }
    proposal = await roles.design(
        task,
        {"plan": {"rooms": scene["rooms"]}},
        {"allowAddKeys": keys, "requirements": []},
        None,
        0,
    )
    assert proposal["summary"].startswith("确定性兜底布局")
    assert proposal["edits"]
    assert any(kind == "deterministic_layout" for kind, _ in base.events)


def test_deterministic_assets_maps_common_queries():
    from actiscape_agent.deterministic_layout import deterministic_assets

    catalogue = {
        key: {"key": key, "name": key, "type": key}
        for key in (
            "bed18",
            "nightstand",
            "wardrobe",
            "desk",
            "officeChair",
            "lCounter",
            "fridge",
            "toilet",
            "vanity",
            "shower",
            "cabShoe",
            "entryBench",
            "consoleTable",
            "plant",
        )
    }
    result = deterministic_assets(
        {
            "additions": [
                {"query": "双人床"},
                {"query": "床头柜"},
                {"query": "衣柜"},
            ]
        },
        catalogue,
    )
    assert result is not None
    assert [choice["key"] for choice in result["choices"]] == [
        "bed18",
        "nightstand",
        "wardrobe",
    ]


@pytest.mark.asyncio
async def test_assets_falls_back_when_model_times_out():
    class AssetBase(FailingBase):
        async def invoke(self, *_args, **_kwargs):
            raise RuntimeError("fake asset timeout")

    base = AssetBase()
    base.client = FailingClient()
    roles = GenerationRoles(base)
    task = {
        "id": "asset-fallback",
        "input": "生成主卧",
        "generation": {},
        "mode": "generate_rectangular",
    }
    result = await roles.assets(
        task,
        {
            "additions": [
                {"query": "双人床"},
                {"query": "床头柜"},
                {"query": "衣柜"},
            ]
        },
    )
    assert [choice["key"] for choice in result["choices"]] == [
        "bed18",
        "nightstand",
        "wardrobe",
    ]
    assert any(kind == "deterministic_assets" for kind, _ in base.events)
