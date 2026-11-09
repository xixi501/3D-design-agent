import { createHash } from "node:crypto";
import { ProjectStore, canonical } from "./store.js";
import { newId, SceneError } from "../../../packages/scene-core/src/index.js";
import { requireBlank } from "../../../packages/scene-core/src/rectangular.js";
import {
  compileFloorplan,
  floorplanScale,
} from "../../../packages/scene-core/src/floorplan.js";
import {
  validateSceneDraftPayload,
  type SceneDraftPayload,
  type SceneDraftRecord,
} from "../../../packages/scene-core/src/scene-contracts.js";

const sha256 = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");

const requestId = (value: unknown) => {
  if (typeof value !== "string" || !value || value.length > 200)
    throw new SceneError("INVALID_REQUEST", "需要有效 requestId");
  return value;
};

const recordPayload = (record: SceneDraftRecord): SceneDraftPayload => ({
  schemaVersion: record.schemaVersion,
  projectId: record.projectId,
  baseProjectRevision: record.baseProjectRevision,
  inputBundle: record.inputBundle,
  evidenceGraph: record.evidenceGraph,
  intentSpec: record.intentSpec,
  ...(record.recognition === undefined
    ? {}
    : { recognition: record.recognition }),
  program: record.program,
  assetResolutions: record.assetResolutions,
  uncertainties: record.uncertainties,
  budgetLedger: record.budgetLedger,
  fieldAuthorities: record.fieldAuthorities,
});

const recordHash = (
  payload: SceneDraftPayload,
  id: string,
  revision: number,
  previousHash: string | undefined,
  patchHistory: SceneDraftRecord["patchHistory"],
) =>
  sha256({
    ...(payload.schemaVersion === "actiscape.scene-draft.v2" &&
    payload.recognition
      ? {
          ...payload,
          recognition: {
            ...payload.recognition,
            confirmed: null,
            sourceReview: null,
          },
        }
      : payload),
    id,
    revision,
    previousHash: previousHash ?? null,
    patchHistory,
  });

export class SceneDraftStore {
  constructor(public projects: ProjectStore) {}

  private row(project: string, id: string): SceneDraftRecord {
    this.projects.get(project);
    const row = this.projects.db
      .prepare(
        "SELECT record FROM scene_program_drafts WHERE id=? AND project=?",
      )
      .get(id, project) as { record: string } | undefined;
    if (!row) throw new SceneError("NOT_FOUND", "场景草稿不存在", 404);
    return JSON.parse(row.record);
  }

  list(project: string) {
    this.projects.get(project);
    return (
      this.projects.db
        .prepare(
          "SELECT record FROM scene_program_drafts WHERE project=? ORDER BY rowid DESC",
        )
        .all(project) as { record: string }[]
    ).map((row) => {
      const record: SceneDraftRecord = JSON.parse(row.record);
      return {
        id: record.id,
        revision: record.revision,
        hash: record.hash,
        baseProjectRevision: record.baseProjectRevision,
        inputKinds: record.inputBundle.sources.map((source) => source.kind),
        updatedAt: record.updatedAt,
      };
    });
  }

  get(project: string, id: string) {
    return this.row(project, id);
  }

  find(project: string, id: string): SceneDraftRecord | null {
    this.projects.get(project);
    const row = this.projects.db
      .prepare(
        "SELECT record FROM scene_program_drafts WHERE id=? AND project=?",
      )
      .get(id, project) as { record: string } | undefined;
    return row ? (JSON.parse(row.record) as SceneDraftRecord) : null;
  }

  revisions(project: string, id: string) {
    this.row(project, id);
    return (
      this.projects.db
        .prepare(
          "SELECT revision,record FROM scene_program_draft_revisions WHERE draft=? ORDER BY revision",
        )
        .all(id) as { revision: number; record: string }[]
    ).map((row) => {
      const record: SceneDraftRecord = JSON.parse(row.record);
      return {
        revision: row.revision,
        hash: record.hash,
        createdAt: record.updatedAt,
      };
    });
  }

  revision(project: string, id: string, revision: number) {
    this.row(project, id);
    const row = this.projects.db
      .prepare(
        "SELECT record FROM scene_program_draft_revisions WHERE draft=? AND revision=?",
      )
      .get(id, revision) as { record: string } | undefined;
    if (!row) throw new SceneError("NOT_FOUND", "场景草稿修订不存在", 404);
    return JSON.parse(row.record) as SceneDraftRecord;
  }

  replayAction(
    project: string,
    id: string,
    body: { requestId: string },
    requestFingerprint: unknown,
  ): SceneDraftRecord | null {
    this.row(project, id);
    const request = requestId(body.requestId);
    const row = this.projects.db
      .prepare(
        "SELECT hash,response FROM scene_program_draft_actions WHERE draft=? AND request_id=?",
      )
      .get(id, request) as { hash: string; response: string } | undefined;
    if (!row) return null;
    if (row.hash !== sha256(requestFingerprint))
      throw new SceneError(
        "OPERATION_CONFLICT",
        "相同 requestId 对应不同草稿操作",
        409,
      );
    return JSON.parse(row.response) as SceneDraftRecord;
  }

  updateRecognitionMetadata(
    project: string,
    id: string,
    body: { requestId: string; draftRevision: number; draftHash: string },
    recognition: SceneDraftPayload["recognition"],
  ) {
    const current = this.row(project, id);
    const request = requestId(body.requestId);
    const requestHash = sha256(body);
    const replay = this.projects.db
      .prepare(
        "SELECT hash,response FROM scene_program_draft_actions WHERE draft=? AND request_id=?",
      )
      .get(id, request) as { hash: string; response: string } | undefined;
    if (replay) {
      if (replay.hash !== requestHash)
        throw new SceneError(
          "OPERATION_CONFLICT",
          "相同 requestId 对应不同草稿操作",
          409,
        );
      return JSON.parse(replay.response) as SceneDraftRecord;
    }
    if (
      current.revision !== body.draftRevision ||
      current.hash !== body.draftHash
    )
      throw new SceneError(
        "DRAFT_CONFLICT",
        "审核或确认元数据未绑定当前草稿",
        409,
        {
          currentRevision: current.revision,
          currentHash: current.hash,
        },
      );
    const payload = recordPayload(current);
    if (!payload.recognition)
      throw new SceneError(
        "INVALID_REQUEST",
        "只有识别草稿可以更新审核元数据",
        422,
      );
    payload.recognition = recognition;
    const validated = validateSceneDraftPayload(payload, {
      expectedProjectId: project,
    });
    const next: SceneDraftRecord = {
      ...validated,
      id,
      revision: current.revision,
      hash: current.hash,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
      patchHistory: current.patchHistory,
    };
    this.projects.db.transaction(() => {
      this.projects.db
        .prepare(
          "UPDATE scene_program_drafts SET record=? WHERE id=? AND project=?",
        )
        .run(JSON.stringify(next), id, project);
      this.projects.db
        .prepare(
          "INSERT INTO scene_program_draft_actions(draft,request_id,hash,response) VALUES(?,?,?,?)",
        )
        .run(id, request, requestHash, JSON.stringify(next));
    })();
    return next;
  }

  create(project: string, body: any) {
    const current = this.projects.get(project);
    const request = requestId(body.requestId);
    const payload = validateSceneDraftPayload(body.draft, {
      expectedProjectId: project,
    });
    if (payload.baseProjectRevision !== current.revision)
      throw new SceneError(
        "REVISION_CONFLICT",
        "场景草稿绑定的项目版本已过期",
        409,
        { currentRevision: current.revision },
      );
    const requestHash = sha256(payload);
    const existing = this.projects.db
      .prepare(
        "SELECT request_hash,record FROM scene_program_drafts WHERE project=? AND request_id=?",
      )
      .get(project, request) as
      { request_hash: string; record: string } | undefined;
    if (existing) {
      if (existing.request_hash !== requestHash)
        throw new SceneError(
          "OPERATION_CONFLICT",
          "相同 requestId 对应不同场景草稿",
          409,
        );
      return JSON.parse(existing.record);
    }
    const id = newId();
    const now = new Date().toISOString();
    const patchHistory: SceneDraftRecord["patchHistory"] = [];
    const record: SceneDraftRecord = {
      ...payload,
      id,
      revision: 0,
      hash: recordHash(payload, id, 0, undefined, patchHistory),
      createdAt: now,
      updatedAt: now,
      patchHistory,
    };
    this.projects.db.transaction(() => {
      this.projects.db
        .prepare(
          "INSERT INTO scene_program_drafts(id,project,request_id,request_hash,record) VALUES(?,?,?,?,?)",
        )
        .run(id, project, request, requestHash, JSON.stringify(record));
      this.projects.db
        .prepare(
          "INSERT INTO scene_program_draft_revisions(draft,revision,record) VALUES(?,?,?)",
        )
        .run(id, 0, JSON.stringify(record));
    })();
    return record;
  }

  preview(project: string, id: string, seed = id) {
    const record = this.row(project, id);
    const payload = validateSceneDraftPayload(recordPayload(record), {
      expectedProjectId: project,
    });
    const geometryIssues = payload.recognition
      ? payload.recognition.proposal.uncertainties
          .filter((item) => item.blocking)
          .map((item) => ({
            code: "FLOORPLAN_UNCERTAIN",
            message: item.message,
            objectIds: item.objectIds || [item.id],
            blocking: true,
          }))
      : [];
    let geometry: ReturnType<typeof compileFloorplan> | undefined;
    try {
      if (payload.recognition) {
        geometry = compileFloorplan(payload.recognition.proposal, seed, {
          draftId: id,
          draftRevision: record.revision,
          draftHash: record.hash,
        });
        if (
          !Number.isFinite(floorplanScale(payload.recognition.proposal)) ||
          floorplanScale(payload.recognition.proposal) <= 0
        )
          geometryIssues.push({
            code: "FLOORPLAN_SCALE_INVALID",
            message: "户型比例无效",
            objectIds: [],
            blocking: true,
          });
      }
    } catch (error) {
      if (!(error instanceof SceneError)) throw error;
      geometryIssues.push({
        code: error.code,
        message: error.message,
        objectIds: (error.details as any)?.objectIds || [],
        blocking: true,
      });
    }
    const resolutions = new Map(
      payload.assetResolutions.map((item) => [item.objectId, item]),
    );
    const missingAssets = payload.program.objects
      .filter((item) => item.included)
      .filter((item) => {
        const resolution = resolutions.get(item.id);
        if (!resolution) return true;
        if (resolution.status === "unresolved") return true;
        if (resolution.status === "generatedJob" && !resolution.assetId)
          return true;
        if (resolution.status === "catalogCandidates")
          return (
            !item.catalogKey ||
            !resolution.catalogKeys?.includes(item.catalogKey)
          );
        return false;
      })
      .map((item) => item.id);
    const unresolvedUnknownIds = payload.program.unknowns.map(
      (item) => item.id,
    );
    const geometryPassed = geometryIssues.length === 0;
    const passed =
      geometryPassed &&
      missingAssets.length === 0 &&
      unresolvedUnknownIds.length === 0;
    return {
      draftId: record.id,
      revision: record.revision,
      hash: record.hash,
      passed,
      autoCommitReady: passed,
      missingAssets,
      unresolvedUnknownIds,
      checks: {
        passed: geometryPassed,
        issues: geometryIssues,
        coverage: geometry
          ? geometry.coverage
          : ["SceneProgram 字段、房间归属和对象边界"],
        limitations: payload.recognition
          ? ["家具匹配、实际模型和截图仍需候选检查"]
          : ["通用 SceneProgram 尚未执行任意方向拓扑和施工级几何检查"],
      },
      ...(geometry || {}),
      authority: payload.fieldAuthorities,
      budgetLedger: payload.budgetLedger,
    };
  }

  patch(project: string, id: string, body: any, requestFingerprint?: unknown) {
    const current = this.row(project, id);
    const request = requestId(body.requestId);
    if (
      !Number.isInteger(body.draftRevision) ||
      body.draftRevision < 0 ||
      !Array.isArray(body.commands) ||
      body.commands.length > 100
    )
      throw new SceneError("INVALID_REQUEST", "场景草稿 patch 无效");
    const requestHash = sha256(
      requestFingerprint ?? {
        draftRevision: body.draftRevision,
        commands: body.commands,
      },
    );
    const replay = this.projects.db
      .prepare(
        "SELECT hash,response FROM scene_program_draft_actions WHERE draft=? AND request_id=?",
      )
      .get(id, request) as { hash: string; response: string } | undefined;
    if (replay) {
      if (replay.hash !== requestHash)
        throw new SceneError(
          "OPERATION_CONFLICT",
          "相同 requestId 对应不同草稿 patch",
          409,
        );
      return JSON.parse(replay.response);
    }
    if (current.revision !== body.draftRevision)
      throw new SceneError("REVISION_CONFLICT", "场景草稿版本已变化", 409, {
        currentRevision: current.revision,
        currentHash: current.hash,
      });

    const payload = recordPayload(current);
    for (const raw of body.commands) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw new SceneError("INVALID_REQUEST", "patch 命令无效");
      const command = raw as Record<string, any>;
      if (command.op === "replaceProgram") payload.program = command.program;
      else if (command.op === "replaceEvidenceGraph")
        payload.evidenceGraph = command.evidenceGraph;
      else if (command.op === "replaceIntentSpec")
        payload.intentSpec = command.intentSpec;
      else if (command.op === "replaceRecognition")
        payload.recognition = command.recognition;
      else if (command.op === "replaceAssetResolutions")
        payload.assetResolutions = command.assetResolutions;
      else if (command.op === "replaceUncertainties")
        payload.uncertainties = command.uncertainties;
      else if (command.op === "replaceBudgetLedger") {
        const next = command.budgetLedger;
        for (const key of [
          "modelCalls",
          "activeSeconds",
          "repairRounds",
          "adapterCalls",
          "assetJobs",
        ] as const)
          if (
            !next ||
            typeof next[key] !== "number" ||
            next[key] < current.budgetLedger[key]
          )
            throw new SceneError(
              "BUDGET_REGRESSION",
              "共享预算账本不能回退",
              422,
              { field: key },
            );
        payload.budgetLedger = next;
      } else if (command.op === "replaceBaseProjectRevision") {
        const projectRecord = this.projects.get(project);
        requireBlank(projectRecord);
        if (
          !Number.isInteger(command.baseProjectRevision) ||
          command.baseProjectRevision < 0
        )
          throw new SceneError("INVALID_REQUEST", "项目基础版本无效", 422);
        if (projectRecord.revision !== command.baseProjectRevision)
          throw new SceneError("REVISION_CONFLICT", "项目版本已变化", 409, {
            currentRevision: projectRecord.revision,
          });
        payload.baseProjectRevision = command.baseProjectRevision;
      } else
        throw new SceneError(
          "INVALID_REQUEST",
          `未知场景草稿命令：${String(command.op)}`,
        );
    }
    if (payload.recognition) {
      payload.recognition.confirmed = null;
      payload.recognition.sourceReview = null;
    }
    const validated = validateSceneDraftPayload(payload, {
      expectedProjectId: project,
    });
    const revision = current.revision + 1;
    const now = new Date().toISOString();
    const patchHistory = [
      ...current.patchHistory,
      {
        revision,
        requestId: request,
        hash: requestHash,
        operations: body.commands.length,
        at: now,
      },
    ];
    const next: SceneDraftRecord = {
      ...validated,
      id,
      revision,
      hash: recordHash(validated, id, revision, current.hash, patchHistory),
      createdAt: current.createdAt,
      updatedAt: now,
      patchHistory,
    };
    this.projects.db.transaction(() => {
      this.projects.db
        .prepare(
          "UPDATE scene_program_drafts SET record=? WHERE id=? AND project=?",
        )
        .run(JSON.stringify(next), id, project);
      this.projects.db
        .prepare(
          "INSERT INTO scene_program_draft_revisions(draft,revision,record) VALUES(?,?,?)",
        )
        .run(id, revision, JSON.stringify(next));
      this.projects.db
        .prepare(
          "INSERT INTO scene_program_draft_actions(draft,request_id,hash,response) VALUES(?,?,?,?)",
        )
        .run(id, request, requestHash, JSON.stringify(next));
    })();
    return next;
  }
}
