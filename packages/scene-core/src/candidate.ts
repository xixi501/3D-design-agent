import {
  applyCommands,
  catalog,
  clone,
  createFurniture,
  detectRooms,
  checkScene,
  newId,
  pointInPolygon,
} from "./index.js";
import { Zg } from "./inherited/footprints.js";
import { furnitureElevation } from "./placement.js";
import {
  SceneError,
  type Command,
  type Furniture,
  type Plan,
  type Point,
  type SceneState,
} from "./types.js";

export const editableFields = [
  "x",
  "y",
  "z",
  "rot",
  "w",
  "d",
  "h",
  "color",
] as const;
export type AgentPatch = Partial<
  Pick<Furniture, (typeof editableFields)[number]>
>;
export type CandidateEdit =
  | { type: "create"; key: string; values: AgentPatch }
  | { type: "update"; id: string; values: AgentPatch }
  | { type: "delete"; id: string };
export interface EditScope {
  targetIds: string[];
  allowDeleteIds: string[];
  allowAddKeys: string[];
  fieldMask?: Record<string, string[]>;
  additionBounds?: { x0: number; y0: number; x1: number; y1: number };
  allowedRoomIds?: string[];
  requirements: { key: string; count: number; scope: "project" | "targets" }[];
}
export interface CandidateIssue {
  code: string;
  objectIds: string[];
  message: string;
  level: "error" | "warning";
  metric?: number;
  blocking: boolean;
}
export interface CheckReport {
  passed: boolean;
  issues: CandidateIssue[];
  coverage: string[];
  limitations: string[];
}
export interface BusinessDiff {
  added: string[];
  deleted: string[];
  updated: string[];
}
const fail = (message: string) => {
  throw new SceneError("INVALID_CANDIDATE", message);
};
const record = (v: any) => v && typeof v === "object" && !Array.isArray(v);
function keys(value: any, allowed: readonly string[]) {
  if (!record(value) || Object.keys(value).some((k) => !allowed.includes(k)))
    fail("候选包含范围外字段");
}
export function validateScope(value: unknown, plan: Plan): EditScope {
  const s = value as EditScope;
  keys(s, [
    "targetIds",
    "allowDeleteIds",
    "allowAddKeys",
    "requirements",
    "additionBounds",
    "fieldMask",
    "allowedRoomIds",
  ]);
  const ids = new Set(plan.furniture.map((f) => f.id));
  for (const name of ["targetIds", "allowDeleteIds", "allowAddKeys"] as const) {
    const values = s[name];
    if (
      !Array.isArray(values) ||
      values.length > 100 ||
      values.some((x) => typeof x !== "string") ||
      new Set(values).size !== values.length
    )
      fail(`${name} 需要最多 100 个不重复身份`);
  }
  if (
    s.targetIds.some((id) => !ids.has(id)) ||
    s.allowDeleteIds.some((id) => !s.targetIds.includes(id))
  )
    fail("目标身份无效或删除授权超出目标范围");
  if (s.allowAddKeys.some((key) => !Object.hasOwn(catalog, key)))
    fail("新增配方不在家具目录内");
  if (s.fieldMask) {
    if (!record(s.fieldMask)) fail("字段授权必须为对象");
    for (const [id, fields] of Object.entries(s.fieldMask))
      if (
        !s.targetIds.includes(id) ||
        !Array.isArray(fields) ||
        fields.some((f) => !(editableFields as readonly string[]).includes(f))
      )
        fail("字段授权超出家具基础参数范围");
  }
  if (!Array.isArray(s.requirements) || s.requirements.length > 30)
    fail("数量要求无效");
  for (const r of s.requirements) {
    keys(r, ["key", "count", "scope"]);
    if (
      !Object.hasOwn(catalog, r.key) ||
      !Number.isInteger(r.count) ||
      r.count < 0 ||
      r.count > 100 ||
      !["project", "targets"].includes(r.scope)
    )
      fail("数量要求需要有效目录类型、范围与整数数量");
  }
  if (s.allowedRoomIds !== undefined) {
    const rooms = new Set(plan.rooms.map((r) => r.id));
    if (
      !Array.isArray(s.allowedRoomIds) ||
      !s.allowedRoomIds.length ||
      s.allowedRoomIds.some((id) => !rooms.has(id)) ||
      new Set(s.allowedRoomIds).size !== s.allowedRoomIds.length
    )
      fail("目标房间身份无效");
  }
  if (s.additionBounds) {
    keys(s.additionBounds, ["x0", "y0", "x1", "y1"]);
    if (
      Object.values(s.additionBounds).length !== 4 ||
      Object.values(s.additionBounds).some(
        (n) => !Number.isFinite(n) || Math.abs(n) > 100000,
      ) ||
      s.additionBounds.x1 <= s.additionBounds.x0 ||
      s.additionBounds.y1 <= s.additionBounds.y0
    )
      fail("新增区域无效");
  }
  return clone(s);
}
export function materializeEdits(
  state: SceneState,
  scope: EditScope,
  edits: CandidateEdit[],
): Command[] {
  if (!Array.isArray(edits) || !edits.length || edits.length > 50)
    fail("候选需要 1–50 条编辑");
  let working = clone(state);
  const commands: Command[] = [];
  for (const edit of edits) {
    keys(
      edit,
      edit.type === "create"
        ? ["type", "key", "values"]
        : edit.type === "update"
          ? ["type", "id", "values"]
          : ["type", "id"],
    );
    let command: Command;
    if (edit.type === "create") {
      if (!scope.allowAddKeys.includes(edit.key))
        fail("新增家具没有获得任务授权");
      keys(edit.values, editableFields);
      if (
        typeof edit.values.x !== "number" ||
        typeof edit.values.y !== "number"
      )
        fail("新增家具需要 x/y 坐标");
      command = {
        type: "add",
        collection: "furniture",
        object: createFurniture(
          edit.key,
          edit.values.x,
          edit.values.y,
          edit.values,
        ),
      };
    } else if (edit.type === "update") {
      if (!scope.targetIds.includes(edit.id)) fail("修改对象超出授权范围");
      keys(edit.values, editableFields);
      if (!Object.keys(edit.values).length) fail("修改字段不能为空");
      if (
        scope.fieldMask &&
        Object.keys(edit.values).some(
          (field) => !scope.fieldMask?.[edit.id]?.includes(field),
        )
      )
        fail("修改字段超出本次用户授权");
      const object = working.plan.furniture.find((f) => f.id === edit.id);
      if (!object) fail("目标对象不存在");
      const patch: any = clone(edit.values);
      if (object!.type === "model" && patch.color !== undefined)
        patch.opt = { tint: patch.color };
      command = { type: "update", collection: "furniture", id: edit.id, patch };
    } else if (edit.type === "delete") {
      if (!scope.allowDeleteIds.includes(edit.id))
        fail("删除对象没有获得任务授权");
      command = { type: "delete", collection: "furniture", id: edit.id };
    } else fail("不支持的候选编辑类型");
    commands.push(command!);
    working = applyCommands(working, [command!]);
  }
  return commands;
}
export function businessDiff(before: Plan, after: Plan): BusinessDiff {
  const a = new Map(before.furniture.map((f) => [f.id, f])),
    b = new Map(after.furniture.map((f) => [f.id, f]));
  return {
    added: [...b.keys()].filter((id) => !a.has(id)),
    deleted: [...a.keys()].filter((id) => !b.has(id)),
    updated: [...a.keys()].filter(
      (id) =>
        b.has(id) && JSON.stringify(a.get(id)) !== JSON.stringify(b.get(id)),
    ),
  };
}
function area(points: Point[]) {
  return (
    Math.abs(
      points.reduce(
        (s, p, i) =>
          s +
          p.x * points[(i + 1) % points.length].y -
          p.y * points[(i + 1) % points.length].x,
        0,
      ),
    ) / 2
  );
}
function clip(points: Point[], r: any): Point[] {
  let out = points;
  for (const [axis, bound, sign] of [
    ["x", r.x, 1],
    ["x", r.x + r.w, -1],
    ["y", r.y, 1],
    ["y", r.y + r.h, -1],
  ] as const) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i],
        b = input[(i + 1) % input.length],
        ai = (a[axis] - bound) * sign >= 0,
        bi = (b[axis] - bound) * sign >= 0;
      if (ai) out.push(a);
      if (ai !== bi) {
        const t = (bound - a[axis]) / (b[axis] - a[axis]);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
  }
  return out;
}
export function checkCandidate(
  before: SceneState,
  after: SceneState,
  scope: EditScope,
): CheckReport {
  const diff = businessDiff(before.plan, after.plan),
    changed = new Set([...diff.added, ...diff.updated]);
  const issues: CandidateIssue[] = [];
  const add = (
    code: string,
    objectIds: string[],
    message: string,
    metric?: number,
  ) =>
    issues.push({
      code,
      objectIds,
      message,
      metric,
      level: "error",
      blocking: true,
    });
  const protectedView = (plan: Plan) => {
    const view: any = { ...plan, furniture: [] };
    if (view.source?.activityGroups) {
      if (view.source.kind === "activity-groups") delete view.source;
      else view.source = { ...view.source, activityGroups: undefined };
    }
    return view;
  };
  const beforeNonFurniture = protectedView(before.plan),
    afterNonFurniture = protectedView(after.plan);
  if (
    JSON.stringify(beforeNonFurniture) !== JSON.stringify(afterNonFurniture) ||
    JSON.stringify(before.roomLabelArchive) !==
      JSON.stringify(after.roomLabelArchive)
  )
    add("PROTECTED_STRUCTURE", [], "修改了受保护的结构或项目字段");
  for (const id of diff.updated)
    if (!scope.targetIds.includes(id))
      add("PROTECTED_OBJECT", [id], "修改了未授权对象");
  for (const id of diff.deleted)
    if (!scope.allowDeleteIds.includes(id))
      add("PROTECTED_OBJECT", [id], "删除了未授权对象");
  for (const id of diff.added) {
    const f = after.plan.furniture.find((f) => f.id === id)!;
    if (!scope.allowAddKeys.includes(f.key))
      add("UNAUTHORIZED_ASSET", [id], "新增类型超出任务范围");
    const b = scope.additionBounds;
    if (b && (f.x < b.x0 || f.x > b.x1 || f.y < b.y0 || f.y > b.y1))
      add("OUTSIDE_EDIT_REGION", [id], "新增对象不在本次局部修改区域");
  }
  for (const rule of scope.requirements) {
    const matching = after.plan.furniture.filter(
      (f) =>
        f.key === rule.key &&
        (rule.scope === "project" ||
          scope.targetIds.includes(f.id) ||
          diff.added.includes(f.id)),
    );
    if (matching.length !== rule.count)
      add(
        "QUANTITY_REQUIREMENT",
        matching.map((f) => f.id),
        `${catalog[rule.key].name} 数量需为 ${rule.count}，实际 ${matching.length}`,
      );
  }
  const regions = detectRooms(after.plan).regions;
  if (changed.size && !regions.length)
    add("ROOM_UNVERIFIED", [...changed], "没有可验证的封闭房间，无法自动提交");
  for (const f of after.plan.furniture.filter((f) => changed.has(f.id))) {
    const polygons = Zg(f) as Point[][];
    const contained = regions.some(
      (room: any) =>
        (!scope.allowedRoomIds || scope.allowedRoomIds.includes(room.key)) &&
        polygons.every((poly) => {
          const total = area(poly),
            intersection = room.rects.reduce(
              (sum: number, r: any) => sum + area(clip(poly, r)),
              0,
            );
          const perimeter = poly.reduce(
            (sum, p, i) =>
              sum +
              Math.hypot(
                p.x - poly[(i + 1) % poly.length].x,
                p.y - poly[(i + 1) % poly.length].y,
              ),
            0,
          );
          return total - intersection <= perimeter * 10 + 400;
        }),
    );
    if (regions.length && !contained)
      add(
        "OUTSIDE_ROOM",
        [f.id],
        `${f.name} 的占地超出封闭房间（20 mm 边界容差）`,
      );
    const z = furnitureElevation(f, after.plan, regions);
    if (z < -1 || z + f.h > after.plan.height + 1)
      add("INVALID_ELEVATION", [f.id], `${f.name} 超出有效高度区间`);
  }
  const baseline = checkScene(before.plan).issues;
  const previous = new Map(
    baseline.map((i) => [i.code + ":" + [...i.objectIds].sort().join(","), i]),
  );
  for (const issue of checkScene(after.plan).issues) {
    const old = previous.get(
      issue.code + ":" + [...issue.objectIds].sort().join(","),
    );
    const affected = issue.objectIds.some((id) => changed.has(id));
    const blocking =
      affected && (!old || (issue.metric || 0) > (old.metric || 0) + 1);
    issues.push({
      ...issue,
      level: issue.level as "error" | "warning",
      blocking,
    });
  }
  return {
    passed: !issues.some((i) => i.blocking),
    issues,
    coverage: [
      "授权对象与结构逐字段保护",
      "需求数量",
      "封闭房间占地包含（20 mm 容差）",
      "有效高度与原版参数化轮廓 SAT",
      "基准问题对照",
    ],
    limitations: [
      "GLB 使用矩形占地，不是精确网格碰撞",
      "未验证支撑面、通道可达性、照明或法规",
    ],
  };
}
