"""Paid, real-provider capability checks. Never writes credentials or project changes."""
import asyncio
import base64
import json
from pathlib import Path
import httpx
from pydantic import BaseModel
from langchain.agents import create_agent
from langchain.agents.structured_output import ToolStrategy
from langchain_core.messages import HumanMessage
from langchain_core.tools import tool
from .model import create_model
from .config import ROOT, model_settings, scene_url

class ToolProof(BaseModel):
    catalogue_items: int
    scene_furniture: int
    explanation: str

@tool
async def read_catalogue_count() -> dict:
    """Read the actual ActiScape service catalogue and return its item count."""
    async with httpx.AsyncClient(timeout=30) as client:
        response=await client.get(scene_url()+"/api/catalog")
        response.raise_for_status()
        return {"items":len(response.json()["items"])}

@tool
async def read_sample_scene() -> dict:
    """Read the actual living-dining sample from the project service."""
    async with httpx.AsyncClient(timeout=30) as client:
        response=await client.get(scene_url()+"/api/examples/living-dining")
        response.raise_for_status()
        plan=response.json()
        return {"name":plan["name"],"furniture":len(plan["furniture"])}

async def main():
    output=ROOT/"test-results"/"agent"
    output.mkdir(parents=True,exist_ok=True)
    model=create_model()
    agent=create_agent(model,[read_catalogue_count,read_sample_scene],response_format=ToolStrategy(ToolProof),system_prompt="你负责验证真实工具。必须先调用 read_catalogue_count，收到结果后再调用 read_sample_scene，最后返回结构化结果。不能凭记忆回答数量。")
    result=await agent.ainvoke({"messages":[HumanMessage(content="核对 ActiScape 目录条目数与客餐厅样例家具数，按顺序调用两个工具。") ]},{"recursion_limit":16})
    proof=result["structured_response"]
    assert proof.catalogue_items==266 and proof.scene_furniture==12
    tools=[m.name for m in result["messages"] if m.type=="tool"]
    assert "read_catalogue_count" in tools and "read_sample_scene" in tools
    image=base64.b64encode((ROOT/"docs/evidence/visual/editor-fixed.png").read_bytes()).decode()
    response=await model.ainvoke([HumanMessage(content=[{"type":"text","text":"请用中文描述这张室内三维场景截图中至少三种可见家具。只描述图片，不要调用工具。"},{"type":"image_url","image_url":{"url":"data:image/png;base64,"+image}}])])
    assert isinstance(response.content,str) and len(response.content)>20
    report={"provider":"DeepSeek official","requestedModel":model_settings()["model"],"tools":tools,"structuredProof":proof.model_dump(),"visionDescription":response.content,"responseMetadata":{k:v for k,v in response.response_metadata.items() if k in ["model_name","system_fingerprint","token_usage","finish_reason"]},"usage":response.usage_metadata}
    (output/"model-smoke.json").write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps({"passed":True,"tools":tools,"model":report["requestedModel"],"vision":True},ensure_ascii=False))

if __name__=="__main__":
    asyncio.run(main())
