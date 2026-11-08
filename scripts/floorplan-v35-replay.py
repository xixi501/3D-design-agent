"""Replay captured V3-5 asset and uncertainty gates without model calls."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "agent"))

from actiscape_agent.floorplan_roles import normalize_floorplan_asset_choices
from actiscape_agent.floorplan_v3 import _arbitrate_review


def main():
    replay = json.loads((ROOT / "fixtures/s2c-v3-5-replay.json").read_text())
    catalogue = json.loads((ROOT / "fixtures/catalog.json").read_text())
    r8 = replay["r8"]
    normalized, overrides = normalize_floorplan_asset_choices(
        r8["assetSelection"],
        {"generation": r8},
        catalogue,
    )
    choices = {
        choice["request_index"]: choice["key"] for choice in normalized["choices"]
    }
    assert choices[2] == "sofa"
    assert choices[4] == "cabTall"
    assert choices[1] == "plant"

    reviews = {}
    for name in ("r9", "r10"):
        capture = replay[name]
        review = _arbitrate_review(
            {"passed": True, "summary": "offline replay", "issues": []},
            capture["draft"],
            capture["diagnostics"],
            capture["structureSkeleton"],
        )
        assert review["passed"] is True
        assert not any(
            issue.get("severity") == "blocking" for issue in review["issues"]
        )
        reviews[name] = {
            "passed": review["passed"],
            "blockingIssues": 0,
            "advisoryIssues": sum(
                issue.get("severity") == "advisory" for issue in review["issues"]
            ),
        }
    print(
        json.dumps(
            {
                "passed": True,
                "assetKeys": choices,
                "overrides": overrides,
                "reviews": reviews,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
