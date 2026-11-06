/** Image recognition is a draft. Only this compiler creates millimetre scene geometry. */
import {
  applyCommands,
  blankPlan,
  catalog,
  clone,
  collections,
  createFurniture,
  detectRooms,
  normalizeState,
  SceneError,
  type Command,
  type Point,
  type SceneState,
} from "./index.js";
import {
  checkCandidate,
  type EditScope,
  type CheckReport,
} from "./candidate.js";
import { millimetres, requireBlank, type Dimension } from "./rectangular.js";

export interface ImageReference {
  id: string;
  sha256: string;
  width: number;
  height: number;
}
export interface ScaleAnchor {
  a: Point;
  b: Point;
  distance: Dimension;
  basis: "interior" | "centerline" | "exterior";
  evidence: string;
}
export interface ImageWall {
  id: string;
  a: Point;
  b: Point;
  thicknessPx?: number;
}
export interface ImageOpening {
  id: string;
  wallId: string;
  type: "door" | "window" | "hole" | "sliding";
  offset: number;
  width: number;
  sill?: number;
  head?: number;
  side?: number;
  hinge?: number;
}
export interface ImageRoom {
  id: string;
  at: Point;
  name: string;
}
export interface ImageSymbol {
  id: string;
  roomId: string;
  category: string;
  x: number;
  y: number;
  w: number;
  d: number;
  rot: number;
  catalogKey?: string;
}
export interface FloorplanData {
  image: ImageReference;
  name: string;
  height?: number;
  wallThickness?: number;
  anchors: ScaleAnchor[];
  walls: ImageWall[];
  openings: ImageOpening[];
  rooms: ImageRoom[];
  symbols: ImageSymbol[];
  targetRoomIds: string[];
  uncertainties: { id: string; message: string; blocking: boolean }[];
}
export interface FloorplanBinding {
  draftId: string;
  draftRevision: number;
  draftHash: string;
}
export interface SymbolMatch {
  symbolId: string;
  key: string;
}
function invalid(message: string, field: string): never {
  throw new SceneError("INVALID_FLOORPLAN", message, 422, { field });
}
function object(v: any, fields: string[], field: string) {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !fields.includes(k))
  )
    invalid(`${field} 包含未知或无效字段`, field);
}
function number(
  v: unknown,
  field: string,
  min: number,
  max: number,
): asserts v is number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
    invalid(`${field} 需要 ${min}–${max} 的有限数字`, field);
}
function text(v: unknown, field: string, max = 200): asserts v is string {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    invalid(`${field} 需要有效文字`, field);
}
const rounded = (n: number) => Math.round(n * 1000) / 1000;
const inside = (r: any, p: Point) =>
  r.rects.some(
    (b: any) =>
      p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h,
  );
export function validateFloorplan(data: FloorplanData): FloorplanData {
  object(
    data,
    [
      "image",
      "name",
      "height",
      "wallThickness",
      "anchors",
      "walls",
      "openings",
      "rooms",
      "symbols",
      "targetRoomIds",
      "uncertainties",
    ],
    "draft",
  );
  object(data.image, ["id", "sha256", "width", "height"], "image");
  text(data.image.id, "image.id");
  if (!/^[a-f0-9]{64}$/.test(data.image.sha256))
    invalid("图片校验值无效", "image.sha256");
  number(data.image.width, "image.width", 1, 25000000);
  number(data.image.height, "image.height", 1, 25000000);
  if (
    !Number.isInteger(data.image.width) ||
    !Number.isInteger(data.image.height) ||
    data.image.width * data.image.height > 25000000
  )
    invalid("图片超过 2500 万像素", "image");
  text(data.name, "name", 100);
  if (data.height !== undefined) number(data.height, "height", 100, 20000);
  if (data.wallThickness !== undefined)
    number(data.wallThickness, "wallThickness", 20, 1000);
  const point = (p: Point, field: string) => {
    object(p, ["x", "y"], field);
    number(p.x, field + ".x", 0, data.image.width);
    number(p.y, field + ".y", 0, data.image.height);
  };
  const ids = new Set<string>();
  for (const [field, max] of [
    ["anchors", 20],
    ["walls", 150],
    ["openings", 100],
    ["rooms", 60],
    ["symbols", 100],
    ["uncertainties", 100],
  ] as const) {
    if (!Array.isArray(data[field]) || data[field].length > max)
      invalid(`${field} 数量无效`, field);
    if (field !== "anchors")
      for (const o of data[field]) {
        if (!o || typeof o !== "object" || Array.isArray(o))
          invalid("草稿对象必须是完整对象", field);
        text(o.id, field + ".id", 100);
        if (!/^[\w:-]+$/.test(o.id) || ids.has(o.id))
          invalid("草稿对象身份重复或无效", field + ".id");
        ids.add(o.id);
      }
  }
  for (const [i, a] of data.anchors.entries()) {
    object(a, ["a", "b", "distance", "basis", "evidence"], `anchors.${i}`);
    point(a.a, `anchors.${i}.a`);
    point(a.b, `anchors.${i}.b`);
    if (Math.hypot(a.a.x - a.b.x, a.a.y - a.b.y) < 2)
      invalid("标定线过短", `anchors.${i}`);
    if (millimetres(a.distance, `anchors.${i}.distance`) <= 0)
      invalid("实际距离必须大于零", `anchors.${i}.distance`);
    if (!["interior", "centerline", "exterior"].includes(a.basis))
      invalid("需要确认净尺寸、中线或外尺寸", `anchors.${i}.basis`);
    text(a.evidence, `anchors.${i}.evidence`);
  }
  for (const w of data.walls) {
    object(w, ["id", "a", "b", "thicknessPx"], "walls." + w.id);
    point(w.a, w.id + ".a");
    point(w.b, w.id + ".b");
    if (
      Math.hypot(w.a.x - w.b.x, w.a.y - w.b.y) < 2 ||
      (Math.abs(w.a.x - w.b.x) > 1 && Math.abs(w.a.y - w.b.y) > 1)
    )
      invalid("本轮仅支持水平或垂直的有效墙线", w.id);
    if (w.thicknessPx !== undefined)
      number(w.thicknessPx, w.id + ".thicknessPx", 0.1, 1000);
  }
  const walls = new Set(data.walls.map((w) => w.id)),
    rooms = new Set(data.rooms.map((r) => r.id));
  for (const o of data.openings) {
    object(
      o,
      [
        "id",
        "wallId",
        "type",
        "offset",
        "width",
        "sill",
        "head",
        "side",
        "hinge",
      ],
      "openings." + o.id,
    );
    if (!walls.has(o.wallId)) invalid("门窗缺少所属墙", o.id + ".wallId");
    if (!["door", "window", "hole", "sliding"].includes(o.type))
      invalid("门窗类型不受支持", o.id + ".type");
    number(
      o.offset,
      o.id + ".offset",
      0,
      Math.max(data.image.width, data.image.height) * 2,
    );
    number(
      o.width,
      o.id + ".width",
      0.1,
      Math.max(data.image.width, data.image.height),
    );
    if (o.sill !== undefined) number(o.sill, o.id + ".sill", 0, 20000);
    if (o.head !== undefined) number(o.head, o.id + ".head", 1, 20000);
    if (o.side !== undefined && ![-1, 1].includes(o.side))
      invalid("开门方向无效", o.id + ".side");
    if (o.hinge !== undefined && ![0, 1].includes(o.hinge))
      invalid("门铰方向无效", o.id + ".hinge");
  }
  for (const r of data.rooms) {
    object(r, ["id", "at", "name"], "rooms." + r.id);
    point(r.at, r.id + ".at");
    text(r.name, r.id + ".name", 100);
  }
  for (const f of data.symbols) {
    object(
      f,
      ["id", "roomId", "category", "x", "y", "w", "d", "rot", "catalogKey"],
      "symbols." + f.id,
    );
    if (!rooms.has(f.roomId)) invalid("家具符号缺少房间引用", f.id + ".roomId");
    text(f.category, f.id + ".category", 100);
    point({ x: f.x, y: f.y }, f.id);
    number(f.w, f.id + ".w", 0.1, data.image.width);
    number(f.d, f.id + ".d", 0.1, data.image.height);
    number(f.rot, f.id + ".rot", -360, 360);
    if (f.catalogKey !== undefined && !Object.hasOwn(catalog, f.catalogKey))
      invalid("指定家具不在目录", f.id + ".catalogKey");
  }
  if (
    !Array.isArray(data.targetRoomIds) ||
    data.targetRoomIds.some((id) => !rooms.has(id)) ||
    new Set(data.targetRoomIds).size !== data.targetRoomIds.length
  )
    invalid("目标客餐厅房间身份无效", "targetRoomIds");
  for (const u of data.uncertainties) {
    object(u, ["id", "message", "blocking"], "uncertainties." + u.id);
    text(u.message, u.id + ".message", 1000);
    if (typeof u.blocking !== "boolean") invalid("不确定项缺少阻断标志", u.id);
  }
  return clone(data);
}
export function floorplanScale(data: FloorplanData) {
  if (!data.anchors.length)
    invalid(
      "请确认图中尺寸，或选择两点输入实际距离；不能猜测比例尺",
      "anchors",
    );
  const values = data.anchors.map(
    (a) =>
      millimetres(a.distance, "anchor.distance") /
      Math.hypot(a.b.x - a.a.x, a.b.y - a.a.y),
  );
  if (values.some((v) => Math.abs(v / values[0] - 1) > 0.03 + 1e-9))
    invalid(
      "尺寸标注比例相差超过 3%，请核对标注含义或图片是否被拉伸",
      "anchors",
    );
  if (
    data.anchors.some(
      (a) =>
        Math.abs(
          Math.hypot(a.b.x - a.a.x, a.b.y - a.a.y) * values[0] -
            millimetres(a.distance, "anchor.distance"),
        ) > 1.001,
    )
  )
    invalid(
      "明确尺寸在统一比例下仍有超过 1 mm 的差异，请核对标定端点；不能分别拉伸图片",
      "anchors",
    );
  return values[0];
}
export function compileFloorplan(
  input: FloorplanData,
  seed: string,
  binding?: FloorplanBinding,
) {
  const data = validateFloorplan(input);
  if (!/^[\w-]{1,100}$/.test(seed)) invalid("初始化身份无效", "taskId");
  if (data.walls.length < 4 || !data.rooms.length)
    invalid("请补齐整层墙体和房间标签", "walls");
  const scale = floorplanScale(data),
    height = data.height ?? 2800,
    defaults: string[] = [];
  if (data.height === undefined) defaults.push("层高 2800 mm");
  const origin = {
    x: Math.min(...data.walls.flatMap((w) => [w.a.x, w.b.x])),
    y: Math.min(...data.walls.flatMap((w) => [w.a.y, w.b.y])),
  };
  const transform = (p: Point): Point => ({
    x: rounded((p.x - origin.x) * scale),
    y: rounded((p.y - origin.y) * scale),
  });
  const plan = blankPlan();
  plan.name = data.name;
  plan.height = height;
  const raw = data.walls.map((w) => {
    const a = transform(w.a),
      b = transform(w.b);
    if (Math.abs(w.a.x - w.b.x) <= 1) a.x = b.x = rounded((a.x + b.x) / 2);
    else a.y = b.y = rounded((a.y + b.y) / 2);
    const t =
      w.thicknessPx !== undefined
        ? rounded(w.thicknessPx * scale)
        : (data.wallThickness ?? 200);
    if (w.thicknessPx === undefined) defaults.push(`${w.id} 墙厚 ${t} mm`);
    return { ...w, a, b, t };
  });
  const points = new Map<string, Point>();
  const key = (p: Point) => `${p.x},${p.y}`;
  const node = (p: Point) => {
    const k = key(p);
    if (!points.has(k)) {
      points.set(k, p);
      plan.nodes.push({ id: `${seed}:n:${k}`, ...p });
    }
    return `${seed}:n:${k}`;
  };
  const on = (p: Point, w: (typeof raw)[number]) =>
    Math.abs(w.a.x === w.b.x ? p.x - w.a.x : p.y - w.a.y) < 0.01 &&
    p.x >= Math.min(w.a.x, w.b.x) - 0.01 &&
    p.x <= Math.max(w.a.x, w.b.x) + 0.01 &&
    p.y >= Math.min(w.a.y, w.b.y) - 0.01 &&
    p.y <= Math.max(w.a.y, w.b.y) + 0.01;
  const segments = new Map<
    string,
    { id: string; a: Point; b: Point; t: number; sources: Set<string> }
  >();
  for (const w of raw) {
    const cuts = [w.a, w.b];
    for (const v of raw) {
      if (on(v.a, w)) cuts.push(v.a);
      if (on(v.b, w)) cuts.push(v.b);
      if ((w.a.x === w.b.x) !== (v.a.x === v.b.x)) {
        const p =
          w.a.x === w.b.x ? { x: w.a.x, y: v.a.y } : { x: v.a.x, y: w.a.y };
        if (on(p, w) && on(p, v)) cuts.push(p);
      }
    }
    const sorted = [...new Map(cuts.map((p) => [key(p), p])).values()].sort(
      (a, b) => a.x - b.x || a.y - b.y,
    );
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1],
        b = sorted[i],
        k = key(a) + "|" + key(b),
        prior = segments.get(k);
      if (prior) {
        if (Math.abs(prior.t - w.t) > 1)
          invalid("共用墙厚度冲突，请合并或校正重复墙线", w.id);
        prior.sources.add(w.id);
        continue;
      }
      const id = `${seed}:w:${k}`;
      segments.set(k, { id, a, b, t: w.t, sources: new Set([w.id]) });
      plan.walls.push({ id, a: node(a), b: node(b), t: w.t });
    }
  }
  if (
    plan.nodes.some(
      (n) => plan.walls.filter((w) => w.a === n.id || w.b === n.id).length < 2,
    )
  )
    invalid("发现未连接墙端，请校正缺口或多余墙线", "walls");
  for (const o of data.openings) {
    const host = raw.find((w) => w.id === o.wallId)!,
      len = Math.hypot(host.b.x - host.a.x, host.b.y - host.a.y),
      position = o.offset * scale,
      width = rounded(o.width * scale);
    if (position - width / 2 < -1 || position + width / 2 > len + 1)
      invalid("门窗超出所属墙的范围", o.id);
    const center = {
      x: host.a.x + ((host.b.x - host.a.x) * position) / len,
      y: host.a.y + ((host.b.y - host.a.y) * position) / len,
    };
    const s = [...segments.values()].find(
      (s) =>
        s.sources.has(o.wallId) &&
        on(center, { ...host, a: s.a, b: s.b }) &&
        Math.hypot(center.x - s.a.x, center.y - s.a.y) >= width / 2 - 1 &&
        Math.hypot(center.x - s.b.x, center.y - s.b.y) >= width / 2 - 1,
    );
    if (!s) invalid("门窗跨越墙体交点，请核对位置或墙体连接", o.id);
    const pos = rounded(Math.hypot(center.x - s.a.x, center.y - s.a.y)),
      sill = o.sill ?? (o.type === "window" ? 900 : 0),
      head = o.head ?? (o.type === "window" ? 2400 : 2100);
    if (
      plan.openings.some(
        (p) =>
          p.wall === s.id &&
          Math.min(p.pos + p.width / 2, pos + width / 2) -
            Math.max(p.pos - p.width / 2, pos - width / 2) >
            1,
      )
    )
      invalid("同墙门窗重叠", o.id);
    if (o.sill === undefined || o.head === undefined)
      defaults.push(`${o.id} 离地 ${sill} / 顶高 ${head} mm`);
    plan.openings.push({
      id: `${seed}:o:${o.id}`,
      wall: s.id,
      type: o.type,
      pos,
      width,
      sill,
      head,
      hinge:
        host.b.x - host.a.x + host.b.y - host.a.y >= 0
          ? (o.hinge ?? 0)
          : 1 - (o.hinge ?? 0),
      side:
        host.b.x - host.a.x + host.b.y - host.a.y >= 0
          ? (o.side ?? 1)
          : -(o.side ?? 1),
    });
  }
  for (const r of data.rooms)
    plan.rooms.push({
      id: `${seed}:r:${r.id}`,
      ...transform(r.at),
      name: r.name,
      mat: "oak",
      ceil: { type: "none" },
    });
  const regions = detectRooms(plan).regions;
  for (const r of plan.rooms)
    if (
      regions.filter((zone: any) => inside(zone, { x: r.x, y: r.y })).length !==
      1
    )
      invalid("房间标签不在有效封闭房间内", r.id);
  if (
    regions.some(
      (r: any) =>
        r.area >= 0.1 &&
        plan.rooms.filter((p) => inside(r, { x: p.x, y: p.y })).length !== 1,
    )
  )
    invalid(
      "每个封闭区域需要一个准确房间标签；请核对漏墙、重复标签或缺失房间",
      "rooms",
    );
  if (data.targetRoomIds.length === 0)
    invalid("请选择需要复现家具的客厅和餐厅", "targetRoomIds");
  const targetRoomIds = data.targetRoomIds.map((id) => `${seed}:r:${id}`);
  const symbols = data.symbols
    .filter((s) => data.targetRoomIds.includes(s.roomId))
    .map((s) => ({
      ...s,
      ...transform(s),
      w: rounded(s.w * scale),
      d: rounded(s.d * scale),
      objectId: `${seed}:f:${s.id}`,
    }));
  if (!symbols.length)
    invalid("目标客餐厅需要原图家具清单，请补齐或选择正确房间", "symbols");
  if (symbols.length > 50) invalid("目标家具超过单事务 50 件上限", "symbols");
  const source = {
    kind: "floorplan",
    imageId: data.image.id,
    imageHash: data.image.sha256,
    imageWidth: data.image.width,
    imageHeight: data.image.height,
    mmPerPixel: scale,
    origin,
    ...binding,
    symbolObjects: Object.fromEntries(symbols.map((s) => [s.id, s.objectId])),
    targetRoomIds,
  };
  plan.source = source;
  const state = normalizeState({ plan, roomLabelArchive: [] });
  const commands: Command[] = [
    { type: "project", patch: { name: plan.name, height, source } },
  ];
  for (const collection of collections)
    commands.push(
      ...state.plan[collection].map((object) => ({
        type: "add" as const,
        collection,
        object: clone(object),
      })),
    );
  return {
    state,
    commands,
    symbols,
    targetRoomIds,
    defaults: [...new Set(defaults)],
    scale: { mmPerPixel: scale, origin },
    rooms: regions.map((r: any) => ({
      id: r.key,
      name: plan.rooms.find((p) => p.id === r.key)?.name,
      area: r.area,
      rects: r.rects,
    })),
    coverage: [
      "单层正交墙体、共用墙与连接",
      "所有封闭区域及房间标签",
      "门窗归属、范围与重叠",
      "统一比例尺及标注交叉校验",
    ],
  };
}
export function materializeFloorplan(
  data: FloorplanData,
  seed: string,
  binding: FloorplanBinding,
  matches: SymbolMatch[],
) {
  const compiled = compileFloorplan(data, seed, binding);
  const active = compiled.symbols;
  if (Array.isArray(matches))
    for (const m of matches) {
      object(m, ["symbolId", "key"], "matches");
      text(m.symbolId, "matches.symbolId", 100);
      text(m.key, "matches.key", 100);
    }
  if (
    !Array.isArray(matches) ||
    matches.length !== active.length ||
    new Set(matches.map((m) => m.symbolId)).size !== matches.length ||
    matches.some((m) => !active.some((s) => s.id === m.symbolId))
  )
    invalid("目录匹配必须与目标家具逐项对应", "matches");
  const edits: Command[] = active.map((s) => {
    const m = matches.find((m) => m.symbolId === s.id)!;
    object(m, ["symbolId", "key"], "matches");
    if (
      !Object.hasOwn(catalog, m.key) ||
      (s.catalogKey && s.catalogKey !== m.key)
    )
      invalid("目录选择与已确认家具不一致", s.id);
    const f = createFurniture(m.key, s.x, s.y, { w: s.w, d: s.d, rot: s.rot });
    f.id = s.objectId;
    return { type: "add", collection: "furniture", object: f };
  });
  const commands = [...compiled.commands, ...edits],
    state = applyCommands(
      { plan: blankPlan(), roomLabelArchive: [] },
      commands,
    );
  const keys = [...new Set(matches.map((m) => m.key))];
  const scope: EditScope = {
    targetIds: [],
    allowDeleteIds: [],
    allowAddKeys: keys,
    allowedRoomIds: compiled.targetRoomIds,
    requirements: keys.map((key) => ({
      key,
      count: matches.filter((m) => m.key === key).length,
      scope: "project",
    })),
  };
  return { ...compiled, commands, state, scope };
}
export function checkFloorplanInitialization(
  before: SceneState,
  after: SceneState,
  data: FloorplanData,
  seed: string,
  binding: FloorplanBinding,
  matches: SymbolMatch[],
): CheckReport {
  requireBlank(before);
  const expected = materializeFloorplan(data, seed, binding, matches),
    shell = compileFloorplan(data, seed, binding);
  const report = checkCandidate(shell.state, after, expected.scope);
  if (JSON.stringify(after) !== JSON.stringify(expected.state))
    report.issues.push({
      code: "FLOORPLAN_FROZEN_LAYOUT",
      objectIds: [],
      message: "结构、来源或家具布局偏离已确认草稿",
      level: "error",
      blocking: true,
    });
  if (data.uncertainties.some((u) => u.blocking))
    report.issues.push({
      code: "FLOORPLAN_UNCERTAIN",
      objectIds: [],
      message: "仍有未解决的识别不确定项",
      level: "error",
      blocking: true,
    });
  report.passed = !report.issues.some((i) => i.blocking);
  report.coverage = [
    ...shell.coverage,
    "已确认原图布局逐项一致",
    "限定目标客餐厅",
    ...report.coverage,
  ];
  return report;
}
