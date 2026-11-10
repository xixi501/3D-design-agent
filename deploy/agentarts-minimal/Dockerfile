FROM python:3.13-slim
WORKDIR /app
COPY apps/agent /app/apps/agent
RUN python -m pip install --no-cache-dir -r apps/agent/requirements.lock -e apps/agent
COPY deploy/agentarts-minimal/agent.py /app/agent.py
COPY deploy/agentarts-minimal/app.py /app/app.py
COPY deploy/agentarts-minimal/task_runtime.py /app/task_runtime.py
ENV AGENT_RUN_PORT=8080 RUNTIME_PORT=8080 RUNTIME_HOST=0.0.0.0
EXPOSE 8080
CMD ["python", "app.py"]
