import type { FastifyInstance } from "fastify";
import { SceneDraftStore } from "./scene-drafts.js";

export function sceneDraftRoutes(app: FastifyInstance, store: SceneDraftStore) {
  const root = "/api/projects/:id/scene-drafts";
  app.get(root, async (req) => store.list((req.params as any).id));
  app.post(
    root,
    {
      schema: {
        description:
          "Create one revisioned generic scene draft. It never changes the formal project.",
        body: {
          type: "object",
          additionalProperties: false,
          required: ["requestId", "draft"],
          properties: {
            requestId: { type: "string", minLength: 1, maxLength: 200 },
            draft: { type: "object", additionalProperties: true },
          },
        },
      },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(store.create((req.params as any).id, req.body as any)),
  );
  app.get(root + "/:draft", async (req) =>
    store.get((req.params as any).id, (req.params as any).draft),
  );
  app.get(root + "/:draft/revisions", async (req) =>
    store.revisions((req.params as any).id, (req.params as any).draft),
  );
  app.post(
    root + "/:draft/patches",
    {
      schema: {
        description:
          "Apply idempotent commands to one scene-program draft revision.",
        body: {
          type: "object",
          additionalProperties: false,
          required: ["requestId", "draftRevision", "commands"],
          properties: {
            requestId: { type: "string", minLength: 1, maxLength: 200 },
            draftRevision: { type: "integer", minimum: 0 },
            commands: {
              type: "array",
              minItems: 1,
              maxItems: 100,
              items: { type: "object", additionalProperties: true },
            },
          },
        },
      },
    },
    async (req) =>
      store.patch(
        (req.params as any).id,
        (req.params as any).draft,
        req.body,
      ),
  );
  app.post(root + "/:draft/preview", async (req) =>
    store.preview((req.params as any).id, (req.params as any).draft),
  );
}
