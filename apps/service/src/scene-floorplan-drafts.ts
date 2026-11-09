import { createHash } from "node:crypto";
import { FloorplanStore } from "./floorplans.js";
import { ProjectStore, canonical } from "./store.js";
import { SceneDraftStore } from "./scene-drafts.js";
import {
  applyFloorplanCommands,
  applyFloorplanReview,
  type FloorplanDraftRecord,
} from "./floorplan-draft-mutations.js";
import { clone, SceneError } from "../../../packages/scene-core/src/index.js";
import {
  floorplanScale,
  validateFloorplan,
  type FloorplanBinding,
  type FloorplanData,
} from "../../../packages/scene-core/src/floorplan.js";
import {
  SCENE_DRAFT_SCHEMA_V2,
  type AssetResolution,
  type DraftBudgetLedger,
  type IntentConstraint,
  type SceneDraftPayload,
  type SceneDraftRecord,
} from "../../../packages/scene-core/src/scene-contracts.js";
import {
  FLOORPLAN_RECOGNITION_SCHEMA,
  floorplanToSceneProgram,
  type FloorplanRecognition,
} from "../../../packages/scene-core/src/floorplan-scene-draft.js";
import { requireBlank } from "../../../packages/scene-core/src/rectangular.js";

const sha256 = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");

function textSource(taskId: string, request: string) {
  return {
    sourceId: `task:${taskId}:text`,
    kind: "text_brief" as const,
    adapterVersion: "text-intent-v1",
    sha256: createHash("sha256").update(request).digest("hex"),
    uri: `task:${taskId}:input`,
    metadata: { text: request },
  };
}

function catalogResolutions(data: FloorplanData): AssetResolution[] {
  return data.symbols
    .filter((symbol) => symbol.catalogKey)
    .map((symbol) => ({
      objectId: symbol.id,
      status: "catalogCandidates",
      catalogKeys: [symbol.catalogKey!],
    }));
}

function recognitionFromRecord(
  record: FloorplanDraftRecord,
  sourceId: string,
  adapterVersion: string,
): FloorplanRecognition {
  return {
    schemaVersion: FLOORPLAN_RECOGNITION_SCHEMA,
    kind: "floorplan",
    sourceId,
    adapterVersion,
    proposal: record.data,
    confirmed: record.confirmed as FloorplanRecognition["confirmed"],
    sourceReview:
      (record.sourceReview as FloorplanRecognition["sourceReview"]) || null,
    corrections: record.corrections,
    agentEdits: record.agentEdits || 0,
    changeLedger: record.changeLedger || [],
  };
}

function legacyRecord(
  record: SceneDraftRecord,
  recognition: FloorplanRecognition,
): FloorplanDraftRecord & Record<string, unknown> {
  return {
    id: record.id,
    projectId: record.projectId,
    baseRevision: record.baseProjectRevision,
    revision: record.revision,
    data: clone(recognition.proposal),
    hash: record.hash,
    confirmed: recognition.confirmed,
    sourceReview: recognition.sourceReview,
    corrections: recognition.corrections,
    agentEdits: recognition.agentEdits,
    changeLedger: recognition.changeLedger,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function constraints(request: string, sourceId: string): IntentConstraint[] {
  return [
    {
      id: "intent:preserve-floorplan",
      kind: "preserve_floorplan",
      text: request,
      strict: true,
      sourceRefs: [sourceId],
    },
  ];
}

export class SceneFloorplanDraftStore {
  constructor(
    public projects: ProjectStore,
    public sceneDrafts: SceneDraftStore,
    public floorplans: FloorplanStore,
  ) {}

  private parse(project: string, id: string) {
    const record = this.sceneDrafts.find(project, id);
    if (!record || record.recognition?.kind !== "floorplan")
      throw new SceneError("NOT_FOUND", "识别草稿不存在", 404);
    return record;
  }

  private v2Draft(
    project: string,
    image: ReturnType<FloorplanStore["verifyImage"]>,
    data: FloorplanData,
    taskId: string,
    taskInput: string,
    adapterVersion: string,
    budgetLedger: DraftBudgetLedger,
  ): SceneDraftPayload {
    const sourceId = `floorplan:${image.id}`;
    const text = textSource(taskId, taskInput);
    const recognition = recognitionFromRecord(
      {
        id: "pending",
        projectId: project,
        baseRevision: 0,
        revision: 0,
        data,
        hash: "",
        confirmed: null,
        sourceReview: null,
        corrections: 0,
        agentEdits: 0,
        changeLedger: [],
        createdAt: new Date(0).toISOString(),
      },
      sourceId,
      adapterVersion,
    );
    return {
      schemaVersion: SCENE_DRAFT_SCHEMA_V2,
      projectId: project,
      baseProjectRevision: this.projects.get(project).revision,
      inputBundle: {
        schemaVersion: "actiscape.input-bundle.v1",
        sources: [
          text,
          {
            sourceId,
            kind: "floorplan_image",
            adapterVersion,
            sha256: image.sha256,
            uri: `floorplan-image:${image.id}`,
            metadata: { width: image.width, height: image.height },
          },
        ],
      },
      evidenceGraph: {
        schemaVersion: "actiscape.evidence-graph.v1",
        facts: [
          {
            id: `floorplan:${image.sha256}:recognition`,
            sourceId,
            kind: "floorplan_recognition",
            data: {
              recognitionVersion: data.recognitionVersion,
              walls: data.walls.length,
              openings: data.openings.length,
              rooms: data.rooms.length,
              symbols: data.symbols.length,
              mmPerPixel: floorplanScale(data),
            },
            locator: `floorplan-image:${image.id}`,
          },
        ],
      },
      intentSpec: {
        schemaVersion: "actiscape.intent-spec.v1",
        request: taskInput,
        constraints: constraints(taskInput, text.sourceId),
        unknowns: [],
      },
      recognition,
      program: floorplanToSceneProgram(data, sourceId),
      assetResolutions: catalogResolutions(data),
      uncertainties: data.uncertainties.map((item) => ({ ...item })),
      budgetLedger,
      fieldAuthorities: [
        {
          path: "program.levels",
          authority: "observed",
          sourceIds: [sourceId],
        },
      ],
    };
  }

  private persist(
    project: string,
    current: SceneDraftRecord,
    next: FloorplanDraftRecord,
    body: { requestId: string; budgetLedger?: DraftBudgetLedger },
    extraCommands: Array<Record<string, unknown>> = [],
  ) {
    const recognition = current.recognition!;
    const updatedRecognition = recognitionFromRecord(
      next,
      recognition.sourceId,
      recognition.adapterVersion,
    );
    const patched = this.sceneDrafts.patch(
      project,
      current.id,
      {
        requestId: body.requestId,
        draftRevision: current.revision,
        commands: [
          {
            op: "replaceRecognition",
            recognition: updatedRecognition,
          },
          {
            op: "replaceProgram",
            program: floorplanToSceneProgram(
              next.data,
              updatedRecognition.sourceId,
            ),
          },
          {
            op: "replaceUncertainties",
            uncertainties: next.data.uncertainties,
          },
          {
            op: "replaceAssetResolutions",
            assetResolutions: catalogResolutions(next.data),
          },
          ...(body.budgetLedger
            ? [
                {
                  op: "replaceBudgetLedger",
                  budgetLedger: body.budgetLedger,
                },
              ]
            : []),
          ...extraCommands,
        ],
      },
      body,
    );
    return legacyRecord(this.parse(project, patched.id), updatedRecognition);
  }

  create(
    project: string,
    body: {
      requestId: string;
      imageId: string;
      baseRevision: number;
      data?: FloorplanData;
      taskId?: string;
      taskInput?: string;
      adapterVersion?: string;
      budgetLedger?: DraftBudgetLedger;
    },
  ) {
    if (
      !body ||
      typeof body.requestId !== "string" ||
      !body.requestId ||
      body.requestId.length > 200
    )
      throw new SceneError("INVALID_REQUEST", "需要有效 requestId");
    const current = this.projects.get(project);
    requireBlank(current);
    if (current.revision !== body.baseRevision)
      throw new SceneError("REVISION_CONFLICT", "项目版本已变化", 409, {
        currentRevision: current.revision,
      });
    const image = this.floorplans.verifyImage(body.imageId);
    const data = validateFloorplan(body.data as FloorplanData);
    const expectedImage = {
      id: image.id,
      sha256: image.sha256,
      width: image.width,
      height: image.height,
    };
    if (canonical(data.image) !== canonical(expectedImage))
      throw new SceneError(
        "INVALID_FLOORPLAN",
        "草稿图片身份与上传记录不一致",
        422,
      );
    const taskId = body.taskId || body.requestId;
    const request = body.taskInput || "按原图复现单层住宅";
    const created = this.sceneDrafts.create(project, {
      requestId: body.requestId,
      draft: this.v2Draft(
        project,
        image,
        data,
        taskId,
        request,
        body.adapterVersion || `s2c-floorplan-v${data.recognitionVersion || 4}`,
        body.budgetLedger || {
          modelCalls: 0,
          activeSeconds: 0,
          repairRounds: 0,
          adapterCalls: 0,
          assetJobs: 0,
        },
      ),
    });
    return legacyRecord(created, created.recognition!);
  }

  get(project: string, id: string) {
    const record = this.parse(project, id);
    return legacyRecord(record, record.recognition!);
  }

  list(project: string) {
    return this.sceneDrafts
      .list(project)
      .map((summary) => this.sceneDrafts.find(project, summary.id))
      .filter((record): record is SceneDraftRecord =>
        Boolean(record && record.recognition?.kind === "floorplan"),
      )
      .map((record) => legacyRecord(record, record.recognition!));
  }

  revisions(project: string, id: string) {
    this.parse(project, id);
    return this.sceneDrafts.revisions(project, id).map((summary) => {
      const revision = this.sceneDrafts.revision(project, id, summary.revision);
      return legacyRecord(revision, revision.recognition!);
    });
  }

  commands(project: string, id: string, body: any, system = false) {
    const current = this.parse(project, id);
    const replay = this.sceneDrafts.replayAction(project, id, body, body);
    if (replay) return legacyRecord(replay, replay.recognition!);
    if (current.revision !== body?.draftRevision)
      throw new SceneError("DRAFT_CONFLICT", "草稿已变化，请重新读取", 409, {
        currentDraftRevision: current.revision,
      });
    const next = applyFloorplanCommands(
      legacyRecord(current, current.recognition!),
      body,
      {
        system,
        evidenceRefVerifier: this.floorplans.evidenceRefVerifier,
      },
    );
    return this.persist(project, current, next, body);
  }

  review(project: string, id: string, body: any) {
    const current = this.parse(project, id);
    const replay = this.sceneDrafts.replayAction(project, id, body, body);
    if (replay) return legacyRecord(replay, replay.recognition!);
    if (current.revision !== body?.draftRevision)
      throw new SceneError("DRAFT_CONFLICT", "草稿已变化，请重新读取", 409, {
        currentDraftRevision: current.revision,
      });
    const next = applyFloorplanReview(
      legacyRecord(current, current.recognition!),
      body,
      {
        evidenceRefVerifier: this.floorplans.evidenceRefVerifier,
      },
    );
    const updatedRecognition = recognitionFromRecord(
      next,
      current.recognition!.sourceId,
      current.recognition!.adapterVersion,
    );
    const patched = this.sceneDrafts.updateRecognitionMetadata(
      project,
      id,
      body,
      updatedRecognition,
    );
    return legacyRecord(patched, patched.recognition!);
  }

  preview(
    project: string,
    id: string,
    seed = id,
  ): ReturnType<FloorplanStore["preview"]> {
    const record = this.parse(project, id);
    const draft = legacyRecord(record, record.recognition!);
    const preview = this.floorplans.inspectData(draft.data, seed, {
      draftId: id,
      draftRevision: record.revision,
      draftHash: record.hash,
    });
    const scenePreview = this.sceneDrafts.preview(project, id, seed);
    if (!scenePreview.checks.passed)
      return {
        ...preview,
        checks: {
          ...preview.checks,
          passed: false,
          issues: [
            ...(preview.checks.issues || []),
            ...(scenePreview.checks.issues || []),
          ],
        },
      } as ReturnType<FloorplanStore["preview"]>;
    return preview;
  }

  confirm(project: string, id: string, body: any) {
    const current = this.parse(project, id);
    const replay = this.sceneDrafts.replayAction(project, id, body, body);
    if (replay) return legacyRecord(replay, replay.recognition!);
    const projectRecord = this.projects.get(project);
    requireBlank(projectRecord);
    if (
      current.revision !== body?.draftRevision ||
      current.hash !== body?.draftHash
    )
      throw new SceneError("DRAFT_CONFLICT", "确认哈希与草稿不一致", 409);
    if (projectRecord.revision !== current.baseProjectRevision)
      throw new SceneError(
        "REVISION_CONFLICT",
        "项目版本已变化，需要重新核对确认",
        409,
        { currentRevision: projectRecord.revision },
      );
    const preview = this.preview(project, id);
    const recognition = current.recognition!;
    if (
      recognition.proposal.measurementVersion === 2 &&
      (recognition.sourceReview?.hash !== current.hash ||
        recognition.sourceReview?.review?.passed !== true)
    )
      throw new SceneError(
        "SOURCE_REVIEW_REQUIRED",
        "当前草稿尚未通过独立原图审核",
        422,
      );
    if (!preview.checks.passed)
      throw new SceneError(
        "FLOORPLAN_NOT_READY",
        "请解决结构、比例或不确定项后确认",
        422,
        preview.checks,
      );
    this.floorplans.verifyImage(recognition.proposal.image.id);
    const draft = legacyRecord(current, recognition);
    draft.confirmed = {
      revision: current.revision,
      hash: current.hash,
      projectRevision: projectRecord.revision,
      requestId: body.requestId,
      confirmedAt: new Date().toISOString(),
    };
    const updatedRecognition = recognitionFromRecord(
      draft,
      recognition.sourceId,
      recognition.adapterVersion,
    );
    const patched = this.sceneDrafts.updateRecognitionMetadata(
      project,
      id,
      body,
      updatedRecognition,
    );
    return legacyRecord(patched, patched.recognition!);
  }

  confirmed(project: string, binding: FloorplanBinding) {
    if (!binding || typeof binding.draftId !== "string")
      throw new SceneError(
        "CONFIRMATION_REQUIRED",
        "需要已确认的户型草稿",
        409,
      );
    const record = this.parse(project, binding.draftId);
    const recognition = record.recognition!;
    if (
      record.revision !== binding.draftRevision ||
      record.hash !== binding.draftHash ||
      recognition.confirmed?.hash !== record.hash ||
      recognition.confirmed?.revision !== record.revision
    )
      throw new SceneError("DRAFT_CONFLICT", "草稿已变化或尚未确认", 409);
    this.floorplans.verifyImage(recognition.proposal.image.id);
    return legacyRecord(record, recognition);
  }

  rebase(project: string, id: string, body: any) {
    const current = this.parse(project, id);
    const replay = this.sceneDrafts.replayAction(project, id, body, body);
    if (replay) return legacyRecord(replay, replay.recognition!);
    if (current.revision !== body?.draftRevision)
      throw new SceneError("DRAFT_CONFLICT", "草稿已变化", 409);
    const projectRecord = this.projects.get(project);
    requireBlank(projectRecord);
    if (projectRecord.revision !== body.baseRevision)
      throw new SceneError("REVISION_CONFLICT", "项目版本已变化", 409);
    const recognition = {
      ...current.recognition!,
      confirmed: null,
      sourceReview: null,
    };
    const patched = this.sceneDrafts.patch(
      project,
      id,
      {
        requestId: body.requestId,
        draftRevision: current.revision,
        commands: [
          {
            op: "replaceBaseProjectRevision",
            baseProjectRevision: projectRecord.revision,
          },
          {
            op: "replaceRecognition",
            recognition,
          },
        ],
      },
      body,
    );
    return legacyRecord(patched, patched.recognition!);
  }
}

export class RoutedFloorplanStore extends FloorplanStore {
  readonly sceneFloorplans: SceneFloorplanDraftStore;

  constructor(projects: ProjectStore, sceneDrafts: SceneDraftStore) {
    super(projects);
    this.sceneFloorplans = new SceneFloorplanDraftStore(
      projects,
      sceneDrafts,
      this,
    );
  }

  private sceneRecord(project: string, id: string) {
    const record = this.sceneFloorplans.sceneDrafts.find(project, id);
    return record?.recognition?.kind === "floorplan" ? record : null;
  }

  override create(project: string, body: any) {
    if (body?.data?.recognitionVersion >= 4)
      return this.sceneFloorplans.create(project, body);
    return super.create(project, body);
  }

  override get(project: string, id: string) {
    return this.sceneRecord(project, id)
      ? this.sceneFloorplans.get(project, id)
      : super.get(project, id);
  }

  override list(project: string) {
    const legacy = super.list(project);
    const scene = this.sceneFloorplans.list(project);
    return [...scene, ...legacy].sort((left, right) =>
      String(right.createdAt || right.updatedAt || "").localeCompare(
        String(left.createdAt || left.updatedAt || ""),
      ),
    );
  }

  override revisions(project: string, id: string) {
    if (this.sceneRecord(project, id))
      return this.sceneFloorplans.revisions(project, id);
    return super.revisions(project, id);
  }

  override commands(project: string, id: string, body: any, system = false) {
    return this.sceneRecord(project, id)
      ? this.sceneFloorplans.commands(project, id, body, system)
      : super.commands(project, id, body, system);
  }

  override review(project: string, id: string, body: any) {
    return this.sceneRecord(project, id)
      ? this.sceneFloorplans.review(project, id, body)
      : super.review(project, id, body);
  }

  override preview(project: string, id: string, seed = id) {
    return this.sceneRecord(project, id)
      ? this.sceneFloorplans.preview(project, id, seed)
      : super.preview(project, id, seed);
  }

  override confirm(project: string, id: string, body: any) {
    return this.sceneRecord(project, id)
      ? this.sceneFloorplans.confirm(project, id, body)
      : super.confirm(project, id, body);
  }

  override confirmed(project: string, binding: FloorplanBinding) {
    return this.sceneRecord(project, binding.draftId)
      ? this.sceneFloorplans.confirmed(project, binding)
      : super.confirmed(project, binding);
  }

  override rebase(project: string, id: string, body: any) {
    return this.sceneRecord(project, id)
      ? this.sceneFloorplans.rebase(project, id, body)
      : super.rebase(project, id, body);
  }
}
