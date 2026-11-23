import { Hc, q0, yu, i7, ii, ja, F5, cs, tf, $r } from "./inherited/catalog.js";
import { Cu, Qc, Ns, L4, Ci, Zg, Ts, KU } from "./inherited/footprints.js";
import { Gb, xd } from "./inherited/house-spec.js";
import { Wc, D4, nM, F0, Ls } from "./inherited/topology.js";
import { validateDetails } from "./validation.js";
import { furnitureElevation } from "./placement.js";
import {
  openEnvelope,
  rotatedAabb,
  surfaceElevation,
  surfaceHostFor,
  surfaceOverhang,
} from "./actions.js";
export { furnitureElevation } from "./placement.js";
import {
  collections,
  SceneError,
  type Collection,
  type Command,
  type Entity,
  type Furniture,
  type Plan,
  type SceneState,
} from "./types.js";
export * from "./types.js";
export * from "./room-kinds.js";
export * from "./actions.js";
import { auditSafety } from "./safety-audit.js";
export * from "./safety-audit.js";
export * from "./mujoco-export.js";
export * from "./auto-repair.js";
export {
  Wc as wallGeometry,
  F0 as projectToWall,
  Ls as pointInPolygon,
  Cu as freeFootprint,
  Qc as freeShape,
  Ns as kitchenRecipe,
  L4 as tableOutline,
  Ci as isKitchen,
  i7 as freeShapes,
  ii as openingTypes,
  ja as freeMaterials,
  F5 as latheProfiles,
  cs as furnitureStyles,
  tf as styleTypes,
  $r as applyStyle,
};
export const detectRooms = (plan: Plan, geometry = Wc(plan)): any =>
  D4(plan, geometry);
export const catalog: Record<string, any> = q0;
export const catalogGroups: any[] = yu;
export function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  if (c && typeof c.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
export const clone = <T>(value: T): T =>
  value === undefined ? value : JSON.parse(JSON.stringify(value));
export const createFurniture = (
  key: string,
  x = 0,
  y = 0,
  overrides: Record<string, any> = {},
): Furniture => {
  if (typeof key !== "string" || !Object.hasOwn(catalog, key))
    throw new SceneError(
      "UNKNOWN_TYPE",
      `家具目录没有 ${typeof key === "string" ? key : "有效类型"}`,
    );
  return clone(
    Hc(key, x, y, overrides.rot || 0, { ...overrides, id: newId() }),
  ) as Furniture;
};
export function blankPlan(): Plan {
  return { ...xd(), voids: [], comments: [] } as Plan;
}
export function assetReferences(plan: Plan): string[] {
  return [
    ...new Set(
      plan.furniture.filter((f) => f.type === "model").map((f) => f.modelId!),
    ),
  ].sort();
}
function finite(n: unknown, name: string, min = -1000000, max = 1000000) {
  if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max)
    throw new SceneError(
      "INVALID_VALUE",
      `${name} 必须在 ${min}–${max} 范围内`,
      400,
      { field: name, min, max },
    );
}
function safeObject(value: any, depth = 0) {
  if (depth > 24) throw new SceneError("INVALID_DOCUMENT", "数据嵌套过深");
  if (typeof value === "number" && !Number.isFinite(value))
    throw new SceneError("INVALID_VALUE", "不能包含非有限数值");
  if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(k))
        throw new SceneError("INVALID_DOCUMENT", "非法数据字段");
      safeObject(v, depth + 1);
    }
}
export function validatePlan(plan: Plan) {
  safeObject(plan);
  if (!plan || plan.version !== 2)
    throw new SceneError(
      "UNSUPPORTED_FORMAT",
      "仅支持原版单层 v2 或 ActiScape v1 项目",
    );
  finite(plan.height, "层高", 100, 20000);
  if (plan.source !== undefined) {
    const s = plan.source;
    if (
      !s ||
      typeof s !== "object" ||
      Array.isArray(s) ||
      !["floorplan", "activity-groups", "safety-profile"].includes(s.kind)
    )
      throw new SceneError("INVALID_DOCUMENT", "来源信息类型无效");
    if (s.kind === "floorplan") {
      if (
        typeof s.imageId !== "string" ||
        !/^fp-[a-f0-9]{64}$/.test(s.imageId) ||
        !/^[a-f0-9]{64}$/.test(s.imageHash)
      )
        throw new SceneError("INVALID_DOCUMENT", "户型来源信息无效");
      finite(s.imageWidth, "source.imageWidth", 1, 25000000);
      finite(s.imageHeight, "source.imageHeight", 1, 25000000);
      if (s.imageWidth * s.imageHeight > 25000000)
        throw new SceneError("INVALID_DOCUMENT", "来源图片超过像素限制");
      if (s.draftHash !== undefined && !/^[a-f0-9]{64}$/.test(s.draftHash))
        throw new SceneError("INVALID_DOCUMENT", "来源确认哈希无效");
      if (
        s.draftRevision !== undefined &&
        (!Number.isInteger(s.draftRevision) || s.draftRevision < 0)
      )
        throw new SceneError("INVALID_DOCUMENT", "来源草稿版本无效");
      finite(s.mmPerPixel, "source.mmPerPixel", 0.001, 10000);
      if (s.measurementVersion !== undefined) {
        if (
          s.measurementVersion !== 2 ||
          s.measurement?.kernelVersion !== "axis-constraints-1" ||
          !Array.isArray(s.measurement.dimensions) ||
          !Array.isArray(s.measurement.features)
        )
          throw new SceneError(
            "UNSUPPORTED_FORMAT",
            "不支持的户型测量来源版本",
          );
        for (const d of s.measurement.dimensions) {
          finite(d.actualMm, "source.dimension.actualMm");
          finite(d.expectedMm, "source.dimension.expectedMm");
          finite(d.residualMm, "source.dimension.residualMm");
        }
      }
    }
    if (s.activityGroups !== undefined) {
      if (!Array.isArray(s.activityGroups) || s.activityGroups.length > 50)
        throw new SceneError("INVALID_DOCUMENT", "来源活动组数量无效");
      const groupIds = new Set<string>();
      for (const group of s.activityGroups) {
        if (
          !group ||
          typeof group !== "object" ||
          typeof group.id !== "string" ||
          typeof group.type !== "string" ||
          typeof group.primaryObjectId !== "string" ||
          !Array.isArray(group.memberObjectIds) ||
          !group.memberObjectIds.includes(group.primaryObjectId) ||
          !group.roles ||
          typeof group.roles !== "object"
        )
          throw new SceneError("INVALID_DOCUMENT", "来源活动组无效");
        if (groupIds.has(group.id))
          throw new SceneError("INVALID_DOCUMENT", "来源活动组身份重复");
        groupIds.add(group.id);
        if (group.roles[group.primaryObjectId] !== "primary")
          throw new SceneError("INVALID_DOCUMENT", "来源活动组主对象角色无效");
      }
    }
    if (s.kind === "activity-groups" && !s.activityGroups?.length)
      throw new SceneError("INVALID_DOCUMENT", "活动组来源缺少活动组");
    if (s.origin !== undefined) {
      finite(s.origin.x, "source.origin.x");
      finite(s.origin.y, "source.origin.y");
    }
  }
  const ids = new Set<string>();
  for (const collection of collections) {
    if (!Array.isArray(plan[collection]))
      throw new SceneError("INVALID_DOCUMENT", `${collection} 必须是数组`);
    if (plan[collection].length > 10000)
      throw new SceneError("SCENE_TOO_LARGE", "单类对象上限为 10000");
    for (const o of plan[collection]) {
      if (!o || typeof o.id !== "string" || !o.id || ids.has(o.id))
        throw new SceneError("INVALID_ID", `对象身份缺失或重复：${o?.id}`);
      ids.add(o.id);
      for (const k of ["x", "y", "z", "rot"])
        if (o[k] !== undefined) finite(o[k], `${o.id}.${k}`);
    }
  }
  for (const n of plan.nodes) {
    finite(n.x, "节点 x", -100000, 100000);
    finite(n.y, "节点 y", -100000, 100000);
  }
  for (const room of plan.rooms) {
    finite(room.x, "房间标签 x");
    finite(room.y, "房间标签 y");
    if (typeof room.name !== "string")
      throw new SceneError("INVALID_DOCUMENT", "房间标签缺少名称");
    if (room.tile) {
      for (const [field, min, max] of [
        ["w", 20, 3200],
        ["h", 20, 3200],
        ["gap", 0, 12],
      ] as const)
        if (room.tile[field] !== undefined)
          finite(room.tile[field], `铺砖 ${field}`, min, max);
    }
  }
  // The upstream room raster uses a 20 mm grid. Bound its allocation explicitly.
  if (plan.nodes.length) {
    const xs = plan.nodes.map((n) => n.x),
      ys = plan.nodes.map((n) => n.y);
    if (
      ((Math.max(...xs) - Math.min(...xs) + 4000) *
        (Math.max(...ys) - Math.min(...ys) + 4000)) /
        400 >
      8000000
    )
      throw new SceneError("SCENE_TOO_LARGE", "户型范围超过当前房间识别容量");
  }
  const nodes = new Map(plan.nodes.map((n) => [n.id, n]));
  for (const w of plan.walls) {
    const a = nodes.get(w.a),
      b = nodes.get(w.b);
    if (!a || !b || Math.hypot(a.x - b.x, a.y - b.y) < 1)
      throw new SceneError("INVALID_WALL", `墙 ${w.id} 的端点无效`);
    finite(w.t, "墙厚", 10, 3000);
  }
  for (const o of plan.openings) {
    const w = plan.walls.find((w) => w.id === o.wall);
    if (!w)
      throw new SceneError("INVALID_OPENING", `门窗 ${o.id} 找不到所属墙`);
    if (!(ii as any)[o.type])
      throw new SceneError("INVALID_OPENING", `未知门窗类型 ${o.type}`);
    const a = nodes.get(w.a)!,
      b = nodes.get(w.b)!,
      len = Math.hypot(a.x - b.x, a.y - b.y);
    finite(o.width, "门窗宽", 1, len);
    finite(o.pos, "门窗位置", o.width / 2 - 1, len - o.width / 2 + 1);
    finite(o.sill, "窗台高度", 0, plan.height);
    finite(o.head, "门窗顶部", o.sill + 1, plan.height);
  }
  for (const f of plan.furniture) {
    if (typeof f.name !== "string" || typeof f.color !== "string")
      throw new SceneError("INVALID_DOCUMENT", "家具名称和颜色必须为字符串");
    for (const k of ["w", "d", "h"] as const)
      finite(f[k], `${f.name} ${k}`, 1, 50000);
    if (f.type === "gate" && f.w <= 400)
      throw new SceneError(
        "INVALID_RECIPE",
        "庭院门宽度需大于 400 mm（两侧立柱各 200 mm）",
      );
    finite(f.x, "家具 x");
    finite(f.y, "家具 y");
    finite(f.rot, "家具旋转");
    if (f.parentObjectId !== undefined && typeof f.parentObjectId !== "string")
      throw new SceneError("INVALID_DOCUMENT", "家具台面宿主身份必须为字符串");
    if (
      f.placement !== undefined &&
      !["floor", "wall", "surface", "ceiling"].includes(f.placement)
    )
      throw new SceneError("INVALID_DOCUMENT", "家具放置类型无效");
    if (f.type === "model" && (typeof f.modelId !== "string" || !f.modelId))
      throw new SceneError("MISSING_ASSET", "外部模型缺少资产身份");
    if (f.type !== "model" && !Object.hasOwn(catalog, f.key))
      throw new SceneError("UNKNOWN_TYPE", `未知家具 ${f.key}`);
    if (f.type !== "model" && catalog[f.key].type !== f.type)
      throw new SceneError("INVALID_RECIPE", "家具类型与目录配方不一致");
    if (f.type === "free") {
      if (!(i7 as any)[Qc(f)])
        throw new SceneError("INVALID_RECIPE", "未知自由造型");
      const poly = f.opt?.poly;
      if (
        poly &&
        (!Array.isArray(poly) ||
          poly.length < 3 ||
          poly.length > 200 ||
          poly.some(
            (p: any) =>
              !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite),
          ))
      )
        throw new SceneError("INVALID_RECIPE", "自由轮廓需要 3–200 个有效顶点");
      for (const k of ["n", "sw", "t", "r", "rx", "ry", "arc"])
        if (f.opt?.[k] !== undefined)
          finite(f.opt[k], `造型参数 ${k}`, -360, 10000);
      if (f.opt?.n !== undefined) finite(f.opt.n, "造型数量", 1, 200);
      if (f.opt?.op !== undefined) finite(f.opt.op, "不透明度", 0, 1);
    }
    if (f.cab) {
      const kinds = [
        "door",
        "drawer",
        "open",
        "hang",
        "hangOpen",
        "glass",
        "niche",
        "mixed",
      ];
      for (const cols of [f.cab.cols, ...(f.cab.cols2 ? [f.cab.cols2] : [])])
        if (
          !Array.isArray(cols) ||
          cols.length < 1 ||
          cols.length > 100 ||
          cols.some((c) => !kinds.includes(c))
        )
          throw new SceneError(
            "INVALID_RECIPE",
            "柜体需要 1–100 列，且必须使用支持的分格类型",
          );
    }
  }
  for (const s of plan.structs) {
    if (!["column", "shaft", "flue", "drain", "sewer"].includes(s.kind))
      throw new SceneError("INVALID_STRUCTURE", "未知结构构件类型");
    for (const key of ["x", "y"] as const) finite(s[key], `构件 ${key}`);
    for (const key of ["w", "d"] as const)
      finite(s[key], `构件 ${key}`, 1, 50000);
  }
  validateDetails(plan);
}
export function normalizeState(state: SceneState): SceneState {
  validatePlan(state.plan);
  const geo = Wc(state.plan),
    rooms = D4(state.plan, geo);
  nM(state.plan, rooms, state.roomLabelArchive);
  return state;
}
export function importDocument(
  input: any,
  assetMap: Record<string, string> = {},
): SceneState {
  safeObject(input);
  if (input?.floors || input?.plan?.floors || input?.version === 3)
    throw new SceneError(
      "MULTI_FLOOR_UNSUPPORTED",
      "当前版本仅支持单层；请先在原版导出独立单层项目",
    );
  if (input?.formatVersion !== undefined && input.formatVersion !== 1)
    throw new SceneError("UNSUPPORTED_FORMAT", "不支持此项目格式版本");
  let plan: any = input?.formatVersion === 1 ? input.plan : input;
  if (!plan || !Array.isArray(plan.walls))
    throw new SceneError("INVALID_DOCUMENT", "需要项目 JSON 或 HouseSpec");
  if (plan.version !== 2 && plan.nodes === undefined) {
    plan = Gb(clone(plan));
  } else plan = clone(plan);
  for (const key of collections) plan[key] ??= [];
  for (const f of plan.furniture)
    if (f.type === "model" && assetMap[f.modelId])
      f.modelId = assetMap[f.modelId];
  const archive = input?.roomLabelArchive || [];
  if (
    !Array.isArray(archive) ||
    archive.length > 60 ||
    archive.some(
      (r) =>
        !r ||
        typeof r.id !== "string" ||
        typeof r.x !== "number" ||
        typeof r.y !== "number",
    )
  )
    throw new SceneError("INVALID_DOCUMENT", "房间恢复档案无效");
  return normalizeState({ plan, roomLabelArchive: clone(archive) });
}
function merge(target: any, patch: any): any {
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete target[key];
    else if (value && typeof value === "object" && !Array.isArray(value))
      target[key] = merge({ ...target[key] }, value);
    else target[key] = clone(value);
  }
  return target;
}
function entities(plan: Plan, collection: Collection): Entity[] {
  if (!collections.includes(collection))
    throw new SceneError("INVALID_COMMAND", "未知对象集合");
  return plan[collection];
}
export function applyCommands(
  previous: SceneState,
  commands: Command[],
): SceneState {
  if (!Array.isArray(commands) || !commands.length || commands.length > 500)
    throw new SceneError("INVALID_COMMAND", "一次事务需要 1–500 条命令");
  safeObject(commands);
  const state = clone(previous),
    plan = state.plan;
  for (const command of commands) {
    if (
      !command ||
      typeof command !== "object" ||
      typeof command.type !== "string"
    )
      throw new SceneError("INVALID_COMMAND", "命令必须是包含 type 的对象");
    if (
      (command.type === "update" || command.type === "project") &&
      (!command.patch ||
        typeof command.patch !== "object" ||
        Array.isArray(command.patch))
    )
      throw new SceneError("INVALID_COMMAND", "修改命令需要对象类型的 patch");
    if (command.type === "project") {
      const allowed = ["name", "height", "look", "north", "phase", "source"];
      if (Object.keys(command.patch).some((k) => !allowed.includes(k)))
        throw new SceneError("INVALID_COMMAND", "项目字段不允许修改");
      merge(plan, command.patch);
      continue;
    }
    if (command.type === "createFurniture") {
      plan.furniture.push(
        createFurniture(command.key, command.x, command.y, command.overrides),
      );
      continue;
    }
    const list = entities(plan, command.collection),
      index = "id" in command ? list.findIndex((o) => o.id === command.id) : -1;
    if (command.type === "add") {
      list.push(clone(command.object));
      continue;
    }
    if (index < 0)
      throw new SceneError(
        "NOT_FOUND",
        `找不到对象 ${"id" in command ? command.id : ""}`,
        404,
      );
    if (command.type === "update") {
      if ("id" in command.patch)
        throw new SceneError("IMMUTABLE_ID", "已有对象身份不能修改");
      merge(list[index], command.patch);
    } else if (command.type === "duplicate") {
      if (["nodes", "walls", "openings"].includes(command.collection))
        throw new SceneError("INVALID_COMMAND", "结构对象需要按引用关系创建");
      const copy = clone(list[index]);
      copy.id = newId();
      for (const k of ["x", "y", "z"] as const)
        if (copy[k] !== undefined || command.offset?.[k])
          copy[k] =
            (copy[k] || 0) + (command.offset?.[k] ?? (k === "z" ? 0 : 200));
      list.push(copy);
    } else if (command.type === "delete") {
      list.splice(index, 1);
      if (command.collection === "walls")
        plan.openings = plan.openings.filter((o) => o.wall !== command.id);
    } else throw new SceneError("INVALID_COMMAND", "未知命令类型");
  }
  return normalizeState(state);
}
export function footprint(f: Furniture): { x: number; y: number }[] {
  const p: number[][] =
    f.type === "free"
      ? Cu(f)
      : [
          [-f.w / 2, -f.d / 2],
          [f.w / 2, -f.d / 2],
          [f.w / 2, f.d / 2],
          [-f.w / 2, f.d / 2],
        ];
  const a = (f.rot * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  return p.map(([x, y]) => ({
    x: f.x + x * c - y * s,
    y: f.y + x * s + y * c,
  }));
}

const PASSAGE_MM = 700;

/** True when the empty room can contain one axis-aligned 700×700 mm passage square. */
function regionSupportsPassage(region: any) {
  const rects = region.rects || [];
  if (!rects.length) return true;
  const minX = Math.min(...rects.map((r: any) => r.x)),
    maxX = Math.max(...rects.map((r: any) => r.x + r.w)),
    minY = Math.min(...rects.map((r: any) => r.y)),
    maxY = Math.max(...rects.map((r: any) => r.y + r.h)),
    step = 100,
    size = PASSAGE_MM,
    inside = (x: number, y: number) =>
      rects.some(
        (r: any) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h,
      );
  for (let y = minY; y + size <= maxY; y += step)
    for (let x = minX; x + size <= maxX; x += step)
      if (
        inside(x, y) &&
        inside(x + size, y) &&
        inside(x + size, y + size) &&
        inside(x, y + size)
      )
        return true;
  return false;
}

function boxesInRegion(boxes: any[], region: any) {
  const rects = region.rects || [];
  return boxes.filter((b: any) =>
    rects.some(
      (r: any) =>
        b.x1 > r.x &&
        b.x0 < r.x + r.w &&
        b.y1 > r.y &&
        b.y0 < r.y + r.h,
    ),
  );
}

function circulationBlocked(
  region: any,
  boxes: any[],
  start: { x: number; y: number },
) {
  const rects = region.rects || [];
  const roomBoxes = boxesInRegion(boxes, region);
  const blockers = () =>
    roomBoxes
      .filter((b: any) => b.z <= 20 && b.f.h > 100)
      .map((b: any) => b.f.id);
  if (!rects.length) return [];
  const step = 100,
    half = 350,
    minX = Math.min(...rects.map((r: any) => r.x)),
    maxX = Math.max(...rects.map((r: any) => r.x + r.w)),
    minY = Math.min(...rects.map((r: any) => r.y)),
    maxY = Math.max(...rects.map((r: any) => r.y + r.h)),
    cols = Math.max(1, Math.floor((maxX - minX) / step) + 1),
    rows = Math.max(1, Math.floor((maxY - minY) / step) + 1),
    wide = new Uint8Array(cols * rows);
  const nonBlocking = new Set([
    "rug",
    "roundRug",
    "doormat",
    "playMat",
    "yogaMat",
    "curtain",
    "sheer",
    "lawn",
    "stepStones",
  ]);
  const inside = (x: number, y: number) =>
    rects.some(
      (r: any) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h,
    );
  for (let iy = 0; iy < rows; iy++)
    for (let ix = 0; ix < cols; ix++) {
      const x = minX + ix * step,
        y = minY + iy * step;
      const square = [
        { x: x - half, y: y - half },
        { x: x + half, y: y - half },
        { x: x + half, y: y + half },
        { x: x - half, y: y + half },
      ];
      if (!square.every((p) => inside(p.x, p.y))) continue;
      const blocked = roomBoxes.some(
        (b: any) =>
          b.z <= 20 &&
          b.f.h > 100 &&
          !nonBlocking.has(b.f.key) &&
          Ts([square], b.polygons) > 1,
      );
      if (!blocked) wide[iy * cols + ix] = 1;
    }
  const component = new Int32Array(cols * rows).fill(-1),
    sizes: number[] = [];
  let next = 0;
  for (let i = 0; i < wide.length; i++)
    if (wide[i] && component[i] < 0) {
      const queue = [i];
      component[i] = next;
      let size = 0;
      for (let at = 0; at < queue.length; at++) {
        const current = queue[at],
          cx = current % cols,
          cy = Math.floor(current / cols);
        size++;
        for (const [dx, dy] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ]) {
          const nx = cx + dx,
            ny = cy + dy,
            n = ny * cols + nx;
          if (
            nx >= 0 &&
            nx < cols &&
            ny >= 0 &&
            ny < rows &&
            wide[n] &&
            component[n] < 0
          ) {
            component[n] = next;
            queue.push(n);
          }
        }
      }
      sizes.push(size);
      next++;
    }
  if (!sizes.length) return blockers();
  let startComponent = -1,
    best = Infinity;
  for (let iy = 0; iy < rows; iy++)
    for (let ix = 0; ix < cols; ix++) {
      const index = iy * cols + ix;
      if (!wide[index]) continue;
      const distance = Math.hypot(
        minX + ix * step - start.x,
        minY + iy * step - start.y,
      );
      if (distance < best) {
        best = distance;
        startComponent = component[index];
      }
    }
  if (startComponent < 0) return blockers();
  const largest = sizes.indexOf(Math.max(...sizes));
  return startComponent !== largest ? blockers() : [];
}

export type IssueCategory =
  | "structure"
  | "furniture"
  | "surface"
  | "action"
  | "overlap";

export interface SceneIssue {
  code: string;
  objectIds: string[];
  message: string;
  level: "error" | "warning";
  category?: IssueCategory;
  fixableByFurniture?: boolean;
  owner?: "furniture" | "structure" | "manual";
  roomId?: string;
  metric?: number;
}

export function checkScene(plan: Plan) {
  const issues: SceneIssue[] = [];
  const geo = Wc(plan);
  const regions = D4(plan, geo).regions;
  // Reuse upstream decomposed footprints and separating-axis penetration depth.
  const boxes = plan.furniture.map((f) => {
    const polygons = Zg(f) as { x: number; y: number }[][],
      p = polygons.flat();
    return {
      f,
      z:
        f.parentObjectId ||
        f.placement === "surface" ||
        f.opt?.surface === true
          ? surfaceElevation(plan, f)
          : furnitureElevation(f, plan, regions),
      polygons,
      x0: Math.min(...p.map((p) => p.x)),
      x1: Math.max(...p.map((p) => p.x)),
      y0: Math.min(...p.map((p) => p.y)),
      y1: Math.max(...p.map((p) => p.y)),
    };
  });
  const structuralRoomIds = new Set<string>();
  for (const region of regions) {
    if (regionSupportsPassage(region)) continue;
    const labels: any[] = Array.isArray((region as any).labels)
      ? (region as any).labels
      : [];
    const roomId = labels[0]?.id;
    if (typeof roomId !== "string" || !roomId) continue;
    structuralRoomIds.add(region.key || roomId);
    const room = plan.rooms.find((item) => item.id === roomId);
    issues.push({
      code: "STRUCT_ROOM_PASSAGE",
      objectIds: [roomId],
      roomId,
      message: `${room?.name || "房间"} 内无法容纳 ${PASSAGE_MM}×${PASSAGE_MM} mm 连续通行区，需调整墙体或房间尺寸`,
      level: "error",
      category: "structure",
      fixableByFurniture: false,
      owner: "structure",
    });
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i],
        b = boxes[j];
      if (
        !KU(a.f.type, b.f.type) &&
        a.f.parentObjectId !== b.f.id &&
        b.f.parentObjectId !== a.f.id &&
        !(a.f.parentObjectId && a.f.parentObjectId === b.f.parentObjectId) &&
        Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 20 &&
        Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 20 &&
        Math.min(a.z + a.f.h, b.z + b.f.h) - Math.max(a.z, b.z) > 20 &&
        Ts(a.polygons, b.polygons) > 20
      )
        issues.push({
          code: "POSSIBLE_OVERLAP",
          objectIds: [a.f.id, b.f.id],
          message: `${a.f.name} 与 ${b.f.name} 的参数化轮廓及高度区间重叠，请检查实际形状`,
          level: "warning",
          metric: Ts(a.polygons, b.polygons),
        });
    }
  for (const { f, polygons, z } of boxes)
    for (const w of geo.active) {
      const solids = [
        ...w.solids,
        ...w.ops
          .filter((o: any) => z < o.o.sill || z + f.h > o.o.head)
          .map((o: any) => ({ s0: o.s0, s1: o.s1 })),
      ];
      const wallPolygons = solids.map((s) =>
        [
          [s.s0, -w.ht],
          [s.s1, -w.ht],
          [s.s1, w.ht],
          [s.s0, w.ht],
        ].map(([along, side]) => ({
          x: w.a.x + w.u.x * along + w.n.x * side,
          y: w.a.y + w.u.y * along + w.n.y * side,
        })),
      );
      if (z < (w.w.h || plan.height) && Ts(polygons, wallPolygons) > 20)
        issues.push({
          code: "FURNITURE_IN_WALL",
          objectIds: [f.id, w.w.id],
          message: `${f.name} 的轮廓进入墙体`,
          level: "error",
          metric: Ts(polygons, wallPolygons),
        });
    }
  // Action envelopes: a closed door/drawer still needs clear space in front
  // when opened. The envelope is checked regardless of the current open state.
  const wallSolids = geo.active.flatMap((w: any) =>
    w.solids.map((solid: any) => ({
      id: w.w.id,
      polygon: [
        [solid.s0, -w.ht],
        [solid.s1, -w.ht],
        [solid.s1, w.ht],
        [solid.s0, w.ht],
      ].map(([along, side]) => ({
        x: w.a.x + w.u.x * along + w.n.x * side,
        y: w.a.y + w.u.y * along + w.n.y * side,
      })),
    })),
  );
  const remainingFront = (f: Furniture, other: (typeof boxes)[number]) => {
    const rot = ((Math.round(f.rot / 90) * 90) % 360 + 360) % 360;
    if (rot === 0) return Math.max(0, Math.round(other.y0 - (f.y + f.d / 2)));
    if (rot === 180) return Math.max(0, Math.round(f.y - f.d / 2 - other.y1));
    if (rot === 90) return Math.max(0, Math.round(f.x - f.d / 2 - other.x1));
    return Math.max(0, Math.round(other.x0 - (f.x + f.d / 2)));
  };
  for (const { f, z } of boxes) {
    const envelope = openEnvelope(f);
    if (!envelope) continue;
    const wallHit = wallSolids.find(
      (wall) => Ts([envelope.polygon], [wall.polygon]) > 20,
    );
    if (wallHit) {
      issues.push({
        code: "OPENABLE_FRONT_BLOCKED",
        objectIds: [f.id, wallHit.id],
        message: `${f.name} 正前方 ${envelope.spec.clearance} mm 开启包络撞墙，柜门/抽屉无法完全打开`,
        level: "error",
        metric: envelope.spec.clearance,
      });
      continue;
    }
    const blockers = boxes
      .filter(
        (other) =>
          other.f.id !== f.id &&
          other.f.parentObjectId !== f.id &&
          f.parentObjectId !== other.f.id &&
          !["curtain", "sheer", "rug", "roundRug"].includes(other.f.key) &&
          // A desk chair is movable and is normally tucked into the desk; it
          // must not turn a normal positive office layout into a drawer block.
          !(
            /desk/i.test(f.key) &&
            /chair|stool/i.test(other.f.key)
          ) &&
          z < other.z + other.f.h &&
          z + f.h > other.z &&
          Ts([envelope.polygon], other.polygons) > 20,
      )
      .map((other) => ({ other, remaining: remainingFront(f, other) }))
      .sort((a, b) => a.remaining - b.remaining);
    if (blockers.length) {
      const { other, remaining } = blockers[0];
      issues.push({
        code: "OPENABLE_FRONT_BLOCKED",
        objectIds: [f.id, other.f.id],
        message: `${f.name} 正前方开启净空仅 ${remaining} mm（需 ${envelope.spec.clearance} mm），被 ${other.f.name} 占用`,
        level: "error",
        metric: Math.max(0, envelope.spec.clearance - remaining),
      });
    }
  }
  // Surface support graph: a tabletop item must sit on its host top face and
  // must not overhang the host or collide with a sibling on the same host.
  const surfaceItems = plan.furniture.filter(
    (f) =>
      f.parentObjectId ||
      f.placement === "surface" ||
      f.opt?.surface === true,
  );
  for (const item of surfaceItems) {
    const host = surfaceHostFor(plan, item);
    if (!host) {
      issues.push({
        code: "SURFACE_ITEM_HOST_MISSING",
        objectIds: [item.id],
        message: `${item.name} 声明为台面物品，但没有找到可承载的桌面/台面宿主`,
        level: "error",
      });
      continue;
    }
    const overhang = surfaceOverhang(item, host);
    if (overhang > 20)
      issues.push({
        code: "SURFACE_ITEM_OVERHANG",
        objectIds: [item.id, host.id],
        message: `${item.name} 超出 ${host.name} 台面 ${Math.round(overhang)} mm（允许 20 mm 容差）`,
        level: "error",
        metric: Math.round(overhang),
      });
  }
  for (let i = 0; i < surfaceItems.length; i++)
    for (let j = i + 1; j < surfaceItems.length; j++) {
      const a = surfaceItems[i],
        b = surfaceItems[j],
        hostA = surfaceHostFor(plan, a),
        hostB = surfaceHostFor(plan, b);
      if (!hostA || hostA.id !== hostB?.id) continue;
      const za = surfaceElevation(plan, a),
        zb = surfaceElevation(plan, b);
      if (
        Math.min(za + a.h, zb + b.h) - Math.max(za, zb) > 20 &&
        Math.min(rotatedAabb(a).x1, rotatedAabb(b).x1) -
          Math.max(rotatedAabb(a).x0, rotatedAabb(b).x0) >
          20 &&
        Math.min(rotatedAabb(a).y1, rotatedAabb(b).y1) -
          Math.max(rotatedAabb(a).y0, rotatedAabb(b).y0) >
          20
      )
        issues.push({
          code: "SURFACE_ITEM_COLLISION",
          objectIds: [a.id, b.id],
          message: `${a.name} 与 ${b.name} 在同一台面上相互重叠`,
          level: "error",
        });
    }
  // Project layout heuristic: reserve 800 mm in each valid interior side of a doorway.
  // This checks a local entrance zone, not full accessibility or building regulations.
  const doorTypes = new Set([
    "door",
    "double",
    "unequal",
    "sliding",
    "folding",
    "pocket",
    "hole",
    "garage",
  ]);
  const windowTypes = new Set([
    "window",
    "slideWindow",
    "floorWindow",
    "highWindow",
    "bay",
    "bayInner",
    "glassWall",
  ]);
  const cabinetKeys = new Set([
    "bookshelf",
    "bookshelfLow",
    "cabWardrobe",
    "cabSlide",
    "cabCorner",
    "cabShoe",
    "cabSideboard",
    "cabTall",
    "cabBase",
    "cabWall",
    "cabTV",
    "displayCabinet",
    "fileCabinet",
    "fridge",
    "fridgeDouble",
    "fridgeFrench",
    "freezer",
    "hallCabinet",
    "lockers",
    "shoeCabinet",
    "sideboard",
    "wardrobe",
    "wardrobe2",
    "wardrobe3",
    "wineCabinet",
  ]);
  for (const w of geo.active)
    for (const op of w.ops) {
      if (windowTypes.has(op.o.type)) {
        for (const side of [-1, 1]) {
          const middle = (op.s0 + op.s1) / 2,
            probe = {
              x: w.a.x + w.u.x * middle + w.n.x * side * (w.ht + 1),
              y: w.a.y + w.u.y * middle + w.n.y * side * (w.ht + 1),
            };
          if (
            !regions.some((r: any) =>
              r.rects.some(
                (b: any) =>
                  probe.x >= b.x &&
                  probe.x <= b.x + b.w &&
                  probe.y >= b.y &&
                  probe.y <= b.y + b.h,
              ),
            )
          )
            continue;
          const strip = (depth: number) =>
            [
              [op.s0, side * w.ht],
              [op.s1, side * w.ht],
              [op.s1, side * (w.ht + depth)],
              [op.s0, side * (w.ht + depth)],
            ].map(([along, normal]) => ({
              x: w.a.x + w.u.x * along + w.n.x * normal,
              y: w.a.y + w.u.y * along + w.n.y * normal,
            }));
          for (const { f, polygons, z } of boxes) {
            if (["curtain", "sheer", "rug", "roundRug"].includes(f.key))
              continue;
            const curtainZone = Ts(polygons, [strip(150)]);
            if (f.h > 600 && curtainZone > 20)
              issues.push({
                code: "CUR-01",
                objectIds: [f.id, op.o.id],
                message: `${f.name} 占用窗帘前 150 mm 活动区`,
                level: "error",
                metric: curtainZone,
              });
            const cabinet = cabinetKeys.has(f.key) || f.type === "cabinet";
            const windowZone = Ts(polygons, [strip(400)]);
            if (cabinet && z + f.h > (op.o.sill ?? 0) + 100 && windowZone > 20)
              issues.push({
                code: "WIN-01",
                objectIds: [f.id, op.o.id],
                message: `${f.name} 位于窗前 400 mm 且高于窗台`,
                level: "error",
                metric: windowZone,
              });
          }
        }
      }
      if (!doorTypes.has(op.o.type) || op.o.sill > 20) continue;
      const doorWidth = op.s1 - op.s0;
      if (doorWidth < PASSAGE_MM) {
        const middle = (op.s0 + op.s1) / 2;
        const adjacentRooms: any[] = [-1, 1]
          .map((side) => {
            const probe = {
              x: w.a.x + w.u.x * middle + w.n.x * side * (w.ht + 400),
              y: w.a.y + w.u.y * middle + w.n.y * side * (w.ht + 400),
            };
            return regions.find((r: any) =>
              r.rects.some(
                (b: any) =>
                  probe.x >= b.x &&
                  probe.x <= b.x + b.w &&
                  probe.y >= b.y &&
                  probe.y <= b.y + b.h,
              ),
            );
          })
          .filter(Boolean);
        const adjacent =
          adjacentRooms.length &&
          adjacentRooms.every((room) => room.key === adjacentRooms[0].key)
            ? adjacentRooms[0]
            : undefined;
        const roomName = plan.rooms.find(
          (item) => item.id === adjacent?.labels?.[0]?.id,
        )?.name;
        issues.push({
          code: "STRUCT_DOOR_CLEAR_WIDTH",
          objectIds: [op.o.id],
          roomId: adjacent?.labels?.[0]?.id,
          message: `${roomName ? `${roomName}门洞` : "门洞"} 净宽仅 ${Math.round(doorWidth)} mm，小于 ${PASSAGE_MM} mm 通行下限；需改门洞，不能靠移动家具修复`,
          level: "error",
          category: "structure",
          fixableByFurniture: false,
          owner: "structure",
        });
        continue;
      }
      for (const side of [-1, 1]) {
        const middle = (op.s0 + op.s1) / 2,
          probe = {
            x: w.a.x + w.u.x * middle + w.n.x * side * (w.ht + 1),
            y: w.a.y + w.u.y * middle + w.n.y * side * (w.ht + 1),
          };
        const room = regions.find((r: any) =>
          r.rects.some(
            (b: any) =>
              probe.x >= b.x &&
              probe.x <= b.x + b.w &&
              probe.y >= b.y &&
              probe.y <= b.y + b.h,
          ),
        );
        if (!room) continue;
        if (structuralRoomIds.has(room.key || "")) continue;
        const circulationStart = {
          x: w.a.x + w.u.x * middle + w.n.x * side * (w.ht + 400),
          y: w.a.y + w.u.y * middle + w.n.y * side * (w.ht + 400),
        };
        const circulationBlockers = circulationBlocked(
          room,
          boxes,
          circulationStart,
        );
        if (circulationBlockers.length) {
          const roomId = Array.isArray((room as any).labels)
            ? (room as any).labels[0]?.id
            : undefined;
          const roomName = plan.rooms.find((item) => item.id === roomId)?.name;
          issues.push({
            code: "CIR-02",
            objectIds: [op.o.id, ...circulationBlockers],
            roomId,
            message: `${roomName || "门洞"} 内侧没有连续 700 mm 宽的可达区域`,
            level: "error",
            category: "furniture",
            fixableByFurniture: true,
            owner: "furniture",
          });
        }
        const zone = [
          [op.s0, side * w.ht],
          [op.s1, side * w.ht],
          [op.s1, side * (w.ht + 800)],
          [op.s0, side * (w.ht + 800)],
        ].map(([along, normal]) => ({
          x: w.a.x + w.u.x * along + w.n.x * normal,
          y: w.a.y + w.u.y * along + w.n.y * normal,
        }));
        for (const { f, polygons, z } of boxes) {
          // Curtains, sheers and rugs are wall/floor coverings, not freestanding
          // obstacles; their own clearance rules are checked above (CUR-01).
          if (["curtain", "sheer", "rug", "roundRug"].includes(f.key)) continue;
          const penetration = Ts(polygons, [zone]);
          if (z < op.o.head && z + f.h > 20 && penetration > 20)
            issues.push({
              code: "DOORWAY_BLOCKED",
              objectIds: [f.id, op.o.id],
              message: `${f.name} 占用门洞内侧 800 mm 净空区（项目布局规则）`,
              level: "error",
              metric: penetration,
            });
        }
      }
    }
  // Door-leaf swing versus openable cabinet fronts. This is the dedicated
  // DOOR_CABINET_CONFLICT check; the door swing is approximated by a quarter
  // circle polygon (8 segments), not a rigid-body simulation.
  const doorCabinetSeen = new Set<string>();
  for (const w of geo.active)
    for (const op of w.ops) {
      if (!doorTypes.has(op.o.type) || (op.o.sill ?? 0) > 20) continue;
      const doorWidth = op.s1 - op.s0;
      if (doorWidth < PASSAGE_MM) continue;
      if (doorWidth < 100) continue;
      for (const side of [-1, 1]) {
        if (op.o.side && op.o.side !== side) continue;
        const middle = (op.s0 + op.s1) / 2,
          probe = {
            x: w.a.x + w.u.x * middle + w.n.x * side * (w.ht + 1),
            y: w.a.y + w.u.y * middle + w.n.y * side * (w.ht + 1),
          };
        const room = regions.find((r: any) =>
          r.rects.some(
            (b: any) =>
              probe.x >= b.x &&
              probe.x <= b.x + b.w &&
              probe.y >= b.y &&
              probe.y <= b.y + b.h,
          ),
        );
        if (!room) continue;
        if (structuralRoomIds.has(room.key || "")) continue;
        const hingeAt = op.o.hinge ? op.s1 : op.s0,
          direction = op.o.hinge ? -1 : 1,
          hinge = {
            x: w.a.x + w.u.x * hingeAt + w.n.x * side * (w.ht + 1),
            y: w.a.y + w.u.y * hingeAt + w.n.y * side * (w.ht + 1),
          },
          swing = [hinge];
        for (let k = 1; k <= 8; k++) {
          const angle = (k / 8) * (Math.PI / 2),
            along = hingeAt + direction * doorWidth * Math.cos(angle),
            normal = side * (w.ht + 1 + doorWidth * Math.sin(angle));
          swing.push({
            x: w.a.x + w.u.x * along + w.n.x * normal,
            y: w.a.y + w.u.y * along + w.n.y * normal,
          });
        }
        for (const { f, z } of boxes) {
          const envelope = openEnvelope(f);
          if (!envelope) continue;
          if (!(z < (op.o.head ?? 2100) && z + f.h > 20)) continue;
          const key = `${op.o.id}:${f.id}`;
          if (doorCabinetSeen.has(key)) continue;
          if (Ts([envelope.polygon], [swing]) > 20) {
            doorCabinetSeen.add(key);
            const roomId = Array.isArray((room as any).labels)
              ? (room as any).labels[0]?.id
              : undefined;
            const roomName = plan.rooms.find((item) => item.id === roomId)?.name;
            issues.push({
              code: "DOOR_CABINET_CONFLICT",
              objectIds: [op.o.id, f.id],
              roomId,
              message: `${roomName || "门洞"} 的门扇扫掠区与 ${f.name} 的开启包络冲突`,
              level: "error",
            });
          }
        }
      }
    }
  if ((plan.source as any)?.safetyProfile?.enabled === true) {
    const safetyReport = auditSafety(plan);
    for (const si of safetyReport.issues) {
      if (si.level === "error") {
        issues.push({
          code: si.code,
          objectIds: si.objectIds,
          roomId: si.roomId,
          message: si.message,
          level: si.level,
          metric: si.metric,
          category: "furniture",
          fixableByFurniture: si.fixableByFurniture,
          owner: "furniture",
        });
      }
    }
  }
  for (const issue of issues) {
    if (issue.category) continue;
    const structural = issue.code.startsWith("STRUCT_");
    issue.category = structural
      ? "structure"
      : issue.code === "POSSIBLE_OVERLAP"
        ? "overlap"
        : issue.code.startsWith("SURFACE_ITEM_")
          ? "surface"
          : "furniture";
    issue.fixableByFurniture = !structural;
    issue.owner = structural ? "structure" : "furniture";
  }
  return {
    issues,
    coverage: [
      "结构引用与尺寸校验",
      "结构问题分类（门净宽、空房间 700 mm 连续通行区）",
      "原版参数化轮廓 SAT 相交与垂直区间",
      "家具轮廓与墙体及洞口",
      "窗帘前 150 mm 与窗前 400 mm 净空",
      "门洞内侧 800 mm 局部净空（项目布局规则）",
      "门内 700 mm 宽连续可达区（近似栅格）",
      "柜门/抽屉前 450–600 mm 开启包络（OPENABLE_FRONT_BLOCKED）",
      "门扇扫掠区与柜门包络冲突（DOOR_CABINET_CONFLICT）",
      "台面宿主 z = host.z + host.h、越界与同台面碰撞",
    ],
    limitations: [
      "不等同于精确网格碰撞检测；GLB 使用矩形占地",
      "通道检查为 100 mm 栅格近似，不替代建筑规范；未检查照明或法规",
      "开启包络为矩形/四分之一圆弧近似，不做刚体动力学或地震模拟；台面碰撞为矩形占地近似",
    ],
  };
}
