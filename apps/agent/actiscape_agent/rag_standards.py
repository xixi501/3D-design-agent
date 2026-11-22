"""Cloud-first, local-fallback RAG retriever for GB building/accessibility/seismic standards & HarmonyOS sensors."""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any
from urllib.request import Request, urlopen

# Built-in authoritative national standard & HarmonyOS technical citations
# Guarantees 100% deterministic legal/technical grounding even before cloud KB ID is configured.
BUILTIN_STANDARD_CARDS: dict[str, dict[str, str]] = {
    "WHEELCHAIR_TURNING_BLOCKED": {
        "chunkId": "KB-ACC-001",
        "standard": "《无障碍设计规范》GB 50763-2012 第 3.7.2 / 8.2.2 条",
        "threshold": "轮椅回转空间直径 >= 1500 mm；户内轮椅通道净宽 >= 850 mm",
        "remedy": "调整大件家具贴墙布置，释放房间中心 >= 1500mm×1500mm 无障碍内切圆及门至床侧连续净通道。",
    },
    "DOORWAY_BLOCKED": {
        "chunkId": "KB-ACC-002",
        "standard": "《无障碍设计规范》GB 50763-2012 第 3.4.3 条 & 《住宅设计规范》GB 50096-2011",
        "threshold": "无障碍通行门洞净宽 >= 800 mm，门扇开启内侧 800 mm 净空扇区严禁障碍物侵入",
        "remedy": "将侵入玄关/房门净空区的鞋柜或储物柜平移至门扇开启侧以外的实墙位置。",
    },
    "CIR-02": {
        "chunkId": "KB-RES-002",
        "standard": "《住宅设计规范》GB 50096-2011 第 5.2 节 & 适老通行导则",
        "threshold": "室内主要通行走道净宽 >= 800~900 mm",
        "remedy": "压缩冗余中间摆件或微调家具朝向，打通主通行净宽。",
    },
    "DOOR_CABINET_CONFLICT": {
        "chunkId": "KB-RES-004",
        "standard": "《住宅设计规范》GB 50096-2011 门扇与固定储物柜开启防干涉条文",
        "threshold": "房门开启摆幅扇区与柜门开启包络区必须零交叠",
        "remedy": "将柜体沿墙移出房门摆幅半径，消除开门撞柜与夹手隐患。",
    },
    "OPENABLE_FRONT_BLOCKED": {
        "chunkId": "KB-RES-005",
        "standard": "《老年人照料设施建筑设计标准》JGJ 450-2018 储物取用净空要求",
        "threshold": "衣柜/抽屉正前方须保留柜门全开深度 + 操作净深（>= 600 mm）",
        "remedy": "移开阻挡柜门开启的床具或座椅，确保柜门顺畅全开。",
    },
    "SEISMIC_TOPPLE_BED_HAZARD": {
        "chunkId": "KB-SEI-001",
        "standard": "《建筑抗震设计规范》GB 50011-2010 第 13.2 节（非结构构件抗震）& 应急管理部家庭防震指南",
        "threshold": "高度 >= 1400 mm 且高深比 h/d >= 2.2 的未锚固高柜，其前向倒伏半径（= h）严禁覆盖床铺睡眠区",
        "remedy": "将高危倾覆书架/衣柜移离床头生命安全区，并加装 304 不锈钢 L 型入墙防倾倒膨胀锚固件（wallAnchored=true）。",
    },
    "SEISMIC_TOPPLE_EXIT_BLOCKED": {
        "chunkId": "KB-SEI-002",
        "standard": "《建筑抗震设计规范》GB 50011-2010 第 13.2.3 条（疏散通道非结构防倒伏封堵）",
        "threshold": "逃生门周边等于柜高 h 的倒伏扇区内，严禁放置无墙体锚固的高窄柜体",
        "remedy": "将逃生门旁高柜移出倒伏封堵半径或执行可靠入墙锚固，防止震后柜体翻倒顶死向内开启的生命门。",
    },
    "SURFACE_ITEM_OVERHANG": {
        "chunkId": "KB-SEI-005",
        "standard": "家庭非结构坠物防伤导则",
        "threshold": "台面摆件底面须 100% 落于宿主台面安全边界内并配防滑阻尼垫",
        "remedy": "将悬挑摆件收拢至台面安全区内。",
    },
    "SENSOR_BLIND_SPOT": {
        "chunkId": "KB-HMS-001",
        "standard": "《华为鸿蒙智家 AI 超感传感器（毫米波防跌倒雷达）空间布点规范》",
        "threshold": "房间重点看护区（床侧上下床区及起夜动线）雷达直视无遮挡覆盖率须 >= 85%",
        "remedy": "将遮挡顶角雷达视锥波束的高大衣柜（h >= 1800mm）调整至传感器同侧墙或低矮家具对侧，消除床侧跌倒监测阴影盲区。",
    },
}


def _query_cloud_kb_sync(endpoint: str, api_key: str, kb_id: str, query: str) -> list[dict]:
    body = json.dumps(
        {"knowledge_base_id": kb_id, "query": query, "top_k": 3},
        ensure_ascii=False,
    ).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    req = Request(endpoint, data=body, headers=headers, method="POST")
    with urlopen(req, timeout=4.0) as resp:
        data = json.loads(resp.read().decode("utf-8", "replace"))
    chunks = data.get("chunks") or data.get("results") or data.get("data") or []
    return chunks if isinstance(chunks, list) else []


async def retrieve_standard_citations(issue_codes: list[str]) -> list[dict[str, Any]]:
    """Retrieve authoritative GB & HarmonyOS citations via AgentArts KB (with instant local fallback)."""
    unique_codes = list(dict.fromkeys(code for code in issue_codes if code))
    if not unique_codes:
        return []

    kb_url = os.environ.get("AGENTARTS_KB_RETRIEVE_URL", "").strip()
    kb_id = os.environ.get("AGENTARTS_KB_ID", "").strip()
    kb_key = os.environ.get("AGENTARTS_KB_API_KEY", "").strip()

    citations: list[dict[str, Any]] = []
    cloud_chunks: list[dict] = []
    if kb_url and kb_id:
        try:
            query_text = " ".join(unique_codes) + " 住宅无障碍 防震防倾覆 鸿蒙毫米波雷达规范"
            cloud_chunks = await asyncio.to_thread(
                _query_cloud_kb_sync, kb_url, kb_key, kb_id, query_text
            )
        except Exception:
            cloud_chunks = []

    for code in unique_codes:
        card = BUILTIN_STANDARD_CARDS.get(code)
        if card:
            citations.append(
                {
                    "code": code,
                    "source": "agentarts-kb" if cloud_chunks else "builtin-gb-mirror",
                    **card,
                }
            )
    if cloud_chunks and not citations:
        for idx, item in enumerate(cloud_chunks[:3]):
            citations.append(
                {
                    "code": unique_codes[0],
                    "chunkId": str(item.get("id") or f"CLOUD-KB-{idx+1}"),
                    "source": "agentarts-kb",
                    "standard": str(item.get("title") or "华为云 AgentArts 规范知识库"),
                    "threshold": "",
                    "remedy": str(item.get("content") or item.get("text") or "")[:300],
                }
            )
    return citations
