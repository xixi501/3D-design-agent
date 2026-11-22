import { surfaceElevation } from "./actions.js";
import { D4, Wc } from "./inherited/topology.js";
import { furnitureElevation } from "./placement.js";
import type { Furniture, Plan, Point } from "./types.js";

const wallGeometry = Wc;
const detectRegions = (plan: Plan, geometry = Wc(plan)): any[] => {
  const res: any = D4(plan, geometry);
  return Array.isArray(res) ? res : res?.regions || [];
};
const regionAreaMm2 = (region: any): number =>
  (region?.rects || []).reduce(
    (sum: number, b: any) => sum + Math.max(0, b.w || 0) * Math.max(0, b.h || 0),
    0,
  );
const resolveElevation = (plan: Plan, f: Furniture, regions?: any[]): number =>
  f.parentObjectId || f.placement === "surface" || f.opt?.surface === true
    ? surfaceElevation(plan, f)
    : furnitureElevation(f, plan, regions);

export interface RadarSensorSpec {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  /** Horizontal aiming azimuth in degrees (0 = +X east, 90 = +Y south); auto-aimed toward room center if omitted. */
  aimDeg?: number;
  /** Horizontal field-of-view in degrees (default 130 for corner/ceiling HarmonyOS AI sensor). */
  fovDeg?: number;
  /** Effective fall-detection range in mm (default 6500mm). */
  maxRangeMm?: number;
  roomId?: string;
}

export interface SafetyProfile {
  enabled: boolean;
  elderlyWheelchair?: boolean;
  wheelchairDiameterMm?: number;
  accessibleCorridorMm?: number;
  seismicIntensity?: 6 | 7 | 8;
  radarCheck?: boolean;
  minRadarCoverageRatio?: number;
  radarSensors?: RadarSensorSpec[];
}

export interface WheelchairAuditCircle {
  roomId?: string;
  roomName: string;
  x: number;
  y: number;
  maxDiameterMm: number;
  requiredDiameterMm: number;
  passed: boolean;
  blockerIds: string[];
}

export interface SeismicToppleZone {
  furnitureId: string;
  furnitureName: string;
  heightMm: number;
  slenderness: number;
  anchored: boolean;
  polygon: Point[];
  hazardCodes: string[];
  hitObjectIds: string[];
}

export interface RadarHeatmapCell {
  x: number;
  y: number;
  size: number;
  covered: boolean;
  occluderId?: string;
}

export interface SafetyIssue {
  code:
    | "WHEELCHAIR_TURNING_BLOCKED"
    | "SEISMIC_TOPPLE_BED_HAZARD"
    | "SEISMIC_TOPPLE_EXIT_BLOCKED"
    | "SEISMIC_UNANCHORED_CABINET"
    | "SENSOR_BLIND_SPOT";
  objectIds: string[];
  roomId?: string;
  message: string;
  level: "error" | "warning";
  blocking?: boolean;
  metric?: number;
  category: "furniture";
  fixableByFurniture: boolean;
  owner: "furniture";
  standardRef: string;
}

export interface SafetyAuditReport {
  enabled: boolean;
  profile: Required<
    Pick<
      SafetyProfile,
      | "enabled"
      | "elderlyWheelchair"
      | "wheelchairDiameterMm"
      | "accessibleCorridorMm"
      | "seismicIntensity"
      | "radarCheck"
      | "minRadarCoverageRatio"
    >
  > & { radarSensors: RadarSensorSpec[] };
  issues: SafetyIssue[];
  wheelchairCircles: WheelchairAuditCircle[];
  toppleZones: SeismicToppleZone[];
  radar: {
    sensors: Array<RadarSensorSpec & { aimDeg: number; fovDeg: number; maxRangeMm: number }>;
    coverageRatio: number;
    blindRatio: number;
    totalOpenCells: number;
    coveredCells: number;
    blindCells: number;
    topOccluderIds: string[];
    cells: RadarHeatmapCell[];
  };
  standardCitations: Array<{
    code: string;
    standard: string;
    clause: string;
    requirement: string;
  }>;
}

const SOFT_COVERINGS = new Set(["curtain", "sheer", "rug", "roundRug"]);
const DOOR_TYPES = new Set([
  "door",
  "double",
  "unequal",
  "sliding",
  "folding",
  "pocket",
  "garage",
]);

interface Obb2D {
  id: string;
  f: Furniture;
  cx: number;
  cy: number;
  halfW: number;
  halfD: number;
  ux: number; // local +X axis (width)
  uy: number;
  vx: number; // local +Y axis (depth / front)
  vy: number;
  z0: number;
  z1: number;
  corners: Point[];
}

function buildObb(plan: Plan, f: Furniture, regions?: any[]): Obb2D {
  const rad = ((f.rot || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // At rot=0: width along +X (1, 0), front/depth along +Y (0, 1).
  // Rotating clockwise by +rot in 2D (+Y down): u = (cos, sin), v = (-sin, cos).
  const ux = cos;
  const uy = sin;
  const vx = -sin;
  const vy = cos;
  const halfW = Math.max(1, f.w / 2);
  const halfD = Math.max(1, f.d / 2);
  const z0 = resolveElevation(plan, f, regions);
  const z1 = z0 + Math.max(1, f.h);
  const corners: Point[] = [
    { x: f.x - ux * halfW - vx * halfD, y: f.y - uy * halfW - vy * halfD },
    { x: f.x + ux * halfW - vx * halfD, y: f.y + uy * halfW - vy * halfD },
    { x: f.x + ux * halfW + vx * halfD, y: f.y + uy * halfW + vy * halfD },
    { x: f.x - ux * halfW + vx * halfD, y: f.y - uy * halfW + vy * halfD },
  ];
  return {
    id: f.id,
    f,
    cx: f.x,
    cy: f.y,
    halfW,
    halfD,
    ux,
    uy,
    vx,
    vy,
    z0,
    z1,
    corners,
  };
}

function pointToObbSignedDistance2D(px: number, py: number, obb: Obb2D): number {
  const dx = px - obb.cx;
  const dy = py - obb.cy;
  const lx = Math.abs(dx * obb.ux + dy * obb.uy) - obb.halfW;
  const ly = Math.abs(dx * obb.vx + dy * obb.vy) - obb.halfD;
  const outX = Math.max(lx, 0);
  const outY = Math.max(ly, 0);
  const outside = Math.hypot(outX, outY);
  const inside = Math.min(Math.max(lx, ly), 0);
  return outside + inside;
}

function pointToSegmentDist2D(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  if (len2 <= 1e-6) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

/** Convex 2D polygon Separating Axis Theorem (SAT) overlap with margin tolerance. */
function convexPolygonsOverlap(polyA: Point[], polyB: Point[], minPenetrationMm = 15): boolean {
  const checkAxes = (pa: Point[], pb: Point[]): boolean => {
    for (let i = 0; i < pa.length; i++) {
      const p0 = pa[i];
      const p1 = pa[(i + 1) % pa.length];
      const ex = p1.x - p0.x;
      const ey = p1.y - p0.y;
      const len = Math.hypot(ex, ey);
      if (len < 1e-6) continue;
      const nx = -ey / len;
      const ny = ex / len;
      let minA = Infinity;
      let maxA = -Infinity;
      for (const p of pa) {
        const proj = p.x * nx + p.y * ny;
        if (proj < minA) minA = proj;
        if (proj > maxA) maxA = proj;
      }
      let minB = Infinity;
      let maxB = -Infinity;
      for (const p of pb) {
        const proj = p.x * nx + p.y * ny;
        if (proj < minB) minB = proj;
        if (proj > maxB) maxB = proj;
      }
      const overlap = Math.min(maxA, maxB) - Math.max(minA, minB);
      if (overlap <= minPenetrationMm) return false;
    }
    return true;
  };
  return checkAxes(polyA, polyB) && checkAxes(polyB, polyA);
}

/** Exact 3D Segment vs Oriented Bounding Box (Slab method) for mmWave ray occlusion. */
function segmentIntersectsObb3D(
  sx: number,
  sy: number,
  sz: number,
  tx: number,
  ty: number,
  tz: number,
  obb: Obb2D,
): boolean {
  const dx = tx - sx;
  const dy = ty - sy;
  const dz = tz - sz;

  const ox = sx - obb.cx;
  const oy = sy - obb.cy;
  const oz = sz - (obb.z0 + obb.z1) / 2;
  const halfH = (obb.z1 - obb.z0) / 2;

  const origins = [
    ox * obb.ux + oy * obb.uy,
    ox * obb.vx + oy * obb.vy,
    oz,
  ];
  const dirs = [
    dx * obb.ux + dy * obb.uy,
    dx * obb.vx + dy * obb.vy,
    dz,
  ];
  const extents = [obb.halfW, obb.halfD, halfH];

  let tMin = 0.02; // ignore immediate mount surface contact
  let tMax = 0.985; // ignore floor touch at target

  for (let axis = 0; axis < 3; axis++) {
    const o = origins[axis];
    const d = dirs[axis];
    const e = extents[axis];
    if (Math.abs(d) < 1e-7) {
      if (Math.abs(o) > e) return false;
    } else {
      let t1 = (-e - o) / d;
      let t2 = (e - o) / d;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      if (t1 > tMin) tMin = t1;
      if (t2 < tMax) tMax = t2;
      if (tMin > tMax) return false;
    }
  }
  return tMin <= tMax;
}

/** Check if 3D ray from sensor to target crosses an active solid wall (accounting for openings). */
function segmentBlockedByWall(
  sx: number,
  sy: number,
  sz: number,
  tx: number,
  ty: number,
  tz: number,
  activeWalls: any[],
  wallHeightMm: number,
): boolean {
  const rx = tx - sx;
  const ry = ty - sy;
  for (const w of activeWalls) {
    // 2D line intersection between S->T and wall centerline A -> A + u*len
    const wx = w.u.x * w.len;
    const wy = w.u.y * w.len;
    const denom = rx * wy - ry * wx;
    if (Math.abs(denom) < 1e-6) continue;
    const qpx = w.a.x - sx;
    const qpy = w.a.y - sy;
    const tRay = (qpx * wy - qpy * wx) / denom;
    const uWall = (qpx * ry - qpy * rx) / denom;
    if (tRay <= 0.04 || tRay >= 0.98) continue;
    if (uWall < -w.ht || uWall > w.len + w.ht) continue;
    const along = Math.max(0, Math.min(w.len, uWall));
    const hitZ = sz + (tz - sz) * tRay;
    if (hitZ < 0 || hitZ > wallHeightMm) continue;
    // Check if the ray passes cleanly through a door/window opening
    const throughOpening = (w.ops || []).some((op: any) => {
      const sill = op.o?.sill ?? 0;
      const head = op.o?.head ?? 2100;
      return along >= op.s0 && along <= op.s1 && hitZ >= sill && hitZ <= head;
    });
    if (!throughOpening) return true;
  }
  return false;
}

function synthesizeDefaultRadarSensors(
  plan: Plan,
  regions: any[],
): RadarSensorSpec[] {
  const wallHeight = plan.height || 2800;
  const mountZ = Math.min(wallHeight - 200, 2400);
  const validRegions = regions.filter((r: any) => regionAreaMm2(r) >= 3_500_000);
  if (!validRegions.length) {
    if (!plan.nodes.length) return [];
    const minX = Math.min(...plan.nodes.map((n) => n.x));
    const minY = Math.min(...plan.nodes.map((n) => n.y));
    return [
      {
        id: "harmony-radar-auto-1",
        name: "华为鸿蒙 AI 超感跌倒毫米波雷达",
        x: minX + 260,
        y: minY + 260,
        z: mountZ,
        fovDeg: 130,
        maxRangeMm: 6800,
      },
    ];
  }
  return validRegions.map((region: any, idx: number) => {
    const label = region.labels?.[0];
    const roomObj = plan.rooms.find((rm) => rm.id === label?.id);
    const roomName = roomObj?.name || label?.name || `空间${idx + 1}`;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const b of region.rects || []) {
      minX = Math.min(minX, b.x);
      maxX = Math.max(maxX, b.x + b.w);
      minY = Math.min(minY, b.y);
      maxY = Math.max(maxY, b.y + b.h);
    }
    const sx = minX + 260;
    const sy = minY + 260;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const aimDeg = (Math.atan2(cy - sy, cx - sx) * 180) / Math.PI;
    return {
      id: `harmony-radar-${label?.id || idx + 1}`,
      name: `${roomName}·鸿蒙毫米波看护雷达`,
      x: Math.round(sx),
      y: Math.round(sy),
      z: mountZ,
      aimDeg: Math.round(aimDeg),
      fovDeg: 130,
      maxRangeMm: 7000,
      roomId: label?.id,
    };
  });
}

export function resolveSafetyProfile(
  plan: Plan,
  override?: Partial<SafetyProfile>,
): SafetyAuditReport["profile"] {
  const fromPlan: Partial<SafetyProfile> =
    (plan.source as any)?.safetyProfile || {};
  const merged = { ...fromPlan, ...(override || {}) };
  const enabled = Boolean(merged.enabled ?? override !== undefined);
  return {
    enabled,
    elderlyWheelchair: merged.elderlyWheelchair ?? true,
    wheelchairDiameterMm: merged.wheelchairDiameterMm ?? 1500,
    accessibleCorridorMm: merged.accessibleCorridorMm ?? 850,
    seismicIntensity: (merged.seismicIntensity as 6 | 7 | 8) ?? 7,
    radarCheck: merged.radarCheck ?? true,
    minRadarCoverageRatio: merged.minRadarCoverageRatio ?? 0.85,
    radarSensors: Array.isArray(merged.radarSensors) ? merged.radarSensors : [],
  };
}

/**
 * Deterministic 3-pillar home safety & smart-home spatial audit:
 *  1. Elderly accessibility (1500mm wheelchair turning circle, GB 50763 / GB 50096)
 *  2. Seismic non-structural furniture toppling (bed strike & exit blockage, GB 50011)
 *  3. Huawei HarmonyOS mmWave fall-detection radar 3D ray-OBB blind-spot heatmap
 */
export function auditSafety(
  plan: Plan,
  overrideProfile?: Partial<SafetyProfile>,
): SafetyAuditReport {
  const profile = resolveSafetyProfile(plan, overrideProfile);
  const geo = wallGeometry(plan);
  const regions: any[] = detectRegions(plan, geo);
  const obbs = plan.furniture.map((f) => buildObb(plan, f, regions));
  const floorObstacles = obbs.filter(
    (o) => !SOFT_COVERINGS.has(o.f.key) && o.z0 < 950 && o.z1 > 80,
  );

  const issues: SafetyIssue[] = [];
  const wheelchairCircles: WheelchairAuditCircle[] = [];
  const toppleZones: SeismicToppleZone[] = [];
  const citationsMap = new Map<
    string,
    { code: string; standard: string; clause: string; requirement: string }
  >();

  // --- Pillar 1: Wheelchair 1500mm Turning Space Audit ---
  if (profile.enabled && profile.elderlyWheelchair) {
    const reqDiameter = profile.wheelchairDiameterMm;
    const reqRadius = reqDiameter / 2;
    const step = 100;

    for (const region of regions) {
      if (regionAreaMm2(region) < 4_000_000) continue; // skip closets/shafts < 4m²
      const label = region.labels?.[0];
      const roomObj = plan.rooms.find((rm) => rm.id === label?.id);
      const roomName = roomObj?.name || label?.name || "主要活动空间";

      let bestX = 0;
      let bestY = 0;
      let bestClearance = -1;

      for (const rect of region.rects || []) {
        for (
          let px = rect.x + 150;
          px <= rect.x + rect.w - 150;
          px += step
        ) {
          for (
            let py = rect.y + 150;
            py <= rect.y + rect.h - 150;
            py += step
          ) {
            let minClearance = Infinity;
            for (const w of geo.active) {
              const distCenter = pointToSegmentDist2D(
                px,
                py,
                w.a.x,
                w.a.y,
                w.b.x,
                w.b.y,
              );
              const distFace = distCenter - (w.ht || 90);
              if (distFace < minClearance) minClearance = distFace;
              if (minClearance <= bestClearance) break;
            }
            if (minClearance <= bestClearance) continue;

            for (const obs of floorObstacles) {
              const dObs = pointToObbSignedDistance2D(px, py, obs);
              if (dObs < minClearance) minClearance = dObs;
              if (minClearance <= bestClearance) break;
            }
            if (minClearance > bestClearance) {
              bestClearance = minClearance;
              bestX = px;
              bestY = py;
            }
          }
        }
      }

      if (bestClearance < 0) continue;
      const maxDiameterMm = Math.max(0, Math.round(bestClearance * 2));
      const passed = maxDiameterMm >= reqDiameter - 30;
      const blockerIds: string[] = [];
      if (!passed) {
        const candidates = floorObstacles
          .map((obs) => ({
            id: obs.id,
            dist: pointToObbSignedDistance2D(bestX, bestY, obs),
          }))
          .filter((item) => item.dist <= reqRadius + 350)
          .sort((a, b) => a.dist - b.dist);
        for (const c of candidates.slice(0, 4)) blockerIds.push(c.id);
        issues.push({
          code: "WHEELCHAIR_TURNING_BLOCKED",
          objectIds: blockerIds,
          roomId: label?.id,
          message: `${roomName}最大轮椅无障碍回转直径仅 ${maxDiameterMm} mm，不足国标 ${reqDiameter} mm 要求（受阻于周边家具）`,
          level: "error",
          blocking: true,
          metric: maxDiameterMm,
          category: "furniture",
          fixableByFurniture: true,
          owner: "furniture",
          standardRef: "GB 50763-2012 §3.6.2 / GB 50096-2011",
        });
        citationsMap.set("WHEELCHAIR_TURNING_BLOCKED", {
          code: "WHEELCHAIR_TURNING_BLOCKED",
          standard: "GB 50763-2012《无障碍设计规范》& GB 50096-2011《住宅设计规范》",
          clause: "第 3.6.2 / 6.7.2 条",
          requirement: `适老起居室、卧室应保证直径不小于 ${reqDiameter}mm 的轮椅 360° 原地回转净空，主要无障碍通道净宽不小于 ${profile.accessibleCorridorMm}mm。`,
        });
      }

      wheelchairCircles.push({
        roomId: label?.id,
        roomName,
        x: bestX,
        y: bestY,
        maxDiameterMm,
        requiredDiameterMm: reqDiameter,
        passed,
        blockerIds,
      });
    }
  }

  // --- Pillar 2: Seismic Non-Structural Furniture Toppling Audit ---
  if (profile.enabled && profile.seismicIntensity) {
    const minSlenderness =
      profile.seismicIntensity >= 8
        ? 1.9
        : profile.seismicIntensity === 7
          ? 2.2
          : 2.6;

    // Precompute interior doorway escape zones (850mm clear rectangle on room side)
    const doorZones: Array<{ openingId: string; polygon: Point[] }> = [];
    for (const w of geo.active) {
      for (const op of w.ops || []) {
        if (!DOOR_TYPES.has(op.o?.type) || (op.o?.sill ?? 0) > 30) continue;
        for (const side of [-1, 1]) {
          const mid = (op.s0 + op.s1) / 2;
          const probe = {
            x: w.a.x + w.u.x * mid + w.n.x * side * (w.ht + 20),
            y: w.a.y + w.u.y * mid + w.n.y * side * (w.ht + 20),
          };
          const inRoom = regions.some((r: any) =>
            (r.rects || []).some(
              (b: any) =>
                probe.x >= b.x &&
                probe.x <= b.x + b.w &&
                probe.y >= b.y &&
                probe.y <= b.y + b.h,
            ),
          );
          if (!inRoom) continue;
          const polygon = [
            [op.s0, side * w.ht],
            [op.s1, side * w.ht],
            [op.s1, side * (w.ht + 900)],
            [op.s0, side * (w.ht + 900)],
          ].map(([along, normal]) => ({
            x: w.a.x + w.u.x * along + w.n.x * normal,
            y: w.a.y + w.u.y * along + w.n.y * normal,
          }));
          doorZones.push({ openingId: op.o.id, polygon });
        }
      }
    }

    const bedTargets = obbs.filter((o) =>
      /bed|crib|bunk/i.test(`${o.f.key} ${o.f.type}`),
    );

    for (const obb of obbs) {
      const { f } = obb;
      if (SOFT_COVERINGS.has(f.key) || obb.z0 > 300 || f.h < 1400) continue;
      const minBase = Math.max(1, Math.min(f.w, f.d));
      const slenderness = Number((f.h / minBase).toFixed(2));
      if (slenderness < minSlenderness) continue;

      const anchored = Boolean(f.opt?.wallAnchored);
      // Forward topple sweep polygon extending f.h from the front face (+v axis)
      const sweepDepth = f.h;
      const frontLeft = {
        x: obb.cx - obb.ux * obb.halfW + obb.vx * obb.halfD,
        y: obb.cy - obb.uy * obb.halfW + obb.vy * obb.halfD,
      };
      const frontRight = {
        x: obb.cx + obb.ux * obb.halfW + obb.vx * obb.halfD,
        y: obb.cy + obb.uy * obb.halfW + obb.vy * obb.halfD,
      };
      const sweepPoly: Point[] = [
        frontLeft,
        frontRight,
        {
          x: frontRight.x + obb.vx * sweepDepth,
          y: frontRight.y + obb.vy * sweepDepth,
        },
        {
          x: frontLeft.x + obb.vx * sweepDepth,
          y: frontLeft.y + obb.vy * sweepDepth,
        },
      ];

      const hazardCodes: string[] = [];
      const hitObjectIds: string[] = [];

      if (!anchored) {
        for (const bed of bedTargets) {
          if (bed.id === f.id) continue;
          if (convexPolygonsOverlap(sweepPoly, bed.corners, 25)) {
            hazardCodes.push("SEISMIC_TOPPLE_BED_HAZARD");
            hitObjectIds.push(bed.id);
            issues.push({
              code: "SEISMIC_TOPPLE_BED_HAZARD",
              objectIds: [f.id, bed.id],
              message: `${f.name}（高 ${Math.round(f.h)} mm，高宽比 ${slenderness}，未设防震墙体锚固）在 ${profile.seismicIntensity} 度设防地震下倾覆扫掠区直接砸向 ${bed.f.name}`,
              level: "error",
              blocking: true,
              metric: Math.round(f.h),
              category: "furniture",
              fixableByFurniture: true,
              owner: "furniture",
              standardRef: "GB 50011-2010 §13.2 / FEMA E-74",
            });
            citationsMap.set("SEISMIC_TOPPLE_BED_HAZARD", {
              code: "SEISMIC_TOPPLE_BED_HAZARD",
              standard: "GB 50011-2010《建筑抗震设计规范》(2016年版) & FEMA E-74",
              clause: "第 13.2 条 非结构构件抗震构造",
              requirement:
                "高宽比大于 2.2 且高度 ≥ 1.4m 的高大柜体必须与主体墙体可靠拉结锚固，严禁未锚固高柜倾覆半径覆盖卧床睡眠区。",
            });
          }
        }

        for (const dz of doorZones) {
          if (convexPolygonsOverlap(sweepPoly, dz.polygon, 25)) {
            hazardCodes.push("SEISMIC_TOPPLE_EXIT_BLOCKED");
            hitObjectIds.push(dz.openingId);
            issues.push({
              code: "SEISMIC_TOPPLE_EXIT_BLOCKED",
              objectIds: [f.id, dz.openingId],
              message: `${f.name}（高 ${Math.round(f.h)} mm，未锚固）地震倾覆后将封堵逃生门洞内侧生命通道`,
              level: "error",
              blocking: true,
              metric: Math.round(f.h),
              category: "furniture",
              fixableByFurniture: true,
              owner: "furniture",
              standardRef: "GB 50011-2010 §13.2 / GB 55037",
            });
            citationsMap.set("SEISMIC_TOPPLE_EXIT_BLOCKED", {
              code: "SEISMIC_TOPPLE_EXIT_BLOCKED",
              standard: "GB 50011-2010《建筑抗震设计规范》& 应急避险导则",
              clause: "第 13.2 条 疏散口防倾覆要求",
              requirement:
                "户门及卧室门洞内侧逃生通道严禁处于未锚固高大储物柜、书柜的倾覆封堵包络内。",
            });
          }
        }

        if (!hazardCodes.length && f.h >= 1650 && slenderness >= 2.6) {
          hazardCodes.push("SEISMIC_UNANCHORED_CABINET");
          issues.push({
            code: "SEISMIC_UNANCHORED_CABINET",
            objectIds: [f.id],
            message: `${f.name}（高 ${Math.round(f.h)} mm，高宽比 ${slenderness}）建议加装 L 型防震墙锚（wallAnchored）`,
            level: "warning",
            blocking: false,
            metric: slenderness,
            category: "furniture",
            fixableByFurniture: true,
            owner: "furniture",
            standardRef: "GB 50011-2010 §13.2",
          });
        }
      }

      toppleZones.push({
        furnitureId: f.id,
        furnitureName: f.name,
        heightMm: f.h,
        slenderness,
        anchored,
        polygon: sweepPoly,
        hazardCodes,
        hitObjectIds,
      });
    }
  }

  // --- Pillar 3: Huawei HarmonyOS AI mmWave Radar Occlusion Audit ---
  const rawSensors = profile.radarSensors.length
    ? profile.radarSensors
    : synthesizeDefaultRadarSensors(plan, regions);
  const resolvedSensors = rawSensors.map((s) => {
    let aimDeg = s.aimDeg;
    if (aimDeg === undefined) {
      const xs = plan.nodes.map((n) => n.x);
      const ys = plan.nodes.map((n) => n.y);
      const cx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : s.x + 1500;
      const cy = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : s.y + 1500;
      aimDeg = Math.round((Math.atan2(cy - s.y, cx - s.x) * 180) / Math.PI);
    }
    return {
      ...s,
      z: s.z || Math.min((plan.height || 2800) - 200, 2400),
      aimDeg,
      fovDeg: s.fovDeg ?? 130,
      maxRangeMm: s.maxRangeMm ?? 6800,
    };
  });

  const cells: RadarHeatmapCell[] = [];
  const occluderCounts = new Map<string, number>();
  let coveredCells = 0;

  if (profile.enabled && profile.radarCheck && resolvedSensors.length) {
    const cellStep = 250;
    const targetFallZ = 350; // Prone human torso height (350mm above floor)
    const wallHeightMm = plan.height || 2800;
    const radarBlockers = obbs.filter(
      (o) => !SOFT_COVERINGS.has(o.f.key) && o.z1 >= 950,
    );
    const solidFootprints = obbs.filter(
      (o) =>
        !SOFT_COVERINGS.has(o.f.key) &&
        o.z0 < 400 &&
        !/table|desk|chair|stool/i.test(`${o.f.key} ${o.f.type}`),
    );

    const visitedCellKeys = new Set<string>();
    const sampleRects: Array<{ x: number; y: number; w: number; h: number }> = [];
    for (const r of regions) {
      if (regionAreaMm2(r) < 2_500_000) continue;
      for (const rect of r.rects || []) sampleRects.push(rect);
    }

    for (const rect of sampleRects) {
      for (
        let gx = rect.x + cellStep / 2;
        gx <= rect.x + rect.w - cellStep / 2;
        gx += cellStep
      ) {
        for (
          let gy = rect.y + cellStep / 2;
          gy <= rect.y + rect.h - cellStep / 2;
          gy += cellStep
        ) {
          const cellKey = `${Math.round(gx / 50)}:${Math.round(gy / 50)}`;
          if (visitedCellKeys.has(cellKey)) continue;
          visitedCellKeys.add(cellKey);

          // Skip cells occupied by solid beds/cabinets/sofas where a person cannot stand/fall on the floor
          const insideSolid = solidFootprints.some(
            (obs) => pointToObbSignedDistance2D(gx, gy, obs) < -20,
          );
          if (insideSolid) continue;

          let cellCovered = false;
          let primaryOccluder: string | undefined;

          for (const sensor of resolvedSensors) {
            const dx = gx - sensor.x;
            const dy = gy - sensor.y;
            const horizDist = Math.hypot(dx, dy);
            if (horizDist > sensor.maxRangeMm) continue;

            if (horizDist > 120 && sensor.fovDeg < 355) {
              const rayDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
              let delta = ((rayDeg - sensor.aimDeg + 540) % 360) - 180;
              if (Math.abs(delta) > sensor.fovDeg / 2) continue;
            }

            if (
              segmentBlockedByWall(
                sensor.x,
                sensor.y,
                sensor.z,
                gx,
                gy,
                targetFallZ,
                geo.active,
                wallHeightMm,
              )
            ) {
              continue;
            }

            let hitBlockerId: string | undefined;
            for (const blocker of radarBlockers) {
              if (
                segmentIntersectsObb3D(
                  sensor.x,
                  sensor.y,
                  sensor.z,
                  gx,
                  gy,
                  targetFallZ,
                  blocker,
                )
              ) {
                hitBlockerId = blocker.id;
                break;
              }
            }

            if (!hitBlockerId) {
              cellCovered = true;
              primaryOccluder = undefined;
              break;
            } else if (!primaryOccluder) {
              primaryOccluder = hitBlockerId;
            }
          }

          if (cellCovered) {
            coveredCells++;
          } else if (primaryOccluder) {
            occluderCounts.set(
              primaryOccluder,
              (occluderCounts.get(primaryOccluder) || 0) + 1,
            );
          }

          cells.push({
            x: Math.round(gx),
            y: Math.round(gy),
            size: cellStep,
            covered: cellCovered,
            ...(primaryOccluder ? { occluderId: primaryOccluder } : {}),
          });
        }
      }
    }
  }

  const totalOpenCells = cells.length;
  const coverageRatio =
    totalOpenCells > 0
      ? Number((coveredCells / totalOpenCells).toFixed(4))
      : 1;
  const blindRatio = Number((1 - coverageRatio).toFixed(4));
  const topOccluderIds = [...occluderCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([id]) => id);

  if (
    profile.enabled &&
    profile.radarCheck &&
    totalOpenCells >= 8 &&
    coverageRatio < profile.minRadarCoverageRatio
  ) {
    const occluderNames = topOccluderIds
      .map((id) => plan.furniture.find((f) => f.id === id)?.name || id)
      .join("、");
    issues.push({
      code: "SENSOR_BLIND_SPOT",
      objectIds: topOccluderIds,
      message: `华为鸿蒙毫米波跌倒看护雷达地面覆盖率仅 ${(coverageRatio * 100).toFixed(1)}%（低于 ${(profile.minRadarCoverageRatio * 100).toFixed(0)}% 安全阈值）${occluderNames ? `，主要受 ${occluderNames} 遮挡产生地面监护盲区` : ""}`,
      level: "error",
      blocking: true,
      metric: Number((coverageRatio * 100).toFixed(1)),
      category: "furniture",
      fixableByFurniture: topOccluderIds.length > 0,
      owner: "furniture",
      standardRef: "HarmonyOS Smart Care AI Sensor Spec v2.4",
    });
    citationsMap.set("SENSOR_BLIND_SPOT", {
      code: "SENSOR_BLIND_SPOT",
      standard: "华为鸿蒙智家 AI 辅助康养传感器安装勘测标准 v2.4",
      clause: "第 4.1 节 60GHz 毫米波视距遮挡规范",
      requirement: `顶角/吸顶雷达对地面 0.35m 跌倒监测面的无遮挡覆盖率应 ≥ ${(profile.minRadarCoverageRatio * 100).toFixed(0)}%，高大衣柜、冰箱不应置于传感器主视锥与床侧通道之间。`,
    });
  }

  return {
    enabled: profile.enabled,
    profile: {
      ...profile,
      radarSensors: resolvedSensors,
    },
    issues,
    wheelchairCircles,
    toppleZones,
    radar: {
      sensors: resolvedSensors,
      coverageRatio,
      blindRatio,
      totalOpenCells,
      coveredCells,
      blindCells: totalOpenCells - coveredCells,
      topOccluderIds,
      cells,
    },
    standardCitations: [...citationsMap.values()],
  };
}
