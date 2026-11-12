"""Photo-generated asset placement through the normal Candidate gate.

The asset dimensions always come from the service AssetRecord; the Agent never
invents a model size. Surface placement resolves a real host and computes
z = host.z + host.h.
"""

from __future__ import annotations

from .client import SceneFailure
from .edit_execution import authorize_edit
from .store import TaskError, fingerprint

SURFACE_KEYS = {
    "coffeeTable",
    "roundCoffee",
    "ovalCoffee",
    "nestTables",
    "diningTable",
    "diningTable4",
    "diningTable6",
    "roundTable",
    "desk",
    "officeDesk",
    "lDesk",
    "standingDesk",
    "sideTable",
    "consoleTable",
    "tvCabinet",
    "cabTV",
    "nightstand",
    "counter",
    "lCounter",
    "uCounter",
    "island",
    "kitchenIsland",
}
SURFACE_TYPES = {"table", "desk", "counter", "nightstand", "cabinet", "island"}
HOST_WORDS = ("茶几", "餐桌", "书桌", "电视柜", "床头柜", "边几", "岛台", "台面")


def _host(furniture: dict) -> bool:
    if not isinstance(furniture.get("h"), (int, float)) or furniture["h"] > 1400:
        return False
    return furniture.get("key") in SURFACE_KEYS or furniture.get("type") in SURFACE_TYPES


class PhotoFlow:
    def __init__(self, store, client):
        self.store = store
        self.client = client

    async def candidate(self, task: dict, project: dict, decision: dict):
        asset_id = decision.get("assetId") or task.get("generation", {}).get("assetId")
        if not asset_id:
            raise TaskError("ASSET_ID_MISSING", "照片资产任务缺少 assetId", 409)
        try:
            asset = await self.client.request(f"/assets/{asset_id}")
        except SceneFailure as error:
            return {
                "route": "end",
                "final": {
                    "status": "waiting_input",
                    "message": f"照片资产不可用：{error}",
                    "errorCode": error.code,
                    "policy": decision,
                },
            }
        plan = project["plan"]
        host = None
        text = task.get("input") or ""
        if decision.get("hostId"):
            host = next(
                (f for f in plan.get("furniture", []) if f["id"] == decision["hostId"]),
                None,
            )
        if host is None:
            selected = list(task.get("selectedIds") or [])
            if len(selected) == 1:
                candidate = next(
                    (f for f in plan.get("furniture", []) if f["id"] == selected[0]),
                    None,
                )
                if candidate and _host(candidate):
                    host = candidate
        if host is None:
            for furniture in plan.get("furniture", []):
                if not _host(furniture):
                    continue
                name = (furniture.get("name") or "").split("（")[0].split("(")[0]
                if name and name in text:
                    host = furniture
                    break
        if host is None and any(word in text for word in HOST_WORDS):
            for furniture in plan.get("furniture", []):
                if not _host(furniture):
                    continue
                name = (furniture.get("name") or "").split("（")[0].split("(")[0]
                if any(word in (furniture.get("key", "") + name) for word in HOST_WORDS):
                    host = furniture
                    break
        room = (plan.get("rooms") or [{}])[0]
        if host is not None:
            placement = "surface"
            x, y = host["x"], host["y"]
            z = (host.get("z") or 0) + host["h"]
        else:
            placement = "floor"
            x, y, z = room.get("x", 0), room.get("y", 0), 0
        scope = {
            "targetIds": [],
            "allowDeleteIds": [],
            "allowAddKeys": [],
            "allowedAssets": [
                {
                    "assetId": asset["id"],
                    "name": asset["name"],
                    "w": asset["w"],
                    "d": asset["d"],
                    "h": asset["h"],
                }
            ],
            "requirements": [],
        }
        edit = {
            "type": "placeAsset",
            "assetId": asset["id"],
            "values": {
                "x": x,
                "y": y,
                "z": z,
                "placement": placement,
                **({"parentObjectId": host["id"]} if host else {}),
            },
        }
        request = {
            "taskId": task["id"],
            "requestId": f"{task['id']}:photo:"
            + fingerprint({"scope": scope, "edits": [edit]})[:20],
            "baseRevision": project["revision"],
            "kind": "edit",
            "verification": "deterministic",
            "scope": scope,
            "edits": [edit],
            "summary": f"照片物品入场：{asset['name']}",
        }
        try:
            authorization = await authorize_edit(
                self.store, self.client, task, {"revision": request["baseRevision"]}, scope, {}
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
                    "message": f"照片资产放置候选未通过门禁：{error}",
                    "errorCode": error.code,
                    "policy": decision,
                },
            }
        if not candidate["checks"]["passed"]:
            blocking = [issue for issue in candidate["checks"]["issues"] if issue.get("blocking")]
            message = "照片资产落位检查未通过，正式场景未改变。"
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
        return {
            "candidate": candidate,
            "scope": scope,
            "intent": {},
            "proposal": {"summary": request["summary"], "edits": [edit]},
            "route": "render",
            "asset": asset,
            "host": host,
        }
