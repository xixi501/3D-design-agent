import pytest
from langchain_core.messages import AIMessage, HumanMessage
from pydantic import BaseModel, ValidationError

from actiscape_agent.roles import Roles
from actiscape_agent.schemas import Intent
from actiscape_agent.store import TaskError, TaskStore


class Output(BaseModel):
    result: str


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
