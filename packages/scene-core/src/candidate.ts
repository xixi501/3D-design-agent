import {
  applyCommands,
  catalog,
  clone,
  createFurniture,
  detectRooms,
  checkScene,
  newId,
  pointInPolygon,
  isSurfaceHost,
} from "./index.js";
import { Zg } from "./inherited/footprints.js";
import {
  actionCommand,
  isOpenableFurniture,
  isTogglableFurniture,
} from "./actions.js";
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
  "parentObjectId",
  "placement",
] as const;
export type AgentPatch = Partial<
  Pick<Furniture, (typeof editableFields)[number]>
>;
export interface AllowedAsset {
  assetId: string;
  name: string;
  w: number;
  d: number;
  h: number;
}
export type CandidateEdit =
  | { type: "create"; key: string; values: AgentPatch }
  | { type: "update"; id: string; values: AgentPatch }
  | { type: "delete"; id: string }
  | {
      type: "action";
      collection: "openings" | "furniture";
      id: string;
      action: "toggle_open" | "toggle_on";
      /** When present, make the request idempotent by setting this state. */
      desiredState?: boolean;
    }
  | {
      type: "placeAsset";
      assetId: string;
      values: {
        x: number;
        y: number;
        z?: number;
        placement: "floor" | "surface";
        parentObjectId?: string;
      };
    };
export interface EditScope {
  targetIds: string[];
  allowDeleteIds: string[];
  allowAddKeys: string[];
  fieldMask?: Record<string, string[]>;
  additionBounds?: { x0: number; y0: number; x1: number; y1: number };
  targetBounds?: { x0: number; y0: number; x1: number; y1: number };
  allowedRoomIds?: string[];
  /** strict-repair requires every target-related error to disappear. */
  checkProfile?: "legacy" | "strict-repair";
  /** Opening or furniture IDs the actor may toggle (open/on) without moving them. */
  actionIds?: string[];
  /** Photo-generated models the actor may place; dimensions come from AssetRecord. */
  allowedAssets?: AllowedAsset[];
  requirements: { key: string; count: number; scope: "project" | "targets" }[];
  /** Bounded replacement pool selected during asset grounding. */
  assetPool?: string[];
  additionRules?: { keys: string[]; count: number }[];
}
export interface CandidateIssue {
  code: string;
  objectIds: string[];
  message: string;
  level: "error" | "warning";
  category?: "structure" | "furniture" | "surface" | "action" | "overlap";
  fixableByFurniture?: boolean;
  owner?: "furniture" | "structure" | "manual";
  roomId?: string;
  metric?: number;
  blocking: boolean;
}
export interface CheckReport {
  passed: boolean;
  issues: CandidateIssue[];
  remainingIssues: number;
  targetIssuesBefore: number;
  targetIssuesAfter: number;
  coverage: string[];
  limitations: string[];
}
export interface BusinessDiff {
  added: string[];
  deleted: string[];
  updated: string[];
}
const fail = (message: string): never => {
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
    "targetBounds",
    "fieldMask",
    "allowedRoomIds",
    "checkProfile",
    "actionIds",
    "allowedAssets",
    "assetPool",
    "additionRules",
  ]);
  if (
    s.checkProfile !== undefined &&
    !["legacy", "strict-repair"].includes(s.checkProfile)
  )
    fail("checkProfile 需要 legacy 或 strict-repair");
  const ids = new Set(plan.furniture.map((f) => f.id));
  for (const name of ["targetIds", "allowDeleteIds", "allowAddKeys"] as const) {
    const values = s[name];
    if (
      !Array.isArray(values) ||
      values.length > 300 ||
      values.some((x) => typeof x !== "string") ||
      new Set(values).size !== values.length
    )
      fail(`${name} 需要最多 300 个不重复身份`);
  }
  if (
    s.targetIds.some((id) => !ids.has(id)) ||
    s.allowDeleteIds.some((id) => !s.targetIds.includes(id))
  )
    fail("目标身份无效或删除授权超出目标范围");
  if (s.allowAddKeys.some((key) => !Object.hasOwn(catalog, key)))
    fail("新增配方不在家具目录内");
  if (
    s.assetPool !== undefined &&
    (!Array.isArray(s.assetPool) ||
      s.assetPool.length > 25 ||
      s.assetPool.some(
        (key) => typeof key !== "string" || !Object.hasOwn(catalog, key),
      ) ||
      new Set(s.assetPool).size !== s.assetPool.length)
  )
    fail("资产替换池无效");
  if (s.assetPool && s.allowAddKeys.some((key) => !s.assetPool!.includes(key)))
    fail("新增配方必须来自已冻结的资产替换池");
  if (s.additionRules !== undefined) {
    if (!Array.isArray(s.additionRules) || s.additionRules.length > 20)
      fail("新增额度无效");
    const used = new Set<string>();
    for (const rule of s.additionRules) {
      keys(rule, ["keys", "count"]);
      if (
        !Array.isArray(rule.keys) ||
        !rule.keys.length ||
        new Set(rule.keys).size !== rule.keys.length ||
        rule.keys.some(
          (key) => !s.allowAddKeys.includes(key) || used.has(key),
        ) ||
        !Number.isInteger(rule.count) ||
        rule.count < 1 ||
        rule.count > 120
      )
        fail("新增额度或替换池无效");
      rule.keys.forEach((key) => used.add(key));
    }
    if (s.allowAddKeys.some((key) => !used.has(key)))
      fail("每个新增配方都需要对应额度");
  }
  if (s.actionIds !== undefined) {
    const actionable = new Set([
      ...plan.furniture.map((f) => f.id),
      ...plan.openings.map((o) => o.id),
    ]);
    if (
      !Array.isArray(s.actionIds) ||
      s.actionIds.length > 300 ||
      s.actionIds.some((id) => typeof id !== "string" || !actionable.has(id)) ||
      new Set(s.actionIds).size !== s.actionIds.length
    )
      fail("动作授权对象无效");
  }
  if (s.allowedAssets !== undefined) {
    if (!Array.isArray(s.allowedAssets) || s.allowedAssets.length > 300)
      fail("照片资产授权列表无效");
    const ids = new Set<string>();
    for (const asset of s.allowedAssets) {
      keys(asset, ["assetId", "name", "w", "d", "h"]);
      if (
        typeof asset.assetId !== "string" ||
        !asset.assetId ||
        ids.has(asset.assetId) ||
        typeof asset.name !== "string" ||
        !asset.name ||
        !Number.isFinite(asset.w) ||
        !Number.isFinite(asset.d) ||
        !Number.isFinite(asset.h) ||
        asset.w <= 0 ||
        asset.d <= 0 ||
        asset.h <= 0
      )
        fail("照片资产授权记录无效");
      ids.add(asset.assetId);
    }
  }
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
  if (!Array.isArray(s.requirements) || s.requirements.length > 100)
    fail("数量要求无效");
  for (const r of s.requirements) {
    keys(r, ["key", "count", "scope"]);
    if (
      !Object.hasOwn(catalog, r.key) ||
      !Number.isInteger(r.count) ||
      r.count < 0 ||
      r.count > 300 ||
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
  for (const bounds of [s.additionBounds, s.targetBounds]) {
    if (!bounds) continue;
    keys(bounds, ["x0", "y0", "x1", "y1"]);
    if (
      Object.values(bounds).length !== 4 ||
      Object.values(bounds).some(
        (n) => !Number.isFinite(n) || Math.abs(n) > 100000,
      ) ||
      bounds.x1 <= bounds.x0 ||
      bounds.y1 <= bounds.y0
    )
      fail("局部编辑区域无效");
  }
  return clone(s);
}
export function materializeEdits(
  state: SceneState,
  scope: EditScope,
  edits: CandidateEdit[],
): Command[] {
  if (!Array.isArray(edits) || !edits.length || edits.length > 100)
    fail("候选需要 1–100 条编辑");
  let working = clone(state);
  const commands: Command[] = [];
  for (const edit of edits) {
    keys(
      edit,
      edit.type === "create"
        ? ["type", "key", "values"]
        : edit.type === "update"
          ? ["type", "id", "values"]
          : edit.type === "action"
            ? ["type", "collection", "id", "action", "desiredState"]
            : edit.type === "placeAsset"
              ? ["type", "assetId", "values"]
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
      const values = { ...edit.values };
      if (values.placement === "surface" && values.parentObjectId) {
        const host = working.plan.furniture.find(
          (item) => item.id === values.parentObjectId,
        );
        if (host) values.z = (host.z || 0) + host.h;
      }
      command = {
        type: "add",
        collection: "furniture",
        object: createFurniture(edit.key, values.x, values.y, values),
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
    } else if (edit.type === "action") {
      if (!scope.actionIds?.includes(edit.id)) fail("动作对象没有获得任务授权");
      if (!["openings", "furniture"].includes(edit.collection))
        fail("动作集合无效");
      if (!["toggle_open", "toggle_on"].includes(edit.action))
        fail("动作类型无效");
      if (
        edit.desiredState !== undefined &&
        typeof edit.desiredState !== "boolean"
      )
        fail("动作目标状态必须是布尔值");
      if (edit.collection === "openings") {
        if (!working.plan.openings.some((item) => item.id === edit.id))
          fail("动作对象不存在");
        if (edit.action !== "toggle_open") fail("门窗只能使用开启动作");
      } else {
        const target =
          working.plan.furniture.find((item) => item.id === edit.id) ??
          fail("动作对象不存在");
        if (
          (edit.action === "toggle_open" && !isOpenableFurniture(target)) ||
          (edit.action === "toggle_on" && !isTogglableFurniture(target))
        )
          fail("动作类型与家具能力不匹配");
      }
      const toggled = actionCommand(
        working.plan,
        edit.collection,
        edit.id,
        edit.desiredState,
        edit.action,
      );
      if (!toggled) fail("该对象没有可切换的开启或电器状态");
      command = toggled as Command;
    } else if (edit.type === "placeAsset") {
      const asset = scope.allowedAssets?.find(
        (item) => item.assetId === edit.assetId,
      );
      if (!asset) fail("照片资产没有获得任务授权");
      keys(edit.values, ["x", "y", "z", "placement", "parentObjectId"]);
      if (!Number.isFinite(edit.values.x) || !Number.isFinite(edit.values.y))
        fail("照片资产需要 x/y 坐标");
      if (!["floor", "surface"].includes(edit.values.placement))
        fail("照片资产放置类型无效");
      const host =
        edit.values.placement === "surface"
          ? working.plan.furniture.find(
              (item) => item.id === edit.values.parentObjectId,
            )
          : undefined;
      if (edit.values.placement === "surface" && !host)
        fail("台面放置需要真实宿主");
      if (host && !isSurfaceHost(host)) fail("宿主不是可承载的台面家具");
      command = {
        type: "add",
        collection: "furniture",
        object: {
          id: newId(),
          key: `model:${asset!.assetId}`,
          type: "model",
          modelId: asset!.assetId,
          name: asset!.name,
          x: edit.values.x,
          y: edit.values.y,
          z: host ? (host.z || 0) + host.h : edit.values.z || 0,
          rot: 0,
          w: asset!.w,
          d: asset!.d,
          h: asset!.h,
          color: "#ffffff",
          placement: edit.values.placement,
          ...(host ? { parentObjectId: host.id } : {}),
        } as Furniture,
      };
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
    // Action state is not structure: openings keep their geometry but their
    // open flag may change through Candidate action edits.
    const view: any = {
      ...plan,
      furniture: [],
      openings: plan.openings.map(({ open, ...opening }: any) => opening),
    };
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
    if (!scope.targetIds.includes(id) && !scope.actionIds?.includes(id))
      add("PROTECTED_OBJECT", [id], "修改了未授权对象");
  for (const id of diff.deleted)
    if (!scope.allowDeleteIds.includes(id))
      add("PROTECTED_OBJECT", [id], "删除了未授权对象");
  for (const id of diff.updated) {
    const f = after.plan.furniture.find((f) => f.id === id)!;
    const b = scope.targetBounds;
    if (
      b &&
      scope.targetIds.includes(id) &&
      (f.x < b.x0 || f.x > b.x1 || f.y < b.y0 || f.y > b.y1)
    )
      add("OUTSIDE_EDIT_REGION", [id], "目标对象超出已授权的局部编辑区域");
  }
  for (const id of diff.added) {
    const f = after.plan.furniture.find((f) => f.id === id)!;
    const allowedModel =
      f.type === "model" &&
      scope.allowedAssets?.some((asset) => asset.assetId === f.modelId);
    if (!allowedModel && !scope.allowAddKeys.includes(f.key))
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
  for (const rule of scope.additionRules || []) {
    const added = after.plan.furniture.filter(
      (f) => diff.added.includes(f.id) && rule.keys.includes(f.key),
    );
    if (added.length !== rule.count)
      add(
        "QUANTITY_REQUIREMENT",
        added.map((f) => f.id),
        `本次新增数量需为 ${rule.count}，实际 ${added.length}`,
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
  const strict = scope.checkProfile === "strict-repair";
  const targetIds = new Set(scope.targetIds);
  if (strict && !targetIds.size)
    add("STRICT_SCOPE_EMPTY", [], "严格修复需要至少一个目标家具");
  const baseline = checkScene(before.plan).issues;
  const afterIssues = checkScene(after.plan).issues;
  const previous = new Map(
    baseline.map((i) => [i.code + ":" + [...i.objectIds].sort().join(","), i]),
  );
  for (const issue of afterIssues) {
    const old = previous.get(
      issue.code + ":" + [...issue.objectIds].sort().join(","),
    );
    const affected = issue.objectIds.some((id) => changed.has(id));
    const targetRelevant = issue.objectIds.some((id) => targetIds.has(id));
    const actionAffected = issue.objectIds.some(
      (id) =>
        scope.actionIds?.includes(id) &&
        (after.plan.openings.some((o) => o.id === id && o.open === true) ||
          after.plan.furniture.some(
            (f) => f.id === id && f.opt?.open === true,
          )),
    );
    const actionConflict =
      actionAffected &&
      ["OPENABLE_FRONT_BLOCKED", "DOOR_CABINET_CONFLICT"].includes(issue.code);
    const blocking =
      actionConflict ||
      (affected && (!old || (issue.metric || 0) > (old.metric || 0) + 1)) ||
      (strict && targetRelevant);
    issues.push({
      ...issue,
      level: issue.level as "error" | "warning",
      blocking,
    });
  }
  const targetIssuesBefore = baseline.filter(
    (issue) =>
      issue.level === "error" &&
      issue.objectIds.some((id) => targetIds.has(id)),
  ).length;
  const targetIssuesAfter = afterIssues.filter(
    (issue) =>
      issue.level === "error" &&
      issue.objectIds.some((id) => targetIds.has(id)),
  ).length;
  return {
    passed: !issues.some((i) => i.blocking),
    issues,
    remainingIssues: afterIssues.filter((issue) => issue.level === "error")
      .length,
    targetIssuesBefore,
    targetIssuesAfter,
    coverage: [
      "授权对象与结构逐字段保护",
      "需求数量",
      "封闭房间占地包含（20 mm 容差）",
      "有效高度与原版参数化轮廓 SAT",
      "基准问题对照",
      ...(strict ? ["严格修复：目标对象相关 error 必须清零"] : []),
    ],
    limitations: [
      "GLB 使用矩形占地，不是精确网格碰撞",
      "未验证支撑面、通道可达性、照明或法规",
    ],
  };
}
