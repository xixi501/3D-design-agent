import {
  applyCommands,
  blankPlan,
  clone,
  collections,
  detectRooms,
  importDocument,
  SceneError,
  type Command,
  type Plan,
  type SceneState,
} from "./index.js";
import {
  businessDiff,
  checkCandidate,
  validateScope,
  type EditScope,
} from "./candidate.js";

export interface Dimension {
  value: number;
  unit: "mm" | "cm" | "m";
}
export interface RectangularOpening {
  side: "north" | "east" | "south" | "west";
  position: "center" | "offset";
  offset?: Dimension;
  width?: Dimension;
  sill?: Dimension;
  head?: Dimension;
}
export interface RectangularBrief {
  purpose: "living_dining" | "reading_lounge";
  name?: string;
  width: Dimension;
  depth: Dimension;
  height?: Dimension;
  wallThickness?: Dimension;
  doors: RectangularOpening[];
  windows: RectangularOpening[];
}
const invalid = (message: string, field?: string): never => {
  throw new SceneError("INVALID_BRIEF", message, 400, { field });
};
const object = (v: any, allowed: string[], field: string) => {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !allowed.includes(k))
  )
    invalid(`${field} 包含无效字段`, field);
};
export function millimetres(v: Dimension, field: string): number {
  object(v, ["value", "unit"], field);
  if (
    typeof v.value !== "number" ||
    !Number.isFinite(v.value) ||
    !["mm", "cm", "m"].includes(v.unit)
  )
    invalid(`${field} 需要有限数值和 mm/cm/m 单位`, field);
  return Math.round(v.value * { mm: 1, cm: 10, m: 1000 }[v.unit] * 1000) / 1000;
}
export function isBlankPlan(plan: Plan): boolean {
  return collections.every((k) => plan[k].length === 0);
}
export function requireBlank(state: SceneState) {
  if (!isBlankPlan(state.plan) || state.roomLabelArchive.length)
    throw new SceneError(
      "PROJECT_NOT_EMPTY",
      "文字生成仅用于空白项目，请新建项目；现有内容没有被覆盖",
      409,
    );
}
export function compileRectangular(brief: RectangularBrief, seed: string) {
  object(
    brief,
    [
      "purpose",
      "name",
      "width",
      "depth",
      "height",
      "wallThickness",
      "doors",
      "windows",
    ],
    "brief",
  );
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(seed))
    invalid("生成任务身份无效", "taskId");
  if (!["living_dining", "reading_lounge"].includes(brief.purpose))
    invalid("仅支持矩形客餐厅或阅读会客间", "purpose");
  if (
    brief.name !== undefined &&
    (typeof brief.name !== "string" || brief.name.length > 100)
  )
    invalid("房间名称最多 100 字", "name");
  const defaults: string[] = [];
  const dim = (v: Dimension | undefined, fallback: number, label: string) => {
    if (v === undefined) {
      defaults.push(`${label} ${fallback} mm`);
      return fallback;
    }
    return millimetres(v, label);
  };
  const width = millimetres(brief.width, "width"),
    depth = millimetres(brief.depth, "depth"),
    height = dim(brief.height, 2800, "层高"),
    thickness = dim(brief.wallThickness, 200, "墙厚");
  if (width < 100 || depth < 100 || width > 90000 || depth > 90000)
    invalid("净宽和净深需在 100–90000 mm 之间", "dimensions");
  if (height < 100 || height > 20000 || thickness < 20 || thickness > 1000)
    invalid("层高或墙厚超出支持范围", "dimensions");
  if (
    !Array.isArray(brief.doors) ||
    !brief.doors.length ||
    brief.doors.length > 8
  )
    invalid("至少需要一个入口及明确位置", "doors");
  if (!Array.isArray(brief.windows) || brief.windows.length > 8)
    invalid("请明确窗的位置，或使用空数组表示没有窗", "windows");
  const t = thickness / 2;
  const walls: any[] = [
    { a: [-t, -t], b: [width + t, -t], t: thickness, openings: [] },
    {
      a: [width + t, -t],
      b: [width + t, depth + t],
      t: thickness,
      openings: [],
    },
    {
      a: [width + t, depth + t],
      b: [-t, depth + t],
      t: thickness,
      openings: [],
    },
    { a: [-t, depth + t], b: [-t, -t], t: thickness, openings: [] },
  ];
  const sides = ["north", "east", "south", "west"];
  const openingSummary: any[] = [];
  for (const [type, items] of [
    ["door", brief.doors],
    ["window", brief.windows],
  ] as const) {
    for (const [i, op] of items.entries()) {
      const field = `${type}s.${i}`;
      object(
        op,
        ["side", "position", "offset", "width", "sill", "head"],
        field,
      );
      const side = sides.indexOf(op.side),
        horizontal = side === 0 || side === 2;
      if (side < 0 || !["center", "offset"].includes(op.position))
        invalid("门窗需要明确墙面和位置", field);
      const span = horizontal ? width : depth,
        w = dim(op.width, type === "door" ? 900 : 1500, `${field}.宽度`),
        sill = dim(op.sill, type === "door" ? 0 : 900, `${field}.离地`),
        head = dim(op.head, type === "door" ? 2100 : 2400, `${field}.顶高`);
      if (op.position === "offset" && op.offset === undefined)
        invalid("偏移位置需要距离（水平自左、竖直自上）", `${field}.offset`);
      if (op.position === "center" && op.offset !== undefined)
        invalid("居中位置不能同时提供偏移", field);
      const from =
        op.position === "center"
          ? (span - w) / 2
          : millimetres(op.offset!, `${field}.offset`);
      if (
        w <= 0 ||
        from < 0 ||
        from + w > span ||
        sill < 0 ||
        head <= sill ||
        head > height ||
        (type === "door" && sill !== 0)
      )
        invalid("门窗越界或高度无效；不能自动改变用户尺寸", field);
      if (
        walls[side].openings.some(
          (a: any) => Math.min(a.to, from + w) - Math.max(a.from, from) > 0,
        )
      )
        invalid("同一墙面上的门窗不能重叠", field);
      walls[side].openings.push({
        type,
        from,
        to: from + w,
        sill,
        head,
        ...(type === "door"
          ? { hinge: "from", into: [width / 2, depth / 2], entry: i === 0 }
          : {}),
      });
      openingSummary.push({ type, side: op.side, from, width: w, sill, head });
    }
  }
  const name =
    brief.name ||
    (brief.purpose === "living_dining"
      ? "文字生成 · 客餐厅"
      : "文字生成 · 阅读会客间");
  const state = importDocument({
    name,
    height,
    walls,
    rooms: [
      {
        at: [width / 2, depth / 2],
        name: brief.purpose === "living_dining" ? "客餐厅" : "阅读会客间",
        mat: "oak",
        wallMat: "latexWhite",
        ceil: { type: "none" },
      },
    ],
    furniture: [],
  });
  const ids = new Map<string, string>();
  for (const key of collections)
    state.plan[key].forEach((o, i) => ids.set(o.id, `${seed}:${key}:${i}`));
  for (const key of collections)
    for (const o of state.plan[key]) {
      o.id = ids.get(o.id)!;
      for (const ref of ["a", "b", "wall"])
        if (typeof o[ref] === "string" && ids.has(o[ref]))
          o[ref] = ids.get(o[ref]);
    }
  state.roomLabelArchive.forEach((o) => {
    if (ids.has(o.id)) o.id = ids.get(o.id)!;
  });
  const commands: Command[] = [
    {
      type: "project",
      patch: {
        name,
        height,
        phase: state.plan.phase,
        look: clone(state.plan.look) ?? null,
        north: state.plan.north ?? null,
      },
    },
  ];
  for (const key of collections)
    commands.push(
      ...state.plan[key].map((o) => ({
        type: "add" as const,
        collection: key,
        object: clone(o),
      })),
    );
  const replay = applyCommands(
    { plan: blankPlan(), roomLabelArchive: [] },
    commands,
  );
  const regions = detectRooms(replay.plan).regions;
  if (regions.length !== 1) invalid("未形成唯一有效矩形房间", "dimensions");
  return {
    state: replay,
    commands,
    brief: clone(brief),
    dimensions: { width, depth, height, wallThickness: thickness },
    openings: openingSummary,
    defaults,
  };
}
export function structuralDiff(before: Plan, after: Plan) {
  return Object.fromEntries(
    collections
      .filter((k) => k !== "furniture")
      .map((k) => {
        const a = new Map(before[k].map((o) => [o.id, o])),
          b = new Map(after[k].map((o) => [o.id, o]));
        return [
          k,
          {
            added: [...b.keys()].filter((id) => !a.has(id)),
            deleted: [...a.keys()].filter((id) => !b.has(id)),
            updated: [...a.keys()].filter(
              (id) =>
                b.has(id) &&
                JSON.stringify(a.get(id)) !== JSON.stringify(b.get(id)),
            ),
          },
        ];
      }),
  );
}
export function checkInitialization(
  before: SceneState,
  after: SceneState,
  brief: RectangularBrief,
  seed: string,
  scope: EditScope,
) {
  requireBlank(before);
  const shell = compileRectangular(brief, seed).state;
  // Check furniture with the exact generated structure as the protected baseline.
  const report = checkCandidate(shell, after, validateScope(scope, shell.plan));
  if (
    scope.targetIds.length ||
    scope.allowDeleteIds.length ||
    !scope.requirements.length ||
    after.plan.furniture.length === 0
  )
    report.issues.push({
      code: "INITIALIZATION_REQUIREMENTS",
      objectIds: [],
      message: "初始化只能新增家具，且必须包含家具清单与数量要求",
      level: "error",
      blocking: true,
    });
  const diff = businessDiff(shell.plan, after.plan);
  if (diff.deleted.length || diff.updated.length)
    report.issues.push({
      code: "INITIALIZATION_SCOPE",
      objectIds: [],
      message: "初始化只能新增家具",
      level: "error",
      blocking: true,
    });
  report.coverage = ["净尺寸、固定门窗与单个封闭矩形", ...report.coverage];
  report.passed = !report.issues.some((i) => i.blocking);
  return report;
}
