import Database from "better-sqlite3";
import { migrate } from "./migrations.js";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  applyCommands,
  assetReferences,
  importDocument,
  newId,
  SceneError,
  type AssetRecord,
  type Mutation,
  type Project,
  type SceneState,
} from "../../../packages/scene-core/src/index.js";
type Entry = {
  id: string;
  summary: string;
  at: string;
  before: SceneState;
  after: SceneState;
};
type Row = {
  id: string;
  revision: number;
  state: string;
  timeline: string;
  cursor: number;
  updated: string;
};
export const canonical = (value: any): string =>
  value && typeof value === "object"
    ? Array.isArray(value)
      ? `[${value.map(canonical).join(",")}]`
      : `{${Object.keys(value)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
          .join(",")}}`
    : JSON.stringify(value);
export class ProjectStore {
  db: Database.Database;
  constructor(public directory: string) {
    fs.mkdirSync(path.join(directory, "assets"), { recursive: true });
    this.db = new Database(path.join(directory, "projects.sqlite"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("synchronous = FULL");
    migrate(this.db);
  }
  close() {
    this.db.close();
  }
  private row(id: string): Row {
    const row = this.db.prepare("SELECT * FROM projects WHERE id=?").get(id) as
      Row | undefined;
    if (!row) throw new SceneError("NOT_FOUND", "项目不存在", 404);
    return row;
  }
  private document(row: Row): Project {
    const state = JSON.parse(row.state),
      timeline = JSON.parse(row.timeline);
    return {
      ...state,
      formatVersion: 1,
      id: row.id,
      revision: row.revision,
      updatedAt: row.updated,
      assets: assetReferences(state.plan),
      history: { undo: row.cursor, redo: timeline.length - row.cursor },
    };
  }
  get(id: string) {
    return this.document(this.row(id));
  }
  list() {
    return (
      this.db
        .prepare("SELECT * FROM projects ORDER BY updated DESC")
        .all() as Row[]
    ).map((r) => ({
      id: r.id,
      name: JSON.parse(r.state).plan.name,
      revision: r.revision,
      updatedAt: r.updated,
    }));
  }
  asset(id: string): AssetRecord {
    const row = this.db
      .prepare("SELECT record FROM assets WHERE id=?")
      .get(id) as { record: string } | undefined;
    if (!row) throw new SceneError("NOT_FOUND", "资产不存在", 404);
    return JSON.parse(row.record);
  }
  assets(): AssetRecord[] {
    return (
      this.db
        .prepare("SELECT record FROM assets ORDER BY rowid DESC")
        .all() as { record: string }[]
    ).map((row) => JSON.parse(row.record));
  }
  assetPath(id: string) {
    this.asset(id);
    return path.join(this.directory, "assets", `${id}.glb`);
  }
  updateAsset(record: AssetRecord) {
    this.db
      .prepare("UPDATE assets SET record=? WHERE id=?")
      .run(JSON.stringify(record), record.id);
    return this.asset(record.id);
  }
  saveAsset(record: AssetRecord, buffer: Buffer) {
    const destination = path.join(this.directory, "assets", `${record.id}.glb`);
    if (!fs.existsSync(destination)) {
      const temporary = `${destination}.${newId()}.tmp`;
      const fd = fs.openSync(temporary, "wx");
      try {
        fs.writeFileSync(fd, buffer);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temporary, destination);
    }
    this.db
      .prepare("INSERT OR IGNORE INTO assets(id,record) VALUES(?,?)")
      .run(record.id, JSON.stringify(record));
    return this.asset(record.id);
  }
  private checkAssets(state: SceneState) {
    const source = state.plan.source;
    if (source?.kind === "floorplan") {
      const image = this.db
        .prepare("SELECT record FROM floorplan_images WHERE id=?")
        .get(source.imageId) as any;
      const file = path.join(
        this.directory,
        "floorplan-images",
        source.imageId,
        "original",
      );
      if (
        !image ||
        JSON.parse(image.record).sha256 !== source.imageHash ||
        !fs.existsSync(file)
      )
        throw new SceneError(
          "MISSING_SOURCE_IMAGES",
          "请上传缺失户型原图并提供 imageMap 映射",
          422,
          { missing: [source.imageId] },
        );
    }
    const missing = assetReferences(state.plan).filter(
      (id) => !this.db.prepare("SELECT id FROM assets WHERE id=?").get(id),
    );
    if (missing.length)
      throw new SceneError(
        "MISSING_ASSETS",
        "请上传缺失模型并提供 assetMap 映射后重新导入",
        422,
        { missing },
      );
  }
  create(
    input: any,
    assetMap: Record<string, string> = {},
    imageMap: Record<string, string> = {},
  ) {
    const state = importDocument(input, assetMap);
    if (
      state.plan.source?.kind === "floorplan" &&
      imageMap[state.plan.source.imageId]
    ) {
      const mapped = this.db
        .prepare("SELECT record FROM floorplan_images WHERE id=?")
        .get(imageMap[state.plan.source.imageId]) as any;
      if (!mapped)
        throw new SceneError("MISSING_SOURCE_IMAGES", "图片映射不存在", 422);
      const image = JSON.parse(mapped.record);
      if (image.sha256 !== state.plan.source.imageHash)
        throw new SceneError(
          "SOURCE_IMAGE_INVALID",
          "映射原图校验值不同，不能替换已确认布局的来源",
          422,
        );
      state.plan.source.imageId = image.id;
    }
    this.checkAssets(state);
    const row: Row = {
      id: newId(),
      revision: 0,
      state: JSON.stringify(state),
      timeline: "[]",
      cursor: 0,
      updated: new Date().toISOString(),
    };
    this.db
      .prepare(
        "INSERT INTO projects(id,revision,state,timeline,cursor,updated) VALUES(@id,@revision,@state,@timeline,@cursor,@updated)",
      )
      .run(row);
    return this.document(row);
  }
  history(id: string) {
    const row = this.row(id);
    return {
      cursor: row.cursor,
      limit: 200,
      entries: (JSON.parse(row.timeline) as Entry[]).map(
        ({ id, summary, at }, i) => ({
          id,
          summary,
          at,
          applied: i < row.cursor,
        }),
      ),
      operations: this.db
        .prepare(
          "SELECT id,kind,created FROM operations WHERE project=? ORDER BY rowid DESC LIMIT 1000",
        )
        .all(id),
    };
  }
  mutate(
    id: string,
    kind: "commands" | "undo" | "redo",
    request: Mutation,
  ): { project: Project; replayed: boolean } {
    if (
      !request ||
      typeof request.operationId !== "string" ||
      !request.operationId ||
      request.operationId.length > 200 ||
      !Number.isInteger(request.baseRevision) ||
      request.baseRevision < 0
    )
      throw new SceneError(
        "INVALID_REQUEST",
        "需要 operationId 和非负 baseRevision",
      );
    const hash = createHash("sha256")
      .update(canonical({ kind, request }))
      .digest("hex");
    return this.db
      .transaction(() => {
        const row = this.row(id);
        const previous = this.db
          .prepare(
            "SELECT hash,response FROM operations WHERE project=? AND id=?",
          )
          .get(id, request.operationId) as
          { hash: string; response: string } | undefined;
        if (previous) {
          if (previous.hash !== hash)
            throw new SceneError(
              "OPERATION_CONFLICT",
              "相同操作身份对应不同请求",
              409,
            );
          return { project: JSON.parse(previous.response), replayed: true };
        }
        if (row.revision !== request.baseRevision)
          throw new SceneError(
            "REVISION_CONFLICT",
            "项目已被修改，请读取最新版本后重新操作",
            409,
            { currentRevision: row.revision },
          );
        let state: SceneState = JSON.parse(row.state),
          timeline: Entry[] = JSON.parse(row.timeline),
          cursor = row.cursor;
        if (kind === "commands") {
          const after = applyCommands(state, request.commands!);
          this.checkAssets(after);
          timeline = timeline.slice(0, cursor);
          timeline.push({
            id: request.operationId,
            summary: request.summary?.slice(0, 200) || "场景编辑",
            at: new Date().toISOString(),
            before: state,
            after,
          });
          if (timeline.length > 200) timeline = timeline.slice(-200);
          cursor = timeline.length;
          state = after;
        } else if (kind === "undo") {
          if (!cursor) throw new SceneError("NO_UNDO", "没有可撤销的修改", 409);
          state = timeline[--cursor].before;
        } else {
          if (cursor === timeline.length)
            throw new SceneError("NO_REDO", "没有可重做的修改", 409);
          state = timeline[cursor++].after;
        }
        this.checkAssets(state);
        const next = {
          ...row,
          state: JSON.stringify(state),
          timeline: JSON.stringify(timeline),
          cursor,
          revision: row.revision + 1,
          updated: new Date().toISOString(),
        };
        const project = this.document(next);
        this.db
          .prepare(
            "UPDATE projects SET revision=@revision,state=@state,timeline=@timeline,cursor=@cursor,updated=@updated WHERE id=@id",
          )
          .run(next);
        this.db
          .prepare(
            "INSERT INTO operations(project,id,hash,kind,response,created) VALUES(?,?,?,?,?,?)",
          )
          .run(
            id,
            request.operationId,
            hash,
            kind,
            JSON.stringify(project),
            next.updated,
          );
        return { project, replayed: false };
      })
      .immediate();
  }
}
