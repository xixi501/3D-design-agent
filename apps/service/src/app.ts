import Fastify from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import fs from "node:fs";
import path from "node:path";
import type { ServerResponse } from "node:http";
import {
  catalogGroups,
  catalog,
  freeShapes,
  freeMaterials,
  furnitureStyles,
  styleTypes,
  openingTypes,
  blankPlan,
  checkScene,
  SceneError,
  type Mutation,
} from "../../../packages/scene-core/src/index.js";
import { ProjectStore } from "./store.js";
import { inspectGlb } from "./assets.js";
import { AssetProvider } from "./asset-provider.js";
import { candidateRoutes } from "./candidate-routes.js";
import { floorplanRoutes } from "./floorplan-routes.js";
import { SceneDraftStore } from "./scene-drafts.js";
import { sceneDraftRoutes } from "./scene-draft-routes.js";
import { RoutedFloorplanStore } from "./scene-floorplan-drafts.js";
import { agentProxy } from "./agent-proxy.js";
import { agentArtsProxy } from "./agentarts-proxy.js";

export async function createApp(options: {
  dataDir: string;
  staticDir?: string;
  logger?: boolean;
  asset?: {
    cacheDir?: string;
    serviceUrl?: string;
    apiKey?: string;
    demoAssetPath?: string;
    timeoutMs?: number;
  };
}) {
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 20 * 1024 * 1024,
    ajv: { customOptions: { removeAdditional: false } },
  });
  const store = new ProjectStore(options.dataDir),
    streams = new Map<string, Set<ServerResponse>>();
  const assetProvider = new AssetProvider({
    store,
    dataDir: options.dataDir,
    logger: app.log,
    ...(options.asset || {}),
  });
  const notify = (id: string, revision: number) => {
    for (const stream of streams.get(id) || [])
      stream.write(
        `id: ${revision}\nevent: revision\ndata: ${JSON.stringify({ revision })}\n\n`,
      );
  };
  await app.register(swagger, {
    openapi: {
      info: {
        title: "ActiScape scene tools",
        version: "1.0.0",
        description:
          "All scene lengths are mm. Mutations require operationId and baseRevision. Trusted single-user development service.",
      },
    },
  });
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  });
  app.setErrorHandler((error: any, _request, reply) => {
    const status =
      error instanceof SceneError ? error.status : error.statusCode || 500;
    reply.code(status).send({
      error: error.code || "INTERNAL_ERROR",
      message: status === 500 ? "服务内部错误，请查看日志" : error.message,
      ...(error.details ? { details: error.details } : {}),
    });
    if (status >= 500) app.log.error(error);
  });
  app.get(
    "/api/health",
    { schema: { description: "Service and database readiness" } },
    async () => ({
      ok: store.db.prepare("SELECT 1").get() !== undefined,
      service: "ActiScape",
      formatVersion: 1,
    }),
  );
  app.get("/api/openapi.json", async () => app.swagger());
  const sceneDrafts = new SceneDraftStore(store);
  const floorplans = new RoutedFloorplanStore(store, sceneDrafts);
  const candidates = candidateRoutes(app, store, notify, floorplans);
  floorplanRoutes(app, floorplans);
  sceneDraftRoutes(app, sceneDrafts);
  agentProxy(app);
  agentArtsProxy(app);
  app.get(
    "/api/catalog",
    {
      schema: {
        description:
          "Complete upstream catalogue, defaults and supported recipes",
      },
    },
    async () => ({
      groups: catalogGroups,
      items: catalog,
      freeShapes,
      freeMaterials,
      furnitureStyles,
      styleTypes,
      openingTypes,
      capabilities: [
        "dimensions",
        "transform",
        "color",
        "style",
        "cabinet",
        "kitchen",
        "free-form",
        "glb",
      ],
    }),
  );
  app.get("/api/projects", async () => store.list());
  app.post(
    "/api/projects",
    {
      schema: {
        description:
          "Create/import HouseSpec, legacy single-floor v2, or ActiScape v1. Missing model references return 422 with IDs.",
        body: {
          type: "object",
          properties: {
            document: { type: "object", additionalProperties: true },
            imageMap: {
              type: "object",
              additionalProperties: { type: "string" },
            },
            assetMap: {
              type: "object",
              additionalProperties: { type: "string" },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const body = req.body as any;
      return reply
        .code(201)
        .send(
          store.create(
            body.document ?? blankPlan(),
            body.assetMap,
            body.imageMap,
          ),
        );
    },
  );
  app.get("/api/projects/:id", async (req) =>
    store.get((req.params as any).id),
  );
  app.get("/api/projects/:id/export", async (req, reply) => {
    const project = store.get((req.params as any).id);
    return reply
      .header(
        "content-disposition",
        'attachment; filename="actiscape-project.json"',
      )
      .send({
        ...project,
        assetManifest: project.assets.map((id) => store.asset(id)),
        ...(project.plan.source?.kind === "floorplan"
          ? {
              sourceImageManifest: [
                floorplans.image(project.plan.source.imageId),
              ],
            }
          : {}),
      });
  });
  app.get("/api/projects/:id/history", async (req) =>
    store.history((req.params as any).id),
  );
  app.get("/api/projects/:id/checks", async (req) => {
    const p = store.get((req.params as any).id);
    return { revision: p.revision, ...checkScene(p.plan) };
  });
  const bodySchema = {
    type: "object",
    required: ["operationId", "baseRevision"],
    properties: {
      operationId: { type: "string", minLength: 1, maxLength: 200 },
      baseRevision: { type: "integer", minimum: 0 },
      summary: { type: "string", maxLength: 200 },
      commands: {
        type: "array",
        items: { type: "object", additionalProperties: true },
      },
    },
    additionalProperties: false,
  } as const;
  for (const kind of ["commands", "undo", "redo"] as const)
    app.post(
      `/api/projects/:id/${kind}`,
      {
        schema: {
          description:
            kind === "commands"
              ? "Atomically apply structured commands. 409 on stale revision or operation ID reuse with different content. Identical retries return the original result."
              : "Persist history cursor and advance revision.",
          body: bodySchema,
        },
      },
      async (req) => {
        const id = (req.params as any).id,
          result = store.mutate(id, kind, req.body as Mutation);
        if (!result.replayed) notify(id, result.project.revision);
        return result;
      },
    );
  app.get("/api/projects/:id/events", async (req, reply) => {
    const id = (req.params as any).id,
      project = store.get(id);
    reply.hijack();
    const stream = reply.raw;
    stream.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    stream.write(
      `event: revision\ndata: ${JSON.stringify({ revision: project.revision })}\n\n`,
    );
    const set = streams.get(id) || new Set();
    set.add(stream);
    streams.set(id, set);
    const heartbeat = setInterval(() => stream.write(": heartbeat\n\n"), 15000);
    req.raw.on("close", () => {
      clearInterval(heartbeat);
      set.delete(stream);
      if (!set.size) streams.delete(id);
    });
  });
  app.get("/api/assets/providers", async () => assetProvider.providers());
  app.get("/api/assets/jobs", async () => ({ jobs: assetProvider.listJobs() }));
  app.get("/api/assets/jobs/:id", async (req, reply) => {
    try {
      return await assetProvider.poll((req.params as any).id);
    } catch (error) {
      throw new SceneError(
        "ASSET_JOB_NOT_FOUND",
        error instanceof Error ? error.message : "资产任务不存在",
        404,
      );
    }
  });
  const generateFromImage = async (req: any, reply: any) => {
    let image: Buffer | undefined,
      filename: string | undefined;
    const fields: Record<string, string> = {};
    for await (const part of req.parts()) {
      if (part.type === "file") {
        image = await part.toBuffer();
        filename = part.filename;
      } else fields[part.fieldname] = String(part.value);
    }
    if (!image?.length)
      throw new SceneError("MISSING_IMAGE", "需要一张物品照片", 400);
    if (image.length > 10 * 1024 * 1024)
      throw new SceneError("IMAGE_TOO_LARGE", "物品照片不能超过 10 MB", 413);
    const target = fields.targetHeightMm || fields.target_height_mm;
    const targetHeightMm = target ? Number(target) : undefined;
    try {
      const result = await assetProvider.generate({
        image,
        filename,
        name: fields.name,
        category: fields.category,
        targetHeightMm:
          targetHeightMm && Number.isFinite(targetHeightMm)
            ? targetHeightMm
            : undefined,
      });
      return reply
        .code(result.job.status === "succeeded" ? 201 : 202)
        .send(result);
    } catch (error) {
      throw new SceneError(
        "ASSET_GENERATION_FAILED",
        error instanceof Error ? error.message : "资产生成失败",
        422,
      );
    }
  };
  app.post("/api/assets/generate-from-image", generateFromImage);
  app.post("/api/assets/jobs", generateFromImage);
  app.post("/api/assets/:assetId/calibrate", async (req) => {
    const body = req.body as any;
    if (!body || typeof body.targetHeightMm !== "number")
      throw new SceneError(
        "INVALID_CALIBRATION",
        "需要 targetHeightMm（毫米）",
        400,
      );
    try {
      return { asset: assetProvider.calibrate((req.params as any).assetId, body.targetHeightMm) };
    } catch (error) {
      if (error instanceof SceneError) throw error;
      throw new SceneError(
        "ASSET_NOT_FOUND",
        error instanceof Error ? error.message : "资产不存在",
        404,
      );
    }
  });
  app.get("/api/assets", async () => store.assets());
  app.post(
    "/api/assets",
    {
      schema: {
        description:
          "Upload one self-contained, static, uncompressed GLB (max 50 MB). Returns immutable identity, checksum and normalized dimensions.",
      },
    },
    async (req, reply) => {
      const file = await req.file();
      if (!file) throw new SceneError("MISSING_FILE", "需要 GLB 文件");
      const buffer = await file.toBuffer(),
        record = inspectGlb(buffer, file.filename);
      return reply.code(201).send(store.saveAsset(record, buffer));
    },
  );
  app.get("/api/assets/:id", async (req) =>
    store.asset((req.params as any).id),
  );
  app.get("/api/assets/:id/file", async (req, reply) => {
    const id = (req.params as any).id;
    const file = store.assetPath(id);
    return reply
      .type("model/gltf-binary")
      .header("cache-control", "public, max-age=31536000, immutable")
      .send(fs.createReadStream(file));
  });
  const fixtures = path.resolve("fixtures");
  app.get("/api/examples", async () => [
    { id: "living-dining", name: "客餐厅" },
    { id: "modeling-gallery", name: "家具与建模展台" },
    { id: "glb-display", name: "贴图 GLB 展台" },
  ]);
  app.get("/api/examples/:name", async (req) => {
    const name = (req.params as any).name;
    if (!["living-dining", "modeling-gallery", "glb-display"].includes(name))
      throw new SceneError("NOT_FOUND", "样例不存在", 404);
    return JSON.parse(
      fs.readFileSync(path.join(fixtures, `${name}.plan.json`), "utf8"),
    );
  });
  app.get("/api/example-asset", async (_req, reply) =>
    reply
      .type("model/gltf-binary")
      .send(fs.createReadStream(path.join(fixtures, "textured-vase.glb"))),
  );
  if (options.staticDir && fs.existsSync(options.staticDir))
    await app.register(fastifyStatic, { root: options.staticDir });
  app.addHook("preClose", async () => {
    for (const set of streams.values()) for (const stream of set) stream.end();
  });
  app.addHook("onClose", async () => store.close());
  return { app, store, candidates, floorplans, sceneDrafts, assetProvider };
}
