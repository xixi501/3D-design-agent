/** Development-set evaluation only. References never enter image recognition prompts or tools. */
import {
  compileFloorplan,
  floorplanScale,
  type FloorplanData,
} from "./floorplan.js";
import { solveMeasurement } from "./floorplan-measurement.js";
import { wallGeometry } from "./index.js";
const ratio = (n: number, d: number) => (d ? n / d : 1);
const angle = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
const distance = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y);
const norm = (s: string, aliases: Record<string, string>) =>
  aliases[s] || s.trim().toLowerCase().replace(/\s+/g, "");
function activityGroupQuality(data: FloorplanData) {
  if (data.activityGroups === undefined)
    return { passed: true, applicable: false, issues: [] as string[] };
  const issues: string[] = [];
  const symbols = new Map(data.symbols.map((symbol) => [symbol.id, symbol]));
  const objectIds = data.symbols
    .map((symbol) => symbol.objectCandidateId)
    .filter((id): id is string => !!id);
  if (objectIds.length !== new Set(objectIds).size)
    issues.push("object candidate reused");
  for (const symbol of data.symbols)
    if (symbol.categoryCode && !symbol.objectCandidateId)
      issues.push(`${symbol.id} missing object candidate`);
  for (const group of data.activityGroups) {
    const primary = symbols.get(group.primarySymbolId);
    if (!primary || group.roles[group.primarySymbolId] !== "primary")
      issues.push(`${group.id} primary invalid`);
    const primaries = group.memberSymbolIds.filter(
      (id) => group.roles[id] === "primary",
    );
    if (primaries.length !== 1) issues.push(`${group.id} requires one primary`);
    if (group.type === "group_seated") {
      if (primary?.categoryCode !== "diningTable")
        issues.push(`${group.id} primary is not a dining table`);
      if (
        group.memberSymbolIds.some(
          (id) =>
            id !== group.primarySymbolId &&
            symbols.get(id)?.categoryCode !== "chair",
        )
      )
        issues.push(`${group.id} contains a non-chair satellite`);
      if (group.memberSymbolIds.length < 3)
        issues.push(`${group.id} has too few chairs`);
    }
    if (group.type === "seated_work") {
      if (primary?.categoryCode !== "desk")
        issues.push(`${group.id} primary is not a desk`);
      if (group.memberSymbolIds.length !== 2)
        issues.push(`${group.id} requires one desk and one chair`);
    }
  }
  return { passed: issues.length === 0, applicable: true, issues };
}
function union(intervals: number[][]) {
  const sorted = intervals
      .filter(([a, b]) => b > a)
      .sort((a, b) => a[0] - b[0]),
    result: number[][] = [];
  for (const [a, b] of sorted) {
    const last = result.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else result.push([a, b]);
  }
  return result;
}
function lines(data: FloorplanData, scale: number) {
  const groups = new Map<string, any>();
  for (const w of data.walls) {
    const vertical = Math.abs(w.a.x - w.b.x) <= 1,
      axis = vertical ? "y" : "x",
      normal = vertical ? "x" : "y",
      v = ((w.a[normal] + w.b[normal]) / 2) * scale,
      lo = Math.min(w.a[axis], w.b[axis]) * scale,
      hi = Math.max(w.a[axis], w.b[axis]) * scale,
      key = axis + ":" + Math.round(v);
    if (!groups.has(key)) groups.set(key, { axis, v, intervals: [] });
    groups.get(key).intervals.push([lo, hi]);
  }
  return [...groups.values()].flatMap((g) =>
    union(g.intervals).map(([lo, hi]) => ({
      axis: g.axis,
      v: g.v,
      lo,
      hi,
      tolerance: Math.max(100, (hi - lo) * 0.02),
    })),
  );
}
function wallQuality(
  actual: FloorplanData,
  reference: FloorplanData,
  scale: number,
) {
  const a = lines(actual, scale),
    b = lines(reference, scale);
  const coverage = (src: typeof a, dst: typeof a) =>
    src.map((s) => {
      const hits = dst
        .filter(
          (t) =>
            s.axis === t.axis &&
            Math.abs(s.v - t.v) <= Math.max(s.tolerance, t.tolerance),
        )
        .map((t) => [
          Math.max(s.lo, t.lo - t.tolerance),
          Math.min(s.hi, t.hi + t.tolerance),
        ]);
      return {
        length: s.hi - s.lo,
        matched: union(hits).reduce((sum, [lo, hi]) => sum + hi - lo, 0),
      };
    });
  const p = coverage(a, b),
    r = coverage(b, a);
  return {
    precision: ratio(
      p.reduce((s, v) => s + v.matched, 0),
      p.reduce((s, v) => s + v.length, 0),
    ),
    recall: ratio(
      r.reduce((s, v) => s + v.matched, 0),
      r.reduce((s, v) => s + v.length, 0),
    ),
    allMatched: p.concat(r).every((v) => v.matched >= v.length - 0.001),
  };
}
function openingPoints(data: FloorplanData, scale: number) {
  return data.openings.map((o) => {
    const w = data.walls.find((w) => w.id === o.wallId);
    if (!w) return { type: o.type, x: Infinity, y: Infinity, width: 0 };
    const length = distance(w.a, w.b);
    return {
      type: o.type === "window" ? "window" : "door",
      x: (w.a.x + ((w.b.x - w.a.x) * o.offset) / length) * scale,
      y: (w.a.y + ((w.b.y - w.a.y) * o.offset) / length) * scale,
      width: o.width * scale,
    };
  });
}
function pairs<T>(
  actual: T[],
  reference: T[],
  allowed: (a: T, b: T) => boolean,
  cost: (a: T, b: T) => number,
) {
  const edges = actual
      .flatMap((a, i) =>
        reference.flatMap((b, j) =>
          allowed(a, b) ? [{ i, j, cost: cost(a, b) }] : [],
        ),
      )
      .sort((a, b) => a.cost - b.cost),
    usedA = new Set<number>(),
    usedB = new Set<number>(),
    matches: { i: number; j: number }[] = [];
  for (const e of edges)
    if (!usedA.has(e.i) && !usedB.has(e.j)) {
      usedA.add(e.i);
      usedB.add(e.j);
      matches.push({ i: e.i, j: e.j });
    }
  return {
    matches,
    precision: ratio(matches.length, actual.length),
    recall: ratio(matches.length, reference.length),
  };
}
function symbols(
  data: FloorplanData,
  scale: number,
  aliases: Record<string, string>,
) {
  return data.symbols
    .filter(
      (s) => data.targetRoomIds.includes(s.roomId) && s.included !== false,
    )
    .map((s) => ({
      ...s,
      x: s.x * scale,
      y: s.y * scale,
      w: s.w * scale,
      d: s.d * scale,
      category: norm(s.categoryCode || s.category, aliases),
    }));
}
function topology(
  actual: FloorplanData,
  reference: FloorplanData,
  aliases: Record<string, string>,
) {
  try {
    const a = compileFloorplan(actual, "actual"),
      b = compileFloorplan(reference, "reference");
    const overlap = (r: any, s: any) =>
      r.rects.reduce(
        (sum: number, x: any) =>
          sum +
          s.rects.reduce(
            (n: number, y: any) =>
              n +
              Math.max(0, Math.min(x.x + x.w, y.x + y.w) - Math.max(x.x, y.x)) *
                Math.max(
                  0,
                  Math.min(x.y + x.h, y.y + y.h) - Math.max(x.y, y.y),
                ),
            0,
          ),
        0,
      );
    const area = (r: any) =>
      r.rects.reduce((s: number, v: any) => s + v.w * v.h, 0);
    const result = pairs<any>(
      a.rooms,
      b.rooms,
      (r, s) => overlap(r, s) / (area(r) + area(s) - overlap(r, s)) >= 0.9,
      (r, s) => -overlap(r, s),
    );
    const mapping = new Map(
      result.matches.map((p) => [a.rooms[p.i].id, b.rooms[p.j].id]),
    );
    const adjacency = (compiled: typeof a, map: Map<string, string>) => {
      const edges = new Set<string>(),
        regions = compiled.rooms;
      for (const wall of wallGeometry(compiled.state.plan).active)
        for (const opening of wall.ops) {
          if (opening.o.type === "window") continue;
          const middle = (opening.s0 + opening.s1) / 2;
          const ids = [-1, 1].map((sign) => {
            const x =
                wall.a.x + wall.u.x * middle + wall.n.x * sign * (wall.ht + 40),
              y =
                wall.a.y + wall.u.y * middle + wall.n.y * sign * (wall.ht + 40);
            const room = regions.find((r: any) =>
              r.rects.some(
                (v: any) =>
                  x >= v.x && x <= v.x + v.w && y >= v.y && y <= v.y + v.h,
              ),
            );
            return room ? map.get(room.id) || "UNMATCHED" : "OUTSIDE";
          });
          if (ids[0] !== ids[1]) edges.add(ids.sort().join("|"));
        }
      return [...edges].sort();
    };
    const names = result.matches.every(
      (p) =>
        norm(a.rooms[p.i].name || "", aliases) ===
        norm(b.rooms[p.j].name || "", aliases),
    );
    const targets = a.targetRoomIds.map((id) => mapping.get(id)).sort(),
      expectedTargets = b.targetRoomIds.slice().sort();
    const edges = adjacency(a, mapping),
      expectedEdges = adjacency(
        b,
        new Map(b.rooms.map((r: any) => [r.id, r.id])),
      );
    return {
      passed:
        result.precision === 1 &&
        result.recall === 1 &&
        names &&
        JSON.stringify(targets) === JSON.stringify(expectedTargets) &&
        JSON.stringify(edges) === JSON.stringify(expectedEdges),
      roomPrecision: result.precision,
      roomRecall: result.recall,
      names,
      targets,
      expectedTargets,
      adjacency: edges,
      expectedAdjacency: expectedEdges,
    };
  } catch (error) {
    return { passed: false, error: (error as Error).message };
  }
}
/** First-pass quality can be measured even when the recognized geometry cannot compile. */
export function scoreFloorplanRecognition(
  raw: FloorplanData,
  reference: FloorplanData,
  aliases: Record<string, string> = {},
) {
  const scale = floorplanScale(reference);
  const walls = wallQuality(raw, reference, scale);
  const openings = pairs(
    openingPoints(raw, scale),
    openingPoints(reference, scale),
    (a, b) =>
      a.type === b.type &&
      distance(a, b) <= 100 &&
      Math.abs(a.width - b.width) <= 100,
    distance,
  );
  const furniture = pairs(
    symbols(raw, scale, aliases),
    symbols(reference, scale, aliases),
    (a, b) => a.category === b.category,
    distance,
  );
  const groups = activityGroupQuality(raw);
  return {
    passed:
      [walls, openings, furniture].every(
        (m) => m.precision >= 0.9 && m.recall >= 0.9,
      ) && groups.passed,
    walls,
    openings,
    furniture,
    activityGroups: groups,
    thresholdVersion:
      raw.activityGroups !== undefined
        ? "s2c-5"
        : raw.recognitionVersion === 3
          ? "s2c-4"
          : "s2c-1",
  };
}

export function scoreFloorplan(
  raw: FloorplanData,
  confirmed: FloorplanData,
  reference: FloorplanData,
  corrections: number,
  aliases: Record<string, string> = {},
) {
  const groups = activityGroupQuality(raw);
  const measurement =
    confirmed.measurementVersion === 2
      ? solveMeasurement(confirmed)
      : undefined;
  const spatial: FloorplanData = measurement
    ? {
        ...confirmed,
        walls: measurement.walls.map((w) => ({
          ...w,
          a: {
            x: w.a.x / measurement.scale + measurement.origin.x,
            y: w.a.y / measurement.scale + measurement.origin.y,
          },
          b: {
            x: w.b.x / measurement.scale + measurement.origin.x,
            y: w.b.y / measurement.scale + measurement.origin.y,
          },
          thicknessPx: w.t / measurement.scale,
        })),
        openings: confirmed.openings.map((o) => ({
          ...o,
          offset:
            measurement.openings.find((p) => p.id === o.id)!.pos /
            measurement.scale,
          width:
            measurement.openings.find((p) => p.id === o.id)!.width /
            measurement.scale,
        })),
      }
    : confirmed;
  const scale = floorplanScale(reference),
    rawWalls = wallQuality(raw, reference, scale),
    finalWalls = wallQuality(spatial, reference, scale);
  const compareOpenings = (d: FloorplanData) =>
    pairs(
      openingPoints(d, scale),
      openingPoints(reference, scale),
      (a, b) =>
        a.type === b.type &&
        distance(a, b) <= 100 &&
        Math.abs(a.width - b.width) <= 100,
      distance,
    );
  const rawOpenings = compareOpenings(raw),
    finalOpenings = compareOpenings(spatial);
  const expected = symbols(reference, scale, aliases),
    first = symbols(raw, scale, aliases),
    last = symbols(confirmed, scale, aliases);
  const rawFurniture = pairs(
      first,
      expected,
      (a, b) => a.category === b.category,
      distance,
    ),
    finalFurniture = pairs(
      last,
      expected,
      (a, b) => a.category === b.category,
      distance,
    );
  const layout = finalFurniture.matches.map(({ i, j }) => {
    const a = last[i],
      b = expected[j];
    return {
      actualId: a.id,
      referenceId: b.id,
      passed:
        distance(a, b) <= 150 &&
        angle(a.rot, b.rot) <= 10 &&
        Math.abs(a.w - b.w) <= Math.max(100, b.w * 0.15) &&
        Math.abs(a.d - b.d) <= Math.max(100, b.d * 0.15),
      centerError: distance(a, b),
      rotationError: angle(a.rot, b.rot),
      widthError: Math.abs(a.w - b.w),
      depthError: Math.abs(a.d - b.d),
    };
  });
  const rawPassed =
    rawWalls.precision >= 0.9 &&
    rawWalls.recall >= 0.9 &&
    rawOpenings.precision >= 0.9 &&
    rawOpenings.recall >= 0.9 &&
    rawFurniture.precision >= 0.9 &&
    rawFurniture.recall >= 0.9;
  const structure = topology(confirmed, reference, aliases);
  const dimensions = measurement
    ? measurement.report.dimensions.map((d) => ({
        evidence: d.id,
        error: Math.abs(d.residualMm),
      }))
    : confirmed.anchors.map((a) => ({
        evidence: a.evidence,
        error: Math.abs(
          distance(a.a, a.b) * floorplanScale(confirmed) -
            a.distance.value * { mm: 1, cm: 10, m: 1000 }[a.distance.unit],
        ),
      }));
  const referenceDimensions = measurement
    ? reference.anchors.map((a) => {
        const axis =
          Math.abs(a.a.x - a.b.x) >= Math.abs(a.a.y - a.b.y) ? "x" : "y";
        const features = measurement.report.features.filter(
          (f) =>
            f.axis === axis &&
            confirmed.features!.find((v) => v.id === f.id)!.kind ===
              (a.basis === "centerline" ? "wall_center" : "wall_face"),
        );
        const nearest = (p: any) =>
          features
            .map((f) => ({
              ...f,
              error: Math.abs(
                f.observedMm / measurement.scale +
                  measurement.origin[axis] -
                  p[axis],
              ),
            }))
            .sort((a, b) => a.error - b.error)[0];
        const first = nearest(a.a),
          last = nearest(a.b);
        return {
          evidence: a.evidence,
          error:
            first && last
              ? Math.abs(
                  Math.abs(last.actualMm - first.actualMm) -
                    a.distance.value *
                      { mm: 1, cm: 10, m: 1000 }[a.distance.unit],
                )
              : Infinity,
        };
      })
    : reference.anchors.map((a) => ({
        evidence: a.evidence,
        error: Math.abs(
          distance(a.a, a.b) * floorplanScale(confirmed) -
            a.distance.value * { mm: 1, cm: 10, m: 1000 }[a.distance.unit],
        ),
      }));
  const dimensionsPassed =
    dimensions.every((d) => d.error <= 1.001) &&
    referenceDimensions.every((d) => d.error <= 1.001) &&
    (reference.height === undefined ||
      Math.abs((confirmed.height ?? 2800) - reference.height) <= 1);
  const finalPassed =
    finalWalls.allMatched &&
    finalOpenings.precision === 1 &&
    finalOpenings.recall === 1 &&
    finalFurniture.precision === 1 &&
    finalFurniture.recall === 1 &&
    layout.every((v) => v.passed) &&
    structure.passed &&
    dimensionsPassed;
  return {
    passed:
      rawPassed &&
      finalPassed &&
      groups.passed &&
      corrections <= (measurement ? 0 : 5),
    rawPassed,
    finalPassed,
    corrections,
    correctionLimit: measurement ? 0 : 5,
    raw: { walls: rawWalls, openings: rawOpenings, furniture: rawFurniture },
    confirmed: {
      walls: finalWalls,
      openings: finalOpenings,
      furniture: finalFurniture,
      layout,
      structure,
      dimensions,
      referenceDimensions,
      dimensionsPassed,
    },
    thresholdVersion:
      raw.activityGroups !== undefined
        ? "s2c-5"
        : raw.recognitionVersion === 3
          ? "s2c-4"
          : measurement
            ? "s2c-2"
            : "s2c-1",
  };
}

/** Evaluate actual instantiated keys, not just labels retained in the confirmed draft. */
export function catalogueMappingProof(
  plan: import("./types.js").Plan,
  reference: FloorplanData,
  layout: { actualId: string; referenceId: string }[],
  allowed: Record<string, string[]> = {},
) {
  const objects = layout.map((pair) => {
    const objectId = plan.source?.symbolObjects?.[pair.actualId],
      f = plan.furniture.find((f) => f.id === objectId),
      ref = reference.symbols.find((s) => s.id === pair.referenceId),
      keys =
        allowed[pair.referenceId] || (ref?.catalogKey ? [ref.catalogKey] : []),
      covered =
        Array.isArray(keys) &&
        keys.length > 0 &&
        keys.every((k) => typeof k === "string");
    return {
      symbolId: pair.actualId,
      referenceId: pair.referenceId,
      objectId,
      key: f?.key,
      allowedKeys: keys,
      covered,
      passed: covered && !!f && keys.includes(f.key),
    };
  });
  const expected = reference.symbols.filter(
    (s) => reference.targetRoomIds.includes(s.roomId) && s.included !== false,
  ).length;
  return {
    passed: objects.length === expected && objects.every((o) => o.passed),
    coverageComplete:
      objects.length === expected && objects.every((o) => o.covered),
    objects,
  };
}
