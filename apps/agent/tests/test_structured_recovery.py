import pytest
from langchain_core.messages import AIMessage, HumanMessage
from pydantic import BaseModel, ValidationError

from actiscape_agent.roles import Roles
from actiscape_agent.schemas import Intent
from actiscape_agent.store import TaskError, TaskStore


class Output(BaseModel):
    result: str


@pytest.mark.asyncio
@pytest.mark.parametrize("recognition", [False, True])
async def test_recognition_output_profile_reaches_model_without_changing_other_roles(
    tmp_path, monkeypatch, recognition
):
    from actiscape_agent.config import FLOORPLAN_RECOGNITION_OPTIONS, model_settings
    from actiscape_agent.model import create_model

    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-only-not-a-credential")
    options = FLOORPLAN_RECOGNITION_OPTIONS if recognition else {}
    model = create_model(**options)
    wire = model._get_request_payload([HumanMessage("inspect image")])
    assert wire["max_tokens"] == (32768 if recognition else 8192)
    assert model.request_timeout == (180 if recognition else 120)
    assert wire["reasoning_effort"] == options.get(
        "reasoning_effort", model_settings()["reasoning_effort"]
    )
    assert wire["extra_body"]["thinking"]["type"] == ("disabled" if recognition else "enabled")
    store = TaskStore(tmp_path)
    conversation = store.create_conversation("p")
    task = store.create_task(
        conversation["id"], {"requestId": "profile", "input": "inspect", "selectedIds": []}
    )
    received = []

    def factory(**kwargs):
        received.append(kwargs)
        return object()

    class Agent:
        async def ainvoke(self, state, config):
            store.count_model_call(task["id"], "main")
            return {"structured_response": Output(result="controlled profile verification")}

    monkeypatch.setattr("actiscape_agent.roles.create_agent", lambda *a, **kw: Agent())
    try:
        await Roles(store, None, model_factory=factory).invoke(
            "main", "test", Output, [], {}, task["id"], model_options=options or None
        )
        assert received == [options]
        started = next(e["data"] for e in store.events(task["id"]) if e["kind"] == "agent_start")
        assert started["maxOutputTokens"] == wire["max_tokens"]
        assert started["timeoutSeconds"] == model.request_timeout
        assert started["reasoningEffort"] == wire["reasoning_effort"]
        assert started["thinkingMode"] == wire["extra_body"]["thinking"]["type"]
        assert store.task(task["id"])["modelCalls"] == 1
    finally:
        store.close()


def test_floorplan_pixel_schema_rejects_millimetre_footprints_but_keeps_real_scale_distances():
    from actiscape_agent.floorplan_schemas import floorplan_recognition_schema

    schema = floorplan_recognition_schema(736, 673)
    data = {
        "status": "draft",
        "anchors": [
            {
                "a": {"x": 86, "y": 15},
                "b": {"x": 631, "y": 15},
                "distance": {"value": 9700, "unit": "mm"},
                "basis": "exterior",
                "evidence": "9700",
            }
        ],
        "symbols": [
            {
                "id": "table",
                "roomId": "living",
                "category": "餐桌",
                "x": 135,
                "y": 285,
                "w": 80,
                "d": 45,
                "rot": 0,
            }
        ],
    }
    assert schema.model_validate(data).anchors[0].distance.value == 9700
    data["wallThickness"] = 10
    with pytest.raises(ValidationError, match="20"):
        schema.model_validate(data)
    data["wallThickness"] = None
    data["height"] = 0
    with pytest.raises(ValidationError, match="100"):
        schema.model_validate(data)
    data["height"] = None
    data["symbols"][0]["w"] = 1200
    with pytest.raises(ValidationError, match="736"):
        schema.model_validate(data)


def test_intent_requires_consistent_delete_and_field_authorization():
    with pytest.raises(ValidationError):
        Intent(status="ready", summary="delete selected", delete_ids=["selected"])
    with pytest.raises(ValidationError):
        Intent(status="ready", summary="move selected", target_ids=["selected"])
    ready = Intent(
        status="ready", summary="delete selected", target_ids=["selected"], delete_ids=["selected"]
    )
    assert ready.delete_ids == ready.target_ids
    assert Intent(status="clarify", summary="need selection").target_ids == []


@pytest.mark.asyncio
@pytest.mark.parametrize("second_valid,initial_calls", [(True, 0), (False, 0), (True, 23)])
async def test_format_recovery_is_once_keeps_context_and_respects_task_budget(
    tmp_path, monkeypatch, second_valid, initial_calls
):
    store = TaskStore(tmp_path)
    c = store.create_conversation("p")
    t = store.create_task(c["id"], {"requestId": "format", "input": "bounded", "selectedIds": []})
    store.start(t["id"])
    store.db.execute("UPDATE tasks SET model_calls=? WHERE id=?", (initial_calls, t["id"]))
    received = []

    class Agent:
        async def ainvoke(self, state, config):
            store.count_model_call(t["id"], "main")
            received.append(state)
            if len(received) == 2 and second_valid:
                return {"structured_response": Output(result="real structured shape")}
            return {
                "messages": [
                    HumanMessage("original requirement"),
                    AIMessage(
                        "actual unstructured response",
                        additional_kwargs={"reasoning_content": "actual prior reasoning"},
                    ),
                ]
            }

    monkeypatch.setattr("actiscape_agent.roles.create_agent", lambda *a, **kw: Agent())
    role = Roles(store, None, model_factory=lambda: object())
    try:
        if initial_calls == 23:
            with pytest.raises(TaskError, match="上限"):
                await role.invoke("main", "test", Output, [], {}, t["id"])
            assert store.task(t["id"])["modelCalls"] == 24
        elif second_valid:
            assert (await role.invoke("main", "test", Output, [], {}, t["id"]))[
                "result"
            ] == "real structured shape"
            assert (
                len(received) == 2 and received[1]["messages"][0].content == "original requirement"
            )
            assert (
                received[1]["messages"][1].additional_kwargs["reasoning_content"]
                == "actual prior reasoning"
            )
        else:
            with pytest.raises(TaskError, match="一次格式恢复"):
                await role.invoke("main", "test", Output, [], {}, t["id"])
            assert len(received) == 2
        assert len([e for e in store.events(t["id"]) if e["kind"] == "model_format_retry"]) == 1
    finally:
        store.close()
