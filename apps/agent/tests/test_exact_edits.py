import copy

import pytest

from actiscape_agent.exact_edits import exact_proposal, parse_exact
from actiscape_agent.schemas import Intent


def project():
    return {
        "id": "p",
        "revision": 3,
        "plan": {
            "furniture": [
                {
                    "id": "chair",
                    "name": "单人沙发",
                    "x": 2000,
                    "y": 1800,
                    "rot": 0,
                    "w": 800,
                    "d": 900,
                    "h": 900,
                    "color": "#ffffff",
                },
                {
                    "id": "table",
                    "name": "茶几",
                    "x": 3000,
                    "y": 1800,
                    "rot": 90,
                    "w": 1200,
                    "d": 600,
                    "h": 400,
                    "color": "#ffffff",
                },
            ]
        },
    }


def parsed(text, selected=None, scene=None, focus=None):
    return parse_exact(
        {"input": text, "selectedIds": selected or []},
        scene or project(),
        {"focusIds": focus or []},
    )


@pytest.mark.parametrize(
    "text,expected",
    [
        ("把单人沙发向左移动20厘米", {"x": 1800}),
        ("把单人沙发向右移动0.2米", {"x": 2200}),
        ("把单人沙发逆时针旋转90度", {"rot": 270}),
        ("把单人沙发宽度设为0.9米", {"w": 900}),
        ("把单人沙发改成#123456", {"color": "#123456"}),
        (
            "把单人沙发向左移200毫米，并顺时针旋转90度，宽度设为900毫米，颜色改为#123456",
            {"x": 1800, "rot": 90, "w": 900, "color": "#123456"},
        ),
        ("把单人沙发向左移100毫米，然后向左移100毫米", {"x": 1800}),
    ],
)
def test_exact_arithmetic_consumes_whole_request(text, expected):
    scene = project()
    original = copy.deepcopy(scene)
    intent = parsed(text, selected=["table"])
    Intent.model_validate(intent)
    proposal = exact_proposal(scene, intent)
    assert proposal["edits"] == [{"type": "update", "id": "chair", "values": expected}]
    assert scene == original
    assert all(op["source_quote"] in text for op in intent["operations"])


def test_multi_object_and_reference_focus():
    intent = parsed("把单人沙发和茶几向下移动100毫米")
    assert intent["target_ids"] == ["chair", "table"]
    assert parsed("再把它向左移动100毫米", focus=["chair"])["target_ids"] == ["chair"]
    assert parsed("把它向左移动100毫米", selected=["table"], focus=["chair"])["target_ids"] == [
        "table"
    ]


def test_ambiguity_clarifies_and_selection_only_disambiguates_named_objects():
    scene = project()
    scene["plan"]["furniture"].append({**scene["plan"]["furniture"][0], "id": "chair2"})
    assert (
        parsed("把单人沙发向左移动100毫米", selected=["table"], scene=scene)["status"] == "clarify"
    )
    assert parsed("把单人沙发向左移动100毫米", selected=["chair2"], scene=scene)["target_ids"] == [
        "chair2"
    ]


@pytest.mark.parametrize(
    "text",
    [
        "把单人沙发向左移动200毫米，增加一个阅读角",
        "把单人沙发向左移200毫米，别旋转",
        "把靠窗的单人沙发向左移动200毫米",
        "把单人沙发宽度改为1米高度改为2米",
    ],
)
def test_partial_or_qualified_requests_fall_back_without_partial_execution(text):
    assert parsed(text) is None


def test_pure_negation_and_idempotent_values():
    assert parsed("不要移动单人沙发")["noChange"] is True
    assert exact_proposal(project(), parsed("把茶几宽度设为1200毫米"))["noChange"] is True
    intent = parsed("删除选中的这盏单人沙发", selected=["chair"])
    assert exact_proposal(project(), intent)["edits"] == [{"type": "delete", "id": "chair"}]
