import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { ProjectStore, canonical } from "./store.js";
import {
  clone,
  newId,
  SceneError,
} from "../../../packages/scene-core/src/index.js";
import { requireBlank } from "../../../packages/scene-core/src/rectangular.js";
import {
  compileFloorplan,
  validateFloorplan,
  type FloorplanData,
  type FloorplanBinding,
  type ImageReference,
} from "../../../packages/scene-core/src/floorplan.js";
const hash = (v: unknown) =>
  createHash("sha256").update(canonical(v)).digest("hex");
const identity = (v: any) => {
  if (typeof v !== "string" || !v || v.length > 200)
    throw new SceneError("INVALID_REQUEST", "需要有效 requestId");
};
export interface FloorplanImage extends ImageReference {
  filename: string;
  bytes: number;
  format: string;
  normalizedWidth: number;
  normalizedHeight: number;
  orientation: number;
  normalizedToPixel: { x: number; y: number };
  pixelSpace: string;
  lineCandidates: any[];
  status: "ready";
}
export class FloorplanStore {
  constructor(public projects: ProjectStore) {
    fs.mkdirSync(path.join(projects.directory, "floorplan-images"), {
      recursive: true,
    });
  }
  image(id: string): FloorplanImage {
    const r = this.projects.db
      .prepare("SELECT record FROM floorplan_images WHERE id=?")
      .get(id) as any;
    if (!r) throw new SceneError("NOT_FOUND", "户型原图不存在", 404);
    return JSON.parse(r.record);
  }
  file(id: string, variant = "normalized") {
    const r = this.image(id);
    if (!["original", "normalized"].includes(variant))
      throw new SceneError("NOT_FOUND", "图片版本不存在", 404);
    const file = path.join(
      this.projects.directory,
      "floorplan-images",
      id,
      variant === "original" ? "original" : "normalized.png",
    );
    if (!fs.existsSync(file))
      throw new SceneError(
        "SOURCE_IMAGE_MISSING",
        "户型原图或处理图文件缺失，请恢复数据目录",
        422,
      );
    return {
      file,
      type:
        variant === "normalized"
          ? "image/png"
          : r.format === "PNG"
            ? "image/png"
            : "image/jpeg",
    };
  }
  verifyImage(id: string) {
    const record = this.image(id),
      { file } = this.file(id, "original");
    if (
      createHash("sha256").update(fs.readFileSync(file)).digest("hex") !==
      record.sha256
    )
      throw new SceneError("SOURCE_IMAGE_INVALID", "户型原图校验失败", 422);
    this.file(id);
    return record;
  }
  async upload(bytes: Buffer, filename: string) {
    if (!bytes.length || bytes.length > 20 * 1024 * 1024)
      throw new SceneError(
        "INVALID_IMAGE",
        "户型图需要不超过 20 MB 的 PNG/JPEG",
        422,
      );
    const digest = createHash("sha256").update(bytes).digest("hex"),
      id = `fp-${digest}`;
    const existing = this.projects.db
      .prepare("SELECT id FROM floorplan_images WHERE id=?")
      .get(id);
    const result: any = await new Promise((resolve, reject) => {
      const child = spawn(
        process.env.ACTISCAPE_PYTHON || path.resolve(".venv/bin/python"),
        ["-m", "actiscape_agent.floorplan_image"],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let output = Buffer.alloc(0),
        settled = false;
      const timer = setTimeout(() => {
        child.kill();
        finish(new SceneError("IMAGE_TIMEOUT", "图片解码超时", 422));
      }, 30000);
      const finish = (error?: Error, value?: any) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        error ? reject(error) : resolve(value);
      };
      child.on("error", () =>
        finish(
          new SceneError(
            "IMAGE_PROCESSOR_UNAVAILABLE",
            "图片处理环境未就绪，请运行 setup:agent",
            503,
          ),
        ),
      );
      child.stdout.on("data", (chunk: Buffer) => {
        output = Buffer.concat([output, chunk]);
        if (output.length > 64 * 1024 * 1024) {
          child.kill();
          finish(new SceneError("INVALID_IMAGE", "图片处理输出过大", 422));
        }
      });
      child.stderr.resume();
      child.stdin.on("error", () => {});
      child.on("close", (code) => {
        if (settled) return;
        try {
          const value = JSON.parse(output.toString());
          if (code !== 0 || value.error)
            finish(
              new SceneError(
                "INVALID_IMAGE",
                value.message || "图片无法解码",
                422,
              ),
            );
          else finish(undefined, value);
        } catch {
          finish(new SceneError("INVALID_IMAGE", "图片无法解码", 422));
        }
      });
      child.stdin.end(bytes);
    });
    const { normalized, ...metadata } = result,
      record: FloorplanImage = {
        id,
        sha256: digest,
        filename: filename.slice(0, 200),
        bytes: bytes.length,
        status: "ready",
        ...metadata,
      };
    const dir = path.join(this.projects.directory, "floorplan-images", id);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, data] of [
      ["original", bytes],
      ["normalized.png", Buffer.from(normalized, "base64")],
    ] as const) {
      const temp = path.join(dir, `${newId()}.tmp`);
      const fd = fs.openSync(temp, "wx");
      try {
        fs.writeFileSync(fd, data);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temp, path.join(dir, name));
    }
    if (!existing)
      this.projects.db
        .prepare("INSERT INTO floorplan_images(id,record) VALUES(?,?)")
        .run(id, JSON.stringify(record));
    return this.verifyImage(id);
  }
  private row(project: string, id: string): any {
    const r = this.projects.db
      .prepare("SELECT * FROM floorplan_drafts WHERE project=? AND id=?")
      .get(project, id);
    if (!r) throw new SceneError("NOT_FOUND", "识别草稿不存在", 404);
    return r;
  }
  get(project: string, id: string): any {
    return JSON.parse(this.row(project, id).record);
  }
  list(project: string) {
    this.projects.get(project);
    return (
      this.projects.db
        .prepare(
          "SELECT record FROM floorplan_drafts WHERE project=? ORDER BY rowid DESC",
        )
        .all(project) as any[]
    ).map((r) => JSON.parse(r.record));
  }
  create(
    project: string,
    body: {
      requestId: string;
      imageId: string;
      baseRevision: number;
      data?: FloorplanData;
    },
  ) {
    identity(body?.requestId);
    const digest = hash(body);
    return this.projects.db
      .transaction(() => {
        const old = this.projects.db
          .prepare(
            "SELECT * FROM floorplan_drafts WHERE project=? AND request_id=?",
          )
          .get(project, body.requestId) as any;
        if (old) {
          if (old.request_hash !== digest)
            throw new SceneError(
              "OPERATION_CONFLICT",
              "草稿请求身份内容不同",
              409,
            );
          return JSON.parse(old.record);
        }
        const p = this.projects.get(project);
        requireBlank(p);
        if (p.revision !== body.baseRevision)
          throw new SceneError("REVISION_CONFLICT", "项目版本已变化", 409, {
            currentRevision: p.revision,
          });
        const image = this.verifyImage(body.imageId),
          ref = {
            id: image.id,
            sha256: image.sha256,
            width: image.width,
            height: image.height,
          };
        const data = body.data || {
          image: ref,
          name: "户型图复现",
          anchors: [],
          walls: [],
          openings: [],
          rooms: [],
          symbols: [],
          targetRoomIds: [],
          uncertainties: [],
        };
        if (canonical(data.image) !== canonical(ref))
          throw new SceneError(
            "INVALID_FLOORPLAN",
            "草稿图片身份与上传记录不一致",
            422,
          );
        validateFloorplan(data);
        const id = newId(),
          record = {
            id,
            projectId: project,
            baseRevision: p.revision,
            revision: 0,
            data: clone(data),
            hash: hash({ id, revision: 0, data }),
            confirmed: null,
            corrections: 0,
            createdAt: new Date().toISOString(),
          };
        this.projects.db
          .prepare(
            "INSERT INTO floorplan_drafts(id,project,request_id,request_hash,record) VALUES(?,?,?,?,?)",
          )
          .run(id, project, body.requestId, digest, JSON.stringify(record));
        this.projects.db
          .prepare(
            "INSERT INTO floorplan_revisions(draft,revision,record) VALUES(?,?,?)",
          )
          .run(id, 0, JSON.stringify(record));
        return record;
      })
      .immediate();
  }
  private action(
    project: string,
    id: string,
    body: any,
    run: (record: any) => any,
  ) {
    identity(body?.requestId);
    const digest = hash(body);
    return this.projects.db
      .transaction(() => {
        const record = this.get(project, id),
          old = this.projects.db
            .prepare(
              "SELECT hash,response FROM floorplan_actions WHERE draft=? AND request_id=?",
            )
            .get(id, body.requestId) as any;
        if (old) {
          if (old.hash !== digest)
            throw new SceneError(
              "OPERATION_CONFLICT",
              "草稿操作身份内容不同",
              409,
            );
          return JSON.parse(old.response);
        }
        if (
          !Number.isInteger(body.draftRevision) ||
          record.revision !== body.draftRevision
        )
          throw new SceneError(
            "DRAFT_CONFLICT",
            "草稿已变化，请重新读取",
            409,
            { currentDraftRevision: record.revision },
          );
        const response = run(record);
        this.projects.db
          .prepare("UPDATE floorplan_drafts SET record=? WHERE id=?")
          .run(JSON.stringify(response), id);
        this.projects.db
          .prepare(
            "INSERT INTO floorplan_actions(draft,request_id,hash,response) VALUES(?,?,?,?)",
          )
          .run(id, body.requestId, digest, JSON.stringify(response));
        return response;
      })
      .immediate();
  }
  commands(project: string, id: string, body: any) {
    return this.action(project, id, body, (record) => {
      if (
        !Array.isArray(body.commands) ||
        !body.commands.length ||
        body.commands.length > 100
      )
        throw new SceneError("INVALID_REQUEST", "需要 1–100 条草稿校正");
      const data = clone(record.data) as FloorplanData;
      let corrections = record.corrections;
      for (const c of body.commands) {
        if (c.type === "calibrate") data.anchors = clone(c.anchors);
        else if (c.type === "targets") data.targetRoomIds = clone(c.roomIds);
        else if (c.type === "defaults") {
          for (const k of Object.keys(c.values || {})) {
            if (!["height", "wallThickness", "name"].includes(k))
              throw new SceneError("INVALID_REQUEST", "未知草稿默认字段");
            (data as any)[k] = clone(c.values[k]);
          }
        } else if (c.type === "upsert" || c.type === "delete") {
          if (
            ![
              "walls",
              "openings",
              "rooms",
              "symbols",
              "uncertainties",
            ].includes(c.collection)
          )
            throw new SceneError("INVALID_REQUEST", "未知草稿集合");
          const list = (data as any)[c.collection] as any[],
            oid = c.type === "upsert" ? c.object?.id : c.id,
            index = list.findIndex((o) => o.id === oid);
          identity(oid);
          if (c.type === "delete") {
            if (index < 0)
              throw new SceneError("NOT_FOUND", "草稿对象不存在", 404);
            list.splice(index, 1);
          } else if (index < 0) list.push(clone(c.object));
          else list[index] = clone(c.object);
          corrections++;
        } else throw new SceneError("INVALID_REQUEST", "未知草稿操作");
      }
      validateFloorplan(data);
      const revision = record.revision + 1,
        next = {
          ...record,
          data,
          revision,
          hash: hash({ id, revision, data }),
          confirmed: null,
          corrections,
        };
      this.projects.db
        .prepare(
          "INSERT INTO floorplan_revisions(draft,revision,record) VALUES(?,?,?)",
        )
        .run(id, revision, JSON.stringify(next));
      return next;
    });
  }
  preview(project: string, id: string, seed = id) {
    const record = this.get(project, id);
    try {
      const compiled = compileFloorplan(record.data, seed, {
          draftId: id,
          draftRevision: record.revision,
          draftHash: record.hash,
        }),
        issues = record.data.uncertainties
          .filter((u: any) => u.blocking)
          .map((u: any) => ({
            code: "FLOORPLAN_UNCERTAIN",
            message: u.message,
            objectIds: [u.id],
            level: "error",
            blocking: true,
          }));
      return {
        ...compiled,
        checks: {
          passed: !issues.length,
          issues,
          coverage: compiled.coverage,
          limitations: ["家具匹配、实际模型和截图仍需候选检查"],
        },
      };
    } catch (e) {
      if (!(e instanceof SceneError)) throw e;
      return {
        checks: {
          passed: false,
          issues: [
            {
              code: e.code,
              message: e.message,
              field: (e.details as any)?.field,
              objectIds: [],
              level: "error",
              blocking: true,
            },
          ],
          coverage: [],
          limitations: ["结构尚不可验证"],
        },
      };
    }
  }
  confirm(project: string, id: string, body: any) {
    return this.action(project, id, body, (record) => {
      const p = this.projects.get(project);
      requireBlank(p);
      if (p.revision !== record.baseRevision)
        throw new SceneError(
          "REVISION_CONFLICT",
          "项目版本已变化，需要重新核对确认",
          409,
          { currentRevision: p.revision },
        );
      if (record.hash !== body.draftHash)
        throw new SceneError("DRAFT_CONFLICT", "确认哈希与草稿不一致", 409);
      const preview = this.preview(project, id);
      if (!preview.checks.passed)
        throw new SceneError(
          "FLOORPLAN_NOT_READY",
          "请解决结构、比例或不确定项后确认",
          422,
          preview.checks,
        );
      this.verifyImage(record.data.image.id);
      return {
        ...record,
        confirmed: {
          revision: record.revision,
          hash: record.hash,
          projectRevision: p.revision,
          requestId: body.requestId,
          confirmedAt: new Date().toISOString(),
        },
      };
    });
  }
  confirmed(project: string, binding: FloorplanBinding) {
    if (!binding || typeof binding.draftId !== "string")
      throw new SceneError(
        "CONFIRMATION_REQUIRED",
        "需要已确认的户型草稿",
        409,
      );
    const r = this.get(project, binding.draftId);
    if (
      r.revision !== binding.draftRevision ||
      r.hash !== binding.draftHash ||
      r.confirmed?.hash !== r.hash ||
      r.confirmed?.revision !== r.revision
    )
      throw new SceneError("DRAFT_CONFLICT", "草稿已变化或尚未确认", 409);
    this.verifyImage(r.data.image.id);
    return r;
  }
}
