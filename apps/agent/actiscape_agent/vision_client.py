"""OpenAI-compatible client for the local furniture-grounding VLM."""

from __future__ import annotations

import base64
import json
import time

import httpx

from .config import vision_model_settings


class VisionModelFailure(RuntimeError):
    def __init__(self, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.details = details or {}


async def vision_service_status(transport=None):
    settings = vision_model_settings()
    status = {
        "configured": bool(settings["base_url"] and settings["model"]),
        "available": False,
        "provider": settings["provider"],
        "model": settings["model"],
        "baseUrl": settings["base_url"],
    }
    try:
        async with httpx.AsyncClient(timeout=1.0, transport=transport) as client:
            response = await client.get(
                settings["base_url"] + "/models",
                headers={"authorization": "Bearer " + settings["api_key"]},
            )
        if response.status_code == 200:
            models = response.json().get("data") or []
            status["available"] = any(
                item.get("id") == settings["model"] for item in models if isinstance(item, dict)
            )
            if not status["available"]:
                status["error"] = "configured model is not served"
        else:
            status["error"] = response.text[:200]
    except (ValueError, httpx.HTTPError, OSError) as error:
        status["error"] = str(error)[:200]
    return status


class VisionModelClient:
    def __init__(self, transport=None):
        self.settings = vision_model_settings()
        self.transport = transport

    def record(self):
        return {
            key: self.settings[key]
            for key in ("provider", "model", "base_url", "timeout", "max_tokens")
        }

    async def complete(
        self,
        prompt: str,
        payload: dict,
        images: list[bytes],
        schema: dict,
        previous: str | None = None,
        parse_error: str | None = None,
    ):
        content = [
            {
                "type": "text",
                "text": json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            }
        ]
        for image in images:
            content.append(
                {
                    "type": "image_url",
                    "image_url": {
                        "url": "data:image/png;base64," + base64.b64encode(image).decode()
                    },
                }
            )
        messages = [
            {"role": "system", "content": prompt},
            {"role": "user", "content": content},
        ]
        if previous is not None:
            messages.extend(
                [
                    {"role": "assistant", "content": previous},
                    {
                        "role": "user",
                        "content": (
                            "上一次结果无法通过 JSON/Pydantic 校验。只修正格式和引用，"
                            "不得增加图像中没有的对象。错误：" + (parse_error or "结构无效")
                        ),
                    },
                ]
            )
        body = {
            "model": self.settings["model"],
            "messages": messages,
            "max_tokens": self.settings["max_tokens"],
            "temperature": self.settings["temperature"],
            "stream": False,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "FurnitureContourRecognition",
                    "schema": schema,
                    "strict": True,
                },
            },
        }
        started = time.monotonic()
        try:
            async with httpx.AsyncClient(
                timeout=self.settings["timeout"], transport=self.transport
            ) as client:
                response = await client.post(
                    self.settings["base_url"] + "/chat/completions",
                    headers={
                        "authorization": "Bearer " + self.settings["api_key"],
                        "content-type": "application/json",
                    },
                    json=body,
                )
        except (httpx.HTTPError, OSError) as error:
            raise VisionModelFailure(
                "VISION_MODEL_UNAVAILABLE",
                "本地视觉模型不可用",
                {
                    "model": self.settings["model"],
                    "error": str(error)[:300],
                    "seconds": round(time.monotonic() - started, 3),
                },
            ) from error
        if response.status_code != 200:
            raise VisionModelFailure(
                "VISION_MODEL_ERROR",
                "视觉模型请求失败",
                {
                    "status": response.status_code,
                    "model": self.settings["model"],
                    "body": response.text[:800],
                    "seconds": round(time.monotonic() - started, 3),
                },
            )
        try:
            value = response.json()
            message = value["choices"][0]["message"]["content"]
            if isinstance(message, list):
                message = "".join(
                    item.get("text", "") for item in message if isinstance(item, dict)
                )
            if not isinstance(message, str) or not message.strip():
                raise ValueError("missing message content")
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise VisionModelFailure(
                "VISION_MODEL_FORMAT",
                "视觉模型返回缺少结构化正文",
                {
                    "model": self.settings["model"],
                    "body": response.text[:800],
                    "seconds": round(time.monotonic() - started, 3),
                },
            ) from error
        return {
            "content": message,
            "model": value.get("model") or self.settings["model"],
            "usage": value.get("usage") or {},
            "seconds": round(time.monotonic() - started, 3),
            "structuredMode": body["response_format"]["type"],
        }
