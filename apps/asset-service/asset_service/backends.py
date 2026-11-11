import os
import shutil
from pathlib import Path

from PIL import Image


class DemoBackend:
    name = "demo"
    model = "ActiScape dev/core fixtures/textured-vase.glb"

    def generate(self, image_path: Path, output_dir: Path, max_faces: int | None = None) -> dict:
        source = Path(__file__).parent / "assets" / "textured-vase.glb"
        output = output_dir / "asset.glb"
        shutil.copyfile(source, output)
        return {
            "path": output,
            "generation": {
                "mode": self.name,
                "is_real_generation": False,
                "model": self.model,
                "max_faces": max_faces,
                "notice": "固定示例模型，仅验证任务、存储与预览流程；并非由输入图片生成。",
            },
        }


class HunyuanBackend:
    name = "hunyuan"

    def __init__(self) -> None:
        self.model_path = os.getenv("HUNYUAN_MODEL_PATH", "tencent/Hunyuan3D-2")
        self.shape_subfolder = os.getenv(
            "HUNYUAN_SHAPE_SUBFOLDER", "hunyuan3d-dit-v2-0"
        )
        self.texture_subfolder = os.getenv(
            "HUNYUAN_TEXTURE_SUBFOLDER", "hunyuan3d-paint-v2-0-turbo"
        )
        self.low_vram = os.getenv("HUNYUAN_LOW_VRAM", "0") == "1"
        self.code_version = os.getenv("HUNYUAN_CODE_VERSION", "unconfigured")
        self._max_faces = int(os.getenv("ASSET_MAX_FACES", "20000"))
        self._shape = None
        self._texture = None
        self._remover = None
        self._floater_remover = None
        self._degenerate_face_remover = None
        self._face_reducer = None

    def _load(self) -> None:
        if self._shape is not None and self._texture is not None:
            return
        try:
            import torch
            from hy3dgen.rembg import BackgroundRemover
            from hy3dgen.shapegen import (
                DegenerateFaceRemover,
                FaceReducer,
                FloaterRemover,
                Hunyuan3DDiTFlowMatchingPipeline,
            )
            from hy3dgen.texgen import Hunyuan3DPaintPipeline
        except ImportError as exc:
            raise RuntimeError(
                "Hunyuan3D 依赖未安装，请按 SERVER_RUNBOOK.md 配置服务器环境"
            ) from exc
        if not torch.cuda.is_available():
            raise RuntimeError("真实生成需要可用的 NVIDIA CUDA GPU")

        self._floater_remover = FloaterRemover()
        self._degenerate_face_remover = DegenerateFaceRemover()
        self._face_reducer = FaceReducer()
        self._shape = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
            self.model_path, subfolder=self.shape_subfolder
        )
        if self.low_vram:
            self._shape.enable_model_cpu_offload()
        self._texture = Hunyuan3DPaintPipeline.from_pretrained(
            self.model_path, subfolder=self.texture_subfolder
        )
        self._remover = BackgroundRemover()

    def generate(
        self, image_path: Path, output_dir: Path, max_faces: int | None = None
    ) -> dict:
        self._load()
        image = Image.open(image_path)
        has_transparency = False
        if image.mode == "RGBA":
            alpha = image.getchannel("A")
            has_transparency = alpha.getextrema()[0] < 250
        if not has_transparency:
            image = self._remover(image.convert("RGB"))

        mesh = self._shape(image=image)[0]
        mesh = self._floater_remover(mesh)
        mesh = self._degenerate_face_remover(mesh)
        face_limit = max_faces or self._max_faces
        mesh = self._face_reducer(mesh, max_facenum=face_limit)
        mesh = self._texture(mesh, image=image)
        output = output_dir / "asset.glb"
        mesh.export(output)
        return {
            "path": output,
            "generation": {
                "mode": self.name,
                "is_real_generation": True,
                "model": self.model_path,
                "shape_subfolder": self.shape_subfolder,
                "texture_subfolder": self.texture_subfolder,
                "code_version": self.code_version,
                "low_vram": self.low_vram,
                "max_faces": face_limit,
            },
        }


def create_backend():
    name = os.getenv("ASSET_BACKEND", "demo").lower()
    if name == "demo":
        return DemoBackend()
    if name == "hunyuan":
        return HunyuanBackend()
    raise ValueError(f"未知 ASSET_BACKEND：{name}；可选 demo 或 hunyuan")
