"""Official AgentArts CLI entrypoint alias: agentarts configure --entrypoint app:app."""

import os

from agent import app, handler  # noqa: F401 - re-exported SDK app/entrypoint

if __name__ == "__main__":
    app.run(
        host=os.environ.get("RUNTIME_HOST", "0.0.0.0"),
        port=int(
            os.environ.get("AGENT_RUN_PORT")
            or os.environ.get("RUNTIME_PORT")
            or "8080"
        ),
    )
