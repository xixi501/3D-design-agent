import type { FastifyInstance } from "fastify";

/** Same-origin façade; provider credentials and orchestration stay on the server. */
export function agentProxy(app: FastifyInstance) {
  const pending = new Set<AbortController>();
  app.route({
    method: ["GET", "POST"],
    url: "/api/agent/*",
    schema: {
      description:
        "Conversation/task API proxy to the Python LangGraph service",
    },
    handler: async (req, reply) => {
      const abort = new AbortController();
      pending.add(abort);
      const target = new URL(
        req.url.slice("/api/agent".length),
        process.env.ACTISCAPE_AGENT_URL || "http://127.0.0.1:3002",
      );
      const onClose = () => {
        if (!reply.raw.writableEnded) abort.abort();
      };
      reply.raw.on("close", onClose);
      try {
        const upstream = await fetch(target, {
          method: req.method,
          headers: { "content-type": "application/json" },
          ...(req.method === "POST"
            ? { body: JSON.stringify(req.body ?? {}) }
            : {}),
          signal: abort.signal,
        });
        if (
          upstream.headers.get("content-type")?.includes("text/event-stream")
        ) {
          reply.hijack();
          reply.raw.writeHead(upstream.status, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            "x-accel-buffering": "no",
          });
          if (upstream.body) {
            const reader = upstream.body.getReader();
            try {
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                reply.raw.write(value);
              }
            } finally {
              reader.releaseLock();
            }
          }
          reply.raw.end();
        } else
          return reply
            .code(upstream.status)
            .type(upstream.headers.get("content-type") || "application/json")
            .send(await upstream.text());
      } catch {
        if (!reply.raw.headersSent)
          return reply.code(503).send({
            error: "AGENT_UNAVAILABLE",
            message: "Agent 服务尚未启动或连接已中断；手工编辑仍可使用",
          });
        reply.raw.end();
      } finally {
        pending.delete(abort);
        reply.raw.off("close", onClose);
      }
    },
  });
  app.addHook("preClose", async () => {
    for (const abort of pending) abort.abort();
  });
}
