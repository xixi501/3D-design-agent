import { SceneError } from "./index.js";
import { sceneRoomKind, type SceneRoomKind } from "./room-kinds.js";

export const SCENE_PROGRAM_SCHEMA = "actiscape.scene-program.v1";
export const MAX_SCENE_LEVELS = 20;
export const MAX_SCENE_OBJECTS = 300;
export const MAX_SCENE_WALLS_PER_LEVEL = 500;
export const MAX_SCENE_ROOM_SEEDS = 200;

export type SceneAuthority =
  | "baseline"
  | "observed"
  | "inferred"
  | "user_intent"
  | "manual";

export interface ScenePoint {
  x: number;
  y: number;
}

export interface SceneSourceRef {
  sourceId: string;
  evidenceRefs?: string[];
  authority: SceneAuthority;
}

export interface SceneWall {
  id: string;
  a: ScenePoint;
  b: ScenePoint;
  thickness: number;
  bearing?: boolean;
  status?: "existing" | "new" | "demolished";
  sourceRefs?: SceneSourceRef[];
}

export interface SceneOpening {
  id: string;
  wallId: string;
  type: "door" | "window" | "hole" | "sliding";
  offset: number;
  width: number;
  sill?: number;
  head?: number;
  side?: -1 | 1;
  hinge?: 0 | 1;
  sourceRefs?: SceneSourceRef[];
}

export interface SceneRoomSeed {
  id: string;
  at: ScenePoint;
  name: string;
  roomType: string;
  included: boolean;
  sourceLabel?: string;
  sourceRefs?: SceneSourceRef[];
}

export interface SceneLevel {
  id: string;
  name: string;
  elevation: number;
  height: number;
  walls: SceneWall[];
  openings: SceneOpening[];
  roomSeeds: SceneRoomSeed[];
}

export interface SceneObject {
  id: string;
  levelId: string;
  roomSeedId?: string;
  categoryId: string;
  sourceLabel: string;
  included: boolean;
  placement: "floor" | "wall" | "surface" | "ceiling";
  x: number;
  y: number;
  z?: number;
  w: number;
  d: number;
  h?: number;
  rot: number;
  parentObjectId?: string;
  catalogKey?: string;
  evidenceRefs?: string[];
  sourceRefs?: SceneSourceRef[];
}

export interface SceneUnknown {
  id: string;
  levelId?: string;
  roomSeedId?: string;
  kind: "room" | "object" | "structure";
  sourceLabel: string;
  geometry?: Record<string, unknown>;
  evidenceRefs: string[];
  sourceRefs?: SceneSourceRef[];
}

export interface SceneAuthorityEntry {
  path: string;
  authority: SceneAuthority;
  sourceIds?: string[];
  confidence?: number;
}

export interface SceneProgram {
  schemaVersion: "actiscape.scene-program.v1";
  units: "mm";
  levels: SceneLevel[];
  objects: SceneObject[];
  unknowns: SceneUnknown[];
  authority: SceneAuthorityEntry[];
}

export interface SceneProgramPolicy {
  orthogonalOnly: boolean;
  singleLevel: boolean;
  requireIncludedRoom: boolean;
}

export const CURRENT_SCENE_PROGRAM_POLICY: SceneProgramPolicy = {
  orthogonalOnly: true,
  singleLevel: true,
  requireIncludedRoom: true,
};

const invalid = (message: string, field: string): never => {
  throw new SceneError("SCENE_PROGRAM_INVALID", message, 422, { field });
};

const record = (value: unknown, field: string): Record<string, any> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("需要对象", field);
  return value as Record<string, any>;
};

const text = (value: unknown, field: string, max = 200): string => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    invalid("需要有效文字", field);
  return value as string;
};

const number = (value: unknown, field: string, min = -1e9, max = 1e9) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    invalid("需要有限数值", field);
  return value as number;
};

const point = (value: unknown, field: string): ScenePoint => {
  const v = record(value, field);
  return {
    x: number(v.x, field + ".x"),
    y: number(v.y, field + ".y"),
  };
};

const authority = (value: unknown, field: string): SceneAuthority => {
  const values: SceneAuthority[] = [
    "baseline",
    "observed",
    "inferred",
    "user_intent",
    "manual",
  ];
  if (!values.includes(value as SceneAuthority))
    invalid("未知 authority", field);
  return value as SceneAuthority;
};

const sourceRefs = (value: unknown, field: string): SceneSourceRef[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50)
    invalid("sourceRefs 必须是数组", field);
  return (value as unknown[]).map((item, index) => {
    const v = record(item, `${field}.${index}`);
    return {
      sourceId: text(v.sourceId, `${field}.${index}.sourceId`),
      authority: authority(v.authority, `${field}.${index}.authority`),
      ...(v.evidenceRefs === undefined
        ? {}
        : {
            evidenceRefs: v.evidenceRefs.map(
              (ref: unknown, refIndex: number) =>
                text(ref, `${field}.${index}.evidenceRefs.${refIndex}`),
            ),
          }),
    };
  });
};

export function blankSceneProgram(): SceneProgram {
  return {
    schemaVersion: SCENE_PROGRAM_SCHEMA,
    units: "mm",
    levels: [],
    objects: [],
    unknowns: [],
    authority: [],
  };
}

export function validateSceneProgram(
  input: unknown,
  policy: SceneProgramPolicy = CURRENT_SCENE_PROGRAM_POLICY,
): SceneProgram {
  const value = record(input, "program");
  if (value.schemaVersion !== SCENE_PROGRAM_SCHEMA)
    invalid("场景草稿 schema 无效", "program.schemaVersion");
  if (value.units !== "mm") invalid("场景草稿只接受毫米", "program.units");
  if (!Array.isArray(value.levels) || value.levels.length > MAX_SCENE_LEVELS)
    invalid("楼层数量无效", "program.levels");
  if (policy.singleLevel && value.levels.length > 1)
    invalid("当前能力策略只允许单层", "program.levels");
  if (!Array.isArray(value.objects) || value.objects.length > MAX_SCENE_OBJECTS)
    invalid("场景对象数量无效", "program.objects");
  if (
    !Array.isArray(value.unknowns) ||
    value.unknowns.length > MAX_SCENE_OBJECTS
  )
    invalid("未解析项数量无效", "program.unknowns");
  if (!Array.isArray(value.authority) || value.authority.length > 1000)
    invalid("authority 数量无效", "program.authority");

  const levelIds = new Set<string>();
  const wallIds = new Set<string>();
  const openingIds = new Set<string>();
  const roomSeedIds = new Set<string>();
  const roomSeedLevels = new Map<string, string>();
  const levels: SceneLevel[] = value.levels.map(
    (item: unknown, levelIndex: number) => {
      const field = `program.levels.${levelIndex}`;
      const level = record(item, field);
      const id = text(level.id, `${field}.id`);
      if (levelIds.has(id)) invalid("楼层 ID 重复", `${field}.id`);
      levelIds.add(id);
      if (
        !Array.isArray(level.walls) ||
        level.walls.length > MAX_SCENE_WALLS_PER_LEVEL
      )
        invalid("墙体数量无效", `${field}.walls`);
      if (
        !Array.isArray(level.openings) ||
        level.openings.length > MAX_SCENE_WALLS_PER_LEVEL
      )
        invalid("门窗数量无效", `${field}.openings`);
      if (
        !Array.isArray(level.roomSeeds) ||
        level.roomSeeds.length > MAX_SCENE_ROOM_SEEDS
      )
        invalid("房间种子数量无效", `${field}.roomSeeds`);

      const walls: SceneWall[] = level.walls.map(
        (wallValue: unknown, wallIndex: number) => {
          const wallField = `${field}.walls.${wallIndex}`;
          const wall = record(wallValue, wallField);
          const wallId = text(wall.id, `${wallField}.id`);
          if (wallIds.has(wallId)) invalid("墙体 ID 重复", `${wallField}.id`);
          wallIds.add(wallId);
          const a = point(wall.a, `${wallField}.a`);
          const b = point(wall.b, `${wallField}.b`);
          if (a.x === b.x && a.y === b.y) invalid("墙体长度不能为 0", wallField);
          if (
            policy.orthogonalOnly &&
            Math.abs(a.x - b.x) > 1e-6 &&
            Math.abs(a.y - b.y) > 1e-6
          )
            invalid("当前能力策略只允许正交墙", wallField);
          return {
            id: wallId,
            a,
            b,
            thickness: number(wall.thickness, `${wallField}.thickness`, 1, 5000),
            ...(wall.bearing === undefined
              ? {}
              : { bearing: Boolean(wall.bearing) }),
            ...(wall.status === undefined
              ? {}
              : {
                  status: ["existing", "new", "demolished"].includes(wall.status)
                    ? wall.status
                    : invalid("墙体状态无效", `${wallField}.status`),
                }),
            sourceRefs: sourceRefs(wall.sourceRefs, `${wallField}.sourceRefs`),
          };
        },
      );
      const openings: SceneOpening[] = level.openings.map(
        (openingValue: unknown, openingIndex: number) => {
          const openingField = `${field}.openings.${openingIndex}`;
          const opening = record(openingValue, openingField);
          const openingId = text(opening.id, `${openingField}.id`);
          if (openingIds.has(openingId))
            invalid("门窗 ID 重复", `${openingField}.id`);
          openingIds.add(openingId);
          const wallId = text(opening.wallId, `${openingField}.wallId`);
          if (!walls.some((wall) => wall.id === wallId))
            invalid(
              "门窗引用了其他楼层或不存在的墙",
              `${openingField}.wallId`,
            );
          if (!["door", "window", "hole", "sliding"].includes(opening.type))
            invalid("门窗类型无效", `${openingField}.type`);
          return {
            id: openingId,
            wallId,
            type: opening.type,
            offset: number(opening.offset, `${openingField}.offset`, 0),
            width: number(opening.width, `${openingField}.width`, 0.1),
            ...(opening.sill === undefined
              ? {}
              : { sill: number(opening.sill, `${openingField}.sill`, 0) }),
            ...(opening.head === undefined
              ? {}
              : { head: number(opening.head, `${openingField}.head`, 0.1) }),
            ...(opening.side === undefined
              ? {}
              : {
                  side:
                    opening.side === 1 || opening.side === -1
                      ? opening.side
                      : invalid("门窗侧向无效", `${openingField}.side`),
                }),
            ...(opening.hinge === undefined
              ? {}
              : {
                  hinge:
                    opening.hinge === 1 || opening.hinge === 0
                      ? opening.hinge
                      : invalid("门铰方向无效", `${openingField}.hinge`),
                }),
            sourceRefs: sourceRefs(
              opening.sourceRefs,
              `${openingField}.sourceRefs`,
            ),
          };
        },
      );
      const roomSeeds: SceneRoomSeed[] = level.roomSeeds.map(
        (roomValue: unknown, roomIndex: number) => {
          const roomField = `${field}.roomSeeds.${roomIndex}`;
          const room = record(roomValue, roomField);
          const id = text(room.id, `${roomField}.id`);
          if (roomSeedIds.has(id)) invalid("房间种子 ID 重复", `${roomField}.id`);
          roomSeedIds.add(id);
          roomSeedLevels.set(id, id);
          return {
            id,
            at: point(room.at, `${roomField}.at`),
            name: text(room.name, `${roomField}.name`, 100),
            roomType: text(room.roomType, `${roomField}.roomType`, 64),
            included: Boolean(room.included),
            ...(room.sourceLabel === undefined
              ? {}
              : {
                  sourceLabel: text(
                    room.sourceLabel,
                    `${roomField}.sourceLabel`,
                    100,
                  ),
                }),
            sourceRefs: sourceRefs(room.sourceRefs, `${roomField}.sourceRefs`),
          };
        },
      );
      for (const room of roomSeeds) roomSeedLevels.set(room.id, id);
      return {
        id,
        name: text(level.name, `${field}.name`, 100),
        elevation: number(level.elevation, `${field}.elevation`),
        height: number(level.height, `${field}.height`, 100, 20000),
        walls,
        openings,
        roomSeeds,
      };
    },
  );

  const objectIds = new Set<string>();
  const objects: SceneObject[] = value.objects.map(
    (objectValue: unknown, objectIndex: number) => {
      const field = `program.objects.${objectIndex}`;
      const object = record(objectValue, field);
      const id = text(object.id, `${field}.id`);
      if (objectIds.has(id)) invalid("对象 ID 重复", `${field}.id`);
      objectIds.add(id);
      const levelId = text(object.levelId, `${field}.levelId`);
      if (!levelIds.has(levelId))
        invalid("对象引用了未知楼层", `${field}.levelId`);
      const roomSeedId =
        object.roomSeedId === undefined
          ? undefined
          : text(object.roomSeedId, `${field}.roomSeedId`);
      if (roomSeedId !== undefined) {
        if (!roomSeedLevels.has(roomSeedId))
          invalid("对象引用了未知房间", `${field}.roomSeedId`);
        if (roomSeedLevels.get(roomSeedId) !== levelId)
          invalid("对象和房间不在同一楼层", `${field}.roomSeedId`);
      } else if (policy.requireIncludedRoom && object.included !== false)
        invalid("纳入对象必须归属房间", `${field}.roomSeedId`);
      if (!["floor", "wall", "surface", "ceiling"].includes(object.placement))
        invalid("对象放置类型无效", `${field}.placement`);
      return {
        id,
        levelId,
        ...(roomSeedId === undefined ? {} : { roomSeedId }),
        categoryId: text(object.categoryId, `${field}.categoryId`, 64),
        sourceLabel: text(object.sourceLabel, `${field}.sourceLabel`, 100),
        included: Boolean(object.included),
        placement: object.placement,
        x: number(object.x, `${field}.x`),
        y: number(object.y, `${field}.y`),
        ...(object.z === undefined
          ? {}
          : { z: number(object.z, `${field}.z`) }),
        w: number(object.w, `${field}.w`, 0.1),
        d: number(object.d, `${field}.d`, 0.1),
        ...(object.h === undefined
          ? {}
          : { h: number(object.h, `${field}.h`, 0.1) }),
        rot: number(object.rot, `${field}.rot`, -360, 360),
        ...(object.parentObjectId === undefined
          ? {}
          : {
              parentObjectId: text(
                object.parentObjectId,
                `${field}.parentObjectId`,
              ),
            }),
        ...(object.catalogKey === undefined
          ? {}
          : {
              catalogKey: text(
                object.catalogKey,
                `${field}.catalogKey`,
                100,
              ),
            }),
        evidenceRefs: Array.isArray(object.evidenceRefs)
          ? object.evidenceRefs.map((ref: unknown, refIndex: number) =>
              text(ref, `${field}.evidenceRefs.${refIndex}`),
            )
          : [],
        sourceRefs: sourceRefs(object.sourceRefs, `${field}.sourceRefs`),
      };
    },
  );
  for (const object of objects)
    if (object.parentObjectId && !objectIds.has(object.parentObjectId))
      invalid("对象父级不存在", "program.objects");

  const unknownIds = new Set<string>();
  const unknowns: SceneUnknown[] = value.unknowns.map(
    (unknownValue: unknown, unknownIndex: number) => {
      const field = `program.unknowns.${unknownIndex}`;
      const unknown = record(unknownValue, field);
      const id = text(unknown.id, `${field}.id`);
      if (unknownIds.has(id)) invalid("未解析项 ID 重复", `${field}.id`);
      unknownIds.add(id);
      if (!["room", "object", "structure"].includes(unknown.kind))
        invalid("未解析项类型无效", `${field}.kind`);
      const levelId =
        unknown.levelId === undefined
          ? undefined
          : text(unknown.levelId, `${field}.levelId`);
      if (levelId !== undefined && !levelIds.has(levelId))
        invalid("未解析项引用未知楼层", `${field}.levelId`);
      const roomSeedId =
        unknown.roomSeedId === undefined
          ? undefined
          : text(unknown.roomSeedId, `${field}.roomSeedId`);
      if (roomSeedId !== undefined) {
        if (!roomSeedLevels.has(roomSeedId))
          invalid("未解析项引用未知房间", `${field}.roomSeedId`);
        if (levelId !== undefined && roomSeedLevels.get(roomSeedId) !== levelId)
          invalid("未解析项和房间不在同一楼层", `${field}.roomSeedId`);
      }
      if (!Array.isArray(unknown.evidenceRefs) || !unknown.evidenceRefs.length)
        invalid("未解析项必须保留证据", `${field}.evidenceRefs`);
      return {
        id,
        ...(levelId === undefined ? {} : { levelId }),
        ...(roomSeedId === undefined ? {} : { roomSeedId }),
        kind: unknown.kind,
        sourceLabel: text(unknown.sourceLabel, `${field}.sourceLabel`, 100),
        ...(unknown.geometry === undefined
          ? {}
          : { geometry: record(unknown.geometry, `${field}.geometry`) }),
        evidenceRefs: unknown.evidenceRefs.map(
          (ref: unknown, refIndex: number) =>
            text(ref, `${field}.evidenceRefs.${refIndex}`),
        ),
        sourceRefs: sourceRefs(unknown.sourceRefs, `${field}.sourceRefs`),
      };
    },
  );

  const authorityEntries: SceneAuthorityEntry[] = value.authority.map(
    (item: unknown, index: number) => {
      const field = `program.authority.${index}`;
      const entry = record(item, field);
      return {
        path: text(entry.path, `${field}.path`, 500),
        authority: authority(entry.authority, `${field}.authority`),
        ...(entry.sourceIds === undefined
          ? {}
          : {
              sourceIds: entry.sourceIds.map(
                (id: unknown, sourceIndex: number) =>
                  text(id, `${field}.sourceIds.${sourceIndex}`),
              ),
            }),
        ...(entry.confidence === undefined
          ? {}
          : {
              confidence: number(
                entry.confidence,
                `${field}.confidence`,
                0,
                1,
              ),
            }),
      };
    },
  );

  return {
    schemaVersion: SCENE_PROGRAM_SCHEMA,
    units: "mm",
    levels,
    objects,
    unknowns,
    authority: authorityEntries,
  };
}

/** Rooms explicitly selected for the current whole-home scene. */
export function includedRoomSeeds(program: SceneProgram): SceneRoomSeed[] {
  return program.levels.flatMap((level) =>
    level.roomSeeds.filter((room) => room.included),
  );
}

/**
 * Spatial kind of a room seed. Floorplan recognition stores the registry room
 * type (for example `master_bedroom`); older programs may only carry a label,
 * so unknown values resolve to `other` rather than the legacy living/dining.
 */
export function roomKindOf(room: SceneRoomSeed): SceneRoomKind {
  return sceneRoomKind(room.roomType);
}

/**
 * Whole-home contract: included room identities are unique and available to
 * downstream asset/layout stages. This mirrors the `requireIncludedRoom` scene
 * policy without forcing every room to have furniture (hallways and storage
 * rooms may legitimately be empty).
 */
export function assertRoomCoverage(program: SceneProgram) {
  const included = includedRoomSeeds(program);
  const ids = new Set<string>();
  for (const room of included) {
    if (ids.has(room.id))
      throw new SceneError(
        "SCENE_PROGRAM_INVALID",
        `纳入房间身份重复：${room.id}`,
        422,
        { field: "program.levels.roomSeeds" },
      );
    ids.add(room.id);
  }
  return included;
}
