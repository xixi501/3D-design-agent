import { createHash } from "node:crypto";
import { ProjectStore, canonical } from "./store.js";
import { newId, SceneError } from "../../../packages/scene-core/src/index.js";
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
    ...payload,
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
      | { request_hash: string; record: string }
      | undefined;
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

  preview(project: string, id: string) {
    const record = this.row(project, id);
    const payload = validateSceneDraftPayload(recordPayload(record), {
      expectedProjectId: project,
    });
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
          return !item.catalogKey || !resolution.catalogKeys?.includes(item.catalogKey);
        return false;
      })
      .map((item) => item.id);
    const unresolvedUnknownIds = payload.program.unknowns.map((item) => item.id);
    return {
      draftId: record.id,
      revision: record.revision,
      hash: record.hash,
      passed: true,
      autoCommitReady:
        missingAssets.length === 0 && unresolvedUnknownIds.length === 0,
      missingAssets,
      unresolvedUnknownIds,
      authority: payload.fieldAuthorities,
      budgetLedger: payload.budgetLedger,
    };
  }

  patch(project: string, id: string, body: any) {
    const current = this.row(project, id);
    const request = requestId(body.requestId);
    if (
      !Number.isInteger(body.draftRevision) ||
      body.draftRevision < 0 ||
      !Array.isArray(body.commands) ||
      body.commands.length > 100
    )
      throw new SceneError("INVALID_REQUEST", "场景草稿 patch 无效");
    const requestHash = sha256({
      draftRevision: body.draftRevision,
      commands: body.commands,
    });
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
      throw new SceneError(
        "REVISION_CONFLICT",
        "场景草稿版本已变化",
        409,
        { currentRevision: current.revision, currentHash: current.hash },
      );

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
      } else
        throw new SceneError(
          "INVALID_REQUEST",
          `未知场景草稿命令：${String(command.op)}`,
        );
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
        .prepare("UPDATE scene_program_drafts SET record=? WHERE id=? AND project=?")
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
