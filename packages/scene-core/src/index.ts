import { Hc, q0, yu, i7, ii, ja, F5, cs, tf, $r } from "./inherited/catalog.js";
import { Cu, Qc, Ns, L4, Ci, Zg, Ts, KU } from "./inherited/footprints.js";
import { Gb, xd } from "./inherited/house-spec.js";
import { Wc, D4, nM, F0, Ls } from "./inherited/topology.js";
import { validateDetails } from "./validation.js";
import { furnitureElevation } from "./placement.js";
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
export const newId = () => crypto.randomUUID();
export const clone = <T>(value: T): T =>
  value === undefined ? value : JSON.parse(JSON.stringify(value));
export const createFurniture = (
  key: string,
  x = 0,
  y = 0,
  overrides: Record<string, any> = {},
): Furniture => {
  if (!catalog[key])
    throw new SceneError("UNKNOWN_TYPE", `家具目录没有 ${key}`);
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
      s.kind !== "floorplan" ||
      typeof s.imageId !== "string" ||
      !/^fp-[a-f0-9]{64}$/.test(s.imageId) ||
      !/^[a-f0-9]{64}$/.test(s.imageHash)
    )
      throw new SceneError("INVALID_DOCUMENT", "户型来源信息无效");
    finite(s.mmPerPixel, "source.mmPerPixel", 0.001, 10000);
    finite(s.origin?.x, "source.origin.x");
    finite(s.origin?.y, "source.origin.y");
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
    if (f.type === "model" && (typeof f.modelId !== "string" || !f.modelId))
      throw new SceneError("MISSING_ASSET", "外部模型缺少资产身份");
    if (f.type !== "model" && !catalog[f.key])
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
export function checkScene(plan: Plan) {
  const issues: {
    code: string;
    objectIds: string[];
    message: string;
    level: string;
    metric?: number;
  }[] = [];
  const geo = Wc(plan);
  const regions = D4(plan, geo).regions;
  // Reuse upstream decomposed footprints and separating-axis penetration depth.
  const boxes = plan.furniture.map((f) => {
    const polygons = Zg(f) as { x: number; y: number }[][],
      p = polygons.flat();
    return {
      f,
      z: furnitureElevation(f, plan, regions),
      polygons,
      x0: Math.min(...p.map((p) => p.x)),
      x1: Math.max(...p.map((p) => p.x)),
      y0: Math.min(...p.map((p) => p.y)),
      y1: Math.max(...p.map((p) => p.y)),
    };
  });
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i],
        b = boxes[j];
      if (
        !KU(a.f.type, b.f.type) &&
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
  for (const w of geo.active)
    for (const op of w.ops) {
      if (!doorTypes.has(op.o.type) || op.o.sill > 20) continue;
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
  return {
    issues,
    coverage: [
      "结构引用与尺寸校验",
      "原版参数化轮廓 SAT 相交与垂直区间",
      "家具轮廓与墙体及洞口",
      "门洞内侧 800 mm 局部净空（项目布局规则）",
    ],
    limitations: [
      "不等同于精确网格碰撞检测；GLB 使用矩形占地",
      "未检查通道可达性、支撑面、照明或法规",
    ],
  };
}
