"""Cloud-first, local-fallback A2A procurement quote client for safety hardware & HarmonyOS sensors."""

from __future__ import annotations

import asyncio
import json
import os
import re
import uuid
from typing import Any
from urllib.request import Request, urlopen

BUILTIN_PRICE_CATALOG: dict[str, dict[str, Any]] = {
    "seismic_anchor": {
        "skuId": "ANC-L304-01",
        "category": "seismic_anchor",
        "productName": "304不锈钢加厚L型防倾倒固定器（含M8膨胀螺栓对装）",
        "brandOrEcosystem": "国标建筑加固五金",
        "unitPriceCny": 29,
        "channel": "京东五金自营",
        "safetyPurpose": "将高危高深比柜体顶部与实体墙可靠锚固，消除地震倾覆砸床与封门隐患",
    },
    "mmwave_fall_sensor": {
        "skuId": "HW-MMWAVE-01",
        "category": "mmwave_fall_sensor",
        "productName": "华为全屋智能 AI 辅助康养传感器（毫米波防跌倒康养版）",
        "brandOrEcosystem": "华为鸿蒙智家 (HarmonyOS Connect)",
        "unitPriceCny": 1499,
        "channel": "华为商城 VMALL",
        "safetyPurpose": "顶角无盲区覆盖睡眠与起夜动线，无摄像头保护老人隐私并实现 24h 跌倒秒级告警",
    },
    "elderly_handrail": {
        "skuId": "ELDER-RAIL-01",
        "category": "elderly_handrail",
        "productName": "适老化抗菌防滑夜光一字助力扶手（600mm）",
        "brandOrEcosystem": "适老康养严选",
        "unitPriceCny": 128,
        "channel": "京东自营",
        "safetyPurpose": "辅助高龄或轮椅老人床侧起身与门厅稳姿通行",
    },
    "corner_protector": {
        "skuId": "ELDER-CORNER-01",
        "category": "corner_protector",
        "productName": "高弹加厚硅胶家具防撞护角（4只装）",
        "brandOrEcosystem": "适老家居五金",
        "unitPriceCny": 12,
        "channel": "京东自营",
        "safetyPurpose": "包覆茶几与低柜直角边缘，降低跌倒磕碰伤害",
    },
    "anti_slip_pad": {
        "skuId": "ANC-PAD-01",
        "category": "anti_slip_pad",
        "productName": "高分子纳米防震防滑阻尼垫（8片装，用于台面花瓶/摆件）",
        "brandOrEcosystem": "应急防灾严选",
        "unitPriceCny": 19,
        "channel": "京东自营",
        "safetyPurpose": "固定桌面花瓶与灯具底座，防止地震摇晃滑落摔碎",
    },
    "threshold_ramp": {
        "skuId": "ELDER-RAMP-01",
        "category": "threshold_ramp",
        "productName": "室内门槛零高差实心防滑橡胶斜坡垫（高15mm×宽900mm）",
        "brandOrEcosystem": "适老无障碍严选",
        "unitPriceCny": 45,
        "channel": "京东自营",
        "safetyPurpose": "抹平室内门槛高差并做防滑缓坡过渡，消除轮椅卡阻与迈步绊倒隐患",
    },
    "night_motion_light": {
        "skuId": "ELDER-LIGHT-01",
        "category": "night_motion_light",
        "productName": "床下人体红外+光感柔光起夜LED感应灯带（1.5米）",
        "brandOrEcosystem": "欧普照明 (OPPLE)",
        "unitPriceCny": 69,
        "channel": "京东自营",
        "safetyPurpose": "下床即亮 2700K 防眩暖光导向，避免老人夜间摸黑起夜跌倒",
    },
    "harmony_control_panel": {
        "skuId": "HW-PANEL-01",
        "category": "harmony_control_panel",
        "productName": "华为全屋智能 智能 Mini 免布线场景快捷键（床头一键起夜/呼救贴）",
        "brandOrEcosystem": "华为鸿蒙智家 (HarmonyOS Connect)",
        "unitPriceCny": 399,
        "channel": "华为商城 VMALL",
        "safetyPurpose": "贴装于床头或轮椅旁，实现免起身一键控光与康养紧急呼救",
    },
    "harmony_smart_lighting": {
        "skuId": "HW-LIGHT-01",
        "category": "harmony_smart_lighting",
        "productName": "鸿蒙智家生态 深杯防眩全光谱智能筒射灯（7W开孔75mm）",
        "brandOrEcosystem": "西顿照明 × HarmonyOS Connect",
        "unitPriceCny": 169,
        "channel": "华为商城 VMALL / 京东自营",
        "safetyPurpose": "采用 UGR<19 深杯防眩光学设计，消除卧室与客厅仰视强眩光不适",
    },
}

_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


def _strip_json_envelope(text: str) -> dict[str, Any]:
    cleaned = _FENCE_RE.sub("", text.strip()).strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end > start:
        cleaned = cleaned[start : end + 1]
    parsed = json.loads(cleaned)
    return parsed if isinstance(parsed, dict) else {}


def _parse_agentarts_sse_or_json(raw_text: str, content_type: str = "") -> dict[str, Any]:
    """Parse either Huawei Cloud AgentArts Single-Agent SSE stream or standard JSON response."""
    stripped = raw_text.lstrip()
    if "text/event-stream" in content_type.lower() or stripped.startswith("data:"):
        summary_text = ""
        message_chunks: list[str] = []
        for line in raw_text.splitlines():
            line_s = line.strip()
            if not line_s.startswith("data:"):
                continue
            payload_str = line_s[5:].strip()
            if not payload_str or payload_str == "[DONE]":
                continue
            try:
                frame = json.loads(payload_str)
            except json.JSONDecodeError:
                continue
            if not isinstance(frame, dict):
                continue
            ev = frame.get("event")
            content = frame.get("content")
            if ev == "summary_response" and isinstance(content, str) and content.strip():
                summary_text = content.strip()
            elif ev == "message" and isinstance(content, str):
                message_chunks.append(content)
        final_str = summary_text or "".join(message_chunks).strip()
        return _strip_json_envelope(final_str) if final_str else {}

    data = json.loads(raw_text)
    if isinstance(data, dict):
        if isinstance(data.get("result"), dict):
            return data["result"]
        if isinstance(data.get("output"), str):
            return _strip_json_envelope(data["output"])
        return data
    return {}


def build_required_items_from_plan(plan: dict, issue_codes: list[str] | None = None) -> list[dict]:
    """Derive required safety retrofit hardware & HarmonyOS sensors from scene state."""
    items: list[dict] = []
    furniture = plan.get("furniture") or []
    anchored = [
        f
        for f in furniture
        if (f.get("opt") or {}).get("wallAnchored") is True
        or (
            f.get("h", 0) >= 1400
            and f.get("h", 0) / max(1, min(f.get("w", 1), f.get("d", 1))) >= 2.2
        )
    ]
    if anchored:
        items.append(
            {
                "category": "seismic_anchor",
                "targetObjectName": "、".join(f.get("name", "高柜") for f in anchored[:3]),
                "quantity": len(anchored),
                "reasonCode": "SEISMIC_TOPPLE_BED_HAZARD",
            }
        )

    safety_profile = (plan.get("source") or {}).get("safetyProfile") or {}
    codes = set(issue_codes or [])
    if safety_profile.get("enabled") or codes & {
        "SENSOR_BLIND_SPOT",
        "WHEELCHAIR_TURNING_BLOCKED",
    }:
        sensors = safety_profile.get("radarSensors") or [{}]
        items.append(
            {
                "category": "mmwave_fall_sensor",
                "targetObjectName": "卧室/客餐厅重点看护区",
                "quantity": max(1, len(sensors)),
                "reasonCode": "SENSOR_BLIND_SPOT",
            }
        )
    if safety_profile.get("elderlyWheelchair") or "WHEELCHAIR_TURNING_BLOCKED" in codes:
        items.append(
            {
                "category": "elderly_handrail",
                "targetObjectName": "床侧及门厅无障碍动线",
                "quantity": 2,
                "reasonCode": "WHEELCHAIR_TURNING_BLOCKED",
            }
        )
    tables = [
        f for f in furniture if any(k in (f.get("key") or "").lower() for k in ("table", "desk"))
    ]
    if tables and (safety_profile.get("enabled") or codes):
        items.append(
            {
                "category": "corner_protector",
                "targetObjectName": tables[0].get("name", "桌面"),
                "quantity": min(3, len(tables)),
                "reasonCode": "ELDERLY_COLLISION_RISK",
            }
        )
    return items


def _call_remote_procurement_agent(url: str, api_key: str, payload: dict) -> dict:
    is_agentarts_runtime = "/invocations" in url or "huaweicloud-agentarts.com" in url
    wire_payload = (
        {"inputs": {"query": json.dumps(payload, ensure_ascii=False)}}
        if is_agentarts_runtime
        else payload
    )
    body = json.dumps(wire_payload, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    if is_agentarts_runtime:
        headers["x-hw-agentarts-session-id"] = f"actiscape-{uuid.uuid4().hex[:16]}"
    req = Request(url, data=body, headers=headers, method="POST")
    timeout_s = 22.0 if is_agentarts_runtime else 6.0
    with urlopen(req, timeout=timeout_s) as resp:
        raw_text = resp.read().decode("utf-8", "replace")
        content_type = resp.headers.get("Content-Type", "")
    return _parse_agentarts_sse_or_json(raw_text, content_type)


async def generate_procurement_quote(
    project_id: str,
    plan: dict,
    issue_codes: list[str] | None = None,
    budget_limit_cny: int = 5000,
) -> dict[str, Any]:
    """Request quote from AgentArts Procurement Sub-Agent with deterministic local fallback."""
    required = build_required_items_from_plan(plan, issue_codes)
    request_payload = {
        "projectId": project_id,
        "scenario": "elderly_and_seismic_retrofit",
        "budgetLimitCny": budget_limit_cny,
        "requiredItems": required,
    }
    remote_url = os.environ.get("PROCUREMENT_AGENT_URL", "").strip()
    remote_key = os.environ.get("PROCUREMENT_AGENT_API_KEY", "").strip()
    if remote_url and required:
        try:
            remote_quote = await asyncio.to_thread(
                _call_remote_procurement_agent, remote_url, remote_key, request_payload
            )
            if isinstance(remote_quote, dict) and isinstance(remote_quote.get("lineItems"), list):
                return {**remote_quote, "provider": "agentarts-a2a-subagent"}
        except Exception:
            pass

    line_items = []
    total = 0
    for req_item in required:
        cat = req_item["category"]
        sku = BUILTIN_PRICE_CATALOG.get(cat)
        if not sku:
            continue
        qty = max(1, int(req_item.get("quantity", 1)))
        sub = int(sku["unitPriceCny"]) * qty
        total += sub
        line_items.append(
            {
                "skuId": sku["skuId"],
                "category": cat,
                "productName": sku["productName"],
                "brandOrEcosystem": sku["brandOrEcosystem"],
                "unitPriceCny": sku["unitPriceCny"],
                "quantity": qty,
                "subtotalCny": sub,
                "channel": sku["channel"],
                "safetyPurpose": f"针对【{req_item['targetObjectName']}】：{sku['safetyPurpose']}",
            }
        )
    within = total <= budget_limit_cny
    return {
        "schemaVersion": "actiscape.procurement.v1",
        "provider": "builtin-reference-catalog",
        "currency": "CNY",
        "totalEstimatedCny": total,
        "withinBudget": within,
        "summary": (
            f"共配置 {len(line_items)} 类居家防震加固与华为鸿蒙智家康养设备，预估总造价 {total} 元"
            + ("（预算内）。" if within else f"（超出预算上限 {budget_limit_cny} 元，可按需分批采购）。")
        ),
        "lineItems": line_items,
    }
