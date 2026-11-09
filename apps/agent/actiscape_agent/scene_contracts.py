import hashlib
import json
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

INPUT_BUNDLE_SCHEMA = "actiscape.input-bundle.v1"
EVIDENCE_GRAPH_SCHEMA = "actiscape.evidence-graph.v1"
INTENT_SPEC_SCHEMA = "actiscape.intent-spec.v1"
SCENE_DRAFT_SCHEMA = "actiscape.scene-draft.v1"
SCENE_DRAFT_SCHEMA_V2 = "actiscape.scene-draft.v2"


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class InputSource(ContractModel):
    sourceId: str = Field(min_length=1, max_length=200)
    kind: Literal[
        "text_brief",
        "floorplan_image",
        "reference_photo",
        "project_import",
        "object_photo",
    ]
    adapterVersion: str = Field(min_length=1, max_length=100)
    sha256: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    uri: str | None = Field(default=None, min_length=1, max_length=1000)
    metadata: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def source_has_content_reference(self):
        if self.kind != "text_brief" and not self.sha256:
            raise ValueError("非文字输入必须绑定内容哈希")
        if self.kind == "text_brief" and not self.uri and not self.metadata.get("text"):
            raise ValueError("文字输入必须绑定原文引用")
        return self


class InputBundle(ContractModel):
    schemaVersion: Literal["actiscape.input-bundle.v1"] = INPUT_BUNDLE_SCHEMA
    sources: list[InputSource] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def unique_sources(self):
        ids = [item.sourceId for item in self.sources]
        if len(ids) != len(set(ids)):
            raise ValueError("输入来源 ID 重复")
        return self


class EvidenceFact(ContractModel):
    id: str = Field(min_length=1, max_length=200)
    sourceId: str = Field(min_length=1, max_length=200)
    kind: str = Field(min_length=1, max_length=100)
    data: dict
    locator: str | None = Field(default=None, max_length=1000)


class EvidenceGraph(ContractModel):
    schemaVersion: Literal["actiscape.evidence-graph.v1"] = EVIDENCE_GRAPH_SCHEMA
    facts: list[EvidenceFact] = Field(default_factory=list, max_length=5000)


class IntentConstraint(ContractModel):
    id: str = Field(min_length=1, max_length=200)
    kind: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1, max_length=4000)
    strict: bool = False
    sourceRefs: list[str] = Field(min_length=1, max_length=20)


class IntentSpec(ContractModel):
    schemaVersion: Literal["actiscape.intent-spec.v1"] = INTENT_SPEC_SCHEMA
    request: str = Field(min_length=1, max_length=4000)
    constraints: list[IntentConstraint] = Field(default_factory=list, max_length=500)
    unknowns: list[str] = Field(default_factory=list, max_length=500)


class AssetResolution(ContractModel):
    objectId: str = Field(min_length=1, max_length=200)
    status: Literal["catalogCandidates", "generatedJob", "unresolved", "manual"]
    catalogKeys: list[str] = Field(default_factory=list, max_length=100)
    jobId: str | None = Field(default=None, max_length=200)
    assetId: str | None = Field(default=None, max_length=200)
    reason: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def resolution_has_payload(self):
        if self.status == "catalogCandidates" and not self.catalogKeys:
            raise ValueError("目录候选不能为空")
        return self


class DraftBudgetLedger(ContractModel):
    modelCalls: int = Field(default=0, ge=0, le=24)
    activeSeconds: float = Field(default=0, ge=0, le=600)
    repairRounds: int = Field(default=0, ge=0, le=3)
    adapterCalls: int = Field(default=0, ge=0)
    assetJobs: int = Field(default=0, ge=0)


class FieldAuthority(ContractModel):
    path: str = Field(min_length=1, max_length=500)
    authority: Literal["baseline", "observed", "inferred", "user_intent", "manual"]
    sourceIds: list[str] = Field(default_factory=list, max_length=20)


class SceneDraftPayload(ContractModel):
    schemaVersion: Literal[
        "actiscape.scene-draft.v1",
        "actiscape.scene-draft.v2",
    ] = SCENE_DRAFT_SCHEMA
    projectId: str = Field(min_length=1, max_length=200)
    baseProjectRevision: int = Field(ge=0)
    inputBundle: InputBundle
    evidenceGraph: EvidenceGraph
    intentSpec: IntentSpec
    recognition: dict | None = None
    program: dict
    assetResolutions: list[AssetResolution] = Field(default_factory=list, max_length=300)
    uncertainties: list[dict] = Field(default_factory=list, max_length=500)
    budgetLedger: DraftBudgetLedger = Field(default_factory=DraftBudgetLedger)
    fieldAuthorities: list[FieldAuthority] = Field(default_factory=list, max_length=1000)

    @model_validator(mode="after")
    def validate_source_ownership(self):
        sources = {item.sourceId: item for item in self.inputBundle.sources}
        if self.schemaVersion == SCENE_DRAFT_SCHEMA_V2:
            if not self.recognition:
                raise ValueError("第二版场景草稿需要识别块")
            source_id = self.recognition.get("sourceId")
            if source_id not in sources:
                raise ValueError(f"识别块引用未知来源：{source_id}")
            if self.recognition.get("schemaVersion") != "actiscape.floorplan-recognition.v1":
                raise ValueError("识别块版本无效")
            if self.recognition.get("kind") != "floorplan":
                raise ValueError("识别块类型无效")
        elif self.recognition is not None:
            raise ValueError("第一版场景草稿不能包含识别块")
        evidence_sources = {"floorplan_image", "reference_photo", "project_import"}
        for fact in self.evidenceGraph.facts:
            source = sources.get(fact.sourceId)
            if source is None:
                raise ValueError(f"证据引用未知来源：{fact.sourceId}")
            if source.kind not in evidence_sources:
                raise ValueError(f"来源 {source.sourceId} 不能写入事实证据")
        for constraint in self.intentSpec.constraints:
            missing = set(constraint.sourceRefs) - set(sources)
            if missing:
                raise ValueError(f"意图引用未知来源：{sorted(missing)}")
        for authority in self.fieldAuthorities:
            missing = set(authority.sourceIds) - set(sources)
            if missing:
                raise ValueError(f"字段权威引用未知来源：{sorted(missing)}")
        return self


def contract_hash(value: BaseModel | dict) -> str:
    payload = value.model_dump(mode="json") if isinstance(value, BaseModel) else value
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()
