"""One completion representation shared by normal commits and restart reconciliation."""


def conversation_focus(candidate: dict):
    if (
        candidate.get("kind") == "initialize"
        and candidate["generation"]["brief"]["purpose"] == "reading_lounge"
    ):
        chairs = [f for f in candidate["state"]["plan"]["furniture"] if f["type"] == "armchair"]
        g = candidate["generation"]
        if chairs:
            windows = [o for o in g["openings"] if o["type"] == "window"]
            if windows:
                o = windows[0]
                w, d = g["dimensions"]["width"], g["dimensions"]["depth"]
                x, y = {
                    "north": (o["from"] + o["width"] / 2, 0),
                    "south": (o["from"] + o["width"] / 2, d),
                    "east": (w, o["from"] + o["width"] / 2),
                    "west": (0, o["from"] + o["width"] / 2),
                }[o["side"]]
                chairs.sort(key=lambda f: (f["x"] - x) ** 2 + (f["y"] - y) ** 2)
            return [chairs[0]["id"]]
    return candidate["diff"]["added"] or candidate["diff"]["updated"]


def completion_result(task: dict, state: dict, candidate: dict, revision: int):
    before = {f["id"]: f for f in state["project"]["plan"]["furniture"]}
    after = {f["id"]: f for f in candidate["state"]["plan"]["furniture"]}
    changes = []
    for action, ids in candidate["diff"].items():
        for id in ids:
            old, new = before.get(id), after.get(id)
            fields = [
                {"field": key, "before": (old or {}).get(key), "after": (new or {}).get(key)}
                for key in ("x", "y", "z", "rot", "w", "d", "h", "color")
                if (old or {}).get(key) != (new or {}).get(key)
            ]
            changes.append(
                {
                    "action": action,
                    "id": id,
                    "name": (new or old or {}).get("name", id),
                    "fields": fields,
                }
            )
    path = f"/api/projects/{task['projectId']}/candidates/{candidate['id']}"
    result = {
        "status": "completed",
        "message": f"已保存：{candidate['summary'].rstrip('。；; .')}。本次修改作为一个事务提交，可撤销。",
        "projectId": task["projectId"],
        "candidateId": candidate["id"],
        "baseRevision": candidate["baseRevision"],
        "committedRevision": revision,
        "diff": candidate["diff"],
        "changes": changes,
        "checks": candidate["checks"],
        "review": state.get("review") or candidate.get("review"),
        "evidence": [
            {**e, "url": path + f"/evidence/{e['view']}"}
            for e in state.get("evidence") or candidate.get("evidence", [])
        ],
        "repairs": state.get("repairs", 0),
        "versionRetries": state.get("version_retries", 0),
    }
    if candidate.get("kind") == "initialize_floorplan":
        g = task.get("generation", {})
        result.update(
            generation={**candidate["generation"], "skillsUsed": g.get("skillsUsed", [])},
            skillsUsed=g.get("skillsUsed", []),
            structure=candidate["structure"],
            focusIds=conversation_focus(candidate),
        )
        result["message"] += (
            " 整层结构及全屋原图家具布局已保留，可继续选择家具进行局部编辑。"
            if task["generation"].get("workflowVersion") == 4
            else " 整层结构及客餐厅原图布局已保留，可继续选择家具进行局部编辑。"
        )
    if candidate.get("kind") == "initialize":
        g = task.get("generation", {})
        result.update(
            generation={
                **candidate["generation"],
                "style": g.get("style"),
                "furniture": g.get("furniture", []),
                "skillsUsed": g.get("skillsUsed", []),
            },
            skillsUsed=g.get("skillsUsed", []),
            structure=candidate["structure"],
            focusIds=conversation_focus(candidate),
        )
        if candidate["generation"]["brief"]["purpose"] == "reading_lounge" and result["focusIds"]:
            result["message"] += " 已将一把单人沙发设为主要阅读座位，可继续说“把它……”调整。"
    generation = task.get("generation", {})
    if task.get("mode") == "interactive_action":
        result["message"] = "开启状态已保存，可撤销。"
        result["policy"] = generation.get("policy")
    elif task.get("mode") == "repair_layout":
        result["message"] = "AI 已完成布局修复并通过检查，可撤销。"
        result["policy"] = generation.get("policy")
    elif task.get("mode") == "photo_to_scene":
        result["message"] = "照片物品已放入场景并保存，可撤销。"
        result["policy"] = generation.get("policy")
    result["skillsUsed"] = generation.get("skillsUsed", [])
    result["skillSelection"] = generation.get("skillSelection")
    for extra_key in ("householdMemory", "sandboxSolver", "standardCitations", "procurementQuote"):
        if generation.get(extra_key) is not None:
            result[extra_key] = generation[extra_key]
    result["verification"] = {
        "mode": candidate.get("verification", "screenshots"),
        "rendered": bool(result["evidence"]),
        "visualReviewed": candidate.get("verification") != "deterministic"
        and bool(result["evidence"]),
    }
    if task.get("cancelRequested"):
        result["message"] += " 取消请求到达时原子提交已开始，已核对实际保存结果。"
    return result
