import json
import re
from pathlib import Path

import pytest
from pydantic import ValidationError

from actiscape_agent.skill_registry import (
    ALLOWED_CAPABILITIES,
    SkillManifest,
    SkillRegistry,
    SkillSelection,
)
from actiscape_agent.store import TaskError, public_skill_bundle

ROOT = Path(__file__).resolve().parents[1] / "actiscape_agent" / "skills"
MEMBER3_ACTIVE = {
    "living-dining-small",
    "living-dining-open",
    "social-reading-zone",
    "style-coherence",
    "lighting-color",
    "floorplan-intake",
    "layout-check-repair",
}


def test_pool_is_strict_v1_and_active_allowlist_is_exact():
    registry = SkillRegistry(ROOT)
    snapshots = registry.all()
    assert len(snapshots) == 32
    assert all(item["schemaVersion"] == "actiscape.skill.v1" for item in snapshots)
    assert all(set(item["capabilities"]).issubset(ALLOWED_CAPABILITIES) for item in snapshots)
    active = {
        item["id"]
        for item in snapshots
        if item["activation"] == "active" and item["status"] == "verified"
    }
    assert active == MEMBER3_ACTIVE | {
        "rectangular-living-reading",
        "floorplan-reconstruction",
    }
    reserved = {item["id"] for item in snapshots if item["activation"] == "reserved"}
    assert len(reserved) == 23
    assert "photo-object-import" in reserved
    summary = registry.pool_summary()
    assert summary["skills"] == 32
    assert summary["active"] == 9
    assert summary["reserved"] == 23


def test_all_member3_cases_use_real_catalogue_keys():
    repo = ROOT.parents[3]
    catalogue = json.loads((repo / "fixtures/catalog.json").read_text())
    known = set(catalogue)
    cases = 0
    unknown = []
    for path in ROOT.glob("*/examples/*/ops.json"):
        value = json.loads(path.read_text())
        cases += 1
        for item in (value.get("scene") or {}).get("objects", []):
            if item.get("key") not in known:
                unknown.append((path, item.get("key")))
        for edit in value.get("edits", []):
            key = (edit.get("object") or {}).get("key")
            if key is not None and key not in known:
                unknown.append((path, key))
    assert cases == 60
    assert unknown == []


def test_frontmatter_and_manifest_versions_do_not_drift():
    for path in ROOT.glob("*/manifest.json"):
        manifest = json.loads(path.read_text())
        content = (path.parent / "SKILL.md").read_text()

        def metadata(key):
            match = re.search(
                rf'^  {re.escape(key)}:\s*"?([^\n"]+)"?',
                content,
                re.MULTILINE,
            )
            return match.group(1).strip() if match else None

        for key in ("version", "status", "kind", "activation"):
            assert metadata(key) == str(manifest[key]), (path.parent.name, key)


def test_shortlist_uses_mode_room_area_and_verified_status():
    registry = SkillRegistry(ROOT)
    small = registry.candidates(
        "generate_rectangular",
        project_state="empty",
        room_kind="living_dining",
        area_m2=18,
    )
    assert [item["id"] for item in small["primary"]] == [
        "living-dining-small",
        "rectangular-living-reading",
    ]
    open_room = registry.candidates(
        "generate_rectangular",
        project_state="empty",
        room_kind="living_dining",
        area_m2=40,
    )
    assert [item["id"] for item in open_room["primary"]] == [
        "living-dining-open",
        "rectangular-living-reading",
    ]
    reading = registry.candidates(
        "generate_rectangular",
        project_state="empty",
        room_kind="reading_lounge",
        area_m2=20,
    )
    assert [item["id"] for item in reading["primary"]] == ["rectangular-living-reading"]
    edit = registry.candidates(
        "edit",
        project_state="existing",
        room_kind="living_room",
        area_m2=20,
    )
    assert [item["id"] for item in edit["primary"]] == ["social-reading-zone"]
    assert {item["id"] for item in edit["modifiers"]} == {
        "lighting-color",
        "style-coherence",
    }


def test_selection_is_bounded_and_reserved_is_not_selectable():
    registry = SkillRegistry(ROOT)
    candidates = registry.candidates(
        "generate_rectangular",
        project_state="empty",
        room_kind="living_dining",
        area_m2=18,
    )
    with pytest.raises(TaskError, match="主 Skill"):
        registry.validate_selection(
            {"primarySkillId": "master-bedroom", "modifierSkillIds": []},
            candidates,
            mode="generate_rectangular",
        )
    with pytest.raises(ValidationError):
        SkillSelection.model_validate(
            {
                "primarySkillId": "living-dining-small",
                "modifierSkillIds": ["style-coherence", "lighting-color", "pet-friendly"],
            }
        )
    with pytest.raises(TaskError, match="modifier"):
        registry.validate_selection(
            {"primarySkillId": None, "modifierSkillIds": ["style-coherence"]},
            candidates,
            mode="generate_rectangular",
            allow_no_primary=True,
        )


def test_bundle_pins_content_judgements_and_public_view_hides_body():
    registry = SkillRegistry(ROOT)
    selection = registry.validate_selection(
        {
            "primarySkillId": "living-dining-small",
            "modifierSkillIds": ["style-coherence", "lighting-color"],
            "reason": "18 平方米客餐厅，明确风格与照明要求",
        },
        registry.candidates(
            "generate_rectangular",
            project_state="empty",
            room_kind="living_dining",
            area_m2=18,
        ),
        mode="generate_rectangular",
    )
    bundle = registry.compose(
        mode="generate_rectangular",
        selection=selection,
        include_intake=True,
        include_repair=True,
    )
    assert bundle["primary"]["id"] == "living-dining-small"
    assert [item["id"] for item in bundle["modifiers"]] == [
        "style-coherence",
        "lighting-color",
    ]
    assert bundle["intake"]["id"] == "floorplan-intake"
    assert bundle["repair"]["id"] == "layout-check-repair"
    assert bundle["judgements"]
    assert len(bundle["contentHash"]) == 64
    context = registry.context(bundle)
    assert [item["role"] for item in context["instructions"]] == [
        "intake",
        "primary",
        "modifier",
        "modifier",
        "repair",
    ]
    public = public_skill_bundle(bundle)
    assert public["primary"]["id"] == "living-dining-small"
    assert "content" not in public["primary"]
    assert "judgementsData" not in public["primary"]
    assert "licenseText" not in public["primary"]


def test_manifest_rejects_direct_scene_write_capability():
    manifest = json.loads((ROOT / "living-dining-small" / "manifest.json").read_text())
    manifest["capabilities"] = [*manifest["capabilities"], "scene.write"]
    with pytest.raises(ValidationError, match="禁止能力"):
        SkillManifest.model_validate(manifest)


def test_invalid_pinned_bundle_fails_closed():
    registry = SkillRegistry(ROOT)
    with pytest.raises(TaskError, match="bundle"):
        registry.context({"schemaVersion": "actiscape.skill-bundle.v1"})


def test_legacy_snapshot_reader_still_accepts_historical_floorplan_skill():
    from actiscape_agent.skill_registry import load_legacy_floorplan_skill

    snapshot = load_legacy_floorplan_skill()
    assert snapshot["id"] == "floorplan-reconstruction"
    assert len(snapshot["contentHash"]) == 64
