"""Live official DeepSeek protocol tests on a labelled synthetic image, not C0 real images."""

import argparse
import asyncio
import base64
import json
import os
import time
from pathlib import Path

from actiscape_agent.client import SceneClient
from actiscape_agent.manager import TaskManager
from actiscape_agent.roles import Roles
from actiscape_agent.store import TaskStore
from langchain_core.tools import tool
from pydantic import BaseModel


class CropRead(BaseModel):
    seenText: str
    usedCrop: bool


async def main(args):
    if not os.environ.get("DEEPSEEK_API_KEY"):
        print("PENDING: server model credential is not configured")
        return 2
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    client = SceneClient(args.base)
    store = TaskStore(out / "protocol-state")
    conversation = store.create_conversation("image-protocol-smoke")
    task = store.create_task(
        conversation["id"],
        {
            "requestId": "protocol",
            "input": "Read a genuine tool-returned crop",
            "selectedIds": [],
        },
    )
    store.start(task["id"])

    @tool
    async def request_original_crop() -> list[dict]:
        """Return a real original-pixel crop. Read its visible furniture label; the label is not supplied as text."""
        record = await client.request(
            f"/floorplan-images/{args.image}/crops", {"box": [100, 100, 400, 260]}
        )
        image = await client.image(record["path"])
        return [
            {"type": "text", "text": "原图局部裁剪，请直接读图。"},
            {
                "type": "image_url",
                "image_url": {
                    "url": "data:image/png;base64," + base64.b64encode(image).decode()
                },
            },
        ]

    try:
        proof = await Roles(store, client).invoke(
            "main",
            "协议验证：必须调用 request_original_crop 工具，查看工具返回的图片，读取家具方框内的短标签。最终返回 CropRead，seenText 写实际看到的标签。不得猜测或只依据工具说明。",
            CropRead,
            [request_original_crop],
            {"question": "图中沙发符号里的短标签是什么？"},
            task["id"],
            prompt_version="s2c-tool-image-smoke-1",
        )
        trace = store.events(task["id"])
        used = any(
            e["kind"] == "tool_start" and e["data"]["tool"] == "request_original_crop"
            for e in trace
        )
        passed = (
            used
            and proof["usedCrop"]
            and "sofa1" in "".join(proof["seenText"].lower().split())
        )
        protocol = {
            "passed": passed,
            "realModel": True,
            "realImageAcceptance": False,
            "source": "labelled synthetic image",
            "result": proof,
            "trace": trace,
        }
        (out / "crop-protocol.json").write_text(
            json.dumps(protocol, ensure_ascii=False, indent=2)
        )
        if not passed:
            print("FAIL: real tool-image protocol test")
            return 1
    finally:
        store.pause_clock(task["id"])
        store.close()
    manager = TaskManager(out / "recognition-state", client)
    try:
        await manager.start()
        conversation = manager.store.create_conversation(args.project)
        task = manager.store.create_task(
            conversation["id"],
            {
                "requestId": "recognition",
                "mode": "reconstruct_floorplan",
                "imageId": args.image,
                "input": "请识别该合成单层平面图，提供整层结构和客餐厅家具草稿供确认。图上数字若读不清必须询问，不得猜测尺寸。",
                "selectedIds": [],
            },
        )
        manager.enqueue(task["id"])
        deadline = time.monotonic() + 620
        while time.monotonic() < deadline:
            result = manager.store.task(task["id"])
            if result["status"] in (
                "waiting_input",
                "failed",
                "completed",
                "cancelled",
                "conflict",
            ):
                break
            await asyncio.sleep(0.25)
        trace = manager.store.events(task["id"])
        project = await client.request("/projects/" + args.project)
        passed = (
            result["status"] == "waiting_input"
            and bool(result["generation"].get("draftId"))
            and project["revision"] == 0
            and not project["plan"]["walls"]
        )
        report = {
            "passed": passed,
            "realModel": True,
            "realImageAcceptance": False,
            "source": "labelled synthetic image only",
            "formalProjectUnchanged": project["revision"] == 0,
            "task": result,
            "trace": trace,
        }
        (out / "recognition.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2)
        )
        if result["status"] == "waiting_input":
            manager.store.cancel(task["id"])
        print(
            json.dumps(
                {
                    "passed": passed,
                    "cropProtocolPassed": True,
                    "realModel": True,
                    "realImageAcceptance": False,
                    "modelCalls": result["modelCalls"],
                    "draftChecks": result["generation"].get("previewChecks"),
                    "out": str(out),
                },
                ensure_ascii=False,
            )
        )
        return 0 if passed else 1
    finally:
        await manager.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--project", required=True)
    parser.add_argument("--out", required=True)
    raise SystemExit(asyncio.run(main(parser.parse_args())))
