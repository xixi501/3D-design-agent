"""Subprocess worker for HPD. It returns pixel evidence and has no draft write tool."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from actiscape_agent.floorplan_vision.evidence_guard import EvidenceAccessGuard


def main():
    roots = [
        root
        for root in os.environ.get("ACTISCAPE_FORBIDDEN_EVIDENCE_ROOTS", "").split(os.pathsep)
        if root
    ]
    guard = EvidenceAccessGuard([Path(root) for root in roots])
    guard.install()
    from actiscape_agent.floorplan_upstream import process

    payload = json.loads(sys.stdin.buffer.read())
    response = process(
        {
            "mode": "analyze",
            "adapterVersion": payload.get("adapterVersion", "hpd-adapter-6-1"),
            "parameters": payload.get("parameters") or {},
            "image": payload["image"],
        }
    )
    json.dump(
        {
            "response": response,
            "scope": payload.get("scope"),
            "guard": guard.report(),
        },
        sys.stdout,
        ensure_ascii=False,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - subprocess boundary
        json.dump(
            {
                "error": type(error).__name__,
                "message": str(error)[-1000:],
            },
            sys.stdout,
            ensure_ascii=False,
        )
        sys.exit(1)
