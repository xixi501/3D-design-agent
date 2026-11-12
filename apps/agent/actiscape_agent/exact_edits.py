"""Conservative exact-edit parsing and arithmetic; no scene writes or model calls."""

import re
from copy import deepcopy

from .schemas import Intent
from .store import TaskError

FIELDS = {"x", "y", "z", "rot", "w", "d", "h", "color"}
COLORS = {
    "红色": "#c0392b",
    "蓝色": "#2f5f9f",
    "绿色": "#3f7d5a",
    "黄色": "#d4a72c",
    "黑色": "#222222",
    "白色": "#f2f0ea",
    "灰色": "#8a8f92",
    "米色": "#d8c9ae",
    "原木色": "#b58a5a",
    "胡桃木色": "#6f4e37",
}
NUMBER = r"(\d+(?:\.\d+)?)"
UNIT = r"(毫米|mm|厘米|cm|米|m)?"


def mm(raw, unit):
    return float(raw) * {"cm": 10, "厘米": 10, "m": 1000, "米": 1000}.get((unit or "").lower(), 1)


def no_change(project, message="对象已经满足请求，无需修改场景。"):
    return {
        "status": "completed",
        "message": message,
        "projectId": project["id"],
        "baseRevision": project["revision"],
        "committedRevision": None,
        "noChange": True,
        "diff": {"added": [], "deleted": [], "updated": []},
        "changes": [],
        "evidence": [],
        "checks": {"passed": True, "issues": [], "coverage": ["精确要求"], "limitations": []},
    }


def names(item):
    full = item.get("name", "")
    return {full, full.split("（")[0].split("(")[0]} - {""}


def resolve_targets(text, task, project, conversation, inherited=None):
    items = project["plan"].get("furniture", [])
    selected = task.get("selectedIds") or []
    matches = [f for f in items if any(n in text for n in names(f))]
    # Prefer full names over a shorter substring (e.g. 沙发 vs 单人沙发).
    if matches:
        remainder = text
        for name in sorted({n for f in matches for n in names(f)}, key=len, reverse=True):
            remainder = remainder.replace(name, "")
        remainder = re.sub(
            r"选中的|对象|家具|这[把件盏个]|所有|全部|每[个件把盏]|一起|和|及|与|、|的",
            "",
            remainder,
        )
        if remainder.strip():
            return [], None
        longest = max(len(n) for f in matches for n in names(f) if n in text)
        # Keep explicit lists as well as the longest matching name.
        mentioned = {n for f in matches for n in names(f) if n in text}
        matches = [
            f
            for f in matches
            if any(
                n in text and (len(n) == longest or not any(n != m and n in m for m in mentioned))
                for n in names(f)
            )
        ]
        ambiguous = any(
            sum(bool(names(f) & names(other)) for other in matches) > 1 for f in matches
        )
        if ambiguous and not re.search(r"所有|全部|每[个件把盏]|一起", text):
            chosen = [f for f in matches if f["id"] in selected]
            if len(chosen) != 1:
                return [], "场景中有多件同名家具，请选中要修改的对象后继续。"
            matches = chosen
        return [f["id"] for f in matches], None
    if re.fullmatch(r"(?:选中的(?:对象|家具)?|这些|它们|这[把件盏个]|它|这个|这件家具)?", text):
        ids = (
            (inherited if not text and inherited else selected)
            or (conversation or {}).get("focusIds")
            or []
        )
        if ids and all(any(f["id"] == i for f in items) for i in ids):
            return list(ids), None
        return [], "请先选中需要修改的家具，或说明具体名称。"
    return [], None


def parse_exact(task, project, conversation):
    """Return a complete Intent, a clarification, a no-op, or None (model grounding).

    Every non-protection clause must be consumed. A partial parse is never
    executable, including a valid first command followed by an unknown request.
    """
    text = task["input"].strip().rstrip("。！! ")
    if "\n用户补充：" in text:
        return None
    if re.fullmatch(r"(?:请)?(?:不要|别|无需|不必).+", text) and not re.search(
        r"[，,；;]|但是|但|改为|而是|再|同时|然后|并", text
    ):
        return {"noChange": True, "summary": "按要求保持场景不变。"}
    clauses = re.split(r"[，,；;。]|并且|同时|然后|以及|并", text)
    operations, permissions, targets, deletes = [], {}, [], []
    previous = []
    for raw in clauses:
        clause = raw.strip()
        if not clause:
            continue
        if re.fullmatch(r"(?:其他|其它|其余).*(?:保持不变|不变)", clause):
            continue
        clause = re.sub(r"^(?:请|帮我|再|把|将)+", "", clause).strip()
        command = re.search(
            r"(?:向|往)(?:左|右|上|下|东|西|北|南)|(?:顺时针|逆时针|向左|向右)?旋转|"
            r"(?:宽度?|深度?|高度?)(?:改为|调整为|设为|设置为|变成|为)|"
            r"(?:颜色)?(?:改成|改为|换成|变成|刷成|涂成)|删除|移除|删掉",
            clause,
        )
        if command is None:
            return None
        prefix, body = clause[: command.start()].strip(), clause[command.start() :].strip()
        if body.startswith(("删除", "移除", "删掉")):
            prefix = re.sub(r"^(?:删除|移除|删掉)", "", body).strip()
            prefix = re.sub(r"^(?:选中的|这[把件盏个])", "", prefix)
            if not prefix:
                prefix = "选中的对象"
            body = "删除"
        ids, question = resolve_targets(prefix, task, project, conversation, previous)
        if question:
            return {"status": "clarify", "summary": "需要明确对象", "question": question}
        if not ids:
            return None
        values, deltas = {}, {}
        move = re.fullmatch(
            r"(?:向|往)(左|右|上|下|东|西|北|南)(?:边|侧)?(?:移|移动|挪|平移|推)?\s*"
            + NUMBER
            + r"\s*"
            + UNIT,
            body,
            re.IGNORECASE,
        )
        rotate = re.fullmatch(
            r"(顺时针|逆时针|向左|向右)?\s*旋转\s*" + NUMBER + r"\s*(?:度|°)", body
        )
        dimension = re.fullmatch(
            r"(宽(?:度)?|深(?:度)?|高(?:度)?)(?:改为|调整为|设为|设置为|变成|为)\s*"
            + NUMBER
            + r"\s*"
            + UNIT,
            body,
            re.IGNORECASE,
        )
        color = re.fullmatch(
            r"(?:颜色)?(?:改成|改为|换成|变成|刷成|涂成)\s*("
            + "|".join(COLORS)
            + r"|#[0-9a-fA-F]{6})",
            body,
        )
        if move:
            direction, raw_value, unit = move.groups()
            axis = "x" if direction in "左右东西" else "y"
            deltas[axis] = mm(raw_value, unit) * (-1 if direction in "左西上北" else 1)
        elif rotate:
            direction, raw_value = rotate.groups()
            deltas["rot"] = float(raw_value) * (-1 if direction in ("逆时针", "向左") else 1)
        elif dimension:
            label, raw_value, unit = dimension.groups()
            values[{"宽": "w", "深": "d", "高": "h"}[label[0]]] = mm(raw_value, unit)
        elif color:
            values["color"] = COLORS.get(color[1], color[1]).lower()
        elif body != "删除":
            return None
        for id in ids:
            if id not in targets:
                targets.append(id)
            if body == "删除":
                deletes.append(id)
            permissions.setdefault(id, [])
            permissions[id] = list(dict.fromkeys(permissions[id] + list(values) + list(deltas)))
            operations.append(
                {
                    "target_id": id,
                    "action": "delete" if body == "删除" else "update",
                    "values": values,
                    "deltas": deltas,
                    "source_quote": raw.strip(),
                }
            )
        previous = ids
    if not operations:
        return None
    return Intent(
        status="ready",
        summary=text[:200],
        target_ids=targets,
        delete_ids=deletes,
        field_permissions=permissions,
        operations=operations,
    ).model_dump()


def exact_proposal(project, intent):
    working = {item["id"]: deepcopy(item) for item in project["plan"]["furniture"]}
    original = deepcopy(working)
    for operation in intent.get("operations") or []:
        target = working.get(operation["target_id"])
        if target is None:
            raise TaskError("NEEDS_INPUT", "精确操作目标不存在或已经删除")
        if operation["action"] == "delete":
            del working[target["id"]]
            continue
        for field, value in (operation.get("values") or {}).items():
            if field not in FIELDS:
                raise TaskError("INVALID_INTENT", "精确操作包含未支持字段")
            target[field] = value
        for field, delta in (operation.get("deltas") or {}).items():
            if field not in FIELDS - {"color"}:
                raise TaskError("INVALID_INTENT", "相对变化字段无效")
            target[field] = target.get(field, 0) + delta
        if "rot" in (operation.get("values") or {}) or "rot" in (operation.get("deltas") or {}):
            target["rot"] %= 360
    edits = []
    for id in intent["target_ids"]:
        if id not in working:
            edits.append({"type": "delete", "id": id})
            continue
        patch = {
            key: working[id][key] for key in FIELDS if working[id].get(key) != original[id].get(key)
        }
        if patch:
            edits.append({"type": "update", "id": id, "values": patch})
    return {"summary": intent["summary"][:200], "edits": edits, "noChange": not edits}
