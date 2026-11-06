from .floorplan_roles import FloorplanRoles
from .generation_flow import COLLECTIONS
from .skill_registry import FLOORPLAN_TOOLS, load_design_skill, skill_record
from .store import TaskError, fingerprint


class FloorplanFlow:
    def __init__(self, store, client, roles):
        self.store, self.client, self.roles = store, client, FloorplanRoles(roles)

    async def ground(self, state, task):
        project = state["project"]
        if any(project["plan"].get(k) for k in COLLECTIONS) or project.get("roomLabelArchive"):
            raise TaskError(
                "PROJECT_NOT_EMPTY", "户型图初始化仅用于空白项目，现有内容没有被覆盖", 409
            )
        g = dict(task["generation"])
        prefix = f"/projects/{task['projectId']}/floorplan-drafts"
        snapshot = g.get("skillSnapshot") or load_design_skill(
            FLOORPLAN_TOOLS, skill_id="floorplan-reconstruction"
        )
        g.update(skillSnapshot=snapshot, skillsUsed=[skill_record(snapshot)])
        self.store.update(task["id"], generation=g)
        self.store.event(task["id"], "skill_loaded", skill_record(snapshot))
        if not g.get("draftId"):
            image = await self.client.request(f"/floorplan-images/{g['imageId']}")
            recognized = await self.roles.recognize(task, image)
            g = self.store.task(task["id"], internal=True)["generation"]
            g.setdefault("rawRecognition", recognized)
            g.setdefault("recognitionAttempts", []).append(
                {
                    "response": recognized,
                    "imageHash": image["sha256"],
                    "sourceInputHash": fingerprint(task["input"]),
                }
            )
            self.store.update(task["id"], generation=g)
            if recognized["status"] == "unsupported":
                return {
                    "route": "end",
                    "final": {
                        "status": "failed",
                        "message": recognized["question"] or "图片超出单层正交平面图范围",
                    },
                }
            data = {k: v for k, v in recognized.items() if k not in ("status", "question")}
            data["image"] = {k: image[k] for k in ("id", "sha256", "width", "height")}
            draft = await self.client.request(
                prefix,
                {
                    "requestId": task["id"] + ":recognition",
                    "imageId": image["id"],
                    "baseRevision": project["revision"],
                    "data": data,
                },
            )
            # Re-read: crop tools may have persisted evidence during the model invocation.
            g = self.store.task(task["id"], internal=True)["generation"]
            g.update(
                draftId=draft["id"],
                floorplan=draft,
                sourceInputHash=fingerprint(task["input"]),
                phase="reviewing_floorplan",
                recognitionQuestion=recognized.get("question", ""),
            )
            self.store.update(task["id"], generation=g)
        else:
            draft = await self.client.request(prefix + "/" + g["draftId"])
            if g.get("sourceInputHash") != fingerprint(task["input"]):
                changes = await self.roles.correct(task, draft)
                if changes["commands"]:
                    draft = await self.client.request(
                        prefix + "/" + draft["id"] + "/commands",
                        {
                            "requestId": task["id"] + ":correct:" + fingerprint(task["input"])[:32],
                            "draftRevision": draft["revision"],
                            "commands": changes["commands"],
                        },
                    )
                g.update(
                    sourceInputHash=fingerprint(task["input"]),
                    correctionQuestion=changes["question"],
                )
        if draft["baseRevision"] != project["revision"]:
            if g.get("versionRebases", 0) >= 1:
                return {
                    "route": "end",
                    "final": {
                        "status": "conflict",
                        "message": "项目再次变化，已暂停；请重新开始并确认户型，现有场景未覆盖。",
                    },
                }
            draft = await self.client.request(
                prefix + "/" + draft["id"] + "/rebase",
                {
                    "requestId": task["id"] + ":rebase:" + str(project["revision"]),
                    "draftRevision": draft["revision"],
                    "baseRevision": project["revision"],
                },
            )
            g.update(versionRebases=g.get("versionRebases", 0) + 1)
        g.update(floorplan=draft, draftId=draft["id"], phase="reviewing_floorplan")
        preview = await self.client.request(
            prefix + "/" + draft["id"] + "/preview", {"taskId": task["id"]}
        )
        g.update(previewChecks=preview["checks"], defaults=preview.get("defaults", []))
        self.store.update(task["id"], generation=g)
        self.store.event(
            task["id"],
            "floorplan_draft",
            {
                "draftId": draft["id"],
                "draftRevision": draft["revision"],
                "draftHash": draft["hash"],
                "checks": preview["checks"],
            },
        )
        if not draft.get("confirmed") or not preview["checks"]["passed"]:
            problems = [i["message"] for i in preview["checks"]["issues"] if i.get("blocking")]
            message = "请核对原图叠加、比例尺、整层结构及客餐厅家具，再点击“确认结构与原图布局”。"
            if problems:
                message += " 待处理：" + "；".join(problems[:5])
            return {
                "route": "end",
                "final": {
                    "status": "waiting_input",
                    "message": message,
                    "phase": "reviewing_floorplan",
                    "draftId": draft["id"],
                    "report": preview["checks"],
                },
            }
        symbols = [
            s for s in draft["data"]["symbols"] if s["roomId"] in draft["data"]["targetRoomIds"]
        ]
        groups = {}
        for s in symbols:
            key = s.get("catalogKey") or s["category"]
            groups.setdefault(key, []).append(s["id"])
        if len(groups) > 30:
            raise TaskError(
                "FURNITURE_SCOPE", "目标家具类别超过本轮批量目录查询容量，请缩小目标区域"
            )
        g.update(
            frozen=True,
            floorplan=draft,
            phase="matching_assets",
            symbolGroups=list(groups.values()),
        )
        self.store.update(task["id"], generation=g)
        return {
            "generation": g,
            "layout_project": {**project, **preview["state"]},
            "intent": {
                "status": "ready",
                "summary": "复现已确认的客餐厅原图布局",
                "target_ids": [],
                "reference_ids": [],
                "delete_ids": [],
                "field_permissions": {},
                "additions": [{"query": query, "count": len(ids)} for query, ids in groups.items()],
                "area": "room",
            },
            "route": "assets",
        }

    async def scope(self, state, task):
        g = task["generation"]
        draft = g["floorplan"]
        matches = []
        choices = state["assets"]["choices"]
        groups = g["symbolGroups"]
        if len(choices) != len(groups) or sorted(c["request_index"] for c in choices) != list(
            range(len(groups))
        ):
            raise TaskError("ASSET_SELECTION", "原图家具请求与目录选择不一致")
        for choice in choices:
            for symbol in groups[choice["request_index"]]:
                original = next(s for s in draft["data"]["symbols"] if s["id"] == symbol)
                key = original.get("catalogKey") or choice["key"]
                matches.append({"symbolId": symbol, "key": key})
        g.update(matches=matches)
        self.store.update(task["id"], generation=g)
        keys = list(dict.fromkeys(m["key"] for m in matches))
        scope = {
            "targetIds": [],
            "allowDeleteIds": [],
            "allowAddKeys": keys,
            "allowedRoomIds": [task["id"] + ":r:" + id for id in draft["data"]["targetRoomIds"]],
            "requirements": [
                {"key": k, "count": sum(m["key"] == k for m in matches), "scope": "project"}
                for k in keys
            ],
        }
        self.store.event(task["id"], "scope", scope)
        return {"scope": scope, "route": "design"}
