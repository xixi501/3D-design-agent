"""Bounded two-pass floorplan recognition with deterministic draft assembly."""

import hashlib
import math
import re
import statistics

from langchain_core.tools import tool

from .client import SceneFailure
from .config import FLOORPLAN_RECOGNITION_OPTIONS, FLOORPLAN_REVIEW_OPTIONS
from .floorplan_roles import PIXEL_RULES, RULES
from .floorplan_schemas import (
    FloorplanReview,
    FurnitureContourRecognition,
    FurnitureRecognition,
    MeasuredDraftUpdate,
    RecognitionV3,
    StructureRecognition,
)
from .floorplan_tools import FloorplanToolset
from .floorplan_v2 import FloorplanV2
from .skill_registry import FLOORPLAN_TOOLS, load_design_skill, skill_record
from .store import TaskError, fingerprint

VERSION = "s2c-floorplan-v3-3"
COMMON = (
    RULES
    + PIXEL_RULES.replace("餐椅四把就是四个符号", "每把餐椅都要单独记录")
    + """\n本任务使用受控两阶段识别。固定代码已经取得墙段、断口和尺寸刻度候选；模型只判断候选语义，不自由生成整张草稿。
只返回指定结构化结果，不输出 chain-of-thought 或解释性正文。所有坐标使用原图像素。不得索要或猜测评估参考。
结构阶段只处理墙、门窗、房间、尺寸锚点和阻断不确定项；家具阶段只清点已选客餐厅。"""
)
STRUCTURE = (
    COMMON
    + """\n你是结构识别角色。输入包含 StructureSkeleton、candidateWalls、编号分析图、墙掩膜和原图。
walls 中每项 business wall 必须通过 candidateWallIds 选择代码预先合并的候选墙；不得引用原始段索引。candidateWalls 已按共线、相接和断口 a/b 关系合并，同一 candidateWallId 只能使用一次。
不要把外侧尺寸线、家具边或同一墙的另一侧描边当墙。连接墙需在房间闭合处共享端点。分析图漏墙时才允许引用实际裁剪生成 customSegments；没有裁剪证据的坐标会被拒绝。
openings 必须引用 openingCandidates 的 candidateId 和 type；代码决定所属墙、偏移和宽度。同一洞口候选不能重复使用。
rooms 使用房间名所在原图点，每个封闭区域一个标签；functionalArea 写 living/dining/kitchen/bedroom/bathroom/other。targetRoomIds 只选需要复现家具的客餐厅。
dimensionReads 只选择 dimensionCandidates，并逐字抄录图中真实数字与单位；代码根据候选位置决定端点、墙面基准和 evidence。不要返回 anchors 或自行填写锚点。未知 height/wallThickness 留 null。
无法确认的关键结构写入 uncertainties(blocking=true)。
证据引用使用 analysisId、cropId 或 image:<sha256>。status=unsupported 仅用于非单层正交清晰平面图。"""
)
STRUCTURE_REPAIR = (
    COMMON
    + """\n上一轮结构结果无法由固定代码组装。你只修正 StructureRecognition，不修改候选骨架，不增加无证据墙。
只选择 StructureSkeleton.candidateWalls 中存在的 candidateWallId；门窗只引用 openingCandidates，尺寸只引用 dimensionCandidates，并逐字抄录图中标注。
按输入的 errorCode、objectIds、message 和 allowedCandidateWallIds 修正；不得用相近候选凑数，不得删除阻断不确定项。只返回结构化结果，不输出解释。"""
)
FURNITURE = (
    COMMON
    + """\n你是家具清点角色。结构草稿、分析叠图、诊断图与目标客餐厅已经确定。只输出 symbols，不修改墙、门窗、房间、锚点或不确定项。
按固定顺序逐区扫描：北墙、东墙、南墙、西墙，四角，每个门窗附近，然后 3×3 网格。每件可见目标家具单独记录，不得把一组餐椅写成一个符号，也不得添加图中没有的家具。
categoryCode 只能使用给定枚举；sourceLabel 保存原图中的中文或英文名称，不能把位置、朝向或解释写进 categoryCode。每个符号必须属于 targetRoomIds，included=true，evidenceRefs 引用原图、编号分析图或诊断文件。
开放厨房、卧室和卫生间只保留结构；它们内部家具不得进入 symbols。w/d 是旋转前原图像素占地，不是毫米或目录默认尺寸。"""
)
FURNITURE_CONTOURS = (
    COMMON
    + """\n你是家具清点角色。结构草稿、目标客餐厅和编号家具轮廓候选已经确定。只输出 symbols，不修改墙、门窗、房间、锚点或不确定项。
按北墙、东墙、南墙、西墙、四角、门窗附近、3×3 网格逐件核对。每件目标家具使用一个或多个最贴合的 contourCandidateIds，代码会合并这些轮廓框并计算 x/y/w/d。
不得返回坐标、宽深或目录默认尺寸。组合轮廓必须紧密覆盖同一件家具；不要把邻近家具、房间文字或尺寸文字混入。地毯可以位于家具下方，餐椅可以收在餐桌旁，均为原图正常布局。
categoryCode 只能使用固定枚举；sourceLabel 保存原图名称或简短视觉描述。所有符号属于 targetRoomIds，included=true。每件可见目标家具单独登记，不得把一组餐椅写成一个符号，也不得添加图中没有的家具。"""
)
MEASURE = (
    COMMON
    + """\n你是空间设计的测量阶段。输入是两阶段合并后的当前草稿、共享证据和原图叠加。仅返回 MeasuredDraftUpdate，commands 只修改指定对象和字段。
baseDraftRevision/Hash 必须原样使用。修改已有对象须在 changeReasons 中以 collection/id 附原图依据及 evidenceRefs；已有说明累计保留。
固定代码已预先执行 precomputedWallMeasurements 和 precomputedDimensionMeasurements。优先直接引用这些记录及其 id，不要为已有记录重复调用 fit_wall_candidates 或 measure_dimension_chain。只有新增裁剪墙或预计算明确失败时才调用测量工具。
features/dimensions 必须引用真实测量和清晰尺寸标注；尺寸为 from->to 正距离，毫米几何由代码解算。不得为通过预检改数字、伪造连接或删除冲突标注。
不需要调用终止预检工具；代码在本次结构化结果后执行预检并返回问题。"""
)
CHECK = (
    COMMON
    + """\n你是独立检查角色。只核对当前哈希草稿，不执行修改。检查原图、结构叠加、毫米几何回投和家具清单。
逐项核对墙体、门窗、房间、目标家具类别/数量/位置/朝向和尺寸证据。必须使用真实草稿对象 id，不能仅凭启发式工具零问题通过。
每个 issue 必须引用当前诊断 evidenceRefs，并给出原图像素 bbox=[x0,y0,x1,y1]；不能定位的问题标为 advisory。墙上门洞与固定 openingCandidates 冲突时不得仅凭文字声称“连续实墙”。地毯位于家具下方、餐椅收在桌边不算多余遮挡或位置错误。
issues 只能使用固定 code；description 写一条可定位的具体问题，不写推理过程。passed=true 只有在关键结构和目标家具全部可验证且没有 blocking issues 时成立。
无法验证关键项、图片缺失或代码检查未通过时必须 passed=false。"""
)


def _code_review_issues(draft, diagnostics, skeleton):
    issues = []
    checks = diagnostics.get("checks") or {}
    for issue in checks.get("issues") or []:
        if not issue.get("blocking", True):
            continue
        issues.append(
            {
                "code": "OTHER",
                "source": "code",
                "severity": "blocking",
                "object_ids": list(issue.get("objectIds") or [])[:20],
                "description": str(issue.get("message") or "确定性检查未通过")[:300],
                "evidenceRefs": [diagnostics["id"]] if diagnostics.get("id") else [],
                "bbox": None,
            }
        )
    data = draft["data"]
    if any(item.get("blocking") for item in data.get("uncertainties", [])):
        issues.append(
            {
                "code": "OTHER",
                "source": "code",
                "severity": "blocking",
                "object_ids": [
                    item["id"] for item in data.get("uncertainties", []) if item.get("blocking")
                ][:20],
                "description": "仍有阻断不确定项",
                "evidenceRefs": [diagnostics["id"]] if diagnostics.get("id") else [],
                "bbox": None,
            }
        )
    if not data.get("symbols"):
        issues.append(
            {
                "code": "FURNITURE_MISSING",
                "source": "code",
                "severity": "blocking",
                "object_ids": [],
                "description": "目标客餐厅没有已确认家具",
                "evidenceRefs": [diagnostics["id"]] if diagnostics.get("id") else [],
                "bbox": None,
            }
        )
    if skeleton.get("structureSkeletonVersion", 0) >= 3:
        dimensions = skeleton.get("dimensionCandidates") or []
        if len(data.get("dimensionObservations") or []) < len(dimensions):
            issues.append(
                {
                    "code": "DIMENSION_MISMATCH",
                    "source": "code",
                    "severity": "blocking",
                    "object_ids": [candidate["candidateId"] for candidate in dimensions][:20],
                    "description": "固定尺寸候选没有被完整绑定到草稿",
                    "evidenceRefs": [skeleton["analysisId"]],
                    "bbox": None,
                }
            )
        for candidate in skeleton.get("openingCandidates") or []:
            owner = next(
                (
                    wall
                    for wall in data.get("walls", [])
                    if (
                        abs(
                            (wall["a"]["y"] if wall["a"]["y"] == wall["b"]["y"] else wall["a"]["x"])
                            - float(candidate["line"])
                        )
                        <= 3
                    )
                ),
                None,
            )
            matched = False
            if owner:
                along = "x" if owner["a"]["y"] == owner["b"]["y"] else "y"
                wall_start = min(owner["a"][along], owner["b"][along])
                for opening in data.get("openings", []):
                    if opening["wallId"] != owner["id"]:
                        continue
                    start = wall_start + opening["offset"] - opening["width"] / 2
                    end = wall_start + opening["offset"] + opening["width"] / 2
                    if (
                        abs(start - float(candidate["start"])) <= 3
                        and abs(end - float(candidate["end"])) <= 3
                    ):
                        matched = True
                        break
            if not matched:
                issues.append(
                    {
                        "code": "OPENING_MISMATCH",
                        "source": "code",
                        "severity": "blocking",
                        "object_ids": [
                            owner["id"] if owner else "",
                            candidate["candidateId"],
                        ],
                        "description": "固定洞口候选没有被完整绑定到草稿",
                        "evidenceRefs": [skeleton["analysisId"]],
                        "bbox": [
                            candidate["line"] - 10,
                            candidate["start"],
                            candidate["line"] + 10,
                            candidate["end"],
                        ]
                        if candidate["orient"] == "v"
                        else [
                            candidate["start"],
                            candidate["line"] - 10,
                            candidate["end"],
                            candidate["line"] + 10,
                        ],
                    }
                )
    return issues


def _arbitrate_review(review, draft, diagnostics, skeleton):
    code_issues = _code_review_issues(draft, diagnostics, skeleton)
    model_issues = []
    for issue in review.get("issues", []):
        item = {
            **issue,
            "source": "model",
            "severity": "advisory",
            "evidenceRefs": list(issue.get("evidenceRefs") or []),
        }
        model_issues.append(item)
    conflicts = []
    if review.get("passed") is False and not code_issues:
        conflicts.append(
            {
                "code": "REVIEW_CONFLICT",
                "source": "model",
                "severity": "advisory",
                "object_ids": sorted(
                    {
                        object_id
                        for issue in review.get("issues", [])
                        for object_id in issue.get("object_ids", [])
                    }
                )[:20],
                "description": "模型审核提出的问题未被固定候选或代码检查复现",
                "evidenceRefs": [],
                "bbox": None,
            }
        )
    issues = [*code_issues, *model_issues, *conflicts]
    passed = not code_issues
    if code_issues:
        summary = "确定性检查发现阻断问题；模型意见仅保留为辅助证据。"
    elif conflicts:
        summary = "确定性检查通过；未能复现的模型审核意见已记录为 advisory。"
    else:
        summary = "确定性检查通过，模型未提出可复现的阻断问题。"
    return {
        "passed": passed,
        "summary": summary[:800],
        "issues": issues[:20],
    }


def _candidate_id(index, prefix):
    return f"{prefix}{index}"


def _group_candidate_walls(segments, gaps):
    parent = list(range(len(segments)))

    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left, right):
        left, right = find(left), find(right)
        if left != right:
            parent[max(left, right)] = min(left, right)

    for left in range(len(segments)):
        a = segments[left]
        for right in range(left + 1, len(segments)):
            b = segments[right]
            if a["orient"] != b["orient"]:
                continue
            tolerance = max(2.0, min(float(a["t"]), float(b["t"])) / 2)
            if abs(float(a["line"]) - float(b["line"])) > tolerance:
                continue
            if max(float(a["s0"]), float(b["s0"])) <= min(float(a["s1"]), float(b["s1"])) + 1:
                union(left, right)

    for gap in gaps:
        left, right = gap.get("a"), gap.get("b")
        if (
            isinstance(left, int)
            and isinstance(right, int)
            and 0 <= left < len(segments)
            and 0 <= right < len(segments)
            and segments[left]["orient"] == segments[right]["orient"]
            and abs(float(segments[left]["line"]) - float(segments[right]["line"]))
            <= max(2.0, min(float(segments[left]["t"]), float(segments[right]["t"])) * 0.6)
        ):
            union(left, right)

    groups = {}
    for index in range(len(segments)):
        groups.setdefault(find(index), []).append(index)
    candidate_walls = []
    group_by_index = {}
    for indices in sorted(groups.values(), key=lambda values: (min(values), max(values))):
        indices = sorted(indices)
        wall_id = f"cw_{indices[0]}_{indices[-1]}"
        pieces = [segments[index] for index in indices]
        candidate_walls.append(
            {
                "candidateWallId": wall_id,
                "indices": indices,
                "orient": pieces[0]["orient"],
                "line": statistics.median(float(piece["line"]) for piece in pieces),
                "s0": min(float(piece["s0"]) for piece in pieces),
                "s1": max(float(piece["s1"]) for piece in pieces),
                "t": statistics.median(float(piece["t"]) for piece in pieces),
                "gapIndices": [],
            }
        )
        for index in indices:
            group_by_index[index] = wall_id

    by_id = {wall["candidateWallId"]: wall for wall in candidate_walls}
    enriched_gaps = []
    for index, gap in enumerate(gaps):
        left, right = gap.get("a"), gap.get("b")
        owner = (
            group_by_index.get(left)
            if isinstance(left, int)
            and isinstance(right, int)
            and group_by_index.get(left) == group_by_index.get(right)
            else None
        )
        enriched = {
            **gap,
            "candidateId": _candidate_id(index, "g"),
            "candidateWallId": owner,
        }
        enriched_gaps.append(enriched)
        if owner:
            by_id[owner]["gapIndices"].append(index)
    return candidate_walls, enriched_gaps


def build_structure_skeleton(record, image):
    result = record.get("result") or {}
    if result.get("candidateWalls"):
        candidate_walls = []
        for candidate in result.get("candidateWalls") or []:
            candidate_walls.append(
                {
                    **candidate,
                    "analysisId": record["id"],
                    "evidenceRefs": [record["id"]],
                    "gapIndices": [
                        index
                        for index, opening in enumerate(result.get("openingCandidates") or [])
                        if opening.get("candidateWallId") == candidate.get("candidateWallId")
                    ],
                }
            )
        opening_candidates = [
            {
                **opening,
                "analysisId": record["id"],
                "evidenceRefs": [record["id"]],
            }
            for opening in result.get("openingCandidates") or []
        ]
        dimension_candidates = [
            {
                **candidate,
                "analysisId": record["id"],
                "evidenceRefs": [record["id"]],
            }
            for candidate in result.get("dimensionCandidates") or []
        ]
        return {
            "structureSkeletonVersion": 3,
            "analysisId": record["id"],
            "image": {k: image[k] for k in ("id", "sha256", "width", "height")},
            "outline_px": result.get("outline_px"),
            "segments": [
                {"analysisId": record["id"], "index": index, **segment}
                for index, segment in enumerate(result.get("segments_px") or [])
            ],
            "candidateWalls": candidate_walls,
            "openingCandidates": opening_candidates,
            "dimensionCandidates": dimension_candidates,
            "gaps": opening_candidates,
            "dimensions": result.get("dims_px") or {},
            "repository": record.get("repository"),
            "commit": record.get("commit"),
            "limitations": record.get("limitations") or [],
        }
    segments = []
    for index, segment in enumerate(result.get("segments_px") or []):
        segments.append(
            {
                "candidateId": _candidate_id(index, "s"),
                "analysisId": record["id"],
                "index": index,
                **segment,
            }
        )
    raw_gaps = [
        {
            "analysisId": record["id"],
            "index": index,
            **gap,
        }
        for index, gap in enumerate(result.get("gaps_px") or [])
    ]
    candidate_walls, gaps = _group_candidate_walls(segments, raw_gaps)
    return {
        "structureSkeletonVersion": 2,
        "analysisId": record["id"],
        "image": {k: image[k] for k in ("id", "sha256", "width", "height")},
        "outline_px": result.get("outline_px"),
        "segments": segments,
        "candidateWalls": candidate_walls,
        "gaps": gaps,
        "dimensions": result.get("dims_px") or {},
        "repository": record.get("repository"),
        "commit": record.get("commit"),
        "limitations": record.get("limitations") or [],
    }


def _segment_piece(skeleton, analysis_id, index):
    if analysis_id != skeleton["analysisId"]:
        raise TaskError("INVALID_STRUCTURE", "墙段引用了非当前分析记录")
    if not isinstance(index, int) or index < 0 or index >= len(skeleton["segments"]):
        raise TaskError("INVALID_STRUCTURE", "墙段候选索引无效")
    return skeleton["segments"][index]


def _gap_piece(skeleton, analysis_id, index):
    if analysis_id != skeleton["analysisId"]:
        raise TaskError("INVALID_STRUCTURE", "断口引用了非当前分析记录")
    if not isinstance(index, int) or index < 0 or index >= len(skeleton["gaps"]):
        raise TaskError("INVALID_STRUCTURE", "门窗断口候选索引无效")
    return skeleton["gaps"][index]


def _dimension_value(label):
    match = re.search(
        r"([0-9]+(?:\.[0-9]+)?)\s*(mm|cm|m)(?![a-z])",
        label,
        flags=re.IGNORECASE,
    )
    if not match:
        raise TaskError(
            "INVALID_DIMENSION_REFERENCE",
            f"尺寸标注 {label!r} 不含可解析的长度",
            details={"objectIds": [label]},
        )
    return float(match.group(1)), match.group(2).lower()


def _dimension_anchor(candidate, geometry, label):
    basis = candidate.get("suggestedBasis")
    if basis not in ("interior", "centerline", "exterior"):
        raise TaskError(
            "INVALID_DIMENSION_REFERENCE",
            f"尺寸候选 {candidate['candidateId']} 缺少有效基准",
            details={"objectIds": [candidate["candidateId"]]},
        )
    value, unit = _dimension_value(label)
    role = geometry["role"]
    orient = geometry["orient"]
    line = geometry["line"]
    start = geometry["start"]
    end = geometry["end"]
    thickness = geometry["thickness"]
    if basis == "centerline":
        along_start, along_end = start, end
        normal = line
    else:
        outward = -1 if role in ("top", "left") else 1
        sign = outward if basis == "exterior" else -outward
        normal = line + sign * thickness / 2
        along_start = start + (-1 if basis == "exterior" else 1) * thickness / 2
        along_end = end + (1 if basis == "exterior" else -1) * thickness / 2
    if orient == "h":
        a = {"x": round(along_start, 3), "y": round(normal, 3)}
        b = {"x": round(along_end, 3), "y": round(normal, 3)}
    else:
        a = {"x": round(normal, 3), "y": round(along_start, 3)}
        b = {"x": round(normal, 3), "y": round(along_end, 3)}
    return {
        "a": a,
        "b": b,
        "distance": {"value": value, "unit": unit},
        "basis": basis,
        "evidence": (
            f"dimension candidate {candidate['candidateId']} "
            f"ticks {candidate['ticks'][0]}..{candidate['ticks'][1]}: {label}"
        ),
    }


def _assemble_structure_v3(skeleton, recognition, evidence_index):
    candidate_by_id = {wall["candidateWallId"]: wall for wall in skeleton.get("candidateWalls", [])}
    candidate_owner = {}
    draft_walls = []
    wall_geometry = {}
    for wall in recognition["walls"]:
        pieces = []
        for candidate_id in wall.get("candidateWallIds", []):
            candidate = candidate_by_id.get(candidate_id)
            if candidate is None:
                raise TaskError(
                    "UNKNOWN_WALL_GROUP",
                    f"墙 {wall['id']} 引用了未知候选墙 {candidate_id}",
                    details={"objectIds": [wall["id"], candidate_id]},
                )
            if candidate_id in candidate_owner:
                raise TaskError(
                    "INVALID_WALL_GEOMETRY",
                    f"候选墙 {candidate_id} 被多个业务墙重复使用",
                    details={"objectIds": [wall["id"], candidate_id]},
                )
            candidate_owner[candidate_id] = wall["id"]
            pieces.append(candidate)
        for custom in wall.get("customSegments", []):
            if custom["cropId"] not in evidence_index:
                raise TaskError(
                    "INVALID_WALL_GEOMETRY",
                    f"新增墙段 {wall['id']} 缺少有效裁剪证据",
                    details={"objectIds": [wall["id"], custom["cropId"]]},
                )
            pieces.append(
                {
                    "orient": custom["kind"].lower(),
                    "line": custom["c"],
                    "s0": min(custom["p0"], custom["p1"]),
                    "s1": max(custom["p0"], custom["p1"]),
                    "t": wall.get("thicknessPx"),
                    "role": "custom",
                }
            )
        if not pieces:
            raise TaskError(
                "INVALID_WALL_GEOMETRY",
                f"墙 {wall['id']} 没有真实候选",
                details={"objectIds": [wall["id"]]},
            )
        orientations = {piece["orient"] for piece in pieces}
        if len(orientations) != 1:
            raise TaskError(
                "MIXED_WALL_ORIENTATION",
                f"墙 {wall['id']} 混合了水平和竖直候选",
                details={"objectIds": [wall["id"]]},
            )
        lines = [float(piece["line"]) for piece in pieces]
        if max(lines) - min(lines) > 3:
            raise TaskError(
                "INVALID_WALL_GEOMETRY",
                f"墙 {wall['id']} 的候选不在同一直线上",
                details={"objectIds": [wall["id"]]},
            )
        orient = next(iter(orientations))
        line = statistics.median(lines)
        start = min(float(piece["s0"]) for piece in pieces)
        end = max(float(piece["s1"]) for piece in pieces)
        if end - start < 2:
            raise TaskError(
                "INVALID_WALL_GEOMETRY",
                f"墙 {wall['id']} 长度无效",
                details={"objectIds": [wall["id"]]},
            )
        thickness_values = [
            float(piece["t"])
            for piece in pieces
            if piece.get("t") is not None and float(piece["t"]) > 0
        ]
        thickness = (
            float(wall["thicknessPx"])
            if wall.get("thicknessPx") is not None
            else statistics.median(thickness_values)
            if thickness_values
            else 8.0
        )
        role = next(
            (
                piece.get("role")
                for piece in pieces
                if piece.get("role") in ("top", "bottom", "left", "right")
            ),
            "interior",
        )
        if orient == "h":
            a = {"x": round(start, 3), "y": round(line, 3)}
            b = {"x": round(end, 3), "y": round(line, 3)}
        else:
            a = {"x": round(line, 3), "y": round(start, 3)}
            b = {"x": round(line, 3), "y": round(end, 3)}
        draft_walls.append(
            {
                "id": wall["id"],
                "a": a,
                "b": b,
                "thicknessPx": round(thickness, 3),
            }
        )
        wall_geometry[wall["id"]] = {
            "orient": orient,
            "line": line,
            "start": start,
            "end": end,
            "thickness": thickness,
            "role": role,
        }
    used_openings = set()
    opening_by_id = {
        opening["candidateId"]: opening for opening in skeleton.get("openingCandidates", [])
    }
    draft_openings = []
    for opening in recognition["openings"]:
        candidate_id = opening.get("candidateId")
        candidate = opening_by_id.get(candidate_id)
        if candidate is None:
            raise TaskError(
                "OPENING_OWNER_UNRESOLVED",
                f"门窗 {opening['id']} 引用了未知洞口候选 {candidate_id}",
                details={"objectIds": [opening["id"], candidate_id]},
            )
        if candidate_id in used_openings:
            raise TaskError(
                "OPENING_OWNER_UNRESOLVED",
                "同一个门窗候选被重复使用",
                details={"objectIds": [opening["id"], candidate_id]},
            )
        used_openings.add(candidate_id)
        owner_candidate = candidate.get("candidateWallId")
        owner = candidate_owner.get(owner_candidate)
        if owner is None:
            raise TaskError(
                "OPENING_OWNER_UNRESOLVED",
                f"门窗 {opening['id']} 的洞口所属墙未被选择",
                details={"objectIds": [opening["id"], owner_candidate or ""]},
            )
        geometry = wall_geometry[owner]
        start = float(candidate["start"])
        end = float(candidate["end"])
        if (
            candidate.get("orient") != geometry["orient"]
            or start < geometry["start"] - 2
            or end > geometry["end"] + 2
        ):
            raise TaskError(
                "OPENING_OUT_OF_RANGE",
                f"门窗 {opening['id']} 超出所属墙范围",
                details={"objectIds": [opening["id"], owner]},
            )
        draft_openings.append(
            {
                "id": opening["id"],
                "wallId": owner,
                "type": opening["type"],
                "offset": round((start + end) / 2 - geometry["start"], 3),
                "width": round(end - start + 1, 3),
                **{
                    key: opening[key]
                    for key in ("sill", "head", "side", "hinge")
                    if opening.get(key) is not None
                },
            }
        )
    missing_openings = set(opening_by_id) - used_openings
    if missing_openings:
        raise TaskError(
            "OPENING_OWNER_UNRESOLVED",
            "固定洞口候选没有被完整选择",
            details={"objectIds": sorted(missing_openings)},
        )
    room_ids = {room["id"] for room in recognition["rooms"]}
    if any(room_id not in room_ids for room_id in recognition["targetRoomIds"]):
        raise TaskError(
            "TARGET_ROOM_MISSING",
            "目标客餐厅引用了未知房间",
            details={"objectIds": recognition["targetRoomIds"]},
        )
    dimension_by_id = {
        candidate["candidateId"]: candidate for candidate in skeleton.get("dimensionCandidates", [])
    }
    used_dimensions = set()
    observations = []
    for read in recognition.get("dimensionReads", []):
        candidate = dimension_by_id.get(read["candidateId"])
        if candidate is None:
            raise TaskError(
                "INVALID_DIMENSION_REFERENCE",
                f"尺寸引用未知候选 {read['candidateId']}",
                details={"objectIds": [read["candidateId"]]},
            )
        if read["candidateId"] in used_dimensions:
            raise TaskError(
                "INVALID_DIMENSION_REFERENCE",
                f"尺寸候选 {read['candidateId']} 被重复引用",
                details={"objectIds": [read["candidateId"]]},
            )
        used_dimensions.add(read["candidateId"])
        role = candidate.get("suggestedWallRole")
        owner = next(
            (wall_id for wall_id, geometry in wall_geometry.items() if geometry["role"] == role),
            None,
        )
        if owner is None:
            raise TaskError(
                "INVALID_DIMENSION_REFERENCE",
                f"尺寸候选 {read['candidateId']} 对应的外围墙未被选择",
                details={"objectIds": [read["candidateId"], role or ""]},
            )
        anchor = _dimension_anchor(candidate, wall_geometry[owner], read["label"])
        observations.append(
            {
                "id": "dim_obs_" + read["candidateId"],
                "sourceCandidateId": read["candidateId"],
                "label": read["label"],
                **anchor,
                "scaleReference": False,
            }
        )
    anchors = []
    if observations:
        primary = max(
            (observation for observation in observations if observation["basis"] == "exterior"),
            key=lambda observation: math.hypot(
                observation["b"]["x"] - observation["a"]["x"],
                observation["b"]["y"] - observation["a"]["y"],
            ),
            default=observations[0],
        )
        primary["scaleReference"] = True
        anchors = [{key: primary[key] for key in ("a", "b", "distance", "basis", "evidence")}]
    elif recognition.get("anchors"):
        anchors = recognition["anchors"]
    if dimension_by_id and len(used_dimensions) != len(dimension_by_id):
        raise TaskError(
            "INVALID_DIMENSION_REFERENCE",
            "固定尺寸候选没有被完整绑定",
            details={"objectIds": sorted(set(dimension_by_id) - used_dimensions)},
        )
    missing_walls = set(candidate_by_id) - set(candidate_owner)
    if missing_walls:
        raise TaskError(
            "INVALID_WALL_GEOMETRY",
            "固定墙体候选没有被完整选择",
            details={"objectIds": sorted(missing_walls)},
        )
    return {
        "status": "draft",
        "question": recognition.get("question", ""),
        "recognitionVersion": 3,
        "measurementVersion": 2,
        "name": recognition["name"],
        **{
            key: recognition[key]
            for key in ("height", "wallThickness")
            if recognition.get(key) is not None
        },
        "anchors": anchors,
        **({"dimensionObservations": observations} if observations else {}),
        "walls": draft_walls,
        "openings": draft_openings,
        "rooms": recognition["rooms"],
        "symbols": [],
        "targetRoomIds": recognition["targetRoomIds"],
        "uncertainties": recognition["uncertainties"],
        "features": [],
        "dimensions": [],
    }


def _assemble_structure(skeleton, recognition, evidence_index):
    if skeleton.get("structureSkeletonVersion", 0) >= 3:
        return _assemble_structure_v3(skeleton, recognition, evidence_index)
    if recognition["status"] == "unsupported":
        return recognition

    candidate_by_id = {wall["candidateWallId"]: wall for wall in skeleton.get("candidateWalls", [])}
    wall_geometry = {}
    candidate_owner = {}
    draft_walls = []
    for wall in recognition["walls"]:
        pieces = []
        for candidate_id in wall.get("candidateWallIds", []):
            candidate = candidate_by_id.get(candidate_id)
            if candidate is None:
                raise TaskError(
                    "UNKNOWN_WALL_GROUP",
                    f"墙 {wall['id']} 引用了未知候选墙 {candidate_id}",
                    details={"objectIds": [wall["id"], candidate_id]},
                )
            if candidate_id in candidate_owner:
                raise TaskError(
                    "INVALID_WALL_GEOMETRY",
                    f"候选墙 {candidate_id} 被多个业务墙重复使用",
                    details={"objectIds": [wall["id"], candidate_id]},
                )
            candidate_owner[candidate_id] = wall["id"]
            pieces.extend(
                _segment_piece(skeleton, skeleton["analysisId"], index)
                for index in candidate["indices"]
            )
        for custom in wall.get("customSegments", []):
            if custom["cropId"] not in evidence_index:
                raise TaskError(
                    "INVALID_WALL_GEOMETRY",
                    f"新增墙段 {wall['id']} 缺少有效裁剪证据",
                    details={"objectIds": [wall["id"], custom["cropId"]]},
                )
            pieces.append(
                {
                    "orient": custom["kind"].lower(),
                    "line": custom["c"],
                    "s0": min(custom["p0"], custom["p1"]),
                    "s1": max(custom["p0"], custom["p1"]),
                    "t": wall.get("thicknessPx"),
                }
            )
        if not pieces:
            raise TaskError(
                "INVALID_WALL_GEOMETRY",
                f"墙 {wall['id']} 没有真实候选",
                details={"objectIds": [wall["id"]]},
            )
        orientations = {piece["orient"] for piece in pieces}
        if len(orientations) != 1:
            raise TaskError(
                "MIXED_WALL_ORIENTATION",
                f"墙 {wall['id']} 混合了水平和竖直候选",
                details={"objectIds": [wall["id"]]},
            )
        lines = [float(piece["line"]) for piece in pieces]
        if max(lines) - min(lines) > 3:
            raise TaskError(
                "INVALID_WALL_GEOMETRY",
                f"墙 {wall['id']} 的候选不在同一直线上",
                details={"objectIds": [wall["id"]]},
            )
        start = min(float(piece["s0"]) for piece in pieces)
        end = max(float(piece["s1"]) for piece in pieces)
        if end - start < 2:
            raise TaskError(
                "INVALID_WALL_GEOMETRY",
                f"墙 {wall['id']} 长度无效",
                details={"objectIds": [wall["id"]]},
            )
        orient = next(iter(orientations))
        line = statistics.median(lines)
        thickness_values = [
            float(piece["t"])
            for piece in pieces
            if piece.get("t") is not None and float(piece["t"]) > 0
        ]
        thickness = (
            float(wall["thicknessPx"])
            if wall.get("thicknessPx") is not None
            else statistics.median(thickness_values)
            if thickness_values
            else None
        )
        if orient == "h":
            a, b = {"x": start, "y": line}, {"x": end, "y": line}
        else:
            a, b = {"x": line, "y": start}, {"x": line, "y": end}
        draft_walls.append(
            {
                "id": wall["id"],
                "a": a,
                "b": b,
                **({"thicknessPx": thickness} if thickness is not None else {}),
            }
        )
        wall_geometry[wall["id"]] = {
            "orient": orient,
            "line": line,
            "start": start,
            "end": end,
        }

    draft_openings = []
    # Candidate segmentation stops at wall faces. Snap only endpoints already
    # adjacent to an orthogonal centerline intersection; this never invents a
    # connection across a room or changes a wall's axis.
    snap_tolerance = 24.0
    horizontal = [wall for wall in draft_walls if wall["a"]["y"] == wall["b"]["y"]]
    vertical = [wall for wall in draft_walls if wall["a"]["x"] == wall["b"]["x"]]
    for h_wall in horizontal:
        for v_wall in vertical:
            intersection = {"x": v_wall["a"]["x"], "y": h_wall["a"]["y"]}
            for endpoint in ("a", "b"):
                if (
                    abs(h_wall[endpoint]["x"] - intersection["x"]) <= snap_tolerance
                    and abs(h_wall[endpoint]["y"] - intersection["y"]) <= snap_tolerance
                ):
                    h_wall[endpoint]["x"] = intersection["x"]
                if (
                    abs(v_wall[endpoint]["x"] - intersection["x"]) <= snap_tolerance
                    and abs(v_wall[endpoint]["y"] - intersection["y"]) <= snap_tolerance
                ):
                    v_wall[endpoint]["y"] = intersection["y"]
    for wall in draft_walls:
        geometry = wall_geometry[wall["id"]]
        along = "x" if geometry["orient"] == "h" else "y"
        geometry["start"] = min(wall["a"][along], wall["b"][along])
        geometry["end"] = max(wall["a"][along], wall["b"][along])

    used_gaps = set()
    for opening in recognition["openings"]:
        gap_key = (opening["analysisId"], opening["index"])
        if gap_key in used_gaps:
            raise TaskError(
                "OPENING_OWNER_UNRESOLVED",
                "同一个门窗断口被重复使用",
                details={"objectIds": [opening["id"]]},
            )
        used_gaps.add(gap_key)
        gap = _gap_piece(skeleton, opening["analysisId"], opening["index"])
        candidate_id = gap.get("candidateWallId")
        owner = candidate_owner.get(candidate_id) if candidate_id else None
        if owner is None:
            raise TaskError(
                "OPENING_OWNER_UNRESOLVED",
                f"门窗 {opening['id']} 的断口两侧候选墙未被同一业务墙选中",
                details={"objectIds": [opening["id"]]},
            )
        wall = wall_geometry[owner]
        if gap["orient"] != wall["orient"]:
            raise TaskError(
                "OPENING_OWNER_UNRESOLVED",
                f"门窗 {opening['id']} 与所属墙方向不一致",
                details={"objectIds": [opening["id"]]},
            )
        if abs(float(gap["line"]) - wall["line"]) > 3:
            raise TaskError(
                "OPENING_OWNER_UNRESOLVED",
                f"门窗 {opening['id']} 不在所属墙中线上",
                details={"objectIds": [opening["id"]]},
            )
        start = min(float(gap["s0"]), float(gap["s1"]))
        end = max(float(gap["s0"]), float(gap["s1"]))
        if start < wall["start"] - 2 or end > wall["end"] + 2:
            raise TaskError(
                "OPENING_OUT_OF_RANGE",
                f"门窗 {opening['id']} 超出所属墙范围",
                details={"objectIds": [opening["id"], owner]},
            )
        draft_openings.append(
            {
                "id": opening["id"],
                "wallId": owner,
                "type": opening["type"],
                "offset": (start + end) / 2 - wall["start"],
                "width": end - start,
                **{
                    key: opening[key]
                    for key in ("sill", "head", "side", "hinge")
                    if opening.get(key) is not None
                },
            }
        )

    room_ids = {room["id"] for room in recognition["rooms"]}
    if any(room_id not in room_ids for room_id in recognition["targetRoomIds"]):
        raise TaskError(
            "TARGET_ROOM_MISSING",
            "目标客餐厅引用了未知房间",
            details={"objectIds": recognition["targetRoomIds"]},
        )

    return {
        "status": "draft",
        "question": recognition.get("question", ""),
        "recognitionVersion": 3,
        "measurementVersion": 2,
        "name": recognition["name"],
        **{
            key: recognition[key]
            for key in ("height", "wallThickness")
            if recognition.get(key) is not None
        },
        "anchors": recognition["anchors"],
        "walls": draft_walls,
        "openings": draft_openings,
        "rooms": recognition["rooms"],
        "symbols": [],
        "targetRoomIds": recognition["targetRoomIds"],
        "uncertainties": recognition["uncertainties"],
        "features": [],
        "dimensions": [],
    }


class FloorplanV3(FloorplanV2):
    async def ensure_analysis(self, task, image):
        tools = FloorplanToolset(self.base, task, image, "main")
        record = await tools.request(
            "analyze",
            {"grayMax": 175, "satMax": 80, "outlined": False},
        )
        if record.get("error"):
            raise TaskError(
                record["error"],
                record.get("message") or "户型墙线分析失败",
                422,
            )
        await tools.result("analyze_floorplan", record, pictures=False)
        skeleton = build_structure_skeleton(record, image)
        self.patch(task["id"], structureSkeleton=skeleton)
        return tools, record, skeleton

    async def recognize_structure(self, task, image, skeleton):
        evidence, context = await self.context(task, image, "main")
        analysis = next(
            entry["record"]
            for entry in reversed(
                self.store.task(task["id"], internal=True)["generation"].get("upstreamTools", [])
            )
            if entry["tool"] == "analyze_floorplan"
            and entry["record"]["id"] == skeleton["analysisId"]
        )
        images = [await self.client.image(f"/floorplan-images/{image['id']}/file")]
        images += [await self.client.image(file["path"]) for file in analysis.get("files", [])]

        async def invoke(prompt, payload):
            result = await self.base.invoke(
                "main",
                prompt,
                StructureRecognition,
                [context, evidence.crop_tool()],
                payload,
                task["id"],
                images,
                prompt_version=VERSION,
                bounded_schema=True,
                model_options=FLOORPLAN_RECOGNITION_OPTIONS,
            )
            return StructureRecognition.model_validate(result).model_dump(
                exclude_none=True, by_alias=True
            )

        payload = {
            "userRequest": task["input"],
            "image": image,
            "structureSkeleton": skeleton,
            "skill": self.store.task(task["id"], internal=True)["generation"]["skillSnapshot"],
        }
        generation = self.store.task(task["id"], internal=True)["generation"]
        repaired_value = generation.get("structureRepairResponse")
        pending_value = generation.get("pendingStructure")
        resuming_repair = bool(pending_value and generation.get("structureRepairAttempts", 0))
        value = repaired_value if repaired_value else pending_value if resuming_repair else None
        if value is None:
            value = await invoke(STRUCTURE, payload)
            value = StructureRecognition.model_validate(value).model_dump(
                exclude_none=True, by_alias=True
            )
            attempts = generation.setdefault("structureAttempts", [])
            attempts.append(value)
            self.patch(task["id"], structureAttempts=attempts, pendingStructure=value)
        else:
            value = StructureRecognition.model_validate(value).model_dump(
                exclude_none=True, by_alias=True
            )
        if value["status"] == "unsupported":
            self.patch(
                task["id"],
                rawStructure=value,
                structure=value,
                pendingStructure=None,
                structureRepairResponse=None,
            )
            return value
        try:
            assembled = _assemble_structure(skeleton, value, generation.get("evidenceIndex", {}))
        except TaskError as error:
            allowed = {
                "UNKNOWN_WALL_GROUP",
                "MIXED_WALL_ORIENTATION",
                "OPENING_OWNER_UNRESOLVED",
                "OPENING_OUT_OF_RANGE",
                "INVALID_WALL_GEOMETRY",
                "TARGET_ROOM_MISSING",
                "INVALID_DIMENSION_REFERENCE",
            }
            object_ids = (getattr(error, "details", None) or {}).get("objectIds", [])
            generation = self.store.task(task["id"], internal=True)["generation"]
            if error.code not in allowed or repaired_value:
                history = generation.setdefault("structureErrors", [])
                history.append(
                    {
                        "code": error.code,
                        "message": str(error),
                        "objectIds": object_ids,
                        "skeletonVersion": skeleton["structureSkeletonVersion"],
                    }
                )
                self.patch(
                    task["id"],
                    structureErrors=history,
                    pendingStructure=None,
                )
                raise
            errors = [
                *generation.get("structureErrors", []),
                {
                    "code": error.code,
                    "message": str(error),
                    "objectIds": object_ids,
                    "skeletonVersion": skeleton["structureSkeletonVersion"],
                },
            ]
            self.patch(
                task["id"],
                structureRepairAttempts=1,
                pendingStructure=value,
                structureErrors=errors,
            )
            self.store.event(
                task["id"],
                "structure_repair",
                {
                    "attempt": 1,
                    "code": error.code,
                    "message": str(error),
                },
            )
            repaired = await invoke(
                STRUCTURE_REPAIR,
                {
                    **payload,
                    "previousResult": value,
                    "errorCode": error.code,
                    "message": str(error),
                    "objectIds": object_ids,
                    "allowedCandidateWallIds": [
                        wall["candidateWallId"] for wall in skeleton.get("candidateWalls", [])
                    ],
                    "allowedOpeningCandidateIds": [
                        opening["candidateId"] for opening in skeleton.get("openingCandidates", [])
                    ],
                    "allowedDimensionCandidateIds": [
                        candidate["candidateId"]
                        for candidate in skeleton.get("dimensionCandidates", [])
                    ],
                },
            )
            current_generation = self.store.task(task["id"], internal=True)["generation"]
            attempts = current_generation["structureAttempts"]
            attempts.append(repaired)
            self.patch(
                task["id"],
                structureAttempts=attempts,
                pendingStructure=repaired,
                structureRepairResponse=repaired,
            )
            if repaired["status"] == "unsupported":
                self.patch(
                    task["id"],
                    rawStructure=repaired,
                    structure=repaired,
                    pendingStructure=None,
                    structureRepairResponse=None,
                )
                return repaired
            try:
                assembled = _assemble_structure(
                    skeleton,
                    repaired,
                    self.store.task(task["id"], internal=True)["generation"].get(
                        "evidenceIndex", {}
                    ),
                )
                value = repaired
            except TaskError as repaired_error:
                history = self.store.task(task["id"], internal=True)["generation"][
                    "structureErrors"
                ]
                history.append(
                    {
                        "code": repaired_error.code,
                        "message": str(repaired_error),
                        "objectIds": (getattr(repaired_error, "details", None) or {}).get(
                            "objectIds", []
                        ),
                        "skeletonVersion": skeleton["structureSkeletonVersion"],
                    }
                )
                self.patch(
                    task["id"],
                    structureErrors=history,
                    pendingStructure=None,
                    structureRepairResponse=None,
                )
                raise
        assembled = RecognitionV3.model_validate(assembled).model_dump(
            exclude_none=True, by_alias=True
        )
        self.patch(
            task["id"],
            rawStructure=value,
            structure=assembled,
            pendingStructure=None,
            structureRepairResponse=None,
            phase="recognizing_furniture",
        )
        self.store.event(
            task["id"],
            "structure_pass",
            {
                "walls": len(assembled["walls"]),
                "openings": len(assembled["openings"]),
                "rooms": len(assembled["rooms"]),
                "targetRoomIds": assembled["targetRoomIds"],
            },
        )
        return assembled

    async def recognize_furniture(self, task, image, draft, diagnostics):
        generation = self.store.task(task["id"], internal=True)["generation"]
        if generation.get("floorplanVersion") == "s2c-floorplan-v3-3":
            return await self.recognize_furniture_contours(task, image, draft, diagnostics)
        evidence, context = await self.context(task, image, "main")
        analysis = next(
            (
                entry["record"]
                for entry in reversed(
                    self.store.task(task["id"], internal=True)["generation"].get(
                        "upstreamTools", []
                    )
                )
                if entry["tool"] == "analyze_floorplan"
            ),
            None,
        )
        images = [await self.client.image(f"/floorplan-images/{image['id']}/file")]
        if analysis:
            images += [await self.client.image(file["path"]) for file in analysis.get("files", [])]
        images += [await self.client.image(file["path"]) for file in diagnostics.get("files", [])]
        value = await self.base.invoke(
            "main",
            FURNITURE,
            FurnitureRecognition,
            [context, evidence.crop_tool()],
            {
                "userRequest": task["input"],
                "image": image,
                "structure": draft["data"],
                "diagnostics": diagnostics,
                "skill": self.store.task(task["id"], internal=True)["generation"]["skillSnapshot"],
            },
            task["id"],
            images,
            prompt_version=VERSION,
            bounded_schema=True,
            model_options=FLOORPLAN_RECOGNITION_OPTIONS,
        )
        value = FurnitureRecognition.model_validate(value).model_dump(
            exclude_none=True, by_alias=True
        )
        if value["status"] == "unsupported":
            raise TaskError(
                "FURNITURE_UNSUPPORTED",
                value.get("question") or "无法识别目标客餐厅家具",
            )
        if not value["symbols"]:
            raise TaskError("FURNITURE_MISSING", "目标客餐厅没有识别到家具")
        targets = set(draft["data"]["targetRoomIds"])
        seen = set()
        symbols = []
        for symbol in value["symbols"]:
            if symbol["roomId"] not in targets:
                raise TaskError("INVALID_FURNITURE", "家具符号不属于目标客餐厅")
            if symbol["id"] in seen:
                raise TaskError("INVALID_FURNITURE", "家具符号身份重复")
            seen.add(symbol["id"])
            symbols.append(
                {
                    **symbol,
                    "category": symbol["categoryCode"],
                    "included": True,
                }
            )
        self.patch(
            task["id"],
            furniturePass=value,
            pendingFurniture={"symbols": symbols},
            phase="recognizing_furniture",
        )
        return symbols

    async def recognize_furniture_contours(self, task, image, draft, diagnostics):
        tools = FloorplanToolset(self.base, task, image, "main")
        record = await tools.request("contours", {"spec": draft["data"]})
        if record.get("error"):
            raise TaskError(
                record["error"],
                record.get("message") or "家具轮廓候选生成失败",
                422,
            )
        candidates = record.get("contourCandidates") or []
        if not candidates:
            raise TaskError("FURNITURE_MISSING", "目标客餐厅没有家具轮廓候选")
        await tools.result("furniture_contours", record, pictures=False)
        container = {candidate["candidateId"]: candidate for candidate in candidates}
        evidence, context = await self.context(task, image, "main")
        images = [await self.client.image(f"/floorplan-images/{image['id']}/file")]
        images += await evidence.images()
        images += [await self.client.image(file["path"]) for file in record.get("files", [])]
        images += [await self.client.image(file["path"]) for file in diagnostics.get("files", [])]
        value = await self.base.invoke(
            "main",
            FURNITURE_CONTOURS,
            FurnitureContourRecognition,
            [context, evidence.crop_tool()],
            {
                "userRequest": task["input"],
                "image": image,
                "structure": draft["data"],
                "diagnostics": diagnostics,
                "contourCandidates": candidates,
                "targetRegions": record.get("targetRegions") or {},
                "skill": self.store.task(task["id"], internal=True)["generation"]["skillSnapshot"],
            },
            task["id"],
            images,
            prompt_version=VERSION,
            bounded_schema=True,
            model_options=FLOORPLAN_RECOGNITION_OPTIONS,
        )
        value = FurnitureContourRecognition.model_validate(value).model_dump(
            exclude_none=True, by_alias=True
        )
        if value["status"] == "unsupported":
            raise TaskError(
                "FURNITURE_UNSUPPORTED",
                value.get("question") or "无法识别目标客餐厅家具",
            )
        if not value["symbols"]:
            raise TaskError("FURNITURE_MISSING", "目标客餐厅没有识别到家具")
        targets = set(draft["data"]["targetRoomIds"])
        seen_ids = set()
        used_contours = set()
        symbols = []
        for symbol in value["symbols"]:
            if symbol["roomId"] not in targets:
                raise TaskError("INVALID_FURNITURE", "家具符号不属于目标客餐厅")
            if symbol["id"] in seen_ids:
                raise TaskError("INVALID_FURNITURE", "家具符号身份重复")
            seen_ids.add(symbol["id"])
            selected = []
            for candidate_id in symbol["contourCandidateIds"]:
                candidate = container.get(candidate_id)
                if candidate is None:
                    raise TaskError(
                        "INVALID_FURNITURE",
                        f"家具 {symbol['id']} 引用了未知轮廓 {candidate_id}",
                    )
                if candidate_id in used_contours:
                    raise TaskError(
                        "INVALID_FURNITURE",
                        f"轮廓 {candidate_id} 被多个家具重复使用",
                    )
                used_contours.add(candidate_id)
                selected.append(candidate)
            x0 = min(item["bbox"][0] for item in selected)
            y0 = min(item["bbox"][1] for item in selected)
            x1 = max(item["bbox"][0] + item["bbox"][2] for item in selected)
            y1 = max(item["bbox"][1] + item["bbox"][3] for item in selected)
            if symbol["categoryCode"] == "chair" and y1 - y0 < 18 <= x1 - x0:
                pad = (18 - (y1 - y0)) / 2
                y0 -= pad
                y1 += pad
            if x1 - x0 < 3 or y1 - y0 < 3:
                raise TaskError(
                    "INVALID_FURNITURE",
                    f"家具 {symbol['id']} 的轮廓组合无效",
                )
            symbols.append(
                {
                    **{
                        key: symbol[key]
                        for key in (
                            "id",
                            "roomId",
                            "categoryCode",
                            "sourceLabel",
                            "functionalArea",
                        )
                        if symbol.get(key) is not None
                    },
                    "category": symbol["categoryCode"],
                    "included": True,
                    "evidenceRefs": [record["id"]],
                    "x": round((x0 + x1) / 2, 3),
                    "y": round((y0 + y1) / 2, 3),
                    "w": round(x1 - x0, 3),
                    "d": round(y1 - y0, 3),
                    "rot": symbol["rot"],
                }
            )
        self.patch(
            task["id"],
            furniturePass=value,
            pendingFurniture={"symbols": symbols},
            furnitureContours={
                "recordId": record["id"],
                "candidateCount": len(candidates),
                "targetRegions": record.get("targetRegions") or {},
            },
            phase="recognizing_furniture",
        )
        return symbols

    async def measure(self, task, image, draft, diagnostics, report):
        evidence, context = await self.context(task, image, "design")
        tools = FloorplanToolset(self.base, task, image, "design")
        generation = self.store.task(task["id"], internal=True)["generation"]
        raw_structure = generation.get("rawStructure") or {}
        candidate_by_id = {
            candidate["candidateWallId"]: candidate
            for candidate in generation.get("structureSkeleton", {}).get("candidateWalls", [])
        }
        wall_candidates = []
        for wall in raw_structure.get("walls", []):
            indices = []
            for candidate_id in wall.get("candidateWallIds", []):
                candidate = candidate_by_id.get(candidate_id)
                if candidate:
                    indices.extend(candidate.get("indices") or candidate.get("sourceIndices") or [])
            if indices:
                wall_candidates.append(
                    {
                        "id": wall["id"],
                        "analysisId": generation["structureSkeleton"]["analysisId"],
                        "index": min(indices),
                    }
                )
        precomputed_walls = []
        if wall_candidates:
            wall_record = await tools.request("fit-bound", {"walls": wall_candidates})
            await tools.result("fit_wall_candidates", wall_record, pictures=False)
            precomputed_walls.append(
                {
                    "recordId": wall_record.get("id"),
                    "result": wall_record.get("result", []),
                    **({"error": wall_record["error"]} if wall_record.get("error") else {}),
                }
            )
        precomputed_dimensions = []
        for index, anchor in enumerate(draft["data"].get("anchors", [])):
            dx = abs(anchor["a"]["x"] - anchor["b"]["x"])
            dy = abs(anchor["a"]["y"] - anchor["b"]["y"])
            if min(dx, dy) > 1:
                continue
            coordinate = "x" if dx >= dy else "y"
            ticks = sorted([anchor["a"][coordinate], anchor["b"][coordinate]])
            unit = anchor["distance"]["unit"]
            millimetres = (
                anchor["distance"]["value"]
                * {
                    "mm": 1,
                    "cm": 10,
                    "m": 1000,
                }[unit]
            )
            record = await tools.request(
                "axis",
                {
                    "ticks": ticks,
                    "distances": [millimetres],
                    "basis": anchor["basis"],
                    "evidence": anchor["evidence"],
                },
            )
            await tools.result("measure_dimension_chain", record, pictures=False)
            precomputed_dimensions.append(
                {
                    "anchorIndex": index,
                    "recordId": record.get("id"),
                    "result": record.get("result", []),
                    **({"error": record["error"]} if record.get("error") else {}),
                }
            )

        @tool
        async def fit_wall_candidates(walls: list[dict]) -> list[dict]:
            """Measure bound wall candidates; use analysis ids and zero-based segment indexes."""
            record = await tools.request("fit-bound", {"walls": walls})
            return await tools.result("fit_wall_candidates", record)

        axis = next(t for t in tools.measurement() if t.name == "measure_dimension_chain")
        images = [
            await self.client.image(f"/floorplan-images/{image['id']}/file"),
            *await evidence.images(),
        ]
        images += [await self.client.image(f["path"]) for f in diagnostics.get("files", [])]
        value = await self.base.invoke(
            "design",
            MEASURE,
            MeasuredDraftUpdate,
            [context, evidence.crop_tool(), fit_wall_candidates, axis],
            {
                "userRequest": task["input"],
                "draft": draft,
                "report": report,
                "diagnostics": diagnostics,
                "precomputedWallMeasurements": precomputed_walls,
                "precomputedDimensionMeasurements": precomputed_dimensions,
                "sharedEvidence": await evidence.context(),
                "skill": self.store.task(task["id"], internal=True)["generation"]["skillSnapshot"],
            },
            task["id"],
            images,
            prompt_version=VERSION,
            bounded_schema=True,
            model_options=FLOORPLAN_RECOGNITION_OPTIONS,
        )
        return MeasuredDraftUpdate.model_validate(value).model_dump(
            exclude_none=True, by_alias=True
        )

    async def review(self, task, image, draft, diagnostics, phase):
        evidence, context = await self.context(task, image, "check")
        images = [
            await self.client.image(f"/floorplan-images/{image['id']}/file"),
            *await evidence.images(),
        ]
        images += [await self.client.image(f["path"]) for f in diagnostics.get("files", [])]
        self.store.event(
            task["id"],
            "draft_source_evidence",
            {
                "draftHash": draft["hash"],
                "phase": phase,
                "imageHashes": [hashlib.sha256(i).hexdigest() for i in images],
            },
        )
        model_review = await self.base.invoke(
            "check",
            CHECK,
            FloorplanReview,
            [context, evidence.crop_tool()],
            {
                "userRequest": task["input"],
                "draft": draft,
                "diagnostics": diagnostics,
                "phase": phase,
                "sharedEvidence": await evidence.context(),
            },
            task["id"],
            images,
            prompt_version=VERSION,
            bounded_schema=True,
            model_options=FLOORPLAN_REVIEW_OPTIONS,
        )
        model_review = FloorplanReview.model_validate(model_review).model_dump()
        skeleton = (
            self.store.task(task["id"], internal=True)["generation"].get("structureSkeleton") or {}
        )
        review = _arbitrate_review(model_review, draft, diagnostics, skeleton)
        self.store.event(
            task["id"],
            "review_arbitration",
            {
                "draftHash": draft["hash"],
                "phase": phase,
                "modelPassed": model_review["passed"],
                "finalPassed": review["passed"],
                "codeBlocking": sum(
                    item.get("source") == "code" and item.get("severity") == "blocking"
                    for item in review["issues"]
                ),
                "advisory": sum(item.get("severity") == "advisory" for item in review["issues"]),
            },
        )
        return review

    async def ground(self, state, task, legacy):
        project = state["project"]
        task_id = task["id"]
        generation = self.store.task(task_id, internal=True)["generation"]
        root = f"/projects/{task['projectId']}/floorplan-drafts"
        if generation.get("draftId"):
            draft = await self.client.request(root + "/" + generation["draftId"])
            if draft.get("confirmed"):
                if draft.get("sourceReview", {}).get("hash") != draft["hash"]:
                    raise TaskError("SOURCE_REVIEW_REQUIRED", "确认前审核已失效")
                return await legacy(state, self.store.task(task_id, internal=True))
        if any(
            project["plan"].get(key)
            for key in (
                "walls",
                "nodes",
                "furniture",
                "rooms",
                "openings",
                "structs",
                "beams",
                "voids",
                "elec",
                "measures",
                "comments",
            )
        ) or project.get("roomLabelArchive"):
            raise TaskError("PROJECT_NOT_EMPTY", "初始化项目已非空，未覆盖场景", 409)
        image = await self.client.request("/floorplan-images/" + generation["imageId"])
        if not generation.get("skillSnapshot"):
            snapshot = load_design_skill(FLOORPLAN_TOOLS, skill_id="floorplan-reconstruction")
            self.patch(
                task_id,
                skillSnapshot=snapshot,
                skillsUsed=[skill_record(snapshot)],
            )
            self.store.event(task_id, "skill_loaded", skill_record(snapshot))

        if not generation.get("draftId"):
            structure = generation.get("structure")
            if not structure:
                _tools, _record, skeleton = await self.ensure_analysis(task, image)
                structure = generation.get("rawStructure") or await self.recognize_structure(
                    task, image, skeleton
                )
                if structure["status"] == "unsupported":
                    return {
                        "route": "end",
                        "final": {
                            "status": "failed",
                            "message": structure.get("question") or "图片超出单层正交平面图范围",
                        },
                    }
                self.patch(task_id, structure=structure)
            data = {
                key: value for key, value in structure.items() if key not in ("status", "question")
            }
            data["image"] = {key: image[key] for key in ("id", "sha256", "width", "height")}
            draft = await self.client.request(
                root,
                {
                    "requestId": task_id + ":v3:structure",
                    "imageId": image["id"],
                    "baseRevision": project["revision"],
                    "data": data,
                },
            )
            self.patch(
                task_id,
                draftId=draft["id"],
                floorplan=draft,
                sourceInputHash=fingerprint(task["input"]),
            )

        diagnostics = await self.client.request(root + "/" + draft["id"] + "/diagnostics", {})
        if not draft["data"].get("symbols"):
            generation = self.store.task(task_id, internal=True)["generation"]
            pending_furniture = generation.get("pendingFurniture")
            symbols = (
                [
                    {
                        **symbol,
                        "category": symbol["categoryCode"],
                        "included": True,
                    }
                    for symbol in pending_furniture["symbols"]
                ]
                if pending_furniture
                else await self.recognize_furniture(task, image, draft, diagnostics)
            )
            draft = await self.client.request(
                root + "/" + draft["id"] + "/measurement-updates",
                {
                    "requestId": task_id + ":v3:furniture:" + draft["hash"],
                    "draftRevision": draft["revision"],
                    "draftHash": draft["hash"],
                    "commands": [
                        {"type": "upsert", "collection": "symbols", "object": symbol}
                        for symbol in symbols
                    ],
                    "changeReasons": [],
                    "evidenceRefs": ["image:" + image["sha256"]],
                },
            )
            diagnostics = await self.client.request(root + "/" + draft["id"] + "/diagnostics", {})
            self.patch(task_id, pendingFurniture=None)
        recognized = {
            **draft["data"],
            "status": "draft",
            "question": "",
        }
        self.patch(task_id, rawRecognition=recognized, floorplan=draft)
        await FloorplanToolset(self.base, task, image, "system").result(
            "draft_diagnostics", diagnostics, pictures=False
        )
        generation = self.store.task(task_id, internal=True)["generation"]
        if not generation.get("initialReview"):
            initial = await self.review(task, image, draft, diagnostics, "initial")
            self.patch(
                task_id,
                initialReview={"draftHash": draft["hash"], "review": initial},
            )
        report = {
            "checks": diagnostics["checks"],
            "sourceReview": self.store.task(task_id, internal=True)["generation"]["initialReview"][
                "review"
            ],
        }

        while True:
            generation = self.store.task(task_id, internal=True)["generation"]
            attempt = generation.get("measurementAttempts", 0)
            if generation.get("measurementComplete"):
                break
            pending = generation.get("pendingMeasurement")
            if not pending and (
                attempt >= 4 or (attempt > 0 and generation.get("repairsUsed", 0) >= 3)
            ):
                break
            if not pending:
                self.patch(
                    task_id,
                    measurementAttempts=attempt + 1,
                    repairsUsed=generation.get("repairsUsed", 0) + (1 if attempt else 0),
                    phase="measuring_floorplan",
                )
                pending = await self.measure(task, image, draft, diagnostics, report)
                self.patch(task_id, pendingMeasurement=pending)
            action_id = task_id + ":v3:update:" + fingerprint(pending)[:32]
            body = {
                "requestId": action_id,
                "draftRevision": pending["baseDraftRevision"],
                "draftHash": pending["baseDraftHash"],
                "commands": pending["commands"],
                "changeReasons": pending["changeReasons"],
                "evidenceRefs": pending["evidenceRefs"],
            }
            try:
                draft = await self.client.request(
                    root + "/" + draft["id"] + "/measurement-updates", body
                )
                diagnostics = await self.client.request(
                    root + "/" + draft["id"] + "/diagnostics", {}
                )
                review = None
                if diagnostics["checks"]["passed"]:
                    review = await self.review(task, image, draft, diagnostics, "preconfirmation")
                    draft = await self.client.request(
                        root + "/" + draft["id"] + "/review",
                        {
                            "requestId": task_id + ":v3:review:" + draft["hash"],
                            "draftRevision": draft["revision"],
                            "draftHash": draft["hash"],
                            "review": review,
                            "evidenceRefs": [diagnostics["id"]],
                        },
                    )
                report = {"checks": diagnostics["checks"], "sourceReview": review}
                complete = (
                    diagnostics["checks"]["passed"] and review is not None and review["passed"]
                )

                def save(
                    current,
                    current_draft=draft,
                    current_diagnostics=diagnostics,
                    current_complete=complete,
                    current_pending=pending,
                    current_report=report,
                ):
                    current.update(
                        floorplan=current_draft,
                        diagnostics=current_diagnostics,
                        previewChecks=current_diagnostics["checks"],
                        measurementComplete=current_complete,
                        pendingMeasurement=None,
                        phase="reviewing_floorplan",
                    )
                    current.setdefault("recognitionAttempts", []).append(
                        {
                            "role": "design",
                            "response": current_pending,
                            "draftHash": current_draft["hash"],
                            "report": current_report,
                        }
                    )

                self.store.mutate_generation(task_id, save)
                if complete:
                    break
            except SceneFailure as error:
                report = {
                    "error": error.code,
                    "message": str(error),
                    "details": error.data.get("details"),
                }
                self.patch(
                    task_id,
                    pendingMeasurement=None,
                    lastMeasurementError=report,
                )
                if error.code in (
                    "DRAFT_CONFLICT",
                    "PROJECT_NOT_EMPTY",
                    "REVISION_CONFLICT",
                ):
                    break

        generation = self.store.task(task_id, internal=True)["generation"]
        self.patch(
            task_id,
            floorplan=draft,
            diagnostics=diagnostics,
            phase="reviewing_floorplan",
        )
        return {
            "route": "end",
            "final": {
                "status": "waiting_input",
                "phase": "reviewing_floorplan",
                "draftId": draft["id"],
                "report": report,
                "message": "两阶段识别、测量与独立审核通过，请确认结构与布局。"
                if generation.get("measurementComplete")
                else "两阶段识别后仍有阻断问题，正式项目未改变。请查看原图证据及检查结果。",
            },
        }
