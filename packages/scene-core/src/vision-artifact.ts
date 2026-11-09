/** Versioned, pixel-space evidence exchanged between vision providers and ActiScape. */

export const FLOORPLAN_VISION_ARTIFACT_SCHEMA =
  "actiscape.floorplan-vision-artifact.v1";

export type PixelBBox = [number, number, number, number];

export interface VisionProviderDescriptor {
  id: string;
  version: string;
  repository: string;
  commit: string;
  license: string;
}

export interface VisionCapabilities {
  walls: boolean;
  openings: boolean;
  dimensions: boolean;
  rooms: boolean;
  symbols: boolean;
}

export interface PixelWallCandidate {
  id: string;
  orientation: "h" | "v";
  line: number;
  start: number;
  end: number;
  thickness: number;
  confidence?: number;
  evidenceRefs: string[];
}

export interface PixelOpeningCandidate {
  id: string;
  wallCandidateId: string | null;
  orientation: "h" | "v";
  line: number;
  start: number;
  end: number;
  typeHint: "door" | "window" | "sliding" | "hole" | "unknown";
  confidence?: number;
  evidenceRefs: string[];
}

export interface PixelDimensionCandidate {
  id: string;
  axis: "h" | "v";
  side: "top" | "bottom" | "left" | "right" | "unknown";
  at: number;
  start: number;
  end: number;
  unitHint: string | null;
  confidence?: number;
  evidenceRefs: string[];
}

export interface PixelRegionCandidate {
  id: string;
  bbox: PixelBBox;
  evidenceRefs: string[];
}

export interface PixelSymbolCandidate {
  id: string;
  bbox: PixelBBox;
  evidenceRefs: string[];
}

export interface VisionEvidenceFile {
  id: string;
  kind: "diagnostic" | "mask" | "overlay" | "crop";
  path: string;
  sha256: string;
  mediaType: "image/png" | "application/json";
}

export interface FloorplanVisionArtifact {
  schemaVersion: typeof FLOORPLAN_VISION_ARTIFACT_SCHEMA;
  artifactId: string;
  provider: VisionProviderDescriptor;
  input: {
    imageSha256: string;
    width: number;
    height: number;
    coordinateSpace: "exif-oriented-original-pixels";
  };
  scope: {
    roomSelection: "all_visible" | "selected";
    functionalAreas: string[];
    excludeFunctionalAreas: string[];
  };
  capabilities: VisionCapabilities;
  candidates: {
    walls: PixelWallCandidate[];
    openings: PixelOpeningCandidate[];
    dimensions: PixelDimensionCandidate[];
    rooms: PixelRegionCandidate[];
    symbols: PixelSymbolCandidate[];
  };
  evidenceFiles: VisionEvidenceFile[];
  limitations: string[];
  audit: {
    modelCalls: 0;
    referenceAccess: "denied-and-audited";
    candidateInputs: Array<
      "image.bytes" | "scope" | "adapterVersion" | "provider.options"
    >;
    runtimeGuard?: {
      referenceAccess: "denied-and-audited";
      forbiddenRootCount: number;
      attemptCount: number;
    };
  };
}

const HASH = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,200}$/;
const SAFE_RELATIVE_PATH =
  /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_.:/-]+$/;

function invalid(message: string, field: string): never {
  throw new TypeError(`${field}: ${message}`);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("需要对象", field);
  return value as Record<string, unknown>;
}

function exactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  field: string,
) {
  const unknown = Object.keys(value).filter((key) => !fields.includes(key));
  if (unknown.length) invalid(`包含未知字段 ${unknown.join(", ")}`, field);
}

function text(value: unknown, field: string, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    invalid("需要有效文字", field);
  return value;
}

function identifier(value: unknown, field: string): string {
  const result = text(value, field, 200);
  if (!SAFE_ID.test(result)) invalid("ID 格式无效", field);
  return result;
}

function finite(value: unknown, field: string, min = -1e7, max = 1e7): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    invalid(`需要 ${min} 到 ${max} 的有限数字`, field);
  return value;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid("需要布尔值", field);
  return value;
}

function list<T>(
  value: unknown,
  field: string,
  max: number,
  parse: (item: unknown, itemField: string) => T,
): T[] {
  if (!Array.isArray(value) || value.length > max)
    invalid(`需要数组且最多 ${max} 项`, field);
  return value.map((item, index) => parse(item, `${field}.${index}`));
}

function textList(value: unknown, field: string, max = 100): string[] {
  return list(value, field, max, (item, itemField) =>
    text(item, itemField, 500),
  );
}

function evidenceRefs(value: unknown, field: string): string[] {
  const refs = textList(value, field, 100);
  if (new Set(refs).size !== refs.length) invalid("证据引用重复", field);
  return refs;
}

function optionalConfidence(value: unknown, field: string): number | undefined {
  return value === undefined ? undefined : finite(value, field, 0, 1);
}

function bbox(value: unknown, field: string): PixelBBox {
  if (!Array.isArray(value) || value.length !== 4)
    invalid("bbox 需要 [x, y, width, height]", field);
  const result = value.map((item, index) =>
    finite(item, `${field}.${index}`, index < 2 ? -1e7 : 0.001),
  ) as PixelBBox;
  return result;
}

function provider(value: unknown): VisionProviderDescriptor {
  const item = record(value, "provider");
  exactFields(
    item,
    ["id", "version", "repository", "commit", "license"],
    "provider",
  );
  return {
    id: identifier(item.id, "provider.id"),
    version: text(item.version, "provider.version", 100),
    repository: text(item.repository, "provider.repository", 500),
    commit: text(item.commit, "provider.commit", 100),
    license: text(item.license, "provider.license", 100),
  };
}

function wall(value: unknown, field: string): PixelWallCandidate {
  const item = record(value, field);
  exactFields(
    item,
    [
      "id",
      "orientation",
      "line",
      "start",
      "end",
      "thickness",
      "confidence",
      "evidenceRefs",
    ],
    field,
  );
  const orientation = text(item.orientation, `${field}.orientation`, 1);
  if (orientation !== "h" && orientation !== "v")
    invalid("orientation 需要 h 或 v", `${field}.orientation`);
  const start = finite(item.start, `${field}.start`);
  const end = finite(item.end, `${field}.end`);
  if (end <= start) invalid("end 必须大于 start", field);
  const confidence = optionalConfidence(item.confidence, `${field}.confidence`);
  return {
    id: identifier(item.id, `${field}.id`),
    orientation,
    line: finite(item.line, `${field}.line`),
    start,
    end,
    thickness: finite(item.thickness, `${field}.thickness`, 0.001),
    ...(confidence === undefined ? {} : { confidence }),
    evidenceRefs: evidenceRefs(item.evidenceRefs, `${field}.evidenceRefs`),
  };
}

function opening(value: unknown, field: string): PixelOpeningCandidate {
  const item = record(value, field);
  exactFields(
    item,
    [
      "id",
      "wallCandidateId",
      "orientation",
      "line",
      "start",
      "end",
      "typeHint",
      "confidence",
      "evidenceRefs",
    ],
    field,
  );
  const orientation = text(item.orientation, `${field}.orientation`, 1);
  if (orientation !== "h" && orientation !== "v")
    invalid("orientation 需要 h 或 v", `${field}.orientation`);
  const typeHint = text(item.typeHint, `${field}.typeHint`, 20);
  if (!["door", "window", "sliding", "hole", "unknown"].includes(typeHint))
    invalid("typeHint 无效", `${field}.typeHint`);
  const start = finite(item.start, `${field}.start`);
  const end = finite(item.end, `${field}.end`);
  if (end <= start) invalid("end 必须大于 start", field);
  const confidence = optionalConfidence(item.confidence, `${field}.confidence`);
  return {
    id: identifier(item.id, `${field}.id`),
    wallCandidateId:
      item.wallCandidateId === null
        ? null
        : identifier(item.wallCandidateId, `${field}.wallCandidateId`),
    orientation,
    line: finite(item.line, `${field}.line`),
    start,
    end,
    typeHint: typeHint as PixelOpeningCandidate["typeHint"],
    ...(confidence === undefined ? {} : { confidence }),
    evidenceRefs: evidenceRefs(item.evidenceRefs, `${field}.evidenceRefs`),
  };
}

function dimension(value: unknown, field: string): PixelDimensionCandidate {
  const item = record(value, field);
  exactFields(
    item,
    [
      "id",
      "axis",
      "side",
      "at",
      "start",
      "end",
      "unitHint",
      "confidence",
      "evidenceRefs",
    ],
    field,
  );
  const axis = text(item.axis, `${field}.axis`, 1);
  if (axis !== "h" && axis !== "v")
    invalid("axis 需要 h 或 v", `${field}.axis`);
  const side = text(item.side, `${field}.side`, 20);
  if (!["top", "bottom", "left", "right", "unknown"].includes(side))
    invalid("side 无效", `${field}.side`);
  const start = finite(item.start, `${field}.start`);
  const end = finite(item.end, `${field}.end`);
  if (end <= start) invalid("end 必须大于 start", field);
  const confidence = optionalConfidence(item.confidence, `${field}.confidence`);
  return {
    id: identifier(item.id, `${field}.id`),
    axis,
    side: side as PixelDimensionCandidate["side"],
    at: finite(item.at, `${field}.at`),
    start,
    end,
    unitHint:
      item.unitHint === null
        ? null
        : text(item.unitHint, `${field}.unitHint`, 30),
    ...(confidence === undefined ? {} : { confidence }),
    evidenceRefs: evidenceRefs(item.evidenceRefs, `${field}.evidenceRefs`),
  };
}

function region(value: unknown, field: string): PixelRegionCandidate {
  const item = record(value, field);
  exactFields(item, ["id", "bbox", "evidenceRefs"], field);
  return {
    id: identifier(item.id, `${field}.id`),
    bbox: bbox(item.bbox, `${field}.bbox`),
    evidenceRefs: evidenceRefs(item.evidenceRefs, `${field}.evidenceRefs`),
  };
}

function symbol(value: unknown, field: string): PixelSymbolCandidate {
  const item = record(value, field);
  exactFields(item, ["id", "bbox", "evidenceRefs"], field);
  return {
    id: identifier(item.id, `${field}.id`),
    bbox: bbox(item.bbox, `${field}.bbox`),
    evidenceRefs: evidenceRefs(item.evidenceRefs, `${field}.evidenceRefs`),
  };
}

function evidenceFile(value: unknown, field: string): VisionEvidenceFile {
  const item = record(value, field);
  exactFields(item, ["id", "kind", "path", "sha256", "mediaType"], field);
  const kind = text(item.kind, `${field}.kind`, 20);
  if (!["diagnostic", "mask", "overlay", "crop"].includes(kind))
    invalid("kind 无效", `${field}.kind`);
  const path = text(item.path, `${field}.path`, 500);
  if (!SAFE_RELATIVE_PATH.test(path))
    invalid("path 必须是安全的仓库相对路径", `${field}.path`);
  const sha256 = text(item.sha256, `${field}.sha256`, 64);
  if (!HASH.test(sha256)) invalid("sha256 无效", `${field}.sha256`);
  const mediaType = text(item.mediaType, `${field}.mediaType`, 100);
  if (!["image/png", "application/json"].includes(mediaType))
    invalid("mediaType 无效", `${field}.mediaType`);
  return {
    id: identifier(item.id, `${field}.id`),
    kind: kind as VisionEvidenceFile["kind"],
    path,
    sha256,
    mediaType: mediaType as VisionEvidenceFile["mediaType"],
  };
}

/** Strict parser used at provider and scoring boundaries. */
export function validateFloorplanVisionArtifact(
  value: unknown,
): FloorplanVisionArtifact {
  const item = record(value, "artifact");
  exactFields(
    item,
    [
      "schemaVersion",
      "artifactId",
      "provider",
      "input",
      "scope",
      "capabilities",
      "candidates",
      "evidenceFiles",
      "limitations",
      "audit",
    ],
    "artifact",
  );
  if (item.schemaVersion !== FLOORPLAN_VISION_ARTIFACT_SCHEMA)
    invalid("schemaVersion 无效", "artifact.schemaVersion");

  const input = record(item.input, "input");
  exactFields(
    input,
    ["imageSha256", "width", "height", "coordinateSpace"],
    "input",
  );
  const imageSha256 = text(input.imageSha256, "input.imageSha256", 64);
  if (!HASH.test(imageSha256)) invalid("sha256 无效", "input.imageSha256");
  if (input.coordinateSpace !== "exif-oriented-original-pixels")
    invalid("坐标空间无效", "input.coordinateSpace");

  const scope = record(item.scope, "scope");
  exactFields(
    scope,
    ["roomSelection", "functionalAreas", "excludeFunctionalAreas"],
    "scope",
  );
  if (!["all_visible", "selected"].includes(String(scope.roomSelection)))
    invalid("roomSelection 无效", "scope.roomSelection");

  const capabilitiesValue = record(item.capabilities, "capabilities");
  exactFields(
    capabilitiesValue,
    ["walls", "openings", "dimensions", "rooms", "symbols"],
    "capabilities",
  );
  const capabilities: VisionCapabilities = {
    walls: boolean(capabilitiesValue.walls, "capabilities.walls"),
    openings: boolean(capabilitiesValue.openings, "capabilities.openings"),
    dimensions: boolean(
      capabilitiesValue.dimensions,
      "capabilities.dimensions",
    ),
    rooms: boolean(capabilitiesValue.rooms, "capabilities.rooms"),
    symbols: boolean(capabilitiesValue.symbols, "capabilities.symbols"),
  };

  const candidates = record(item.candidates, "candidates");
  exactFields(
    candidates,
    ["walls", "openings", "dimensions", "rooms", "symbols"],
    "candidates",
  );
  const walls = list(candidates.walls, "candidates.walls", 3000, wall);
  const openings = list(
    candidates.openings,
    "candidates.openings",
    3000,
    opening,
  );
  const dimensions = list(
    candidates.dimensions,
    "candidates.dimensions",
    500,
    dimension,
  );
  const rooms = list(candidates.rooms, "candidates.rooms", 1000, region);
  const symbols = list(candidates.symbols, "candidates.symbols", 3000, symbol);
  for (const [name, available, values] of [
    ["walls", capabilities.walls, walls],
    ["openings", capabilities.openings, openings],
    ["dimensions", capabilities.dimensions, dimensions],
    ["rooms", capabilities.rooms, rooms],
    ["symbols", capabilities.symbols, symbols],
  ] as const) {
    if (!available && values.length)
      invalid(`未声明 ${name} 能力时不能返回该候选`, `candidates.${name}`);
  }

  const allIds = [
    ...walls,
    ...openings,
    ...dimensions,
    ...rooms,
    ...symbols,
  ].map((candidate) => candidate.id);
  if (allIds.length !== new Set(allIds).size)
    invalid("候选 ID 重复", "candidates");
  const wallIds = new Set(walls.map((candidate) => candidate.id));
  for (const candidate of openings) {
    if (
      candidate.wallCandidateId !== null &&
      !wallIds.has(candidate.wallCandidateId)
    )
      invalid(
        `门窗引用了未知候选墙 ${candidate.wallCandidateId}`,
        "candidates.openings",
      );
  }

  const evidenceFiles = list(
    item.evidenceFiles,
    "evidenceFiles",
    500,
    evidenceFile,
  );
  if (
    evidenceFiles.length !==
    new Set(evidenceFiles.map((candidate) => candidate.id)).size
  )
    invalid("证据文件 ID 重复", "evidenceFiles");

  const audit = record(item.audit, "audit");
  exactFields(
    audit,
    ["modelCalls", "referenceAccess", "candidateInputs", "runtimeGuard"],
    "audit",
  );
  if (audit.modelCalls !== 0)
    invalid("离线候选必须为 0 次模型调用", "audit.modelCalls");
  if (audit.referenceAccess !== "denied-and-audited")
    invalid("参考隔离声明无效", "audit.referenceAccess");
  const candidateInputs = textList(
    audit.candidateInputs,
    "audit.candidateInputs",
    10,
  );
  const allowedInputs = [
    "image.bytes",
    "scope",
    "adapterVersion",
    "provider.options",
  ];
  if (
    !candidateInputs.length ||
    candidateInputs.some((inputName) => !allowedInputs.includes(inputName))
  )
    invalid("候选输入超出允许集合", "audit.candidateInputs");
  let runtimeGuard:
    FloorplanVisionArtifact["audit"]["runtimeGuard"] | undefined;
  if (audit.runtimeGuard !== undefined) {
    const guard = record(audit.runtimeGuard, "audit.runtimeGuard");
    exactFields(
      guard,
      ["referenceAccess", "forbiddenRootCount", "attemptCount"],
      "audit.runtimeGuard",
    );
    if (guard.referenceAccess !== "denied-and-audited")
      invalid("运行时证据守卫声明无效", "audit.runtimeGuard.referenceAccess");
    runtimeGuard = {
      referenceAccess: "denied-and-audited",
      forbiddenRootCount: finite(
        guard.forbiddenRootCount,
        "audit.runtimeGuard.forbiddenRootCount",
        0,
        100,
      ),
      attemptCount: finite(
        guard.attemptCount,
        "audit.runtimeGuard.attemptCount",
        0,
        100,
      ),
    };
  }

  return {
    schemaVersion: FLOORPLAN_VISION_ARTIFACT_SCHEMA,
    artifactId: identifier(item.artifactId, "artifactId"),
    provider: provider(item.provider),
    input: {
      imageSha256,
      width: finite(input.width, "input.width", 1, 25000000),
      height: finite(input.height, "input.height", 1, 25000000),
      coordinateSpace: "exif-oriented-original-pixels",
    },
    scope: {
      roomSelection: scope.roomSelection as "all_visible" | "selected",
      functionalAreas: textList(
        scope.functionalAreas,
        "scope.functionalAreas",
        50,
      ),
      excludeFunctionalAreas: textList(
        scope.excludeFunctionalAreas,
        "scope.excludeFunctionalAreas",
        50,
      ),
    },
    capabilities,
    candidates: { walls, openings, dimensions, rooms, symbols },
    evidenceFiles,
    limitations: textList(item.limitations, "limitations", 100),
    audit: {
      modelCalls: 0,
      referenceAccess: "denied-and-audited",
      candidateInputs:
        candidateInputs as FloorplanVisionArtifact["audit"]["candidateInputs"],
      ...(runtimeGuard === undefined ? {} : { runtimeGuard }),
    },
  };
}
