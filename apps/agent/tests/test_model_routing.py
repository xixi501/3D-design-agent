import httpx
import pytest
from langchain_core.messages import AIMessage
from pydantic import BaseModel

from actiscape_agent.config import fallback_model_settings, role_model_options
from actiscape_agent.model import create_model
from actiscape_agent.roles import Roles
from actiscape_agent.store import TaskStore


class SimpleOut(BaseModel):
    answer: str


def test_role_model_options_tiers_text_vision_and_effort(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    monkeypatch.setenv("DEEPSEEK_MODEL", "deepseek-v4.1-flash")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-text-key")
    monkeypatch.setenv("DEEPSEEK_REASONING_EFFORT", "high")
    monkeypatch.setenv("DEEPSEEK_FAST_REASONING_EFFORT", "low")
    monkeypatch.setenv("ACTISCAPE_VISION_PROVIDER", "aliyun-bailian")
    monkeypatch.setenv("ACTISCAPE_VISION_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    monkeypatch.setenv("ACTISCAPE_VISION_MODEL", "qwen3-vl-plus")
    monkeypatch.setenv("ACTISCAPE_VISION_API_KEY", "test-vision-key")
    monkeypatch.setenv("ACTISCAPE_FALLBACK_MODEL", "qwen-plus")

    # 1. design uses primary DeepSeek model with high reasoning effort
    d_opts = role_model_options("design", has_images=False)
    assert d_opts["model"] == "deepseek-v4.1-flash"
    assert d_opts["reasoning_effort"] == "high"
    assert d_opts.get("extra_body", {}).get("enable_thinking") is not False

    # 2. main / assets / structure / check (no images) use low reasoning effort & thinking disabled
    for fast_role in ("main", "assets", "structure", "check", "coordinator"):
        f_opts = role_model_options(fast_role, has_images=False)
        assert f_opts["model"] == "deepseek-v4.1-flash"
        assert f_opts["reasoning_effort"] == "low"
        assert f_opts.get("extra_body", {}).get("thinking") is None

    # 3. Image-bearing requests ALWAYS route to ACTISCAPE_VISION_MODEL even if text model is on another host!
    monkeypatch.setenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    v_opts = role_model_options("check", has_images=True)
    assert v_opts["model"] == "qwen3-vl-plus"
    assert v_opts["base_url"] == "https://dashscope.aliyuncs.com/compatible-mode/v1"
    assert v_opts["api_key"] == "test-vision-key"
    assert v_opts["extra_body"]["enable_thinking"] is False

    # 4. Fallback settings resolve to qwen-plus
    fb = fallback_model_settings()
    assert fb is not None
    assert fb["model"] == "qwen-plus"
    assert fb["extra_body"]["enable_thinking"] is False


def test_create_model_translates_thinking_disabled_on_dashscope(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    monkeypatch.setenv("DEEPSEEK_MODEL", "deepseek-v4.1-flash")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")

    m = create_model(extra_body={"thinking": {"type": "disabled"}})
    assert m.extra_body.get("enable_thinking") is False
    assert "thinking" not in m.extra_body


@pytest.mark.anyio
async def test_roles_invoke_routes_images_to_vision_and_falls_back_to_qwen_plus(tmp_path, monkeypatch):
    monkeypatch.setenv("DEEPSEEK_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    monkeypatch.setenv("DEEPSEEK_MODEL", "deepseek-v4.1-flash")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")
    monkeypatch.setenv("ACTISCAPE_VISION_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    monkeypatch.setenv("ACTISCAPE_VISION_MODEL", "qwen3-vl-plus")
    monkeypatch.setenv("ACTISCAPE_VISION_API_KEY", "test-vision-key")
    monkeypatch.setenv("ACTISCAPE_FALLBACK_MODEL", "qwen-plus")

    store = TaskStore(tmp_path)
    conv = store.create_conversation("p1")
    task = store.create_task(conv["id"], {"requestId": "r1", "input": "test", "selectedIds": []})

    seen_models: list[str] = []

    class FakeModel:
        def __init__(self, model_name: str, should_fail: bool = False):
            self.model_name = model_name
            self.should_fail = should_fail

        def bind_tools(self, tools, **kwargs):
            return self

        async def ainvoke(self, messages, config=None, **kwargs):
            if self.should_fail:
                raise httpx.ReadTimeout("simulated primary timeout")
            return AIMessage(
                content="",
                tool_calls=[{"name": "SimpleOut", "args": {"answer": f"ok:{self.model_name}"}, "id": "c1"}],
            )

    def factory(**overrides):
        m = overrides.get("model") or "deepseek-v4.1-flash"
        seen_models.append(m)
        return FakeModel(m, should_fail=(m == "deepseek-v4.1-flash"))

    roles = Roles(store, None, model_factory=factory)
    # 1. Text call fails on deepseek-v4.1-flash -> retries once -> falls back to qwen-plus!
    res = await roles.invoke("main", "sys", SimpleOut, [], {"q": 1}, task["id"])
    assert res == {"answer": "ok:qwen-plus"}
    assert "deepseek-v4.1-flash" in seen_models
    assert seen_models[-1] == "qwen-plus"
    evts = store.events(task["id"])
    assert any(e["kind"] == "model_fallback" and e["data"]["toModel"] == "qwen-plus" for e in evts)

    # 2. Image-bearing call routes straight to qwen3-vl-plus (not deepseek-v4.1-flash)!
    seen_models.clear()
    res_v = await roles.invoke("check", "sys", SimpleOut, [], {"q": 2}, task["id"], images=[b"\x89PNGfake"])
    assert res_v == {"answer": "ok:qwen3-vl-plus"}
    assert seen_models == ["qwen3-vl-plus"]
    store.close()
