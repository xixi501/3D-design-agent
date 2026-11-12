"""Fast deterministic open/close/on-off candidate path.

Only action state changes are proposed; the scene still passes through
Candidate -> CheckScene -> Commit. A blocked cabinet/door never mutates the
formal project.
"""

from __future__ import annotations

from .client import SceneFailure
from .edit_execution import authorize_edit
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
        if action == "open_all":
            for opening in plan.get("openings", []):
                if opening.get("type") in DOOR_TYPES and not opening.get("open"):
                    edits.append(
                        {
                            "type": "action",
                            "collection": "openings",
                            "id": opening["id"],
                            "action": "toggle_open",
                            "desiredState": True,
                        }
                    )
                    action_ids.append(opening["id"])
            for furniture in plan.get("furniture", []):
                if furniture.get("key") in OPENABLE_KEYS and not (furniture.get("opt") or {}).get(
                    "open"
                ):
                    edits.append(
                        {
                            "type": "action",
                            "collection": "furniture",
                            "id": furniture["id"],
                            "action": "toggle_open",
                            "desiredState": True,
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
                raise TaskError("ACTION_TARGET_UNRESOLVED", "快速动作缺少明确目标", 409)
            item = next(
                (value for value in plan.get(collection, []) if value.get("id") == target_id),
                None,
            )
            desired = decision.get("desiredState")
            if item is not None and isinstance(desired, bool):
                current = (
                    bool(item.get("open"))
                    if collection == "openings"
                    else bool(
                        (item.get("opt") or {}).get(
                            "on" if action == "toggle_on" else "open",
                            action == "toggle_on",
                        )
                    )
                )
                if current == desired:
                    return {
                        "route": "end",
                        "final": {
                            "status": "completed",
                            "message": "目标已经处于请求的状态，无需修改场景。",
                            "policy": decision,
                        },
                    }
            edits = [
                {
                    "type": "action",
                    "collection": collection,
                    "id": target_id,
                    "action": action,
                    "desiredState": desired,
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
            "verification": "deterministic",
            "scope": scope,
            "edits": edits,
            "summary": "一键开启门柜检验" if action == "open_all" else "开关门柜/电器",
        }
        return await self._submit(task, request, decision)

    async def _submit(self, task, request, decision):
        try:
            authorization = await authorize_edit(
                self.store,
                self.client,
                task,
                {"revision": request["baseRevision"]},
                request["scope"],
                {},
            )
            request.update(
                authorizationVersion=authorization["version"],
                authorizationScopeHash=authorization["scopeHash"],
            )
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
        blocking = [issue for issue in candidate["checks"]["issues"] if issue.get("blocking")]
        message = "开启检验发现布局冲突，正式场景未改变。"
        if blocking:
            message += " " + "；".join(issue["message"] for issue in blocking[:3])
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
