import os
import platform
import subprocess
from functools import lru_cache
from importlib.metadata import version
from urllib.parse import urlparse

from .config import FLOORPLAN_RECOGNITION_OPTIONS, ROOT, model_settings


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
        "deepseekProtocolAdapter": "auto-tools+tool-images-2",
        "model": model_settings()["model"],
        "modelProvider": urlparse(model_settings()["base_url"]).netloc,
        "reasoningEffort": model_settings()["reasoning_effort"],
        "tools": "scene-candidate-v3",
        "structuredOutputRecovery": "one-bounded-continuation-1",
        "modelConfigVersion": "per-role-output-budget-3",
        "floorplanRecognitionOptions": FLOORPLAN_RECOGNITION_OPTIONS,
        "floorplanPromptVersion": "s2c-floorplan-v2-1",
        "floorplanToolAdapter": "hpd-adapter-3",
        "floorplanUpdateContract": "discriminated-commands-2",
        "floorplanToolSource": "b94183f9ce2215db9a178da89a90d2ecefb18497",
        "pillow": version("Pillow"),
        "opencv": version("opencv-python-headless"),
        "promptVersion": "s2a-local-edit-2",
        "generationPromptVersion": "s2b-rectangular-2",
    }
