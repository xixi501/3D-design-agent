"""Editing authorization and candidate execution, independent of graph orchestration."""

import re

from .addition_semantics import semantic_errors
from .store import TaskError, fingerprint


def compile_scope(
    project: dict,
    intent: dict,
    assets: dict,
    catalogue: dict,
    *,
    task_mode: str | None = None,
    task: dict | None = None,
) -> dict:
    furniture = {f["id"]: f for f in project["plan"]["furniture"]}
    if task_mode == "repair_layout":
        # A repair must only target furniture, even if the model saw wall/opening
        # IDs in a generated issue description.
        authorized = set((task or {}).get("selectedIds") or [])
        if not authorized:
            raise TaskError(
                "NEEDS_INPUT",
                "修复任务需要至少一个已授权的家具目标",
            )
        targets = [
            i
            for i in intent["target_ids"]
            if i in furniture and (not authorized or i in authorized)
        ]
        intent = {
            **intent,
            "target_ids": targets,
            "reference_ids": [i for i in intent["reference_ids"] if i in furniture],
            "field_permissions": {
                tid: list(
                    dict.fromkeys(
                        list((intent.get("field_permissions") or {}).get(tid) or [])
                        + ["x", "y", "rot"]
                    )
                )
                for tid in targets
            },
            "delete_ids": [i for i in intent["delete_ids"] if i in targets],
            "operations": [],
        }
        if authorized and not intent["target_ids"]:
            raise TaskError(
                "NEEDS_INPUT",
                "本次修复没有获得授权的家具目标，请重新选择房间或对象",
            )
    targets = intent["target_ids"]
    references = [id for id in intent["reference_ids"] if id not in targets]
    if task_mode == "edit" and any(
        word in (task or {}).get("input", "")
        for word in ("整间房", "整个房间", "全屋重新", "全屋重设计")
    ):
        raise TaskError("NEEDS_INPUT", "当前阶段支持指定家具和局部区域，请明确本次要调整的对象")
    if (
        len(targets) > 20
        or len(set(targets)) != len(targets)
        or any(id not in furniture for id in targets + references)
    ):
        raise TaskError("NEEDS_INPUT", "目标不存在或不够明确，请重新选择家具")
    if any(id not in targets for id in intent["delete_ids"]):
        raise TaskError("NEEDS_INPUT", "删除对象未获得明确授权")
    permissions = intent.get("field_permissions", {})
    if intent.get("operations"):
        operation_permissions = {}
        for op in intent["operations"]:
            if op["target_id"] not in targets:
                raise TaskError("NEEDS_INPUT", "精确操作超出目标授权")
            fields = set(op.get("values") or {}) | set(op.get("deltas") or {})
            if not fields.issubset(set(permissions.get(op["target_id"], []))):
                raise TaskError("NEEDS_INPUT", "精确字段超出本次授权")
            operation_permissions.setdefault(op["target_id"], set()).update(fields)
        permissions = {id: sorted(fields) for id, fields in operation_permissions.items() if fields}

    if any(id not in targets for id in permissions):
        raise TaskError("NEEDS_INPUT", "字段授权与目标不一致")
    if any(not permissions.get(id) for id in targets if id not in intent["delete_ids"]):
        raise TaskError("NEEDS_INPUT", "请说明这些对象需要移动、旋转、改尺寸还是改颜色")
    choices = assets.get("choices", [])
    if len(choices) != len(intent["additions"]) or {c["request_index"] for c in choices} != set(
        range(len(intent["additions"]))
    ):
        raise TaskError("ASSET_SELECTION", "新增请求与目录选择不一致")
    semantic = semantic_errors(
        (task or {}).get("input", ""), intent["additions"], choices, catalogue
    )
    if semantic:
        raise TaskError("ASSET_SELECTION", "；".join(semantic))
    counts = {}
    for choice in choices:
        key = choice["key"]
        if key not in catalogue:
            raise TaskError("ASSET_SELECTION", "资产角色返回了不存在的目录配方")
        counts[key] = counts.get(key, 0) + intent["additions"][choice["request_index"]]["count"]
    pools = []
    candidates = list(dict.fromkeys(assets.get("candidate_keys") or []))
    if any(key not in catalogue for key in candidates) or len(candidates) > 25:
        raise TaskError("ASSET_SELECTION", "资产替换池包含不存在的配方或超过上限")
    for choice in choices:
        key = choice["key"]
        # Replacement candidates must serve the same catalog furniture type.
        # This bounds repair without letting it reinterpret the user's request.
        pool = [key] + [
            other
            for other in candidates
            if catalogue[other].get("type") == catalogue[key].get("type") and other != key
        ]
        pools.append({"keys": pool, "count": intent["additions"][choice["request_index"]]["count"]})
    requirements = []
    if task_mode == "generate_rectangular":
        # Generation starts from a blank project, so the explicit furniture
        # list is an exact project-level requirement, not an addition quota.
        # The initialization authorization freezes these counts by catalogue
        # key; equivalent recipes remain allowed only for the same purpose.
        requirements = [{"key": key, "count": counts[key], "scope": "project"} for key in counts]
    scope = {
        "targetIds": targets,
        "allowDeleteIds": intent["delete_ids"],
        "allowAddKeys": list(dict.fromkeys(key for pool in pools for key in pool["keys"])),
        "fieldMask": permissions,
        "requirements": requirements,
    }
    if re.search(
        r"(?:组成|创建|建立|设立|保存).{0,12}(?:阅读组|活动组|家具组)|编组",
        (task or {}).get("input", ""),
    ):
        scope["allowActivityGroups"] = True
    if pools:
        # Overlapping semantic requests are merged so one added object cannot
        # satisfy two quotas at once.
        merged = []
        for rule in pools:
            overlaps = [other for other in merged if set(other["keys"]) & set(rule["keys"])]
            if overlaps:
                rule = {
                    "keys": list(
                        dict.fromkeys(
                            rule["keys"] + [key for other in overlaps for key in other["keys"]]
                        )
                    ),
                    "count": rule["count"] + sum(other["count"] for other in overlaps),
                }
                merged = [other for other in merged if other not in overlaps]
            merged.append(rule)
        scope["additionRules"] = merged
        scope["assetPool"] = scope["allowAddKeys"]

    if task_mode == "repair_layout":
        scope["checkProfile"] = "strict-repair"
        safety_active = bool(
            ((project.get("plan") or {}).get("source") or {})
            .get("safetyProfile", {})
            .get("enabled")
        )
        for tid in targets:
            allowed_fields = list(dict.fromkeys(list(permissions.get(tid, [])) + ["x", "y", "rot"]))
            if safety_active and "opt" not in allowed_fields:
                allowed_fields.append("opt")
            permissions[tid] = allowed_fields
        scope["fieldMask"] = permissions
    allowed_room_ids = (task or {}).get("allowedRoomIds") or []
    if allowed_room_ids:
        scope["allowedRoomIds"] = list(dict.fromkeys(allowed_room_ids))
    if task_mode != "repair_layout" and intent["area"] == "local" and (counts or (targets and not intent.get("operations"))):
        anchors = [furniture[id] for id in set(references + targets)]
        if not anchors:
            raise TaskError("NEEDS_INPUT", "请选中新增家具附近的参考对象，或说明放在房间哪个区域")
        bounds = {
            "x0": min(f["x"] - f["w"] / 2 for f in anchors) - 1000,
            "y0": min(f["y"] - f["d"] / 2 for f in anchors) - 1000,
            "x1": max(f["x"] + f["w"] / 2 for f in anchors) + 1000,
            "y1": max(f["y"] + f["d"] / 2 for f in anchors) + 1000,
        }
        if counts:
            scope["additionBounds"] = bounds
        if targets and not intent.get("operations"):
            scope["targetBounds"] = bounds
    return scope


async def authorize_edit(store, client, task, project, scope, intent, *, kind="edit", brief=None):
    generation = store.task(task["id"], internal=True)["generation"]
    version = int(generation.get("authorizationVersion", 1))
    request = {
        "taskId": task["id"],
        "baseRevision": project["revision"],
        "version": version,
        "requestText": task["input"],
        "kind": kind,
        "referenceIds": [
            id for id in intent.get("reference_ids", []) if id not in scope["targetIds"]
        ],
        "operations": [] if task.get("mode") == "repair_layout" else intent.get("operations", []),
        "scope": scope,
    }
    if kind == "initialize":
        # Initialization binds the frozen brief, exact furniture counts and
        # asset pool. The candidate must carry the same version/hash.
        request["brief"] = brief
        request.pop("referenceIds", None)
        request.pop("operations", None)
    authorization = await client.request(
        f"/projects/{task['projectId']}/edit-authorizations", request
    )
    generation.update(
        authorizationVersion=version,
        authorizationScopeVersion=version,
        authorizationKind=kind,
        authorizationScope=scope,
        editAuthorization=authorization,
        authorizationRequestText=task["input"],
    )
    if kind == "initialize" and brief:
        generation["frozenBrief"] = brief
    store.update(task["id"], generation=generation)
    store.event(task["id"], "authorization", authorization)
    return authorization


async def submit_candidate(client, task, project, scope, proposal, round, authorization):
    request = {
        "taskId": task["id"],
        "baseRevision": project["revision"],
        "scope": scope,
        "edits": proposal["edits"],
        "activityGroups": proposal.get("activityGroups", []),
        "summary": proposal["summary"][:200],
    }
    if authorization:
        request.update(
            authorizationVersion=authorization["version"],
            authorizationScopeHash=authorization["scopeHash"],
        )
    request["requestId"] = f"{task['id']}:{round}:" + fingerprint(request)[:32]
    return await client.request(f"/projects/{task['projectId']}/candidates", request)
