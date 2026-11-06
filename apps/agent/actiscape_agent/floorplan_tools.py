"""Role-scoped, read-only tools. Evidence lives in Node; Python stores references."""

import base64
import json

from langchain_core.tools import tool

from .client import SceneFailure
from .floorplan_schemas import FloorplanRecognition, floorplan_recognition_schema
from .store import fingerprint


class FloorplanToolset:
    def __init__(self, base, task, image, role):
        self.base, self.store, self.client = base, base.store, base.client
        self.task, self.image, self.role = task, image, role
        self.submission = None

    async def request(self, mode, parameters):
        try:
            return await self.client.request(
                f"/floorplan-images/{self.image['id']}/tools/{mode}", parameters
            )
        except SceneFailure as error:
            return {
                "error": error.code,
                "message": str(error),
                "details": error.data.get("details"),
                "files": [],
                "retryableParameters": error.status in (400, 422),
            }

    async def result(self, name, record, pictures=True):
        generation = self.store.task(self.task["id"], internal=True)["generation"]
        generation.setdefault("upstreamTools", []).append(
            {"role": self.role, "tool": name, "record": record}
        )
        self.store.update(self.task["id"], generation=generation)
        self.store.event(
            self.task["id"],
            "floorplan_tool_result",
            {"role": self.role, "tool": name, "record": record},
        )
        parts = [{"type": "text", "text": json.dumps(record, ensure_ascii=False)}]
        for file in record.get("files", []) if pictures else []:
            content = await self.client.image(file["path"])
            parts.append(
                {
                    "type": "image_url",
                    "image_url": {
                        "url": "data:image/png;base64," + base64.b64encode(content).decode()
                    },
                }
            )
        return parts

    def recognition(self):
        @tool
        async def analyze_floorplan(
            gray_max: int = 175,
            sat_max: int = 80,
            outlined: bool = False,
            mm_per_pixel: float | None = None,
        ) -> list[dict]:
            """Run original analyze.py. Read numbered wall/gap candidates, dimension ticks, wall mask and overlay. All coordinates remain original pixels. Supply mm_per_pixel only from a real readable dimension; required for outlined walls."""
            parameters = {"grayMax": gray_max, "satMax": sat_max, "outlined": outlined}
            if mm_per_pixel is not None:
                parameters["mmPerPixel"] = mm_per_pixel
            record = await self.request("analyze", parameters)
            return await self.result("analyze_floorplan", record)

        return [analyze_floorplan]

    def measurement(self):
        @tool
        async def fit_wall_faces(walls: list[dict]) -> list[dict]:
            """Run original wallfit.py for 1–20 walls. Each: {id,kind:'H'|'V',c,p0,p1,skip?:[[start,end]],search?:6..50}. c is cross-axis coordinate, p0/p1 run along wall, all in original pixels. Returns measured faces, center, thickness and sample count; exclude door/window spans."""
            record = await self.request("fit", {"walls": walls})
            return await self.result("fit_wall_faces", record)

        @tool
        async def measure_dimension_chain(
            ticks: list[float],
            distances: list[float],
            basis: str,
            evidence: str,
            samples: list[float] | None = None,
        ) -> list[dict]:
            """Run original axismap.py on increasing pixel ticks and actual adjacent labelled distances in mm. basis: interior/centerline/exterior. Cross-check scale/annotation bases; do not independently stretch X/Y or invent dimensions. Optional samples return diagnostic chain coordinates."""
            record = await self.request(
                "axis",
                {
                    "ticks": ticks,
                    "distances": distances,
                    "basis": basis,
                    "evidence": evidence,
                    "samples": samples or [],
                },
            )
            return await self.result("measure_dimension_chain", record)

        @tool(return_direct=True)
        async def preview_floorplan(draft: FloorplanRecognition) -> dict:
            """Submit ONE measured recognition draft to read-only TypeScript compilation, as the final, separate tool call of this measurement round. Include status='draft'. The fixed graph decides any next repair round. No project/history writes; do not call repeatedly within a round."""
            value = (
                floorplan_recognition_schema(self.image["width"], self.image["height"])
                .model_validate(draft.model_dump(exclude_none=True))
                .model_dump(exclude_none=True)
            )
            data = {k: v for k, v in value.items() if k not in ("status", "question")}
            try:
                response = await self.client.request(
                    f"/projects/{self.task['projectId']}/floorplan-preflight",
                    {"imageId": self.image["id"], "data": data},
                )
                record = {
                    k: response[k]
                    for k in ("checks", "scale", "rooms", "dataHash", "projectRevision")
                    if k in response
                }
            except SceneFailure as error:
                record = {
                    "checks": {"passed": False},
                    "error": error.code,
                    "message": str(error),
                    "details": error.data.get("details"),
                }
            await self.result("preview_floorplan", record, pictures=False)
            self.submission = value
            g = self.store.task(self.task["id"], internal=True)["generation"]
            g["measurementSubmission"] = {
                "recognition": value,
                "attempt": g.get("measurementAttempts", 0),
                "inputHash": fingerprint(self.task["input"]),
                "checks": record.get("checks"),
            }
            self.store.update(self.task["id"], generation=g)
            return record

        return [fit_wall_faces, measure_dimension_chain, preview_floorplan]

    def inspection(self, draft_id):
        @tool
        async def audit_floorplan_source() -> list[dict]:
            """Run original wallaudit.py and furnoverlay.py against the frozen, TypeScript-compiled draft. Read source mismatches and furniture orientation overlay. Heuristics cannot waive deterministic checks or authorize edits."""
            record = await self.client.request(
                f"/projects/{self.task['projectId']}/floorplan-drafts/{draft_id}/source-audit", {}
            )
            return await self.result("audit_floorplan_source", record)

        return [audit_floorplan_source]
