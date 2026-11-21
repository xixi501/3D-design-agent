/** Optional AgentArts /invocations forwarding. Local agent remains the default. */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { CloudTaskRecord } from "./cloud-task-store.js";

export function agentArtsConfigured(): boolean {
  return Boolean(process.env.AGENTARTS_INVOCATIONS_URL?.trim());
}

/** AgentArts 网关要求 1-64 位 [A-Za-z0-9_-] 的会话 ID。 */
export function sessionIdOf(value?: string): string {
  const cleaned = (value || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  return cleaned || randomUUID().replace(/-/g, "");
}

export async function forwardAgentArts(
  payload: Record<string, any>,
  signal?: AbortSignal,
  sessionId?: string,
  action: string = "run_task",
): Promise<any> {
  const endpoint = process.env.AGENTARTS_INVOCATIONS_URL?.trim();
  if (!endpoint)
    throw Object.assign(new Error("AGENTARTS_NOT_CONFIGURED"), {
      statusCode: 503,
    });
  const timeout = AbortSignal.timeout(
    Number(process.env.AGENTARTS_TIMEOUT_MS || 300_000),
  );
  const session = sessionIdOf(sessionId);
  const startedAt = Date.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.AGENTARTS_BEARER_TOKEN
        ? { Authorization: `Bearer ${process.env.AGENTARTS_BEARER_TOKEN}` }
        : {}),
      "X-Hw-Agentarts-Session-Id": session,
    },
    body: JSON.stringify({ action, ...payload }),
    signal: signal || timeout,
  });
  let value: any;
  try {
    value = await response.json();
  } catch {
    value = { error: "AGENTARTS_INVALID_RESPONSE", message: "云上返回非 JSON" };
  }
  console.log(
    `[agentarts] ${new Date().toISOString()} forward action=${action} status=${response.status} session=${session} ms=${Date.now() - startedAt}`,
  );
  if (!response.ok)
    throw Object.assign(
      new Error(value?.message || `AgentArts HTTP ${response.status}`),
      { statusCode: 502, details: value },
    );
  return value;
}

function unwrap(value: any): any {
  let current = value;
  for (let i = 0; i < 4; i++) {
    const next =
      current?.result ?? current?.output ?? current?.response ?? current?.data;
    if (next === undefined || next === current) break;
    current = next;
  }
  return current;
}

export function cloudTask(
  upstream: any,
  body: any,
  conversationId: string,
  existing?: CloudTaskRecord,
): CloudTaskRecord {
  const result = unwrap(upstream) ?? upstream;
  const status =
    upstream?.status ||
    result?.status ||
    (result?.passed === false ? "failed" : "completed");
  const now = new Date().toISOString();
  const sessionId = existing?.sessionId || sessionIdOf(conversationId);
  return {
    id:
      upstream?.taskId ||
      upstream?.id ||
      existing?.id ||
      `agentarts-${body.requestId || randomUUID()}`,
    conversationId,
    projectId: body.projectId || existing?.projectId || "",
    sessionId,
    requestId: body.requestId || existing?.requestId || randomUUID(),
    input: body.input ?? existing?.input ?? "",
    selectedIds: body.selectedIds || existing?.selectedIds || [],
    mode: upstream?.mode || body.mode || existing?.mode || "edit",
    status,
    result,
    error: upstream?.error ?? result?.error ?? null,
    generation: upstream?.generation || result?.generation || existing?.generation || {},
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    cloud: true,
  };
}

export function agentArtsProxy(app: FastifyInstance) {
  app.get("/api/agentarts/status", async () => ({
    configured: agentArtsConfigured(),
    endpoint: agentArtsConfigured()
      ? process.env.AGENTARTS_INVOCATIONS_URL
      : null,
  }));
  app.post(
    "/api/agentarts/run",
    {
      schema: {
        description:
          "Forward a standard run_task payload to AgentArts /invocations; returns the runtime result unchanged.",
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req) => {
      const body = (req.body || {}) as Record<string, any>;
      return forwardAgentArts(
        body,
        undefined,
        body.sessionId,
        body.action || "run_task",
      );
    },
  );
}
