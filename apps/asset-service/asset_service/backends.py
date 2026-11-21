import gc
import logging
import os
import shutil
from pathlib import Path

from PIL import Image

from .paint_compat import ensure_hunyuan_paint_compat

logger = logging.getLogger("asset_service.backends")


def _release_cuda_cache() -> None:
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


class DemoBackend:
    name = "demo"
    model = "ActiScape dev/core fixtures/textured-vase.glb"

    def generate(
        self,
        image_path: Path,
        output_dir: Path,
        max_faces: int | None = None,
        reference_paths: list[Path] | None = None,
        reference_views: list[str] | None = None,
    ) -> dict:
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
        local_multiview = Path(self.model_path).parent / "Hunyuan3D-2mv"
        self.multiview_model_path = os.getenv(
            "HUNYUAN_MULTIVIEW_MODEL_PATH",
            str(local_multiview) if local_multiview.is_dir() else "tencent/Hunyuan3D-2mv",
        )
        self.multiview_subfolder = os.getenv(
            "HUNYUAN_MULTIVIEW_SUBFOLDER", "hunyuan3d-dit-v2-mv"
        )
        self._loaded_multiview = False
        self._texture = None
        self._remover = None
        self._floater_remover = None
        self._degenerate_face_remover = None
        self._face_reducer = None

    def _load(self, multiview: bool = False) -> None:
        if (
            self._shape is not None
            and self._texture is not None
            and self._loaded_multiview == multiview
        ):
            return
        paint_dir = os.getenv("HUNYUAN_PAINT_DIR") or str(
            Path(self.model_path) / self.texture_subfolder
        )
        ensure_hunyuan_paint_compat(paint_dir)
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
        if self._shape is not None:
            self._shape = None
            _release_cuda_cache()
        shape_model = self.multiview_model_path if multiview else self.model_path
        shape_subfolder = (
            self.multiview_subfolder if multiview else self.shape_subfolder
        )
        if multiview and Path(shape_model).is_dir():
            weights = Path(shape_model) / shape_subfolder
            if not any(
                (weights / name).is_file()
                for name in ("model.fp16.safetensors", "model.fp16.ckpt")
            ):
                raise RuntimeError(
                    "Multiview geometry weights are unavailable; install verified Hunyuan3D-2mv weights. No single-view fallback was used."
                )
        self._shape = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
            shape_model, subfolder=shape_subfolder
        )
        self._loaded_multiview = multiview
        if self.low_vram:
            self._shape.enable_model_cpu_offload()
        if self._texture is None:
            self._texture = Hunyuan3DPaintPipeline.from_pretrained(
                self.model_path, subfolder=self.texture_subfolder
            )
        self._texture.config.candidate_view_weights = [
            1.0,
            0.75,
            1.0,
            0.75,
            0.5,
            0.5,
        ]
        if self.low_vram:
            self._texture.enable_model_cpu_offload()
        self._remover = BackgroundRemover()

    def generate(
        self,
        image_path: Path,
        output_dir: Path,
        max_faces: int | None = None,
        reference_paths: list[Path] | None = None,
        reference_views: list[str] | None = None,
    ) -> dict:
        multiview = bool(reference_paths)
        self._load(multiview=multiview)
        try:
            with Image.open(image_path) as raw_front:
                image = raw_front.copy()
            has_transparency = False
            if image.mode == "RGBA":
                alpha = image.getchannel("A")
                has_transparency = alpha.getextrema()[0] < 250
            if not has_transparency:
                image = self._remover(image.convert("RGB"))

            references = [image]
            for reference_path in reference_paths or []:
                with Image.open(reference_path) as reference:
                    rgba = reference.convert("RGBA")
                    if rgba.getchannel("A").getextrema()[0] >= 250:
                        rgba = self._remover(rgba.convert("RGB"))
                    references.append(rgba.copy())
            labels = (
                reference_views
                or ["back", "left", "right", "top", "bottom"][: len(references) - 1]
            )
            shape_views = {"front": image}
            for label, reference in zip(labels, references[1:]):
                if label in {"back", "left", "right"}:
                    shape_views[label] = reference

            mesh = self._shape(image=shape_views if multiview else image)[0]
            mesh = self._floater_remover(mesh)
            mesh = self._degenerate_face_remover(mesh)
            face_limit = max_faces or self._max_faces
            mesh = self._face_reducer(mesh, max_facenum=face_limit)
            mesh = self._texture(
                mesh, image=references if len(references) > 1 else image
            )

            # Normalize to max extent = 1.0m and bottom-center at origin (0, 0, 0)
            try:
                bounds = mesh.bounds
                if bounds is not None:
                    lower, upper = bounds[0], bounds[1]
                    size = [float(upper[i]) - float(lower[i]) for i in range(3)]
                    largest = max(size)
                    if largest > 0:
                        mesh.apply_scale(1.0 / largest)
                        bounds = mesh.bounds
                        lower, upper = bounds[0], bounds[1]
                    mesh.apply_translation(
                        [
                            -(float(lower[0]) + float(upper[0])) / 2.0,
                            -float(lower[1]),
                            -(float(lower[2]) + float(upper[2])) / 2.0,
                        ]
                    )
            except Exception as exc:
                logger.warning("Bottom-center mesh normalization skipped: %s", exc)

            output = output_dir / "asset.glb"
            material = mesh.visual.material
            if hasattr(material, "to_pbr"):
                material = material.to_pbr()
            material.metallicFactor = 0.0
            material.roughnessFactor = 0.65
            material.doubleSided = True
            mesh.visual.material = material
            mesh.export(output)
            return {
                "path": output,
                "generation": {
                    "mode": self.name,
                    "is_real_generation": True,
                    "model": self.model_path,
                    "shape_model": self.multiview_model_path
                    if multiview
                    else self.model_path,
                    "shape_subfolder": self.multiview_subfolder
                    if multiview
                    else self.shape_subfolder,
                    "texture_subfolder": self.texture_subfolder,
                    "code_version": self.code_version,
                    "low_vram": self.low_vram,
                    "reference_count": len(references),
                    "geometry_conditioning": "multiview"
                    if multiview
                    else "single_front_image",
                    "geometry_views": list(shape_views),
                    "reference_views": ["front", *labels],
                    "texture_conditioning": "multiple_reference_images"
                    if len(references) > 1
                    else "single_image",
                    "max_faces": face_limit,
                },
            }
        finally:
            _release_cuda_cache()


def create_backend():
    name = os.getenv("ASSET_BACKEND", "demo").lower()
    if name == "demo":
        return DemoBackend()
    if name == "hunyuan":
        return HunyuanBackend()
    raise ValueError(f"未知 ASSET_BACKEND：{name}；可选 demo 或 hunyuan")
