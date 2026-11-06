import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import { CandidateStore } from "./candidates.js";
import { ProjectStore } from "./store.js";
import { RenderWorker } from "./render-worker.js";
import { SceneError } from "../../../packages/scene-core/src/index.js";
import {
  compileRectangular,
  requireBlank,
} from "../../../packages/scene-core/src/rectangular.js";

export function candidateRoutes(
  app: FastifyInstance,
  store: ProjectStore,
  notify: (id: string, revision: number) => void,
) {
  const candidates = new CandidateStore(store),
    renderer = new RenderWorker();
  const root = "/api/projects/:id/candidates",
    item = root + "/:candidate";
  const params = (req: any) => [req.params.id, req.params.candidate] as const;
  app.post(
    "/api/projects/:id/initialization-preview",
    {
      schema: {
        description:
          "Read-only rectangular structure preview for an empty project; fixed task ID gives stable structure IDs",
        body: {
          type: "object",
          required: ["taskId", "baseRevision", "brief"],
          additionalProperties: false,
          properties: {
            taskId: { type: "string", minLength: 1, maxLength: 100 },
            baseRevision: { type: "integer", minimum: 0 },
            brief: { type: "object", additionalProperties: true },
          },
        },
      },
    },
    async (req) => {
      const body = req.body as any,
        p = store.get((req.params as any).id);
      if (p.revision !== body.baseRevision)
        throw new SceneError("REVISION_CONFLICT", "项目版本已变化", 409, {
          currentRevision: p.revision,
        });
      requireBlank(p);
      return {
        ...compileRectangular(body.brief, body.taskId),
        projectId: p.id,
        baseRevision: p.revision,
        checks: {
          passed: true,
          issues: [],
          coverage: ["矩形净尺寸、门窗范围与重叠、有效封闭房间"],
          limitations: ["结构预览不包含家具和最终检查"],
        },
      };
    },
  );
  app.get(
    root,
    {
      schema: {
        description:
          "List immutable local-edit candidates without changing the project",
      },
    },
    async (req) => candidates.list((req.params as any).id),
  );
  app.post(
    root,
    {
      schema: {
        description:
          "Create a candidate from scoped furniture edits. requestId deduplicates creation and allocated object IDs.",
        body: {
          type: "object",
          required: ["requestId", "taskId", "baseRevision"],
          properties: {
            requestId: { type: "string", minLength: 1, maxLength: 200 },
            taskId: { type: "string", minLength: 1, maxLength: 200 },
            baseRevision: { type: "integer", minimum: 0 },
            summary: { type: "string", maxLength: 200 },
            kind: {
              type: "string",
              enum: ["edit", "initialize", "initialize_floorplan"],
            },
            floorplan: {
              type: "object",
              additionalProperties: false,
              required: ["draftId", "draftRevision", "draftHash"],
              properties: {
                draftId: { type: "string" },
                draftRevision: { type: "integer", minimum: 0 },
                draftHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
              },
            },
            matches: {
              type: "array",
              maxItems: 50,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["symbolId", "key"],
                properties: {
                  symbolId: { type: "string" },
                  key: { type: "string" },
                },
              },
            },
            brief: { type: "object", additionalProperties: true },
            scope: { type: "object", additionalProperties: true },
            edits: {
              type: "array",
              minItems: 0,
              maxItems: 50,
              items: { type: "object", additionalProperties: true },
            },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(candidates.create((req.params as any).id, req.body as any)),
  );
  app.get(item, async (req) => candidates.get(...params(req)));
  app.get(
    item + "/checks",
    async (req) => candidates.get(...params(req)).checks,
  );
  app.post(
    item + "/render",
    {
      schema: {
        description:
          "Read-only rendering of the fixed candidate; returns SHA-bound top and oblique PNG evidence",
      },
    },
    async (req) => {
      const address = app.server.address();
      if (!address || typeof address === "string")
        throw new SceneError(
          "RENDER_UNAVAILABLE",
          "截图需要运行中的 HTTP 服务",
          503,
        );
      return renderer.render(
        candidates,
        ...params(req),
        `http://127.0.0.1:${address.port}`,
      );
    },
  );
  app.get(item + "/evidence/:view", async (req, reply) => {
    const [project, id] = params(req),
      view = (req.params as any).view;
    candidates.verifyEvidence(project, id);
    return reply
      .type("image/png")
      .header("cache-control", "no-store")
      .send(fs.createReadStream(candidates.evidencePath(project, id, view)));
  });
  app.post(
    item + "/review",
    {
      schema: {
        description:
          "Record independent agent or explicit operator review referencing both evidence hashes",
        body: {
          type: "object",
          required: [
            "passed",
            "source",
            "summary",
            "objectIds",
            "evidenceHashes",
            "issues",
          ],
          additionalProperties: false,
          properties: {
            passed: { type: "boolean" },
            source: { type: "string", enum: ["agent", "operator"] },
            summary: { type: "string", maxLength: 4000 },
            objectIds: { type: "array", items: { type: "string" } },
            evidenceHashes: { type: "array", items: { type: "string" } },
            issues: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    async (req) => candidates.review(...params(req), req.body as any),
  );
  app.post(
    item + "/commit",
    {
      schema: {
        description:
          "Commit the same reviewed candidate atomically after rechecking revision, hash, deterministic checks and evidence. Repeats are idempotent.",
        body: {
          type: "object",
          required: ["operationId", "baseRevision", "candidateHash"],
          properties: {
            operationId: { type: "string" },
            baseRevision: { type: "integer", minimum: 0 },
            candidateHash: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      const [project, id] = params(req),
        result = candidates.commit(project, id, req.body as any);
      if (!result.replayed) notify(project, result.project.revision);
      return result;
    },
  );
  return candidates;
}
