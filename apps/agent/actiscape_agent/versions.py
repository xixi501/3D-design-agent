import os
import platform
import subprocess
from functools import lru_cache
from importlib.metadata import version

from .config import ROOT, model_settings


@lru_cache(maxsize=1)
def runtime_versions():
    code = os.environ.get("ACTISCAPE_CODE_VERSION", "")
    dirty = None
    if not code:
        try:
            code = subprocess.check_output(
                ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, timeout=3
            ).strip()
            dirty = bool(
                subprocess.check_output(
                    [
                        "git",
                        "status",
                        "--porcelain",
                        "--",
                        "apps/agent",
                        "apps/service",
                        "packages/scene-core",
                        "apps/editor",
                    ],
                    cwd=ROOT,
                    text=True,
                    timeout=3,
                ).strip()
            )
        except (OSError, subprocess.SubprocessError):
            code = "unrecorded"
    return {
        "codeCommit": code,
        "workingTreeModified": dirty,
        "python": platform.python_version(),
        "langgraph": version("langgraph"),
        "langchain": version("langchain"),
        "deepseekAdapter": version("langchain-deepseek"),
        "model": model_settings()["model"],
        "reasoningEffort": model_settings()["reasoning_effort"],
        "tools": "scene-candidate-v2",
        "promptVersion": "s2a-local-edit-1",
        "generationPromptVersion": "s2b-rectangular-2",
    }
