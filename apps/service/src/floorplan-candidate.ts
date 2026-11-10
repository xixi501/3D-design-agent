/** Read-only HPD pixel candidate endpoint for remote Python agent containers. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  ARTIFACT_ENVELOPE_SCHEMA,
  type ArtifactEnvelopeV1,
} from "../../../packages/scene-core/src/artifact-envelope.js";
import {
  validateFloorplanVisionArtifact,
  type FloorplanVisionArtifact,
} from "../../../packages/scene-core/src/vision-artifact.js";
import { imageProcess, type FloorplanStore } from "./floorplans.js";
import { canonical } from "./store.js";
import { SceneError } from "../../../packages/scene-core/src/index.js";

const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const sha256 = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const ADAPTERS = new Set([
  "hpd-adapter-2",
  "hpd-adapter-3",
  "hpd-adapter-4",
  "hpd-adapter-5",
  "hpd-adapter-6",
  "hpd-adapter-6-1",
]);

function object(value: unknown, name: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SceneError("INVALID_REQUEST", `${name} 必须是对象`, 422);
  return value as Record<string, any>;
}
function array(value: unknown, name: string): any[] {
  if (!Array.isArray(value))
    throw new SceneError("INVALID_REQUEST", `${name} 必须是数组`, 422);
  return value;
}
function finite(value: unknown, name: string, minimum = -1e7): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum)
    throw new SceneError("INVALID_REQUEST", `${name} 不是有效有限数字`, 422);
  return value;
}
function text(value: unknown, name: string, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new SceneError("INVALID_REQUEST", `${name} 需要有效文字`, 422);
  return value;
}
function scope(value: unknown): FloorplanVisionArtifact["scope"] {
  const raw = value === undefined ? {} : object(value, "scope");
  const roomSelection =
    raw.roomSelection === "selected" ? "selected" : "all_visible";
  const functionalAreas = array(raw.functionalAreas || [], "scope.functionalAreas").map(
    (item) => String(item),
  );
  const excludeFunctionalAreas = array(
    raw.excludeFunctionalAreas || [],
    "scope.excludeFunctionalAreas",
  ).map((item) => String(item));
  return {
    roomSelection,
    functionalAreas: functionalAreas.slice(0, 13),
    excludeFunctionalAreas: excludeFunctionalAreas.slice(0, 13),
  };
}
function imageBytes(body: any, store: FloorplanStore): { bytes: Buffer; imageId?: string } {
  if (body.imageId !== undefined) {
    const image = store.verifyImage(body.imageId);
    return {
      bytes: fs.readFileSync(store.file(body.imageId, "original").file),
      imageId: image.id,
    };
  }
  if (body.imageBase64 !== undefined) {
    const encoded = String(body.imageBase64).replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
    let bytes: Buffer;
    try {
      bytes = Buffer.from(encoded, "base64");
    } catch {
      throw new SceneError("INVALID_IMAGE", "图片 base64 无效", 422);
    }
    if (!bytes.length || bytes.length > 20 * 1024 * 1024)
      throw new SceneError("INVALID_IMAGE", "图片需要不超过 20 MB", 422);
    return { bytes };
  }
  if (body.imagePath !== undefined) {
    const root = path.resolve(
      process.env.ACTISCAPE_FLOORPLAN_SOURCE_ROOT || "data/floorplan-images",
    );
    const candidate = path.resolve(String(body.imagePath));
    if (!candidate.startsWith(root + path.sep))
      throw new SceneError("INVALID_REQUEST", "图片路径超出允许目录", 422);
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile())
      throw new SceneError("NOT_FOUND", "图片路径不存在", 404);
    return { bytes: fs.readFileSync(candidate) };
  }
  throw new SceneError(
    "INVALID_REQUEST",
    "需要 imageId、imageBase64 或 imagePath 之一",
    422,
  );
}
function isImage(bytes: Buffer): boolean {
  return (
    (bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47) ||
    (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8)
  );
}

function normalize(
  raw: any,
  image: Buffer,
  scopeValue: FloorplanVisionArtifact["scope"],
  adapterVersion: string,
): FloorplanVisionArtifact {
  const result = object(raw.result || {}, "result");
  const size = array(result.size, "result.size");
  if (size.length !== 2)
    throw new SceneError("FLOORPLAN_CANDIDATE_FAILED", "候选没有返回图片尺寸", 422);
  const width = finite(size[0], "result.size[0]", 1);
  const height = finite(size[1], "result.size[1]", 1);
  const imageSha256 = sha256(image);
  const walls = array(result.candidateWalls || [], "candidateWalls").map((value) => {
    const item = object(value, "candidateWall");
    const orientation = item.orient === "v" ? "v" : item.orient === "h" ? "h" : null;
    if (!orientation)
      throw new SceneError("FLOORPLAN_CANDIDATE_FAILED", "墙候选方向无效", 422);
    return {
      id: String(item.candidateWallId),
      orientation,
      line: finite(item.line, "wall.line"),
      start: finite(item.s0, "wall.s0"),
      end: finite(item.s1, "wall.s1"),
      thickness: finite(item.t, "wall.t", 0.001),
      ...(typeof item.confidence === "number" ? { confidence: item.confidence } : {}),
      evidenceRefs: [
        `provider:wall:${item.candidateWallId}`,
        "artifact:wallmask.png",
      ],
    };
  });
  const openings = array(result.openingCandidates || [], "openingCandidates").map(
    (value) => {
      const item = object(value, "openingCandidate");
      const orientation = item.orient === "v" ? "v" : item.orient === "h" ? "h" : null;
      if (!orientation)
        throw new SceneError("FLOORPLAN_CANDIDATE_FAILED", "洞口候选方向无效", 422);
      const typeHint = ["door", "window", "sliding", "hole"].includes(item.typeHint)
        ? item.typeHint
        : "unknown";
      return {
        id: String(item.candidateId),
        wallCandidateId:
          typeof item.candidateWallId === "string" ? item.candidateWallId : null,
        orientation,
        line: finite(item.line, "opening.line"),
        start: finite(item.start, "opening.start"),
        end: finite(item.end, "opening.end"),
        typeHint,
        ...(typeof item.confidence === "number" ? { confidence: item.confidence } : {}),
        evidenceRefs: [
          `provider:opening:${item.candidateId}`,
          "artifact:candidates.png",
        ],
      };
    },
  );
  const dimensions = array(result.dimensionCandidates || [], "dimensionCandidates").map(
    (value) => {
      const item = object(value, "dimensionCandidate");
      const a = object(item.a || {}, "dimension.a");
      const b = object(item.b || {}, "dimension.b");
      const axis = item.axis === "v" ? "v" : item.axis === "h" ? "h" : null;
      if (!axis)
        throw new SceneError("FLOORPLAN_CANDIDATE_FAILED", "尺寸候选轴无效", 422);
      const start = finite(axis === "v" ? a.y : a.x, "dimension.start");
      const end = finite(axis === "v" ? b.y : b.x, "dimension.end");
      const side = ["top", "bottom", "left", "right"].includes(item.side)
        ? item.side
        : "unknown";
      return {
        id: String(item.candidateId),
        axis,
        side,
        at: finite(axis === "v" ? a.x : a.y, "dimension.at"),
        start: Math.min(start, end),
        end: Math.max(start, end),
        unitHint: typeof item.unitHint === "string" ? item.unitHint : null,
        ...(typeof item.confidence === "number" ? { confidence: item.confidence } : {}),
        evidenceRefs: [`provider:dimension:${item.candidateId}`],
      };
    },
  );
  return validateFloorplanVisionArtifact({
    schemaVersion: "actiscape.floorplan-vision-artifact.v1",
    artifactId: `hpd:${imageSha256.slice(0, 16)}`,
    provider: {
      id: "hpd-adapter-6-1",
      version: String(raw.adapterVersion || adapterVersion),
      repository: String(raw.repository || "house-plan-designer"),
      commit: String(raw.commit || ""),
      license: String(raw.license || "unknown"),
    },
    input: {
      imageSha256,
      width,
      height,
      coordinateSpace: "exif-oriented-original-pixels",
    },
    scope: scopeValue,
    capabilities: {
      walls: true,
      openings: true,
      dimensions: true,
      rooms: false,
      symbols: false,
    },
    candidates: { walls, openings, dimensions, rooms: [], symbols: [] },
    evidenceFiles: [],
    limitations: [
      ...array(raw.limitations || [], "limitations").map((item) => String(item)),
      "远端候选证据文件由网关隔离保存；此 envelope 只返回像素候选，不写正式项目",
    ],
    audit: {
      modelCalls: 0,
      referenceAccess: "denied-and-audited",
      candidateInputs: ["image.bytes", "scope", "adapterVersion"],
      runtimeGuard: {
        referenceAccess: "denied-and-audited",
        forbiddenRootCount: 0,
        attemptCount: 0,
      },
    },
  });
}

export class FloorplanCandidateService {
  constructor(public store: FloorplanStore) {}
  async run(body: any): Promise<ArtifactEnvelopeV1> {
    if (!body || typeof body !== "object")
      throw new SceneError("INVALID_REQUEST", "候选请求必须是对象", 422);
    const adapterVersion = body.adapterVersion || "hpd-adapter-6-1";
    if (!ADAPTERS.has(adapterVersion))
      throw new SceneError("INVALID_REQUEST", "不支持的候选适配版本", 422);
    const scopeValue = scope(body.scope);
    const { bytes, imageId } = imageBytes(body, this.store);
    if (!isImage(bytes))
      throw new SceneError("INVALID_IMAGE", "候选输入需要 PNG/JPEG", 422);
    const payload = Buffer.from(
      JSON.stringify({
        mode: "analyze",
        parameters: body.parameters || {},
        adapterVersion,
        image: bytes.toString("base64"),
      }),
    );
    let raw: any;
    try {
      raw = await imageProcess(payload, "", true, false);
    } catch (error: any) {
      throw new SceneError(
        "FLOORPLAN_CANDIDATE_FAILED",
        error?.message || "HPD 候选提取失败",
        422,
        error?.details,
      );
    }
    const artifact = normalize(raw, bytes, scopeValue, adapterVersion);
    if (!artifact.input.imageSha256)
      throw new SceneError("FLOORPLAN_CANDIDATE_FAILED", "候选缺少输入哈希", 422);
    if (imageId) artifact.artifactId = `hpd:${imageId.slice(0, 16)}`;
    const artifactSha256 = digest(artifact);
    return {
      schemaVersion: ARTIFACT_ENVELOPE_SCHEMA,
      kind: "floorplan-vision",
      providerId: "hpd-adapter-6-1",
      providerVersion: artifact.provider.version,
      inputSha256: artifact.input.imageSha256,
      scopeHash: digest(scopeValue),
      artifact: artifact as unknown as Record<string, unknown>,
      artifactSha256,
    };
  }
}

export function floorplanCandidateRoutes(
  app: FastifyInstance,
  store: FloorplanStore,
) {
  const service = new FloorplanCandidateService(store);
  app.post(
    "/api/tools/floorplan-candidate",
    {
      schema: {
        description:
          "Run pinned HPD pixel candidate extraction on the gateway. Read-only: never writes a project/draft/history. Returns ArtifactEnvelopeV1.",
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req) => service.run(req.body),
  );
}
