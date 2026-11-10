import hashlib
import json
from pathlib import Path

import trimesh


COMPRESSED_EXTENSIONS = {
    "KHR_draco_mesh_compression",
    "EXT_meshopt_compression",
    "KHR_texture_basisu",
}


def inspect_glb(path: Path) -> dict:
    data = path.read_bytes()
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

    if not document or not has_binary or document.get("asset", {}).get("version") != "2.0":
        raise ValueError("GLB 缺少 glTF 2.0 元数据或二进制资源")
    required = set(document.get("extensionsRequired", []))
    unsupported = required | (set(document.get("extensionsUsed", [])) & COMPRESSED_EXTENSIONS)
    if unsupported:
        raise ValueError(f"主系统暂不支持这些 GLB 扩展：{', '.join(sorted(unsupported))}")
    if document.get("animations") or document.get("skins"):
        raise ValueError("首版只接受静态模型，请先烘焙动画与骨骼")
    buffers = document.get("buffers", [])
    if len(buffers) != 1 or buffers[0].get("uri"):
        raise ValueError("GLB 必须嵌入唯一二进制缓冲区")
    if any("bufferView" not in image for image in document.get("images", [])):
        raise ValueError("所有贴图必须嵌入 GLB")

    scene = trimesh.load(path, force="scene", process=False)
    if scene.bounds is None:
        raise ValueError("模型没有有效三维几何")
    lower, upper = scene.bounds.tolist()
    size = [float(upper[i] - lower[i]) for i in range(3)]
    if any(not 0 < value < float("inf") for value in size):
        raise ValueError("模型尺寸无效")
    center = [(lower[0] + upper[0]) / 2, lower[1], (lower[2] + upper[2]) / 2]
    return {
        "sha256": hashlib.sha256(data).hexdigest(),
        "bytes": len(data),
        "bounds_min": lower,
        "bounds_max": upper,
        "size_m": {"w": size[0], "d": size[2], "h": size[1]},
        "size_mm": {"w": size[0] * 1000, "d": size[2] * 1000, "h": size[1] * 1000},
        "normalization": {"scale": 1.0, "center": center},
        "vertices": sum(len(geometry.vertices) for geometry in scene.geometry.values()),
        "materials": sum(
            1 for geometry in scene.geometry.values() if getattr(geometry.visual, "material", None)
        ),
    }
