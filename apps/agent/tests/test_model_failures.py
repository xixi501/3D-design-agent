"""Controlled model transport exercises the real LangChain agent and request-budget callbacks."""

import httpx
import pytest
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from pydantic import Field

from actiscape_agent.roles import Roles
from actiscape_agent.schemas import Proposal
from actiscape_agent.store import TaskError, TaskStore


class RateLimited(Exception):
    status_code = 429


class ControlledModel(BaseChatModel):
    failure: str
    calls: list[int] = Field(default_factory=lambda: [0])

    @property
    def _llm_type(self):
        return "controlled-fault"

    def bind_tools(self, tools, **kwargs):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        raise NotImplementedError

    async def _agenerate(self, messages, stop=None, run_manager=None, **kwargs):
        self.calls[0] += 1
        if self.failure == "timeout":
            raise httpx.ReadTimeout("controlled private transport detail")
        if self.failure == "rate-limit":
            raise RateLimited("controlled private provider detail")
        return ChatResult(
            generations=[
                ChatGeneration(
                    message=AIMessage(
                        content="",
                        tool_calls=[
                            {
                                "name": "Proposal",
                                "id": f"invalid-{self.calls[0]}",
                                "args": {
                                    "summary": "controlled invalid model argument",
                                    "edits": [
                                        {
                                            "type": "update",
                                            "id": "chair",
                                            "values": {"x": "not-a-number"},
                                        }
                                    ],
                                },
                            }
                        ],
                    )
                )
            ]
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["timeout", "rate-limit", "invalid-arguments"])
async def test_model_failures_are_bounded_counted_and_sanitized(tmp_path, monkeypatch, failure):
    async def no_delay(seconds):
        pass

    monkeypatch.setattr("actiscape_agent.roles.asyncio.sleep", no_delay)
    store = TaskStore(tmp_path)
    try:
        conversation = store.create_conversation("controlled-project")
        task = store.create_task(
            conversation["id"], {"requestId": "one", "input": "move chair", "selectedIds": []}
        )
        model = ControlledModel(failure=failure)
        roles = Roles(store, None, model_factory=lambda: model)
        with pytest.raises(TaskError) as raised:
            await roles.invoke("design", "controlled test", Proposal, [], {}, task["id"])
        assert "private" not in str(raised.value)
        if failure == "invalid-arguments":
            assert raised.value.code == "BUDGET_EXHAUSTED"
            assert model.calls[0] == store.task(task["id"])["modelCalls"] == 24
        else:
            assert raised.value.code == "MODEL_ERROR"
            assert model.calls[0] == store.task(task["id"])["modelCalls"] == 3
            assert len([e for e in store.events(task["id"]) if e["kind"] == "model_retry"]) == 2
    finally:
        store.close()
