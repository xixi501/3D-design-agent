from pathlib import Path
import os
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[3]
load_dotenv(ROOT / ".env", override=False)

def state_directory() -> Path:
    path = Path(os.environ.get("ACTISCAPE_AGENT_DATA_DIR", str(ROOT / "data" / "agent")))
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
