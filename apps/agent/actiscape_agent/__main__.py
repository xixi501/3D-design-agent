import os

import uvicorn

from . import config  # noqa: F401 -- load .env before reading server options

uvicorn.run(
    "actiscape_agent.app:app",
    host=os.environ.get("AGENT_HOST", "127.0.0.1"),
    port=int(os.environ.get("AGENT_PORT", "3002")),
    log_level="info",
)
