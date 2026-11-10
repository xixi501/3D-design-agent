import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[3]
load_dotenv(ROOT / ".env", override=False)

# Whole-floor image recognition needs room for both thinking and the geometry
# result. Pixel extraction disables thinking: both high and low effort exhausted
# 32K reasoning tokens on a real plan before returning geometry.
# Other roles retain the previously verified high-effort/8K/120s defaults. The
# shared 24-request/600s task budget still applies to every role and retry.
FLOORPLAN_RECOGNITION_OPTIONS = {
    "max_tokens": 32768,
    "timeout": 180,
    "reasoning_effort": "low",
    "extra_body": {"thinking": {"type": "disabled"}},
}

# The review role is an evidence checklist, not an open-ended planner. Do not
# let a hidden reasoning turn consume the entire output allowance.
FLOORPLAN_REVIEW_OPTIONS = {
    "max_tokens": 16384,
    "timeout": 180,
    "reasoning_effort": "low",
    "extra_body": {"thinking": {"type": "disabled"}},
}

# Furniture semantics use a separate grounding-capable VLM. The model is
# intentionally scoped to contour selection; deterministic code still owns
# geometry, room membership and ownership.
FLOORPLAN_VISION_OPTIONS = {
    "max_tokens": 8192,
    "timeout": 180,
    "temperature": 0,
}


def state_directory() -> Path:
    base = Path(os.environ.get("ACTISCAPE_DATA_DIR", str(ROOT / "data")))
    path = Path(os.environ.get("ACTISCAPE_AGENT_DATA_DIR", str(base / "agent")))
    path.mkdir(parents=True, exist_ok=True)
    return path


def scene_url() -> str:
    return os.environ.get("ACTISCAPE_SCENE_URL", "http://127.0.0.1:3001").rstrip("/")


def model_api_key() -> str:
    """DeepSeek first, official AgentArts MODEL_API_KEY fallback."""
    return (
        os.environ.get("DEEPSEEK_API_KEY")
        or os.environ.get("MODEL_API_KEY")
        or ""
    )


def _thinking_enabled(base_url: str) -> bool:
    explicit = os.environ.get("DEEPSEEK_THINKING", "").strip().lower()
    if explicit in ("enabled", "true", "1", "yes"):
        return True
    if explicit in ("disabled", "false", "0", "no"):
        return False
    # MaaS/OpenAI-compatible endpoints do not accept DeepSeek's private
    # thinking field; only enable it for the DeepSeek official host.
    return "deepseek.com" in base_url.lower()


def model_settings() -> dict:
    base_url = (
        os.environ.get("DEEPSEEK_BASE_URL")
        or os.environ.get("MODEL_URL")
        or "https://api.deepseek.com"
    ).rstrip("/")
    settings = {
        "model": (
            os.environ.get("DEEPSEEK_MODEL")
            or os.environ.get("MODEL_NAME")
            or "deepseek-flash"
        ),
        "base_url": base_url,
        "reasoning_effort": os.environ.get("DEEPSEEK_REASONING_EFFORT", "high"),
        "timeout": 120,
        "max_retries": 0,
        "max_tokens": 8192,
        "extra_body": (
            {"thinking": {"type": "enabled"}}
            if _thinking_enabled(base_url)
            else {}
        ),
    }
    key = model_api_key()
    if key:
        settings["api_key"] = key
    return settings


def vision_model_settings() -> dict:
    return {
        "provider": os.environ.get("ACTISCAPE_VISION_PROVIDER", "local-vllm"),
        "model": os.environ.get("ACTISCAPE_VISION_MODEL", "Qwen/Qwen3-VL-32B-Instruct-FP8"),
        "base_url": os.environ.get("ACTISCAPE_VISION_BASE_URL", "http://127.0.0.1:3003/v1").rstrip(
            "/"
        ),
        "api_key": os.environ.get("ACTISCAPE_VISION_API_KEY", "local"),
        **FLOORPLAN_VISION_OPTIONS,
    }
