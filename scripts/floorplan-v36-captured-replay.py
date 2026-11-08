"""Replay captured V3-6 room-label consolidation without model calls."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "agent"))

from actiscape_agent.floorplan_roles import _arbitrate_candidate_review
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
    print(
        json.dumps(
            {
                "passed": True,
                "rooms": rooms,
                "targetRoomIds": target_ids,
                "notes": notes,
                "candidateReview": review,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
