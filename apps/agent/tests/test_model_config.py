import httpx
import pytest

import actiscape_agent.app as agent_app
from actiscape_agent.app import create_app
from actiscape_agent.config import model_api_key, model_settings


def clear(monkeypatch):
    for key in (
        "DEEPSEEK_API_KEY",
        "DEEPSEEK_MODEL",
        "DEEPSEEK_BASE_URL",
        "DEEPSEEK_THINKING",
        "MODEL_API_KEY",
        "MODEL_NAME",
        "MODEL_URL",
    ):
        monkeypatch.delenv(key, raising=False)


def test_model_settings_prefers_deepseek_then_agentarts_maas(monkeypatch):
    clear(monkeypatch)
    monkeypatch.setenv("MODEL_API_KEY", "maas-key")
    monkeypatch.setenv("MODEL_NAME", "deepseek-v4.1-flash")
    monkeypatch.setenv("MODEL_URL", "https://api.modelarts-maas.com/openai/v1")
    settings = model_settings()
    assert settings["model"] == "deepseek-v4.1-flash"
    assert settings["base_url"] == "https://api.modelarts-maas.com/openai/v1"
    assert settings["api_key"] == "maas-key"
    assert settings["extra_body"] == {}
    assert model_api_key() == "maas-key"

    monkeypatch.setenv("DEEPSEEK_MODEL", "deepseek-flash")
    monkeypatch.setenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "deepseek-key")
    settings = model_settings()
    assert settings["model"] == "deepseek-flash"
    assert settings["base_url"] == "https://api.deepseek.com"
    assert settings["api_key"] == "deepseek-key"
    assert settings["extra_body"] == {"thinking": {"type": "enabled"}}


def test_non_deepseek_thinking_can_be_explicitly_enabled(monkeypatch):
    clear(monkeypatch)
    monkeypatch.setenv("MODEL_URL", "https://api.modelarts-maas.com/openai/v1")
    monkeypatch.setenv("DEEPSEEK_THINKING", "enabled")
    assert model_settings()["extra_body"] == {"thinking": {"type": "enabled"}}
    monkeypatch.setenv("DEEPSEEK_THINKING", "disabled")
    assert model_settings()["extra_body"] == {}


@pytest.mark.asyncio
async def test_health_accepts_model_api_key_without_deepseek_key(monkeypatch, tmp_path):
    clear(monkeypatch)
    monkeypatch.setenv("MODEL_API_KEY", "maas-key")
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        monkeypatch.setenv(key, "")

    async def fake_vision():
        return {"configured": False, "available": False, "model": "test", "baseUrl": "test"}

    monkeypatch.setattr(agent_app, "vision_service_status", fake_vision)
    app = create_app(tmp_path)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")
    assert response.status_code == 200
    assert response.json()["modelConfigured"] is True
