/** Read-only adaptation of pinned upstream pixel tools. Never writes projects/history. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { FloorplanStore, imageProcess } from "./floorplans.js";
import { canonical } from "./store.js";
import { newId, SceneError } from "../../../packages/scene-core/src/index.js";
import { requireBlank } from "../../../packages/scene-core/src/rectangular.js";

const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const provenance = JSON.parse(
  fs.readFileSync(
    path.resolve(
      "apps/agent/actiscape_agent/vendor/house_plan_designer/provenance.json",
    ),
    "utf8",
  ),
);

export class FloorplanTools {
  constructor(public store: FloorplanStore) {}
  private directory(image: string, id: string) {
    if (!/^[a-f0-9]{64}$/.test(id))
      throw new SceneError("NOT_FOUND", "工具证据不存在", 404);
    return path.join(
      this.store.projects.directory,
      "floorplan-images",
      image,
      "tools",
      id,
    );
  }
  private write(file: string, bytes: Buffer) {
    const tmp = file + "." + newId() + ".tmp",
      fd = fs.openSync(tmp, "wx");
    try {
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  }
  async run(
    imageId: string,
    mode: "analyze" | "fit" | "axis" | "evidence",
    parameters: any,
    spec?: any,
    draftHash?: string,
  ) {
    const image = this.store.verifyImage(imageId);
    const id = digest({
      imageHash: image.sha256,
      mode,
      parameters,
      spec,
      draftHash,
      adapterVersion: "hpd-adapter-1",
      provenance,
    });
    const dir = this.directory(imageId, id),
      recordFile = path.join(dir, "record.json");
    if (fs.existsSync(recordFile)) {
      const record = JSON.parse(fs.readFileSync(recordFile, "utf8"));
      for (const file of record.files) this.file(imageId, id, file.name);
      return record;
    }
    const raw = await imageProcess(
      Buffer.from(
        JSON.stringify({
          mode,
          parameters,
          spec,
          image: fs
            .readFileSync(this.store.file(imageId, "original").file)
            .toString("base64"),
        }),
      ),
      "",
      true,
    );
    fs.mkdirSync(dir, { recursive: true });
    const { files = {}, ...metadata } = raw,
      descriptors = [];
    for (const [name, value] of Object.entries(files) as [string, any][]) {
      if (!/^[a-z0-9_]+\.png$/.test(name))
        throw new Error("Invalid tool artifact name");
      const { data, ...info } = value,
        bytes = Buffer.from(data, "base64");
      this.write(path.join(dir, name), bytes);
      descriptors.push({
        ...info,
        name,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        path: `/floorplan-images/${imageId}/tools/${id}/files/${name}`,
      });
    }
    const record = {
      id,
      mode,
      imageId,
      imageHash: image.sha256,
      ...(draftHash ? { draftHash } : {}),
      ...metadata,
      files: descriptors,
    };
    this.write(recordFile, Buffer.from(JSON.stringify(record)));
    return record;
  }
  file(imageId: string, id: string, name: string) {
    this.store.verifyImage(imageId);
    if (!/^[a-z0-9_]+\.png$/.test(name))
      throw new SceneError("NOT_FOUND", "工具证据不存在", 404);
    const dir = this.directory(imageId, id),
      recordFile = path.join(dir, "record.json");
    if (!fs.existsSync(recordFile))
      throw new SceneError("NOT_FOUND", "工具证据不存在", 404);
    const record = JSON.parse(fs.readFileSync(recordFile, "utf8"));
    const info = record.files.find((f: any) => f.name === name),
      file = path.join(dir, name);
    if (!info || !fs.existsSync(file))
      throw new SceneError("SOURCE_IMAGE_MISSING", "工具证据文件缺失", 422);
    if (
      createHash("sha256").update(fs.readFileSync(file)).digest("hex") !==
      info.sha256
    )
      throw new SceneError("SOURCE_IMAGE_INVALID", "工具证据校验失败", 422);
    return file;
  }
  preflight(projectId: string, body: any) {
    const project = this.store.projects.get(projectId);
    requireBlank(project);
    const image = this.store.verifyImage(body.imageId);
    const data = {
      ...body.data,
      image: Object.fromEntries(
        ["id", "sha256", "width", "height"].map((k) => [k, (image as any)[k]]),
      ),
    };
    const result = this.store.inspectData(data, "preflight");
    return {
      ...result,
      dataHash: digest(data),
      projectRevision: project.revision,
    };
  }
  async audit(project: string, draftId: string, taskId = draftId) {
    const draft = this.store.get(project, draftId),
      preview = this.store.preview(project, draftId, taskId);
    if (!("state" in preview))
      throw new SceneError(
        "FLOORPLAN_NOT_READY",
        "结构尚不可编译，不能进行原图对账",
        422,
        preview.checks,
      );
    const plan = preview.state.plan,
      scale = preview.scale.mmPerPixel,
      origin = preview.scale.origin;
    const node = (id: string) => plan.nodes.find((n: any) => n.id === id)!;
    const spec = {
      name: plan.name,
      underlay: { mmPerPx: scale, x: -origin.x * scale, y: -origin.y * scale },
      walls: plan.walls.map((w: any) => {
        const a = node(w.a),
          b = node(w.b),
          length = Math.hypot(b.x - a.x, b.y - a.y);
        const along = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? "x" : "y";
        return {
          id: w.id,
          a: [a.x, a.y],
          b: [b.x, b.y],
          t: w.t,
          openings: plan.openings
            .filter((o: any) => o.wall === w.id)
            .map((o: any) => ({
              type: o.type,
              sill: o.sill,
              from:
                a[along] +
                ((b[along] - a[along]) * (o.pos - o.width / 2)) / length,
              to:
                a[along] +
                ((b[along] - a[along]) * (o.pos + o.width / 2)) / length,
            })),
        };
      }),
      furniture: preview.symbols.map((s: any) => ({
        key: s.catalogKey || s.category,
        id: s.objectId,
        at: [s.x, s.y],
        w: s.w,
        d: s.d,
        rot: s.rot,
      })),
    };
    const record = await this.run(
      draft.data.image.id,
      "evidence",
      {},
      spec,
      draft.hash,
    );
    return {
      ...record,
      objectIds: {
        walls: spec.walls.map((w) => w.id),
        furniture: spec.furniture.map((f: any) => f.id),
      },
    };
  }
}

export function floorplanToolRoutes(
  app: FastifyInstance,
  store: FloorplanStore,
) {
  const tools = new FloorplanTools(store);
  app.post(
    "/api/floorplan-images/:image/tools/:tool",
    {
      schema: {
        description:
          "Read-only pinned house-plan-designer pixel tools; no project/draft/history writes. Coordinates are EXIF-oriented original pixels.",
        params: {
          type: "object",
          required: ["image", "tool"],
          properties: {
            image: { type: "string" },
            tool: { type: "string", enum: ["analyze", "fit", "axis"] },
          },
        },
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req) => {
      const { image, tool } = req.params as any;
      return tools.run(image, tool, req.body || {});
    },
  );
  app.get(
    "/api/floorplan-images/:image/tools/:toolId/files/:file",
    async (req, reply) => {
      const p = req.params as any;
      return reply
        .type("image/png")
        .header("cache-control", "no-store")
        .send(fs.createReadStream(tools.file(p.image, p.toolId, p.file)));
    },
  );
  app.post(
    "/api/projects/:id/floorplan-preflight",
    {
      schema: {
        description:
          "Read-only TypeScript compilation feedback before persisting a recognized draft.",
        body: {
          type: "object",
          required: ["imageId", "data"],
          additionalProperties: false,
          properties: {
            imageId: { type: "string" },
            data: { type: "object", additionalProperties: true },
          },
        },
      },
    },
    async (req) => tools.preflight((req.params as any).id, req.body),
  );
  app.post(
    "/api/projects/:id/floorplan-drafts/:draft/source-audit",
    {
      schema: {
        description:
          "Run original wallaudit and furnoverlay against a compiled draft, frozen to its hash. Heuristic source evidence, not permission to commit.",
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            taskId: { type: "string", pattern: "^[\\w-]{1,100}$" },
          },
        },
      },
    },
    async (req) =>
      tools.audit(
        (req.params as any).id,
        (req.params as any).draft,
        (req.body as any)?.taskId,
      ),
  );
}
