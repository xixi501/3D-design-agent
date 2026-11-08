"""Replay captured V3-6 room-label consolidation without model calls."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "agent"))

from actiscape_agent.floorplan_roles import (
    _arbitrate_candidate_review,
    normalize_floorplan_asset_choices,
)
from actiscape_agent.floorplan_v3 import _consolidate_open_room_labels


def main():
    fixture = json.loads(
        (ROOT / "fixtures/s2c-real/ninety-two.v36-room-merge-replay.json").read_text()
    )
    draft = fixture["draft"]
    rooms, target_ids, notes = _consolidate_open_room_labels(
        draft["walls"],
        draft["rooms"],
        draft["targetRoomIds"],
        draft["image"]["width"],
        draft["image"]["height"],
    )
    expected_rooms = fixture["expected"]["rooms"]
    assert [
        {"id": room["id"], "name": room["name"]} for room in rooms
    ] == expected_rooms
    assert target_ids == fixture["expected"]["targetRoomIds"]
    assert len(notes) == 1
    assert set(notes[0]["objectIds"]) == {
        "r_living_dining",
        "r_entry",
        "r_hall",
    }
    numeric_case = fixture["numericRoomNameCase"]
    numeric_draft = numeric_case["draft"]
    numeric_rooms, numeric_targets, numeric_notes = _consolidate_open_room_labels(
        numeric_draft["walls"],
        numeric_draft["rooms"],
        numeric_draft["targetRoomIds"],
        numeric_draft["image"]["width"],
        numeric_draft["image"]["height"],
    )
    assert [
        {"id": room["id"], "name": room["name"]} for room in numeric_rooms
    ] == numeric_case["expected"]["rooms"]
    assert numeric_targets == numeric_case["expected"]["targetRoomIds"]
    assert len(numeric_notes) == 1
    assert set(numeric_notes[0]["objectIds"]) == {
        "r_dining",
        "r_living",
        "r_entry",
        "r_corridor",
    }
    review_fixture = json.loads(
        (
            ROOT / "fixtures/s2c-real/ninety-two.v36-review-identity-replay.json"
        ).read_text()
    )
    review = _arbitrate_candidate_review(
        review_fixture["review"],
        review_fixture["candidate"]["state"]["plan"],
        review_fixture["candidate"]["checks"],
        review_fixture["sourceReview"],
    )
    assert review["passed"] is True
    assert review["unknownObjectIds"] == []
    assert not [issue for issue in review["issues"] if issue["severity"] == "blocking"]
    asset_fixture = json.loads(
        (ROOT / "fixtures/s2c-real/ninety-two.v36-asset-choice-replay.json").read_text()
    )
    catalogue = json.loads((ROOT / "fixtures/catalog.json").read_text())
    normalized_assets, asset_overrides = normalize_floorplan_asset_choices(
        asset_fixture["selection"],
        {
            "generation": {
                "symbolGroups": asset_fixture["symbolGroups"],
                "compiledSymbols": asset_fixture["compiledSymbols"],
            }
        },
        catalogue,
    )
    sofa_choice = next(
        choice
        for choice in normalized_assets["choices"]
        if choice["request_index"] == 5
    )
    assert sofa_choice["key"] in asset_fixture["expected"]["sofaKeyIn"]
    assert sofa_choice["key"] != asset_fixture["expected"]["sofaKeyNot"]
    print(
        json.dumps(
            {
                "passed": True,
                "rooms": rooms,
                "targetRoomIds": target_ids,
                "notes": notes,
                "numericRoomNameCase": {
                    "taskId": numeric_case["capturedTaskId"],
                    "rooms": numeric_rooms,
                    "targetRoomIds": numeric_targets,
                    "notes": numeric_notes,
                },
                "candidateReview": review,
                "assetChoice": {
                    "taskId": asset_fixture["capturedTaskId"],
                    "sofaKey": sofa_choice["key"],
                    "overrides": asset_overrides,
                },
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
