import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { ProjectStore, canonical } from "./store.js";
import {
  applyCommands,
  assetReferences,
  clone,
  newId,
  SceneError,
  type Command,
  type SceneState,
  collections,
} from "../../../packages/scene-core/src/index.js";
import {
  compileRectangular,
  checkInitialization,
  requireBlank,
  structuralDiff,
  type RectangularBrief,
} from "../../../packages/scene-core/src/rectangular.js";
import {
  materializeEdits,
  validateScope,
  businessDiff,
  checkCandidate,
  type CandidateEdit,
  type EditScope,
} from "../../../packages/scene-core/src/candidate.js";

export const sha256 = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export interface Evidence {
  view: "top" | "oblique";
  sha256: string;
  candidateHash: string;
  bytes: number;
  createdAt: string;
  presentation: string;
}
export interface CandidateReview {
  passed: boolean;
  source: "agent" | "operator";
  summary: string;
  objectIds: string[];
  evidenceHashes: string[];
  issues: string[];
}
export class CandidateStore {
  constructor(public projects: ProjectStore) {
    if (Number(projects.db.pragma("user_version", { simple: true })) > 2)
      throw new SceneError(
        "UNSUPPORTED_DATABASE",
        "数据库版本高于当前业务版本，请使用对应版本恢复",
        500,
      );
    projects.db
      .transaction(() => {
        projects.db
          .exec(`CREATE TABLE IF NOT EXISTS candidates(id TEXT PRIMARY KEY,project TEXT NOT NULL REFERENCES projects(id),request_id TEXT NOT NULL,request_hash TEXT NOT NULL,document TEXT NOT NULL,evidence TEXT NOT NULL DEFAULT '[]',review TEXT,committed TEXT,UNIQUE(project,request_id));
      CREATE INDEX IF NOT EXISTS candidates_project ON candidates(project);`);
        projects.db.pragma("user_version = 2");
      })
      .immediate();
    fs.mkdirSync(path.join(projects.directory, "evidence"), {
      recursive: true,
    });
  }
  private row(project: string, id: string): any {
    const row = this.projects.db
      .prepare("SELECT * FROM candidates WHERE project=? AND id=?")
      .get(project, id);
    if (!row) throw new SceneError("NOT_FOUND", "候选不存在", 404);
    return row;
  }
  get(project: string, id: string) {
    const row = this.row(project, id),
      { before, ...document } = JSON.parse(row.document);
    return {
      ...document,
      evidence: JSON.parse(row.evidence),
      review: row.review ? JSON.parse(row.review) : null,
      committed: row.committed
        ? JSON.parse(row.committed).project.revision
        : null,
    };
  }
  list(project: string) {
    this.projects.get(project);
    return (
      this.projects.db
        .prepare(
          "SELECT id FROM candidates WHERE project=? ORDER BY rowid DESC LIMIT 100",
        )
        .all(project) as { id: string }[]
    ).map((row) => {
      const c = this.get(project, row.id);
      return {
        id: c.id,
        taskId: c.taskId,
        baseRevision: c.baseRevision,
        createdAt: c.createdAt,
        diff: c.diff,
        passed: c.checks.passed,
        committed: c.committed,
      };
    });
  }
  create(
    project: string,
    request: {
      requestId: string;
      taskId: string;
      baseRevision: number;
      scope: EditScope;
      edits: CandidateEdit[];
      summary?: string;
      kind?: "edit" | "initialize";
      brief?: RectangularBrief;
    },
  ) {
    if (
      !request ||
      typeof request.requestId !== "string" ||
      !request.requestId ||
      request.requestId.length > 200 ||
      typeof request.taskId !== "string" ||
      !request.taskId ||
      request.taskId.length > 200 ||
      !Number.isInteger(request.baseRevision)
    )
      throw new SceneError(
        "INVALID_REQUEST",
        "候选需要 requestId、taskId 和 baseRevision",
      );
    if (
      request.summary !== undefined &&
      (typeof request.summary !== "string" || request.summary.length > 200)
    )
      throw new SceneError("INVALID_REQUEST", "摘要必须是最多 200 字的字符串");
    const requestHash = sha256(request);
    return this.projects.db
      .transaction(() => {
        const previous = this.projects.db
          .prepare(
            "SELECT id,request_hash FROM candidates WHERE project=? AND request_id=?",
          )
          .get(project, request.requestId) as any;
        if (previous) {
          if (previous.request_hash !== requestHash)
            throw new SceneError(
              "OPERATION_CONFLICT",
              "相同候选请求身份对应不同内容",
              409,
            );
          return this.get(project, previous.id);
        }
        const base = this.projects.get(project);
        if (base.revision !== request.baseRevision)
          throw new SceneError("REVISION_CONFLICT", "项目版本已变化", 409, {
            currentRevision: base.revision,
          });
        const before: SceneState = {
          plan: base.plan,
          roomLabelArchive: base.roomLabelArchive,
        };
        if (
          request.kind !== undefined &&
          !["edit", "initialize"].includes(request.kind)
        )
          throw new SceneError("INVALID_REQUEST", "未知候选类型");
        const initialization = request.kind === "initialize";
        if (!initialization && request.brief !== undefined)
          throw new SceneError("INVALID_REQUEST", "编辑候选不能改变房间结构");
        if (initialization) requireBlank(before);
        const compiled = initialization
          ? compileRectangular(request.brief!, request.taskId)
          : undefined;
        const source = compiled?.state || before;
        const scope = validateScope(request.scope, source.plan),
          edits = materializeEdits(source, scope, request.edits),
          commands = [...(compiled?.commands || []), ...edits],
          state = applyCommands(before, commands);
        for (const id of assetReferences(state.plan)) this.projects.asset(id);
        const id = newId(),
          checks = initialization
            ? checkInitialization(
                before,
                state,
                request.brief!,
                request.taskId,
                scope,
              )
            : checkCandidate(before, state, scope),
          diff = businessDiff(base.plan, state.plan);
        if (!diff.added.length && !diff.updated.length && !diff.deleted.length)
          throw new SceneError("NO_CHANGE", "候选没有产生业务修改");
        const frozen = {
          id,
          projectId: project,
          taskId: request.taskId,
          baseRevision: base.revision,
          scope,
          commands,
          state,
          diff,
          checks,
          summary: request.summary || "Agent 局部编辑",
          operationId: `candidate:${id}`,
          createdAt: new Date().toISOString(),
          ...(compiled
            ? {
                kind: "initialize",
                generation: {
                  brief: compiled.brief,
                  dimensions: compiled.dimensions,
                  openings: compiled.openings,
                  defaults: compiled.defaults,
                },
                structure: structuralDiff(base.plan, state.plan),
              }
            : {}),
        };
        const document = { ...frozen, hash: sha256(frozen), before };
        this.projects.db
          .prepare(
            "INSERT INTO candidates(id,project,request_id,request_hash,document) VALUES(?,?,?,?,?)",
          )
          .run(
            id,
            project,
            request.requestId,
            requestHash,
            JSON.stringify(document),
          );
        return this.get(project, id);
      })
      .immediate();
  }
  evidencePath(project: string, id: string, view: string) {
    this.row(project, id);
    if (!["top", "oblique"].includes(view))
      throw new SceneError("NOT_FOUND", "证据视角不存在", 404);
    return path.join(this.projects.directory, "evidence", id, `${view}.png`);
  }
  saveEvidence(
    project: string,
    id: string,
    images: { view: "top" | "oblique"; data: Buffer }[],
  ) {
    const c = this.get(project, id),
      directory = path.join(this.projects.directory, "evidence", id);
    fs.mkdirSync(directory, { recursive: true });
    const evidence: Evidence[] = images.map(({ view, data }) => {
      if (
        data.length < 100 ||
        !data
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
        throw new SceneError("RENDER_FAILED", "渲染没有返回有效 PNG", 503);
      const file = this.evidencePath(project, id, view),
        temporary = file + ".tmp";
      fs.writeFileSync(temporary, data);
      fs.renameSync(temporary, file);
      return {
        view,
        sha256: createHash("sha256").update(data).digest("hex"),
        candidateHash: c.hash,
        bytes: data.length,
        createdAt: new Date().toISOString(),
        presentation:
          "检查视图：墙体 15% 不透明度、吊顶隐藏；对象网格和变换保持候选数据",
      };
    });
    this.projects.db
      .prepare("UPDATE candidates SET evidence=?,review=NULL WHERE id=?")
      .run(JSON.stringify(evidence), id);
    return evidence;
  }
  verifyEvidence(project: string, id: string): Evidence[] {
    const c = this.get(project, id),
      evidence = c.evidence as Evidence[];
    if (
      evidence.length !== 2 ||
      new Set(evidence.map((e) => e.view)).size !== 2
    )
      throw new SceneError("EVIDENCE_REQUIRED", "需要俯视与斜视截图", 409);
    for (const e of evidence) {
      const file = this.evidencePath(project, id, e.view);
      if (
        e.candidateHash !== c.hash ||
        !fs.existsSync(file) ||
        createHash("sha256").update(fs.readFileSync(file)).digest("hex") !==
          e.sha256
      )
        throw new SceneError(
          "EVIDENCE_INVALID",
          "候选证据缺失或校验值改变",
          409,
        );
    }
    return evidence;
  }
  review(project: string, id: string, review: CandidateReview) {
    const c = this.get(project, id),
      evidence = this.verifyEvidence(project, id);
    if (
      !review ||
      typeof review.passed !== "boolean" ||
      !["agent", "operator"].includes(review.source) ||
      typeof review.summary !== "string" ||
      review.summary.length > 4000 ||
      !Array.isArray(review.issues) ||
      review.issues.length > 50 ||
      review.issues.some((x) => typeof x !== "string") ||
      !Array.isArray(review.objectIds) ||
      review.objectIds.some((x) => typeof x !== "string") ||
      !Array.isArray(review.evidenceHashes) ||
      canonical([...review.evidenceHashes].sort()) !==
        canonical(evidence.map((e) => e.sha256).sort()) ||
      (review.passed && review.issues.length)
    )
      throw new SceneError(
        "INVALID_REVIEW",
        "检查意见必须包含有效结论和两个证据校验值",
      );
    const validIds = new Set([
      ...collections.flatMap((key) => c.state.plan[key].map((o: any) => o.id)),
      ...c.diff.deleted,
    ]);
    if (review.objectIds.some((id) => !validIds.has(id)))
      throw new SceneError("INVALID_REVIEW", "检查意见包含未知对象身份");
    this.projects.db
      .prepare("UPDATE candidates SET review=? WHERE id=?")
      .run(JSON.stringify(review), id);
    return this.get(project, id);
  }
  commit(
    project: string,
    id: string,
    request: {
      operationId: string;
      baseRevision: number;
      candidateHash: string;
    },
  ) {
    return this.projects.db
      .transaction(() => {
        const row = this.row(project, id),
          c = JSON.parse(row.document);
        if (
          !request ||
          request.operationId !== c.operationId ||
          request.baseRevision !== c.baseRevision ||
          request.candidateHash !== c.hash
        )
          throw new SceneError(
            "OPERATION_CONFLICT",
            "提交必须对应同一个固定候选",
            409,
          );
        if (row.committed)
          return { ...JSON.parse(row.committed), replayed: true };
        const current = this.projects.get(project);
        if (current.revision !== c.baseRevision)
          throw new SceneError("REVISION_CONFLICT", "候选版本已过期", 409, {
            currentRevision: current.revision,
          });
        const { hash, before, ...frozen } = c;
        if (sha256(frozen) !== hash)
          throw new SceneError("CANDIDATE_INVALID", "候选内容校验失败", 409);
        const replay = applyCommands(
          { plan: current.plan, roomLabelArchive: current.roomLabelArchive },
          c.commands as Command[],
        );
        if (
          sha256(replay) !== sha256(c.state) ||
          !(
            c.kind === "initialize"
              ? checkInitialization(
                  before,
                  replay,
                  c.generation.brief,
                  c.taskId,
                  c.scope,
                )
              : checkCandidate(before, replay, c.scope)
          ).passed
        )
          throw new SceneError("CHECK_FAILED", "候选未通过确定性检查", 409);
        this.verifyEvidence(project, id);
        const review = row.review ? JSON.parse(row.review) : null;
        if (!review?.passed || review.issues.length)
          throw new SceneError("REVIEW_REQUIRED", "检查尚未通过", 409);
        const result = this.projects.mutate(project, "commands", {
          operationId: c.operationId,
          baseRevision: c.baseRevision,
          commands: c.commands,
          summary: c.summary,
        });
        this.projects.db
          .prepare("UPDATE candidates SET committed=? WHERE id=?")
          .run(JSON.stringify(result), id);
        return result;
      })
      .immediate();
  }
}
