"""Role-scoped, read-only tools. Evidence lives in Node; Python stores references."""

import base64
import json

from langchain_core.tools import tool

from .client import SceneFailure
from .floorplan_schemas import FloorplanRecognition, floorplan_recognition_schema
from .store import fingerprint


def recognition_changes(before, after):
    changes = []
    for collection in (
        "anchors",
        "walls",
        "openings",
        "rooms",
        "symbols",
        "activityGroups",
    ):
        old = {str(o.get("id", i)): o for i, o in enumerate(before.get(collection, []))}
        new = {str(o.get("id", i)): o for i, o in enumerate(after.get(collection, []))}
        for identity in sorted(old.keys() | new.keys()):
            if old.get(identity) != new.get(identity):
                changes.append(
                    {
                        "collection": collection,
                        "id": identity,
                        "kind": "added"
                        if identity not in old
                        else "removed"
                        if identity not in new
                        else "changed",
                        "before": old.get(identity),
                        "after": new.get(identity),
                    }
                )
    return changes


class FloorplanToolset:
    def __init__(self, base, task, image, role):
        self.base, self.store, self.client = base, base.store, base.client
        self.task, self.image, self.role = task, image, role
        self.submission = None

    async def request(self, mode, parameters):
        workflow_version = self.store.task(self.task["id"], internal=True)["generation"].get(
            "workflowVersion"
        )
        floorplan_version = self.store.task(self.task["id"], internal=True)["generation"].get(
            "floorplanVersion"
        )
        adapter = (
            "hpd-adapter-6-1"
            if floorplan_version
            in ("s2c-floorplan-v3-6-1", "s2c-floorplan-v4")
            else "hpd-adapter-6"
            if floorplan_version == "s2c-floorplan-v3-6"
            else "hpd-adapter-5"
            if floorplan_version
            in (
                "s2c-floorplan-v3-3",
                "s2c-floorplan-v3-4",
                "s2c-floorplan-v3-5",
            )
            else "hpd-adapter-4"
            if workflow_version == 3
            else "hpd-adapter-6-1"
            if workflow_version == 4
            else "hpd-adapter-3"
            if workflow_version == 2
            else "hpd-adapter-2"
        )
        key = fingerprint(
            {
                "image": self.image["sha256"],
                "mode": mode,
                "parameters": parameters,
                "adapter": adapter,
            }
        )
        g = self.store.task(self.task["id"], internal=True)["generation"]
        for entry in reversed(g.get("upstreamTools", [])):
            record = entry["record"]
            if record.get("requestHash") == key and not record.get("error"):
                return {**record, "reused": True}
        try:
            record = await self.client.request(
                f"/floorplan-images/{self.image['id']}/tools/{mode}",
                {**parameters, "adapterVersion": adapter},
            )
            return {**record, "requestHash": key, "parameters": parameters}
        except SceneFailure as error:
            return {
                "error": error.code,
                "message": str(error),
                "details": error.data.get("details"),
                "files": [],
                "retryableParameters": error.status in (400, 422),
            }

    async def result(self, name, record, pictures=True):
        def merge(generation):
            generation.setdefault("upstreamTools", []).append(
                {"role": self.role, "tool": name, "record": record}
            )
            if (
                generation.get("workflowVersion") in (2, 3, 4)
                and record.get("id")
                and not record.get("error")
            ):
                generation.setdefault("evidenceIndex", {})[record["id"]] = {
                    **record,
                    "role": self.role,
                    "tool": name,
                }

        self.store.mutate_generation(self.task["id"], merge)
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
            """Measure actual ADJACENT labelled lengths. N ticks require exactly N-1 distances; no initial zero or cumulative coordinates. Generic example: ticks=[100,300], distances=[4000], NOT [0,4000]. basis must be interior/centerline/exterior and evidence must quote the actual annotation. Increasing ORIGINAL pixels; distances in mm. Do not stretch X/Y or invent dimensions. samples optionally return diagnostic coordinates."""
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
        async def preview_floorplan(
            draft: FloorplanRecognition, change_reasons: dict[str, str] | None = None
        ) -> dict:
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
            g = self.store.task(self.task["id"], internal=True)["generation"]
            changes = recognition_changes(
                g.get("rawRecognition") or g.get("pendingRecognition") or value, value
            )
            reasons = change_reasons or {}
            unexplained = [
                c
                for c in changes
                if (c["kind"] == "removed" or c["collection"] == "anchors")
                and not reasons.get(c["collection"] + ":" + c["id"], "").strip()
            ]
            if unexplained:
                record.setdefault("checks", {})["passed"] = False
                record["checks"].setdefault("issues", []).append(
                    {
                        "code": "FLOORPLAN_UNEXPLAINED_REMOVAL",
                        "blocking": True,
                        "stage": "preservation",
                        "objectIds": [c["collection"] + ":" + c["id"] for c in unexplained],
                        "message": "删除已识别对象或修改尺寸标注必须在 change_reasons 中逐项提供原图证据，不可静默减少要求",
                        "details": unexplained,
                    }
                )
            record["changes"] = changes
            record["changeReasons"] = reasons
            await self.result("preview_floorplan", record, pictures=False)
            self.submission = value
            g = self.store.task(self.task["id"], internal=True)["generation"]
            g["measurementSubmission"] = {
                "recognition": value,
                "attempt": g.get("measurementAttempts", 0),
                "inputHash": fingerprint(self.task["input"]),
                "checks": record.get("checks"),
                "changes": changes,
                "changeReasons": reasons,
            }
            self.store.update(self.task["id"], generation=g)
            return record

        return [fit_wall_faces, measure_dimension_chain, preview_floorplan]

    def inspection(self, draft_id):
        @tool
        async def audit_floorplan_source() -> list[dict]:
            """Run original wallaudit.py and furnoverlay.py against the frozen, TypeScript-compiled draft. Read source mismatches and furniture orientation overlay. Heuristics cannot waive deterministic checks or authorize edits."""
            record = await self.client.request(
                f"/projects/{self.task['projectId']}/floorplan-drafts/{draft_id}/source-audit",
                {"taskId": self.task["id"]},
            )
            return await self.result("audit_floorplan_source", record)

        return [audit_floorplan_source]
