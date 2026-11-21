import hashlib
import json
import os
from pathlib import Path

import numpy as np
import trimesh


COMPRESSED_EXTENSIONS = {
    "KHR_draco_mesh_compression",
    "EXT_meshopt_compression",
    "KHR_texture_basisu",
}
CATEGORY_HEIGHTS_MM = {
    "vase": 280,
    "lamp": 450,
    "plant": 600,
    "chair": 820,
    "side_table": 520,
    "table": 520,
    "sofa": 840,
    "decor": 250,
}
FLOOR_CATEGORIES = {"plant", "chair", "side_table", "table", "sofa"}


def placement_for_category(category: str) -> str:
    return "floor" if category in FLOOR_CATEGORIES else "surface"


def physical_dimensions(
    size: list[float], category: str, target_height_mm: int | None
) -> tuple[dict, str]:
    height = target_height_mm or CATEGORY_HEIGHTS_MM.get(
        category, CATEGORY_HEIGHTS_MM["decor"]
    )
    width = max(1, round(size[0] / size[1] * height))
    depth = max(1, round(size[2] / size[1] * height))
    source = "user_confirmed" if target_height_mm else "category_default"
    return {"width": width, "depth": depth, "height": height}, source


def _already_normalized(lower: list[float], upper: list[float]) -> bool:
    size = [float(upper[i] - lower[i]) for i in range(3)]
    largest = max(size)
    return (
        abs(largest - 1.0) <= 1e-6
        and abs(lower[1]) <= 1e-6
        and abs((lower[0] + upper[0]) / 2.0) <= 1e-6
        and abs((lower[2] + upper[2]) / 2.0) <= 1e-6
    )


def normalize_scene_bounds(scene: trimesh.Scene) -> dict:
    if scene.bounds is None:
        raise ValueError("模型没有有效三维几何")
    lower, upper = scene.bounds.tolist()
    size = [float(upper[i] - lower[i]) for i in range(3)]
    if any(not 0 < value < float("inf") for value in size):
        raise ValueError("模型尺寸无效")

    translation = np.eye(4)
    translation[:3, 3] = [
        -(lower[0] + upper[0]) / 2,
        -lower[1],
        -(lower[2] + upper[2]) / 2,
    ]
    scaling = np.eye(4)
    scaling[:3, :3] *= 1.0 / max(size)
    scene.apply_transform(scaling @ translation)
    return {"raw_size": size, "aspect_ratio": [value / max(size) for value in size]}


def _read_document(data: bytes) -> dict:
    if len(data) < 20 or data[:4] != b"glTF":
        raise ValueError("不是完整的 GLB 文件")
    version = int.from_bytes(data[4:8], "little")
    length = int.from_bytes(data[8:12], "little")
    if version != 2 or length != len(data):
        raise ValueError("GLB 版本或文件长度无效")

    offset = 12
    document = None
    has_binary = False
    while offset < len(data):
        if offset + 8 > len(data):
            raise ValueError("GLB 分块头损坏")
        chunk_length = int.from_bytes(data[offset : offset + 4], "little")
        chunk_type = data[offset + 4 : offset + 8]
        offset += 8
        if chunk_length % 4 or offset + chunk_length > len(data):
            raise ValueError("GLB 分块长度无效")
        chunk = data[offset : offset + chunk_length]
        if chunk_type == b"JSON":
            document = json.loads(chunk.decode("utf-8").strip())
        elif chunk_type == b"BIN\x00":
            has_binary = True
        offset += chunk_length

    if (
        not document
        or not has_binary
        or document.get("asset", {}).get("version") != "2.0"
    ):
        raise ValueError("GLB 缺少 glTF 2.0 元数据或二进制资源")
    required = set(document.get("extensionsRequired", []))
    unsupported = required | (
        set(document.get("extensionsUsed", [])) & COMPRESSED_EXTENSIONS
    )
    if unsupported:
        raise ValueError(
            f"主系统暂不支持这些 GLB 扩展：{', '.join(sorted(unsupported))}"
        )
    if document.get("animations") or document.get("skins"):
        raise ValueError("首版只接受静态模型，请先烘焙动画与骨骼")
    buffers = document.get("buffers", [])
    if len(buffers) != 1 or buffers[0].get("uri"):
        raise ValueError("GLB 必须嵌入唯一二进制缓冲区")
    if any("bufferView" not in image for image in document.get("images", [])):
        raise ValueError("所有贴图必须嵌入 GLB")
    return document


def _clean_zero(value: float) -> float:
    return 0.0 if abs(value) < 1e-7 else float(value)


def inspect_glb(
    path: Path,
    category: str = "decor",
    target_height_mm: int | None = None,
    normalize: bool = False,
) -> dict:
    raw_bytes = path.read_bytes()
    _read_document(raw_bytes)
    scene = trimesh.load(path, force="scene", process=False)
    if scene.bounds is None:
        raise ValueError("模型没有有效三维几何")
    raw_lower, raw_upper = scene.bounds.tolist()
    raw_size = [raw_upper[i] - raw_lower[i] for i in range(3)]
    physical, scale_source = physical_dimensions(raw_size, category, target_height_mm)

    if normalize and not _already_normalized(raw_lower, raw_upper):
        normalization = normalize_scene_bounds(scene)
        aspect = normalization["aspect_ratio"]
        temporary = path.with_suffix(".normalized.glb")
        scene.export(temporary)
        os.replace(temporary, path)
        scene = trimesh.load(path, force="scene", process=False)
        data = path.read_bytes()
        _read_document(data)
    else:
        data = raw_bytes
        extents = [raw_upper[i] - raw_lower[i] for i in range(3)]
        largest = max(extents)
        aspect = [value / largest for value in extents]

    lower, upper = scene.bounds.tolist()
    size = [float(upper[i] - lower[i]) for i in range(3)]
    center = [
        _clean_zero((lower[0] + upper[0]) / 2),
        _clean_zero(lower[1]),
        _clean_zero((lower[2] + upper[2]) / 2),
    ]
    return {
        "sha256": hashlib.sha256(data).hexdigest(),
        "bytes": len(data),
        "bounds_min": [_clean_zero(v) for v in lower],
        "bounds_max": [_clean_zero(v) for v in upper],
        "size_m": {"w": size[0], "d": size[2], "h": size[1]},
        "size_mm": {"w": size[0] * 1000, "d": size[2] * 1000, "h": size[1] * 1000},
        "normalization": {"scale": 1.0, "center": center},
        "vertices": sum(
            len(geometry.vertices) for geometry in scene.geometry.values()
        ),
        "faces": sum(len(geometry.faces) for geometry in scene.geometry.values()),
        "materials": sum(
            1
            for geometry in scene.geometry.values()
            if getattr(geometry.visual, "material", None)
        ),
        "aspectRatio": {"width": aspect[0], "depth": aspect[2], "height": aspect[1]},
        "pivot": "bottom_center",
        "physicalDimensionsMm": physical,
        "scaleSource": scale_source,
        "scale_calibrated": target_height_mm is not None,
    }
