"""Controlled tests for the local OpenAI-compatible furniture VLM client."""

import json

import httpx
import pytest

from actiscape_agent.floorplan_schemas import FurnitureContourRecognition
from actiscape_agent.vision_client import (
    VisionModelClient,
    VisionModelFailure,
    vision_service_status,
)


def response(content: str):
    return httpx.Response(
        200,
        json={
            "model": "controlled-vision",
            "choices": [{"message": {"content": content}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 20},
        },
    )


@pytest.mark.asyncio
async def test_vision_client_uses_json_schema_and_returns_usage(monkeypatch):
    monkeypatch.setenv("ACTISCAPE_VISION_BASE_URL", "http://vision.test/v1")
    requests = []

    def handler(request):
        requests.append(json.loads(request.content))
        return response('{"status":"draft","question":"","symbols":[]}')

    client = VisionModelClient(transport=httpx.MockTransport(handler))
    result = await client.complete(
        "return json",
        {"rooms": ["living"]},
        [b"png"],
        FurnitureContourRecognition.model_json_schema(),
    )
    assert len(requests) == 1
    assert requests[0]["response_format"]["type"] == "json_schema"
    assert result["usage"]["completion_tokens"] == 20
    assert result["structuredMode"] == "json_schema"


@pytest.mark.asyncio
async def test_vision_client_fails_closed_when_json_schema_is_unsupported(monkeypatch):
    monkeypatch.setenv("ACTISCAPE_VISION_BASE_URL", "http://vision.test/v1")
    requests = []

    def handler(request):
        requests.append(json.loads(request.content))
        return httpx.Response(400, json={"error": "json_schema unsupported"})

    client = VisionModelClient(transport=httpx.MockTransport(handler))
    with pytest.raises(VisionModelFailure) as raised:
        await client.complete(
            "return json",
            {},
            [b"png"],
            FurnitureContourRecognition.model_json_schema(),
        )
    assert len(requests) == 1
    assert raised.value.code == "VISION_MODEL_ERROR"


@pytest.mark.asyncio
async def test_vision_client_reports_unavailable_without_free_coordinate_fallback(
    monkeypatch,
):
    monkeypatch.setenv("ACTISCAPE_VISION_BASE_URL", "http://vision.test/v1")

    def handler(request):
        raise httpx.ConnectError("connection refused", request=request)

    client = VisionModelClient(transport=httpx.MockTransport(handler))
    with pytest.raises(VisionModelFailure) as raised:
        await client.complete(
            "return json",
            {},
            [b"png"],
            FurnitureContourRecognition.model_json_schema(),
        )
    assert raised.value.code == "VISION_MODEL_UNAVAILABLE"


@pytest.mark.asyncio
async def test_vision_service_status_reports_location_and_availability(monkeypatch):
    monkeypatch.setenv("ACTISCAPE_VISION_BASE_URL", "http://vision.test/v1")
    monkeypatch.setenv("ACTISCAPE_VISION_MODEL", "controlled-vision")

    def handler(request):
        assert request.url.path == "/v1/models"
        return httpx.Response(200, json={"data": [{"id": "controlled-vision"}]})

    status = await vision_service_status(transport=httpx.MockTransport(handler))
    assert status["configured"] is True
    assert status["available"] is True
    assert status["model"] == "controlled-vision"
    assert status["baseUrl"] == "http://vision.test/v1"


@pytest.mark.asyncio
async def test_vision_service_status_fails_closed_when_endpoint_is_down(monkeypatch):
    monkeypatch.setenv("ACTISCAPE_VISION_BASE_URL", "http://vision.test/v1")

    def handler(request):
        raise httpx.ConnectError("connection refused", request=request)

    status = await vision_service_status(transport=httpx.MockTransport(handler))
    assert status["configured"] is True
    assert status["available"] is False
    assert "connection refused" in status["error"]


@pytest.mark.asyncio
async def test_vision_service_status_requires_configured_model(monkeypatch):
    monkeypatch.setenv("ACTISCAPE_VISION_BASE_URL", "http://vision.test/v1")
    monkeypatch.setenv("ACTISCAPE_VISION_MODEL", "expected-vision")

    def handler(request):
        return httpx.Response(200, json={"data": [{"id": "different-vision"}]})

    status = await vision_service_status(transport=httpx.MockTransport(handler))
    assert status["available"] is False
    assert status["error"] == "configured model is not served"
