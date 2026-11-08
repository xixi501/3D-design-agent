"""Bounded two-pass floorplan recognition with deterministic draft assembly."""

import hashlib
import statistics

from langchain_core.tools import tool

from .client import SceneFailure
from .config import FLOORPLAN_RECOGNITION_OPTIONS, FLOORPLAN_REVIEW_OPTIONS
from .floorplan_roles import PIXEL_RULES, RULES
from .floorplan_schemas import (
    FloorplanReview,
    FurnitureRecognition,
    MeasuredDraftUpdate,
    RecognitionV3,
    StructureRecognition,
)
from .floorplan_tools import FloorplanToolset
from .floorplan_v2 import FloorplanV2
from .skill_registry import FLOORPLAN_TOOLS, load_design_skill, skill_record
from .store import TaskError, fingerprint

VERSION = "s2c-floorplan-v3-1"
COMMON = (
    RULES
    + PIXEL_RULES.replace("餐椅四把就是四个符号", "每把餐椅都要单独记录")
    + """\n本任务使用受控两阶段识别。固定代码已经取得墙段、断口和尺寸刻度候选；模型只判断候选语义，不自由生成整张草稿。
只返回指定结构化结果，不输出 chain-of-thought 或解释性正文。所有坐标使用原图像素。不得索要或猜测评估参考。
结构阶段只处理墙、门窗、房间、尺寸锚点和阻断不确定项；家具阶段只清点已选客餐厅。"""
)
STRUCTURE = (
    COMMON
    + """\n你是结构识别角色。输入包含 StructureSkeleton、编号分析图、墙掩膜和原图。
walls 中每项 business wall 必须通过 segments=[{analysisId,index}] 或 customSegments 引用真实候选；代码会取同一直线上所有段的并集形成墙端点。
不要把外侧尺寸线、家具边或同一墙的另一侧描边当墙。连接墙需在房间闭合处共享端点。分析图漏墙时才允许引用实际裁剪生成 customSegments；没有裁剪证据的坐标会被拒绝。
openings 必须引用 StructureSkeleton.gaps 中的真实断口，wallId 指向本次 walls.id，type 只写图上门窗类型；同一断口不能重复使用。
rooms 使用房间名所在原图点，每个封闭区域一个标签；functionalArea 写 living/dining/kitchen/bedroom/bathroom/other。targetRoomIds 只选需要复现家具的客餐厅。
anchors 只抄录清晰尺寸标注或用户明确长度；basis 区分 interior/centerline/exterior。未知 height/wallThickness 留 null。无法确认的关键结构写入 uncertainties(blocking=true)。
证据引用使用 analysisId、cropId 或 image:<sha256>。status=unsupported 仅用于非单层正交清晰平面图。"""
)
FURNITURE = (
    COMMON
    + """\n你是家具清点角色。结构草稿、分析叠图、诊断图与目标客餐厅已经确定。只输出 symbols，不修改墙、门窗、房间、锚点或不确定项。
按固定顺序逐区扫描：北墙、东墙、南墙、西墙，四角，每个门窗附近，然后 3×3 网格。每件可见目标家具单独记录，不得把一组餐椅写成一个符号，也不得添加图中没有的家具。
categoryCode 只能使用给定枚举；sourceLabel 保存原图中的中文或英文名称，不能把位置、朝向或解释写进 categoryCode。每个符号必须属于 targetRoomIds，included=true，evidenceRefs 引用原图、编号分析图或诊断文件。
开放厨房、卧室和卫生间只保留结构；它们内部家具不得进入 symbols。w/d 是旋转前原图像素占地，不是毫米或目录默认尺寸。"""
)
MEASURE = (
    COMMON
    + """\n你是空间设计的测量阶段。输入是两阶段合并后的当前草稿、共享证据和原图叠加。仅返回 MeasuredDraftUpdate，commands 只修改指定对象和字段。
baseDraftRevision/Hash 必须原样使用。修改已有对象须在 changeReasons 中以 collection/id 附原图依据及 evidenceRefs；已有说明累计保留。
先测墙面：fit_wall_candidates 使用分析 id 和 segments_px 的0起始 index，为每次取样填写业务墙 id。结果 n=0 或偏离正确候选不能作为成功证据。
features/dimensions 必须引用真实测量和清晰尺寸标注；尺寸为 from->to 正距离，毫米几何由代码解算。不得为通过预检改数字、伪造连接或删除冲突标注。
不需要调用终止预检工具；代码在本次结构化结果后执行预检并返回问题。"""
)
CHECK = (
    COMMON
    + """\n你是独立检查角色。只核对当前哈希草稿，不执行修改。检查原图、结构叠加、毫米几何回投和家具清单。
逐项核对墙体、门窗、房间、目标家具类别/数量/位置/朝向和尺寸证据。必须使用真实草稿对象 id，不能仅凭启发式工具零问题通过。
issues 只能使用固定 code；description 写一条可定位的具体问题，不写推理过程。passed=true 只有在关键结构和目标家具全部可验证且 issues=[] 时成立。
无法验证关键项、图片缺失或代码检查未通过时必须 passed=false。"""
)


def _candidate_id(index, prefix):
    return f"{prefix}{index}"


def build_structure_skeleton(record, image):
    result = record.get("result") or {}
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
    gaps = []
    for index, gap in enumerate(result.get("gaps_px") or []):
        gaps.append(
            {
                "candidateId": _candidate_id(index, "g"),
                "analysisId": record["id"],
                "index": index,
                **gap,
            }
        )
    return {
        "analysisId": record["id"],
        "image": {k: image[k] for k in ("id", "sha256", "width", "height")},
        "outline_px": result.get("outline_px"),
        "segments": segments,
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


def _assemble_structure(skeleton, recognition, evidence_index):
    if recognition["status"] == "unsupported":
        return recognition

    wall_geometry = {}
    draft_walls = []
    for wall in recognition["walls"]:
        pieces = [
            _segment_piece(skeleton, segment["analysisId"], segment["index"])
            for segment in wall.get("segments", [])
        ]
        for custom in wall.get("customSegments", []):
            if custom["cropId"] not in evidence_index:
                raise TaskError("INVALID_STRUCTURE", f"新增墙段 {wall['id']} 缺少有效裁剪证据")
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
            raise TaskError("INVALID_STRUCTURE", f"墙 {wall['id']} 没有真实候选")
        orientations = {piece["orient"] for piece in pieces}
        if len(orientations) != 1:
            raise TaskError("INVALID_STRUCTURE", f"墙 {wall['id']} 混合了水平和竖直候选")
        lines = [float(piece["line"]) for piece in pieces]
        if max(lines) - min(lines) > 3:
            raise TaskError("INVALID_STRUCTURE", f"墙 {wall['id']} 的候选不在同一直线上")
        start = min(float(piece["s0"]) for piece in pieces)
        end = max(float(piece["s1"]) for piece in pieces)
        if end - start < 2:
            raise TaskError("INVALID_STRUCTURE", f"墙 {wall['id']} 长度无效")
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
        wall = wall_geometry.get(opening["wallId"])
        if wall is None:
            raise TaskError("INVALID_STRUCTURE", f"门窗 {opening['id']} 引用了未知墙")
        gap_key = (opening["analysisId"], opening["index"])
        if gap_key in used_gaps:
            raise TaskError("INVALID_STRUCTURE", "同一个门窗断口被重复使用")
        used_gaps.add(gap_key)
        gap = _gap_piece(skeleton, opening["analysisId"], opening["index"])
        if gap["orient"] != wall["orient"]:
            raise TaskError("INVALID_STRUCTURE", f"门窗 {opening['id']} 与所属墙方向不一致")
        if abs(float(gap["line"]) - wall["line"]) > 3:
            raise TaskError("INVALID_STRUCTURE", f"门窗 {opening['id']} 不在所属墙中线上")
        start = min(float(gap["s0"]), float(gap["s1"]))
        end = max(float(gap["s0"]), float(gap["s1"]))
        if start < wall["start"] - 2 or end > wall["end"] + 2:
            raise TaskError("INVALID_STRUCTURE", f"门窗 {opening['id']} 超出所属墙范围")
        draft_openings.append(
            {
                "id": opening["id"],
                "wallId": opening["wallId"],
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
        raise TaskError("INVALID_STRUCTURE", "目标客餐厅引用了未知房间")

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
        value = await self.base.invoke(
            "main",
            STRUCTURE,
            StructureRecognition,
            [context, evidence.crop_tool()],
            {
                "userRequest": task["input"],
                "image": image,
                "structureSkeleton": skeleton,
                "skill": self.store.task(task["id"], internal=True)["generation"]["skillSnapshot"],
            },
            task["id"],
            images,
            prompt_version=VERSION,
            bounded_schema=True,
            model_options=FLOORPLAN_RECOGNITION_OPTIONS,
        )
        value = StructureRecognition.model_validate(value).model_dump(
            exclude_none=True, by_alias=True
        )
        generation = self.store.task(task["id"], internal=True)["generation"]
        assembled = _assemble_structure(skeleton, value, generation.get("evidenceIndex", {}))
        assembled = RecognitionV3.model_validate(assembled).model_dump(
            exclude_none=True, by_alias=True
        )
        self.patch(
            task["id"],
            rawStructure=value,
            structure=assembled,
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
            pendingFurniture=value,
            phase="recognizing_furniture",
        )
        return symbols

    async def measure(self, task, image, draft, diagnostics, report):
        evidence, context = await self.context(task, image, "design")
        tools = FloorplanToolset(self.base, task, image, "design")

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
        review = await self.base.invoke(
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
        return FloorplanReview.model_validate(review).model_dump()

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
