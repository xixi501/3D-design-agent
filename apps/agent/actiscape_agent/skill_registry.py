import hashlib
import json
from pathlib import Path

from .store import TaskError

SKILL_ROOT = Path(__file__).parent / "skills"
FLOORPLAN_TOOLS = {
    "floorplan_context",
    "fit_wall_candidates",
    "request_crop",
    "search_catalogue_batch",
    "precheck_floorplan",
    "candidate_checks",
    "analyze_floorplan",
    "fit_wall_faces",
    "measure_dimension_chain",
    "preview_floorplan",
    "audit_floorplan_source",
}
GENERATION_TOOLS = {"search_catalogue_batch", "precheck_initialization", "candidate_checks"}


def load_design_skill(
    available_tools: set[str], root: Path = SKILL_ROOT, skill_id: str = "rectangular-living-reading"
) -> dict:
    if skill_id not in ("rectangular-living-reading", "floorplan-reconstruction"):
        raise TaskError("SKILL_UNAVAILABLE", "未知设计 Skill")
    directory = root / skill_id
    try:
        manifest = json.loads((directory / "manifest.json").read_text())
        content = (directory / "SKILL.md").read_text()
        license_text = (directory / "LICENSE").read_text()
    except (OSError, ValueError) as e:
        raise TaskError("SKILL_UNAVAILABLE", "设计 Skill 缺失或无法读取") from e
    if (
        manifest.get("id") != skill_id
        or not manifest.get("version")
        or not content.strip()
        or not license_text.strip()
    ):
        raise TaskError("SKILL_INVALID", "Skill 身份、版本、内容或许可不完整")
    required = manifest.get("requiredTools")
    if not isinstance(required, list) or not required or set(required) - available_tools:
        raise TaskError("SKILL_TOOLS_MISSING", "Skill 依赖的真实工具未注册")
    digest = hashlib.sha256(
        json.dumps(
            {"manifest": manifest, "content": content, "license": license_text},
            ensure_ascii=False,
            sort_keys=True,
        ).encode()
    ).hexdigest()
    return {**manifest, "contentHash": digest, "content": content}


def skill_record(snapshot: dict) -> dict:
    return {k: snapshot[k] for k in ("id", "version", "contentHash", "source", "license")}


def load_legacy_floorplan_skill():
    snapshot = json.loads(
        (SKILL_ROOT / "floorplan-reconstruction" / "legacy-0.3.0.json").read_text()
    )
    manifest = {k: v for k, v in snapshot.items() if k not in ("contentHash", "content")}
    license_text = (SKILL_ROOT / "floorplan-reconstruction" / "LICENSE").read_text()
    digest = hashlib.sha256(
        json.dumps(
            {"manifest": manifest, "content": snapshot["content"], "license": license_text},
            ensure_ascii=False,
            sort_keys=True,
        ).encode()
    ).hexdigest()
    if digest != snapshot["contentHash"]:
        raise TaskError("SKILL_INVALID", "旧工作流快照校验失败")
    return snapshot
