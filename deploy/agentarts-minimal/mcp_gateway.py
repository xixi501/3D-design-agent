"""Read-only MCP gateway client for ActiScape scene checks.

The AgentArts gateway (``actiscape-tools``) authenticates with the Huawei IAM
signature scheme V11 (``SDK-HMAC-SHA256``).  Credentials are read from the
runtime environment only; nothing is baked into the image or the repository.

Environment variables
---------------------
``AGENTARTS_MCP_URL``            gateway ``/mcp`` endpoint (override)
``AGENTARTS_MCP_AK`` / ``SK``    credentials (fallback: ``HUAWEICLOUD_SDK_AK`` / ``SK``)
``AGENTARTS_MCP_SECURITY_TOKEN`` optional temporary-credential token
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

DEFAULT_MCP_URL = (
    "https://actiscape-tools-defaultgw-gu2wkyrzha.cn-southwest-2.huaweicloud-agentarts.com/mcp"
)
TOOL_NAME = "actiscape-scene_get_scene_checks"


def _hex_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sign_v11(
    access: str,
    secret: str,
    method: str,
    url: str,
    body: bytes,
    token: str | None = None,
) -> dict[str, str]:
    """Build Huawei IAM V11 (SDK-HMAC-SHA256) headers for one request."""
    parts = urlsplit(url)
    host = parts.netloc
    uri = parts.path or "/"
    query = parts.query or ""
    date = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    headers = {"content-type": "application/json", "host": host, "x-sdk-date": date}
    if token:
        headers["x-security-token"] = token
    names = sorted(headers)
    canonical_headers = "".join(f"{name}:{headers[name]}\n" for name in names)
    signed = ";".join(names)
    canonical_request = "\n".join(
        [method.upper(), uri, query, canonical_headers, signed, _hex_sha256(body)]
    )
    string_to_sign = "\n".join(
        ["SDK-HMAC-SHA256", date, _hex_sha256(canonical_request.encode("utf-8"))]
    )
    signature = hmac.new(
        secret.encode("utf-8"), string_to_sign.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    out = {
        "Content-Type": "application/json",
        "X-Sdk-Date": date,
        "Authorization": (
            f"SDK-HMAC-SHA256 Access={access}, SignedHeaders={signed}, Signature={signature}"
        ),
    }
    if token:
        out["X-Security-Token"] = token
    return out


def _credentials() -> tuple[str, str, str | None]:
    access = os.environ.get("AGENTARTS_MCP_AK") or os.environ.get("HUAWEICLOUD_SDK_AK") or ""
    secret = os.environ.get("AGENTARTS_MCP_SK") or os.environ.get("HUAWEICLOUD_SDK_SK") or ""
    token = (
        os.environ.get("AGENTARTS_MCP_SECURITY_TOKEN")
        or os.environ.get("HUAWEICLOUD_SDK_SECURITY_TOKEN")
        or None
    )
    return access.strip(), secret.strip(), token


def mcp_url() -> str:
    return os.environ.get("AGENTARTS_MCP_URL", DEFAULT_MCP_URL).strip() or DEFAULT_MCP_URL


def _post(url: str, body: bytes, headers: dict[str, str], timeout: float) -> tuple[int, str]:
    request = Request(url, data=body, headers=headers, method="POST")
    with urlopen(request, timeout=timeout) as response:
        return response.status, response.read().decode("utf-8", "replace")


def _extract(payload: dict) -> tuple[dict | None, str | None]:
    result = payload.get("result") or {}
    if result.get("isError"):
        content = result.get("content") or []
        text = " ".join(
            str(item.get("text", "")) for item in content if isinstance(item, dict)
        )
        return None, text or "MCP tool returned isError"
    structured = result.get("structuredContent")
    if isinstance(structured, dict):
        return structured, None
    for item in result.get("content") or []:
        if isinstance(item, dict) and item.get("type") == "text":
            try:
                return json.loads(item["text"]), None
            except Exception:
                return {"text": item.get("text")}, None
    return None, "MCP 响应缺少 structuredContent"


async def call_scene_checks(project_id: str, timeout: float = 45.0) -> dict:
    """Call ``actiscape-scene_get_scene_checks`` through the MCP gateway."""
    started = time.monotonic()
    request_id = str(uuid.uuid4())
    access, secret, token = _credentials()
    if not access or not secret:
        return {
            "ok": False,
            "request_id": request_id,
            "error": "missing_credentials",
            "message": "运行时缺少 IAM 凭据（AGENTARTS_MCP_AK/SK 或 HUAWEICLOUD_SDK_AK/SK）",
            "ms": 0,
        }
    body = json.dumps(
        {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "tools/call",
            "params": {
                "name": TOOL_NAME,
                "arguments": {"path": {"id": project_id}},
            },
        },
        ensure_ascii=False,
    ).encode("utf-8")
    url = mcp_url()
    headers = sign_v11(access, secret, "POST", url, body, token)
    try:
        status, text = await asyncio.to_thread(_post, url, body, headers, timeout)
    except Exception as exc:  # noqa: BLE001 - surfaced to the task result
        return {
            "ok": False,
            "request_id": request_id,
            "error": "transport_error",
            "message": f"{type(exc).__name__}: {exc}",
            "ms": int((time.monotonic() - started) * 1000),
        }
    ms = int((time.monotonic() - started) * 1000)
    if status != 200:
        return {
            "ok": False,
            "request_id": request_id,
            "error": f"http_{status}",
            "message": text[:300],
            "ms": ms,
        }
    try:
        payload = json.loads(text)
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "request_id": request_id,
            "error": "bad_json",
            "message": str(exc),
            "ms": ms,
        }
    if payload.get("error"):
        return {
            "ok": False,
            "request_id": request_id,
            "error": "rpc_error",
            "message": json.dumps(payload["error"], ensure_ascii=False)[:300],
            "ms": ms,
        }
    structured, error = _extract(payload)
    if error:
        return {
            "ok": False,
            "request_id": request_id,
            "error": "tool_error",
            "message": error,
            "ms": ms,
        }
    issues = structured.get("issues") if isinstance(structured, dict) else None
    return {
        "ok": True,
        "request_id": request_id,
        "revision": (structured or {}).get("revision"),
        "issues": issues if isinstance(issues, list) else [],
        "ms": ms,
    }
