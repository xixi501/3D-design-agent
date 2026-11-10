import hashlib
import io
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

from . import __version__
from .backends import create_backend
from .glb import inspect_glb
from .store import JobConflict, JobStore, atomic_json, utc_now


logger = logging.getLogger("asset_service")
MAX_IMAGE_BYTES = int(os.getenv("ASSET_MAX_IMAGE_MB", "10")) * 1024 * 1024
MAX_IMAGE_PIXELS = 20_000_000
API_KEY = os.getenv("ASSET_API_KEY", "")


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


def create_app() -> FastAPI:
    data_dir = Path(os.getenv("ASSET_DATA_DIR", "generated_assets")).resolve()
    store = JobStore(data_dir)
    backend = create_backend()
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="asset-job")

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        yield
        executor.shutdown(wait=False, cancel_futures=False)

    app = FastAPI(
        title="ActiScape Asset Service",
        version=__version__,
        lifespan=lifespan,
    )
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
        try:
            generated = backend.generate(directory / job["input_file"], directory)
            model_path = generated["path"]
            model = inspect_glb(model_path)
            asset_id = job_id
            metadata = {
                "asset_id": asset_id,
                "job_id": job_id,
                "name": job["name"],
                "created_at": utc_now(),
                "duration_ms": round((time.monotonic() - started) * 1000),
                "model_url": f"/api/v1/assets/{asset_id}/model",
                "generation": generated["generation"],
                "spatial": {
                    "unit": "m",
                    "up_axis": "Y",
                    "origin": "保留源模型坐标；normalization.center 为底部中心",
                    "scale_calibrated": False,
                    **{key: model[key] for key in ("bounds_min", "bounds_max", "size_m", "size_mm", "normalization")},
                },
                "file": {
                    key: model[key]
                    for key in ("sha256", "bytes", "vertices", "materials")
                },
            }
            atomic_json(directory / "metadata.json", metadata)
            store.update(job_id, status="succeeded", result=metadata, error=None)
        except Exception as exc:
            logger.exception("Asset job %s failed", job_id)
            store.update(
                job_id,
                status="failed",
                error={"code": "GENERATION_FAILED", "message": str(exc)[:1000]},
            )

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
        data = await file.read(MAX_IMAGE_BYTES + 1)
        image, suffix = normalize_image(data)
        clean_name = name.strip()[:120] or "未命名物品"
        request_hash = hashlib.sha256(
            image + clean_name.encode("utf-8") + backend.name.encode("utf-8")
        ).hexdigest()
        try:
            job, replayed = store.create(
                image, suffix, clean_name, request_hash, idempotency_key, backend.name
            )
        except JobConflict as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        if not replayed:
            executor.submit(process, job["id"])
        return {"job": job, "replayed": replayed}

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
        return {
            "assets": [job["result"] for job in store.list() if job.get("result")]
        }

    @app.get("/api/v1/assets/{asset_id}", dependencies=[Depends(authorize)])
    def asset(asset_id: str) -> dict:
        try:
            metadata, _directory = store.find_asset(asset_id)
            return {"asset": metadata}
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="资产不存在") from exc

    @app.get("/api/v1/assets/{asset_id}/model", dependencies=[Depends(authorize)])
    def model(asset_id: str) -> FileResponse:
        try:
            _metadata, directory = store.find_asset(asset_id)
            return FileResponse(
                directory / "asset.glb",
                media_type="model/gltf-binary",
                filename=f"{asset_id}.glb",
            )
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="资产不存在") from exc

    static_dir = Path(__file__).parent / "static"
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
    return app


app = create_app()
