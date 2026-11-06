import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[3]
load_dotenv(ROOT / ".env", override=False)

# Whole-floor image recognition needs room for both thinking and the geometry
# result. Use bounded low effort for pixel extraction: high effort exhausted
# even 32K reasoning tokens on a real plan without returning its result.
# Other roles retain the previously verified high-effort/8K/120s defaults. The
# shared 24-request/600s task budget still applies to every role and retry.
FLOORPLAN_RECOGNITION_OPTIONS = {
    "max_tokens": 32768,
    "timeout": 180,
    "reasoning_effort": "low",
}


def state_directory() -> Path:
    base = Path(os.environ.get("ACTISCAPE_DATA_DIR", str(ROOT / "data")))
    path = Path(os.environ.get("ACTISCAPE_AGENT_DATA_DIR", str(base / "agent")))
    path.mkdir(parents=True, exist_ok=True)
    return path


def scene_url() -> str:
    return os.environ.get("ACTISCAPE_SCENE_URL", "http://127.0.0.1:3001").rstrip("/")


def model_settings() -> dict:
    return {
        "model": os.environ.get("DEEPSEEK_MODEL", "deepseek-flash"),
        "base_url": os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
        "reasoning_effort": os.environ.get("DEEPSEEK_REASONING_EFFORT", "high"),
        "timeout": 120,
        "max_retries": 0,
        "max_tokens": 8192,
        "extra_body": {"thinking": {"type": "enabled"}},
    }
