import pytest
from langchain_core.messages import AIMessage, HumanMessage
from pydantic import BaseModel

from actiscape_agent.config import role_model_options
from actiscape_agent.edit_execution import compile_scope
from actiscape_agent.floorplan_hybrid import compile_hybrid_housespec
from actiscape_agent.roles import Roles
from actiscape_agent.scene_projection import ensure_edit_scene_draft, sync_edit_scene_program
from actiscape_agent.schemas import SkillSelection
from actiscape_agent.skill_registry import get_registry
from actiscape_agent.store import TaskStore


def test_repair_layout_skill_bundle_and_with_repair_compatible():
    registry = get_registry()
    bundle = registry.compose(
        mode="repair_layout",
        selection=SkillSelection(primarySkillId=None, modifierSkillIds=[], reason="layout repair"),
        include_intake=False,
    )
    repaired = registry.with_repair(bundle, "repair_layout")
    assert repaired["repair"]["id"] == "layout-check-repair"
    assert repaired["universal"]["id"] == "universal-spatial-base"


def test_design_role_max_tokens_headroom():
    opts = role_model_options("design", has_images=False)
    assert opts["max_tokens"] >= 16384


@pytest.mark.asyncio
async def test_format_recovery_uses_tool_free_low_reasoning_agent(tmp_path, monkeypatch):
    class Out(BaseModel):
        value: str

    store = TaskStore(tmp_path)
    conv = store.create_conversation("p1")
    task = store.create_task(conv["id"], {"requestId": "rec-1", "input": "test", "selectedIds": []})
    store.start(task["id"])

    agent_calls = []
    model_overrides = []

    class DummyAgent:
        def __init__(self, idx):
            self.idx = idx

        async def ainvoke(self, state, config):
            store.count_model_call(task["id"], "design")
            if self.idx == 0:
                return {"messages": [HumanMessage("req"), AIMessage("truncated")]}
            return {"structured_response": Out(value="ok")}

    def fake_create_agent(model, tools, **kwargs):
        idx = len(agent_calls)
        agent_calls.append({"tools": list(tools)})
        return DummyAgent(idx)

    def fake_model_factory(**kwargs):
        model_overrides.append(dict(kwargs))
        return object()

    monkeypatch.setattr("actiscape_agent.roles.create_agent", fake_create_agent)
    roles = Roles(store, None, model_factory=fake_model_factory)
    try:
        out = await roles.invoke("design", "sys", Out, [object()], {"x": 1}, task["id"])
        assert out["value"] == "ok"
        assert len(agent_calls) == 2
        assert len(agent_calls[0]["tools"]) == 1
        assert agent_calls[1]["tools"] == []
        assert model_overrides[1]["reasoning_effort"] == "low"
        assert model_overrides[1]["max_tokens"] >= 16384
    finally:
        store.close()


@pytest.mark.asyncio
async def test_sync_edit_scene_program_distinct_request_ids_across_retries(tmp_path):
    store = TaskStore(tmp_path)
    conv = store.create_conversation("p1")
    task = store.create_task(
        conv["id"], {"requestId": "r-init", "input": "repair", "selectedIds": ["f1"], "mode": "repair_layout"}
    )
    seen_patches = {}

    class FakeClient:
        async def request(self, path, body=None):
            if path.endswith("/scene-drafts"):
                return {"id": "draft-1", "revision": 0, "hash": "h0"}
            if path.endswith("/patches"):
                req_id = body["requestId"]
                sig = str(body["commands"])
                if req_id in seen_patches and seen_patches[req_id] != sig:
                    raise AssertionError("相同 requestId 对应不同草稿 patch")
                seen_patches[req_id] = sig
                rev = body["draftRevision"] + 1
                return {"id": "draft-1", "revision": rev, "hash": f"h{rev}"}
            raise AssertionError(path)

    base_plan = {
        "name": "test",
        "height": 2800,
        "nodes": [{"id": "n1", "x": 0, "y": 0}, {"id": "n2", "x": 4000, "y": 0}],
        "walls": [{"id": "w1", "a": "n1", "b": "n2", "t": 180}],
        "openings": [],
        "rooms": [{"id": "r1", "name": "客厅", "x": 2000, "y": 2000}],
        "furniture": [{"id": "f1", "key": "chair", "type": "chair", "name": "餐椅", "x": 1000, "y": 1000, "w": 450, "d": 450, "h": 820, "rot": 0}],
    }
    project = {"id": "p1", "revision": 1, "plan": base_plan}
    intent = {"summary": "fix", "target_ids": ["f1"], "additions": [], "delete_ids": []}
    client = FakeClient()
    try:
        await ensure_edit_scene_draft(store=store, client=client, task=task, project=project, intent=intent)
        plan_a = {**base_plan, "furniture": [{**base_plan["furniture"][0], "x": 1200}]}
        plan_b = {**base_plan, "furniture": [{**base_plan["furniture"][0], "x": 1500}]}
        await sync_edit_scene_program(store=store, client=client, task=task, plan=plan_a, selection_id="candidate-c1")
        await sync_edit_scene_program(store=store, client=client, task=task, plan=plan_b, selection_id="candidate-c2")
        assert len(seen_patches) == 2
    finally:
        store.close()


def test_compile_scope_tolerates_stray_permissions_and_composite_assets():
    project = {
        "id": "p1",
        "revision": 3,
        "plan": {
            "furniture": [
                {"id": "f1", "key": "chair", "type": "chair", "name": "餐椅", "x": 1000, "y": 1000, "w": 450, "d": 450, "h": 820, "rot": 0},
                {"id": "f2", "key": "sofa", "type": "sofa", "name": "三人沙发", "x": 2500, "y": 2000, "w": 2100, "d": 900, "h": 850, "rot": 0},
            ],
            "rooms": [],
        },
    }
    catalogue = {
        "chair": {"key": "chair", "type": "chair", "name": "餐椅"},
        "floorLamp": {"key": "floorLamp", "type": "floorLamp", "name": "落地灯"},
    }
    intent = {
        "target_ids": ["f1"],
        "reference_ids": ["f2"],
        "delete_ids": [],
        # Stray reference ID in field_permissions should be cleaned without failing
        "field_permissions": {"f1": ["x", "y"], "f2": ["x"]},
        "additions": [{"query": "落地灯", "count": 1}],
        "operations": [],
        "area": "room",
    }
    # 1-based request_index + hallucinated candidate key should normalize cleanly
    assets = {
        "choices": [{"request_index": 1, "key": "floorLamp", "reason": "ok"}],
        "candidate_keys": ["floorLamp", "nonexistent_hallucinated_key"],
    }
    scope = compile_scope(project, intent, assets, catalogue, task_mode="edit", task={"input": "挪餐椅并加一盏落地灯"})
    assert scope["targetIds"] == ["f1"]
    assert list(scope["fieldMask"].keys()) == ["f1"]
    assert "floorLamp" in scope["allowAddKeys"]


def test_hybrid_floorplan_portrait_scale_connectivity_openings_and_three_bedrooms():
    # Mimic portrait A-type apartment: 1020x1230 image, annotated 10200 x 12300 mm,
    # with master bedroom detached by a corridor gap, a narrow sliver gap, and only 1 bed recognized.
    vlm = {
        "scaleInfo": {"outerWidthMm": 10200, "outerDepthMm": 12300},
        "rooms": [
            {"name": "厨房", "kind": "kitchen", "x1": 280, "y1": 120, "x2": 520, "y2": 320},
            {"name": "卧室", "kind": "bedroom", "x1": 540, "y1": 20, "x2": 820, "y2": 260},
            {"name": "卫生间1", "kind": "bathroom", "x1": 620, "y1": 260, "x2": 820, "y2": 420},
            {"name": "卫生间2", "kind": "bathroom", "x1": 620, "y1": 420, "x2": 820, "y2": 580},
            {"name": "餐厅", "kind": "living_dining", "x1": 280, "y1": 320, "x2": 620, "y2": 580},
            {"name": "次卧", "kind": "bedroom", "x1": 40, "y1": 580, "x2": 260, "y2": 860},
            # Intentional narrow gap (260 -> 310 = 50 units) and detached master bedroom (580 -> 640 = 60 units)
            {"name": "客厅", "kind": "living_dining", "x1": 310, "y1": 580, "x2": 580, "y2": 860},
            {"name": "主卧", "kind": "bedroom", "x1": 640, "y1": 580, "x2": 880, "y2": 860},
            {"name": "阳台", "kind": "balcony", "x1": 40, "y1": 860, "x2": 580, "y2": 970},
        ],
        "openings": [
            {"type": "door", "x": 280, "y": 430, "span": 80, "orient": "v"},
            {"type": "door", "x": 640, "y": 700, "span": 80, "orient": "v"},
            {"type": "window", "x": 760, "y": 860, "span": 160, "orient": "h"},
        ],
        "furniture": [
            # Only 1 bed recognized by VLM (other 2 bedrooms missed)
            {"key": "bed18", "x": 760, "y": 720, "rot": 0},
            {"key": "sofa", "x": 500, "y": 720, "rot": 90},
        ],
    }
    cv_axes = {"widthPx": 1020, "heightPx": 1230, "xAxes1000": [], "yAxes1000": []}
    spec, meta = compile_hybrid_housespec(vlm, cv_axes)

    # 1. Portrait scale must match 10200 x 12300 within 200mm (no 0.9m distortion!)
    assert abs(meta["totalWidthMm"] - 10200) <= 200, meta
    assert abs(meta["totalDepthMm"] - 12300) <= 200, meta
    # 2. Disconnected master bedroom & narrow sliver must weld into 1 connected graph
    assert meta["connectedComponents"] == 1, meta
    assert meta["disconnectedRooms"] == []
    # 3. Doors and exterior windows must be well populated (not just 3-4 openings)
    assert meta["openingCount"] >= 8, meta
    # 4. All 3 bedrooms must receive a bed (1 VLM + 2 adaptive fallbacks)
    beds = [f for f in spec["furniture"] if f["key"] in ("bed18", "bed15", "bed12")]
    assert len(beds) == 3, beds
