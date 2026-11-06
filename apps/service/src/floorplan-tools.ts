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
    mode: "analyze" | "fit" | "axis" | "evidence" | "diagnostics",
    parameters: any,
    spec?: any,
    draftHash?: string,
    adapterVersion = "hpd-adapter-3",
  ) {
    const image = this.store.verifyImage(imageId);
    const id = digest({
      imageHash: image.sha256,
      mode,
      parameters,
      spec,
      draftHash,
      adapterVersion,
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
      adapterVersion === "hpd-adapter-2",
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
  evidence(imageId: string, ref: string): any {
    const image = this.store.verifyImage(imageId);
    if (ref === "image:" + image.sha256)
      return { id: ref, imageHash: image.sha256, kind: "original" };
    const crop = (image as any).crops?.find((c: any) => c.id === ref);
    if (crop) {
      this.store.cropFile(imageId, ref);
      return { ...crop, kind: "crop" };
    }
    const file = path.join(this.directory(imageId, ref), "record.json");
    if (!fs.existsSync(file))
      throw new SceneError("EVIDENCE_MISSING", "证据引用不存在", 422, { ref });
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    if (record.imageHash !== image.sha256)
      throw new SceneError("EVIDENCE_INVALID", "证据属于其他原图", 422);
    for (const f of record.files) this.file(imageId, ref, f.name);
    return record;
  }
  async fitBound(imageId: string, body: any) {
    if (
      !Array.isArray(body.walls) ||
      body.walls.length < 1 ||
      body.walls.length > 20
    )
      throw new SceneError("INVALID_REQUEST", "需要1–20个墙候选");
    const bindings: any[] = [];
    const walls = body.walls.map((w: any) => {
      if (w.analysisId !== undefined) {
        const record = this.evidence(imageId, w.analysisId),
          s = record.result?.segments_px?.[w.index];
        if (record.mode !== "analyze" || !Number.isInteger(w.index) || !s)
          throw new SceneError("INVALID_REQUEST", "墙候选引用无效", 422);
        bindings.push({ id: w.id, analysisId: w.analysisId, index: w.index });
        return {
          id: w.id,
          kind: s.orient === "h" ? "H" : "V",
          c: s.line,
          p0: s.s0,
          p1: s.s1,
        };
      }
      const crop = this.evidence(imageId, w.cropId);
      if (crop.kind !== "crop" || !["H", "V"].includes(w.kind))
        throw new SceneError(
          "INVALID_REQUEST",
          "新增墙候选须引用实际局部图",
          422,
        );
      const [x0, y0, x1, y1] = crop.box,
        vertical = w.kind === "V";
      if (!(
        w.c >= (vertical ? x0 : y0) &&
        w.c <= (vertical ? x1 : y1) &&
        Math.min(w.p0, w.p1) >= (vertical ? y0 : x0) &&
        Math.max(w.p0, w.p1) <= (vertical ? y1 : x1)
      ))
        throw new SceneError("INVALID_REQUEST", "取样超出证据裁剪范围", 422);
      bindings.push({ id: w.id, cropId: w.cropId });
      return {
        id: w.id,
        kind: w.kind,
        c: w.c,
        p0: w.p0,
        p1: w.p1,
        skip: w.skip || [],
      };
    });
    const result = await this.run(imageId, "fit", { walls });
    // Source binding is part of a distinct content-addressed record, never overwrite a cached fit.
    const id = digest({ result: result.id, bindings, adapter: "bound-fit-1" }),
      dir = this.directory(imageId, id);
    const record = {
      ...result,
      id,
      mode: "fit-bound",
      bindings,
      files: result.files.map((f: any) => ({
        ...f,
        path: `/floorplan-images/${imageId}/tools/${id}/files/${f.name}`,
      })),
    };
    fs.mkdirSync(dir, { recursive: true });
    for (const file of result.files)
      this.write(
        path.join(dir, file.name),
        fs.readFileSync(this.file(imageId, result.id, file.name)),
      );
    this.write(
      path.join(dir, "record.json"),
      Buffer.from(JSON.stringify(record)),
    );
    return record;
  }
  validateEvidence(data: any) {
    if (data.measurementVersion !== 2) return;
    for (const symbol of data.symbols)
      for (const ref of symbol.evidenceRefs || [])
        this.evidence(data.image.id, ref);
    for (const entry of [
      ...(data.features || []),
      ...(data.dimensions || []),
    ]) {
      const records = entry.evidenceRefs.map((r: string) =>
        this.evidence(data.image.id, r),
      );
      if (entry.kind?.startsWith("wall_")) {
        const wall = data.walls.find((w: any) => w.id === entry.objectId),
          vertical = Math.abs(wall.a.x - wall.b.x) <= 1;
        const normal = vertical ? "x" : "y",
          center = (wall.a[normal] + wall.b[normal]) / 2;
        const fit = records
          .filter((r: any) => r.mode === "fit-bound")
          .flatMap((r: any) => r.result || [])
          .find(
            (r: any) =>
              r.id === wall.id &&
              r.n > 0 &&
              Math.abs(r.center - center) <= 1 &&
              wall.thicknessPx !== undefined &&
              Math.abs(r.thick_px - wall.thicknessPx) <= 1,
          );
        if (!fit)
          throw new SceneError(
            "MEASUREMENT_EVIDENCE",
            "墙特征必须引用匹配当前中线与厚度的候选实测",
            422,
            { objectIds: [entry.id, wall.id] },
          );
      }
    }
  }
  async diagnostics(project: string, id: string) {
    const draft = this.store.get(project, id),
      preview = this.store.preview(project, id);
    let checks: any = preview.checks;
    try {
      this.validateEvidence(draft.data);
    } catch (e) {
      if (!(e instanceof SceneError)) throw e;
      checks = {
        ...checks,
        passed: false,
        issues: [
          ...checks.issues,
          {
            code: e.code,
            message: e.message,
            details: e.details,
            blocking: true,
            level: "error",
            objectIds: (e.details as any)?.objectIds || [],
          },
        ],
      };
    }
    const spec: any = { draft: draft.data };
    if ("state" in preview) {
      const source = preview.state.plan.source,
        s = source.mmPerPixel,
        o = source.origin;
      spec.solved = {
        ...draft.data,
        walls: preview.state.plan.walls.map((w: any) => {
          const a = preview.state.plan.nodes.find((n: any) => n.id === w.a)!,
            b = preview.state.plan.nodes.find((n: any) => n.id === w.b)!;
          return {
            id: w.id,
            a: { x: a.x / s + o.x, y: a.y / s + o.y },
            b: { x: b.x / s + o.x, y: b.y / s + o.y },
          };
        }),
        openings: [],
        symbols: preview.symbols.map((f: any) => ({
          ...f,
          x: f.x / s + o.x,
          y: f.y / s + o.y,
          w: f.w / s,
          d: f.d / s,
        })),
      };
    }
    const record = await this.run(
      draft.data.image.id,
      "diagnostics",
      {},
      spec,
      draft.hash,
    );
    return {
      ...record,
      draftHash: draft.hash,
      draftRevision: draft.revision,
      checks,
      measurement: (preview as any).measurement,
      coverage:
        "state" in preview ? "raster-and-solved-geometry" : "raster-only",
      limitations: ["诊断草稿，不是正式项目；像素轮廓和几何回投分别展示"],
    };
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
  store.evidenceVerifier = (data) => tools.validateEvidence(data);
  store.evidenceRefVerifier = (data, refs, draftHash) => {
    if (draftHash && !refs.length)
      throw new SceneError("EVIDENCE_MISSING", "审核需要当前诊断证据", 422);
    for (const ref of refs) {
      const evidence = tools.evidence(data.image.id, ref);
      if (draftHash && evidence.draftHash !== draftHash)
        throw new SceneError("DRAFT_CONFLICT", "审核证据与当前草稿不一致", 409);
    }
  };
  app.post(
    "/api/projects/:id/floorplan-drafts/:draft/measurement-updates",
    async (req) =>
      store.commands(
        (req.params as any).id,
        (req.params as any).draft,
        req.body || {},
        true,
      ),
  );
  app.post("/api/projects/:id/floorplan-drafts/:draft/review", async (req) =>
    store.review(
      (req.params as any).id,
      (req.params as any).draft,
      req.body || {},
    ),
  );
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
            tool: {
              type: "string",
              enum: ["analyze", "fit", "axis", "fit-bound"],
            },
          },
        },
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req) => {
      const { image, tool } = req.params as any;
      const { adapterVersion = "hpd-adapter-3", ...parameters } = (req.body ||
        {}) as any;
      if (!["hpd-adapter-2", "hpd-adapter-3"].includes(adapterVersion))
        throw new SceneError("INVALID_REQUEST", "不支持的工具适配版本");
      return tool === "fit-bound"
        ? tools.fitBound(image, parameters)
        : tools.run(
            image,
            tool,
            parameters,
            undefined,
            undefined,
            adapterVersion,
          );
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
    "/api/projects/:id/floorplan-drafts/:draft/diagnostics",
    async (req) =>
      tools.diagnostics((req.params as any).id, (req.params as any).draft),
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
