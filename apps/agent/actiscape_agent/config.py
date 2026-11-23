import os
from pathlib import Path

from dotenv import load_dotenv

_HERE = Path(__file__).resolve()
ROOT = _HERE.parents[3] if len(_HERE.parents) > 3 else _HERE.parents[1]
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
    return os.environ.get("DEEPSEEK_API_KEY") or os.environ.get("MODEL_API_KEY") or ""


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
            os.environ.get("DEEPSEEK_MODEL") or os.environ.get("MODEL_NAME") or "deepseek-flash"
        ),
        "base_url": base_url,
        "reasoning_effort": os.environ.get("DEEPSEEK_REASONING_EFFORT", "high"),
        "timeout": 120,
        "max_retries": 0,
        "max_tokens": 8192,
        "extra_body": ({"thinking": {"type": "enabled"}} if _thinking_enabled(base_url) else {}),
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


FAST_ROLES = frozenset({"main", "policy", "assets", "structure", "coordinator", "check"})


def _is_vision_capable_model(model_name: str) -> bool:
    low = str(model_name or "").lower()
    return any(tag in low for tag in ("vl", "omni", "vision", "4o"))


def fallback_model_settings() -> dict | None:
    """Optional text-model fallback (e.g. Aliyun Bailian qwen-plus) when primary times out/errors."""
    fb_model = os.environ.get("ACTISCAPE_FALLBACK_MODEL", "").strip()
    if not fb_model:
        return None
    is_qwen_fb = "qwen" in fb_model.lower()
    vision_base = os.environ.get("ACTISCAPE_VISION_BASE_URL", "").strip()
    base_url = (
        os.environ.get("ACTISCAPE_FALLBACK_BASE_URL")
        or (vision_base if (is_qwen_fb and "dashscope" in vision_base.lower()) else "")
        or os.environ.get("DEEPSEEK_BASE_URL")
        or os.environ.get("MODEL_URL")
        or "https://dashscope.aliyuncs.com/compatible-mode/v1"
    ).rstrip("/")
    api_key = (
        os.environ.get("ACTISCAPE_FALLBACK_API_KEY")
        or (os.environ.get("ACTISCAPE_VISION_API_KEY") if (is_qwen_fb and "dashscope" in base_url.lower()) else "")
        or model_api_key()
        or os.environ.get("ACTISCAPE_VISION_API_KEY")
        or ""
    )
    settings: dict = {
        "model": fb_model,
        "base_url": base_url,
        "reasoning_effort": "low",
        "timeout": 90,
        "max_retries": 0,
        "max_tokens": 8192,
        "extra_body": {} if "deepseek.com" in base_url.lower() else {"enable_thinking": False},
    }
    if api_key:
        settings["api_key"] = api_key
    return settings


def role_model_options(
    role: str,
    *,
    has_images: bool = False,
    overrides: dict | None = None,
) -> dict:
    """Resolve tiered model, endpoint, and reasoning effort per agent role.

    - Image-bearing requests ALWAYS route to ACTISCAPE_VISION_MODEL (e.g. qwen3-vl-plus)
      with full base_url + api_key switch whenever configured, regardless of text provider.
    - Pure-text `design` role uses high reasoning effort for complex spatial layout.
    - Pure-text fast roles (`main`, `policy`, `assets`, `structure`, `coordinator`, `check`)
      use low reasoning effort (and disable thinking on non-deepseek.com hosts like DashScope)
      for 2-3x faster, lower-cost execution.
    """
    opts = dict(model_settings())
    if has_images:
        vision_model_env = os.environ.get("ACTISCAPE_VISION_MODEL", "").strip()
        if vision_model_env or not _is_vision_capable_model(opts.get("model", "")):
            v = vision_model_settings()
            # Only switch endpoint when vision env is explicitly configured (not default local-vllm dummy)
            if vision_model_env or os.environ.get("ACTISCAPE_VISION_BASE_URL", "").strip():
                opts["model"] = v["model"]
                opts["base_url"] = v["base_url"]
                if v.get("api_key"):
                    opts["api_key"] = v["api_key"]
                opts["reasoning_effort"] = "low"
                eb = dict(opts.get("extra_body") or {})
                eb.pop("thinking", None)
                if "deepseek.com" not in str(v["base_url"]).lower():
                    eb["enable_thinking"] = False
                opts["extra_body"] = eb
    elif role == "design":
        design_effort = (
            os.environ.get("DEEPSEEK_DESIGN_REASONING_EFFORT", "").strip()
            or os.environ.get("DEEPSEEK_REASONING_EFFORT", "high")
        )
        opts["reasoning_effort"] = design_effort
    elif role in FAST_ROLES:
        is_non_official = "deepseek.com" not in str(opts.get("base_url", "")).lower()
        if is_non_official:
            explicit_fast = os.environ.get("DEEPSEEK_FAST_REASONING_EFFORT", "").strip()
            opts["reasoning_effort"] = explicit_fast or "low"
            eb = dict(opts.get("extra_body") or {})
            eb.pop("thinking", None)
            eb["enable_thinking"] = False
            opts["extra_body"] = eb

    if overrides:
        # Merge caller overrides while preserving extra_body keys cleanly
        merged_eb = {
            **dict(opts.get("extra_body") or {}),
            **dict(overrides.get("extra_body") or {}),
        }
        opts.update(overrides)
        if merged_eb:
            opts["extra_body"] = merged_eb
    return opts
