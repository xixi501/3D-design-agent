"""Huawei Cloud AgentArts Runtime entrypoint (supports probe, run_task, resume_task, cancel_task)."""

import os
from datetime import datetime, timezone
from typing import TypedDict

from actiscape_agent.client import SceneClient
from actiscape_agent.model import create_model
from agentarts.sdk import AgentArtsRuntimeApp, RequestContext
from langchain.agents import create_agent
from langchain.agents.structured_output import ToolStrategy
from langchain_core.tools import tool
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field
from task_runtime import cancel_task, resume_task, run_task

app = AgentArtsRuntimeApp()


class Input(BaseModel):
    requestId: str = Field(min_length=1, max_length=100)
    projectId: str
    objectId: str
    baseRevision: int = Field(ge=0)
    originalX: float
    targetX: float


class Probe(BaseModel):
    objectId: str
    observedX: float
    catalogueCount: int


class State(TypedDict, total=False):
    payload: dict
    before: dict
    proof: dict
    alreadyDone: bool
    moveAccepted: bool
    result: dict


def operation(payload: dict, kind: str):
    return f"platform:{payload['requestId']}:{kind}"


async def read(state: State):
    p = state["payload"]
    client = SceneClient()
    before = await client.request(f"/projects/{p['projectId']}")
    if not before["plan"]["name"].startswith("AgentArts 联通验证"):
        raise ValueError("平台冒烟只允许专用测试项目")
    if abs(p["targetX"] - p["originalX"]) > 1000:
        raise ValueError("联通验证移动距离最多 1000 mm")
    if not any(f["id"] == p["objectId"] for f in before["plan"]["furniture"]):
        raise ValueError("测试对象不存在")
    history = await client.request(f"/projects/{p['projectId']}/history")
    accepted = {item["id"] for item in history["operations"]}
    done = operation(p, "undo") in accepted
    moved = operation(p, "move") in accepted
    if not done and before["revision"] != p["baseRevision"] + (1 if moved else 0):
        raise ValueError("测试项目版本已变化，请勿覆盖其他修改")
    return {"before": before, "alreadyDone": done, "moveAccepted": moved}


async def agent_probe(state: State):
    p = state["payload"]

    @tool
    async def read_scene_and_catalogue() -> dict:
        """Read the real test object and actual scene catalogue from the external project service."""
        client = SceneClient()
        scene = await client.request(f"/projects/{p['projectId']}")
        catalogue = await client.request("/catalog")
        obj = next(f for f in scene["plan"]["furniture"] if f["id"] == p["objectId"])
        return {
            "objectId": obj["id"],
            "observedX": obj["x"],
            "catalogueCount": len(catalogue["items"]),
        }

    agent = create_agent(
        create_model(),
        [read_scene_and_catalogue],
        response_format=ToolStrategy(Probe),
        system_prompt="先调用真实工具 read_scene_and_catalogue，读取指定测试物体和目录。之后通过 Probe 结果工具返回真实值，不猜测。",
    )
    result = await agent.ainvoke(
        {
            "messages": [
                {
                    "role": "user",
                    "content": "验证真实项目服务的物体与家具目录，然后返回结构化证据。",
                }
            ]
        },
        {"recursion_limit": 12},
    )
    proof = result["structured_response"].model_dump()
    if (
        proof["objectId"] != p["objectId"]
        or proof["catalogueCount"] != 266
        or proof["observedX"] != p["originalX"]
    ):
        raise ValueError("模型工具证据与测试输入不符")
    if not any(
        getattr(m, "name", None) == "read_scene_and_catalogue"
        for m in result["messages"]
        if m.type == "tool"
    ):
        raise ValueError("缺少真实工具调用记录")
    return {"proof": proof}


async def move(state: State):
    p = state["payload"]
    await SceneClient().request(
        f"/projects/{p['projectId']}/commands",
        {
            "operationId": operation(p, "move"),
            "baseRevision": p["baseRevision"],
            "summary": "AgentArts 最小联通：移动测试物体",
            "commands": [
                {
                    "type": "update",
                    "collection": "furniture",
                    "id": p["objectId"],
                    "patch": {"x": p["targetX"]},
                }
            ],
        },
    )
    return {}


async def verify_and_restore(state: State):
    p = state["payload"]
    client = SceneClient()
    after = await client.request(f"/projects/{p['projectId']}")
    obj = next(f for f in after["plan"]["furniture"] if f["id"] == p["objectId"])
    if obj["x"] != p["targetX"]:
        raise ValueError("移动结果没有在正式场景中得到验证")
    await client.request(
        f"/projects/{p['projectId']}/undo",
        {"operationId": operation(p, "undo"), "baseRevision": p["baseRevision"] + 1},
    )
    restored = await client.request(f"/projects/{p['projectId']}")
    if (
        next(f for f in restored["plan"]["furniture"] if f["id"] == p["objectId"])["x"]
        != p["originalX"]
    ):
        raise ValueError("撤销恢复失败")
    return {
        "result": {
            "passed": True,
            "projectId": p["projectId"],
            "requestId": p["requestId"],
            "moveRevision": p["baseRevision"] + 1,
            "undoRevision": restored["revision"],
            "proof": state.get("proof"),
            "checkedAt": datetime.now(timezone.utc).isoformat(),
            "platform": "AgentArts SDK; execution location must be recorded by the caller",
        }
    }


async def replay(state: State):
    return {
        "result": {
            "passed": True,
            "replayed": True,
            "projectId": state["payload"]["projectId"],
            "currentRevision": state["before"]["revision"],
            "message": "服务端操作记录确认此请求先前已完成移动与撤销，未重复修改",
        }
    }


builder = StateGraph(State)
for name, fn in (
    ("read", read),
    ("probe", agent_probe),
    ("move", move),
    ("verify", verify_and_restore),
    ("replay", replay),
):
    builder.add_node(name, fn)
builder.add_edge(START, "read")
builder.add_conditional_edges(
    "read",
    lambda s: (
        "replay" if s["alreadyDone"] else "verify" if s["moveAccepted"] else "probe"
    ),
    {"replay": "replay", "verify": "verify", "probe": "probe"},
)
builder.add_edge("probe", "move")
builder.add_edge("move", "verify")
builder.add_edge("verify", END)
builder.add_edge("replay", END)
graph = builder.compile()


@app.entrypoint
async def handler(payload: dict, context: RequestContext = None) -> dict:
    action = payload.get("action")
    if action == "ping":
        return {"status": "ok", "service": "actiscape-agentarts"}
    if action == "resume_task":
        return await resume_task(payload)
    if action == "cancel_task":
        return await cancel_task(payload)
    if action == "run_task" or (
        "projectId" in payload
        and "input" in payload
        and "originalX" not in payload
        and "targetX" not in payload
    ):
        return await run_task(payload)
    request = Input.model_validate(payload).model_dump()
    result = await graph.ainvoke({"payload": request})
    return result["result"]


if __name__ == "__main__":
    app.run(
        host=os.environ.get("RUNTIME_HOST", "0.0.0.0"),
        port=int(
            os.environ.get("AGENT_RUN_PORT")
            or os.environ.get("RUNTIME_PORT")
            or "8080"
        ),
    )
