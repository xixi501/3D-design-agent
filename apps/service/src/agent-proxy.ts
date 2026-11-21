import type { FastifyInstance } from "fastify";
import {
  agentArtsConfigured,
  cloudTask,
  forwardAgentArts,
} from "./agentarts-proxy.js";
import { CloudTaskStore } from "./cloud-task-store.js";
import type { ProjectStore } from "./store.js";

/**
 * Unified Agent Backend Façade.
 * Eliminates cloud/local split-brain by persisting cloud task records locally
 * and routing task polling, SSE events, resume, and cancel to the matching
 * AgentArts session when a task originated in the cloud.
 */
export function agentProxy(app: FastifyInstance, store?: ProjectStore) {
  const pending = new Set<AbortController>();
  const cloudTasks = store ? new CloudTaskStore(store) : undefined;

  app.route({
    method: ["GET", "POST"],
    url: "/api/agent/*",
    schema: {
      description:
        "Conversation/task API proxy to local LangGraph or Huawei Cloud AgentArts",
    },
    handler: async (req, reply) => {
      const pathname = new URL(req.url, "http://service").pathname;
      const body = (req.body || {}) as Record<string, any>;

      // 1. Cloud Task Creation: POST /api/agent/conversations/:cid/tasks
      const convTaskMatch = pathname.match(
        /^\/api\/agent\/conversations\/([^/]+)\/tasks$/,
      );
      if (
        req.method === "POST" &&
        convTaskMatch &&
        agentArtsConfigured() &&
        body.projectId
      ) {
        const conversationId = convTaskMatch[1];
        try {
          const upstream = await forwardAgentArts(
            body,
            undefined,
            conversationId,
            "run_task",
          );
          const record = cloudTask(upstream, body, conversationId);
          cloudTasks?.save(record);
          return reply.code(201).send(record);
        } catch (error: any) {
          return reply.code(error.statusCode || 502).send({
            error: "AGENTARTS_UNAVAILABLE",
            message: error.message || "AgentArts 云端不可用",
            ...(error.details ? { details: error.details } : {}),
          });
        }
      }

      // 2. Cloud Task Lifecycle Routes: GET /tasks/:id, /events, POST /resume, POST /cancel
      const taskRouteMatch = pathname.match(
        /^\/api\/agent\/tasks\/([^/]+)(?:\/(events|resume|cancel))?$/,
      );
      if (taskRouteMatch && cloudTasks) {
        const [, taskId, subAction] = taskRouteMatch;
        const existing = cloudTasks.get(taskId);
        if (existing) {
          if (req.method === "GET" && !subAction) {
            return reply.code(200).send(existing);
          }
          if (req.method === "GET" && subAction === "events") {
            reply.hijack();
            reply.raw.writeHead(200, {
              "content-type": "text/event-stream",
              "cache-control": "no-cache",
              "x-accel-buffering": "no",
            });
            reply.raw.write(
              `event: task\ndata: ${JSON.stringify(existing)}\n\n`,
            );
            reply.raw.end();
            return;
          }
          if (req.method === "POST" && subAction === "cancel") {
            try {
              if (agentArtsConfigured()) {
                await forwardAgentArts(
                  { taskId: existing.id, projectId: existing.projectId },
                  undefined,
                  existing.sessionId,
                  "cancel_task",
                );
              }
            } catch {
              // Even if stateless cloud runtime already exited, release local waiting state
            }
            const cancelled = {
              ...existing,
              status: "cancelled",
              updatedAt: new Date().toISOString(),
            };
            cloudTasks.save(cancelled);
            return reply.code(200).send(cancelled);
          }
          if (req.method === "POST" && subAction === "resume" && agentArtsConfigured()) {
            try {
              const upstream = await forwardAgentArts(
                {
                  taskId: existing.id,
                  projectId: existing.projectId,
                  input: body.input || "",
                  requestId: body.requestId,
                  selectedIds: body.selectedIds || existing.selectedIds,
                },
                undefined,
                existing.sessionId,
                "resume_task",
              );
              const updated = cloudTask(
                upstream,
                body,
                existing.conversationId,
                existing,
              );
              cloudTasks.save(updated);
              return reply.code(200).send(updated);
            } catch (error: any) {
              return reply.code(error.statusCode || 502).send({
                error: "AGENTARTS_UNAVAILABLE",
                message: error.message || "AgentArts 云端恢复任务失败",
                ...(error.details ? { details: error.details } : {}),
              });
            }
          }
        }
      }

      // 3. Forward to Local Agent Service (127.0.0.1:3132), merging cloud task history on GET conversation
      const convGetMatch =
        req.method === "GET"
          ? pathname.match(/^\/api\/agent\/conversations\/([^/]+)$/)
          : null;
      const convTasksListMatch =
        req.method === "GET"
          ? pathname.match(/^\/api\/agent\/conversations\/([^/]+)\/tasks$/)
          : null;

      const localBody = { ...body };
      if (
        convTaskMatch ||
        /^\/api\/agent\/tasks\/[^/]+\/resume$/.test(pathname)
      )
        delete localBody.projectId;

      const abort = new AbortController();
      pending.add(abort);
      const target = new URL(
        req.url.slice("/api/agent".length),
        process.env.ACTISCAPE_AGENT_URL || "http://127.0.0.1:3132",
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
            ? { body: JSON.stringify(localBody) }
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
        } else {
          const rawText = await upstream.text();
          if (upstream.ok && cloudTasks && (convGetMatch || convTasksListMatch)) {
            const cid = (convGetMatch || convTasksListMatch)![1];
            const extra = cloudTasks.listByConversation(cid);
            if (extra.length) {
              try {
                const parsed = JSON.parse(rawText);
                if (Array.isArray(parsed)) {
                  const ids = new Set(parsed.map((t: any) => t.id));
                  const merged = [
                    ...parsed,
                    ...extra.filter((t) => !ids.has(t.id)),
                  ].sort((a, b) =>
                    String(a.createdAt || "").localeCompare(
                      String(b.createdAt || ""),
                    ),
                  );
                  return reply.code(upstream.status).send(merged);
                }
                if (parsed && Array.isArray(parsed.tasks)) {
                  const ids = new Set(parsed.tasks.map((t: any) => t.id));
                  parsed.tasks = [
                    ...parsed.tasks,
                    ...extra.filter((t) => !ids.has(t.id)),
                  ].sort((a, b) =>
                    String(a.createdAt || "").localeCompare(
                      String(b.createdAt || ""),
                    ),
                  );
                  return reply.code(upstream.status).send(parsed);
                }
              } catch {}
            }
          }
          return reply
            .code(upstream.status)
            .type(upstream.headers.get("content-type") || "application/json")
            .send(rawText);
        }
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
