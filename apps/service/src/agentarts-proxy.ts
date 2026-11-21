/** Optional AgentArts /invocations forwarding. Local agent remains the default. */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";

export function agentArtsConfigured(): boolean {
  return Boolean(process.env.AGENTARTS_INVOCATIONS_URL?.trim());
}

/** AgentArts 网关要求 1-64 位 [A-Za-z0-9_-] 的会话 ID。 */
function sessionIdOf(value?: string): string {
  const cleaned = (value || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  return cleaned || randomUUID().replace(/-/g, "");
}

export async function forwardAgentArts(
  payload: Record<string, any>,
  signal?: AbortSignal,
  sessionId?: string,
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
      // API Key 版运行时要求带会话头，缺失会被网关拒绝（400 Session ID not found）。
      "X-Hw-Agentarts-Session-Id": session,
    },
    body: JSON.stringify({ action: "run_task", ...payload }),
    signal: signal || timeout,
  });
  let value: any;
  try {
    value = await response.json();
  } catch {
    value = { error: "AGENTARTS_INVALID_RESPONSE", message: "云上返回非 JSON" };
  }
  // 验收证据：记录转发目标、会话、状态码与耗时（不含凭证）。
  console.log(
    `[agentarts] ${new Date().toISOString()} forward status=${response.status} session=${session} ms=${Date.now() - startedAt}`,
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
): any {
  const result = unwrap(upstream) ?? upstream;
  const status =
    upstream?.status ||
    result?.status ||
    (result?.passed === false ? "failed" : "completed");
  const now = new Date().toISOString();
  return {
    id: upstream?.taskId || upstream?.id || `agentarts-${body.requestId}`,
    conversationId,
    projectId: body.projectId,
    requestId: body.requestId,
    input: body.input || "",
    selectedIds: body.selectedIds || [],
    mode: body.mode || "edit",
    status,
    result,
    error: upstream?.error || result?.error || null,
    generation: upstream?.generation || result?.generation || {},
    createdAt: now,
    updatedAt: now,
    cloud: true,
  };
}

export function agentArtsProxy(app: FastifyInstance) {
  app.get(
    "/api/agentarts/status",
    async () => ({
      configured: agentArtsConfigured(),
      endpoint: agentArtsConfigured()
        ? process.env.AGENTARTS_INVOCATIONS_URL
        : null,
    }),
  );
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
      return forwardAgentArts(body, undefined, body.sessionId);
    },
  );
}
