"""Typed, least-privilege handoffs between ActiScape agents and the code supervisor."""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from .schemas import StrictModel
from .store import fingerprint

AgentRole = Literal[
    "main",
    "structure",
    "vision",
    "assets",
    "design",
    "check",
    "coordinator",
]

StageName = Literal[
    "ground",
    "structure",
    "geometry",
    "furniture",
    "assets",
    "design",
    "render",
    "check",
    "repair",
    "commit",
]

Capability = Literal[
    "scene.read",
    "project.read",
    "skill.select",
    "floorplan.analyze",
    "floorplan.measure",
    "floorplan.select_structure",
    "furniture.select_objects",
    "catalog.search",
    "candidate.propose",
    "candidate.preflight",
    "candidate.render",
    "candidate.review",
    "draft.repair",
]

ROLE_CAPABILITIES: dict[str, set[Capability]] = {
    "main": {
        "scene.read",
        "project.read",
        "skill.select",
    },
    "structure": {
        "scene.read",
        "floorplan.analyze",
        "floorplan.measure",
        "floorplan.select_structure",
        "draft.repair",
    },
    "vision": {
        "scene.read",
        "furniture.select_objects",
        "draft.repair",
    },
    "assets": {
        "scene.read",
        "catalog.search",
    },
    "design": {
        "scene.read",
        "candidate.preflight",
    },
    "check": {
        "scene.read",
        "candidate.review",
    },
}

ROLE_CONTEXT_KEYS: dict[str, set[str]] = {
    "main": {
        "userRequest",
        "selectedIds",
        "recentConversation",
        "projectSummary",
        "skillCandidates",
        "capabilities",
        "scope",
    },
    "structure": {
        "userRequest",
        "image",
        "structureSkeleton",
        "scope",
        "skill",
        "capabilities",
    },
    "vision": {
        "userRequest",
        "roomLabels",
        "structure",
        "targetRoomIds",
        "targetRegions",
        "objectCandidates",
        "activityGroupCandidates",
        "allowedRooms",
        "allowedCategories",
        "skill",
        "capabilities",
    },
    "assets": {
        "userRequest",
        "symbols",
        "catalogue",
        "lastReport",
        "skill",
        "capabilities",
    },
    "design": {
        "userRequest",
        "frozenDraft",
        "assets",
        "scope",
        "frozenScope",
        "sourceMatches",
        "lastReport",
        "skill",
        "capabilities",
    },
    "check": {
        "userRequest",
        "frozenDraft",
        "candidate",
        "checks",
        "imageViews",
        "skill",
        "capabilities",
    },
}


class RoleContextV1(StrictModel):
    schemaVersion: Literal["actiscape.role-context.v1"] = "actiscape.role-context.v1"
    taskId: str = Field(min_length=1, max_length=200)
    role: AgentRole
    stage: StageName
    inputHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    projectRevision: int = Field(ge=0)
    permissions: list[Capability] = Field(default_factory=list)
    payload: dict


class StageResultV1(StrictModel):
    schemaVersion: Literal["actiscape.stage-result.v1"] = "actiscape.stage-result.v1"
    taskId: str = Field(min_length=1, max_length=200)
    role: AgentRole
    stage: StageName
    status: Literal["ok", "blocked", "failed", "unsupported"]
    inputHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    outputHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    output: dict
    issueCodes: list[str] = Field(default_factory=list, max_length=100)
    modelCalls: int = Field(default=0, ge=0, le=24)
    adapterCalls: int = Field(default=0, ge=0)

    @classmethod
    def create(
        cls,
        *,
        task_id: str,
        role: AgentRole,
        stage: StageName,
        status: Literal["ok", "blocked", "failed", "unsupported"],
        input_hash: str,
        output: dict,
        issue_codes: list[str] | None = None,
        model_calls: int = 0,
        adapter_calls: int = 0,
    ):
        return cls(
            taskId=task_id,
            role=role,
            stage=stage,
            status=status,
            inputHash=input_hash,
            outputHash=fingerprint(output),
            output=output,
            issueCodes=issue_codes or [],
            modelCalls=model_calls,
            adapterCalls=adapter_calls,
        )


class ReviewIssueV1(StrictModel):
    schemaVersion: Literal["actiscape.review-issue.v1"] = "actiscape.review-issue.v1"
    code: str = Field(min_length=1, max_length=100)
    source: Literal["code", "model"] = "model"
    severity: Literal["blocking", "advisory"] = "blocking"
    objectIds: list[str] = Field(default_factory=list, max_length=20)
    evidenceRefs: list[str] = Field(default_factory=list, max_length=20)
    message: str = Field(min_length=1, max_length=500)
    bbox: list[float] | None = Field(default=None, min_length=4, max_length=4)


RepairRole = Literal["structure", "vision", "assets", "design", "coordinator"]


class RepairRequestV1(StrictModel):
    schemaVersion: Literal["actiscape.repair-request.v1"] = "actiscape.repair-request.v1"
    taskId: str = Field(min_length=1, max_length=200)
    targetRole: RepairRole
    sourceStage: StageName
    issueCodes: list[str] = Field(min_length=1, max_length=100)
    objectIds: list[str] = Field(default_factory=list, max_length=100)
    evidenceRefs: list[str] = Field(default_factory=list, max_length=100)
    draftHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    attempt: int = Field(ge=1, le=3)
    maxAttempts: int = Field(ge=1, le=3)
    allowedActions: list[str] = Field(min_length=1, max_length=20)
    failClosed: bool = True


STRUCTURE_ISSUES = {
    "WALL_MISMATCH",
    "OPENING_MISMATCH",
    "ROOM_MISMATCH",
    "DIMENSION_MISMATCH",
    "UNKNOWN_WALL_GROUP",
    "MIXED_WALL_ORIENTATION",
    "OPENING_OWNER_UNRESOLVED",
    "OPENING_OUT_OF_RANGE",
    "INVALID_WALL_GEOMETRY",
    "TARGET_ROOM_MISSING",
}
VISION_ISSUES = {
    "FURNITURE_MISSING",
    "FURNITURE_EXTRA",
    "FURNITURE_POSITION",
    "INVALID_FURNITURE",
    "UNKNOWN_OBJECT_CANDIDATE",
    "OBJECT_CANDIDATE_REUSED",
    "ACTIVITY_GROUP_INCOMPLETE",
    "ACTIVITY_GROUP_ROLE_INVALID",
    "UNRESOLVED_ACTIVITY_GROUP",
}
ASSET_ISSUES = {
    "ASSET_SELECTION",
    "ASSET_CATEGORY_MISMATCH",
    "UNKNOWN_TYPE",
}
DESIGN_ISSUES = {
    "CHECK_FAILED",
    "FROZEN_ASSETS",
}
COORDINATOR_ISSUES = {
    "DRAFT_CONFLICT",
    "EVIDENCE_INVALID",
    "EVIDENCE_MISSING",
    "REVIEW_CONFLICT",
    "CHANGE_EVIDENCE_REQUIRED",
    "INVALID_REVIEW",
    "OTHER",
}


def role_for_issue(code: str) -> RepairRole:
    if code in STRUCTURE_ISSUES:
        return "structure"
    if code in VISION_ISSUES:
        return "vision"
    if code in ASSET_ISSUES:
        return "assets"
    if code in DESIGN_ISSUES:
        return "design"
    return "coordinator"


class RepairBudgetState(StrictModel):
    structure: int = Field(default=0, ge=0, le=1)
    vision: int = Field(default=0, ge=0, le=1)
    assets: int = Field(default=0, ge=0, le=3)
    design: int = Field(default=0, ge=0, le=3)


def build_repair_request(
    *,
    task_id: str,
    source_stage: StageName,
    draft_hash: str,
    issues: list[ReviewIssueV1],
    budget: RepairBudgetState,
) -> tuple[RepairRequestV1 | None, RepairBudgetState, list[str]]:
    blocking = [
        issue
        for issue in issues
        if issue.severity == "blocking" and issue.code not in COORDINATOR_ISSUES
    ]
    if not blocking:
        return None, budget, [issue.code for issue in issues if issue.severity == "blocking"]

    by_role: dict[str, list[ReviewIssueV1]] = {}
    for issue in blocking:
        target = role_for_issue(issue.code)
        if target == "coordinator":
            continue
        if not issue.evidenceRefs:
            return None, budget, ["EVIDENCE_MISSING"]
        by_role.setdefault(target, []).append(issue)

    target = next(
        (role for role in ("structure", "vision", "assets", "design") if role in by_role),
        None,
    )
    if target is None:
        return None, budget, [issue.code for issue in blocking]
    maximum = 1 if target in ("structure", "vision") else 3
    used = getattr(budget, target)
    if used >= maximum:
        return None, budget, ["REPAIR_BUDGET_EXHAUSTED", *[i.code for i in by_role[target]]]
    selected = by_role[target]
    allowed_actions = {
        "structure": ["replace_structure_candidates", "preserve_furniture"],
        "vision": ["replace_object_selection", "reconcile_activity_group"],
        "assets": ["replace_catalog_key"],
        "design": ["recompute_frozen_match", "rerun_precheck"],
    }[target]
    request = RepairRequestV1(
        taskId=task_id,
        targetRole=target,
        sourceStage=source_stage,
        issueCodes=sorted({issue.code for issue in selected}),
        objectIds=sorted({oid for issue in selected for oid in issue.objectIds}),
        evidenceRefs=sorted({ref for issue in selected for ref in issue.evidenceRefs}),
        draftHash=draft_hash,
        attempt=used + 1,
        maxAttempts=maximum,
        allowedActions=allowed_actions,
    )
    next_budget = budget.model_copy(update={target: used + 1})
    return request, next_budget, request.issueCodes


def build_role_context(
    *,
    task_id: str,
    role: AgentRole,
    stage: StageName,
    project_revision: int,
    payload: dict,
) -> RoleContextV1:
    allowed = ROLE_CONTEXT_KEYS.get(role)
    if allowed is None:
        raise ValueError(f"角色 {role} 不允许接收模型上下文")
    unknown = set(payload) - allowed
    if unknown:
        raise ValueError(f"角色 {role} 收到未授权上下文：{sorted(unknown)}")
    permissions = sorted(ROLE_CAPABILITIES.get(role, set()))
    input_hash = fingerprint(
        {
            "taskId": task_id,
            "role": role,
            "stage": stage,
            "projectRevision": project_revision,
            "permissions": permissions,
            "payload": payload,
        }
    )
    return RoleContextV1(
        taskId=task_id,
        role=role,
        stage=stage,
        inputHash=input_hash,
        projectRevision=project_revision,
        permissions=permissions,
        payload=payload,
    )
