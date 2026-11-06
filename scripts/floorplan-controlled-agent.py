"""Explicit test harness: actual orchestration + HTTP scene tools; controlled model responses.
Never imported by production entrypoints and never counted as live-model/image acceptance.
"""

import json
import copy
import os
from pathlib import Path

import uvicorn
from actiscape_agent.app import create_app
from actiscape_agent.manager import TaskManager
from actiscape_agent.roles import Roles

V2 = json.loads(Path("fixtures/s2c-v2-synthetic.floorplan.json").read_text())
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
        if schema.__name__ == "RecognitionV2":
            await available["floorplan_context"].ainvoke({})
            await available["analyze_floorplan"].ainvoke({})
            return {
                "status": "draft",
                **{
                    k: v
                    for k, v in V2.items()
                    if k not in ("image", "features", "dimensions")
                },
                "features": [],
                "dimensions": [],
            }
        if schema.__name__ == "MeasuredDraftUpdate":
            draft = payload["draft"]
            data = copy.deepcopy(draft["data"])
            analyses = [
                r
                for r in payload["sharedEvidence"]["evidence"]
                if r.get("mode") == "analyze"
            ]
            analysis = analyses[-1]
            samples = []
            for wall in data["walls"]:
                normal = "x" if abs(wall["a"]["x"] - wall["b"]["x"]) <= 1 else "y"
                index = next(
                    i
                    for i, r in enumerate(analysis["result"]["segments_px"])
                    if r["orient"] == ("v" if normal == "x" else "h")
                    and abs(r["line"] - wall["a"][normal]) <= 1.5
                )
                samples.append(
                    {"id": wall["id"], "analysisId": analysis["id"], "index": index}
                )
            parts = await available["fit_wall_candidates"].ainvoke({"walls": samples})
            record = json.loads(parts[0]["text"])
            assert not record.get("error"), record
            measured = {r["id"]: r for r in record["result"]}
            commands = []
            reasons = []
            coords = {"x": {}, "y": {}}
            for w in data["walls"]:
                axis = "x" if w["a"]["x"] == w["b"]["x"] else "y"
                coords[axis][w["a"][axis]] = measured[w["id"]]["center"]
            for w in data["walls"]:
                a = {k: coords[k].get(v, v) for k, v in w["a"].items()}
                b = {k: coords[k].get(v, v) for k, v in w["b"].items()}
                commands.append(
                    {
                        "type": "patch",
                        "collection": "walls",
                        "id": w["id"],
                        "patch": {
                            "a": a,
                            "b": b,
                            "thicknessPx": measured[w["id"]]["thick_px"],
                        },
                    }
                )
                reasons.append(
                    {
                        "collection": "walls",
                        "id": w["id"],
                        "reason": "controlled real candidate measurement",
                        "evidenceRefs": [record["id"]],
                    }
                )
            for feature in V2["features"]:
                feature = {**feature, "evidenceRefs": [record["id"]]}
                commands.append(
                    {"type": "upsert", "collection": "features", "object": feature}
                )
            for dimension in V2["dimensions"]:
                dimension = {
                    **dimension,
                    "evidenceRefs": ["image:" + data["image"]["sha256"]],
                }
                commands.append(
                    {"type": "upsert", "collection": "dimensions", "object": dimension}
                )
            return {
                "baseDraftRevision": draft["revision"],
                "baseDraftHash": draft["hash"],
                "commands": commands,
                "changeReasons": reasons,
                "evidenceRefs": [record["id"]],
                "summary": "controlled delta measurement",
            }
        if role == "check" and "candidate_checks" not in available:
            return {
                "passed": True,
                "summary": "controlled source pixel review",
                "issues": [],
            }
        if role == "main":
            if schema.__name__ == "DraftCorrections":
                return {"question": "请通过草稿校正后重新确认", "commands": []}
            await available["floorplan_context"].ainvoke({})
            await available["analyze_floorplan"].ainvoke({})
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
            if schema.__name__ == "PixelFloorplanRecognition":
                await available["fit_wall_faces"].ainvoke(
                    {
                        "walls": [
                            {
                                "id": "synthetic-top",
                                "kind": "H",
                                "c": 50,
                                "p0": 60,
                                "p1": 250,
                            }
                        ]
                    }
                )
                await available["measure_dimension_chain"].ainvoke(
                    {
                        "ticks": [50, 950],
                        "distances": [9000],
                        "basis": "centerline",
                        "evidence": "synthetic fixture labelled 9000 mm",
                    }
                )
                checked = await available["preview_floorplan"].ainvoke(
                    {"draft": payload["recognition"]}
                )
                assert checked["checks"]["passed"], checked
                return payload["recognition"]
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
        await available["audit_floorplan_source"].ainvoke({})
        return {
            "passed": checks["passed"],
            "summary": "受控检查：真实代码检查及四张图片传输；不代表真实模型审核",
            "issues": [],
        }


def manager_factory(directory):
    manager = TaskManager(directory, roles_factory=ControlledRoles)
    if os.environ.get("ACTISCAPE_TEST_WORKFLOW") == "1":
        original = manager.store.create_task

        def create(conversation, body):
            task = original(conversation, body)
            if body.get("mode") == "reconstruct_floorplan":
                g = manager.store.task(task["id"], internal=True)["generation"]
                g.update(
                    workflowVersion=1,
                    skillSnapshot=json.loads(
                        Path("fixtures/s2c-legacy-skill.json").read_text()
                    ),
                )
                manager.store.update(task["id"], generation=g)
                task = manager.store.task(task["id"])
            return task

        manager.store.create_task = create
    return manager


if __name__ == "__main__":
    directory = Path(os.environ["ACTISCAPE_AGENT_DATA_DIR"])
    app = create_app(
        directory,
        manager_factory=manager_factory,
    )
    uvicorn.run(
        app, host="127.0.0.1", port=int(os.environ["AGENT_PORT"]), log_level="warning"
    )
