import os

import httpx

from .config import scene_url


class SceneFailure(Exception):
    def __init__(self, status: int, data: dict):
        self.status = status
        self.code = data.get("error", "SCENE_ERROR")
        self.data = data
        super().__init__(data.get("message", "场景工具调用失败"))


class SceneClient:
    def __init__(self, base: str | None = None):
        self.base = (base or scene_url()).rstrip("/")

    async def request(self, path: str, body=None):
        timeout = (
            150
            if path.endswith("/render")
            else 90
            if "/tools/" in path or path.endswith("/source-audit")
            else 30
        )
        async with httpx.AsyncClient(timeout=timeout) as client:
            token = os.environ.get("ACTISCAPE_TOOL_TOKEN")
            response = await client.request(
                "GET" if body is None else "POST",
                self.base + "/api" + path,
                json=body,
                headers={"Authorization": "Bearer " + token} if token else {},
            )
            value = response.json()
            if not response.is_success:
                raise SceneFailure(response.status_code, value)
            return value

    async def image(self, path: str):
        async with httpx.AsyncClient(timeout=60) as client:
            token = os.environ.get("ACTISCAPE_TOOL_TOKEN")
            response = await client.get(
                self.base + "/api" + path,
                headers={"Authorization": "Bearer " + token} if token else {},
            )
            response.raise_for_status()
            return response.content
