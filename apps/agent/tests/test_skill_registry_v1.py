import json
import re
import shutil
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
    assert len(snapshots) == 33
    assert all(item["schemaVersion"] == "actiscape.skill.v1" for item in snapshots)
    assert all(set(item["capabilities"]).issubset(ALLOWED_CAPABILITIES) for item in snapshots)
    active = {
        item["id"]
        for item in snapshots
        if item["activation"] == "active" and item["status"] == "verified"
    }
    whole_home = {
        "master-bedroom",
        "guest-bedroom",
        "home-office",
        "kitchen-line-l-u",
        "bathroom-standard",
        "entry-storage",
    }
    assert (
        active
        == MEMBER3_ACTIVE
        | {
            "rectangular-living-reading",
            "floorplan-reconstruction",
            "photo-object-import",
            "universal-spatial-base",
        }
        | whole_home
    )
    reserved = {item["id"] for item in snapshots if item["activation"] == "reserved"}
    assert len(reserved) == 16
    assert "photo-object-import" in active
    summary = registry.pool_summary()
    assert summary["skills"] == 33
    assert summary["active"] == 17
    assert summary["reserved"] == 16
    judgements = json.loads((ROOT / "_framework" / "judgements.v1.json").read_text())
    assert judgements["schemaVersion"] == "actiscape.judgements.v1"
    assert len(judgements["judgements"]) == 69
    assert "items" not in judgements


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
    for room_kind, skill_id, area in (
        ("bedroom", "master-bedroom", 14),
        ("bedroom", "guest-bedroom", 9),
        ("study", "home-office", 8),
        ("kitchen", "kitchen-line-l-u", 6),
        ("bathroom", "bathroom-standard", 4),
        ("entry", "entry-storage", 3),
    ):
        shortlist = registry.candidates(
            "generate_rectangular",
            project_state="empty",
            room_kind=room_kind,
            area_m2=area,
        )
        assert skill_id in {item["id"] for item in shortlist["primary"]}
    # Small service rooms (kitchen / bathroom / entry / hallway) must still
    # receive the general style and lighting modifiers; otherwise a model that
    # selects them is rejected even though the advice applies.
    for room_kind, area in (
        ("kitchen", 7.2),
        ("bathroom", 4.5),
        ("entry", 3.8),
    ):
        small = registry.candidates(
            "generate_rectangular",
            project_state="empty",
            room_kind=room_kind,
            area_m2=area,
        )
        assert {"style-coherence", "lighting-color"} <= {
            item["id"] for item in small["modifiers"]
        }, room_kind
    asset = registry.candidates(
        "asset_import",
        project_state="existing",
        room_kind="any",
        area_m2=20,
    )
    assert [item["id"] for item in asset["primary"]] == ["photo-object-import"]
    assert asset["modifiers"] == []
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
    assert bundle["pendingRepair"] is None
    assert bundle["judgements"]
    assert len(bundle["contentHash"]) == 64
    context = registry.context(bundle)
    assert [item["role"] for item in context["instructions"]] == [
        "universal",
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


def test_repair_is_loaded_from_the_task_snapshot_after_files_change(tmp_path):
    root = tmp_path / "skills"
    shutil.copytree(ROOT, root)
    registry = SkillRegistry(root)
    selection = registry.validate_selection(
        {
            "primarySkillId": "living-dining-small",
            "modifierSkillIds": [],
            "reason": "snapshot test",
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
    )
    assert bundle["repair"] is None
    assert [item["role"] for item in registry.context(bundle)["instructions"]] == [
        "universal",
        "intake",
        "primary",
    ]
    pinned = {
        "universal": bundle["universal"],
        "primary": bundle["primary"],
        "intake": bundle["intake"],
        "repair": bundle["pendingRepair"],
    }

    for skill_id in ("living-dining-small", "floorplan-intake", "layout-check-repair"):
        path = root / skill_id / "SKILL.md"
        path.write_text(path.read_text() + "\nFUTURE VERSION MUST NOT LEAK\n")

    resumed = SkillRegistry(root)
    repaired = resumed.with_repair(bundle, "generate_rectangular")
    assert repaired["universal"] == pinned["universal"]
    assert repaired["primary"] == pinned["primary"]
    assert repaired["intake"] == pinned["intake"]
    assert repaired["repair"] == pinned["repair"]
    context = resumed.context(repaired)
    assert [item["role"] for item in context["instructions"]] == [
        "universal",
        "intake",
        "primary",
        "repair",
    ]
    assert all(
        "FUTURE VERSION MUST NOT LEAK" not in item["content"] for item in context["instructions"]
    )


def test_manifest_rejects_direct_scene_write_capability():
    manifest = json.loads((ROOT / "living-dining-small" / "manifest.json").read_text())
    manifest["capabilities"] = [*manifest["capabilities"], "scene.write"]
    with pytest.raises(ValidationError, match="禁止能力"):
        SkillManifest.model_validate(manifest)


def test_active_skill_bodies_do_not_claim_undeclared_capabilities():
    registry = SkillRegistry(ROOT)
    for snapshot in registry.all():
        if snapshot["activation"] != "active":
            continue
        referenced = {
            capability for capability in ALLOWED_CAPABILITIES if capability in snapshot["content"]
        }
        assert referenced <= set(snapshot["capabilities"]), (
            snapshot["id"],
            sorted(referenced - set(snapshot["capabilities"])),
        )


def test_invalid_pinned_bundle_fails_closed():
    registry = SkillRegistry(ROOT)
    with pytest.raises(TaskError, match="bundle"):
        registry.context({"schemaVersion": "actiscape.skill-bundle.v1"})


def test_legacy_snapshot_reader_still_accepts_historical_floorplan_skill():
    from actiscape_agent.skill_registry import load_legacy_floorplan_skill

    snapshot = load_legacy_floorplan_skill()
    assert snapshot["id"] == "floorplan-reconstruction"
    assert len(snapshot["contentHash"]) == 64


def test_photo_asset_skill_is_composable_for_asset_import():
    registry = SkillRegistry(ROOT)
    candidates = registry.candidates(
        "asset_import",
        project_state="existing",
        room_kind="any",
        area_m2=20,
    )
    selection = registry.validate_selection(
        {"primarySkillId": "photo-object-import", "modifierSkillIds": []},
        candidates,
        mode="asset_import",
    )
    bundle = registry.compose(mode="asset_import", selection=selection)
    assert bundle["primary"]["id"] == "photo-object-import"
    assert bundle["primary"]["status"] == "verified"
    assert bundle["primary"]["activation"] == "active"
    assert bundle["primary"]["appliesTo"]["modes"] == ["asset_import"]


def test_universal_base_is_auto_mounted_and_sliced_by_stage():
    registry = SkillRegistry(ROOT)
    selection = registry.validate_selection(
        {"primarySkillId": "master-bedroom", "modifierSkillIds": []},
        registry.candidates(
            "generate_rectangular",
            project_state="empty",
            room_kind="bedroom",
            area_m2=14,
        ),
        mode="generate_rectangular",
    )
    bundle = registry.compose(
        mode="generate_rectangular",
        selection=selection,
        include_intake=False,
    )
    assert bundle["universal"]["id"] == "universal-spatial-base"
    assert bundle["universal"]["priors"]["defaults"]["doorClearanceMm"] == 800
    assert bundle["intake"] is None

    asset = registry.slice_for_stage(bundle, "asset")
    layout = registry.slice_for_stage(bundle, "layout")
    check = registry.slice_for_stage(bundle, "check")
    repair = registry.slice_for_stage(bundle, "repair")
    assert asset["stage"] == "asset" and layout["stage"] == "layout"
    assert asset["contentHash"] != layout["contentHash"]
    asset_text = "\n".join(item["content"] for item in asset["instructions"])
    layout_text = "\n".join(item["content"] for item in layout["instructions"])
    check_text = "\n".join(item["content"] for item in check["instructions"])
    repair_text = "\n".join(item["content"] for item in repair["instructions"])
    assert "选品与体量" in asset_text
    assert "排布与净空" in layout_text
    assert "OPENABLE_FRONT_BLOCKED" in check_text
    assert "修复顺序" in repair_text
    assert asset_text != layout_text
    assert all(item["id"] for item in asset["instructions"])
    with pytest.raises(TaskError, match="未知 Skill 阶段"):
        registry.slice_for_stage(bundle, "unknown")


def test_active_stage_slices_have_no_fallback():
    registry = SkillRegistry(ROOT)
    primaries = [
        "living-dining-small",
        "living-dining-open",
        "rectangular-living-reading",
        "master-bedroom",
        "guest-bedroom",
        "home-office",
        "kitchen-line-l-u",
        "bathroom-standard",
        "entry-storage",
        "social-reading-zone",
        "photo-object-import",
    ]
    for skill_id in primaries:
        manifest = json.loads((ROOT / skill_id / "manifest.json").read_text())
        mode = manifest["appliesTo"]["modes"][0]
        selection = {"primarySkillId": skill_id, "modifierSkillIds": []}
        bundle = registry.compose(mode=mode, selection=selection, include_intake=False)
        for stage in ("asset", "layout", "check", "repair"):
            sliced = registry.slice_for_stage(bundle, stage)
            assert sliced is not None
            for instruction in sliced["instructions"]:
                assert instruction["fallback"] is False, (
                    skill_id,
                    stage,
                    instruction["id"],
                    instruction["headings"],
                )

    for modifier in ("style-coherence", "lighting-color"):
        bundle = registry.compose(
            mode="generate_rectangular",
            selection={
                "primarySkillId": "master-bedroom",
                "modifierSkillIds": [modifier],
            },
            include_intake=False,
        )
        for stage in ("asset", "layout", "check", "repair"):
            sliced = registry.slice_for_stage(bundle, stage)
            for instruction in sliced["instructions"]:
                assert instruction["fallback"] is False, (
                    modifier,
                    stage,
                    instruction["id"],
                    instruction["headings"],
                )
