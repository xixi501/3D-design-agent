/** Independent authorization owned by the code supervisor, never by design tools. */
import { createHash } from "node:crypto";
import { ProjectStore, canonical } from "./store.js";
import {
  SceneError,
  clone,
  type SceneState,
} from "../../../packages/scene-core/src/index.js";
import {
  validateScope,
  type EditScope,
  type CheckReport,
} from "../../../packages/scene-core/src/candidate.js";
import {
  compileRectangular,
  requireBlank,
  type RectangularBrief,
} from "../../../packages/scene-core/src/rectangular.js";

const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const fields = ["x", "y", "z", "rot", "w", "d", "h", "color"];
export interface ExactOperation {
  target_id: string;
  action: "update" | "delete";
  values?: Record<string, number | string>;
  deltas?: Record<string, number>;
  source_quote: string;
}
export type AuthorizationKind = "edit" | "initialize";
export interface AuthorizationRequest {
  taskId: string;
  baseRevision: number;
  version: number;
  requestText: string;
  /** Omitted keeps the historical edit protocol. */
  kind?: AuthorizationKind;
  /** Required for initialize: the frozen rectangular brief. */
  brief?: RectangularBrief;
  referenceIds?: string[];
  operations?: ExactOperation[];
  scope: EditScope;
}
export class EditAuthorizations {
  constructor(private projects: ProjectStore) {}
  invalidate(project: string, taskId: string, version: number) {
    this.projects.get(project);
    if (!taskId || !Number.isInteger(version) || version < 1)
      throw new SceneError("INVALID_AUTHORIZATION", "授权需求版本无效");
    this.projects.db
      .prepare(
        `INSERT INTO edit_authorization_heads(project,task_id,version) VALUES(?,?,?)
      ON CONFLICT(project,task_id) DO UPDATE SET version=MAX(version,excluded.version)`,
      )
      .run(project, taskId, version);
    return { version };
  }
  register(project: string, request: AuthorizationRequest) {
    return this.projects.db
      .transaction(() => {
        if (
          !request ||
          typeof request.taskId !== "string" ||
          !request.taskId ||
          !Number.isInteger(request.version) ||
          request.version < 1 ||
          !Number.isInteger(request.baseRevision) ||
          typeof request.requestText !== "string" ||
          !request.requestText.trim()
        )
          throw new SceneError(
            "INVALID_AUTHORIZATION",
            "授权需要任务、需求版本和用户原文",
          );
        const kind = request.kind ?? "edit";
        if (!["edit", "initialize"].includes(kind))
          throw new SceneError("INVALID_AUTHORIZATION", "未知授权用途");
        const base = this.projects.get(project);
        if (base.revision !== request.baseRevision)
          throw new SceneError("REVISION_CONFLICT", "授权基准版本已变化", 409);
        let initialization:
          | {
              brief: RectangularBrief;
              briefHash: string;
              furnitureCount: number;
              shell: SceneState["plan"];
            }
          | undefined;
        if (kind === "initialize") {
          if (
            request.operations?.length ||
            request.referenceIds?.length ||
            !request.brief
          )
            throw new SceneError(
              "INVALID_AUTHORIZATION",
              "初始化授权不能包含编辑操作、参考物，并且必须绑定冻结 brief",
            );
          // The authorization owns the frozen structure; the candidate may
          // never submit a different shell under the same requirement version.
          requireBlank(base);
          const compiled = compileRectangular(request.brief, request.taskId);
          initialization = {
            brief: compiled.brief,
            briefHash: digest(compiled.brief),
            furnitureCount: 0,
            shell: compiled.state.plan,
          };
        }
        const scope = validateScope(
          request.scope,
          initialization ? initialization.shell : base.plan,
        );
        if (initialization) {
          if (scope.targetIds.length || scope.allowDeleteIds.length)
            throw new SceneError(
              "INVALID_AUTHORIZATION",
              "初始化授权只能新增家具，不能修改或删除已有对象",
            );
          if (
            !scope.allowAddKeys.length ||
            !scope.requirements.length ||
            !scope.assetPool?.length
          )
            throw new SceneError(
              "INVALID_AUTHORIZATION",
              "初始化授权必须固定资产候选池、家具种类与数量要求",
            );
          const requirementKeys = new Set<string>();
          let furnitureCount = 0;
          for (const rule of scope.requirements) {
            if (
              rule.scope !== "project" ||
              rule.count < 1 ||
              requirementKeys.has(rule.key) ||
              !scope.allowAddKeys.includes(rule.key)
            )
              throw new SceneError(
                "INVALID_AUTHORIZATION",
                "初始化家具数量要求无效或与资产池不一致",
              );
            requirementKeys.add(rule.key);
            furnitureCount += rule.count;
          }
          if (furnitureCount < 1 || furnitureCount > 300)
            throw new SceneError(
              "INVALID_AUTHORIZATION",
              "初始化家具数量与资产池不一致",
            );
          initialization.furnitureCount = furnitureCount;
        }
        if (
          scope.targetIds.some(
            (id) =>
              !scope.actionIds?.includes(id) &&
              (!scope.fieldMask ||
                (!scope.allowDeleteIds.includes(id) &&
                  !scope.fieldMask[id]?.length)),
          )
        )
          throw new SceneError(
            "INVALID_AUTHORIZATION",
            "编辑目标需要明确的字段授权",
          );
        if (
          scope.allowAddKeys.length &&
          (!scope.assetPool?.length || !scope.additionRules?.length)
        )
          throw new SceneError(
            "INVALID_AUTHORIZATION",
            "新增授权必须固定资产候选池和数量",
          );
        if (
          scope.allowActivityGroups &&
          (!/(?:组成|创建|建立|设立|保存).{0,12}(?:阅读组|活动组|家具组)|编组/.test(
            request.requestText,
          ) ||
            /(?:不要|别|无需|不必).{0,20}(?:阅读组|活动组|家具组|编组)/.test(
              request.requestText,
            ))
        )
          throw new SceneError(
            "INVALID_AUTHORIZATION",
            "活动组元数据缺少用户明确授权",
          );
        const ids = new Set(base.plan.furniture.map((f) => f.id));
        const referenceIds = request.referenceIds || [];
        if (
          !Array.isArray(referenceIds) ||
          referenceIds.some((id) => !ids.has(id)) ||
          referenceIds.some((id) => scope.targetIds.includes(id))
        )
          throw new SceneError(
            "INVALID_AUTHORIZATION",
            "参考对象必须存在且仅作只读参考",
          );
        const operations = request.operations || [];
        if (!Array.isArray(operations) || operations.length > 100)
          throw new SceneError("INVALID_AUTHORIZATION", "精确操作清单无效");
        // User supplements are persisted with a line break ("\n用户补充："),
        // while an understanding model may quote the same text with spaces.
        // Normalise whitespace only; wording must still be an exact substring.
        const quoteText = (value: string) =>
          value.replace(/\s+/g, " ").trim();
        const expected = new Map(
          base.plan.furniture
            .filter((f) => scope.targetIds.includes(f.id))
            .map((f) => [f.id, clone(f) as any]),
        );
        const mentioned = new Map<string, Set<string>>();
        const deleted = new Set<string>();
        for (const op of operations) {
          if (
            !op ||
            !scope.targetIds.includes(op.target_id) ||
            typeof op.source_quote !== "string" ||
            !op.source_quote.trim() ||
            !quoteText(request.requestText).includes(quoteText(op.source_quote))
          )
            throw new SceneError(
              "INVALID_AUTHORIZATION",
              "精确操作需要真实目标及原文依据",
            );
          const item = expected.get(op.target_id);
          if (!item || deleted.has(op.target_id))
            throw new SceneError(
              "INVALID_AUTHORIZATION",
              "精确操作使用已删除目标",
            );
          if (op.action === "delete") {
            if (
              !scope.allowDeleteIds.includes(op.target_id) ||
              Object.keys(op.values || {}).length ||
              Object.keys(op.deltas || {}).length
            )
              throw new SceneError(
                "INVALID_AUTHORIZATION",
                "删除操作缺少删除授权",
              );
            deleted.add(op.target_id);
            continue;
          }
          if (op.action !== "update")
            throw new SceneError("INVALID_AUTHORIZATION", "精确操作类型无效");
          const patchFields = [
            ...Object.keys(op.values || {}),
            ...Object.keys(op.deltas || {}),
          ];
          if (
            !patchFields.length ||
            new Set(patchFields).size !== patchFields.length ||
            patchFields.some(
              (key) =>
                !fields.includes(key) ||
                !scope.fieldMask?.[op.target_id]?.includes(key),
            )
          )
            throw new SceneError(
              "INVALID_AUTHORIZATION",
              "精确字段与用户授权不一致",
            );
          for (const [key, value] of Object.entries(op.values || {})) {
            if (
              key === "color"
                ? typeof value !== "string" || !/^#[a-f\d]{6}$/i.test(value)
                : typeof value !== "number" || !Number.isFinite(value)
            )
              throw new SceneError("INVALID_AUTHORIZATION", "精确值无效");
            item[key] = value;
          }
          for (const [key, delta] of Object.entries(op.deltas || {})) {
            if (
              key === "color" ||
              typeof delta !== "number" ||
              !Number.isFinite(delta)
            )
              throw new SceneError("INVALID_AUTHORIZATION", "相对值无效");
            item[key] = (item[key] || 0) + delta;
          }
          if (patchFields.includes("rot"))
            item.rot = ((item.rot % 360) + 360) % 360;
          mentioned.set(
            op.target_id,
            new Set([...(mentioned.get(op.target_id) || []), ...patchFields]),
          );
        }
        if (
          operations.length &&
          (scope.allowAddKeys.length ||
            scope.allowedAssets?.length ||
            scope.actionIds?.length ||
            scope.targetIds.some(
              (id) =>
                !deleted.has(id) &&
                canonical([...(mentioned.get(id) || [])].sort()) !==
                  canonical([...(scope.fieldMask?.[id] || [])].sort()),
            ) ||
            scope.allowDeleteIds.some((id) => !deleted.has(id)))
        )
          throw new SceneError(
            "INVALID_AUTHORIZATION",
            "精确操作必须完整覆盖授权，不能部分执行",
          );
        const document = initialization
          ? {
              taskId: request.taskId,
              version: request.version,
              baseRevision: request.baseRevision,
              kind: "initialize" as const,
              scope,
              requestText: request.requestText,
              brief: initialization.brief,
              briefHash: initialization.briefHash,
              furnitureCount: initialization.furnitureCount,
              requirements: clone(scope.requirements),
              assetPool: clone(scope.assetPool || []),
              // Initialization always requires render evidence and a visual
              // review; the client cannot downgrade this to deterministic.
              verification: "screenshots" as const,
            }
          : {
              taskId: request.taskId,
              version: request.version,
              baseRevision: request.baseRevision,
              scope,
              referenceIds,
              requestText: request.requestText,
              operations,
              verification:
                operations.length ||
                (scope.actionIds?.length && !scope.allowAddKeys.length) ||
                scope.allowedAssets?.length
                  ? "deterministic"
                  : "screenshots",
              expected: operations.length
                ? Object.fromEntries(
                    [...expected].map(([id, item]) => [
                      id,
                      deleted.has(id)
                        ? null
                        : Object.fromEntries(
                            [...(mentioned.get(id) || [])].map((key) => [
                              key,
                              item[key],
                            ]),
                          ),
                    ]),
                  )
                : {},
            };
        const scopeHash = digest(document);
        const old = this.projects.db
          .prepare(
            "SELECT scope_hash FROM edit_authorizations WHERE project=? AND task_id=? AND version=?",
          )
          .get(project, request.taskId, request.version) as any;
        if (old && old.scope_hash !== scopeHash)
          throw new SceneError(
            "AUTHORIZATION_CONFLICT",
            "同一授权版本不可改写",
            409,
          );
        const head = this.projects.db
          .prepare(
            "SELECT version FROM edit_authorization_heads WHERE project=? AND task_id=?",
          )
          .get(project, request.taskId) as any;
        if (head && head.version > request.version)
          throw new SceneError("AUTHORIZATION_CONFLICT", "需求版本已过期", 409);
        if (!old)
          this.projects.db
            .prepare(
              "INSERT INTO edit_authorizations(project,task_id,version,base_revision,scope_hash,scope,request_hash,created) VALUES(?,?,?,?,?,?,?,?)",
            )
            .run(
              project,
              request.taskId,
              request.version,
              request.baseRevision,
              scopeHash,
              JSON.stringify(document),
              digest(request.requestText),
              new Date().toISOString(),
            );
        this.invalidate(project, request.taskId, request.version);
        return {
          version: request.version,
          baseRevision: request.baseRevision,
          scopeHash,
          verification: document.verification,
        };
      })
      .immediate();
  }
  assert(
    project: string,
    taskId: string,
    version: number,
    baseRevision: number,
    hash: string,
    scope?: EditScope,
    kind: AuthorizationKind = "edit",
  ) {
    const row = this.projects.db
      .prepare(
        "SELECT scope,scope_hash,base_revision FROM edit_authorizations WHERE project=? AND task_id=? AND version=?",
      )
      .get(project, taskId, version) as any;
    const head = this.projects.db
      .prepare(
        "SELECT version FROM edit_authorization_heads WHERE project=? AND task_id=?",
      )
      .get(project, taskId) as any;
    if (
      !row ||
      head?.version !== version ||
      row.scope_hash !== hash ||
      row.base_revision !== baseRevision
    )
      throw new SceneError(
        "AUTHORIZATION_CONFLICT",
        "候选授权不存在或已失效",
        409,
      );
    const document = JSON.parse(row.scope);
    if (
      digest(document) !== hash ||
      (document.kind || "edit") !== kind ||
      (scope && canonical(scope) !== canonical(document.scope)) ||
      (kind === "initialize" &&
        (typeof document.briefHash !== "string" ||
          digest(document.brief) !== document.briefHash))
    )
      throw new SceneError(
        "AUTHORIZATION_CONFLICT",
        "候选范围或用途与授权不一致",
        409,
      );
    return document;
  }
}
export function checkExpected(
  report: CheckReport,
  state: SceneState,
  authorization?: any,
): CheckReport {
  if (!authorization) return report;
  const issues = [...report.issues];
  for (const [id, expected] of Object.entries(authorization.expected || {})) {
    const item = state.plan.furniture.find((f) => f.id === id) as any;
    if (
      expected === null
        ? Boolean(item)
        : !item ||
          Object.entries(expected as object).some(
            ([key, value]) => item[key] !== value,
          )
    )
      issues.push({
        code: "EXACT_RESULT_MISMATCH",
        objectIds: [id],
        message: "候选未逐字段满足精确要求",
        level: "error",
        blocking: true,
      });
  }
  return {
    ...report,
    passed: report.passed && !issues.some((i) => i.blocking),
    issues,
    coverage: [...report.coverage, "服务端授权版本与精确结果"],
  };
}
