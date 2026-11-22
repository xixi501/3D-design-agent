"""Unit tests for M1/M3 AgentArts telemetry, GB RAG citations, household memory, A2A procurement & sandbox solver."""

from __future__ import annotations

import json

import pytest

from actiscape_agent.memory_profile import recall_and_update_household_memory
from actiscape_agent.policy import RepairPolicyRouter
from actiscape_agent.procurement_client import (
    _parse_agentarts_sse_or_json,
    generate_procurement_quote,
)
from actiscape_agent.rag_standards import retrieve_standard_citations
from actiscape_agent.sandbox_solver import solve_safe_placements
from actiscape_agent.telemetry import record_current_span, trace_stage


@pytest.mark.asyncio
async def test_gb_rag_standard_citations_cover_safety_codes():
    citations = await retrieve_standard_citations(
        [
            "WHEELCHAIR_TURNING_BLOCKED",
            "SEISMIC_TOPPLE_BED_HAZARD",
            "SEISMIC_TOPPLE_EXIT_BLOCKED",
            "SEISMIC_UNANCHORED_CABINET",
            "SENSOR_BLIND_SPOT",
        ]
    )
    assert len(citations) == 5
    standards_text = " ".join(c["standard"] for c in citations)
    assert "GB 50763" in standards_text
    assert "GB 50011" in standards_text
    assert "鸿蒙智家" in standards_text


@pytest.mark.asyncio
async def test_gb_rag_console_internal_kb_id_and_synced_corpus(monkeypatch):
    monkeypatch.setenv("AGENTARTS_KB_ID", "5498b33119c8456f9bbe20404191cf2a")
    monkeypatch.setenv("AGENTARTS_KB_RETRIEVE_URL", "console-internal")
    citations = await retrieve_standard_citations(["SENSOR_BLIND_SPOT", "THRESHOLD_TRIP_HAZARD"])
    assert len(citations) >= 1
    assert citations[0]["source"] == "agentarts-kb"
    assert citations[0]["knowledgeBaseId"] == "5498b33119c8456f9bbe20404191cf2a"


def test_agentarts_sse_parser_handles_summary_response_without_duplication():
    quote_obj = {
        "schemaVersion": "actiscape.procurement.v1",
        "currency": "CNY",
        "totalEstimatedCny": 1557,
        "withinBudget": True,
        "summary": "共配置 2 项设备",
        "lineItems": [{"skuId": "ANC-L304-01", "subtotalCny": 58}, {"skuId": "HW-MMWAVE-01", "subtotalCny": 1499}],
    }
    quote_str = json.dumps(quote_obj, ensure_ascii=False)
    sse_raw = "\n".join(
        [
            'data: {"event":"start","createdTime":1}',
            'data: {"event":"message","reasoning_content":"calc...","createdTime":2}',
            f"data: {json.dumps({'event': 'message', 'content': quote_str[:25]}, ensure_ascii=False)}",
            f"data: {json.dumps({'event': 'message', 'content': quote_str[25:]}, ensure_ascii=False)}",
            f"data: {json.dumps({'event': 'summary_response', 'content': quote_str, 'role': 'assistant'}, ensure_ascii=False)}",
            'data: {"event":"done","createdTime":5}',
        ]
    )
    parsed = _parse_agentarts_sse_or_json(sse_raw, "text/event-stream; charset=utf-8")
    assert parsed["schemaVersion"] == "actiscape.procurement.v1"
    assert parsed["totalEstimatedCny"] == 1557
    assert len(parsed["lineItems"]) == 2


@pytest.mark.asyncio
async def test_household_memory_persists_wheelchair_and_seismic_cues(tmp_path, monkeypatch):
    monkeypatch.setenv("ACTISCAPE_AGENT_DIR", str(tmp_path))
    p1 = await recall_and_update_household_memory(
        "家里老人坐 680mm 加宽电动轮椅，按 8度防震要求布置", scope_key="user_demo"
    )
    assert p1["elderlyWheelchair"] is True
    assert p1["wheelchairWidthMm"] == 680
    assert p1["seismicProtection"] is True
    assert p1["seismicIntensity"] == 8

    # Cross-conversation recall without repeating cues
    p2 = await recall_and_update_household_memory("帮我看看次卧怎么摆书桌", scope_key="user_demo")
    assert p2["elderlyWheelchair"] is True
    assert p2["wheelchairWidthMm"] == 680
    assert p2["seismicIntensity"] == 8


@pytest.mark.asyncio
async def test_procurement_quote_generates_accurate_bom(monkeypatch):
    monkeypatch.delenv("PROCUREMENT_AGENT_URL", raising=False)
    plan = {
        "source": {"safetyProfile": {"enabled": True, "elderlyWheelchair": True}},
        "furniture": [
            {"id": "cab1", "name": "高窄书柜", "key": "bookshelf", "w": 900, "d": 350, "h": 2100},
            {"id": "tb1", "name": "实木茶几", "key": "coffeeTable", "w": 1200, "d": 600, "h": 420},
        ],
    }
    quote = await generate_procurement_quote(
        "proj-01",
        plan,
        issue_codes=["SEISMIC_TOPPLE_BED_HAZARD", "SENSOR_BLIND_SPOT"],
        budget_limit_cny=5000,
    )
    assert quote["schemaVersion"] == "actiscape.procurement.v1"
    assert quote["withinBudget"] is True
    categories = {item["category"] for item in quote["lineItems"]}
    assert "seismic_anchor" in categories
    assert "mmwave_fall_sensor" in categories
    assert "elderly_handrail" in categories
    assert quote["totalEstimatedCny"] == sum(i["subtotalCny"] for i in quote["lineItems"])


@pytest.mark.asyncio
async def test_neuro_symbolic_sandbox_solver_clears_bed_and_door_hazards():
    plan = {
        "nodes": [
            {"id": "n1", "x": 0, "y": 0},
            {"id": "n2", "x": 4800, "y": 0},
            {"id": "n3", "x": 4800, "y": 3800},
            {"id": "n4", "x": 0, "y": 3800},
        ],
        "walls": [
            {"id": "w1", "a": "n1", "b": "n2", "t": 200},
            {"id": "w2", "a": "n2", "b": "n3", "t": 200},
            {"id": "w3", "a": "n3", "b": "n4", "t": 200},
            {"id": "w4", "a": "n4", "b": "n1", "t": 200},
        ],
        "openings": [{"id": "door1", "wall": "w3", "type": "door", "at": 0.8, "w": 900}],
        "furniture": [
            {
                "id": "bed1",
                "name": "双人床",
                "type": "bed",
                "key": "bed18",
                "x": 2400,
                "y": 1300,
                "w": 1800,
                "d": 2100,
                "h": 1000,
                "rot": 0,
            },
            {
                "id": "shelf1",
                "name": "高危书架",
                "type": "bookshelf",
                "key": "bookshelf",
                "x": 960,
                "y": 3300,
                "w": 900,
                "d": 350,
                "h": 2100,
                "rot": 0,
            },
        ],
        "source": {
            "safetyProfile": {
                "enabled": True,
                "radarSensors": [{"id": "s1", "x": 300, "y": 300, "z": 2200}],
            }
        },
    }
    solved = await solve_safe_placements(plan, target_ids=["shelf1"])
    assert len(solved["recommendations"]) == 1
    rec = solved["recommendations"][0]
    assert rec["id"] == "shelf1"
    assert rec["wallAnchored"] is True
    # Must move away from door1 at (~960, 3800)
    assert abs(rec["x"] - 960) > 700 or abs(rec["y"] - 3300) > 700


def test_telemetry_and_repair_router_handle_new_safety_codes():
    with trace_stage("unit_test_span", {"mode": "edit"}):
        record_current_span({"issue_codes": ["SEISMIC_TOPPLE_BED_HAZARD"]})

    router = RepairPolicyRouter()
    for code in (
        "WHEELCHAIR_TURNING_BLOCKED",
        "SEISMIC_TOPPLE_BED_HAZARD",
        "SEISMIC_TOPPLE_EXIT_BLOCKED",
        "SENSOR_BLIND_SPOT",
    ):
        directive = router.route(
            {"issues": [{"code": code, "objectIds": ["obj-1"], "message": "隐患"}]}
        )
        assert directive is not None
        assert directive.targetRole == "design"
        assert directive.objectIds == ["obj-1"]
