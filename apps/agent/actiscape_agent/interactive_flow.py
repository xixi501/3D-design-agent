"""Fast deterministic open/close/on-off candidate path.

Only action state changes are proposed; the scene still passes through
Candidate -> CheckScene -> Commit. A blocked cabinet/door never mutates the
formal project.
"""

from __future__ import annotations

from .client import SceneFailure
from .policy import DOOR_TYPES, OPENABLE_KEYS
from .store import TaskError, fingerprint


class InteractiveFlow:
    def __init__(self, store, client):
        self.store = store
        self.client = client

    async def candidate(self, task: dict, project: dict, decision: dict):
        plan = project["plan"]
        edits = []
        action_ids = []
        target_ids = []
        action = decision.get("action")
        fast_edit = decision.get("fastEdit")
        if fast_edit:
            target_id = decision.get("targetId")
            item = next(
                (f for f in plan.get("furniture", []) if f["id"] == target_id),
                None,
            )
            if item is None:
                raise TaskError(
                    "ACTION_TARGET_UNRESOLVED", "快速编辑缺少真实目标", 409
                )
            values = dict(fast_edit.get("values") or {})
            if not values or any(
                key not in ("x", "y", "rot", "color") for key in values
            ):
                raise TaskError("ACTION_INVALID", "快速编辑字段无效", 409)
            edits = [{"type": "update", "id": target_id, "values": values}]
            target_ids = [target_id]
            scope = {
                "targetIds": target_ids,
                "allowDeleteIds": [],
                "allowAddKeys": [],
                "fieldMask": {target_id: list(values)},
                "requirements": [],
            }
            request = {
                "taskId": task["id"],
                "requestId": f"{task['id']}:fast:"
                + fingerprint({"scope": scope, "edits": edits})[:20],
                "baseRevision": project["revision"],
                "kind": "edit",
                "scope": scope,
                "edits": edits,
                "summary": "单件快速编辑",
            }
            return await self._submit(task, request, decision, [])
        if action == "open_all":
            for opening in plan.get("openings", []):
                if opening.get("type") in DOOR_TYPES and not opening.get("open"):
                    edits.append(
                        {
                            "type": "action",
                            "collection": "openings",
                            "id": opening["id"],
                            "action": "toggle_open",
                        }
                    )
                    action_ids.append(opening["id"])
            for furniture in plan.get("furniture", []):
                if (
                    furniture.get("key") in OPENABLE_KEYS
                    and not (furniture.get("opt") or {}).get("open")
                ):
                    edits.append(
                        {
                            "type": "action",
                            "collection": "furniture",
                            "id": furniture["id"],
                            "action": "toggle_open",
                        }
                    )
                    action_ids.append(furniture["id"])
                    target_ids.append(furniture["id"])
            if not edits:
                return {
                    "route": "end",
                    "final": {
                        "status": "completed",
                        "message": "当前场景的门、柜门和抽屉已经全部处于开启状态。",
                        "policy": decision,
                    },
                }
        else:
            target_id = decision.get("targetId")
            collection = decision.get("collection")
            if not target_id or collection not in ("openings", "furniture"):
                raise TaskError(
                    "ACTION_TARGET_UNRESOLVED", "快速动作缺少明确目标", 409
                )
            edits = [
                {
                    "type": "action",
                    "collection": collection,
                    "id": target_id,
                    "action": action,
                }
            ]
            action_ids = [target_id]
            if collection == "furniture":
                target_ids = [target_id]
        scope = {
            "targetIds": target_ids,
            "allowDeleteIds": [],
            "allowAddKeys": [],
            "actionIds": action_ids,
            "requirements": [],
        }
        request = {
            "taskId": task["id"],
            "requestId": f"{task['id']}:action:"
            + fingerprint({"scope": scope, "edits": edits})[:20],
            "baseRevision": project["revision"],
            "kind": "edit",
            "scope": scope,
            "edits": edits,
            "summary": "一键开启门柜检验" if action == "open_all" else "开关门柜/电器",
        }
        return await self._submit(task, request, decision, edits)

    async def _submit(self, task, request, decision, action_edits):
        try:
            candidate = await self.client.request(
                f"/projects/{task['projectId']}/candidates", request
            )
        except SceneFailure as error:
            return {
                "route": "end",
                "final": {
                    "status": "waiting_input",
                    "message": f"动作候选未通过门禁：{error}",
                    "errorCode": error.code,
                    "policy": decision,
                },
            }
        if candidate["checks"]["passed"]:
            return {
                "candidate": candidate,
                "scope": request["scope"],
                "intent": {},
                "proposal": {"summary": request["summary"], "edits": request["edits"]},
                "route": "render",
            }
        blocking = [
            issue
            for issue in candidate["checks"]["issues"]
            if issue.get("blocking")
        ]
        repaired = await self._repair_blocked(
            task, request, decision, candidate, action_edits, blocking
        )
        if repaired is not None:
            return repaired
        message = "开启检验发现布局冲突，正式场景未改变。"
        if blocking:
            message += " " + "；".join(
                issue["message"] for issue in blocking[:3]
            )
        return {
            "route": "end",
            "final": {
                "status": "waiting_input",
                "message": message,
                "candidateId": candidate["id"],
                "report": candidate["checks"],
                "policy": decision,
            },
        }

    async def _repair_blocked(self, task, request, decision, candidate, action_edits, blocking):
        if not action_edits or decision.get("action") == "open_all":
            return None
        issue = next(
            (item for item in blocking if item.get("code") == "OPENABLE_FRONT_BLOCKED"),
            None,
        )
        if issue is None:
            return None
        ids = [str(item) for item in issue.get("objectIds") or []]
        action_ids = set(request["scope"].get("actionIds") or [])
        openable_id = next((item for item in ids if item in action_ids), None)
        blocker_id = next((item for item in ids if item != openable_id), None)
        if not openable_id or not blocker_id:
            return None
        project = await self.client.request(f"/projects/{task['projectId']}")
        plan = project["plan"]
        openable = next((f for f in plan["furniture"] if f["id"] == openable_id), None)
        blocker = next((f for f in plan["furniture"] if f["id"] == blocker_id), None)
        if openable is None or blocker is None:
            return None
        clearance = {
            "wardrobe": 600,
            "wardrobe2": 600,
            "wardrobe3": 600,
            "fridge": 600,
            "fridgeDouble": 600,
            "fridgeFrench": 600,
            "cabSlide": 500,
        }.get(openable.get("key"), 450)
        remaining = float(issue.get("metric") or 0)
        delta = max(50.0, clearance - remaining + 50.0)
        rot = round(float(openable.get("rot") or 0) / 90) * 90 % 360
        values = {}
        if rot == 0:
            values["y"] = blocker["y"] + delta
        elif rot == 90:
            values["x"] = blocker["x"] - delta
        elif rot == 180:
            values["y"] = blocker["y"] - delta
        else:
            values["x"] = blocker["x"] + delta
        scope = {
            "targetIds": [blocker_id],
            "allowDeleteIds": [],
            "allowAddKeys": [],
            "fieldMask": {blocker_id: list(values)},
            "actionIds": [openable_id],
            "requirements": [],
        }
        edits = [*action_edits, {"type": "update", "id": blocker_id, "values": values}]
        repair_request = {
            **request,
            "requestId": request["requestId"] + ":clear",
            "scope": scope,
            "edits": edits,
            "summary": f"开门避让：{blocker.get('name')} 移开 {round(delta)} mm",
        }
        try:
            repaired = await self.client.request(
                f"/projects/{task['projectId']}/candidates", repair_request
            )
        except SceneFailure as error:
            return None
        if not repaired["checks"]["passed"]:
            return None
        return {
            "candidate": repaired,
            "scope": scope,
            "intent": {},
            "proposal": {"summary": repair_request["summary"], "edits": edits},
            "route": "render",
            "repaired": True,
            "repair": {
                "code": "OPENABLE_FRONT_BLOCKED",
                "objectId": blocker_id,
                "deltaMm": round(delta),
            },
        }
