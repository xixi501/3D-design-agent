import pytest

from actiscape_agent.role_contracts import (
    RepairBudgetState,
    ReviewIssueV1,
    build_repair_request,
    build_role_context,
    role_for_issue,
)


def issue(code, evidence_refs=None, object_ids=None):
    return ReviewIssueV1(
        code=code,
        severity="blocking",
        objectIds=object_ids or [],
        evidenceRefs=evidence_refs or ["diagnostic:current"],
        message=f"{code} evidence",
    )


def test_role_context_is_least_privilege_and_hash_bound():
    context = build_role_context(
        task_id="task-1",
        role="structure",
        stage="structure",
        project_revision=0,
        payload={
            "userRequest": "复现整层",
            "image": {"id": "image-1"},
            "structureSkeleton": {"candidateWalls": []},
            "scope": {"roomSelection": "all_visible"},
            "functionalAreas": ["bedroom", "kitchen"],
            "roomCatalog": [{"id": "bedroom", "name": "卧室"}],
            "floorplanScope": {"roomSelection": "all_visible"},
        },
    )
    assert context.role == "structure"
    assert "floorplan.select_structure" in context.permissions
    assert "candidate.preflight" not in context.permissions
    assert len(context.inputHash) == 64
    with pytest.raises(ValueError, match="未授权上下文"):
        build_role_context(
            task_id="task-1",
            role="structure",
            stage="structure",
            project_revision=0,
            payload={"objectCandidates": [{"id": "leak"}]},
        )


def test_issue_to_role_mapping_and_one_bounded_repair():
    assert role_for_issue("OPENING_OWNER_UNRESOLVED") == "structure"
    assert role_for_issue("OBJECT_CANDIDATE_REUSED") == "vision"
    assert role_for_issue("ASSET_SELECTION") == "assets"
    assert role_for_issue("EVIDENCE_INVALID") == "coordinator"

    budget = RepairBudgetState()
    request, next_budget, codes = build_repair_request(
        task_id="task-1",
        source_stage="check",
        draft_hash="a" * 64,
        issues=[
            issue(
                "OPENING_OWNER_UNRESOLVED",
                object_ids=["opening-1"],
            )
        ],
        budget=budget,
    )
    assert request is not None
    assert request.targetRole == "structure"
    assert codes == ["OPENING_OWNER_UNRESOLVED"]
    assert next_budget.structure == 1
    exhausted, _, exhausted_codes = build_repair_request(
        task_id="task-1",
        source_stage="check",
        draft_hash="b" * 64,
        issues=[
            issue(
                "OPENING_OWNER_UNRESOLVED",
                object_ids=["opening-1"],
            )
        ],
        budget=next_budget,
    )
    assert exhausted is None
    assert exhausted_codes == ["REPAIR_BUDGET_EXHAUSTED", "OPENING_OWNER_UNRESOLVED"]


def test_model_issue_without_evidence_cannot_trigger_repair_loop():
    no_evidence = ReviewIssueV1(
        code="FURNITURE_MISSING",
        severity="blocking",
        objectIds=["chair-1"],
        evidenceRefs=[],
        message="missing chair",
    )
    request, budget, codes = build_repair_request(
        task_id="task-1",
        source_stage="check",
        draft_hash="c" * 64,
        issues=[no_evidence],
        budget=RepairBudgetState(),
    )
    assert request is None
    assert codes == ["EVIDENCE_MISSING"]
    assert budget.vision == 0
