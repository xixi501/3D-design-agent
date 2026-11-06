"""Explicit test harness: actual orchestration + HTTP scene tools; controlled model responses.
Never imported by production entrypoints and never counted as live-model/image acceptance.
"""

import json
import os
from pathlib import Path

import uvicorn
from actiscape_agent.app import create_app
from actiscape_agent.manager import TaskManager
from actiscape_agent.roles import Roles

DATA = json.loads(Path("fixtures/s2c-synthetic.floorplan.json").read_text())
KEYS = {
    "三人沙发": "sofa",
    "茶几": "coffeeTable",
    "单人沙发": "armchair",
    "落地灯": "floorLamp",
}


class ControlledRoles(Roles):
    async def invoke(
        self, role, prompt, schema, tools, payload, task_id, images=None, **kwargs
    ):
        self.store.count_model_call(task_id, role)
        self.store.event(
            task_id,
            "agent_start",
            {
                "role": role,
                "controlled": True,
                "promptVersion": kwargs.get("prompt_version"),
            },
        )
        available = {tool.name: tool for tool in tools}
        if role == "main":
            if schema.__name__ == "DraftCorrections":
                return {"question": "请通过草稿校正后重新确认", "commands": []}
            await available["floorplan_context"].ainvoke({})
            return {
                "status": "draft",
                **{k: v for k, v in DATA.items() if k != "image"},
            }
        if role == "assets":
            await available["search_catalogue_batch"].ainvoke(
                {"queries": [r["query"] for r in payload["requests"]]}
            )
            return {
                "choices": [
                    {
                        "request_index": r["request_index"],
                        "key": KEYS[r["query"]],
                        "reason": "controlled test catalogue selection",
                    }
                    for r in payload["requests"]
                ]
            }
        if role == "design":
            await available["floorplan_context"].ainvoke({})
            checked = await available["precheck_floorplan"].ainvoke(
                {"matches": payload["sourceMatches"]}
            )
            assert checked["checks"]["passed"], checked
            return {
                "summary": "合成样图工具与浏览器验证（受控模型）",
                "matches": payload["sourceMatches"],
            }
        assert len(images) == 4 and all(
            image.startswith(b"\x89PNG") for image in images
        )
        checks = await available["candidate_checks"].ainvoke({})
        return {
            "passed": checks["passed"],
            "summary": "受控检查：真实代码检查及四张图片传输；不代表真实模型审核",
            "issues": [],
        }


if __name__ == "__main__":
    directory = Path(os.environ["ACTISCAPE_AGENT_DATA_DIR"])
    app = create_app(
        directory,
        manager_factory=lambda d: TaskManager(d, roles_factory=ControlledRoles),
    )
    uvicorn.run(
        app, host="127.0.0.1", port=int(os.environ["AGENT_PORT"]), log_level="warning"
    )
