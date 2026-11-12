import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { ProjectStore, canonical } from "./store.js";
import { FloorplanStore } from "./floorplans.js";
import {
  compileFloorplan,
  materializeFloorplan,
  checkFloorplanInitialization,
  type FloorplanBinding,
  type SymbolMatch,
} from "../../../packages/scene-core/src/floorplan.js";
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
  source: "agent" | "operator" | "deterministic";
  summary: string;
  objectIds: string[];
  evidenceHashes: string[];
  issues: string[];
}
import {
  EditAuthorizations,
  checkExpected,
  type AuthorizationRequest,
} from "./edit-authorizations.js";

export class CandidateStore {
  constructor(
    public projects: ProjectStore,
    public floorplans = new FloorplanStore(projects),
  ) {
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
  authorize(project: string, request: AuthorizationRequest) {
    return new EditAuthorizations(this.projects).register(project, request);
  }
  create(
    project: string,
    request: {
      requestId: string;
      taskId: string;
      baseRevision: number;
      scope?: EditScope;
      edits?: CandidateEdit[];
      summary?: string;
      kind?: "edit" | "initialize" | "initialize_floorplan";
      floorplan?: FloorplanBinding;
      matches?: SymbolMatch[];
      brief?: RectangularBrief;
      activityGroups?: { name: string; memberIds: string[] }[];
      verification?: "screenshots" | "deterministic";
      authorizationVersion?: number;
      authorizationScopeHash?: string;
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
    let verification = request.verification || "screenshots";
    if (!["screenshots", "deterministic"].includes(verification))
      throw new SceneError("INVALID_REQUEST", "候选检查策略无效");
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
          !["edit", "initialize", "initialize_floorplan"].includes(request.kind)
        )
          throw new SceneError("INVALID_REQUEST", "未知候选类型");
        const initialization = request.kind === "initialize";
        const reconstruction = request.kind === "initialize_floorplan";
        if (!initialization && request.brief !== undefined)
          throw new SceneError("INVALID_REQUEST", "编辑候选不能改变房间结构");
        if (
          !reconstruction &&
          (request.floorplan !== undefined || request.matches !== undefined)
        )
          throw new SceneError(
            "INVALID_REQUEST",
            "编辑候选不能携带户型初始化字段",
          );
        if (initialization || reconstruction) requireBlank(before);
        const draft = reconstruction
          ? this.floorplans.confirmed(project, request.floorplan!)
          : undefined;
        if (draft && draft.baseRevision !== base.revision)
          throw new SceneError(
            "REVISION_CONFLICT",
            "草稿确认对应的正式项目版本已变化",
            409,
          );
        if (
          reconstruction &&
          (request.edits?.length || request.scope !== undefined)
        )
          throw new SceneError(
            "INVALID_REQUEST",
            "户型复现只能使用已确认符号，不能另传编辑布局或授权范围",
          );
        const reconstructed = draft
          ? materializeFloorplan(
              draft.data,
              request.taskId,
              request.floorplan!,
              request.matches!,
            )
          : undefined;
        const compiled = initialization
          ? compileRectangular(request.brief!, request.taskId)
          : undefined;
        const source = compiled?.state || before;
        const scope =
          reconstructed?.scope || validateScope(request.scope, source.plan);
        const authorizationVersion = request.authorizationVersion;
        let authorizationScopeHash = request.authorizationScopeHash;
        let authorization: any;
        if (initialization) {
          if (
            authorizationVersion !== undefined ||
            authorizationScopeHash !== undefined
          ) {
            if (!authorizationVersion || !authorizationScopeHash)
              throw new SceneError(
                "INVALID_AUTHORIZATION",
                "初始化候选必须同时携带授权版本和哈希",
              );
            authorization = new EditAuthorizations(this.projects).assert(
              project,
              request.taskId,
              authorizationVersion,
              request.baseRevision,
              authorizationScopeHash,
              scope,
              "initialize",
            );
            if (
              sha256(request.brief) !== authorization.briefHash ||
              authorization.furnitureCount !==
                scope.requirements.reduce((sum, rule) => sum + rule.count, 0)
            )
              throw new SceneError(
                "AUTHORIZATION_CONFLICT",
                "初始化候选的冻结结构或家具数量与授权不一致",
                409,
              );
          } else if (
            this.projects.db
              .prepare(
                "SELECT 1 FROM edit_authorization_heads WHERE project=? AND task_id=?",
              )
              .get(project, request.taskId)
          )
            throw new SceneError(
              "AUTHORIZATION_REQUIRED",
              "此任务的初始化候选必须引用独立授权",
              409,
            );
          // Initialization always renders two views and requires a visual
          // review; request.verification cannot bypass that policy.
          verification = "screenshots";
        } else if (!reconstruction) {
          if (
            authorizationVersion !== undefined ||
            authorizationScopeHash !== undefined
          ) {
            if (!authorizationVersion || !authorizationScopeHash)
              throw new SceneError(
                "INVALID_AUTHORIZATION",
                "候选必须同时携带授权版本和哈希",
              );
            authorization = new EditAuthorizations(this.projects).assert(
              project,
              request.taskId,
              authorizationVersion,
              request.baseRevision,
              authorizationScopeHash,
              scope,
            );
            verification = authorization.verification;
          } else {
            if (
              this.projects.db
                .prepare(
                  "SELECT 1 FROM edit_authorization_heads WHERE project=? AND task_id=?",
                )
                .get(project, request.taskId)
            )
              throw new SceneError(
                "AUTHORIZATION_REQUIRED",
                "此任务候选必须引用独立授权",
                409,
              );
            // The legacy protocol is retained for existing tools and stored
            // candidates. It never grants the new exact-edit exemption.
            authorizationScopeHash = sha256(scope);
            this.projects.freezeCandidateAuthorization(
              project,
              request.taskId,
              authorizationScopeHash,
              scope,
            );
            verification =
              request.edits?.length &&
              request.edits.every(
                (edit) => edit.type === "action" || edit.type === "placeAsset",
              )
                ? "deterministic"
                : "screenshots";
          }
        } else verification = "screenshots";
        if (
          verification === "deterministic" &&
          !request.edits?.every((edit) =>
            authorization?.operations?.length
              ? edit.type === "update" || edit.type === "delete"
              : edit.type === "action" || edit.type === "placeAsset",
          )
        )
          throw new SceneError(
            "INVALID_AUTHORIZATION",
            "候选编辑与确定性授权类型不一致",
          );
        const edits = reconstructed
            ? []
            : materializeEdits(source, scope, request.edits!),
          contentCommands = reconstructed?.commands || [
            ...(compiled?.commands || []),
            ...edits,
          ],
          contentState = applyCommands(before, contentCommands);
        let commands = contentCommands;
        let state = contentState;
        if (
          request.activityGroups !== undefined &&
          request.activityGroups.length
        ) {
          if (
            authorization &&
            (!scope.allowActivityGroups || authorization.operations?.length)
          )
            throw new SceneError(
              "INVALID_AUTHORIZATION",
              "候选不能附带未授权的活动组元数据",
            );
          if (
            !Array.isArray(request.activityGroups) ||
            request.activityGroups.length > 100
          )
            throw new SceneError("INVALID_REQUEST", "活动组元数据无效");
          const furniture = new Set(
              contentState.plan.furniture.map((f) => f.id),
            ),
            groupIds = new Set<string>();
          const activityGroups = request.activityGroups.map((group) => {
            if (
              !group ||
              typeof group.name !== "string" ||
              !group.name.trim() ||
              group.name.length > 100 ||
              !Array.isArray(group.memberIds) ||
              !group.memberIds.length ||
              group.memberIds.length > 50 ||
              new Set(group.memberIds).size !== group.memberIds.length ||
              group.memberIds.some(
                (id) => typeof id !== "string" || !furniture.has(id),
              )
            )
              throw new SceneError("INVALID_REQUEST", "活动组成员或名称无效");
            const id =
              "ag_" +
              sha256({
                taskId: request.taskId,
                name: group.name,
                memberIds: group.memberIds,
              }).slice(0, 16);
            if (groupIds.has(id))
              throw new SceneError("INVALID_REQUEST", "活动组身份重复");
            groupIds.add(id);
            const roles = Object.fromEntries(
              group.memberIds.map((member, index) => [
                member,
                index === 0 ? "primary" : "member",
              ]),
            );
            return {
              id,
              name: group.name,
              type: "custom",
              primaryObjectId: group.memberIds[0],
              memberObjectIds: group.memberIds,
              roles,
            };
          });
          const projectCommand: Command = {
            type: "project",
            patch: {
              source: {
                ...(contentState.plan.source || {}),
                kind: contentState.plan.source?.kind || "activity-groups",
                activityGroups,
              },
            },
          };
          commands = [...contentCommands, projectCommand];
          state = applyCommands(contentState, [projectCommand]);
        }
        for (const id of assetReferences(state.plan)) this.projects.asset(id);
        const id = newId();
        const rawChecks = reconstructed
            ? checkFloorplanInitialization(
                before,
                state,
                draft.data,
                request.taskId,
                request.floorplan!,
                request.matches!,
              )
            : initialization
              ? checkInitialization(
                  before,
                  state,
                  request.brief!,
                  request.taskId,
                  scope,
                )
              : checkCandidate(before, state, scope),
          diff = businessDiff(base.plan, state.plan);
        const checks = checkExpected(rawChecks, state, authorization);
        if (!diff.added.length && !diff.updated.length && !diff.deleted.length)
          throw new SceneError("NO_CHANGE", "候选没有产生业务修改");
        const frozen = {
          id,
          projectId: project,
          taskId: request.taskId,
          baseRevision: base.revision,
          scope,
          ...(authorizationScopeHash ? { authorizationScopeHash } : {}),
          ...(authorizationVersion ? { authorizationVersion } : {}),
          commands,
          state,
          diff,
          checks,
          summary: request.summary || "Agent 局部编辑",
          verification,
          operationId: `candidate:${id}`,
          createdAt: new Date().toISOString(),
          ...(reconstructed
            ? {
                kind: "initialize_floorplan",
                floorplan: {
                  binding: request.floorplan,
                  data: draft.data,
                  matches: request.matches,
                },
                generation: {
                  mode: "reconstruct_floorplan",
                  image: draft.data.image,
                  scale: reconstructed.scale,
                  defaults: reconstructed.defaults,
                  symbols: reconstructed.symbols,
                  rooms: reconstructed.rooms,
                  targetRoomIds: reconstructed.targetRoomIds,
                  draftId: draft.id,
                  draftRevision: draft.revision,
                  draftHash: draft.hash,
                  corrections: draft.corrections,
                },
                structure: structuralDiff(base.plan, state.plan),
              }
            : {}),
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
    const c = this.get(project, id);
    if (c.authorizationVersion)
      new EditAuthorizations(this.projects).assert(
        project,
        c.taskId,
        c.authorizationVersion,
        c.baseRevision,
        c.authorizationScopeHash,
        c.scope,
        c.kind === "initialize" ? "initialize" : "edit",
      );
    const evidence =
      c.verification === "deterministic"
        ? []
        : this.verifyEvidence(project, id);
    if (
      !review ||
      typeof review.passed !== "boolean" ||
      !["agent", "operator", "deterministic"].includes(review.source) ||
      (c.verification === "deterministic"
        ? review.source !== "deterministic"
        : review.source === "deterministic") ||
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
        const authorization = c.authorizationVersion
          ? new EditAuthorizations(this.projects).assert(
              project,
              c.taskId,
              c.authorizationVersion,
              c.baseRevision,
              c.authorizationScopeHash,
              c.scope,
              c.kind === "initialize" ? "initialize" : "edit",
            )
          : undefined;
        if (
          c.kind === "initialize" &&
          c.authorizationVersion &&
          sha256(c.generation.brief) !== authorization.briefHash
        )
          throw new SceneError(
            "AUTHORIZATION_CONFLICT",
            "候选冻结需求已被授权替换或篡改",
            409,
          );
        if (
          !c.authorizationVersion &&
          this.projects.db
            .prepare(
              "SELECT 1 FROM edit_authorization_heads WHERE project=? AND task_id=?",
            )
            .get(project, c.taskId)
        )
          throw new SceneError(
            "AUTHORIZATION_CONFLICT",
            "旧协议候选已被新的需求版本替代",
            409,
          );
        if (c.authorizationScopeHash && !c.authorizationVersion)
          this.projects.assertCandidateAuthorization(
            project,
            c.taskId,
            c.authorizationScopeHash,
          );
        if (c.kind === "initialize_floorplan") {
          const draft = this.floorplans.confirmed(project, c.floorplan.binding);
          if (sha256(draft.data) !== sha256(c.floorplan.data))
            throw new SceneError("DRAFT_CONFLICT", "确认草稿与候选不一致", 409);
        }
        const replay = applyCommands(
          { plan: current.plan, roomLabelArchive: current.roomLabelArchive },
          c.commands as Command[],
        );
        if (
          sha256(replay) !== sha256(c.state) ||
          !(
            c.kind === "initialize_floorplan"
              ? checkFloorplanInitialization(
                  before,
                  replay,
                  c.floorplan.data,
                  c.taskId,
                  c.floorplan.binding,
                  c.floorplan.matches,
                )
              : c.kind === "initialize"
                ? checkInitialization(
                    before,
                    replay,
                    c.generation.brief,
                    c.taskId,
                    c.scope,
                  )
                : checkExpected(
                    checkCandidate(before, replay, c.scope),
                    replay,
                    authorization,
                  )
          ).passed
        )
          throw new SceneError("CHECK_FAILED", "候选未通过确定性检查", 409);
        if (c.verification !== "deterministic")
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
