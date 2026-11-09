"""Fail closed when a vision provider touches evaluation-only evidence."""

from __future__ import annotations

import os
from pathlib import Path


class EvidenceAccessDenied(PermissionError):
    pass


class EvidenceAccessGuard:
    def __init__(self, forbidden_roots: list[Path]):
        self.forbidden_roots = tuple(
            root.resolve() for root in forbidden_roots if root.exists() or root.is_absolute()
        )
        self.attempts: list[str] = []

    def is_forbidden(self, value: object) -> bool:
        if not isinstance(value, (str, bytes, os.PathLike)):
            return False
        try:
            path = Path(os.path.abspath(os.fsdecode(value)))
        except (OSError, ValueError, TypeError):
            return False
        return any(path == root or root in path.parents for root in self.forbidden_roots)

    def audit(self, event: str, args: tuple[object, ...]):
        if event not in {
            "open",
            "os.open",
            "os.listdir",
            "os.scandir",
            "os.stat",
            "pathlib.Path.open",
        }:
            return
        for value in args[:2]:
            if not self.is_forbidden(value):
                continue
            rendered = str(value)[:500]
            if len(self.attempts) < 20:
                self.attempts.append(rendered)
            raise EvidenceAccessDenied(f"EVIDENCE_ACCESS_DENIED: {rendered}")

    def install(self):
        import sys

        sys.addaudithook(self.audit)

    def report(self):
        return {
            "referenceAccess": "denied-and-audited",
            "forbiddenRootCount": len(self.forbidden_roots),
            "attemptCount": len(self.attempts),
        }
