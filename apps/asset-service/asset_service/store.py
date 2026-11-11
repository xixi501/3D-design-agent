import copy
import json
import os
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path


ID_PATTERN = re.compile(r"^[a-f0-9-]{36}$")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def atomic_json(path: Path, value: dict) -> None:
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


class JobConflict(Exception):
    pass


class JobStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.jobs_dir = root / "jobs"
        self.jobs_dir.mkdir(parents=True, exist_ok=True)
        self.index_path = root / "idempotency.json"
        self.lock = threading.RLock()
        if not self.index_path.exists():
            atomic_json(self.index_path, {})
        self.recover_interrupted()

    def recover_interrupted(self) -> None:
        for path in self.jobs_dir.glob("*/job.json"):
            job = json.loads(path.read_text(encoding="utf-8"))
            if job["status"] in {"queued", "running"}:
                job.update(
                    status="failed",
                    updated_at=utc_now(),
                    error={
                        "code": "JOB_INTERRUPTED",
                        "message": "服务重启导致任务中断，请使用新的请求重新提交。",
                    },
                )
                atomic_json(path, job)

    def _validate_id(self, job_id: str) -> None:
        if not ID_PATTERN.fullmatch(job_id):
            raise KeyError(job_id)

    def job_dir(self, job_id: str) -> Path:
        self._validate_id(job_id)
        path = self.jobs_dir / job_id
        if not path.is_dir():
            raise KeyError(job_id)
        return path

    def get(self, job_id: str) -> dict:
        with self.lock:
            return json.loads((self.job_dir(job_id) / "job.json").read_text(encoding="utf-8"))

    def list(self) -> list:
        with self.lock:
            jobs = [
                json.loads(path.read_text(encoding="utf-8"))
                for path in self.jobs_dir.glob("*/job.json")
            ]
        return sorted(jobs, key=lambda job: job["created_at"], reverse=True)

    def create(
        self,
        image: bytes,
        suffix: str,
        name: str,
        request_hash: str,
        idempotency_key: str | None,
        backend: str,
        options: dict,
        input_sha256: str,
        reuse_cache: bool = False,
    ) -> tuple[dict, bool, bool]:
        with self.lock:
            index = json.loads(self.index_path.read_text(encoding="utf-8"))
            if idempotency_key:
                previous = index.get(idempotency_key)
                if previous:
                    if previous["request_hash"] != request_hash:
                        raise JobConflict("相同 Idempotency-Key 不能用于不同图片或参数")
                    return self.get(previous["job_id"]), True, False

            if reuse_cache:
                for cached in self.list():
                    result = cached.get("result") or {}
                    if (
                        cached["status"] == "succeeded"
                        and result.get("inputSha256") == input_sha256
                        and (self.job_dir(cached["id"]) / "asset.glb").is_file()
                    ):
                        return cached, True, True

            job_id = str(uuid.uuid4())
            directory = self.jobs_dir / job_id
            directory.mkdir()
            input_name = f"input{suffix}"
            (directory / input_name).write_bytes(image)
            now = utc_now()
            job = {
                "id": job_id,
                "status": "queued",
                "backend": backend,
                "name": name,
                "created_at": now,
                "updated_at": now,
                "input_file": input_name,
                "inputSha256": input_sha256,
                "options": options,
                "error": None,
                "result": None,
            }
            atomic_json(directory / "job.json", job)
            if idempotency_key:
                index[idempotency_key] = {"job_id": job_id, "request_hash": request_hash}
                atomic_json(self.index_path, index)
            return job, False, False

    def update(self, job_id: str, **changes) -> dict:
        with self.lock:
            path = self.job_dir(job_id) / "job.json"
            job = json.loads(path.read_text(encoding="utf-8"))
            job.update(changes, updated_at=utc_now())
            atomic_json(path, job)
            return job

    def find_asset(self, asset_id: str) -> tuple[dict, Path]:
        self._validate_id(asset_id)
        with self.lock:
            for path in self.jobs_dir.glob("*/job.json"):
                job = json.loads(path.read_text(encoding="utf-8"))
                result = job.get("result")
                if result and result.get("asset_id") == asset_id:
                    return result, path.parent
        raise KeyError(asset_id)

    def update_asset(self, asset_id: str, updates: dict) -> dict:
        with self.lock:
            for path in self.jobs_dir.glob("*/job.json"):
                job = json.loads(path.read_text(encoding="utf-8"))
                result = job.get("result")
                if not result or result.get("asset_id") != asset_id:
                    continue
                metadata = copy.deepcopy(result)
                metadata.update(updates)
                atomic_json(path.parent / "metadata.json", metadata)
                atomic_json(path.parent / "record.json", metadata)
                job["result"] = metadata
                job["updated_at"] = utc_now()
                atomic_json(path, job)
                return metadata
        raise KeyError(asset_id)
