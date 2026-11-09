import os
import platform
import subprocess
from functools import lru_cache
from importlib.metadata import version
from urllib.parse import urlparse

from .config import (
    FLOORPLAN_RECOGNITION_OPTIONS,
    FLOORPLAN_REVIEW_OPTIONS,
    ROOT,
    model_settings,
    vision_model_settings,
)


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
        "floorplanReviewOptions": FLOORPLAN_REVIEW_OPTIONS,
        "floorplanPromptVersion": "s2c-floorplan-v4-2",
        "floorplanToolAdapter": "hpd-adapter-6-1",
        "floorplanVisionConfigVersion": "vision-furniture-2",
        "floorplanVisionProviderRegistry": "actiscape.vision-provider.v1",
        "floorplanVisionProviderIds": ["hpd-adapter-6-1"],
        "floorplanActivityUnitVersion": "activity-unit-1",
        "floorplanScoringVersion": "s2c-6",
        "floorplanVision": {
            key: vision_model_settings()[key]
            for key in ("provider", "model", "base_url", "max_tokens", "timeout")
        },
        "floorplanUpdateContract": "discriminated-commands-2",
        "floorplanToolSource": "b94183f9ce2215db9a178da89a90d2ecefb18497",
        "skillPoolSchema": "actiscape.skill-pool.v1",
        "skillPoolVersion": "2026-11-09",
        "pillow": version("Pillow"),
        "opencv": version("opencv-python-headless"),
        "promptVersion": "s2a-local-edit-3",
        "generationPromptVersion": "s2b-rectangular-3",
    }
