"""Bounded adapter for the unmodified, MIT-licensed house-plan-designer pixel tools.

Standalone on purpose: the Node image runtime only installs Pillow/OpenCV/numpy.
No project writes, network, arbitrary executable, or caller-controlled file paths.
"""

import base64
import hashlib
import importlib
import itertools
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

from floorplan_candidates import (
    contour_candidates,
    structure_candidates,
    structure_overlay,
)
from floorplan_image import MAX_BYTES, decode_image, overlay_image, png
from PIL import Image

ROOT = Path(__file__).parent / "vendor" / "house_plan_designer"
VERSION = "hpd-adapter-5"


class ParameterError(ValueError):
    def __init__(self, message, details):
        super().__init__(message)
        self.details = details


def finite(value, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError("工具参数需要有限数字")
    if not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f"工具参数超出范围 {low}–{high}")
    return value


def verify_vendor():
    manifest = json.loads((ROOT / "provenance.json").read_text())
    for name, expected in manifest["files"].items():
        if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != expected:
            raise ValueError("原版工具文件校验失败")
    return {
        "adapterVersion": VERSION,
        "repository": manifest["repository"],
        "commit": manifest["commit"],
        "license": manifest["license"],
    }


def module(name):
    sys.path.insert(0, str(ROOT / "scripts"))
    return importlib.import_module(name)


def run(script, arguments):
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / script), *map(str, arguments)],
        capture_output=True,
        timeout=35,
        check=False,
    )
    if result.returncode:
        message = (result.stderr or result.stdout).decode("utf-8", errors="replace")
        raise ValueError(message[-800:] or "原版工具未成功执行")


def artifact(path):
    if path.suffix == ".png":
        with Image.open(path) as source:
            original_size = source.size
            image = source.convert("RGB")
            image.thumbnail((2048, 2048))
        data = png(image)
        return {
            "data": base64.b64encode(data).decode(),
            "type": "image/png",
            "width": image.width,
            "height": image.height,
            "sourceWidth": original_size[0],
            "sourceHeight": original_size[1],
        }
    data = path.read_bytes()
    return {"data": base64.b64encode(data).decode(), "type": "application/json"}


def analyze(image, image_path, args, out, adapter_version):
    allowed = {"grayMax", "satMax", "outlined", "mmPerPixel"}
    if set(args) - allowed:
        raise ValueError("墙线分析包含未知参数")
    gray = finite(args.get("grayMax", 175), 20, 255)
    # A wider bounded colour tolerance also handles dark blue/brown wall fills.
    # This is a general preset, never an image-specific geometry override.
    saturation = finite(args.get("satMax", 80), 1, 256)
    scale = finite(args.get("mmPerPixel", 1), 0.01, 10000)
    if not isinstance(args.get("outlined", False), bool):
        raise TypeError("outlined 必须是布尔值")
    arguments = [
        image_path,
        "--out",
        out,
        "--scale",
        scale,
        "--gray-max",
        int(gray),
        "--sat-max",
        int(saturation),
    ]
    if args.get("outlined"):
        if "mmPerPixel" not in args:
            raise ValueError("描边墙分析需要先从真实尺寸取得 mmPerPixel")
        arguments += ["--outlined"]
    run("analyze.py", arguments)
    raw = json.loads((out / "analysis.json").read_text())
    result = {k: raw[k] for k in ("size", "outline_px", "segments_px", "gaps_px", "dims_px")}
    files = {name: artifact(out / name) for name in ("analysis.png", "mask.png")}
    if adapter_version == "hpd-adapter-5":
        candidates = structure_candidates(image, result)
        structure_overlay(image, candidates).save(out / "candidates.png")
        result.update(
            {key: value for key, value in candidates.items() if key != "structureSkeletonVersion"}
        )
        files["candidates.png"] = artifact(out / "candidates.png")
    return {
        "result": result,
        "parameters": {
            "grayMax": int(gray),
            "satMax": int(saturation),
            "outlined": args.get("outlined", False),
            "mmPerPixel": args.get("mmPerPixel"),
        },
        "coverage": ["像素墙段候选", "门窗断口候选", "尺寸线刻度"],
        "limitations": [
            "不是完整结构识别；家具边框可能误检，门窗类型仍需视觉判断",
            "未提供真实比例时只使用像素字段；不采用脚本的毫米草稿或承重推测",
            *(
                [
                    "V3-3 候选已完成外围墙闭合、开洞扫描和尺寸线聚类；语义仍需原图复核",
                    "家具轮廓候选只提供像素证据，最终类别与组合由受控模型选择",
                ]
                if adapter_version == "hpd-adapter-5"
                else []
            ),
        ],
        "files": files,
    }


def fits(image, image_path, args, out):
    if (
        set(args) != {"walls"}
        or not isinstance(args["walls"], list)
        or not 1 <= len(args["walls"]) <= 20
    ):
        raise ValueError("每次测量需要 1–20 个像素墙段")
    measured = []
    fit = module("wallfit").fit
    for wall in args["walls"]:
        if set(wall) - {"id", "kind", "c", "p0", "p1", "skip", "search"}:
            raise ValueError("墙面测量包含未知字段")
        if wall.get("kind") not in ("H", "V"):
            raise ValueError("墙方向仅接受 H/V")
        vertical = wall["kind"] == "V"
        across, along = (image.width, image.height) if vertical else (image.height, image.width)
        c = finite(wall["c"], 0, across - 1)
        p0, p1 = finite(wall["p0"], 0, along - 1), finite(wall["p1"], 0, along - 1)
        search = int(min(finite(wall.get("search", 20), 6, 50), c, across - c - 1))
        skip = wall.get("skip", [])
        if not isinstance(skip, list) or len(skip) > 20:
            raise ValueError("开口排除区间过多")
        for interval in skip:
            if not isinstance(interval, list) or len(interval) != 2:
                raise ValueError("开口排除区间无效")
            finite(interval[0], 0, along)
            finite(interval[1], interval[0], along)
        result = (
            fit(str(image_path), wall["kind"], c, p0, p1, skip=skip, search=search)
            if search >= 6
            else {"center": None, "n": 0}
        )
        measured.append({"id": str(wall.get("id", ""))[:100], **result})
    from PIL import ImageDraw

    overlay = image.copy()
    draw = ImageDraw.Draw(overlay)
    for wall, result in zip(args["walls"], measured):
        c = result.get("center")
        if c is None:
            continue
        points = (
            [(c, wall["p0"]), (c, wall["p1"])]
            if wall["kind"] == "V"
            else [(wall["p0"], c), (wall["p1"], c)]
        )
        draw.line(points, fill=(220, 30, 60), width=3)
        draw.text(points[0], str(wall.get("id", "")), fill=(220, 30, 60))
    overlay.save(out / "measured.png")
    return {
        "result": measured,
        "files": {"measured.png": artifact(out / "measured.png")},
        "limitations": ["像素墙面测量，不决定墙体语义；n=0 不代表无墙"],
    }


def axis(args):
    if set(args) - {"ticks", "distances", "samples", "evidence", "basis"}:
        raise ValueError("尺寸链包含未知字段")
    ticks, distances, samples = args.get("ticks"), args.get("distances"), args.get("samples", [])
    if not isinstance(ticks, list) or not 2 <= len(ticks) <= 50:
        raise ValueError("需要 2–50 个尺寸刻度")
    if not isinstance(distances, list) or len(distances) != len(ticks) - 1:
        raise ParameterError(
            "尺寸段数量与刻度不符：N 个刻度必须对应 N-1 个相邻距离；distances 不含起始零点，也不是累计坐标",
            {
                "field": "distances",
                "tickCount": len(ticks),
                "expectedCount": len(ticks) - 1,
                "actualCount": len(distances) if isinstance(distances, list) else None,
                "example": {
                    "ticks": [100, 300],
                    "distances": [4000],
                    "basis": "interior",
                    "evidence": "通用示例：两端真实标注 4000 mm，不是当前图像的测量结果",
                },
            },
        )
    if not isinstance(samples, list) or len(samples) > 100:
        raise ValueError("采样点过多")
    for p in [*ticks, *samples]:
        finite(p, 0, 25000000)
    if any(b <= a for a, b in itertools.pairwise(ticks)):
        raise ValueError("尺寸刻度必须严格递增")
    for distance in distances:
        finite(distance, 1, 1000000)
    if (
        args.get("basis") not in ("interior", "centerline", "exterior")
        or not isinstance(args.get("evidence"), str)
        or not args["evidence"].strip()
    ):
        raise ValueError("尺寸链需要真实标注证据与尺寸基准")
    lib = module("axismap")
    mapping = lib.Axis(lib.chain(ticks, distances))
    ratios = [d / (b - a) for a, b, d in zip(ticks, ticks[1:], distances)]
    deviations = [abs(r / mapping.scale - 1) for r in ratios]
    return {
        "result": {
            "averageMmPerPixel": mapping.scale,
            "segmentMmPerPixel": ratios,
            "segmentDeviation": deviations,
            "samples": [{"pixel": p, "chainMillimetres": mapping(p, snap=0)} for p in samples],
            "inconsistent": any(
                dev > 0.03 and b - a > 15 for dev, a, b in zip(deviations, ticks, ticks[1:])
            ),
        },
        "evidence": args["evidence"][:500],
        "basis": args["basis"],
        "limitations": [
            "尺寸链用于定位基准和交叉核对；不授权按 X/Y 独立拉伸正式场景",
            "正式场景仍由 TypeScript 的统一比例及拓扑校验编译",
        ],
    }


def evidence(image_path, spec, out):
    # The service, never the model, serializes this read-only HouseSpec from TS geometry.
    spec["underlay"]["image"] = str(image_path)
    spec_path = out.parent / "spec.json"
    spec_path.write_text(json.dumps(spec))
    run("furnoverlay.py", [spec_path, "--out", out, "--tiles", "1x1", "--scale", 1])
    run("wallaudit.py", [spec_path, "--out", out])
    issues = json.loads((out / "audit.json").read_text())
    wall_ids = [w["id"] for w in spec["walls"]]
    for issue in issues:
        index = issue.get("wall", -1)
        issue["objectId"] = wall_ids[index] if 0 <= index < len(wall_ids) else None
    return {
        "result": {"issues": issues, "issueCount": len(issues)},
        "coverage": ["沿已编译墙体的原图像素对账", "冻结家具占地与朝向叠图"],
        "limitations": ["启发式图像对账，不替代拓扑、碰撞与人工确认；未建墙体也需对照分析图检查"],
        "files": {
            name: artifact(out / name)
            for name in ("furn_all.png", "sheet_0.png")
            if (out / name).exists()
        },
    }


def process(payload):
    mode, args = payload["mode"], payload.get("parameters", {})
    if not isinstance(args, dict):
        raise TypeError("工具参数必须是对象")
    adapter_version = payload.get("adapterVersion", VERSION)
    source = {**verify_vendor(), "adapterVersion": adapter_version}
    if mode == "axis":
        return {**source, **axis(args)}
    raw = base64.b64decode(payload["image"], validate=True)
    image, _, _ = decode_image(raw)
    with tempfile.TemporaryDirectory(prefix="actiscape-hpd-") as temp:
        directory = Path(temp)
        image_path, out = directory / "source.png", directory / "out"
        image.save(image_path)
        out.mkdir()
        if mode == "analyze":
            result = analyze(image, image_path, args, out, adapter_version)
        elif mode == "fit":
            result = fits(image, image_path, args, out)
        elif mode == "contours":
            if adapter_version != "hpd-adapter-5":
                raise ValueError("家具轮廓候选仅支持 hpd-adapter-5")
            spec = args.get("spec", args)
            if not isinstance(spec, dict):
                raise ValueError("家具轮廓候选缺少草稿")
            result = contour_candidates(image, spec)
            result["overlay"].save(out / "contours.png")
            result["targetOverlay"].save(out / "target_contours.png")
            result["objectOverlay"].save(out / "objects.png")
            result["groupOverlay"].save(out / "groups.png")
            result["files"] = {
                "contours.png": artifact(out / "contours.png"),
                "target_contours.png": artifact(out / "target_contours.png"),
                "objects.png": artifact(out / "objects.png"),
                "groups.png": artifact(out / "groups.png"),
            }
            result.pop("overlay", None)
            result.pop("targetOverlay", None)
            result.pop("objectOverlay", None)
            result.pop("groupOverlay", None)
            result["coverage"] = [
                "目标房间像素区域",
                "家具线稿轮廓",
                "稳定对象候选",
                "活动组候选",
            ]
            result["limitations"] = [
                "对象候选由轮廓几何产生，不代表家具语义",
                "活动组候选只表达主辅空间关系，不直接赋予类别",
                "被家具遮挡或未闭合的线稿会保留为低置信候选",
            ]
        elif mode == "evidence":
            result = evidence(image_path, payload["spec"], out)
        elif mode == "diagnostics":
            spec = payload["spec"]
            files = {}
            for name, data in [("observed.png", spec["draft"]), ("solved.png", spec.get("solved"))]:
                if data is not None:
                    file = out / name
                    file.write_bytes(overlay_image(raw, data))
                    files[name] = artifact(file)
            result = {
                "files": files,
                "coverage": ["原始像素草稿", "实际毫米几何按统一配准回投（可编译时）"],
            }
        else:
            raise ValueError("未知读图工具")
        return {**source, "pixelSpace": "exif-oriented original pixels", **result}


if __name__ == "__main__":
    try:
        raw_input = sys.stdin.buffer.read(MAX_BYTES * 2 + 1)
        if len(raw_input) > MAX_BYTES * 2:
            raise ValueError("工具输入过大")
        print(json.dumps(process(json.loads(raw_input)), ensure_ascii=False))
    except Exception as error:  # noqa: BLE001 -- process boundary returns bounded JSON errors
        print(
            json.dumps(
                {
                    "error": "FLOORPLAN_TOOL_ERROR",
                    "message": str(error)[-1000:],
                    "details": getattr(error, "details", None),
                }
            )
        )
        sys.exit(1)
