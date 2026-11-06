/** V2: exact labelled feature distances and noisy raster observations are distinct. */
import { SceneError } from "./index.js";
import { millimetres, type Dimension } from "./rectangular.js";
import type { FloorplanData } from "./floorplan.js";
export interface MeasurementFeature {
  id: string;
  objectId: string;
  kind: "wall_center" | "wall_face" | "wall_end" | "opening_edge";
  axis: "x" | "y";
  side?: "min" | "max";
  endpoint?: "a" | "b";
  evidenceRefs: string[];
}
export interface MeasurementDimension {
  id: string;
  anchorIndex: number;
  from: string;
  to: string;
  distance: Dimension;
  basis: "interior" | "exterior" | "centerline";
  evidenceRefs: string[];
}
const fail = (message: string, details: any = {}): never => {
  throw new SceneError("INVALID_FLOORPLAN", message, 422, {
    stage: "dimensions",
    ...details,
  });
};
function fields(o: any, allowed: string[]) {
  if (
    !o ||
    typeof o !== "object" ||
    Array.isArray(o) ||
    Object.keys(o).some((k) => !allowed.includes(k))
  )
    fail("测量包含未知字段");
}
const refs = (v: any) =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.length <= 20 &&
  v.every((s: any) => typeof s === "string" && s.length > 0 && s.length <= 200);
export function validateMeasurement(data: FloorplanData) {
  if (data.measurementVersion === undefined || data.measurementVersion === 1) {
    if (data.features !== undefined || data.dimensions !== undefined)
      fail("旧草稿不能携带第二版测量");
    return;
  }
  if (data.measurementVersion !== 2) fail("不支持的测量版本");
  if (
    !Array.isArray(data.features) ||
    data.features.length > 500 ||
    !Array.isArray(data.dimensions) ||
    data.dimensions.length > 100
  )
    fail("测量特征或尺寸数量无效");
  const ids = new Set<string>();
  for (const f of data.features!) {
    fields(f, [
      "id",
      "objectId",
      "kind",
      "axis",
      "side",
      "endpoint",
      "evidenceRefs",
    ]);
    if (
      !/^[\w:-]{1,100}$/.test(f.id) ||
      ids.has(f.id) ||
      !["x", "y"].includes(f.axis) ||
      !refs(f.evidenceRefs)
    )
      fail("测量特征身份、方向或证据无效", { objectIds: [f.id] });
    ids.add(f.id);
    if (f.kind === "opening_edge") {
      if (
        !data.openings.some((o) => o.id === f.objectId) ||
        !["min", "max"].includes(f.side!)
      )
        fail("开口特征无效", { objectIds: [f.id] });
    } else if (["wall_center", "wall_face", "wall_end"].includes(f.kind)) {
      if (
        !data.walls.some((w) => w.id === f.objectId) ||
        (f.kind === "wall_face" && !["min", "max"].includes(f.side!)) ||
        (f.kind === "wall_end" && !["a", "b"].includes(f.endpoint!))
      )
        fail("墙体特征引用无效", { objectIds: [f.id] });
    } else fail("未知测量特征类型");
  }
  for (const d of data.dimensions!) {
    fields(d, [
      "id",
      "anchorIndex",
      "from",
      "to",
      "distance",
      "basis",
      "evidenceRefs",
    ]);
    if (
      !/^[\w:-]{1,100}$/.test(d.id) ||
      ids.has(d.id) ||
      !Number.isInteger(d.anchorIndex) ||
      d.anchorIndex < 0 ||
      d.anchorIndex >= data.anchors.length ||
      !data.features!.some((f) => f.id === d.from) ||
      !data.features!.some((f) => f.id === d.to) ||
      !refs(d.evidenceRefs) ||
      !["interior", "exterior", "centerline"].includes(d.basis) ||
      millimetres(d.distance, "dimensions." + d.id) <= 0
    )
      fail("尺寸引用、长度或证据无效", { objectIds: [d.id] });
    ids.add(d.id);
  }
}
type Expr = Map<number, number>;
const sub = (a: Expr, b: Expr) => {
  const c = new Map(a);
  for (const [k, v] of b) c.set(k, (c.get(k) || 0) - v);
  return c;
};
/** Weighted orthogonal projection onto consistent linear equalities; redundant rows eliminated first. */
function project(
  x: number[],
  variance: number[],
  equations: { a: Expr; b: number; id: string }[],
) {
  const n = x.length,
    rows = equations.map((e) => ({
      v: [...Array.from({ length: n }, (_, i) => e.a.get(i) || 0), e.b],
      ids: new Set([e.id]),
    }));
  let rank = 0;
  for (let col = 0; col < n && rank < rows.length; col++) {
    let best = rank;
    for (let r = rank + 1; r < rows.length; r++)
      if (Math.abs(rows[r].v[col]) > Math.abs(rows[best].v[col])) best = r;
    if (Math.abs(rows[best].v[col]) < 1e-9) continue;
    [rows[rank], rows[best]] = [rows[best], rows[rank]];
    const pivot = rows[rank].v[col];
    rows[rank].v = rows[rank].v.map((v) => v / pivot);
    for (let r = 0; r < rows.length; r++)
      if (r !== rank && Math.abs(rows[r].v[col]) > 1e-9) {
        const k = rows[r].v[col];
        for (let c = col; c <= n; c++) rows[r].v[c] -= k * rows[rank].v[c];
        for (const id of rows[rank].ids) rows[r].ids.add(id);
      }
    rank++;
  }
  for (const row of rows.slice(rank))
    if (Math.abs(row.v[n]) > 1e-5)
      fail("标注或连接约束相互矛盾，不能平均或删除冲突", {
        constraintIds: [...row.ids],
        residualMm: row.v[n],
      });
  const c = rows.slice(0, rank).map((r) => r.v),
    gram = c.map((a) =>
      c.map((b) =>
        a.slice(0, n).reduce((s, v, i) => s + v * b[i] * variance[i], 0),
      ),
    ),
    rhs = c.map(
      (a) => a[n] - a.slice(0, n).reduce((s, v, i) => s + v * x[i], 0),
    );
  for (let k = 0; k < rank; k++) {
    let best = k;
    for (let r = k + 1; r < rank; r++)
      if (Math.abs(gram[r][k]) > Math.abs(gram[best][k])) best = r;
    [gram[k], gram[best]] = [gram[best], gram[k]];
    [rhs[k], rhs[best]] = [rhs[best], rhs[k]];
    const p = gram[k][k];
    if (!Number.isFinite(p) || Math.abs(p) < 1e-10) fail("尺寸解算数值退化");
    for (let j = k; j < rank; j++) gram[k][j] /= p;
    rhs[k] /= p;
    for (let r = 0; r < rank; r++)
      if (r !== k) {
        const f = gram[r][k];
        for (let j = k; j < rank; j++) gram[r][j] -= f * gram[k][j];
        rhs[r] -= f * rhs[k];
      }
  }
  return x.map(
    (v, i) => v + variance[i] * c.reduce((s, a, j) => s + a[i] * rhs[j], 0),
  );
}
export function solveMeasurement(data: FloorplanData) {
  validateMeasurement(data);
  if (
    data.anchors.some(
      (a, i) =>
        !data.dimensions?.some(
          (d) =>
            d.anchorIndex === i &&
            d.basis === a.basis &&
            Math.abs(
              millimetres(d.distance, d.id) -
                millimetres(a.distance, "anchors." + i),
            ) < 0.001,
        ),
    )
  )
    fail("每个已读标注必须绑定对应的几何特征，不能忽略冲突标注", {
      field: "dimensions",
    });
  if (!data.anchors.length)
    fail("缺少可读标注或用户标定，不能估计比例", { field: "anchors" });
  const anchors = data.anchors.map((a) => ({
    dp: Math.hypot(a.b.x - a.a.x, a.b.y - a.a.y),
    mm: millimetres(a.distance, "anchor.distance"),
  }));
  const scale =
    anchors.reduce((s, a) => s + a.dp * a.mm, 0) /
    anchors.reduce((s, a) => s + a.dp * a.dp, 0);
  if (
    anchors.some(
      (a) => a.dp > 15 && Math.abs(a.mm / a.dp / scale - 1) > 0.03 + 1e-9,
    )
  )
    fail("可靠标注比例差异超过 3%，需核对失真或标注", {
      field: "anchors",
      scale,
      anchors,
    });
  const origin = {
    x: Math.min(...data.walls.flatMap((w) => [w.a.x, w.b.x])),
    y: Math.min(...data.walls.flatMap((w) => [w.a.y, w.b.y])),
  };
  const x: number[] = [],
    variance: number[] = [],
    equations: { a: Expr; b: number; id: string }[] = [];
  const variable = (value: number, v = 1) => {
    const i = x.length;
    x.push(value);
    variance.push(v);
    return new Map([[i, 1]]);
  };
  const vars = new Map<
    string,
    { normal: "x" | "y"; along: "x" | "y"; c: Expr; t: Expr; a: Expr; b: Expr }
  >();
  for (const w of data.walls) {
    const normal = Math.abs(w.a.x - w.b.x) <= 1 ? "x" : "y",
      along = normal === "x" ? "y" : "x";
    vars.set(w.id, {
      normal,
      along,
      c: variable(((w.a[normal] + w.b[normal]) / 2 - origin[normal]) * scale),
      t: variable(
        w.thicknessPx === undefined
          ? (data.wallThickness ?? 200)
          : w.thicknessPx * scale,
        4,
      ),
      a: variable((w.a[along] - origin[along]) * scale),
      b: variable((w.b[along] - origin[along]) * scale),
    });
  }
  const point = (w: any, end: "a" | "b", axis: "x" | "y") => {
    const v = vars.get(w.id)!;
    return axis === v.normal ? v.c : v[end];
  };
  for (const w of data.walls)
    for (const end of ["a", "b"] as const)
      for (const host of data.walls) {
        if (host === w) continue;
        const v = vars.get(host.id)!,
          p = w[end];
        if (
          Math.abs(p[v.normal] - (host.a[v.normal] + host.b[v.normal]) / 2) <
            0.01 &&
          p[v.along] >= Math.min(host.a[v.along], host.b[v.along]) - 0.01 &&
          p[v.along] <= Math.max(host.a[v.along], host.b[v.along]) + 0.01
        )
          equations.push({
            a: sub(point(w, end, v.normal), v.c),
            b: 0,
            id: "connection:" + w.id + ":" + end + ":" + host.id,
          });
      }
  const openings = new Map<
    string,
    { center: Expr; width: Expr; axis: "x" | "y" }
  >();
  for (const o of data.openings) {
    const w = data.walls.find((w) => w.id === o.wallId)!;
    const axis = vars.get(w.id)!.along;
    const direction = Math.sign(w.b[axis] - w.a[axis]);
    openings.set(o.id, {
      center: variable(
        (w.a[axis] + direction * o.offset - origin[axis]) * scale,
      ),
      width: variable(o.width * scale),
      axis,
    });
  }
  const exprs = new Map<string, Expr>();
  for (const f of data.features || []) {
    let expr: Expr;
    if (f.kind === "opening_edge") {
      const v = openings.get(f.objectId)!;
      if (f.axis !== v.axis)
        fail("开口边缘特征方向错误", { objectIds: [f.id] });
      expr = new Map(v.center);
      for (const [i, c] of v.width)
        expr.set(i, (f.side === "min" ? -0.5 : 0.5) * c);
    } else {
      const w = data.walls.find((w) => w.id === f.objectId)!,
        v = vars.get(w.id)!;
      if (f.kind === "wall_end") expr = point(w, f.endpoint!, f.axis);
      else {
        if (f.axis !== v.normal)
          fail("墙面或中线特征必须沿墙法向测量", { objectIds: [f.id] });
        expr = new Map(v.c);
        if (f.kind === "wall_face")
          for (const [i, c] of v.t)
            expr.set(i, (f.side === "min" ? -0.5 : 0.5) * c);
      }
    }
    exprs.set(f.id, expr);
  }
  for (const d of data.dimensions || []) {
    const a = data.features!.find((f) => f.id === d.from)!,
      b = data.features!.find((f) => f.id === d.to)!;
    if (a.axis !== b.axis) fail("尺寸不能混用横纵方向", { objectIds: [d.id] });
    if (
      d.basis === "centerline" &&
      (a.kind !== "wall_center" || b.kind !== "wall_center")
    )
      fail("中线尺寸须绑定墙中线", { objectIds: [d.id] });
    if (
      d.basis !== "centerline" &&
      (a.kind === "wall_center" ||
        b.kind === "wall_center" ||
        (a.kind === "wall_face" &&
          a.side !== (d.basis === "interior" ? "max" : "min")) ||
        (b.kind === "wall_face" &&
          b.side !== (d.basis === "interior" ? "min" : "max")))
    )
      fail("净尺寸或外尺寸绑定了错误方向的墙面", {
        objectIds: [d.id, a.id, b.id],
      });
    equations.push({
      a: sub(exprs.get(d.to)!, exprs.get(d.from)!),
      b: millimetres(d.distance, d.id),
      id: d.id,
    });
  }
  const values = project(x, variance, equations),
    evaluate = (e: Expr) => [...e].reduce((s, [i, v]) => s + values[i] * v, 0);
  const walls = data.walls.map((w) => {
    const v = vars.get(w.id)!,
      c = evaluate(v.c),
      t = evaluate(v.t),
      a = { [v.normal]: c, [v.along]: evaluate(v.a) } as {
        x: number;
        y: number;
      },
      b = { [v.normal]: c, [v.along]: evaluate(v.b) } as {
        x: number;
        y: number;
      };
    const length = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) * scale;
    const centerShift = c - [...v.c].reduce((s, [i, k]) => s + x[i] * k, 0),
      oldT = [...v.t].reduce((s, [i, k]) => s + x[i] * k, 0);
    if (
      Math.max(
        Math.abs(centerShift + (t - oldT) / 2),
        Math.abs(centerShift - (t - oldT) / 2),
      ) > Math.max(100, length * 0.02)
    )
      fail("墙面校准明显偏离原图观测", { objectIds: [w.id] });
    if (
      t < 20 ||
      t > 1000 ||
      evaluate(v.b) - evaluate(v.a) === 0 ||
      (evaluate(v.b) - evaluate(v.a)) * (w.b[v.along] - w.a[v.along]) <= 0
    )
      fail("校准导致墙面翻转或墙厚无效", { objectIds: [w.id] });
    for (const end of ["a", "b"] as const) {
      const p = end === "a" ? a : b;
      const shift = Math.hypot(
        p.x - (w[end].x - origin.x) * scale,
        p.y - (w[end].y - origin.y) * scale,
      );
      if (shift > Math.max(100, length * 0.02) + 1e-6)
        fail("尺寸校准使墙体明显偏离原图", {
          objectIds: [w.id],
          shiftMm: shift,
        });
    }
    return { id: w.id, a, b, t };
  });
  const dimensions = (data.dimensions || [])
    .map((d) => ({
      id: d.id,
      from: d.from,
      to: d.to,
      expectedMm: millimetres(d.distance, d.id),
      actualMm: evaluate(sub(exprs.get(d.to)!, exprs.get(d.from)!)),
      evidenceRefs: d.evidenceRefs,
    }))
    .map((d) => ({ ...d, residualMm: d.actualMm - d.expectedMm }));
  if (dimensions.some((d) => Math.abs(d.residualMm) > 1))
    fail("解算后标注误差超过 1 mm", { dimensions });
  return {
    scale,
    origin,
    walls,
    openings: data.openings.map((o) => {
      const v = openings.get(o.id)!,
        host = walls.find((w) => w.id === o.wallId)!,
        axis = v.axis,
        direction = Math.sign(host.b[axis] - host.a[axis]);
      return {
        id: o.id,
        pos: (evaluate(v.center) - host.a[axis]) * direction,
        width: evaluate(v.width),
      };
    }),
    report: {
      kernelVersion: "axis-constraints-1",
      dimensions,
      features: (data.features || []).map((f) => {
        const e = exprs.get(f.id)!;
        return {
          id: f.id,
          objectId: f.objectId,
          axis: f.axis,
          actualMm: evaluate(e),
          observedMm: [...e].reduce((s, [i, v]) => s + x[i] * v, 0),
          adjustmentMm: [...e].reduce(
            (s, [i, v]) => s + (values[i] - x[i]) * v,
            0,
          ),
          evidenceRefs: f.evidenceRefs,
        };
      }),
    },
  };
}
