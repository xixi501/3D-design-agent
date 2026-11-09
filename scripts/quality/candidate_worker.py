"""Isolated floorplan candidate worker used by production-like quality runs."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from evidence_guard import EvidenceAccessGuard


def main():
    forbidden = os.environ.get("ACTISCAPE_FORBIDDEN_EVIDENCE_ROOT")
    if not forbidden:
        raise RuntimeError("缺少候选证据隔离根目录")
    guard = EvidenceAccessGuard([Path(forbidden)])
    guard.install()

    raw = sys.stdin.buffer.read()
    payload = json.loads(raw)
    from actiscape_agent.floorplan_upstream import process

    result = process(payload)
    result["_qualityGuard"] = guard.report()
    json.dump(result, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - process boundary returns bounded JSON
        json.dump(
            {
                "error": type(error).__name__,
                "message": str(error)[-1000:],
            },
            sys.stdout,
            ensure_ascii=False,
        )
        sys.exit(1)
