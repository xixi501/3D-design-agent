"""Photo-generated asset placement through the normal Candidate gate.

The asset dimensions always come from the service AssetRecord; the Agent never
invents a model size. Surface placement resolves a real host (respecting
rotated host footprints and existing sibling tabletop items) and computes
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
    "conferenceTable",
    "trainingTable",
    "curveTrainingTable",
    "workbench",
    "pantryCounter",
    "barCounter",
    "deskBench2",
    "deskBench4",
    "lectern",
}
SURFACE_TYPES = {"table", "desk", "counter", "nightstand", "cabinet", "island", "diningTable", "kitchenIsland", "trainingTable", "workbench", "lectern"}
HOST_WORDS = (
    "实验台",
    "操作台",
    "演示台",
    "中岛台",
    "工作台",
    "会议桌",
    "培训桌",
    "讲台",
    "清洗台",
    "茶几",
    "餐桌",
    "书桌",
    "电视柜",
    "床头柜",
    "边几",
    "岛台",
    "台面",
)
FLOOR_WORDS = ("放地面", "放到地面", "放地上", "放到地上", "落地放置")

PREFERRED_HOST_PRIORITY = {
    "kitchenIsland": 0,
    "island": 0,
    "workbench": 1,
    "deskBench2": 1,
    "deskBench4": 1,
    "conferenceTable": 2,
    "trainingTable": 2,
    "coffeeTable": 3,
    "roundCoffee": 3,
    "ovalCoffee": 3,
    "desk": 4,
    "officeDesk": 4,
    "diningTable": 5,
    "diningTable4": 5,
    "diningTable6": 5,
    "lectern": 6,
    "pantryCounter": 7,
    "counter": 7,
}


def _host(furniture: dict) -> bool:
    if not isinstance(furniture.get("h"), (int, float)) or furniture["h"] <= 0 or furniture["h"] > 1400:
        return False
    return furniture.get("key") in SURFACE_KEYS or furniture.get("type") in SURFACE_TYPES


def _rotated_dims(furniture: dict) -> tuple[float, float]:
    w = float(furniture.get("w") or 0)
    d = float(furniture.get("d") or 0)
    rot = abs(round(float(furniture.get("rot") or 0))) % 180
    return (d, w) if rot == 90 else (w, d)


def _find_surface_spot(host: dict, asset: dict, plan: dict) -> tuple[float, float] | None:
    """Find a collision-free tabletop spot inside host bounds respecting rotation & siblings."""
    eff_w, eff_d = _rotated_dims(host)
    aw = float(asset.get("w") or 0)
    ad = float(asset.get("d") or 0)
    margin = 20.0
    if eff_w < aw + margin * 2 or eff_d < ad + margin * 2:
        return None

    hx = float(host["x"])
    hy = float(host["y"])
    x0 = hx - eff_w / 2.0 + margin
    x1 = hx + eff_w / 2.0 - margin
    y0 = hy - eff_d / 2.0 + margin
    y1 = hy + eff_d / 2.0 - margin
    half_w = aw / 2.0
    half_d = ad / 2.0

    siblings = [
        f
        for f in plan.get("furniture", [])
        if f.get("parentObjectId") == host["id"]
    ]
    sibling_boxes = []
    for sib in siblings:
        sw, sd = _rotated_dims(sib)
        sx, sy = float(sib["x"]), float(sib["y"])
        sibling_boxes.append((sx - sw / 2.0, sx + sw / 2.0, sy - sd / 2.0, sy + sd / 2.0))

    offsets = (
        (0.0, 0.0),
        (0.28, 0.0),
        (-0.28, 0.0),
        (0.0, 0.25),
        (0.0, -0.25),
        (0.32, 0.22),
        (-0.32, 0.22),
        (0.32, -0.22),
        (-0.32, -0.22),
        (0.38, 0.0),
        (-0.38, 0.0),
        (0.18, 0.0),
        (-0.18, 0.0),
    )
    for ox, oy in offsets:
        cx = round(hx + eff_w * ox)
        cy = round(hy + eff_d * oy)
        ix0, ix1 = cx - half_w, cx + half_w
        iy0, iy1 = cy - half_d, cy + half_d
        if ix0 < x0 or ix1 > x1 or iy0 < y0 or iy1 > y1:
            continue
        overlaps = any(
            min(ix1, bx1) - max(ix0, bx0) > 20.0 and min(iy1, by1) - max(iy0, by0) > 20.0
            for bx0, bx1, by0, by1 in sibling_boxes
        )
        if not overlaps:
            return (cx, cy)
    return None


def _pick_auto_host(plan: dict, asset: dict) -> tuple[dict, tuple[float, float]] | None:
    """Rank available tabletop hosts by free space, fewer sibling objects, and semantic priority."""
    candidates: list[tuple[tuple[int, int, float], dict, tuple[float, float]]] = []
    furniture = plan.get("furniture", [])
    for item in furniture:
        if not _host(item):
            continue
        spot = _find_surface_spot(item, asset, plan)
        if spot is None:
            continue
        sibling_count = sum(1 for f in furniture if f.get("parentObjectId") == item["id"])
        prio = PREFERRED_HOST_PRIORITY.get(item.get("key", ""), 10)
        area = float(item.get("w") or 0) * float(item.get("d") or 0)
        candidates.append(((sibling_count, prio, -area), item, spot))
    if not candidates:
        return None
    candidates.sort(key=lambda row: row[0])
    _, best_host, best_spot = candidates[0]
    return best_host, best_spot


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
        spot: tuple[float, float] | None = None
        text = task.get("input") or ""
        explicit_floor = any(w in text for w in FLOOR_WORDS) or decision.get("hostId") == "__floor__"

        explicit_auto = decision.get("hostId") == "__auto__"
        if not explicit_floor:
            if decision.get("hostId") and not explicit_auto:
                host = next(
                    (f for f in plan.get("furniture", []) if f["id"] == decision["hostId"]),
                    None,
                )
            if host is None:
                selected = list(task.get("selectedIds") or [])
                if len(selected) == 1:
                    candidate_host = next(
                        (f for f in plan.get("furniture", []) if f["id"] == selected[0]),
                        None,
                    )
                    if candidate_host and _host(candidate_host):
                        host = candidate_host
            if host is None:
                for furniture in plan.get("furniture", []):
                    if not _host(furniture):
                        continue
                    name = (furniture.get("name") or "").split("（")[0].split("(")[0]
                    if name and name in text:
                        host = furniture
                        break
            if host is None and not explicit_auto and any(word in text for word in HOST_WORDS):
                matched_hosts = []
                for furniture in plan.get("furniture", []):
                    if not _host(furniture):
                        continue
                    name = (furniture.get("name") or "").split("（")[0].split("(")[0]
                    if any(word in text and word in (furniture.get("key", "") + name) for word in HOST_WORDS):
                        s = _find_surface_spot(furniture, asset, plan)
                        if s is not None:
                            sibs = sum(1 for f in plan.get("furniture", []) if f.get("parentObjectId") == furniture["id"])
                            matched_hosts.append((sibs, furniture, s))
                if matched_hosts:
                    matched_hosts.sort(key=lambda r: r[0])
                    _, host, spot = matched_hosts[0]
                else:
                    for furniture in plan.get("furniture", []):
                        if not _host(furniture):
                            continue
                        name = (furniture.get("name") or "").split("（")[0].split("(")[0]
                        if any(word in (furniture.get("key", "") + name) for word in HOST_WORDS):
                            host = furniture
                            break
            if host is None:
                auto = _pick_auto_host(plan, asset)
                if auto is not None:
                    host, spot = auto

        room = (plan.get("rooms") or [{}])[0]
        if host is not None:
            placement = "surface"
            resolved_spot = spot or _find_surface_spot(host, asset, plan)
            if resolved_spot is not None:
                x, y = resolved_spot
            else:
                x, y = host["x"], host["y"]
            z = (host.get("z") or 0) + host["h"]
            host_label = host.get("name") or host.get("key") or "台面"
            summary = f"照片物品入场：{asset['name']} 吸附至「{host_label}」台面（z={int(round(z))} mm）"
        else:
            placement = "floor"
            x, y, z = room.get("x", 0), room.get("y", 0), 0
            summary = f"照片物品入场：{asset['name']} 落位于地面"

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
            "summary": summary,
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
