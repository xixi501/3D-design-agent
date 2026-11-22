"""Household safety & accessibility profile memory (AgentArts Memory SDK + local SQLite/JSON mirror)."""

from __future__ import annotations

import asyncio
import json
import os
import re
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

from .config import state_directory
from .telemetry import trace_stage


def _extract_profile_cues(text: str) -> dict[str, Any]:
    cues: dict[str, Any] = {}
    if any(k in text for k in ("轮椅", "无障碍", "适老", "老人", "高龄", "独居", "助行器")):
        cues["elderlyWheelchair"] = True
    m_width = re.search(
        r"(?:轮椅[^\d]{0,10}(\d{3,4})\s*(?:mm|毫米)|(\d{3,4})\s*(?:mm|毫米)[^。，,\n]{0,10}轮椅)",
        text,
    )
    if m_width:
        cues["wheelchairWidthMm"] = int(m_width.group(1) or m_width.group(2))
    if any(k in text for k in ("地震", "防震", "抗震", "防倾倒", "防倾覆", "砸床")):
        cues["seismicProtection"] = True
        m_deg = re.search(r"([678])\s*度", text)
        cues["seismicIntensity"] = int(m_deg.group(1)) if m_deg else 7
    if any(k in text for k in ("毫米波", "雷达", "防跌倒", "超感传感器", "鸿蒙智家", "全屋智能", "盲区")):
        cues["harmonyRadar"] = True
    return cues


def _local_memory_path() -> Path:
    d = state_directory()
    d.mkdir(parents=True, exist_ok=True)
    return d / "household_memory.json"


def _read_local_memory(scope_key: str) -> dict[str, Any]:
    p = _local_memory_path()
    if not p.exists():
        return {}
    try:
        all_mem = json.loads(p.read_text(encoding="utf-8"))
        return dict(all_mem.get(scope_key) or all_mem.get("default") or {})
    except Exception:
        return {}


def _write_local_memory(scope_key: str, profile: dict[str, Any]) -> None:
    p = _local_memory_path()
    try:
        all_mem = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    except Exception:
        all_mem = {}
    merged = {**(all_mem.get("default") or {}), **(all_mem.get(scope_key) or {}), **profile}
    all_mem[scope_key] = merged
    all_mem["default"] = merged
    p.write_text(json.dumps(all_mem, ensure_ascii=False, indent=2), encoding="utf-8")


def _sync_agentarts_memory(action: str, scope_key: str, payload: dict[str, Any]) -> dict[str, Any]:
    endpoint = os.environ.get("AGENTARTS_MEMORY_URL", "").strip()
    token = os.environ.get("AGENTARTS_MEMORY_TOKEN", "").strip()
    if not endpoint:
        return {}
    req_body = json.dumps(
        {"action": action, "namespace": "actiscape_household", "userId": scope_key, **payload},
        ensure_ascii=False,
    ).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = Request(endpoint, data=req_body, headers=headers, method="POST")
    with urlopen(req, timeout=3.0) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


async def recall_and_update_household_memory(
    user_input: str, scope_key: str = "default"
) -> dict[str, Any]:
    """Recall persisted household constraints and merge new cues from user_input."""
    with trace_stage("memory.recall_and_update", {"memory_scope": scope_key}) as span:
        stored = _read_local_memory(scope_key)
        if os.environ.get("AGENTARTS_MEMORY_URL", "").strip():
            try:
                cloud_res = await asyncio.to_thread(
                    _sync_agentarts_memory, "search", scope_key, {"query": user_input}
                )
                if isinstance(cloud_res.get("profile"), dict):
                    stored.update(cloud_res["profile"])
            except Exception:
                pass

        new_cues = _extract_profile_cues(user_input or "")
        if new_cues:
            stored.update(new_cues)
            _write_local_memory(scope_key, stored)
            if os.environ.get("AGENTARTS_MEMORY_URL", "").strip():
                try:
                    await asyncio.to_thread(
                        _sync_agentarts_memory, "upsert", scope_key, {"profile": stored}
                    )
                except Exception:
                    pass
        if span is not None:
            span.set_attribute("actiscape.memory.cues_found", bool(stored))
        return stored
