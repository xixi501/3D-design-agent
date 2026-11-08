"""Replay captured V3-6 room-label consolidation without model calls."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "agent"))

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
    print(
        json.dumps(
            {
                "passed": True,
                "rooms": rooms,
                "targetRoomIds": target_ids,
                "notes": notes,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
