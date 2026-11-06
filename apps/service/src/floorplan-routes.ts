import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import { FloorplanStore } from "./floorplans.js";
import { SceneError } from "../../../packages/scene-core/src/index.js";
import { floorplanToolRoutes } from "./floorplan-tools.js";
export function floorplanRoutes(app: FastifyInstance, store: FloorplanStore) {
  floorplanToolRoutes(app, store);
  app.post(
    "/api/floorplan-images",
    {
      schema: {
        description:
          "Upload a decoded PNG/JPEG floorplan, max 20 MB / 25 MP. Originals and normalized pixels are durable; never modifies projects.",
      },
    },
    async (req, reply) => {
      const file = await req.file({
        limits: { fileSize: 20 * 1024 * 1024, files: 1 },
      });
      if (!file) throw new SceneError("MISSING_FILE", "需要 PNG/JPEG 户型图");
      return reply
        .code(201)
        .send(await store.upload(await file.toBuffer(), file.filename));
    },
  );
  app.get("/api/floorplan-images/:image", async (req) =>
    store.image((req.params as any).image),
  );
  app.get("/api/floorplan-images/:image/file", async (req, reply) => {
    const { file, type } = store.file(
      (req.params as any).image,
      (req.query as any).variant || "normalized",
    );
    return reply
      .type(type)
      .header("cache-control", "no-store")
      .send(fs.createReadStream(file));
  });
  app.post(
    "/api/floorplan-images/:image/crops",
    {
      schema: {
        description:
          "Persist a bounded original-pixel crop for recognition evidence",
        body: {
          type: "object",
          required: ["box"],
          additionalProperties: false,
          properties: {
            box: {
              type: "array",
              minItems: 4,
              maxItems: 4,
              items: { type: "number" },
            },
          },
        },
      },
    },
    async (req) => store.crop((req.params as any).image, (req.body as any).box),
  );
  app.get("/api/floorplan-images/:image/crops/:crop/file", async (req, reply) =>
    reply
      .type("image/png")
      .send(
        fs.createReadStream(
          store.cropFile((req.params as any).image, (req.params as any).crop),
        ),
      ),
  );
  const root = "/api/projects/:id/floorplan-drafts",
    item = root + "/:draft";
  const params = (req: any) => [req.params.id, req.params.draft] as const;
  app.get(root, async (req) => store.list((req.params as any).id));
  app.post(
    root,
    {
      schema: {
        description:
          "Create an isolated versioned floorplan draft. Empty project and baseRevision required.",
        body: {
          type: "object",
          required: ["requestId", "imageId", "baseRevision"],
          additionalProperties: false,
          properties: {
            requestId: { type: "string", minLength: 1, maxLength: 200 },
            imageId: { type: "string" },
            baseRevision: { type: "integer", minimum: 0 },
            data: { type: "object", additionalProperties: true },
          },
        },
      },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(store.create((req.params as any).id, req.body as any)),
  );
  app.get(item, async (req) => store.get(...params(req)));
  app.get(item + "/revisions", async (req) => {
    store.get(...params(req));
    return (
      store.projects.db
        .prepare(
          "SELECT record FROM floorplan_revisions WHERE draft=? ORDER BY revision",
        )
        .all((req.params as any).draft) as any[]
    ).map((r) => JSON.parse(r.record));
  });
  app.post(
    item + "/commands",
    {
      schema: {
        description:
          "Atomically correct only the draft. requestId is idempotent; draftRevision detects stale edits.",
        body: {
          type: "object",
          required: ["requestId", "draftRevision", "commands"],
          additionalProperties: false,
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
    async (req) => store.commands(...params(req), req.body),
  );
  app.post(
    item + "/preview",
    {
      schema: {
        description:
          "Read-only orthogonal structure, scale and topology preview; never changes project/history.",
      },
    },
    async (req) => store.preview(...params(req), (req.body as any)?.taskId),
  );
  app.post(
    item + "/confirm",
    {
      schema: {
        description:
          "Explicit operator confirmation of exact draft revision/hash. Subsequent corrections invalidate it.",
        body: {
          type: "object",
          required: ["requestId", "draftRevision", "draftHash"],
          additionalProperties: false,
          properties: {
            requestId: { type: "string", minLength: 1, maxLength: 200 },
            draftRevision: { type: "integer", minimum: 0 },
            draftHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
          },
        },
      },
    },
    async (req) => store.confirm(...params(req), req.body),
  );
  app.get(item + "/overlay", async (req, reply) => {
    const result = await store.overlay(...params(req));
    return reply
      .type("image/png")
      .header("x-draft-hash", result.draftHash)
      .header("x-content-sha256", result.sha256)
      .header("cache-control", "no-store")
      .send(fs.createReadStream(result.file));
  });
  app.post(
    item + "/rebase",
    {
      schema: {
        description:
          "Rebase a still-empty project draft and invalidate confirmation",
        body: {
          type: "object",
          required: ["requestId", "draftRevision", "baseRevision"],
          additionalProperties: false,
          properties: {
            requestId: { type: "string", minLength: 1, maxLength: 200 },
            draftRevision: { type: "integer", minimum: 0 },
            baseRevision: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    async (req) => store.rebase(...params(req), req.body),
  );
}
