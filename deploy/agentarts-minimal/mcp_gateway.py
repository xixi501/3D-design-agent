"""MCP gateway client for ActiScape tools on Huawei Cloud AgentArts.

Supports Huawei IAM Signature V11 (``SDK-HMAC-SHA256``) with automatic 3-tier
credential resolution:
1. Explicit ``AGENTARTS_MCP_AK`` / ``SK`` (+ ``AGENTARTS_MCP_SECURITY_TOKEN``)
2. Standard SDK ``HUAWEICLOUD_SDK_AK`` / ``SK`` (+ ``HUAWEICLOUD_SDK_SECURITY_TOKEN``)
3. Huawei Cloud Runtime / ECS IAM Agency temporary STS metadata endpoint
   (``DefaultAgentArtsRuntimeAgency``), eliminating static AK/SK residency when
   agency metadata is reachable.
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
from urllib.request import ProxyHandler, Request, build_opener, urlopen

DEFAULT_MCP_URL = (
    "https://actiscape-tools-defaultgw-gu2wkyrzha.cn-southwest-2.huaweicloud-agentarts.com/mcp"
)
TOOL_SCENE_CHECKS = "actiscape-scene_get_scene_checks"
TOOL_NAME = TOOL_SCENE_CHECKS  # Backwards-compatible alias
METADATA_SECURITYKEY_URL = "http://169.254.169.254/openstack/latest/securitykey"

_AGENCY_CACHE: dict[str, str | float | None] = {
    "access": None,
    "secret": None,
    "token": None,
    "expires_at": 0.0,
}


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


def _agency_credentials() -> tuple[str, str, str | None]:
    now = time.time()
    if (
        _AGENCY_CACHE["access"]
        and _AGENCY_CACHE["secret"]
        and float(_AGENCY_CACHE["expires_at"] or 0.0) - now > 60.0
    ):
        return (
            str(_AGENCY_CACHE["access"]),
            str(_AGENCY_CACHE["secret"]),
            str(_AGENCY_CACHE["token"]) if _AGENCY_CACHE["token"] else None,
        )
    try:
        opener = build_opener(ProxyHandler({}))
        req = Request(METADATA_SECURITYKEY_URL, method="GET")
        with opener.open(req, timeout=1.5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        cred = data.get("credential") or data
        ak = str(cred.get("access") or "").strip()
        sk = str(cred.get("secret") or "").strip()
        st = str(cred.get("securitytoken") or "").strip() or None
        exp_str = cred.get("expires_at")
        exp_ts = now + 600.0
        if isinstance(exp_str, str) and exp_str:
            try:
                exp_ts = datetime.fromisoformat(exp_str.replace("Z", "+00:00")).timestamp()
            except Exception:
                pass
        if ak and sk:
            _AGENCY_CACHE.update(access=ak, secret=sk, token=st, expires_at=exp_ts)
            return ak, sk, st
    except Exception:
        pass
    return "", "", None


def _credentials() -> tuple[str, str, str | None]:
    access = (
        os.environ.get("AGENTARTS_MCP_AK")
        or os.environ.get("HUAWEICLOUD_SDK_AK")
        or ""
    ).strip()
    secret = (
        os.environ.get("AGENTARTS_MCP_SK")
        or os.environ.get("HUAWEICLOUD_SDK_SK")
        or ""
    ).strip()
    token = (
        os.environ.get("AGENTARTS_MCP_SECURITY_TOKEN")
        or os.environ.get("HUAWEICLOUD_SDK_SECURITY_TOKEN")
        or None
    )
    if access and secret:
        return access, secret, token
    return _agency_credentials()


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


async def call_mcp_tool(
    tool_name: str,
    arguments: dict,
    timeout: float = 45.0,
) -> dict:
    """Generic JSON-RPC tools/call wrapper against the AgentArts MCP gateway."""
    started = time.monotonic()
    request_id = str(uuid.uuid4())
    access, secret, token = await asyncio.to_thread(_credentials)
    if not access or not secret:
        return {
            "ok": False,
            "request_id": request_id,
            "error": "missing_credentials",
            "message": "运行时缺少 IAM 凭据（环境变量或运行时委托均未提供可用 AK/SK）",
            "ms": 0,
        }
    body = json.dumps(
        {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments,
            },
        },
        ensure_ascii=False,
    ).encode("utf-8")
    url = mcp_url()
    headers = sign_v11(access, secret, "POST", url, body, token)
    try:
        status, text = await asyncio.to_thread(_post, url, body, headers, timeout)
    except Exception as exc:
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
    except Exception as exc:
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
    return {
        "ok": True,
        "request_id": request_id,
        "data": structured or {},
        "ms": ms,
    }


async def call_scene_checks(project_id: str, timeout: float = 45.0) -> dict:
    """Call ``actiscape-scene_get_scene_checks`` through the MCP gateway."""
    res = await call_mcp_tool(
        TOOL_SCENE_CHECKS,
        {"path": {"id": project_id}},
        timeout=timeout,
    )
    if not res.get("ok"):
        return res
    structured = res.get("data") or {}
    issues = structured.get("issues") if isinstance(structured, dict) else None
    return {
        "ok": True,
        "request_id": res["request_id"],
        "revision": structured.get("revision") if isinstance(structured, dict) else None,
        "issues": issues if isinstance(issues, list) else [],
        "ms": res["ms"],
    }
