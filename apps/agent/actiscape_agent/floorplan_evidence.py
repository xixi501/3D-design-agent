"""Shared, atomic image evidence for the version-two floorplan workflow."""

import base64
import hashlib
import json

from langchain_core.tools import tool

from .store import TaskError, fingerprint


class FloorplanEvidence:
    def __init__(self, base, task, image, role):
        self.base, self.store, self.client = base, base.store, base.client
        self.task, self.image, self.role = task, image, role

    async def parts(self, record):
        parts = [{"type": "text", "text": json.dumps(record, ensure_ascii=False)}]
        for file in record.get("files", []):
            raw = await self.client.image(file["path"])
            if hashlib.sha256(raw).hexdigest() != file["sha256"]:
                raise TaskError("EVIDENCE_INVALID", "证据文件哈希不符")
            parts.append(
                {
                    "type": "image_url",
                    "image_url": {"url": "data:image/png;base64," + base64.b64encode(raw).decode()},
                }
            )
        return parts

    async def context(self):
        g = self.store.task(self.task["id"], internal=True)["generation"]
        records = list(g.get("evidenceIndex", {}).values())
        return {
            "image": self.image,
            "evidence": records,
            "cropBudget": {"total": 4, "used": len(g.get("cropRequests", {}))},
        }

    async def images(self):
        g = self.store.task(self.task["id"], internal=True)["generation"]
        result, seen = [], set()
        for record in g.get("evidenceIndex", {}).values():
            for f in record.get("files", []):
                if f["sha256"] not in seen:
                    raw = await self.client.image(f["path"])
                    if hashlib.sha256(raw).hexdigest() != f["sha256"]:
                        raise TaskError("EVIDENCE_INVALID", "共享证据文件损坏")
                    seen.add(f["sha256"])
                    result.append(raw)
        return result

    def register(self, record, tool_name):
        identity = record["id"]

        def merge(g):
            g.setdefault("evidenceIndex", {})[identity] = {
                **record,
                "role": self.role,
                "tool": tool_name,
            }

        self.store.mutate_generation(self.task["id"], merge)

    def crop_tool(self):
        @tool
        async def request_crop(x0: float, y0: float, x1: float, y1: float) -> list[dict]:
            """Read a shared original-pixel crop. Main can reserve two; design/check share the remaining task limit of four. Re-reading the same box reuses its logical request. Coordinates always map back to the original image."""
            box = [x0, y0, x1, y1]
            key = fingerprint({"image": self.image["sha256"], "box": box})

            def reserve(g):
                requests = g.setdefault("cropRequests", {})
                if key in requests:
                    return requests[key]
                if len(requests) >= 4 or (
                    self.role == "main" and sum(r["role"] == "main" for r in requests.values()) >= 2
                ):
                    raise TaskError("CROP_LIMIT", "裁剪预算已用完；请读取已有共享证据")
                requests[key] = {"role": self.role, "box": box, "status": "reserved"}
                return requests[key]

            previous = self.store.mutate_generation(self.task["id"], reserve)
            if previous.get("record"):
                return await self.parts(previous["record"])
            try:
                crop = await self.client.request(
                    f"/floorplan-images/{self.image['id']}/crops", {"box": box}
                )
                record = {
                    "id": crop["id"],
                    "imageHash": self.image["sha256"],
                    "box": crop["box"],
                    "cropToPixel": crop["cropToPixel"],
                    "files": [{"path": crop["path"], "sha256": crop["sha256"]}],
                }
                self.register(record, "request_crop")
                self.store.mutate_generation(
                    self.task["id"],
                    lambda g: g["cropRequests"][key].update(status="completed", record=record),
                )
                return await self.parts(record)
            except BaseException:
                self.store.mutate_generation(
                    self.task["id"], lambda g: g["cropRequests"][key].update(status="failed")
                )
                raise

        return request_crop
