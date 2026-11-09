import pytest

from actiscape_agent.floorplan_vision.evidence_guard import (
    EvidenceAccessDenied,
    EvidenceAccessGuard,
)


def test_evidence_guard_denies_forbidden_descendants(tmp_path):
    forbidden = tmp_path / "evaluation"
    forbidden.mkdir()
    target = forbidden / "answer.evaluation-only.json"
    target.write_text("{}")
    guard = EvidenceAccessGuard([forbidden])

    with pytest.raises(EvidenceAccessDenied):
        guard.audit("open", (str(target), "r"))
    assert guard.report()["attemptCount"] == 1


def test_evidence_guard_allows_unrelated_source_files(tmp_path):
    forbidden = tmp_path / "evaluation"
    forbidden.mkdir()
    allowed = tmp_path / "source" / "provider.py"
    allowed.parent.mkdir()
    allowed.write_text("")
    guard = EvidenceAccessGuard([forbidden])

    guard.audit("open", (str(allowed), "r"))
    assert guard.report()["attemptCount"] == 0
