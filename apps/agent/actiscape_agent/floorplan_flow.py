from .client import SceneFailure
from .floorplan_roles import FloorplanRoles
from .generation_flow import COLLECTIONS
from .skill_registry import FLOORPLAN_TOOLS, load_design_skill, skill_record
from .store import TaskError, fingerprint


class FloorplanFlow:
    def __init__(self, store, client, roles):
        self.store, self.client, self.roles = store, client, FloorplanRoles(roles)

    async def recognize_and_measure(self, task, image, snapshot):
        """Persist real tool/model attempts before confirmation; repairs share the task budget."""
        g = self.store.task(task["id"], internal=True)["generation"]
        same_input = g.get("recognitionInputHash") == fingerprint(task["input"])
        recognized = g.get("pendingRecognition") if same_input else None
        if recognized is None:
            recognized = await self.roles.recognize(task, image)
            g = self.store.task(task["id"], internal=True)["generation"]
            g.setdefault("rawRecognition", recognized)
            g.update(
                pendingRecognition=recognized,
                recognitionInputHash=fingerprint(task["input"]),
                measurementComplete=False,
            )
            g.setdefault("recognitionAttempts", []).append(
                {
                    "role": "main",
                    "response": recognized,
                    "imageHash": image["sha256"],
                    "sourceInputHash": fingerprint(task["input"]),
                }
            )
            self.store.update(task["id"], generation=g)
        submission = g.get("measurementSubmission")
        if (
            submission
            and submission.get("attempt") == g.get("measurementAttempts")
            and submission.get("inputHash") == fingerprint(task["input"])
        ):
            # The terminal tool can finish before the graph checkpoint is durable.
            recognized = submission["recognition"]
            g["pendingRecognition"] = recognized
        # Old pinned tasks keep the original workflow and request hashes.
        if (
            "fit_wall_faces" not in snapshot.get("requiredTools", [])
            or recognized["status"] == "unsupported"
        ):
            return recognized

        async def preflight(value):
            try:
                result = await self.client.request(
                    f"/projects/{task['projectId']}/floorplan-preflight",
                    {
                        "imageId": image["id"],
                        "data": {k: v for k, v in value.items() if k not in ("status", "question")},
                    },
                )
                checks = result["checks"]
                current = self.store.task(task["id"], internal=True)["generation"]
                submission = current.get("measurementSubmission") or {}
                if submission.get("recognition") == value:
                    preservation = [
                        i
                        for i in (submission.get("checks") or {}).get("issues", [])
                        if i.get("code") == "FLOORPLAN_UNEXPLAINED_REMOVAL"
                    ]
                    if preservation:
                        checks = {
                            **checks,
                            "passed": False,
                            "issues": [*checks.get("issues", []), *preservation],
                        }
                return checks
            except SceneFailure as error:
                return {
                    "passed": False,
                    "issues": [
                        {
                            "code": error.code,
                            "message": str(error),
                            "details": error.data.get("details"),
                            "blocking": True,
                        }
                    ],
                }

        checks = await preflight(recognized)
        while not g.get("measurementComplete"):
            attempts = g.get("measurementAttempts", 0)
            if attempts and (checks["passed"] or g.get("repairsUsed", 0) >= 3):
                break
            if attempts:
                g["repairsUsed"] = g.get("repairsUsed", 0) + 1
                self.store.event(
                    task["id"],
                    "repair",
                    {"round": g["repairsUsed"], "phase": "measuring_floorplan", "report": checks},
                )
            g["measurementAttempts"] = attempts + 1
            g.pop("measurementSubmission", None)
            self.store.update(task["id"], generation=g)
            recognized = await self.roles.measure(task, image, recognized, checks)
            checks = await preflight(recognized)
            g = self.store.task(task["id"], internal=True)["generation"]
            g.update(pendingRecognition=recognized, recognitionChecks=checks)
            g.setdefault("recognitionAttempts", []).append(
                {
                    "role": "design",
                    "response": recognized,
                    "checks": checks,
                    "changes": g.get("measurementSubmission", {}).get("changes", []),
                    "changeReasons": g.get("measurementSubmission", {}).get("changeReasons", {}),
                    "imageHash": image["sha256"],
                    "sourceInputHash": fingerprint(task["input"]),
                }
            )
            self.store.update(task["id"], generation=g)
            if recognized["status"] == "unsupported":
                break
        g.update(measurementComplete=True, recognitionChecks=checks)
        self.store.update(task["id"], generation=g)
        if any(i.get("code") == "FLOORPLAN_UNEXPLAINED_REMOVAL" for i in checks.get("issues", [])):
            recognized = {
                **recognized,
                "uncertainties": [
                    *recognized.get("uncertainties", []),
                    {
                        "id": "system-preservation-" + fingerprint(checks)[:12],
                        "message": "自动测量删除对象或修改标注而未提供原图依据，需解决差异报告后才能确认。",
                        "blocking": True,
                    },
                ],
            }
        return recognized

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
            recognized = await self.recognize_and_measure(task, image, snapshot)
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
            try:
                draft = await self.client.request(
                    prefix,
                    {
                        "requestId": task["id"] + ":recognition",
                        "imageId": image["id"],
                        "baseRevision": project["revision"],
                        "data": data,
                    },
                )
            except SceneFailure as error:
                if error.code != "INVALID_FLOORPLAN":
                    raise
                return {
                    "route": "end",
                    "final": {
                        "status": "waiting_input",
                        "phase": "reviewing_floorplan",
                        "message": "识别草稿仍有无效字段，正式项目未改变：" + str(error),
                        "report": error.data,
                    },
                }
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
        g.update(
            previewChecks=preview["checks"],
            defaults=preview.get("defaults", []),
            compiledSymbols=preview.get("symbols", []),
            scale=preview.get("scale"),
        )
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
            "repairs": g.get("repairsUsed", state.get("repairs", 0)),
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
