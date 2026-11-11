import hashlib
import io
import json
import logging
import os
import secrets
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field

from . import __version__
from .backends import create_backend
from .glb import CATEGORY_HEIGHTS_MM, inspect_glb, placement_for_category
from .store import JobConflict, JobStore, atomic_json, utc_now


logger = logging.getLogger("asset_service")
MAX_IMAGE_BYTES = int(os.getenv("ASSET_MAX_IMAGE_MB", "10")) * 1024 * 1024
MAX_IMAGE_PIXELS = 20_000_000
API_KEY = os.getenv("ASSET_API_KEY", "")


class CalibrationRequest(BaseModel):
    heightMm: int = Field(gt=0, le=10000)
    widthMm: int | None = Field(default=None, gt=0, le=10000)
    depthMm: int | None = Field(default=None, gt=0, le=10000)
    placementType: str | None = None
    category: str | None = None


def authorize(x_api_key: str | None = Header(default=None)) -> None:
    if API_KEY and (not x_api_key or not secrets.compare_digest(x_api_key, API_KEY)):
        raise HTTPException(status_code=401, detail="需要有效的 X-API-Key")


def normalize_image(data: bytes) -> tuple[bytes, str]:
    if not data:
        raise HTTPException(status_code=400, detail="图片不能为空")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="图片超过大小限制")
    try:
        image = Image.open(io.BytesIO(data))
        if image.format not in {"JPEG", "PNG", "WEBP"}:
            raise HTTPException(status_code=415, detail="只支持 JPEG、PNG 或 WebP 图片")
        if image.width * image.height > MAX_IMAGE_PIXELS:
            raise HTTPException(status_code=413, detail="图片像素超过 2000 万限制")
        image.load()
        image = ImageOps.exif_transpose(image)
        output = io.BytesIO()
        image.save(output, format="PNG")
        return output.getvalue(), ".png"
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError) as exc:
        raise HTTPException(status_code=400, detail="图片损坏或无法解码") from exc


def clean_options(
    category: str,
    placement_type: str | None,
    target_height_mm: int | None,
    max_faces: int | None,
    prompt: str | None,
) -> dict:
    category = category.strip().lower() or "decor"
    if category not in CATEGORY_HEIGHTS_MM:
        raise HTTPException(status_code=400, detail="不支持的物品类别")
    placement = placement_type or placement_for_category(category)
    if placement not in {"floor", "surface"}:
        raise HTTPException(status_code=400, detail="placement_type 只支持 floor 或 surface")
    if target_height_mm is not None and not 1 <= target_height_mm <= 10000:
        raise HTTPException(status_code=400, detail="target_height_mm 应在 1–10000 之间")
    if max_faces is not None and not 1000 <= max_faces <= 500000:
        raise HTTPException(status_code=400, detail="max_faces 应在 1000–500000 之间")
    return {
        "category": category,
        "placement_type": placement,
        "target_height_mm": target_height_mm,
        "max_faces": max_faces,
        "prompt": (prompt or "").strip()[:1000],
    }


def create_app() -> FastAPI:
    data_dir = Path(os.getenv("ASSET_DATA_DIR", "generated_assets")).resolve()
    store = JobStore(data_dir)
    backend = create_backend()
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="asset-job")

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        yield
        executor.shutdown(wait=False, cancel_futures=False)

    app = FastAPI(title="ActiScape Asset Service", version=__version__, lifespan=lifespan)
    origins = [item for item in os.getenv("ASSET_CORS_ORIGINS", "").split(",") if item]
    if origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_methods=["GET", "POST"],
            allow_headers=["Content-Type", "Idempotency-Key", "X-API-Key"],
        )

    def process(job_id: str) -> None:
        started = time.monotonic()
        store.update(job_id, status="running")
        directory = store.job_dir(job_id)
        job = store.get(job_id)
        options = job["options"]
        try:
            generated = backend.generate(
                directory / job["input_file"],
                directory,
                max_faces=options["max_faces"],
            )
            model_path = generated["path"]
            model = inspect_glb(
                model_path,
                category=options["category"],
                target_height_mm=options["target_height_mm"],
                normalize=True,
            )
            asset_id = job_id
            metadata = {
                "asset_id": asset_id,
                "job_id": job_id,
                "assetId": asset_id,
                "name": job["name"],
                "status": "succeeded",
                "category": options["category"],
                "placementType": options["placement_type"],
                "physicalDimensionsMm": model["physicalDimensionsMm"],
                "scaleSource": model["scaleSource"],
                "pivot": "bottom_center",
                "inputSha256": job["inputSha256"],
                "created_at": utc_now(),
                "duration_ms": round((time.monotonic() - started) * 1000),
                "model_url": f"/api/v1/assets/{asset_id}/model",
                "glbUrl": f"/api/v1/assets/{asset_id}/model.glb",
                "previewUrl": f"/api/v1/assets/{asset_id}/preview.png",
                "generation": generated["generation"],
                "spatial": {
                    "unit": "m",
                    "up_axis": "Y",
                    "origin": "bottom_center",
                    "scale_calibrated": model["scale_calibrated"],
                    **{
                        key: model[key]
                        for key in ("bounds_min", "bounds_max", "size_m", "size_mm", "normalization")
                    },
                },
                "stats": {
                    "vertices": model["vertices"],
                    "faces": model["faces"],
                    "fileSizeBytes": model["bytes"],
                    "aspectRatio": model["aspectRatio"],
                },
                "file": {
                    key: model[key]
                    for key in ("sha256", "bytes", "vertices", "faces", "materials")
                },
            }
            atomic_json(directory / "metadata.json", metadata)
            atomic_json(directory / "record.json", metadata)
            store.update(job_id, status="succeeded", result=metadata, error=None)
        except Exception as exc:
            logger.exception("Asset job %s failed", job_id)
            store.update(
                job_id,
                status="failed",
                error={"code": "GENERATION_FAILED", "message": str(exc)[:1000]},
            )

    async def accept_image(
        upload: UploadFile,
        name: str,
        idempotency_key: str | None,
        options: dict,
        reuse_cache: bool,
    ) -> dict:
        data = await upload.read(MAX_IMAGE_BYTES + 1)
        image, suffix = normalize_image(data)
        clean_name = name.strip()[:120] or "未命名物品"
        input_sha256 = hashlib.sha256(image).hexdigest()
        request_hash = hashlib.sha256(
            image
            + clean_name.encode("utf-8")
            + backend.name.encode("utf-8")
            + json.dumps(options, sort_keys=True).encode("utf-8")
        ).hexdigest()
        try:
            job, replayed, cached = store.create(
                image,
                suffix,
                clean_name,
                request_hash,
                idempotency_key,
                backend.name,
                options,
                input_sha256,
                reuse_cache,
            )
        except JobConflict as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        if not replayed:
            executor.submit(process, job["id"])
        return {"job": job, "replayed": replayed, "cached": cached}

    @app.get("/api/v1/health")
    def health() -> dict:
        return {
            "status": "ok",
            "version": __version__,
            "backend": backend.name,
            "real_generation": backend.name == "hunyuan",
        }

    @app.post("/api/v1/jobs", status_code=202, dependencies=[Depends(authorize)])
    async def submit(
        file: UploadFile = File(...),
        name: str = Form(default="未命名物品"),
        idempotency_key: str | None = Header(default=None),
    ) -> dict:
        options = clean_options("decor", None, None, None, None)
        return await accept_image(file, name, idempotency_key, options, False)

    @app.post("/api/v1/assets/generate", status_code=202, dependencies=[Depends(authorize)])
    async def generate(
        image: UploadFile = File(...),
        name: str = Form(default="未命名物品"),
        prompt: str | None = Form(default=None),
        category: str = Form(default="decor"),
        placement_type: str | None = Form(default=None),
        target_height_mm: int | None = Form(default=None),
        max_faces: int | None = Form(default=None),
        force_regenerate: bool = Form(default=False),
        idempotency_key: str | None = Header(default=None),
    ) -> dict:
        options = clean_options(category, placement_type, target_height_mm, max_faces, prompt)
        return await accept_image(
            image, name, idempotency_key, options, not force_regenerate
        )

    @app.get("/api/v1/jobs", dependencies=[Depends(authorize)])
    def jobs() -> dict:
        return {"jobs": store.list()}

    @app.get("/api/v1/jobs/{job_id}", dependencies=[Depends(authorize)])
    def job(job_id: str) -> dict:
        try:
            return {"job": store.get(job_id)}
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="任务不存在") from exc

    @app.get("/api/v1/assets", dependencies=[Depends(authorize)])
    def assets() -> dict:
        return {"assets": [job["result"] for job in store.list() if job.get("result")]}

    @app.get("/api/v1/assets/{asset_id}", dependencies=[Depends(authorize)])
    def asset(asset_id: str) -> dict:
        try:
            metadata, _directory = store.find_asset(asset_id)
            return {"asset": metadata}
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="资产不存在") from exc

    @app.post("/api/v1/assets/{asset_id}/calibrate", dependencies=[Depends(authorize)])
    def calibrate(asset_id: str, request: CalibrationRequest) -> dict:
        try:
            metadata, _directory = store.find_asset(asset_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="资产不存在") from exc
        category = request.category or metadata.get("category", "decor")
        if category not in CATEGORY_HEIGHTS_MM:
            raise HTTPException(status_code=400, detail="不支持的物品类别")
        placement = request.placementType or placement_for_category(category)
        if placement not in {"floor", "surface"}:
            raise HTTPException(status_code=400, detail="placementType 只支持 floor 或 surface")
        aspect = metadata.get("stats", {}).get("aspectRatio")
        if aspect is None:
            size = metadata["spatial"]["size_m"]
            aspect = {
                "width": size["w"] / size["h"],
                "depth": size["d"] / size["h"],
                "height": 1.0,
            }
        height = request.heightMm
        width = request.widthMm or max(1, round(height * aspect["width"] / aspect["height"]))
        depth = request.depthMm or max(1, round(height * aspect["depth"] / aspect["height"]))
        physical = {"width": width, "depth": depth, "height": height}
        spatial = dict(metadata["spatial"])
        spatial.update(
            size_mm={"w": width, "d": depth, "h": height},
            scale_calibrated=True,
        )
        updated = store.update_asset(
            asset_id,
            {
                "category": category,
                "placementType": placement,
                "physicalDimensionsMm": physical,
                "scaleSource": "user_confirmed",
                "spatial": spatial,
            },
        )
        return {"asset": updated}

    def model_response(asset_id: str) -> FileResponse:
        try:
            _metadata, directory = store.find_asset(asset_id)
            return FileResponse(
                directory / "asset.glb",
                media_type="model/gltf-binary",
                filename=f"{asset_id}.glb",
            )
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="资产不存在") from exc

    @app.get("/api/v1/assets/{asset_id}/model", dependencies=[Depends(authorize)])
    def model(asset_id: str) -> FileResponse:
        return model_response(asset_id)

    @app.get("/api/v1/assets/{asset_id}/model.glb", dependencies=[Depends(authorize)])
    def model_glb(asset_id: str) -> FileResponse:
        return model_response(asset_id)

    @app.get("/api/v1/assets/{asset_id}/preview.png", dependencies=[Depends(authorize)])
    def preview(asset_id: str) -> FileResponse:
        try:
            _metadata, directory = store.find_asset(asset_id)
            return FileResponse(directory / "input.png", media_type="image/png")
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="资产不存在") from exc

    static_dir = Path(__file__).parent / "static"
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
    return app


app = create_app()
