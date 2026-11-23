import json
import time
from pathlib import Path

import httpx

BASE = "http://127.0.0.1:3133"
ROOT = Path("/workspace/actiscape-data/handoff/category-fixtures")
OUT = Path("/workspace/actiscape-data/handoff/category-generation-report")
CASES = [
    ("bed-02", "bed", 700, "分类验证-床"),
    ("desk-lamp-01", "lamp", 450, "分类验证-台灯"),
    ("plant-02", "plant", 600, "分类验证-绿植"),
]
OUT.mkdir(parents=True, exist_ok=True)


def submit(client, case, category, height, name):
    files = []
    for index, angle in enumerate(["front", "back", "left", "right", "top"]):
        field = "image" if index == 0 else "reference_images"
        files.append((field, (f"{angle}.png", (ROOT / case / f"{angle}.png").read_bytes(), "image/png")))
    data = {
        "name": name,
        "category": category,
        "target_height_mm": str(height),
        "max_faces": "40000",
        "force_regenerate": "true",
        "reference_views": json.dumps(["back", "left", "right", "top"]),
    }
    response = client.post(f"{BASE}/api/v1/assets/generate", files=files, data=data)
    response.raise_for_status()
    job = response.json()["job"]
    print(f"Submitted {case}: {job['id']}", flush=True)
    return {"case": case, "category": category, "jobId": job["id"], "submittedAt": time.time()}


def main():
    with httpx.Client(timeout=60) as client:
        jobs = [{"case": "sofa-01", "category": "sofa", "jobId": "bc7ea971-668e-4160-a895-a21a5a580c4d", "submittedAt": time.time()}] + [submit(client, *case) for case in CASES]
        pending = {job["jobId"]: job for job in jobs}
        deadline = time.time() + 3600
        while pending and time.time() < deadline:
            for job_id, job in list(pending.items()):
                response = client.get(f"{BASE}/api/v1/jobs/{job_id}")
                response.raise_for_status()
                payload = response.json()["job"]
                if payload["status"] in {"queued", "running"}:
                    continue
                job["status"] = payload["status"]
                job["finishedAt"] = time.time()
                job["result"] = payload.get("result")
                job["error"] = payload.get("error")
                (OUT / f"{job['case']}.json").write_text(json.dumps(job, ensure_ascii=False, indent=2))
                print(f"Finished {job['case']}: {job['status']}", flush=True)
                del pending[job_id]
            if pending:
                time.sleep(15)
        summary = {
            "total": len(jobs),
            "succeeded": sum(job.get("status") == "succeeded" for job in jobs),
            "failed": sum(job.get("status") == "failed" for job in jobs),
            "jobs": jobs,
        }
        (OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
        print(json.dumps({"total": summary["total"], "succeeded": summary["succeeded"], "failed": summary["failed"]}), flush=True)
        if pending:
            raise TimeoutError(f"Jobs still pending: {list(pending)}")


if __name__ == "__main__":
    main()
