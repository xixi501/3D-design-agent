import { SceneError } from "./index.js";
import {
  CURRENT_SCENE_PROGRAM_POLICY,
  validateSceneProgram,
  type SceneAuthority,
  type SceneProgram,
  type SceneProgramPolicy,
} from "./scene-program.js";
import {
  FLOORPLAN_RECOGNITION_SCHEMA,
  assertFloorplanProgram,
  validateFloorplanRecognition,
  type FloorplanRecognition,
} from "./floorplan-scene-draft.js";

export const INPUT_BUNDLE_SCHEMA = "actiscape.input-bundle.v1";
export const EVIDENCE_GRAPH_SCHEMA = "actiscape.evidence-graph.v1";
export const INTENT_SPEC_SCHEMA = "actiscape.intent-spec.v1";
export const SCENE_DRAFT_SCHEMA = "actiscape.scene-draft.v1";
export const SCENE_DRAFT_SCHEMA_V2 = "actiscape.scene-draft.v2";

export type InputSourceKind =
  | "text_brief"
  | "floorplan_image"
  | "reference_photo"
  | "project_import"
  | "object_photo";

export interface InputSource {
  sourceId: string;
  kind: InputSourceKind;
  adapterVersion: string;
  sha256?: string;
  uri?: string;
  metadata?: Record<string, unknown>;
}

export interface InputBundle {
  schemaVersion: "actiscape.input-bundle.v1";
  sources: InputSource[];
}

export interface EvidenceFact {
  id: string;
  sourceId: string;
  kind: string;
  data: Record<string, unknown>;
  locator?: string;
}

export interface EvidenceGraph {
  schemaVersion: "actiscape.evidence-graph.v1";
  facts: EvidenceFact[];
}

export interface IntentConstraint {
  id: string;
  kind: string;
  text: string;
  strict: boolean;
  sourceRefs: string[];
}

export interface IntentSpec {
  schemaVersion: "actiscape.intent-spec.v1";
  request: string;
  constraints: IntentConstraint[];
  unknowns: string[];
}

export interface AssetResolution {
  objectId: string;
  status: "catalogCandidates" | "generatedJob" | "unresolved" | "manual";
  catalogKeys?: string[];
  jobId?: string;
  assetId?: string;
  reason?: string;
}

export interface DraftBudgetLedger {
  modelCalls: number;
  activeSeconds: number;
  repairRounds: number;
  adapterCalls: number;
  assetJobs: number;
}

export interface SceneDraftPayload {
  schemaVersion: "actiscape.scene-draft.v1" | "actiscape.scene-draft.v2";
  projectId: string;
  baseProjectRevision: number;
  inputBundle: InputBundle;
  evidenceGraph: EvidenceGraph;
  intentSpec: IntentSpec;
  recognition?: FloorplanRecognition;
  program: SceneProgram;
  assetResolutions: AssetResolution[];
  uncertainties: Array<Record<string, unknown>>;
  budgetLedger: DraftBudgetLedger;
  fieldAuthorities: Array<{
    path: string;
    authority: SceneAuthority;
    sourceIds?: string[];
  }>;
}

export interface SceneDraftRecord extends SceneDraftPayload {
  id: string;
  revision: number;
  hash: string;
  createdAt: string;
  updatedAt: string;
  patchHistory: Array<{
    revision: number;
    requestId: string;
    hash: string;
    operations: number;
    at: string;
  }>;
}

const invalid = (message: string, field: string): never => {
  throw new SceneError("SCENE_DRAFT_INVALID", message, 422, { field });
};

const object = (value: unknown, field: string): Record<string, any> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("需要对象", field);
  return value as Record<string, any>;
};

const text = (value: unknown, field: string, max = 500): string => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    invalid("需要有效文字", field);
  return value as string;
};

const nonnegative = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    invalid("需要非负有限数值", field);
  return value as number;
};

const sourceKind = (value: unknown, field: string): InputSourceKind => {
  const kinds: InputSourceKind[] = [
    "text_brief",
    "floorplan_image",
    "reference_photo",
    "project_import",
    "object_photo",
  ];
  if (!kinds.includes(value as InputSourceKind))
    invalid("未知输入来源类型", field);
  return value as InputSourceKind;
};

export function validateInputBundle(input: unknown): InputBundle {
  const value = object(input, "inputBundle");
  if (value.schemaVersion !== INPUT_BUNDLE_SCHEMA)
    invalid("输入包 schema 无效", "inputBundle.schemaVersion");
  if (!Array.isArray(value.sources) || !value.sources.length)
    invalid("输入包至少需要一个来源", "inputBundle.sources");
  const ids = new Set<string>();
  const sources = value.sources.map((item: unknown, index: number) => {
    const field = `inputBundle.sources.${index}`;
    const source = object(item, field);
    const sourceId = text(source.sourceId, `${field}.sourceId`, 200);
    if (ids.has(sourceId)) invalid("输入来源 ID 重复", `${field}.sourceId`);
    ids.add(sourceId);
    const kind = sourceKind(source.kind, `${field}.kind`);
    if (
      source.sha256 !== undefined &&
      (typeof source.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(source.sha256))
    )
      invalid("输入哈希无效", `${field}.sha256`);
    if (kind !== "text_brief" && !source.sha256)
      invalid("非文字输入必须绑定内容哈希", `${field}.sha256`);
    if (kind === "text_brief" && !source.uri && !source.metadata?.text)
      invalid("文字输入必须绑定原文引用", `${field}.uri`);
    return {
      sourceId,
      kind,
      adapterVersion: text(
        source.adapterVersion,
        `${field}.adapterVersion`,
        100,
      ),
      ...(source.sha256 === undefined ? {} : { sha256: source.sha256 }),
      ...(source.uri === undefined
        ? {}
        : { uri: text(source.uri, `${field}.uri`, 1000) }),
      ...(source.metadata === undefined
        ? {}
        : { metadata: object(source.metadata, `${field}.metadata`) }),
    };
  });
  return { schemaVersion: INPUT_BUNDLE_SCHEMA, sources };
}

export function validateEvidenceGraph(
  input: unknown,
  bundle: InputBundle,
): EvidenceGraph {
  const value = object(input, "evidenceGraph");
  if (value.schemaVersion !== EVIDENCE_GRAPH_SCHEMA)
    invalid("证据图 schema 无效", "evidenceGraph.schemaVersion");
  if (!Array.isArray(value.facts) || value.facts.length > 5000)
    invalid("证据数量无效", "evidenceGraph.facts");
  const sources = new Map(
    bundle.sources.map((source) => [source.sourceId, source]),
  );
  const ids = new Set<string>();
  const facts = value.facts.map((item: unknown, index: number) => {
    const field = `evidenceGraph.facts.${index}`;
    const fact = object(item, field);
    const id = text(fact.id, `${field}.id`, 200);
    if (ids.has(id)) invalid("证据 ID 重复", `${field}.id`);
    ids.add(id);
    const sourceId = text(fact.sourceId, `${field}.sourceId`, 200);
    const source = sources.get(sourceId);
    if (!source) invalid("证据引用未知来源", `${field}.sourceId`);
    if (
      !["floorplan_image", "reference_photo", "project_import"].includes(
        source!.kind,
      )
    )
      invalid("该来源不能写入事实证据", `${field}.sourceId`);
    return {
      id,
      sourceId,
      kind: text(fact.kind, `${field}.kind`, 100),
      data: object(fact.data, `${field}.data`),
      ...(fact.locator === undefined
        ? {}
        : { locator: text(fact.locator, `${field}.locator`, 1000) }),
    };
  });
  return { schemaVersion: EVIDENCE_GRAPH_SCHEMA, facts };
}

export function validateIntentSpec(
  input: unknown,
  bundle: InputBundle,
): IntentSpec {
  const value = object(input, "intentSpec");
  if (value.schemaVersion !== INTENT_SPEC_SCHEMA)
    invalid("意图 schema 无效", "intentSpec.schemaVersion");
  if (!Array.isArray(value.constraints) || value.constraints.length > 500)
    invalid("意图约束数量无效", "intentSpec.constraints");
  if (!Array.isArray(value.unknowns) || value.unknowns.length > 500)
    invalid("意图未知项数量无效", "intentSpec.unknowns");
  const sourceIds = new Set(bundle.sources.map((source) => source.sourceId));
  const ids = new Set<string>();
  const constraints = value.constraints.map((item: unknown, index: number) => {
    const field = `intentSpec.constraints.${index}`;
    const constraint = object(item, field);
    const id = text(constraint.id, `${field}.id`, 200);
    if (ids.has(id)) invalid("意图约束 ID 重复", `${field}.id`);
    ids.add(id);
    if (!Array.isArray(constraint.sourceRefs) || !constraint.sourceRefs.length)
      invalid("意图必须绑定来源", `${field}.sourceRefs`);
    const refs = constraint.sourceRefs.map((ref: unknown, refIndex: number) => {
      const sourceId = text(ref, `${field}.sourceRefs.${refIndex}`, 200);
      if (!sourceIds.has(sourceId))
        invalid("意图引用未知来源", `${field}.sourceRefs.${refIndex}`);
      return sourceId;
    });
    return {
      id,
      kind: text(constraint.kind, `${field}.kind`, 100),
      text: text(constraint.text, `${field}.text`, 4000),
      strict: Boolean(constraint.strict),
      sourceRefs: refs,
    };
  });
  return {
    schemaVersion: INTENT_SPEC_SCHEMA,
    request: text(value.request, "intentSpec.request", 4000),
    constraints,
    unknowns: value.unknowns.map((item: unknown, index: number) =>
      text(item, `intentSpec.unknowns.${index}`, 1000),
    ),
  };
}

export function validateAssetResolutions(input: unknown): AssetResolution[] {
  if (!Array.isArray(input) || input.length > 300)
    invalid("资产解析结果数量无效", "assetResolutions");
  const ids = new Set<string>();
  return (input as unknown[]).map((item, index) => {
    const field = `assetResolutions.${index}`;
    const value = object(item, field);
    const objectId = text(value.objectId, `${field}.objectId`, 200);
    if (ids.has(objectId)) invalid("对象资产解析重复", `${field}.objectId`);
    ids.add(objectId);
    if (
      !["catalogCandidates", "generatedJob", "unresolved", "manual"].includes(
        value.status,
      )
    )
      invalid("资产解析状态无效", `${field}.status`);
    const catalogKeys = Array.isArray(value.catalogKeys)
      ? value.catalogKeys.map((key: unknown, keyIndex: number) =>
          text(key, `${field}.catalogKeys.${keyIndex}`, 100),
        )
      : undefined;
    if (value.status === "catalogCandidates" && !catalogKeys?.length)
      invalid("目录候选不能为空", `${field}.catalogKeys`);
    return {
      objectId,
      status: value.status,
      ...(catalogKeys === undefined ? {} : { catalogKeys }),
      ...(value.jobId == null || value.jobId === ""
        ? {}
        : { jobId: text(value.jobId, `${field}.jobId`, 200) }),
      ...(value.assetId == null || value.assetId === ""
        ? {}
        : { assetId: text(value.assetId, `${field}.assetId`, 200) }),
      ...(value.reason == null || value.reason === ""
        ? {}
        : { reason: text(value.reason, `${field}.reason`, 500) }),
    } as AssetResolution;
  });
}

export function validateSceneDraftPayload(
  input: unknown,
  options: { policy?: SceneProgramPolicy; expectedProjectId?: string } = {},
): SceneDraftPayload {
  const value = object(input, "draft");
  if (
    value.schemaVersion !== SCENE_DRAFT_SCHEMA &&
    value.schemaVersion !== SCENE_DRAFT_SCHEMA_V2
  )
    invalid("场景草稿 schema 无效", "draft.schemaVersion");
  const projectId = text(value.projectId, "draft.projectId", 200);
  if (options.expectedProjectId && projectId !== options.expectedProjectId)
    invalid("场景草稿项目不一致", "draft.projectId");
  if (
    !Number.isInteger(value.baseProjectRevision) ||
    value.baseProjectRevision < 0
  )
    invalid("基础项目版本无效", "draft.baseProjectRevision");
  const inputBundle = validateInputBundle(value.inputBundle);
  const evidenceGraph = validateEvidenceGraph(value.evidenceGraph, inputBundle);
  const intentSpec = validateIntentSpec(value.intentSpec, inputBundle);
  const sourceSha256 = new Map(
    inputBundle.sources.map((source) => [source.sourceId, source.sha256]),
  );
  const sourceKinds = new Map(
    inputBundle.sources.map((source) => [source.sourceId, source.kind]),
  );
  let recognition: FloorplanRecognition | undefined;
  if (value.schemaVersion === SCENE_DRAFT_SCHEMA_V2) {
    if (!value.recognition || value.recognition === null)
      invalid("第二版场景草稿需要识别块", "draft.recognition");
    if (
      !object(value.recognition, "draft.recognition").schemaVersion ||
      value.recognition.schemaVersion !== FLOORPLAN_RECOGNITION_SCHEMA
    )
      invalid("识别块版本无效", "draft.recognition.schemaVersion");
    recognition = validateFloorplanRecognition(value.recognition, {
      sourceIds: new Set(inputBundle.sources.map((source) => source.sourceId)),
      sourceKinds,
      sourceSha256,
    });
  } else if (value.recognition !== undefined && value.recognition !== null) {
    invalid("第一版场景草稿不能包含识别块", "draft.recognition");
  }
  const program = validateSceneProgram(
    value.program,
    options.policy ?? CURRENT_SCENE_PROGRAM_POLICY,
  );
  if (recognition) assertFloorplanProgram(program, recognition);
  const assetResolutions = validateAssetResolutions(value.assetResolutions);
  const budgetLedger = object(value.budgetLedger, "draft.budgetLedger");
  const sourceIds = new Set(
    inputBundle.sources.map((source) => source.sourceId),
  );
  const validateProgramSource = (
    sourceId: string,
    field: string,
    sourceAuthority: string,
  ) => {
    if (!sourceIds.has(sourceId)) invalid("场景程序引用未知来源", field);
    if (
      sourceAuthority === "baseline" &&
      !["project_import", "floorplan_image"].includes(
        sourceKinds.get(sourceId)!,
      )
    )
      invalid("只有项目或户型图可以声明结构基线", field);
    if (
      sourceAuthority === "user_intent" &&
      sourceKinds.get(sourceId) !== "text_brief"
    )
      invalid("用户意图权威必须引用文字需求", field);
    return sourceId;
  };
  for (const [levelIndex, level] of program.levels.entries()) {
    for (const [wallIndex, wall] of level.walls.entries())
      for (const [refIndex, ref] of (wall.sourceRefs ?? []).entries())
        validateProgramSource(
          ref.sourceId,
          `program.levels.${levelIndex}.walls.${wallIndex}.sourceRefs.${refIndex}.sourceId`,
          ref.authority,
        );
    for (const [openingIndex, opening] of level.openings.entries())
      for (const [refIndex, ref] of (opening.sourceRefs ?? []).entries())
        validateProgramSource(
          ref.sourceId,
          `program.levels.${levelIndex}.openings.${openingIndex}.sourceRefs.${refIndex}.sourceId`,
          ref.authority,
        );
    for (const [roomIndex, room] of level.roomSeeds.entries())
      for (const [refIndex, ref] of (room.sourceRefs ?? []).entries())
        validateProgramSource(
          ref.sourceId,
          `program.levels.${levelIndex}.roomSeeds.${roomIndex}.sourceRefs.${refIndex}.sourceId`,
          ref.authority,
        );
  }
  for (const [objectIndex, item] of program.objects.entries())
    for (const [refIndex, ref] of (item.sourceRefs ?? []).entries())
      validateProgramSource(
        ref.sourceId,
        `program.objects.${objectIndex}.sourceRefs.${refIndex}.sourceId`,
        ref.authority,
      );
  for (const [unknownIndex, item] of program.unknowns.entries())
    for (const [refIndex, ref] of (item.sourceRefs ?? []).entries())
      validateProgramSource(
        ref.sourceId,
        `program.unknowns.${unknownIndex}.sourceRefs.${refIndex}.sourceId`,
        ref.authority,
      );
  const fieldAuthorities = Array.isArray(value.fieldAuthorities)
    ? value.fieldAuthorities.map((item: unknown, index: number) => {
        const field = `draft.fieldAuthorities.${index}`;
        const entry = object(item, field);
        const allowed = [
          "baseline",
          "observed",
          "inferred",
          "user_intent",
          "manual",
        ];
        if (!allowed.includes(entry.authority))
          invalid("字段权威类型无效", `${field}.authority`);
        const authoritySourceIds =
          entry.sourceIds === undefined
            ? undefined
            : entry.sourceIds.map((id: unknown, sourceIndex: number) => {
                const sourceId = text(
                  id,
                  `${field}.sourceIds.${sourceIndex}`,
                  200,
                );
                if (!sourceIds.has(sourceId))
                  invalid(
                    "字段权威引用未知来源",
                    `${field}.sourceIds.${sourceIndex}`,
                  );
                if (
                  entry.authority === "baseline" &&
                  !["project_import", "floorplan_image"].includes(
                    sourceKinds.get(sourceId)!,
                  )
                )
                  invalid(
                    "只有已确认项目或户型图可以声明结构基线",
                    `${field}.sourceIds.${sourceIndex}`,
                  );
                return sourceId;
              });
        return {
          path: text(entry.path, `${field}.path`, 500),
          authority: entry.authority,
          ...(authoritySourceIds === undefined
            ? {}
            : { sourceIds: authoritySourceIds }),
        } as SceneDraftPayload["fieldAuthorities"][number];
      })
    : invalid("字段权威表无效", "draft.fieldAuthorities");
  const modelCalls = nonnegative(
    budgetLedger.modelCalls,
    "draft.budgetLedger.modelCalls",
  );
  const activeSeconds = nonnegative(
    budgetLedger.activeSeconds,
    "draft.budgetLedger.activeSeconds",
  );
  const repairRounds = nonnegative(
    budgetLedger.repairRounds,
    "draft.budgetLedger.repairRounds",
  );
  if (modelCalls > 24)
    invalid("模型调用预算不能超过 24", "draft.budgetLedger.modelCalls");
  if (activeSeconds > 600)
    invalid("活动时间预算不能超过 600 秒", "draft.budgetLedger.activeSeconds");
  if (repairRounds > 3)
    invalid("修复轮次不能超过 3", "draft.budgetLedger.repairRounds");
  return {
    schemaVersion: value.schemaVersion,
    projectId,
    baseProjectRevision: value.baseProjectRevision,
    inputBundle,
    evidenceGraph,
    intentSpec,
    ...(recognition === undefined ? {} : { recognition }),
    program,
    assetResolutions,
    uncertainties: Array.isArray(value.uncertainties)
      ? value.uncertainties.map((item: unknown, index: number) =>
          object(item, `draft.uncertainties.${index}`),
        )
      : invalid("不确定项列表无效", "draft.uncertainties"),
    budgetLedger: {
      modelCalls,
      activeSeconds,
      repairRounds,
      adapterCalls: nonnegative(
        budgetLedger.adapterCalls,
        "draft.budgetLedger.adapterCalls",
      ),
      assetJobs: nonnegative(
        budgetLedger.assetJobs,
        "draft.budgetLedger.assetJobs",
      ),
    },
    fieldAuthorities,
  };
}
