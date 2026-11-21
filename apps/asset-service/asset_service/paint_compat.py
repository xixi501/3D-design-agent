"""Explicit compatibility loader for Hunyuan3D-2 Paint (replaces global sitecustomize.py)."""

from __future__ import annotations

import importlib
import importlib.util
import json
import logging
import os
import sys
import types
from pathlib import Path

logger = logging.getLogger("asset_service.paint_compat")

_STATE: dict[str, bool] = {
    "modules": False,
    "pipeline": False,
    "patched": False,
}


def _register_module(name: str, file_path: Path):
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, str(file_path))
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load module spec for {name} from {file_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def ensure_hunyuan_paint_compat(paint_dir: str | Path | None = None) -> dict[str, bool]:
    """Register local diffusers modules for offline Hunyuan3DPaintPipeline loading."""
    resolved_dir = Path(
        paint_dir
        or os.environ.get(
            "HUNYUAN_PAINT_DIR",
            "/workspace/actiscape-data/models/Hunyuan3D-2/hunyuan3d-paint-v2-0-turbo",
        )
    )
    modules_py = resolved_dir / "unet" / "modules.py"

    for pkg in ("diffusers_modules", "diffusers_modules.local"):
        if pkg not in sys.modules:
            mod = types.ModuleType(pkg)
            mod.__path__ = []  # type: ignore[attr-defined]
            sys.modules[pkg] = mod

    if modules_py.is_file():
        modules = _register_module("diffusers_modules.local.modules", modules_py)
        _STATE["modules"] = True
        cls = getattr(modules, "UNet2p5DConditionModel", None)
        if cls is not None and not _STATE["patched"]:
            import torch
            from diffusers import UNet2DConditionModel

            def from_pretrained(pretrained_model_name_or_path, **kwargs):
                torch_dtype = kwargs.pop("torch_dtype", torch.float32)
                cfg_path = os.path.join(pretrained_model_name_or_path, "config.json")
                ckpt_path = os.path.join(
                    pretrained_model_name_or_path, "diffusion_pytorch_model.bin"
                )
                with open(cfg_path, encoding="utf-8") as fh:
                    config = json.load(fh)
                model = cls(UNet2DConditionModel(**config))
                ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=True)
                missing, unexpected = model.load_state_dict(ckpt, strict=False)
                logger.info(
                    "Loaded UNet2p5DConditionModel weights (missing=%d, unexpected=%d)",
                    len(missing),
                    len(unexpected),
                )
                return model.to(torch_dtype)

            cls.from_pretrained = staticmethod(from_pretrained)
            _STATE["patched"] = True

    if not _STATE["pipeline"]:
        try:
            hp = importlib.import_module("hy3dgen.texgen.hunyuanpaint.pipeline")
            sys.modules.setdefault("diffusers_modules.local.pipeline", hp)
            _STATE["pipeline"] = True
        except Exception as exc:
            logger.warning("Failed to register diffusers_modules.local.pipeline: %s", exc)

    return dict(_STATE)
