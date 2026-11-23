import {
  isOpenableFurniture,
  isSurfaceHost,
  openEnvelope,
  rotatedAabb,
  surfaceElevation,
  surfaceHostFor,
  surfaceOverhang,
  type Aabb,
} from "./actions.js";
import { auditSafety } from "./safety-audit.js";
import {
  checkScene,
  clone,
  detectRooms,
  wallGeometry,
} from "./index.js";
import type { Command, Furniture, Plan } from "./types.js";

export interface AutoRepairOptions {
  roomId?: string;
  targetIds?: string[];
  preferredMoveIds?: string[];
  includeSafety?: boolean;
  maxIterations?: number;
  timeBudgetMs?: number;
}

export interface AutoRepairChange {
  id: string;
  name: string;
  action: "moved" | "rotated" | "anchored" | "resurfaced";
  summary: string;
  dxMm: number;
  dyMm: number;
  dzMm: number;
  rotBefore: number;
  rotAfter: number;
  wallAnchored?: boolean;
}

export interface AutoRepairResult {
  plan: Plan;
  commands: Command[];
  changes: AutoRepairChange[];
  issuesBefore: number;
  issuesAfter: number;
  fixableBefore: number;
  fixableAfter: number;
  resolvedCodes: string[];
  remainingIssues: any[];
  elapsedMs: number;
  summary: string;
}

const DECOR_COVERINGS = new Set(["curtain", "sheer", "rug", "roundRug"]);
const DOOR_TYPES = new Set([
  "door",
  "double",
  "unequal",
  "sliding",
  "folding",
  "pocket",
  "hole",
  "garage",
]);

export function isAutoRepairableIssue(issue: any): boolean {
  if (!issue || typeof issue !== "object") return false;
  if (issue.fixableByFurniture === false) return false;
  if (issue.category === "structure") return false;
  if (
    issue.code === "POSSIBLE_OVERLAP" ||
    issue.category === "overlap" ||
    issue.level === "error" ||
    String(issue.code || "").startsWith("SEISMIC_") ||
    issue.code === "WHEELCHAIR_TURNING_BLOCKED" ||
    issue.code === "SENSOR_BLIND_SPOT"
  ) {
    return true;
  }
  return false;
}

function normalizeRot(rot: number): number {
  const snapped = Math.round((rot || 0) / 90) * 90;
  return ((snapped % 360) + 360) % 360;
}

function snap50(n: number): number {
  return Math.round(n / 50) * 50;
}

function isSurfaceItem(f: Furniture): boolean {
  return Boolean(
    f.parentObjectId || f.placement === "surface" || f.opt?.surface === true,
  );
}

function movePriority(f: Furniture, preferred: Set<string>): number {
  if (preferred.has(f.id)) return -100;
  if (isSurfaceItem(f)) return 5;
  const k = `${f.key || ""} ${f.type || ""}`.toLowerCase();
  if (/chair|stool|lamp|plant|pouf|ottoman/.test(k)) return 15;
  if (/nightstand|sidetable|coffeetable|teatable|console/.test(k)) return 25;
  if (/shoe|sideboard|book|display|file|wine|tvcab|desk|cabinet/.test(k)) return 40;
  if (/diningtable|roundtable|table|island|counter/.test(k)) return 55;
  if (/wardrobe|cabslide|fridge|sofa|loveseat|armchair/.test(k)) return 65;
  if (/bed|luohan/.test(k)) return 85;
  return 50;
}

function issueSeverityRank(issue: any): number {
  const code = String(issue.code || "");
  if (code.startsWith("SURFACE_ITEM_")) return 1;
  if (code === "FURNITURE_IN_WALL") return 2;
  if (code === "DOORWAY_BLOCKED" || code === "DOOR_CABINET_CONFLICT") return 3;
  if (code === "OPENABLE_FRONT_BLOCKED") return 4;
  if (code === "POSSIBLE_OVERLAP") return 5;
  if (code === "WIN-01" || code === "CUR-01") return 6;
  if (code === "CIR-02") return 7;
  if (code === "SENSOR_BLIND_SPOT") return 7.5;
  if (code.startsWith("SEISMIC_")) return 8;
  if (code === "WHEELCHAIR_TURNING_BLOCKED") return 9;
  return 10;
}

function isWallHuggingType(f: Furniture): boolean {
  const k = `${f.key || ""} ${f.type || ""}`.toLowerCase();
  return /wardrobe|cabinet|cab|book|shelf|sideboard|fridge|tv|bed|desk|dresser|shoe|console|sofa|piano/.test(
    k,
  );
}

interface RoomRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface RoomRegionInfo {
  roomId?: string;
  rects: RoomRect[];
  bb: RoomRect;
}

function buildRegions(plan: Plan): {
  regions: RoomRegionInfo[];
  geo: ReturnType<typeof wallGeometry>;
} {
  const geo = wallGeometry(plan);
  const detected = detectRooms(plan, geo);
  const rawRegions: any[] = Array.isArray(detected?.regions)
    ? detected.regions
    : [];
  const regions: RoomRegionInfo[] = rawRegions.map((r) => ({
    roomId: r.labels?.[0]?.id,
    rects: Array.isArray(r.rects) ? r.rects : [r.bb],
    bb: r.bb,
  }));
  return { regions, geo };
}

function pointInRects(x: number, y: number, rects: RoomRect[], margin = 0): boolean {
  return rects.some(
    (r) =>
      x >= r.x + margin &&
      x <= r.x + r.w - margin &&
      y >= r.y + margin &&
      y <= r.y + r.h - margin,
  );
}

function aabbInsideRects(box: Aabb, rects: RoomRect[], margin = 15): boolean {
  const corners: [number, number][] = [
    [box.x0, box.y0],
    [box.x1, box.y0],
    [box.x1, box.y1],
    [box.x0, box.y1],
    [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2],
  ];
  return corners.every(([cx, cy]) => pointInRects(cx, cy, rects, margin));
}

function regionForFurniture(
  f: Furniture,
  regions: RoomRegionInfo[],
): RoomRegionInfo | undefined {
  if (!regions.length) return undefined;
  const exact = regions.find((r) => pointInRects(f.x, f.y, r.rects, 0));
  if (exact) return exact;
  let best = regions[0];
  let bestD = Infinity;
  for (const r of regions) {
    const cx = r.bb.x + r.bb.w / 2;
    const cy = r.bb.y + r.bb.h / 2;
    const d = Math.hypot(f.x - cx, f.y - cy);
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

function furnitureIdsInRoom(
  plan: Plan,
  region: RoomRegionInfo | undefined,
): Set<string> {
  if (!region) return new Set(plan.furniture.map((f) => f.id));
  return new Set(
    plan.furniture
      .filter((f) => pointInRects(f.x, f.y, region.rects, -120))
      .map((f) => f.id),
  );
}

function collectAllIssues(plan: Plan, includeSafety: boolean): any[] {
  const base = checkScene(plan).issues || [];
  if (!includeSafety && !plan.source?.safetyProfile?.enabled) return base;
  const safety = auditSafety(plan, {
    ...(plan.source?.safetyProfile || {}),
    enabled: true,
  });
  const seen = new Set(
    base.map((i: any) => `${i.code}:${(i.objectIds || []).join(",")}`),
  );
  const extra = (safety.issues || []).filter((i: any) => {
    const sig = `${i.code}:${(i.objectIds || []).join(",")}`;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
  return [...base, ...extra];
}

function filterScopeIssues(
  issues: any[],
  roomId: string | undefined,
  roomFurnitureIds: Set<string>,
  targetIds?: Set<string>,
): any[] {
  let list = issues.filter(isAutoRepairableIssue);
  if (roomId) {
    list = list.filter(
      (issue) =>
        issue.roomId === roomId ||
        (issue.objectIds || []).some((id: string) => roomFurnitureIds.has(id)),
    );
  }
  if (targetIds && targetIds.size > 0) {
    list = list.filter((issue) =>
      (issue.objectIds || []).some((id: string) => targetIds.has(id)),
    );
  }
  return list;
}

interface ScoreVector {
  scopedCount: number;
  globalCount: number;
  metricSum: number;
  displacement: number;
}

function evaluatePlan(
  plan: Plan,
  originals: Map<string, Furniture>,
  includeSafety: boolean,
  roomId: string | undefined,
  roomFurnitureIds: Set<string>,
  targetIds?: Set<string>,
): { score: ScoreVector; allIssues: any[]; scopedIssues: any[] } {
  const allIssues = collectAllIssues(plan, includeSafety);
  const scopedIssues = filterScopeIssues(
    allIssues,
    roomId,
    roomFurnitureIds,
    targetIds,
  );
  const allFixable = allIssues.filter(isAutoRepairableIssue);
  let metricSum = 0;
  for (const iss of scopedIssues) {
    const raw = Number.isFinite(iss.metric) ? Number(iss.metric) : 500;
    if (iss.code === "SENSOR_BLIND_SPOT") {
      metricSum += Math.max(0, 100 - raw) * 10;
    } else if (iss.code === "WHEELCHAIR_TURNING_BLOCKED") {
      metricSum += Math.max(0, 1500 - raw);
    } else {
      metricSum += raw;
    }
  }
  let displacement = 0;
  for (const f of plan.furniture) {
    const orig = originals.get(f.id);
    if (!orig) continue;
    displacement += Math.hypot(f.x - orig.x, f.y - orig.y);
    if (normalizeRot(f.rot) !== normalizeRot(orig.rot)) displacement += 350;
  }
  return {
    score: {
      scopedCount: scopedIssues.length,
      globalCount: allFixable.length,
      metricSum: Math.round(metricSum),
      displacement: Math.round(displacement),
    },
    allIssues,
    scopedIssues,
  };
}

function isBetter(a: ScoreVector, b: ScoreVector): boolean {
  if (a.scopedCount !== b.scopedCount) return a.scopedCount < b.scopedCount;
  if (a.globalCount !== b.globalCount) return a.globalCount < b.globalCount;
  if (a.metricSum !== b.metricSum) return a.metricSum < b.metricSum;
  return a.displacement < b.displacement;
}

function boxesOverlap2d(a: Aabb, b: Aabb, gap = 25): boolean {
  return (
    Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > -gap &&
    Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > -gap
  );
}

function doorZones(plan: Plan, geo: ReturnType<typeof wallGeometry>): Aabb[] {
  const zones: Aabb[] = [];
  for (const o of plan.openings) {
    if (!DOOR_TYPES.has(o.type)) continue;
    const w =
      geo.active.find(
        (g: any) =>
          g.w.id === o.wall || g.ops.some((op: any) => op.o.id === o.id),
      ) || geo.walls.get(o.wall);
    if (!w) continue;
    const cx = w.a.x + w.u.x * o.pos;
    const cy = w.a.y + w.u.y * o.pos;
    const half = Math.max(450, (o.width || 900) / 2);
    zones.push({
      x0: cx - half - 450,
      y0: cy - half - 450,
      x1: cx + half + 450,
      y1: cy + half + 450,
    });
  }
  return zones;
}

function buildSurfaceCandidates(
  plan: Plan,
  item: Furniture,
  region: RoomRegionInfo | undefined,
): Array<{ x: number; y: number; z: number; rot: number; parentObjectId: string }> {
  const ib = rotatedAabb(item);
  const itemW = ib.x1 - ib.x0;
  const itemD = ib.y1 - ib.y0;
  const halfW = itemW / 2;
  const halfD = itemD / 2;
  const hosts: Furniture[] = [];
  const currentHost = surfaceHostFor(plan, item);
  if (currentHost) hosts.push(currentHost);
  for (const f of plan.furniture) {
    if (f.id === item.id || f.id === currentHost?.id || !isSurfaceHost(f)) continue;
    if (region && !pointInRects(f.x, f.y, region.rects, -100)) continue;
    const hb = rotatedAabb(f);
    if (hb.x1 - hb.x0 >= itemW - 20 && hb.y1 - hb.y0 >= itemD - 20) hosts.push(f);
  }
  const out: Array<{ x: number; y: number; z: number; rot: number; parentObjectId: string }> = [];
  const seen = new Set<string>();
  const txList = [0.5, 0, 1, 0.25, 0.75];
  const tyList = [0.5, 0, 1];
  for (const host of hosts) {
    const hb = rotatedAabb(host);
    const z = surfaceElevation(plan, host) + host.h;
    const minX = hb.x0 + halfW;
    const maxX = hb.x1 - halfW;
    const minY = hb.y0 + halfD;
    const maxY = hb.y1 - halfD;
    const loX = maxX >= minX ? minX : (hb.x0 + hb.x1) / 2;
    const hiX = maxX >= minX ? maxX : (hb.x0 + hb.x1) / 2;
    const loY = maxY >= minY ? minY : (hb.y0 + hb.y1) / 2;
    const hiY = maxY >= minY ? maxY : (hb.y0 + hb.y1) / 2;
    for (const tx of txList) {
      for (const ty of tyList) {
        const x = Math.round(loX + (hiX - loX) * tx);
        const y = Math.round(loY + (hiY - loY) * ty);
        const key = `${host.id}:${x}:${y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const cand: Furniture = {
          ...item,
          x,
          y,
          z,
          parentObjectId: host.id,
          placement: "surface",
        };
        if (surfaceOverhang(cand, host) <= 15) {
          out.push({ x, y, z, rot: item.rot, parentObjectId: host.id });
        }
      }
    }
  }
  return out;
}

function buildSurfacePackTrials(plan: Plan, item: Furniture): Plan[] {
  const host = surfaceHostFor(plan, item);
  if (!host) return [];
  const siblings = plan.furniture.filter(
    (o) => o.id === item.id || o.parentObjectId === host.id,
  );
  if (siblings.length < 2 || siblings.length > 4) return [];
  const hb = rotatedAabb(host);
  const hostW = hb.x1 - hb.x0;
  const hostD = hb.y1 - hb.y0;
  const alongX = hostW >= hostD;
  const z = surfaceElevation(plan, host) + host.h;
  const ordered = [...siblings].sort((a, b) => (alongX ? a.x - b.x : a.y - b.y));
  const trials: Plan[] = [];
  for (const seq of [ordered, [...ordered].reverse()]) {
    const halfs = seq.map((s) => {
      const b = rotatedAabb(s);
      return alongX ? (b.x1 - b.x0) / 2 : (b.y1 - b.y0) / 2;
    });
    const lo = (alongX ? hb.x0 : hb.y0) + halfs[0];
    const hi = (alongX ? hb.x1 : hb.y1) - halfs[halfs.length - 1];
    if (hi < lo - 20) continue;
    let trial = plan;
    const midOther = Math.round(alongX ? (hb.y0 + hb.y1) / 2 : (hb.x0 + hb.x1) / 2);
    for (let idx = 0; idx < seq.length; idx++) {
      const t = seq.length === 1 ? 0.5 : idx / (seq.length - 1);
      const pos = Math.round(lo + (hi - lo) * t);
      trial = applyPose(trial, seq[idx].id, {
        x: alongX ? pos : midOther,
        y: alongX ? midOther : pos,
        z,
        rot: seq[idx].rot,
        parentObjectId: host.id,
        placement: "surface",
      });
    }
    trials.push(trial);
  }
  return trials;
}

interface Pose {
  x: number;
  y: number;
  rot: number;
  bucket?: "local" | "wall" | "grid";
  wallSide?: string;
}

function generatePoses(
  plan: Plan,
  f: Furniture,
  region: RoomRegionInfo | undefined,
  blockerIds: Set<string>,
  doors: Aabb[],
  ignoreIds: Set<string> = new Set(),
  preferPerimeter = false,
): Pose[] {
  const raw: Pose[] = [];
  const seen = new Set<string>();
  const baseRot = normalizeRot(f.rot);
  const push = (
    x: number,
    y: number,
    rot: number,
    bucket: "local" | "wall" | "grid" = "local",
    wallSide?: string,
  ) => {
    const sx = Math.round(x / 25) * 25;
    const sy = Math.round(y / 25) * 25;
    const sr = normalizeRot(rot);
    const key = `${sx},${sy},${sr}`;
    if (seen.has(key)) return;
    seen.add(key);
    raw.push({ x: sx, y: sy, rot: sr, bucket, wallSide });
  };

  // 1. Directional escape away from colliding peers
  const blockers = plan.furniture.filter(
    (other) => other.id !== f.id && blockerIds.has(other.id),
  );
  const steps = [100, 200, 350, 550, 800, 1100, 1500];
  for (const b of blockers) {
    const vx = f.x - b.x;
    const vy = f.y - b.y;
    const len = Math.hypot(vx, vy);
    const dirs: [number, number][] =
      len > 10
        ? [
            [vx / len, vy / len],
            [-vy / len, vx / len],
            [vy / len, -vx / len],
          ]
        : [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ];
    for (const [dx, dy] of dirs) {
      for (const s of steps) {
        push(f.x + dx * s, f.y + dy * s, baseRot);
      }
    }
  }

  // 2. Cardinal & diagonal local shifts (with current rot and rotated variants)
  const cardDirs: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];
  for (const s of [100, 250, 450, 700, 1000, 1400]) {
    for (const [dx, dy] of cardDirs) {
      push(f.x + dx * s, f.y + dy * s, baseRot);
    }
  }
  for (const r of [0, 90, 180, 270]) {
    if (r !== baseRot) {
      push(f.x, f.y, r);
      for (const s of [150, 350, 650]) {
        for (const [dx, dy] of cardDirs.slice(0, 4)) {
          push(f.x + dx * s, f.y + dy * s, r);
        }
      }
    }
  }

  // 3. Dining chair table-orbit slots
  if (/chair|stool/i.test(`${f.key} ${f.type}`)) {
    const tables = plan.furniture.filter(
      (t) =>
        t.id !== f.id &&
        /diningtable|roundtable|table/i.test(`${t.key} ${t.type}`) &&
        (!region || pointInRects(t.x, t.y, region.rects, -100)),
    );
    for (const t of tables) {
      const tb = rotatedAabb(t);
      const pad = f.d / 2 + 80;
      const offsets = [-t.w * 0.28, 0, t.w * 0.28];
      for (const ox of offsets) {
        push(t.x + ox, tb.y0 - pad, 0);
        push(t.x + ox, tb.y1 + pad, 180);
      }
      const vOffsets = [-t.d * 0.25, 0, t.d * 0.25];
      for (const oy of vOffsets) {
        push(tb.x0 - pad, t.y + oy, 270);
        push(tb.x1 + pad, t.y + oy, 90);
      }
    }
  }

  // 4. Room perimeter wall-flush candidates (crucial for wardrobes, cabinets, beds, desks!)
  if (region) {
    const wallMargin = 135; // half of typical 200mm wall + 35mm safety gap
    const rects = region.rects.length ? region.rects : [region.bb];
    for (const rect of rects) {
      // North wall (rot=0 faces south into room)
      // South wall (rot=180 faces north into room)
      // West wall (rot=270 faces east into room)
      // East wall (rot=90 faces west into room)
      const wallSpecs: Array<{ rot: number; side: "N" | "S" | "W" | "E" }> = [
        { rot: 0, side: "N" },
        { rot: 180, side: "S" },
        { rot: 270, side: "W" },
        { rot: 90, side: "E" },
      ];
      for (const { rot, side } of wallSpecs) {
        const tmp = rotatedAabb({ ...f, x: 0, y: 0, rot });
        const hw = (tmp.x1 - tmp.x0) / 2;
        const hd = (tmp.y1 - tmp.y0) / 2;
        if (side === "N" || side === "S") {
          const y =
            side === "N"
              ? rect.y + wallMargin + hd
              : rect.y + rect.h - wallMargin - hd;
          const xMin = rect.x + wallMargin + hw;
          const xMax = rect.x + rect.w - wallMargin - hw;
          if (xMin <= xMax) {
            const step = Math.max(200, Math.min(350, (xMax - xMin) / 6));
            for (let x = xMin; x <= xMax + 1; x += step) {
              push(Math.min(x, xMax), y, rot, "wall", side);
            }
            push(xMax, y, rot, "wall", side);
          }
        } else {
          const x =
            side === "W"
              ? rect.x + wallMargin + hw
              : rect.x + rect.w - wallMargin - hw;
          const yMin = rect.y + wallMargin + hd;
          const yMax = rect.y + rect.h - wallMargin - hd;
          if (yMin <= yMax) {
            const step = Math.max(200, Math.min(350, (yMax - yMin) / 6));
            for (let y = yMin; y <= yMax + 1; y += step) {
              push(x, Math.min(y, yMax), rot, "wall", side);
            }
            push(x, yMax, rot, "wall", side);
          }
        }
      }

      // 5. Interior clear-grid fallback
      const gxStep = Math.max(300, Math.min(450, rect.w / 6));
      const gyStep = Math.max(300, Math.min(450, rect.h / 6));
      const rots = isWallHuggingType(f) ? [baseRot] : [baseRot, (baseRot + 90) % 360];
      for (const rot of rots) {
        const tmp = rotatedAabb({ ...f, x: 0, y: 0, rot });
        const hw = (tmp.x1 - tmp.x0) / 2;
        const hd = (tmp.y1 - tmp.y0) / 2;
        const x0 = rect.x + wallMargin + hw;
        const x1 = rect.x + rect.w - wallMargin - hw;
        const y0 = rect.y + wallMargin + hd;
        const y1 = rect.y + rect.h - wallMargin - hd;
        if (x0 <= x1 && y0 <= y1) {
          for (let x = x0; x <= x1 + 1; x += gxStep) {
            for (let y = y0; y <= y1 + 1; y += gyStep) {
              push(Math.min(x, x1), Math.min(y, y1), rot, "grid");
            }
          }
        }
      }
    }
  }

  // Fast geometric pre-filter & sort by displacement + heuristic cleanliness
  const otherBoxes = plan.furniture
    .filter(
      (other) =>
        other.id !== f.id &&
        !ignoreIds.has(other.id) &&
        !DECOR_COVERINGS.has(other.key) &&
        other.parentObjectId !== f.id &&
        f.parentObjectId !== other.id &&
        Math.min((f.z || 0) + f.h, (other.z || 0) + other.h) -
          Math.max(f.z || 0, other.z || 0) >
          20,
    )
    .map((other) => ({ other, box: rotatedAabb(other) }));

  const ranked = raw
    .map((pose) => {
      const cand: Furniture = { ...f, x: pose.x, y: pose.y, rot: pose.rot };
      const box = rotatedAabb(cand);
      let penalty = Math.hypot(pose.x - f.x, pose.y - f.y);
      if (pose.rot !== baseRot) penalty += 350;
      if (region && !aabbInsideRects(box, region.rects, 85)) penalty += 50_000;
      for (const { box: ob } of otherBoxes) {
        if (boxesOverlap2d(box, ob, 15)) penalty += 25_000;
      }
      if (isOpenableFurniture(cand)) {
        const env = openEnvelope(cand);
        if (env) {
          if (region && !aabbInsideRects(env.aabb, region.rects, 65))
            penalty += 20_000;
          for (const { other, box: ob } of otherBoxes) {
            if (
              !(/desk/i.test(cand.key) && /chair|stool/i.test(other.key)) &&
              boxesOverlap2d(env.aabb, ob, 10)
            ) {
              penalty += 12_000;
            }
          }
        }
      }
      for (const dz of doors) {
        if (boxesOverlap2d(box, dz, 0)) penalty += 15_000;
      }
      if (preferPerimeter && region) {
        const rcx = region.bb.x + region.bb.w / 2;
        const rcy = region.bb.y + region.bb.h / 2;
        const distFromCenter = Math.hypot(pose.x - rcx, pose.y - rcy);
        penalty -= distFromCenter * 1.1;
        if (pose.bucket === "wall") penalty -= 1500;
        const sensors = (plan.source?.safetyProfile as any)?.radarSensors || [];
        if (sensors.length && f.h >= 1200) {
          const s0 = sensors[0];
          const distSensor = Math.hypot(pose.x - Number(s0.x || 0), pose.y - Number(s0.y || 0));
          penalty -= distSensor * 0.8;
        }
      }
      return { pose, penalty };
    })
    .sort((a, b) => a.penalty - b.penalty);

  // Stratified selection: keep best local shifts + best wall-flush on each wall + best grid
  const picked: Pose[] = [];
  const pickedKeys = new Set<string>();
  const addPose = (p: Pose) => {
    const k = `${p.x},${p.y},${p.rot}`;
    if (pickedKeys.has(k)) return;
    pickedKeys.add(k);
    picked.push(p);
  };
  for (const r of ranked.filter((x) => x.pose.bucket === "local").slice(0, preferPerimeter ? 4 : 8)) {
    addPose(r.pose);
  }
  for (const side of ["N", "S", "W", "E"]) {
    for (const r of ranked.filter((x) => x.pose.bucket === "wall" && x.pose.wallSide === side).slice(0, 3)) {
      addPose(r.pose);
    }
  }
  for (const r of ranked.filter((x) => x.pose.bucket === "grid").slice(0, 4)) {
    addPose(r.pose);
  }
  return picked.slice(0, 18);
}

function applyPose(plan: Plan, id: string, pose: Partial<Furniture>): Plan {
  const next = clone(plan);
  const item = next.furniture.find((f) => f.id === id);
  if (!item) return next;
  const oldX = item.x;
  const oldY = item.y;
  const oldZ = item.z || 0;
  Object.assign(item, pose);
  const dx = item.x - oldX;
  const dy = item.y - oldY;
  const dz = (item.z || 0) - oldZ;
  // Carry tabletop children along when their host furniture moves!
  if (dx !== 0 || dy !== 0 || dz !== 0) {
    for (const child of next.furniture) {
      if (child.parentObjectId === id) {
        child.x = Math.round(child.x + dx);
        child.y = Math.round(child.y + dy);
        child.z = Math.round((child.z || 0) + dz);
      }
    }
  }
  return next;
}

export function autoRepairScene(
  inputPlan: Plan,
  options: AutoRepairOptions = {},
): AutoRepairResult {
  const startedAt = Date.now();
  const working = clone(inputPlan);
  const includeSafety = Boolean(
    options.includeSafety || working.source?.safetyProfile?.enabled,
  );
  const maxIterations = Math.max(1, Math.min(24, options.maxIterations ?? 14));
  const timeBudgetMs = Math.max(500, Math.min(12000, options.timeBudgetMs ?? 3500));
  const preferred = new Set(options.preferredMoveIds || []);
  const targetIdSet =
    options.targetIds && options.targetIds.length
      ? new Set(options.targetIds)
      : undefined;

  const originals = new Map<string, Furniture>(
    working.furniture.map((f) => [f.id, clone(f)]),
  );
  const { regions, geo } = buildRegions(working);
  const targetRegion = options.roomId
    ? regions.find((r) => r.roomId === options.roomId)
    : undefined;
  const roomFurnitureIds = furnitureIdsInRoom(working, targetRegion);
  const doors = doorZones(working, geo);

  const initialEval = evaluatePlan(
    working,
    originals,
    includeSafety,
    options.roomId,
    roomFurnitureIds,
    targetIdSet,
  );
  const initialCodes = new Set(
    initialEval.scopedIssues.map((i: any) => String(i.code || "")),
  );

  let currentPlan = working;
  let currentEval = initialEval;

  // Phase 0: Immediately anchor unanchored tall cabinets if seismic issues exist
  if (includeSafety) {
    const seismicTargetIds = new Set<string>(
      currentEval.scopedIssues
        .filter((i: any) => String(i.code || "").startsWith("SEISMIC_"))
        .flatMap((i: any) => i.objectIds || []),
    );
    if (seismicTargetIds.size > 0) {
      let anchoredAny = false;
      const next = clone(currentPlan);
      for (const f of next.furniture) {
        if (
          seismicTargetIds.has(f.id) &&
          f.h >= 1400 &&
          !f.opt?.wallAnchored
        ) {
          f.opt = { ...(f.opt || {}), wallAnchored: true };
          anchoredAny = true;
        }
      }
      if (anchoredAny) {
        currentPlan = next;
        currentEval = evaluatePlan(
          currentPlan,
          originals,
          includeSafety,
          options.roomId,
          roomFurnitureIds,
          targetIdSet,
        );
      }
    }
  }

  // Phase 1: Iterative deterministic geometry repair
  for (let iter = 0; iter < maxIterations; iter++) {
    if (currentEval.scopedIssues.length === 0) break;
    if (Date.now() - startedAt > timeBudgetMs) break;

    const sortedIssues = [...currentEval.scopedIssues].sort(
      (a, b) => issueSeverityRank(a) - issueSeverityRank(b),
    );
    let improved = false;

    for (const issue of sortedIssues) {
      const involvedIds: string[] = (issue.objectIds || []).filter((id: string) =>
        currentPlan.furniture.some((f) => f.id === id),
      );
      // For room-level issues like CIR-02 or WHEELCHAIR_TURNING_BLOCKED, gather room movables
      const candidateIds = new Set<string>(involvedIds);
      if (
        candidateIds.size === 0 ||
        issue.code === "CIR-02" ||
        (issue.code === "WHEELCHAIR_TURNING_BLOCKED" && candidateIds.size === 0)
      ) {
        const reg = issue.roomId
          ? regions.find((r) => r.roomId === issue.roomId)
          : targetRegion;
        for (const f of currentPlan.furniture) {
          if (
            !DECOR_COVERINGS.has(f.key) &&
            !isSurfaceItem(f) &&
            (!reg || pointInRects(f.x, f.y, reg.rects, -100)) &&
            (!targetIdSet || targetIdSet.has(f.id))
          ) {
            candidateIds.add(f.id);
          }
        }
      }

      const orderedTargets = [...candidateIds]
        .map((id) => currentPlan.furniture.find((f) => f.id === id)!)
        .filter(Boolean)
        .filter((f) => !DECOR_COVERINGS.has(f.key) || involvedIds.length === 1)
        .sort((a, b) => movePriority(a, preferred) - movePriority(b, preferred));

      let bestPlan = currentPlan;
      let bestEval = currentEval;

      for (const f of orderedTargets) {
        const fRegion = targetRegion || regionForFurniture(f, regions);
        if (isSurfaceItem(f) && String(issue.code || "").startsWith("SURFACE_ITEM_")) {
          const surfacePoses = buildSurfaceCandidates(currentPlan, f, fRegion);
          for (const sp of surfacePoses) {
            const trial = applyPose(currentPlan, f.id, {
              x: sp.x,
              y: sp.y,
              z: sp.z,
              rot: sp.rot,
              parentObjectId: sp.parentObjectId,
              placement: "surface",
            });
            const ev = evaluatePlan(
              trial,
              originals,
              includeSafety,
              options.roomId,
              roomFurnitureIds,
              targetIdSet,
            );
            if (isBetter(ev.score, bestEval.score)) {
              bestPlan = trial;
              bestEval = ev;
              if (ev.score.scopedCount === 0) break;
            }
          }
          if (bestEval.score.scopedCount > 0) {
            for (const trial of buildSurfacePackTrials(currentPlan, f)) {
              const ev = evaluatePlan(
                trial,
                originals,
                includeSafety,
                options.roomId,
                roomFurnitureIds,
                targetIdSet,
              );
              if (isBetter(ev.score, bestEval.score)) {
                bestPlan = trial;
                bestEval = ev;
                if (ev.score.scopedCount === 0) break;
              }
            }
          }
        } else {
          const blockers = new Set<string>(
            involvedIds.filter((id) => id !== f.id),
          );
          const preferPerimeter =
            issue.code === "WHEELCHAIR_TURNING_BLOCKED" ||
            issue.code === "SENSOR_BLIND_SPOT" ||
            issue.code === "CIR-02" ||
            String(issue.code || "").startsWith("SEISMIC_");
          const poses = generatePoses(
            currentPlan,
            f,
            fRegion,
            blockers,
            doors,
            new Set(),
            preferPerimeter,
          );
          for (const pose of poses) {
            if (Date.now() - startedAt > timeBudgetMs) break;
            const trial = applyPose(currentPlan, f.id, pose);
            const ev = evaluatePlan(
              trial,
              originals,
              includeSafety,
              options.roomId,
              roomFurnitureIds,
              targetIdSet,
            );
            if (isBetter(ev.score, bestEval.score)) {
              bestPlan = trial;
              bestEval = ev;
              if (ev.score.scopedCount === 0) break;
            }
          }
        }
        if (bestEval.score.scopedCount < currentEval.score.scopedCount) {
          break;
        }
      }

      // Phase 1b: 2-item joint swap/escape if single-object move hit a deadlock
      const pairTargets = [...orderedTargets];
      if (pairTargets.length === 1 && issue.code === "SENSOR_BLIND_SPOT") {
        const reg = targetRegion || regionForFurniture(pairTargets[0], regions);
        const helper = currentPlan.furniture
          .filter(
            (x) =>
              x.id !== pairTargets[0].id &&
              !DECOR_COVERINGS.has(x.key) &&
              !isSurfaceItem(x) &&
              (!reg || pointInRects(x.x, x.y, reg.rects, -100)),
          )
          .sort((a, b) => movePriority(a, preferred) - movePriority(b, preferred))[0];
        if (helper) pairTargets.push(helper);
      }
      if (
        bestPlan === currentPlan &&
        pairTargets.length >= 2 &&
        Date.now() - startedAt < timeBudgetMs * 0.75
      ) {
        const [first, second] = pairTargets;
        const reg1 = targetRegion || regionForFurniture(first, regions);
        const reg2 = targetRegion || regionForFurniture(second, regions);
        const preferPerimeter =
          issue.code === "WHEELCHAIR_TURNING_BLOCKED" ||
          issue.code === "SENSOR_BLIND_SPOT" ||
          issue.code === "CIR-02";
        const poses1 = generatePoses(
          currentPlan,
          first,
          reg1,
          new Set([second.id]),
          doors,
          new Set([second.id]),
          preferPerimeter,
        ).slice(0, 4);
        for (const p1 of poses1) {
          if (Date.now() - startedAt > timeBudgetMs) break;
          const mid = applyPose(currentPlan, first.id, p1);
          const poses2 = generatePoses(
            mid,
            second,
            reg2,
            new Set([first.id]),
            doors,
            new Set(),
            preferPerimeter,
          ).slice(0, 5);
          for (const p2 of poses2) {
            if (Date.now() - startedAt > timeBudgetMs) break;
            const trial = applyPose(mid, second.id, p2);
            const ev = evaluatePlan(
              trial,
              originals,
              includeSafety,
              options.roomId,
              roomFurnitureIds,
              targetIdSet,
            );
            if (isBetter(ev.score, bestEval.score)) {
              bestPlan = trial;
              bestEval = ev;
              if (ev.score.scopedCount === 0) break;
            }
          }
          if (bestEval.score.scopedCount === 0) break;
        }
      }

      if (bestPlan !== currentPlan) {
        currentPlan = bestPlan;
        currentEval = bestEval;
        improved = true;
        break;
      }
    }

    if (!improved) break;
  }

  // Compile minimal atomic update commands & human-readable change ledger
  const commands: Command[] = [];
  const changes: AutoRepairChange[] = [];
  for (const f of currentPlan.furniture) {
    const orig = originals.get(f.id);
    if (!orig) continue;
    const dxMm = Math.round(f.x - orig.x);
    const dyMm = Math.round(f.y - orig.y);
    const dzMm = Math.round((f.z || 0) - (orig.z || 0));
    const rotBefore = normalizeRot(orig.rot);
    const rotAfter = normalizeRot(f.rot);
    const anchoredNow = Boolean(f.opt?.wallAnchored) && !orig.opt?.wallAnchored;
    const hostChanged = f.parentObjectId !== orig.parentObjectId;
    if (
      dxMm === 0 &&
      dyMm === 0 &&
      dzMm === 0 &&
      rotBefore === rotAfter &&
      !anchoredNow &&
      !hostChanged
    ) {
      continue;
    }
    const patch: Record<string, any> = {};
    if (dxMm !== 0) patch.x = Math.round(f.x);
    if (dyMm !== 0) patch.y = Math.round(f.y);
    if (dzMm !== 0) patch.z = Math.round(f.z || 0);
    if (rotBefore !== rotAfter) patch.rot = rotAfter;
    if (hostChanged) {
      patch.parentObjectId = f.parentObjectId;
      patch.placement = f.placement;
    }
    if (anchoredNow) {
      patch.opt = { ...(orig.opt || {}), wallAnchored: true };
    }
    commands.push({
      type: "update",
      collection: "furniture",
      id: f.id,
      patch,
    });

    const parts: string[] = [];
    const dist = Math.round(Math.hypot(dxMm, dyMm));
    if (dist > 0) parts.push(`平移 ${dist} mm`);
    if (dzMm !== 0) parts.push(`高程调整至 ${Math.round(f.z || 0)} mm`);
    if (rotBefore !== rotAfter) parts.push(`旋转 ${rotBefore}°→${rotAfter}°`);
    if (anchoredNow) parts.push("加装 L 型防震墙锚");
    const action: AutoRepairChange["action"] = anchoredNow && dist === 0
      ? "anchored"
      : hostChanged || dzMm !== 0
        ? "resurfaced"
        : rotBefore !== rotAfter && dist === 0
          ? "rotated"
          : "moved";
    changes.push({
      id: f.id,
      name: f.name,
      action,
      summary: `${f.name}（${parts.join("、")}）`,
      dxMm,
      dyMm,
      dzMm,
      rotBefore,
      rotAfter,
      ...(anchoredNow ? { wallAnchored: true } : {}),
    });
  }

  const remainingCodes = new Set(
    currentEval.scopedIssues.map((i: any) => String(i.code || "")),
  );
  const resolvedCodes = [...initialCodes].filter((c) => !remainingCodes.has(c));
  const fixableBefore = initialEval.scopedIssues.length;
  const fixableAfter = currentEval.scopedIssues.length;
  const elapsedMs = Date.now() - startedAt;

  let summary: string;
  if (fixableBefore === 0) {
    summary = "当前范围内没有可自动修复的家具或净空冲突。";
  } else if (commands.length === 0) {
    summary = `在保持墙体门窗与家具尺寸不变的前提下，剩余 ${fixableAfter} 项冲突无法通过单纯移动家具消除，建议缩小冲突家具尺寸或移出多余物件。`;
  } else if (fixableAfter === 0) {
    summary = `已自动修复全部 ${fixableBefore} 项冲突（耗时 ${elapsedMs} ms）：${changes
      .map((c) => c.summary)
      .join("；")}。`;
  } else {
    summary = `已修复 ${fixableBefore - fixableAfter}/${fixableBefore} 项冲突（耗时 ${elapsedMs} ms）：${changes
      .map((c) => c.summary)
      .join("；")}；剩余 ${fixableAfter} 项建议微调家具尺寸或交给 AI 深度重排。`;
  }

  return {
    plan: currentPlan,
    commands,
    changes,
    issuesBefore: initialEval.allIssues.length,
    issuesAfter: currentEval.allIssues.length,
    fixableBefore,
    fixableAfter,
    resolvedCodes,
    remainingIssues: currentEval.scopedIssues,
    elapsedMs,
    summary,
  };
}
