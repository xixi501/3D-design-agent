import hashlib
import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .store import TaskError

SKILL_ROOT = Path(__file__).parent / "skills"
SKILL_SCHEMA = "actiscape.skill.v1"
BUNDLE_SCHEMA = "actiscape.skill-bundle.v1"
JUDGEMENT_SCHEMA = "actiscape.judgements.v1"

SKILL_KINDS = {
    "intake",
    "layout",
    "edit",
    "floorplan",
    "modifier",
    "repair",
    "asset",
    "universal",
}
SKILL_STATUSES = {"draft", "conformant", "verified", "deprecated"}
ACTIVATIONS = {"active", "reserved"}
PROJECT_STATES = {"empty", "existing", "any"}
ALLOWED_CAPABILITIES = {
    "scene.read",
    "catalog.search",
    "candidate.propose",
    "candidate.preflight",
    "candidate.review",
    "candidate.render",
    "floorplan.analyze",
    "floorplan.measure",
    "asset.job",
}
FORBIDDEN_CAPABILITIES = {
    "scene.write",
    "project.commit",
    "scene.apply_edits",
    "database.write",
    "script.execute",
}
MODE_PRIMARY_KIND = {
    "generate_rectangular": "layout",
    "edit": "edit",
    "reconstruct_floorplan": "floorplan",
    "asset_import": "asset",
}

# Compatibility names for callers that still expose logical tool groups.
GENERATION_TOOLS = {
    "scene.read",
    "catalog.search",
    "candidate.propose",
    "candidate.preflight",
    "candidate.review",
    "candidate.render",
}
FLOORPLAN_TOOLS = GENERATION_TOOLS | {"floorplan.analyze", "floorplan.measure"}
CURRENT_CAPABILITIES = GENERATION_TOOLS | {
    "floorplan.analyze",
    "floorplan.measure",
    "asset.job",
}


class SkillAppliesTo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    modes: list[str] = Field(min_length=1, max_length=4)
    roomKinds: list[str] = Field(min_length=1, max_length=20)
    areaM2: tuple[float, float]
    projectState: Literal["empty", "existing", "any"]
    requiredInputs: list[str] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def area_range(self):
        if self.areaM2[0] < 0 or self.areaM2[1] < self.areaM2[0]:
            raise ValueError("areaM2 范围无效")
        if any(mode not in MODE_PRIMARY_KIND and mode != "asset_import" for mode in self.modes):
            raise ValueError("appliesTo.modes 含未知任务模式")
        return self


class SkillComposition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    maxPerTask: int = Field(ge=1, le=2)
    conflictsWith: list[str] = Field(default_factory=list, max_length=30)


class SkillLicense(BaseModel):
    model_config = ConfigDict(extra="forbid")

    spdx: str = Field(min_length=1, max_length=80)
    attribution: str = Field(min_length=1, max_length=300)


class SkillValidation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    structure: bool
    dryRun: bool
    realCore: bool


class SkillManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schemaVersion: Literal["actiscape.skill.v1"]
    id: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=64)
    name: str = Field(min_length=1, max_length=120)
    version: str = Field(pattern=r"^\d+\.\d+\.\d+$")
    kind: Literal[
        "intake",
        "layout",
        "edit",
        "floorplan",
        "modifier",
        "repair",
        "asset",
        "universal",
    ]
    status: Literal["draft", "conformant", "verified", "deprecated"]
    activation: Literal["active", "reserved"]
    summary: str = Field(min_length=1, max_length=500)
    stageHints: dict[str, list[str]] = Field(default_factory=dict)
    appliesTo: SkillAppliesTo
    notApplicable: list[str] = Field(default_factory=list, max_length=30)
    capabilities: list[str] = Field(min_length=1, max_length=20)
    judgements: list[str] = Field(default_factory=list, max_length=80)
    composition: SkillComposition
    license: SkillLicense
    provenance: list[str | dict[str, str]] = Field(default_factory=list, max_length=30)
    validation: SkillValidation

    @model_validator(mode="after")
    def strict_semantics(self):
        caps = set(self.capabilities)
        forbidden = caps & FORBIDDEN_CAPABILITIES
        if forbidden:
            raise ValueError(f"Skill 申请了禁止能力：{sorted(forbidden)}")
        unknown = caps - ALLOWED_CAPABILITIES
        if unknown:
            raise ValueError(f"Skill 申请了未知能力：{sorted(unknown)}")
        if self.activation == "active" and self.status not in {"conformant", "verified"}:
            raise ValueError("active Skill 必须已 conformant 或 verified")
        if self.status in {"conformant", "verified"} and not (
            self.validation.structure and self.validation.dryRun
        ):
            raise ValueError("conformant/verified Skill 必须先通过结构和 dry-run")
        if self.status == "verified" and not self.validation.realCore:
            raise ValueError("verified Skill 必须有真实核心验证")
        if self.kind in {"layout", "edit"} and self.composition.maxPerTask != 1:
            raise ValueError("主流程 Skill maxPerTask 必须为 1")
        if self.kind == "modifier" and self.composition.maxPerTask > 2:
            raise ValueError("modifier maxPerTask 不能超过 2")
        if self.kind == "modifier" and caps & {"candidate.propose", "candidate.preflight"}:
            raise ValueError("modifier 只提供约束与验收，不能独立提出或预检编辑")
        return self


class SkillSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    primarySkillId: str | None = Field(default=None, max_length=64)
    modifierSkillIds: list[str] = Field(default_factory=list, max_length=2)
    reason: str = Field(default="", max_length=500)


class SkillBundle(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schemaVersion: Literal["actiscape.skill-bundle.v1"] = BUNDLE_SCHEMA
    universal: dict | None = None
    primary: dict | None = None
    modifiers: list[dict] = Field(default_factory=list, max_length=2)
    intake: dict | None = None
    repair: dict | None = None
    pendingRepair: dict | None = None
    selection: dict = Field(default_factory=dict)
    judgements: list[dict] = Field(default_factory=list)
    contentHash: str = Field(pattern=r"^[a-f0-9]{64}$")


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise TaskError("SKILL_POOL_INVALID", f"Skill 文件无法读取：{path.name}") from exc


def _canonical(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


class SkillRegistry:
    def __init__(self, root: Path = SKILL_ROOT, available_capabilities: set[str] | None = None):
        self.root = root
        self.available_capabilities = set(available_capabilities or CURRENT_CAPABILITIES)
        self._manifests: dict[str, SkillManifest] = {}
        self._judgements = self._load_judgements()
        self._load_all()
        self.pool_version = self._validate_index()

    def _load_judgements(self) -> dict[str, dict]:
        path = self.root / "_framework" / "judgements.v1.json"
        if not path.is_file():
            path = self.root / "judgements.v1.json"
        raw = _read_json(path)
        entries = raw.get("judgements")
        if entries is None:
            entries = raw.get("items")
        if raw.get("schemaVersion") != JUDGEMENT_SCHEMA or not isinstance(entries, list):
            raise TaskError("SKILL_POOL_INVALID", "结构化判据库格式无效")
        result = {}
        for item in entries:
            jid = item.get("id")
            if not isinstance(jid, str) or jid in result:
                raise TaskError("SKILL_POOL_INVALID", "判据 ID 缺失或重复")
            result[jid] = item
        return result

    def _load_all(self):
        for directory in sorted(self.root.iterdir()):
            if not directory.is_dir() or directory.name.startswith(("_", ".")):
                continue
            path = directory / "manifest.json"
            if not path.is_file():
                continue
            try:
                manifest = SkillManifest.model_validate(_read_json(path))
            except Exception as exc:
                raise TaskError(
                    "SKILL_POOL_INVALID",
                    f"Skill {directory.name} manifest 无效：{exc}",
                ) from exc
            if manifest.id != directory.name:
                raise TaskError("SKILL_POOL_INVALID", f"Skill {directory.name} 身份不一致")
            if manifest.id in self._manifests:
                raise TaskError("SKILL_POOL_INVALID", f"Skill 身份重复：{manifest.id}")
            missing = set(manifest.judgements) - set(self._judgements)
            if missing:
                raise TaskError(
                    "SKILL_POOL_INVALID",
                    f"Skill {manifest.id} 引用未知判据：{sorted(missing)}",
                )
            self._manifests[manifest.id] = manifest
        if not self._manifests:
            raise TaskError("SKILL_POOL_INVALID", "Skill 池为空")

    def _validate_index(self) -> str:
        raw = _read_json(self.root / "index.v1.json")
        if raw.get("schemaVersion") != "actiscape.skill-pool.v1":
            raise TaskError("SKILL_POOL_INVALID", "Skill 池索引 schema 无效")
        version = raw.get("poolVersion")
        if not isinstance(version, str) or not version:
            raise TaskError("SKILL_POOL_INVALID", "Skill 池索引版本缺失")
        entries = raw.get("skills")
        if not isinstance(entries, list):
            raise TaskError("SKILL_POOL_INVALID", "Skill 池索引缺少 skills")
        indexed = {item.get("id") for item in entries if isinstance(item, dict)}
        if indexed != set(self._manifests):
            raise TaskError(
                "SKILL_POOL_INVALID",
                f"Skill 池索引与文件不一致：index={sorted(indexed)} files={sorted(self._manifests)}",
            )
        for item in entries:
            manifest = self._manifests[item["id"]]
            for key in ("version", "kind", "status", "activation"):
                if item.get(key) != getattr(manifest, key):
                    raise TaskError(
                        "SKILL_POOL_INVALID",
                        f"Skill 池索引 {item['id']}.{key} 已过期",
                    )
        return version

    def load(self, skill_id: str) -> dict:
        manifest = self._manifests.get(skill_id)
        if manifest is None:
            if (self.root / skill_id / "manifest.json").is_file():
                raise TaskError("SKILL_POOL_INVALID", f"Skill {skill_id} 未通过池级校验")
            raise TaskError("SKILL_UNAVAILABLE", "未知 Skill", 404)
        directory = self.root / skill_id
        try:
            content = (directory / "SKILL.md").read_text(encoding="utf-8")
        except OSError as exc:
            raise TaskError("SKILL_UNAVAILABLE", f"Skill {skill_id} 缺少正文") from exc
        if not content.strip():
            raise TaskError("SKILL_POOL_INVALID", f"Skill {skill_id} 正文为空")
        license_path = directory / "LICENSE"
        if not license_path.is_file():
            license_path = self.root / "LICENSES" / "MIT.txt"
        try:
            license_text = license_path.read_text(encoding="utf-8")
        except OSError as exc:
            raise TaskError("SKILL_POOL_INVALID", f"Skill {skill_id} 缺少许可证文本") from exc
        priors_path = directory / "priors.json"
        priors = None
        if priors_path.is_file():
            try:
                priors = json.loads(priors_path.read_text(encoding="utf-8"))
            except (OSError, ValueError) as exc:
                raise TaskError("SKILL_POOL_INVALID", f"Skill {skill_id} priors.json 无效") from exc
        judgments = [self._judgements[jid] for jid in manifest.judgements]
        payload = {
            "manifest": manifest.model_dump(mode="json"),
            "content": content,
            "judgements": judgments,
            "licenseText": license_text,
            **({"priors": priors} if priors is not None else {}),
        }
        digest = hashlib.sha256(_canonical(payload)).hexdigest()
        return {
            **manifest.model_dump(mode="json"),
            "content": content,
            "judgementsData": judgments,
            "licenseText": license_text,
            **({"priors": priors} if priors is not None else {}),
            "contentHash": digest,
        }

    def all(self) -> list[dict]:
        return [self.load(skill_id) for skill_id in sorted(self._manifests)]

    def public_record(self, snapshot: dict) -> dict:
        record = {
            key: snapshot[key]
            for key in (
                "id",
                "name",
                "version",
                "kind",
                "status",
                "activation",
                "summary",
                "appliesTo",
                "capabilities",
                "composition",
                "license",
                "validation",
                "contentHash",
            )
        }
        if "priors" in snapshot:
            record["priors"] = snapshot["priors"]
        return record

    def candidates(
        self,
        mode: str,
        *,
        project_state: Literal["empty", "existing"],
        room_kind: str | None = None,
        area_m2: float | None = None,
    ) -> dict[str, list[dict]]:
        if mode not in MODE_PRIMARY_KIND:
            raise TaskError("SKILL_SELECTION_INVALID", f"未知任务模式：{mode}")
        primary_kind = MODE_PRIMARY_KIND[mode]
        primaries, modifiers = [], []
        for manifest in self._manifests.values():
            if manifest.activation != "active" or manifest.status != "verified":
                continue
            if not set(manifest.capabilities).issubset(self.available_capabilities):
                continue
            if mode not in manifest.appliesTo.modes:
                continue
            if (
                manifest.appliesTo.projectState != "any"
                and manifest.appliesTo.projectState != project_state
            ):
                continue
            if (
                room_kind
                and "any" not in manifest.appliesTo.roomKinds
                and room_kind not in manifest.appliesTo.roomKinds
            ):
                continue
            if area_m2 is not None and not (
                manifest.appliesTo.areaM2[0] <= area_m2 <= manifest.appliesTo.areaM2[1]
            ):
                continue
            snapshot = self.load(manifest.id)
            if manifest.kind == primary_kind:
                primaries.append(snapshot)
            elif manifest.kind == "modifier":
                modifiers.append(snapshot)
        return {
            "primary": [self.public_record(item) for item in primaries],
            "modifiers": [self.public_record(item) for item in modifiers],
        }

    def validate_selection(
        self,
        selection: SkillSelection | dict,
        candidates: dict[str, list[dict]],
        *,
        mode: str,
        allow_no_primary: bool = False,
    ) -> SkillSelection:
        try:
            value = (
                selection
                if isinstance(selection, SkillSelection)
                else SkillSelection.model_validate(selection or {})
            )
        except Exception as exc:
            raise TaskError("SKILL_SELECTION_INVALID", f"Skill 选择格式无效：{exc}") from exc
        primary_ids = {item["id"] for item in candidates["primary"]}
        modifier_ids = {item["id"] for item in candidates["modifiers"]}
        if value.primarySkillId is None:
            if not allow_no_primary:
                raise TaskError("SKILL_SELECTION_INVALID", "该任务必须选择一个主 Skill")
            if value.modifierSkillIds:
                raise TaskError(
                    "SKILL_SELECTION_INVALID",
                    "没有主 Skill 时不能单独选择 modifier Skill",
                )
        elif value.primarySkillId not in primary_ids:
            raise TaskError(
                "SKILL_SELECTION_INVALID",
                f"主 Skill 不在候选短名单中：{value.primarySkillId}",
            )
        if len(set(value.modifierSkillIds)) != len(value.modifierSkillIds):
            raise TaskError("SKILL_SELECTION_INVALID", "modifier Skill 不能重复")
        invalid = set(value.modifierSkillIds) - modifier_ids
        if invalid:
            raise TaskError(
                "SKILL_SELECTION_INVALID",
                f"modifier Skill 不在候选短名单中：{sorted(invalid)}",
            )
        selected = {
            item["id"]: item
            for group in candidates.values()
            for item in group
            if item["id"] in {value.primarySkillId, *value.modifierSkillIds}
        }
        conflicts = {
            conflict
            for item in selected.values()
            for conflict in item.get("composition", {}).get("conflictsWith", [])
            if conflict in selected
        }
        if conflicts:
            raise TaskError(
                "SKILL_SELECTION_INVALID",
                f"Skill 组合冲突：{sorted(conflicts)}",
            )
        return value

    def compose(
        self,
        *,
        mode: str,
        selection: SkillSelection | dict,
        include_intake: bool = False,
        include_repair: bool = False,
    ) -> dict:
        value = (
            selection
            if isinstance(selection, SkillSelection)
            else SkillSelection.model_validate(selection)
        )
        active = [
            self._manifests[skill_id]
            for skill_id in [value.primarySkillId, *value.modifierSkillIds]
            if skill_id
        ]
        for manifest in active:
            if manifest.activation != "active":
                raise TaskError("SKILL_RESERVED", f"Skill 尚未启用：{manifest.id}", 409)
            if manifest.status != "verified":
                raise TaskError(
                    "SKILL_SELECTION_INVALID", f"Skill 未通过真实核心验证：{manifest.id}"
                )
            if mode not in manifest.appliesTo.modes:
                raise TaskError(
                    "SKILL_SELECTION_INVALID", f"Skill 不适用于模式 {mode}：{manifest.id}"
                )
            missing = set(manifest.capabilities) - self.available_capabilities
            if missing:
                raise TaskError(
                    "SKILL_CAPABILITY_MISSING",
                    f"Skill {manifest.id} 缺少能力：{sorted(missing)}",
                )
        universal = self.load("universal-spatial-base")
        primary = self.load(value.primarySkillId) if value.primarySkillId else None
        modifiers = [self.load(skill_id) for skill_id in value.modifierSkillIds]
        intake = self.load("floorplan-intake") if include_intake else None
        # Capture repair even when inactive so a later trigger cannot mix a
        # persisted task with Skill files changed during the run.
        pending_repair = self.load("layout-check-repair")
        repair = pending_repair if include_repair else None
        for snapshot in (universal, intake, pending_repair):
            if snapshot is None:
                continue
            if snapshot["activation"] != "active" or snapshot["status"] != "verified":
                raise TaskError(
                    "SKILL_SELECTION_INVALID", f"自动 Skill 未通过验证：{snapshot['id']}"
                )
            if mode not in snapshot["appliesTo"]["modes"]:
                raise TaskError(
                    "SKILL_SELECTION_INVALID",
                    f"自动 Skill 不适用于模式 {mode}：{snapshot['id']}",
                )
        referenced = []
        seen = set()
        for snapshot in [universal, primary, *modifiers, intake, repair]:
            for item in (snapshot or {}).get("judgementsData", []):
                if item["id"] not in seen:
                    seen.add(item["id"])
                    referenced.append(item)
        bundle_payload = {
            "universal": universal,
            "primary": primary,
            "modifiers": modifiers,
            "intake": intake,
            "repair": repair,
            "pendingRepair": None if include_repair else pending_repair,
            "selection": value.model_dump(),
            "judgements": referenced,
        }
        digest = hashlib.sha256(_canonical(bundle_payload)).hexdigest()
        bundle = SkillBundle.model_validate({**bundle_payload, "contentHash": digest})
        return bundle.model_dump()

    def with_repair(self, bundle: dict, mode: str) -> dict:
        try:
            current = SkillBundle.model_validate(bundle)
        except Exception as exc:
            raise TaskError("SKILL_SNAPSHOT_INVALID", "Skill bundle 快照无效") from exc
        if current.repair is not None:
            return current.model_dump()
        repair = current.pendingRepair or self.load("layout-check-repair")
        if repair["activation"] != "active" or repair["status"] != "verified":
            raise TaskError("SKILL_SELECTION_INVALID", "repair Skill 未通过真实核心验证")
        if mode not in repair["appliesTo"]["modes"]:
            raise TaskError(
                "SKILL_SELECTION_INVALID",
                f"自动 Skill 不适用于模式 {mode}：{repair['id']}",
            )
        judgements = list(current.judgements)
        seen = {item["id"] for item in judgements}
        for item in repair.get("judgementsData", []):
            if item["id"] not in seen:
                seen.add(item["id"])
                judgements.append(item)
        payload = {
            "universal": current.universal,
            "primary": current.primary,
            "modifiers": current.modifiers,
            "intake": current.intake,
            "repair": repair,
            "pendingRepair": None,
            "selection": current.selection,
            "judgements": judgements,
        }
        digest = hashlib.sha256(_canonical(payload)).hexdigest()
        return SkillBundle.model_validate({**payload, "contentHash": digest}).model_dump()

    STAGE_RULES = {
        "intake": (
            "什么时候用",
            "适用",
            "开工前",
            "只问",
            "输入",
            "待确认",
            "清单",
            "不适用",
        ),
        "asset": (
            "选品",
            "体量",
            "规格",
            "取舍",
            "材质",
            "风格",
            "面积",
            "家具",
            "尺寸",
            "预算",
            "柜",
            "冰箱",
            "设备",
            "收纳",
            "灯",
            "桌",
            "椅",
            "床",
            "台面",
        ),
        "layout": (
            "主墙",
            "排布",
            "动线",
            "分步",
            "摆放",
            "定位",
            "朝向",
            "净空",
            "通道",
            "床",
            "柜",
            "桌",
            "沙发",
            "步骤",
            "怎么做",
            "分区",
            "环线",
            "焦点",
            "留白",
            "灯位",
            "光",
            "呼应",
            "比例",
            "家具",
        ),
        "check": (
            "检查",
            "验收",
            "判据",
            "净空",
            "错误",
            "避坑",
            "报错",
            "后检",
            "核对",
        ),
        "repair": (
            "修复",
            "错误码",
            "排序",
            "预算",
            "取舍",
            "回退",
            "最小",
            "错误",
            "检查",
            "提交",
            "对策",
            "让步",
            "冲突",
            "优先",
            "复核",
        ),
    }
    UNIVERSAL_STAGE_HEADINGS = {
        "intake": ("适用边界", "坐标与尺寸", "提交门禁"),
        "asset": ("坐标与尺寸", "选品与体量", "提交门禁"),
        "layout": ("坐标与尺寸", "排布与净空", "提交门禁"),
        "check": ("坐标与尺寸", "检查与报错码", "提交门禁"),
        "repair": ("坐标与尺寸", "修复顺序", "提交门禁"),
    }

    @staticmethod
    def _sections(content: str) -> list[dict]:
        sections = []
        heading = None
        body = []
        for line in content.splitlines():
            if line.startswith("## "):
                if heading is not None:
                    sections.append({"heading": heading, "content": "\n".join(body).strip()})
                heading = line[3:].strip()
                body = []
            elif heading is not None:
                body.append(line)
        if heading is not None:
            sections.append({"heading": heading, "content": "\n".join(body).strip()})
        return [item for item in sections if item["content"]]

    @staticmethod
    def _step_blocks(content: str) -> list[dict]:
        """Split a `## 怎么做` body into `**第 N 步 · …**` blocks."""
        blocks = []
        title = None
        body = []
        for line in content.splitlines():
            stripped = line.strip()
            match = re.match(r"^\*\*(第\s*\d+\s*步[^*]*)\*\*(.*)$", stripped)
            if match:
                if title is not None:
                    blocks.append({"title": title, "content": "\n".join(body).strip()})
                title = match.group(1)
                body = []
            elif title is not None:
                body.append(line)
        if title is not None:
            blocks.append({"title": title, "content": "\n".join(body).strip()})
        return [item for item in blocks if item["content"]]

    def _slice_snapshot(
        self,
        snapshot: dict | None,
        *,
        role: str,
        stage: str,
        headings: tuple[str, ...] | None = None,
    ) -> dict | None:
        if not snapshot:
            return None
        sections = self._sections(snapshot["content"])
        fallback = False
        if headings is not None:
            selected = [item for item in sections if item["heading"] in headings]
            content = "\n\n".join(f"## {item['heading']}\n{item['content']}" for item in selected)
            chosen_headings = [item["heading"] for item in selected]
        else:
            hints = (snapshot.get("stageHints") or {}).get(stage) or []
            if hints:
                hinted_steps = []
                hinted_sections = []
                for item in sections:
                    if item["heading"] == "怎么做":
                        for step in self._step_blocks(item["content"]):
                            if any(hint in step["title"] for hint in hints):
                                hinted_steps.append(step)
                    elif any(hint in item["heading"] for hint in hints):
                        hinted_sections.append(item)
                if hinted_steps or hinted_sections:
                    chosen_headings = [
                        *(["怎么做"] if hinted_steps else []),
                        *[item["heading"] for item in hinted_sections],
                    ]
                    content = "\n\n".join(
                        [
                            *(
                                [
                                    "\n\n".join(
                                        f"**{step['title']}**\n{step['content']}"
                                        for step in hinted_steps
                                    )
                                ]
                                if hinted_steps
                                else []
                            ),
                            *[
                                f"## {item['heading']}\n{item['content']}"
                                for item in hinted_sections
                            ],
                        ]
                    )
                    return {
                        "role": role,
                        "id": snapshot["id"],
                        "version": snapshot["version"],
                        "headings": chosen_headings,
                        "content": content,
                        "fallback": False,
                        "priors": snapshot.get("priors"),
                    }
            rules = self.STAGE_RULES[stage]
            chosen_headings = []
            parts = []
            for item in sections:
                if item["heading"] == "怎么做" and stage in ("asset", "layout", "repair"):
                    steps = self._step_blocks(item["content"])
                    matched = [
                        step for step in steps if any(rule in step["title"] for rule in rules)
                    ]
                    if matched:
                        chosen_headings.append(item["heading"])
                        parts.append(
                            "\n\n".join(
                                f"**{step['title']}**\n{step['content']}" for step in matched
                            )
                        )
                    else:
                        chosen_headings.append(item["heading"])
                        parts.append(item["content"])
                        fallback = True
                elif item["heading"] in ("怎么验证", "依赖什么") and stage in ("check", "repair"):
                    chosen_headings.append(item["heading"])
                    parts.append(f"## {item['heading']}\n{item['content']}")
                elif item["heading"] == "怎么验证" and stage == "repair":
                    chosen_headings.append(item["heading"])
                    parts.append(f"## {item['heading']}\n{item['content']}")
            content = "\n\n".join(parts)
            if not chosen_headings:
                # No structured match: keep the whole skill, but mark it so the
                # caller/trace can see that stage slicing was not precise.
                fallback = True
                chosen_headings = [item["heading"] for item in sections]
                content = "\n\n".join(
                    f"## {item['heading']}\n{item['content']}" for item in sections
                )
        if not content:
            return None
        return {
            "role": role,
            "id": snapshot["id"],
            "version": snapshot["version"],
            "headings": chosen_headings,
            "content": content,
            "fallback": fallback,
            "priors": snapshot.get("priors"),
        }

    def slice_for_stage(self, bundle: dict | None, stage: str) -> dict | None:
        """Return only the section of each Skill that matches one Agent stage."""
        if stage not in self.STAGE_RULES:
            raise TaskError("SKILL_SLICE_INVALID", f"未知 Skill 阶段：{stage}")
        if not bundle:
            return None
        try:
            current = SkillBundle.model_validate(bundle)
        except Exception as exc:
            raise TaskError("SKILL_SNAPSHOT_INVALID", "Skill bundle 快照无效") from exc
        instructions = []
        universal = self._slice_snapshot(
            current.universal,
            role="universal",
            stage=stage,
            headings=self.UNIVERSAL_STAGE_HEADINGS[stage],
        )
        if universal:
            instructions.append(universal)
        if stage == "intake":
            intake = self._slice_snapshot(current.intake, role="intake", stage=stage)
            if intake:
                instructions.append(intake)
        else:
            primary = self._slice_snapshot(current.primary, role="primary", stage=stage)
            if primary:
                instructions.append(primary)
            for modifier in current.modifiers:
                sliced = self._slice_snapshot(modifier, role="modifier", stage=stage)
                if sliced:
                    instructions.append(sliced)
            if stage == "repair":
                repair = self._slice_snapshot(current.repair, role="repair", stage=stage)
                if repair:
                    instructions.append(repair)
        return {
            "schemaVersion": "actiscape.skill-slice.v1",
            "stage": stage,
            "contentHash": hashlib.sha256(f"{current.contentHash}:{stage}".encode()).hexdigest(),
            "instructions": instructions,
            "judgements": current.judgements,
            "selection": current.selection,
        }

    def context(self, bundle: dict | None) -> dict | None:
        if not bundle:
            return None
        try:
            current = SkillBundle.model_validate(bundle)
        except Exception as exc:
            raise TaskError("SKILL_SNAPSHOT_INVALID", "Skill bundle 快照无效") from exc
        sections = []
        for role, value in (
            ("universal", current.universal),
            ("intake", current.intake),
            ("primary", current.primary),
            *(("modifier", item) for item in current.modifiers),
            ("repair", current.repair),
        ):
            if value:
                sections.append(
                    {
                        "role": role,
                        "id": value["id"],
                        "version": value["version"],
                        "content": value["content"],
                        **({"priors": value["priors"]} if "priors" in value else {}),
                    }
                )
        return {
            "schemaVersion": current.schemaVersion,
            "contentHash": current.contentHash,
            "selection": current.selection,
            "instructions": sections,
            "judgements": current.judgements,
        }

    def public_bundle(self, bundle: dict | None) -> dict | None:
        if not bundle:
            return None
        try:
            current = SkillBundle.model_validate(bundle)
        except Exception as exc:
            raise TaskError("SKILL_SNAPSHOT_INVALID", "Skill bundle 快照无效") from exc
        return {
            "schemaVersion": current.schemaVersion,
            "contentHash": current.contentHash,
            "selection": current.selection,
            "universal": self.public_record(current.universal) if current.universal else None,
            "primary": self.public_record(current.primary) if current.primary else None,
            "modifiers": [self.public_record(item) for item in current.modifiers],
            "intake": self.public_record(current.intake) if current.intake else None,
            "repair": self.public_record(current.repair) if current.repair else None,
        }

    def records(self, bundle: dict | None) -> list[dict]:
        if not bundle:
            return []
        try:
            current = SkillBundle.model_validate(bundle)
        except Exception as exc:
            raise TaskError("SKILL_SNAPSHOT_INVALID", "Skill bundle 快照无效") from exc
        return [
            {
                **self.public_record(item),
                "role": role,
            }
            for role, item in (
                ("universal", current.universal),
                ("primary", current.primary),
                *(("modifier", value) for value in current.modifiers),
                ("intake", current.intake),
                ("repair", current.repair),
            )
            if item
        ]

    def pool_summary(self) -> dict:
        snapshots = self.all()
        digest = hashlib.sha256(
            _canonical(
                [
                    {
                        "id": item["id"],
                        "version": item["version"],
                        "status": item["status"],
                        "activation": item["activation"],
                        "contentHash": item["contentHash"],
                    }
                    for item in snapshots
                ]
            )
        ).hexdigest()
        return {
            "schemaVersion": "actiscape.skill-pool.v1",
            "poolVersion": self.pool_version,
            "poolHash": digest,
            "skills": len(snapshots),
            "active": sum(
                item["activation"] == "active" and item["status"] == "verified"
                for item in snapshots
            ),
            "reserved": sum(item["activation"] == "reserved" for item in snapshots),
        }


@lru_cache(maxsize=1)
def get_registry() -> SkillRegistry:
    return SkillRegistry()


def load_design_skill(
    available_tools: set[str] | None = None,
    root: Path = SKILL_ROOT,
    skill_id: str = "rectangular-living-reading",
) -> dict:
    capabilities = set(available_tools) if available_tools is not None else CURRENT_CAPABILITIES
    snapshot = SkillRegistry(root, capabilities).load(skill_id)
    missing = set(snapshot["capabilities"]) - capabilities
    if missing:
        raise TaskError(
            "SKILL_CAPABILITY_MISSING",
            f"Skill 缺少真实能力：{sorted(missing)}",
        )
    return snapshot


def skill_record(snapshot: dict) -> dict:
    keys = (
        "id",
        "name",
        "version",
        "kind",
        "status",
        "activation",
        "summary",
        "contentHash",
        "license",
        "source",
    )
    return {key: snapshot[key] for key in keys if key in snapshot}


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


def stage_skill(bundle: dict | None, stage: str, fallback: dict | None = None):
    """Return a stage slice for a bundle, or the legacy frozen snapshot."""
    if not bundle:
        return fallback
    return get_registry().slice_for_stage(bundle, stage)
