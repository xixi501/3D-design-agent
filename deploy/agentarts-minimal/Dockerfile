FROM python:3.13.13-slim
WORKDIR /app
COPY apps/agent /app/apps/agent
RUN python -m pip install --no-cache-dir -r apps/agent/requirements.lock -e apps/agent
COPY deploy/agentarts-minimal/agent.py /app/agent.py
ENV RUNTIME_HOST=0.0.0.0 RUNTIME_PORT=8080
EXPOSE 8080
CMD ["python", "agent.py"]
