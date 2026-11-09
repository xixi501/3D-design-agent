import {
  floorplanScale,
  validateFloorplan,
  type FloorplanData,
} from "./floorplan.js";
import {
  SCENE_PROGRAM_SCHEMA,
  validateSceneProgram,
  type SceneProgram,
} from "./scene-program.js";
import { SceneError } from "./index.js";

export const FLOORPLAN_RECOGNITION_SCHEMA =
  "actiscape.floorplan-recognition.v1";

export interface FloorplanRecognition {
  schemaVersion: typeof FLOORPLAN_RECOGNITION_SCHEMA;
  kind: "floorplan";
  sourceId: string;
  adapterVersion: string;
  proposal: FloorplanData;
  confirmed: {
    revision: number;
    hash: string;
    projectRevision: number;
    requestId: string;
    confirmedAt: string;
  } | null;
  sourceReview: {
    hash: string;
    review: Record<string, unknown>;
    evidenceRefs: string[];
  } | null;
  corrections: number;
  agentEdits: number;
  changeLedger: Array<Record<string, unknown>>;
}

function invalid(message: string, field: string): never {
  throw new SceneError("SCENE_DRAFT_INVALID", `${field}: ${message}`, 422, {
    field,
  });
}

function object(value: unknown, field: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("需要对象", field);
  return value as Record<string, any>;
}

function text(value: unknown, field: string, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    invalid("需要有效文字", field);
  return value;
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum)
    invalid(`需要大于等于 ${minimum} 的整数`, field);
  return value as number;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(item[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function floorplanToSceneProgram(
  input: unknown,
  sourceId: string,
): SceneProgram {
  const proposal = validateFloorplan(input as FloorplanData);
  const scale = floorplanScale(proposal);
  const sourceRefs = [{ sourceId, authority: "observed" as const }];
  const targetRoomIds = new Set(proposal.targetRoomIds);
  const roomIds = new Set(proposal.rooms.map((room) => room.id));
  const wallThickness =
    proposal.wallThickness ??
    Math.max(
      100,
      ...proposal.walls.map((wall) => (wall.thicknessPx ?? 20) * scale),
    );
  const level = {
    id: "level-1",
    name: "一层",
    elevation: 0,
    height: proposal.height ?? 2800,
    walls: proposal.walls.map((wall) => ({
      id: wall.id,
      a: { x: wall.a.x * scale, y: wall.a.y * scale },
      b: { x: wall.b.x * scale, y: wall.b.y * scale },
      thickness: wall.thicknessPx ? wall.thicknessPx * scale : wallThickness,
      sourceRefs,
    })),
    openings: proposal.openings.map((opening) => ({
      id: opening.id,
      wallId: opening.wallId,
      type: opening.type,
      offset: opening.offset * scale,
      width: opening.width * scale,
      ...(opening.sill === undefined ? {} : { sill: opening.sill }),
      ...(opening.head === undefined ? {} : { head: opening.head }),
      ...(opening.side === undefined ? {} : { side: opening.side }),
      ...(opening.hinge === undefined ? {} : { hinge: opening.hinge }),
      sourceRefs,
    })),
    roomSeeds: proposal.rooms.map((room) => ({
      id: room.id,
      at: { x: room.at.x * scale, y: room.at.y * scale },
      name: room.name,
      roomType: room.roomType || room.functionalArea || "other",
      included: targetRoomIds.has(room.id),
      ...(room.name ? { sourceLabel: room.name } : {}),
      sourceRefs,
    })),
  };
  const objects = proposal.symbols.map((symbol) => {
    const roomId = roomIds.has(symbol.roomId) ? symbol.roomId : undefined;
    return {
      id: symbol.id,
      levelId: "level-1",
      ...(roomId ? { roomSeedId: roomId } : {}),
      categoryId: symbol.categoryCode || symbol.category,
      sourceLabel: symbol.sourceLabel || symbol.category,
      included:
        Boolean(roomId) &&
        targetRoomIds.has(symbol.roomId) &&
        symbol.included !== false,
      placement: "floor" as const,
      x: symbol.x * scale,
      y: symbol.y * scale,
      w: symbol.w * scale,
      d: symbol.d * scale,
      rot: symbol.rot,
      ...(symbol.catalogKey ? { catalogKey: symbol.catalogKey } : {}),
      ...(symbol.evidenceRefs
        ? { evidenceRefs: [...symbol.evidenceRefs] }
        : {}),
      sourceRefs,
    };
  });
  return validateSceneProgram({
    schemaVersion: SCENE_PROGRAM_SCHEMA,
    units: "mm",
    levels: [level],
    objects,
    unknowns: [],
    authority: [
      {
        path: "program.levels",
        authority: "observed",
        sourceIds: [sourceId],
      },
    ],
  });
}

export function validateFloorplanRecognition(
  input: unknown,
  options: {
    sourceIds: Set<string>;
    sourceKinds: Map<string, string>;
    sourceSha256: Map<string, string | undefined>;
  },
): FloorplanRecognition {
  const value = object(input, "recognition");
  if (value.schemaVersion !== FLOORPLAN_RECOGNITION_SCHEMA)
    invalid("识别块 schema 无效", "recognition.schemaVersion");
  if (value.kind !== "floorplan") invalid("识别块类型无效", "recognition.kind");
  const sourceId = text(value.sourceId, "recognition.sourceId", 200);
  if (!options.sourceIds.has(sourceId))
    invalid("识别块引用未知来源", "recognition.sourceId");
  if (options.sourceKinds.get(sourceId) !== "floorplan_image")
    invalid("识别块必须引用户型图来源", "recognition.sourceId");
  const proposal = validateFloorplan(value.proposal);
  if (proposal.image.sha256 !== options.sourceSha256.get(sourceId))
    invalid("识别图片与输入来源哈希不一致", "recognition.proposal.image");
  const confirmed =
    value.confirmed === null
      ? null
      : (() => {
          const item = object(value.confirmed, "recognition.confirmed");
          return {
            revision: integer(
              item.revision,
              "recognition.confirmed.revision",
              0,
            ),
            hash: text(item.hash, "recognition.confirmed.hash", 64),
            projectRevision: integer(
              item.projectRevision,
              "recognition.confirmed.projectRevision",
              0,
            ),
            requestId: text(
              item.requestId,
              "recognition.confirmed.requestId",
              200,
            ),
            confirmedAt: text(
              item.confirmedAt,
              "recognition.confirmed.confirmedAt",
              100,
            ),
          };
        })();
  const sourceReview =
    value.sourceReview === null
      ? null
      : (() => {
          const item = object(value.sourceReview, "recognition.sourceReview");
          if (!Array.isArray(item.evidenceRefs))
            invalid(
              "审核证据必须是数组",
              "recognition.sourceReview.evidenceRefs",
            );
          return {
            hash: text(item.hash, "recognition.sourceReview.hash", 64),
            review: object(item.review, "recognition.sourceReview.review"),
            evidenceRefs: item.evidenceRefs.map((ref: unknown, index: number) =>
              text(ref, `recognition.sourceReview.evidenceRefs.${index}`, 500),
            ),
          };
        })();
  if (!Array.isArray(value.changeLedger))
    invalid("变更账本必须是数组", "recognition.changeLedger");
  return {
    schemaVersion: FLOORPLAN_RECOGNITION_SCHEMA,
    kind: "floorplan",
    sourceId,
    adapterVersion: text(
      value.adapterVersion,
      "recognition.adapterVersion",
      100,
    ),
    proposal,
    confirmed,
    sourceReview,
    corrections: integer(value.corrections, "recognition.corrections", 0),
    agentEdits: integer(value.agentEdits, "recognition.agentEdits", 0),
    changeLedger: value.changeLedger.map((item: unknown, index: number) =>
      object(item, `recognition.changeLedger.${index}`),
    ),
  };
}

export function assertFloorplanProgram(
  program: SceneProgram,
  recognition: FloorplanRecognition,
) {
  const expected = floorplanToSceneProgram(
    recognition.proposal,
    recognition.sourceId,
  );
  if (stable(program) !== stable(expected))
    invalid("SceneProgram 与识别提案不派生一致", "program");
}
