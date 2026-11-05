import { SceneError, type Plan } from "./types.js";

function invalid(field: string, message: string): never {
  throw new SceneError("INVALID_VALUE", `${field}: ${message}`, 400, { field });
}
function number(value: unknown, field: string, min = -1000000, max = 1000000) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    invalid(field, `必须是 ${min}–${max} 范围内的有限数值`);
}
function record(value: any, field: string) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    invalid(field, "必须为对象");
}
function numericFields(
  value: any,
  field: string,
  keys: string[],
  min = 0,
  max = 50000,
) {
  for (const key of keys)
    if (value[key] !== undefined)
      number(value[key], `${field}.${key}`, min, max);
}

/** Validate fields consumed by rendering, without stripping valid legacy extension data. */
export function validateDetails(plan: Plan) {
  if (typeof plan.name !== "string") invalid("name", "必须为字符串");
  for (const w of plan.walls)
    numericFields(w, `walls.${w.id}`, ["h"], 0, 20000);
  const nodes = new Map(plan.nodes.map((n) => [n.id, n]));
  for (const collection of ["beams", "measures"] as const) {
    for (const item of plan[collection]) {
      const field = `${collection}.${item.id}`;
      const endpoints = ["a", "b"].map((key) => {
        const point =
          typeof item[key] === "string" ? nodes.get(item[key]) : item[key];
        if (!point) invalid(`${field}.${key}`, "需要有效节点引用或端点坐标");
        record(point, `${field}.${key}`);
        number(point.x, `${field}.${key}.x`);
        number(point.y, `${field}.${key}.y`);
        return point;
      });
      if (
        Math.hypot(
          endpoints[0].x - endpoints[1].x,
          endpoints[0].y - endpoints[1].y,
        ) < 1
      )
        invalid(field, "两端点必须不同");
      numericFields(item, field, ["w", "t", "h", "depth"]);
      numericFields(item, field, ["offset"], -50000);
    }
  }
  for (const s of plan.structs) numericFields(s, `structs.${s.id}`, ["h"]);
  for (const room of plan.rooms) {
    const field = `rooms.${room.id}`;
    for (const key of ["ceil", "tile"])
      if (room[key] !== undefined && room[key] !== null)
        record(room[key], `${field}.${key}`);
    if (room.ceil) {
      if (
        room.ceil.type !== undefined &&
        !["none", "flat", "edge"].includes(room.ceil.type)
      )
        invalid(`${field}.ceil.type`, "未知吊顶类型");
      numericFields(
        room.ceil,
        `${field}.ceil`,
        ["drop", "edgeW"],
        0,
        plan.height,
      );
      if (room.ceil.cove !== undefined && typeof room.ceil.cove !== "boolean")
        invalid(`${field}.ceil.cove`, "必须为布尔值");
    }
    if (room.tile)
      numericFields(room.tile, `${field}.tile`, ["rot", "ox", "oy"], -50000);
  }
  for (const f of plan.furniture) {
    const field = `furniture.${f.id}`;
    for (const key of ["opt", "cab", "kit"])
      if (f[key] !== undefined && f[key] !== null)
        record(f[key], `${field}.${key}`);
    if (f.opt?.outline !== undefined) {
      if (typeof f.opt.outline !== "string")
        invalid(`${field}.opt.outline`, "必须为坐标字符串");
      const points = f.opt.outline.trim()
        ? f.opt.outline.split("|").map((p: string) => p.split(",").map(Number))
        : [];
      if (
        points.length &&
        (points.length < 3 ||
          points.length > 200 ||
          points.some(
            (p: number[]) => p.length !== 2 || !p.every(Number.isFinite),
          ))
      )
        invalid(`${field}.opt.outline`, "需要 3–200 个有效二维顶点");
    }
    if (
      f.opt?.tint !== undefined &&
      (typeof f.opt.tint !== "string" || !/^#[0-9a-f]{6}$/i.test(f.opt.tint))
    )
      invalid(`${field}.opt.tint`, "需要六位十六进制颜色");
    if (f.cab) {
      numericFields(f.cab, `${field}.cab`, ["depth", "top", "plinth"]);
      for (const key of ["ws", "ws2"])
        if (f.cab[key] !== undefined) {
          if (!Array.isArray(f.cab[key]) || f.cab[key].length > 100)
            invalid(`${field}.cab.${key}`, "需要最多 100 个列宽");
          f.cab[key].forEach((v: unknown, i: number) =>
            number(v, `${field}.cab.${key}.${i}`, 0, 50000),
          );
        }
    }
    if (f.kit) {
      if (f.kit.shape !== undefined && !["I", "L", "U"].includes(f.kit.shape))
        invalid(`${field}.kit.shape`, "未知橱柜形状");
      numericFields(f.kit, `${field}.kit`, [
        "depth",
        "height",
        "top",
        "plinth",
      ]);
      for (const key of ["sink", "hob"])
        if (f.kit[key] !== undefined && f.kit[key] !== null) {
          record(f.kit[key], `${field}.kit.${key}`);
          numericFields(f.kit[key], `${field}.kit.${key}`, [
            "w",
            "d",
            "pos",
            "leg",
            "bowls",
            "burners",
          ]);
        }
    }
  }
}
