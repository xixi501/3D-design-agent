"""One typed output per stage. Fixed code applies deltas, diagnoses and gates confirmation."""

import hashlib

from langchain_core.tools import tool

from .client import SceneFailure
from .config import FLOORPLAN_RECOGNITION_OPTIONS
from .floorplan_evidence import FloorplanEvidence
from .floorplan_roles import PIXEL_RULES, RULES
from .floorplan_schemas import MeasuredDraftUpdate, RecognitionV2
from .floorplan_tools import FloorplanToolset
from .schemas import Review
from .skill_registry import FLOORPLAN_TOOLS, load_design_skill, skill_record
from .store import TaskError, fingerprint

VERSION = "s2c-floorplan-v2-1"
COMMON = (
    RULES
    + PIXEL_RULES.replace("餐椅四把就是四个符号", "每把餐椅都要单独记录")
    + """\n本任务使用第二版测量。保持连续完整墙，并把门窗作为所属墙的 openings，不能在门窗处将墙拆成悬空短段。图片与工具候选是证据，不是已经确认的几何。每件目标家具单独记录，数量不得采用默认值。厨房只保留结构，即使厨房与客餐厅相连也不要把厨房柜子和电器纳入目标家具；可保留符号观测，但须 functionalArea=kitchen、included=false、exclusionReason 及原图 evidenceRefs。每个目标符号以 functionalArea=living/dining 说明用途，included=true。只按图识别，不添加家具。仅使用原图及共享证据，不得索要或猜测评估参考。"""
)
RECOGNIZE = (
    COMMON
    + """\n你是主控。先调用 analyze_floorplan 并读编号图、原图与掩膜。主控最多裁剪两次，后续设计/检查共享余下两次。不得将外侧尺寸线当作墙，墙应引用分析图的真实墙候选。通过 RecognitionV2 结构化结果提交：完整像素草稿，measurementVersion=2，features/dimensions 可先留空交给测量阶段。所有可读尺寸进入 anchors；不清楚的标注记为 blocking，不猜测位置或数字。所有坐标原图像素，厚度未知用 null。证据引用使用分析工具结果的 id、裁剪 id 或 image:<原图sha256>。"""
)
MEASURE = (
    COMMON
    + """\n你是空间设计的测量阶段。输入是当前草稿、问题、共享证据及原图叠加。仅返回 MeasuredDraftUpdate，commands 为针对当前对象的字段 patch/upsert/delete/calibrate，禁止重写整张草稿。对象身份保持，不相关家具不修改。baseDraftRevision/Hash 必须原样使用。修改已有对象需在 changeReasons 中以 collection/id 附原图依据及 evidenceRefs。所有已有说明累计保留。
先测墙面：fit_wall_candidates 使用分析 id 和 segments_px 的0起始 index（不是任意坐标）；为每次取样填写该业务墙 id。工具从候选自动确定取样方向和区间。可用不同候选片段测同一连续墙。分析漏掉的墙需 cropId 和裁剪内的原图坐标。结果 n=0 或超出正确候选不能当作测量成功。把工具实测的中线与 thicknessPx 写入对应墙；连接点按同一真实中线精确对齐。不得把尺寸线当描边墙。
第二版 features 每项包含 id,objectId(业务墙或开口id),kind,axis,evidenceRefs。kind=wall_face 时 axis 为墙法向、side=min/max 分别为负向/正向墙面；wall_center 为中线；wall_end 需 endpoint=a/b；opening_edge 为开口的沿墙边缘，side=min/max。墙特征必须引用 fit_wall_candidates 的真实结果 id，且结果的墙 id、中心和厚度匹配。例如竖直西墙的室内面是 x/max；东墙室内面是 x/min。
dimensions 每项包含 id,anchorIndex(对应anchors数组索引),from/to(特征id),distance:{value,unit},basis,evidenceRefs。每个已读 anchor 都要绑定真实标注对应特征，不得删除冲突标注。尺寸为 to-from 的正距离，from 必须在轴向较小位置。毫米几何由代码解算，保留真实像素测量，不要算出理想像素去凑1mm。只有一面墙的尺寸用 opening_edge 或 wall_end 绑定真实端点。不得为通过检验改变数字、伪造证据或虚构连接。
measure_dimension_chain 仅作尺寸读数诊断：N 个刻度配 N-1 段相邻毫米值，不传累计零点；一个两点读数的 inconsistent=false 不证明其基准正确。不需要再调用预检工具，代码会在本次结构化结果后执行预检并返回问题。"""
)
CHECK = (
    COMMON
    + """\n你是独立检查。核对当前哈希草稿与原图、像素叠加、可用的毫米几何回投及裁剪；逐项核对墙、门窗、房间、家具数量/占地/朝向。工具有误检，不能用调用成功或零问题证明保真。报告真实源对象id。初审可发现待修问题；最终确认前审核必须全部关键项可验证且 issues=[] 才 passed=true。不能因为尺寸检查没过就不看家具，也不能以减少家具解决问题。不要通过创建新布局修复原图。"""
)


class FloorplanV2:
    def __init__(self, store, client, base):
        self.store, self.client, self.base = store, client, base

    def patch(self, id, **values):
        return self.store.mutate_generation(id, lambda g: g.update(values))

    async def context(self, task, image, role):
        evidence = FloorplanEvidence(self.base, task, image, role)

        @tool
        async def floorplan_context() -> dict:
            """Read original dimensions, bounded candidates and shared evidence index."""
            return await evidence.context()

        return evidence, floorplan_context

    async def recognize(self, task, image):
        evidence, context = await self.context(task, image, "main")
        tools = FloorplanToolset(self.base, task, image, "main")
        value = await self.base.invoke(
            "main",
            RECOGNIZE,
            RecognitionV2,
            [context, evidence.crop_tool(), *tools.recognition()],
            {
                "userRequest": task["input"],
                "image": image,
                "skill": self.store.task(task["id"], internal=True)["generation"]["skillSnapshot"],
            },
            task["id"],
            [await self.client.image(f"/floorplan-images/{image['id']}/file")],
            prompt_version=VERSION,
            bounded_schema=True,
            model_options=FLOORPLAN_RECOGNITION_OPTIONS,
        )
        value = RecognitionV2.model_validate(value).model_dump(exclude_none=True, by_alias=True)
        g = self.store.task(task["id"], internal=True)["generation"]
        if not any(
            r["tool"] == "analyze_floorplan" and not r["record"].get("error")
            for r in g.get("upstreamTools", [])
        ):
            raise TaskError("FLOORPLAN_TOOLS_UNUSED", "主控未取得分析证据")
        return value

    async def measure(self, task, image, draft, diagnostics, report):
        evidence, context = await self.context(task, image, "design")
        tools = FloorplanToolset(self.base, task, image, "design")

        @tool
        async def fit_wall_candidates(walls: list[dict]) -> list[dict]:
            """Measure wall candidates. Each {id:businessWallId,analysisId:actual analysis record id,index:zero-based segment index}; missed wall: {id,cropId,kind:H/V,c,p0,p1}. All pixels original. Returns bound measurement record id for features.evidenceRefs."""
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
            Review,
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
        )
        return Review.model_validate(review).model_dump()

    async def ground(self, state, task, legacy):
        project = state["project"]
        id = task["id"]
        g = self.store.task(id, internal=True)["generation"]
        root = f"/projects/{task['projectId']}/floorplan-drafts"
        # Legacy ground enforces blank-project/version and frozen candidate semantics after confirmation.
        if g.get("draftId"):
            draft = await self.client.request(root + "/" + g["draftId"])
            if draft.get("confirmed"):
                if draft.get("sourceReview", {}).get("hash") != draft["hash"]:
                    raise TaskError("SOURCE_REVIEW_REQUIRED", "确认前审核已失效")
                return await legacy(state, self.store.task(id, internal=True))
        if any(
            project["plan"].get(k)
            for k in [
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
            ]
        ) or project.get("roomLabelArchive"):
            raise TaskError("PROJECT_NOT_EMPTY", "初始化项目已非空，未覆盖场景", 409)
        image = await self.client.request("/floorplan-images/" + g["imageId"])
        if not g.get("skillSnapshot"):
            snapshot = load_design_skill(FLOORPLAN_TOOLS, skill_id="floorplan-reconstruction")
            self.patch(id, skillSnapshot=snapshot, skillsUsed=[skill_record(snapshot)])
            self.store.event(id, "skill_loaded", skill_record(snapshot))
        if not g.get("draftId"):
            recognized = g.get("rawRecognition") or await self.recognize(task, image)
            self.patch(id, rawRecognition=recognized)
            if recognized["status"] == "unsupported":
                return {
                    "route": "end",
                    "final": {"status": "failed", "message": recognized["question"]},
                }
            data = {k: v for k, v in recognized.items() if k not in ("status", "question")}
            data["image"] = {k: image[k] for k in ["id", "sha256", "width", "height"]}
            draft = await self.client.request(
                root,
                {
                    "requestId": id + ":v2:recognition",
                    "imageId": image["id"],
                    "baseRevision": project["revision"],
                    "data": data,
                },
            )
            self.patch(
                id, draftId=draft["id"], floorplan=draft, sourceInputHash=fingerprint(task["input"])
            )
        diagnostics = await self.client.request(root + "/" + draft["id"] + "/diagnostics", {})
        await FloorplanToolset(self.base, task, image, "system").result(
            "draft_diagnostics", diagnostics, pictures=False
        )
        g = self.store.task(id, internal=True)["generation"]
        if not g.get("initialReview"):
            initial = await self.review(task, image, draft, diagnostics, "initial")
            self.patch(id, initialReview={"draftHash": draft["hash"], "review": initial})
        report = {
            "checks": diagnostics["checks"],
            "sourceReview": self.store.task(id, internal=True)["generation"]["initialReview"][
                "review"
            ],
        }
        while True:
            g = self.store.task(id, internal=True)["generation"]
            attempt = g.get("measurementAttempts", 0)
            if g.get("measurementComplete"):
                break
            pending = g.get("pendingMeasurement")
            if not pending and (attempt >= 4 or (attempt > 0 and g.get("repairsUsed", 0) >= 3)):
                break
            if not pending:
                self.patch(
                    id,
                    measurementAttempts=attempt + 1,
                    repairsUsed=g.get("repairsUsed", 0) + (1 if attempt else 0),
                    phase="measuring_floorplan",
                )
                pending = await self.measure(task, image, draft, diagnostics, report)
                self.patch(id, pendingMeasurement=pending)
            # Same request is replayed if Node committed before the response/checkpoint.
            actionId = id + ":v2:update:" + fingerprint(pending)[:32]
            body = {
                "requestId": actionId,
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
                await FloorplanToolset(self.base, task, image, "system").result(
                    "draft_diagnostics", diagnostics, pictures=False
                )
                review = None
                if diagnostics["checks"]["passed"]:
                    review = await self.review(task, image, draft, diagnostics, "preconfirmation")
                    draft = await self.client.request(
                        root + "/" + draft["id"] + "/review",
                        {
                            "requestId": id + ":review:" + draft["hash"],
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

                def save(current):
                    current.update(
                        floorplan=draft,
                        diagnostics=diagnostics,
                        previewChecks=diagnostics["checks"],
                        measurementComplete=complete,
                        pendingMeasurement=None,
                        phase="reviewing_floorplan",
                    )
                    current.setdefault("recognitionAttempts", []).append(
                        {
                            "role": "design",
                            "response": pending,
                            "draftHash": draft["hash"],
                            "report": report,
                        }
                    )

                self.store.mutate_generation(id, save)
                if complete:
                    break
            except SceneFailure as error:
                report = {
                    "error": error.code,
                    "message": str(error),
                    "details": error.data.get("details"),
                }
                self.patch(id, pendingMeasurement=None, lastMeasurementError=report)
                if error.code in ("DRAFT_CONFLICT", "PROJECT_NOT_EMPTY", "REVISION_CONFLICT"):
                    break
        g = self.store.task(id, internal=True)["generation"]
        self.patch(id, floorplan=draft, diagnostics=diagnostics, phase="reviewing_floorplan")
        return {
            "route": "end",
            "final": {
                "status": "waiting_input",
                "phase": "reviewing_floorplan",
                "draftId": draft["id"],
                "report": report,
                "message": "原图测量与独立审核通过，请确认结构与布局。"
                if g.get("measurementComplete")
                else "自动测量仍有阻断问题，正式项目未改变。请查看原图证据及检查结果。",
            },
        }
