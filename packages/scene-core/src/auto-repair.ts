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
  semanticPenaltyBefore?: number;
  semanticPenaltyAfter?: number;
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

type FurnitureRole =
  | "sofa"
  | "armchair"
  | "coffeeTable"
  | "tvCabinet"
  | "diningTable"
  | "diningChair"
  | "bed"
  | "nightstand"
  | "wardrobe"
  | "wallCabinet"
  | "desk"
  | "officeChair"
  | "decorCorner"
  | "other";

function furnitureRole(f: Furniture): FurnitureRole {
  const k = `${f.key || ""} ${f.type || ""} ${f.name || ""}`.toLowerCase();
  if (/tvcab|cabtv|tvstand|mediaconsole|电视柜/.test(k)) return "tvCabinet";
  if (/coffeetable|roundcoffee|ovalcoffee|nesttables|teatable|茶几|茶台/.test(k))
    return "coffeeTable";
  if (/diningtable|roundtable|餐桌/.test(k)) return "diningTable";
  if (/officechair|deskchair|办公椅|电脑椅/.test(k)) return "officeChair";
  if (/armchair|lounge|recliner|accentchair|单人沙发|休闲椅/.test(k))
    return "armchair";
  if (/sofa|loveseat|sectional|couch|沙发/.test(k)) return "sofa";
  if (/nightstand|bedside|床头柜/.test(k)) return "nightstand";
  if (/bed|luohan|床/.test(k)) return "bed";
  if (/wardrobe|cabslide|cabwardrobe|衣柜/.test(k)) return "wardrobe";
  if (/desk|书桌|写字台|办公桌/.test(k)) return "desk";
  if (/chair|stool|餐椅|椅|凳/.test(k)) return "diningChair";
  if (/lamp|plant|pouf|ottoman|灯|绿植|盆栽/.test(k)) return "decorCorner";
  if (/cabinet|cabtall|cabbase|book|shelf|sideboard|display|file|wine|shoe|hall|fridge|freezer|dresser|console|piano|柜|书架|冰箱/.test(k))
    return "wallCabinet";
  return "other";
}

function facingVec(rot: number): { dx: number; dy: number } {
  const r = normalizeRot(rot);
  if (r === 0) return { dx: 0, dy: 1 }; // south (+Y)
  if (r === 180) return { dx: 0, dy: -1 }; // north (-Y)
  if (r === 90) return { dx: -1, dy: 0 }; // west (-X)
  return { dx: 1, dy: 0 }; // 270 -> east (+X)
}

function windowZones(plan: Plan, geo: ReturnType<typeof wallGeometry>): Aabb[] {
  const zones: Aabb[] = [];
  for (const o of plan.openings || []) {
    if (!/window|bay/i.test(String(o.type || ""))) continue;
    const w: any =
      geo.active.find(
        (g: any) =>
          g.w.id === o.wall || g.ops.some((op: any) => op.o.id === o.id),
      ) || geo.walls.get(o.wall);
    if (!w) continue;
    const cx = w.a.x + w.u.x * o.pos;
    const cy = w.a.y + w.u.y * o.pos;
    const half = Math.max(500, ((o as any).width || (o as any).w || 1400) / 2);
    const depth = (w.t || w.w?.t || 200) / 2 + 260;
    const horiz = Math.abs(w.u.x) >= Math.abs(w.u.y);
    zones.push(
      horiz
        ? { x0: cx - half, y0: cy - depth, x1: cx + half, y1: cy + depth }
        : { x0: cx - depth, y0: cy - half, x1: cx + depth, y1: cy + half },
    );
  }
  return zones;
}

function backWallDistance(f: Furniture, region: RoomRegionInfo | undefined): number {
  if (!region) return 0;
  const rects = region.rects.length ? region.rects : [region.bb];
  const box = rotatedAabb(f);
  const r = normalizeRot(f.rot);
  let best = Infinity;
  for (const rect of rects) {
    const innerX0 = rect.x + 100;
    const innerX1 = rect.x + rect.w - 100;
    const innerY0 = rect.y + 100;
    const innerY1 = rect.y + rect.h - 100;
    if (r === 0) best = Math.min(best, Math.abs(box.y0 - innerY0));
    else if (r === 180) best = Math.min(best, Math.abs(innerY1 - box.y1));
    else if (r === 270) best = Math.min(best, Math.abs(box.x0 - innerX0));
    else best = Math.min(best, Math.abs(innerX1 - box.x1));
  }
  return Number.isFinite(best) ? best : 0;
}

function frontWallDistance(f: Furniture, region: RoomRegionInfo | undefined): number {
  if (!region) return 2000;
  const rects = region.rects.length ? region.rects : [region.bb];
  const box = rotatedAabb(f);
  const r = normalizeRot(f.rot);
  let best = Infinity;
  for (const rect of rects) {
    if (
      f.x < rect.x - 100 ||
      f.x > rect.x + rect.w + 100 ||
      f.y < rect.y - 100 ||
      f.y > rect.y + rect.h + 100
    ) {
      continue;
    }
    const innerX0 = rect.x + 100;
    const innerX1 = rect.x + rect.w - 100;
    const innerY0 = rect.y + 100;
    const innerY1 = rect.y + rect.h - 100;
    if (r === 0) best = Math.min(best, innerY1 - box.y1);
    else if (r === 180) best = Math.min(best, box.y0 - innerY0);
    else if (r === 270) best = Math.min(best, innerX1 - box.x1);
    else best = Math.min(best, box.x0 - innerX0);
  }
  return Number.isFinite(best) ? best : 2000;
}

function minWallDistance(f: Furniture, region: RoomRegionInfo | undefined): number {
  if (!region) return 0;
  const rects = region.rects.length ? region.rects : [region.bb];
  const box = rotatedAabb(f);
  let best = Infinity;
  for (const rect of rects) {
    best = Math.min(
      best,
      Math.abs(box.y0 - (rect.y + 100)),
      Math.abs(rect.y + rect.h - 100 - box.y1),
      Math.abs(box.x0 - (rect.x + 100)),
      Math.abs(rect.x + rect.w - 100 - box.x1),
    );
  }
  return Number.isFinite(best) ? best : 0;
}

function boxEdgeGap(a: Aabb, b: Aabb): number {
  const dx = Math.max(0, Math.max(a.x0 - b.x1, b.x0 - a.x1));
  const dy = Math.max(0, Math.max(a.y0 - b.y1, b.y0 - a.y1));
  return Math.hypot(dx, dy);
}

function inTvSofaCorridor(
  box: Aabb,
  tv: Furniture | undefined,
  sofa: Furniture | undefined,
): boolean {
  if (!tv || !sofa) return false;
  const tvb = rotatedAabb(tv);
  const sfb = rotatedAabb(sofa);
  const corr: Aabb = {
    x0: Math.min(tvb.x0, sfb.x0) + 120,
    x1: Math.max(tvb.x1, sfb.x1) - 120,
    y0: Math.min(tvb.y0, sfb.y0) + 120,
    y1: Math.max(tvb.y1, sfb.y1) - 120,
  };
  if (corr.x1 <= corr.x0 || corr.y1 <= corr.y0) return false;
  return boxesOverlap2d(box, corr, -40);
}

interface ChairCluster {
  chairs: Furniture[];
  bboxCx: number;
  bboxCy: number;
  rayCx: number;
  rayCy: number;
  preferredRots: number[];
}

function findOrphanedChairClusters(
  plan: Plan,
  selfTableId: string,
  region: RoomRegionInfo | undefined,
  tableRef?: Furniture,
): ChairCluster[] {
  const peers = plan.furniture.filter(
    (o) =>
      o.id !== selfTableId &&
      !DECOR_COVERINGS.has(o.key) &&
      !isSurfaceItem(o) &&
      (!region || pointInRects(o.x, o.y, region.rects, -120)),
  );
  const otherTables = peers.filter(
    (p) => furnitureRole(p) === "diningTable" || p.type === "teaTable",
  );
  const allChairs = peers.filter((p) => furnitureRole(p) === "diningChair");
  if (!allChairs.length) return [];

  // A chair is already served if another dining table sits right in front of it
  const orphaned = allChairs.filter((ch) => {
    const chBox = rotatedAabb(ch);
    const chFwd = facingVec(ch.rot);
    for (const t of otherTables) {
      const tb = rotatedAabb(t);
      const gap = boxEdgeGap(chBox, tb);
      if (gap > 520) continue;
      const vx = t.x - ch.x;
      const vy = t.y - ch.y;
      const len = Math.max(1, Math.hypot(vx, vy));
      const dot = (vx * chFwd.dx + vy * chFwd.dy) / len;
      if (dot > 0.35) return false;
    }
    return true;
  });
  if (!orphaned.length) return [];

  // Connected-components clustering within 2500mm
  const visited = new Set<string>();
  const clusters: ChairCluster[] = [];
  const tblHalfW = (tableRef?.w || 1400) / 2;
  const tblHalfD = (tableRef?.d || 900) / 2;
  for (const seed of orphaned) {
    if (visited.has(seed.id)) continue;
    const comp: Furniture[] = [];
    const queue: Furniture[] = [seed];
    visited.add(seed.id);
    while (queue.length) {
      const cur = queue.shift()!;
      comp.push(cur);
      for (const nxt of orphaned) {
        if (visited.has(nxt.id)) continue;
        if (Math.hypot(nxt.x - cur.x, nxt.y - cur.y) <= 2500) {
          visited.add(nxt.id);
          queue.push(nxt);
        }
      }
    }
    const xs = comp.map((c) => c.x);
    const ys = comp.map((c) => c.y);
    const bboxCx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const bboxCy = (Math.min(...ys) + Math.max(...ys)) / 2;
    let rx = 0;
    let ry = 0;
    let nsCount = 0;
    let ewCount = 0;
    for (const c of comp) {
      const fv = facingVec(c.rot);
      const isNS = fv.dy !== 0;
      if (isNS) nsCount++;
      else ewCount++;
      const halfSpan = isNS ? tblHalfD : tblHalfW;
      const pushDist = (c.d || 520) / 2 + halfSpan + 140;
      rx += c.x + fv.dx * pushDist;
      ry += c.y + fv.dy * pushDist;
    }
    rx /= comp.length;
    ry /= comp.length;
    const preferredRots =
      nsCount >= ewCount ? [0, 90] : [90, 0];
    clusters.push({
      chairs: comp,
      bboxCx,
      bboxCy,
      rayCx: rx,
      rayCy: ry,
      preferredRots,
    });
  }
  return clusters.sort((a, b) => b.chairs.length - a.chairs.length);
}

function findOrphanedNightstands(
  plan: Plan,
  selfBedId: string,
  region: RoomRegionInfo | undefined,
): Furniture[] {
  const peers = plan.furniture.filter(
    (o) =>
      o.id !== selfBedId &&
      !DECOR_COVERINGS.has(o.key) &&
      !isSurfaceItem(o) &&
      (!region || pointInRects(o.x, o.y, region.rects, -120)),
  );
  const otherBeds = peers.filter((p) => furnitureRole(p) === "bed");
  return peers.filter((p) => {
    if (furnitureRole(p) !== "nightstand") return false;
    const nb = rotatedAabb(p);
    return !otherBeds.some((b) => boxEdgeGap(nb, rotatedAabb(b)) <= 450);
  });
}

function findOrphanedOfficeChairs(
  plan: Plan,
  selfDeskId: string,
  region: RoomRegionInfo | undefined,
): Furniture[] {
  const peers = plan.furniture.filter(
    (o) =>
      o.id !== selfDeskId &&
      !DECOR_COVERINGS.has(o.key) &&
      !isSurfaceItem(o) &&
      (!region || pointInRects(o.x, o.y, region.rects, -120)),
  );
  const otherDesks = peers.filter((p) => furnitureRole(p) === "desk");
  return peers.filter((p) => {
    if (furnitureRole(p) !== "officeChair") return false;
    const cb = rotatedAabb(p);
    return !otherDesks.some((d) => boxEdgeGap(cb, rotatedAabb(d)) <= 450);
  });
}

function itemSemanticPenalty(
  plan: Plan,
  f: Furniture,
  region: RoomRegionInfo | undefined,
  winZones: Aabb[],
): number {
  if (DECOR_COVERINGS.has(f.key) || isSurfaceItem(f)) return 0;
  const role = furnitureRole(f);
  const box = rotatedAabb(f);
  const peers = plan.furniture.filter(
    (o) =>
      o.id !== f.id &&
      !DECOR_COVERINGS.has(o.key) &&
      !isSurfaceItem(o) &&
      (!region || pointInRects(o.x, o.y, region.rects, -120)),
  );
  const byRole = (r: FurnitureRole) => peers.filter((p) => furnitureRole(p) === r);
  const nearest = (list: Furniture[]) => {
    let best: Furniture | undefined;
    let bestD = Infinity;
    for (const item of list) {
      const d = Math.hypot(item.x - f.x, item.y - f.y);
      if (d < bestD) {
        bestD = d;
        best = item;
      }
    }
    return best;
  };

  let pen = 0;
  const fwd = facingVec(f.rot);
  const tv = nearest(byRole("tvCabinet"));
  const ct = nearest(byRole("coffeeTable"));
  const sofa = nearest(byRole("sofa"));
  const dTable = nearest(byRole("diningTable"));
  const bed = nearest(byRole("bed"));
  const desk = nearest(byRole("desk"));

  if (role === "sofa") {
    if (tv) {
      const tvFwd = facingVec(tv.rot);
      const vx = f.x - tv.x;
      const vy = f.y - tv.y;
      const inFront = vx * tvFwd.dx + vy * tvFwd.dy;
      const lat = Math.abs(vx * -tvFwd.dy + vy * tvFwd.dx);
      const faceDot = fwd.dx * -tvFwd.dx + fwd.dy * -tvFwd.dy;
      if (inFront < 900) pen += 2800;
      else if (inFront < 1800) pen += (1800 - inFront) * 0.8;
      else if (inFront > 4200) pen += (inFront - 4200) * 0.7;
      if (faceDot < 0.5) pen += 2600;
      if (lat > 700) pen += Math.min(2200, (lat - 700) * 0.9);
      if (ct) {
        const ctInFront = (ct.x - tv.x) * tvFwd.dx + (ct.y - tv.y) * tvFwd.dy;
        if (inFront < ctInFront + 150) pen += 3200;
      }
    }
    if (ct) {
      const ctb = rotatedAabb(ct);
      const cx = ct.x - f.x;
      const cy = ct.y - f.y;
      const proj = cx * fwd.dx + cy * fwd.dy;
      const lat = Math.abs(cx * -fwd.dy + cy * fwd.dx);
      const fHalf = fwd.dx !== 0 ? (box.x1 - box.x0) / 2 : (box.y1 - box.y0) / 2;
      const cHalf = fwd.dx !== 0 ? (ctb.x1 - ctb.x0) / 2 : (ctb.y1 - ctb.y0) / 2;
      const gap = proj - fHalf - cHalf;
      if (proj <= 0) pen += 2400;
      else if (gap < 250 || gap > 950) pen += Math.min(2200, Math.abs(gap - 500) * 1.2);
      if (lat > 550) pen += Math.min(2000, (lat - 550) * 1.0);
    }
    if (dTable && (ct || tv)) {
      const dDist = Math.hypot(f.x - dTable.x, f.y - dTable.y);
      if (dDist < 1500) pen += 2200;
    }
    if (!tv && !ct) {
      const bd = backWallDistance(f, region);
      if (bd > 350) pen += 700;
    }
    const frontD = frontWallDistance(f, region);
    if (frontD < 700) pen += 2200;
  } else if (role === "coffeeTable") {
    if (sofa) {
      const sFwd = facingVec(sofa.rot);
      const sfb = rotatedAabb(sofa);
      const cx = f.x - sofa.x;
      const cy = f.y - sofa.y;
      const proj = cx * sFwd.dx + cy * sFwd.dy;
      const lat = Math.abs(cx * -sFwd.dy + cy * sFwd.dx);
      const sHalf = sFwd.dx !== 0 ? (sfb.x1 - sfb.x0) / 2 : (sfb.y1 - sfb.y0) / 2;
      const cHalf = sFwd.dx !== 0 ? (box.x1 - box.x0) / 2 : (box.y1 - box.y0) / 2;
      const gap = proj - sHalf - cHalf;
      if (proj <= 0) pen += 2400;
      else if (gap < 250 || gap > 900) pen += Math.min(2000, Math.abs(gap - 500) * 1.2);
      if (lat > 500) pen += Math.min(1800, (lat - 500) * 1.0);
      if (f.w > f.d * 1.2 && sofa.w > sofa.d * 1.2) {
        const sameAxis = (normalizeRot(f.rot) % 180) === (normalizeRot(sofa.rot) % 180);
        if (!sameAxis) pen += 700;
      }
    }
  } else if (role === "tvCabinet") {
    const bd = backWallDistance(f, region);
    const fd = frontWallDistance(f, region);
    if (bd > 200) pen += 2600 + Math.min(1000, bd);
    if (fd < 900) pen += 3000;
    if (sofa) {
      const vx = sofa.x - f.x;
      const vy = sofa.y - f.y;
      const inFront = vx * fwd.dx + vy * fwd.dy;
      const lat = Math.abs(vx * -fwd.dy + vy * fwd.dx);
      if (inFront < 1000) pen += 2400;
      if (lat > 700) pen += Math.min(1800, (lat - 700) * 0.8);
    }
  } else if (role === "diningTable") {
    const orphanedClusters = findOrphanedChairClusters(plan, f.id, region, f);
    if (orphanedClusters.length > 0) {
      // Strongly attract diningTable back into the exact center of its orphaned chair ring!
      let bestDist = Infinity;
      for (const cl of orphanedClusters) {
        const targetX = cl.chairs.length >= 2 ? cl.bboxCx : cl.rayCx;
        const targetY = cl.chairs.length >= 2 ? cl.bboxCy : cl.rayCy;
        const dBbox = Math.hypot(f.x - targetX, f.y - targetY);
        const dRay = Math.hypot(f.x - cl.rayCx, f.y - cl.rayCy);
        bestDist = Math.min(bestDist, dBbox, dRay);
      }
      if (bestDist > 220) {
        pen += 3600 + Math.min(6000, (bestDist - 220) * 2.2);
      }
    }
    // Multi-table symmetry alignment: when peer dining tables form a neat row or column, stay aligned!
    const peerTables = byRole("diningTable");
    if (peerTables.length >= 2) {
      const sameRow =
        Math.max(...peerTables.map((t) => t.y)) - Math.min(...peerTables.map((t) => t.y)) <= 120;
      const sameCol =
        Math.max(...peerTables.map((t) => t.x)) - Math.min(...peerTables.map((t) => t.x)) <= 120;
      if (sameRow) {
        const rowY = peerTables.reduce((s, t) => s + t.y, 0) / peerTables.length;
        const dy = Math.abs(f.y - rowY);
        if (dy > 250) pen += Math.min(1800, dy * 0.7);
      } else if (sameCol) {
        const colX = peerTables.reduce((s, t) => s + t.x, 0) / peerTables.length;
        const dx = Math.abs(f.x - colX);
        if (dx > 250) pen += Math.min(1800, dx * 0.7);
      }
    }
    // Dining tables need walk/seating clearance around them; penalize shoving against walls or cabinets
    if (region && region.bb.w >= 3200 && region.bb.h >= 3200) {
      const wd = minWallDistance(f, region);
      if (wd < 650) pen += 1100;
    }
    for (const cab of peers.filter((p) => furnitureRole(p) === "wallCabinet" || furnitureRole(p) === "wardrobe")) {
      if (boxEdgeGap(box, rotatedAabb(cab)) < 450) pen += 950;
    }
    if (inTvSofaCorridor(box, tv, sofa)) pen += 2200;
  } else if (role === "diningChair") {
    const rName = String(region?.roomName || "");
    if (/卧|床|卫|浴|厕|厨|阳|bedroom|bath|kitchen|balcony/i.test(rName)) {
      pen += 40000;
    }
    if (dTable) {
      const dtb = rotatedAabb(dTable);
      const gap = boxEdgeGap(box, dtb);
      const vx = dTable.x - f.x;
      const vy = dTable.y - f.y;
      const len = Math.max(1, Math.hypot(vx, vy));
      const dot = (vx * fwd.dx + vy * fwd.dy) / len;
      const seatedOthers = peers.filter(
        (p) =>
          furnitureRole(p) === "diningChair" &&
          boxEdgeGap(rotatedAabb(p), dtb) <= 450,
      ).length;
      const wallStaged =
        seatedOthers >= 4 &&
        backWallDistance(f, region) <= 260 &&
        frontWallDistance(f, region) >= 500;
      if (!wallStaged) {
        if (gap > 380) pen += 1200 + Math.min(2000, (gap - 380) * 1.2);
        if (dot < 0.45) pen += 1800;
      } else {
        pen += 350 + Math.min(450, gap * 0.15);
      }
    }
  } else if (role === "wardrobe" || role === "wallCabinet") {
    const bd = backWallDistance(f, region);
    const fd = frontWallDistance(f, region);
    if (bd > 200) pen += 2600 + Math.min(1500, bd);
    if (fd < 600) pen += 3200;
    if (f.h >= 1100) {
      for (const wz of winZones) {
        if (boxesOverlap2d(box, wz, 0)) pen += 1500;
      }
    }
    if (inTvSofaCorridor(box, tv, sofa)) pen += 2000;
  } else if (role === "bed") {
    const bd = backWallDistance(f, region);
    const fd = frontWallDistance(f, region);
    if (bd > 200) pen += 3000 + Math.min(1200, bd);
    if (fd < 600) pen += 2500;
    const orphanNs = findOrphanedNightstands(plan, f.id, region);
    for (const ns of orphanNs) {
      const gap = boxEdgeGap(box, rotatedAabb(ns));
      if (gap > 450) pen += 1800 + Math.min(2000, gap * 0.8);
      if (normalizeRot(f.rot) !== normalizeRot(ns.rot)) pen += 900;
    }
  } else if (role === "nightstand") {
    const bd = backWallDistance(f, region);
    if (bd > 250) pen += 1400;
    if (bed) {
      const gap = boxEdgeGap(box, rotatedAabb(bed));
      if (gap > 350) pen += 1800 + Math.min(1800, gap);
      if (normalizeRot(f.rot) !== normalizeRot(bed.rot)) pen += 900;
    }
  } else if (role === "desk") {
    const bd = backWallDistance(f, region);
    const fd = frontWallDistance(f, region);
    if (bd > 250) pen += 1200;
    if (fd < 600) pen += 2000;
    const orphanCh = findOrphanedOfficeChairs(plan, f.id, region);
    for (const ch of orphanCh) {
      const gap = boxEdgeGap(box, rotatedAabb(ch));
      if (gap > 450) pen += 1800 + Math.min(2000, gap * 0.9);
    }
  } else if (role === "officeChair") {
    if (desk) {
      const gap = boxEdgeGap(box, rotatedAabb(desk));
      const vx = desk.x - f.x;
      const vy = desk.y - f.y;
      const len = Math.max(1, Math.hypot(vx, vy));
      const dot = (vx * fwd.dx + vy * fwd.dy) / len;
      if (gap > 420) pen += 1400 + Math.min(1500, gap);
      if (dot < 0.45) pen += 1600;
    }
  } else if (role === "decorCorner") {
    const wd = minWallDistance(f, region);
    const nearLiving =
      (sofa && boxEdgeGap(box, rotatedAabb(sofa)) <= 450) ||
      (tv && boxEdgeGap(box, rotatedAabb(tv)) <= 450);
    if (wd > 450 && !nearLiving) pen += 900;
    if (inTvSofaCorridor(box, tv, sofa)) pen += 2000;
  }
  return Math.round(pen);
}

function planSemanticPenalty(
  plan: Plan,
  regions: RoomRegionInfo[],
  winZones: Aabb[],
  roomFurnitureIds?: Set<string>,
): number {
  let total = 0;
  for (const f of plan.furniture) {
    if (roomFurnitureIds && !roomFurnitureIds.has(f.id)) continue;
    const reg = regionForFurniture(f, regions);
    total += itemSemanticPenalty(plan, f, reg, winZones);
  }
  return Math.round(total);
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
  roomName?: string;
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
    roomName: r.labels?.[0]?.name || r.key || "",
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
  semanticPenalty: number;
  displacement: number;
}

function evaluatePlan(
  plan: Plan,
  originals: Map<string, Furniture>,
  includeSafety: boolean,
  roomId: string | undefined,
  roomFurnitureIds: Set<string>,
  targetIds?: Set<string>,
  regions: RoomRegionInfo[] = [],
  winZones: Aabb[] = [],
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
  const semPen = regions.length
    ? planSemanticPenalty(plan, regions, winZones, roomFurnitureIds.size ? roomFurnitureIds : undefined)
    : 0;
  return {
    score: {
      scopedCount: scopedIssues.length,
      globalCount: allFixable.length,
      metricSum: Math.round(metricSum),
      semanticPenalty: semPen,
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
  if (Math.abs(a.semanticPenalty - b.semanticPenalty) > 80) {
    return a.semanticPenalty < b.semanticPenalty;
  }
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
  bucket?: "semantic" | "local" | "wall" | "grid";
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
  winZones: Aabb[] = [],
): Pose[] {
  const raw: Pose[] = [];
  const seen = new Set<string>();
  const baseRot = normalizeRot(f.rot);
  const push = (
    x: number,
    y: number,
    rot: number,
    bucket: "semantic" | "local" | "wall" | "grid" = "local",
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

  // 3. Semantic interior-design anchor poses
  const role = furnitureRole(f);
  const roomPeers = plan.furniture.filter(
    (p) =>
      p.id !== f.id &&
      !DECOR_COVERINGS.has(p.key) &&
      !isSurfaceItem(p) &&
      (!region || pointInRects(p.x, p.y, region.rects, -120)),
  );
  if (role === "sofa") {
    const tvs = roomPeers.filter((p) => furnitureRole(p) === "tvCabinet");
    const cts = roomPeers.filter((p) => furnitureRole(p) === "coffeeTable");
    for (const ct of cts) {
      const ctb = rotatedAabb(ct);
      const tv = tvs[0];
      const dirs: Array<{ dx: number; dy: number; rot: number; alignX?: number; alignY?: number }> = tv
        ? (() => {
            const tvFwd = facingVec(tv.rot);
            return [
              {
                dx: tvFwd.dx,
                dy: tvFwd.dy,
                rot: normalizeRot(tv.rot + 180),
                alignX: tv.x,
                alignY: tv.y,
              },
            ];
          })()
        : [
            { dx: 0, dy: 1, rot: 180 },
            { dx: 0, dy: -1, rot: 0 },
            { dx: 1, dy: 0, rot: 90 },
            { dx: -1, dy: 0, rot: 270 },
          ];
      for (const dir of dirs) {
        const sb = rotatedAabb({ ...f, x: 0, y: 0, rot: dir.rot });
        const sfHalf = dir.dx !== 0 ? (sb.x1 - sb.x0) / 2 : (sb.y1 - sb.y0) / 2;
        const ctEdge =
          dir.dy > 0
            ? ctb.y1
            : dir.dy < 0
              ? ctb.y0
              : dir.dx > 0
                ? ctb.x1
                : ctb.x0;
        const latCenters = new Set<number>();
        if (dir.dy !== 0) {
          latCenters.add(ct.x);
          if (dir.alignX !== undefined) {
            latCenters.add(dir.alignX);
            latCenters.add((ct.x + dir.alignX) / 2);
          }
          for (const shift of [-400, -200, 200, 400]) latCenters.add(ct.x + shift);
        } else {
          latCenters.add(ct.y);
          if (dir.alignY !== undefined) {
            latCenters.add(dir.alignY);
            latCenters.add((ct.y + dir.alignY) / 2);
          }
          for (const shift of [-400, -200, 200, 400]) latCenters.add(ct.y + shift);
        }
        const depths: number[] = [];
        for (const gap of [450, 550, 650, 800]) {
          depths.push(ctEdge + (dir.dx + dir.dy) * (gap + sfHalf));
        }
        if (region) {
          const wallFace =
            dir.dy > 0
              ? region.bb.y + region.bb.h - 135 - sfHalf
              : dir.dy < 0
                ? region.bb.y + 135 + sfHalf
                : dir.dx > 0
                  ? region.bb.x + region.bb.w - 135 - sfHalf
                  : region.bb.x + 135 + sfHalf;
          depths.push(wallFace);
        }
        for (const dPos of depths) {
          for (const lPos of latCenters) {
            push(
              dir.dy !== 0 ? lPos : dPos,
              dir.dy !== 0 ? dPos : lPos,
              dir.rot,
              "semantic",
            );
          }
        }
      }
    }
    if (cts.length === 0 && tvs.length > 0) {
      for (const tv of tvs) {
        const tvFwd = facingVec(tv.rot);
        const sRot = normalizeRot(tv.rot + 180);
        for (const dist of [2200, 2600, 3000, 3400]) {
          for (const shift of [0, -300, 300]) {
            push(
              tv.x + tvFwd.dx * dist + -tvFwd.dy * shift,
              tv.y + tvFwd.dy * dist + tvFwd.dx * shift,
              sRot,
              "semantic",
            );
          }
        }
      }
    }
  } else if (role === "coffeeTable") {
    for (const s of roomPeers.filter((p) => furnitureRole(p) === "sofa")) {
      const sFwd = facingVec(s.rot);
      const sfb = rotatedAabb(s);
      const sRot = normalizeRot(s.rot);
      const cRot = sRot % 180;
      const cb = rotatedAabb({ ...f, x: 0, y: 0, rot: cRot });
      const cHalf = sFwd.dx !== 0 ? (cb.x1 - cb.x0) / 2 : (cb.y1 - cb.y0) / 2;
      const sEdge =
        sFwd.dy > 0 ? sfb.y1 : sFwd.dy < 0 ? sfb.y0 : sFwd.dx > 0 ? sfb.x1 : sfb.x0;
      for (const gap of [420, 520, 620]) {
        const dPos = sEdge + (sFwd.dx + sFwd.dy) * (gap + cHalf);
        for (const shift of [0, -200, 200]) {
          push(
            sFwd.dy !== 0 ? s.x + shift : dPos,
            sFwd.dy !== 0 ? dPos : s.y + shift,
            cRot,
            "semantic",
          );
        }
      }
    }
  } else if (role === "tvCabinet" && region) {
    for (const s of roomPeers.filter((p) => furnitureRole(p) === "sofa")) {
      const sFwd = facingVec(s.rot);
      const tvRot = normalizeRot(s.rot + 180);
      const tb = rotatedAabb({ ...f, x: 0, y: 0, rot: tvRot });
      const tHalf = sFwd.dx !== 0 ? (tb.x1 - tb.x0) / 2 : (tb.y1 - tb.y0) / 2;
      const wallPos =
        sFwd.dy < 0
          ? region.bb.y + 135 + tHalf
          : sFwd.dy > 0
            ? region.bb.y + region.bb.h - 135 - tHalf
            : sFwd.dx < 0
              ? region.bb.x + 135 + tHalf
              : region.bb.x + region.bb.w - 135 - tHalf;
      for (const shift of [0, -300, 300, -600, 600]) {
        push(
          sFwd.dy !== 0 ? s.x + shift : wallPos,
          sFwd.dy !== 0 ? wallPos : s.y + shift,
          tvRot,
          "semantic",
        );
      }
    }
  } else if (role === "diningTable") {
    // 1. Orphaned dining chair clusters -> exact centroid & ray-projected center!
    const clusters = findOrphanedChairClusters(plan, f.id, region, f);
    for (const cl of clusters) {
      const anchors: Array<[number, number]> = [
        [cl.bboxCx, cl.bboxCy],
        [cl.rayCx, cl.rayCy],
      ];
      for (const [ax, ay] of anchors) {
        for (const r of cl.preferredRots) {
          push(ax, ay, r, "semantic");
          for (const [dx, dy] of [
            [50, 0],
            [-50, 0],
            [0, 50],
            [0, -50],
            [100, 0],
            [-100, 0],
            [0, 100],
            [0, -100],
          ]) {
            push(ax + dx, ay + dy, r, "semantic");
          }
        }
      }
    }
    // 2. Peer dining table row/column symmetry anchors
    const peerTables = roomPeers.filter((p) => furnitureRole(p) === "diningTable");
    if (peerTables.length >= 2) {
      const sortedX = [...peerTables].sort((a, b) => a.x - b.x);
      const sortedY = [...peerTables].sort((a, b) => a.y - b.y);
      const sameRow =
        Math.max(...peerTables.map((t) => t.y)) - Math.min(...peerTables.map((t) => t.y)) <= 150;
      if (sameRow) {
        const rowY = peerTables.reduce((s, t) => s + t.y, 0) / peerTables.length;
        const stepX = sortedX[1].x - sortedX[0].x;
        if (stepX >= 1400) {
          push(sortedX[0].x - stepX, rowY, baseRot, "semantic");
          push(sortedX[sortedX.length - 1].x + stepX, rowY, baseRot, "semantic");
          push((sortedX[0].x + sortedX[1].x) / 2, rowY, baseRot, "semantic");
        }
      }
      const sameCol =
        Math.max(...peerTables.map((t) => t.x)) - Math.min(...peerTables.map((t) => t.x)) <= 150;
      if (sameCol) {
        const colX = peerTables.reduce((s, t) => s + t.x, 0) / peerTables.length;
        const stepY = sortedY[1].y - sortedY[0].y;
        if (stepY >= 1400) {
          push(colX, sortedY[0].y - stepY, baseRot, "semantic");
          push(colX, sortedY[sortedY.length - 1].y + stepY, baseRot, "semantic");
        }
      }
    }
    // 3. Spacious open room center / quadrant fallback (away from walls)
    if (region) {
      const cx = region.bb.x + region.bb.w / 2;
      const cy = region.bb.y + region.bb.h / 2;
      for (const [tx, ty] of [
        [0.5, 0.5],
        [0.25, 0.5],
        [0.75, 0.5],
        [0.5, 0.3],
        [0.5, 0.7],
      ]) {
        push(region.bb.x + region.bb.w * tx, region.bb.y + region.bb.h * ty, baseRot, "semantic");
      }
      push(cx, cy, (baseRot + 90) % 360, "semantic");
    }
  } else if (role === "bed") {
    const orphanNs = findOrphanedNightstands(plan, f.id, region);
    if (orphanNs.length >= 2) {
      const sorted = [...orphanNs].sort((a, b) => a.x - b.x || a.y - b.y);
      const ns0 = sorted[0];
      const ns1 = sorted[sorted.length - 1];
      const bRot = normalizeRot(ns0.rot);
      const bb = rotatedAabb({ ...f, x: 0, y: 0, rot: bRot });
      const bW = bb.x1 - bb.x0;
      const bD = bb.y1 - bb.y0;
      const mx = (ns0.x + ns1.x) / 2;
      const my = (ns0.y + ns1.y) / 2;
      const nb0 = rotatedAabb(ns0);
      if (bRot === 0) push(mx, nb0.y0 + bD / 2, bRot, "semantic");
      else if (bRot === 180) push(mx, nb0.y1 - bD / 2, bRot, "semantic");
      else if (bRot === 270) push(nb0.x0 + bW / 2, my, bRot, "semantic");
      else push(nb0.x1 - bW / 2, my, bRot, "semantic");
    } else if (orphanNs.length === 1) {
      const ns = orphanNs[0];
      const bRot = normalizeRot(ns.rot);
      const bb = rotatedAabb({ ...f, x: 0, y: 0, rot: bRot });
      const bW = bb.x1 - bb.x0;
      const bD = bb.y1 - bb.y0;
      const nb = rotatedAabb(ns);
      for (const gap of [80, 160]) {
        if (bRot === 0 || bRot === 180) {
          const y = bRot === 0 ? nb.y0 + bD / 2 : nb.y1 - bD / 2;
          push(nb.x1 + gap + bW / 2, y, bRot, "semantic");
          push(nb.x0 - gap - bW / 2, y, bRot, "semantic");
        } else {
          const x = bRot === 270 ? nb.x0 + bW / 2 : nb.x1 - bW / 2;
          push(x, nb.y1 + gap + bD / 2, bRot, "semantic");
          push(x, nb.y0 - gap - bD / 2, bRot, "semantic");
        }
      }
    }
  } else if (role === "desk") {
    for (const ch of findOrphanedOfficeChairs(plan, f.id, region)) {
      const fv = facingVec(ch.rot);
      const dRot = normalizeRot(ch.rot + 180);
      const db = rotatedAabb({ ...f, x: 0, y: 0, rot: dRot });
      const dHalf = fv.dx !== 0 ? (db.x1 - db.x0) / 2 : (db.y1 - db.y0) / 2;
      const cb = rotatedAabb(ch);
      const cEdge = fv.dy > 0 ? cb.y1 : fv.dy < 0 ? cb.y0 : fv.dx > 0 ? cb.x1 : cb.x0;
      for (const gap of [100, 180, 260]) {
        const pos = cEdge + (fv.dx + fv.dy) * (gap + dHalf);
        push(fv.dy !== 0 ? ch.x : pos, fv.dy !== 0 ? pos : ch.y, dRot, "semantic");
      }
    }
  } else if (role === "armchair") {
    for (const ct of roomPeers.filter((p) => furnitureRole(p) === "coffeeTable")) {
      const ctb = rotatedAabb(ct);
      const pad = Math.max(f.w, f.d) / 2 + 450;
      push(ctb.x0 - pad, ct.y, 270, "semantic");
      push(ctb.x1 + pad, ct.y, 90, "semantic");
      push(ct.x, ctb.y0 - pad, 0, "semantic");
      push(ct.x, ctb.y1 + pad, 180, "semantic");
    }
  } else if (role === "diningChair") {
    const tables = roomPeers.filter(
      (t) => furnitureRole(t) === "diningTable" || t.type === "teaTable",
    );
    for (const t of tables) {
      const tb = rotatedAabb(t);
      const pad = f.d / 2 + 120;
      const offsets = [-t.w * 0.28, 0, t.w * 0.28];
      for (const ox of offsets) {
        push(t.x + ox, tb.y0 - pad, 0, "semantic");
        push(t.x + ox, tb.y1 + pad, 180, "semantic");
      }
      const vOffsets = [-t.d * 0.25, 0, t.d * 0.25];
      for (const oy of vOffsets) {
        push(tb.x0 - pad, t.y + oy, 270, "semantic");
        push(tb.x1 + pad, t.y + oy, 90, "semantic");
      }
    }
  } else if (role === "nightstand") {
    for (const b of roomPeers.filter((p) => furnitureRole(p) === "bed")) {
      const bb = rotatedAabb(b);
      const bRot = normalizeRot(b.rot);
      const nb = rotatedAabb({ ...f, x: 0, y: 0, rot: bRot });
      const nw = nb.x1 - nb.x0;
      const nd = nb.y1 - nb.y0;
      for (const gap of [60, 140, 240]) {
        if (bRot === 0 || bRot === 180) {
          const ny = bRot === 0 ? bb.y0 + nd / 2 : bb.y1 - nd / 2;
          push(bb.x0 - gap - nw / 2, ny, bRot, "semantic");
          push(bb.x1 + gap + nw / 2, ny, bRot, "semantic");
        } else {
          const nx = bRot === 270 ? bb.x0 + nw / 2 : bb.x1 - nw / 2;
          push(nx, bb.y0 - gap - nd / 2, bRot, "semantic");
          push(nx, bb.y1 + gap + nd / 2, bRot, "semantic");
        }
      }
    }
  } else if (role === "officeChair") {
    for (const d of roomPeers.filter((p) => furnitureRole(p) === "desk")) {
      const dFwd = facingVec(d.rot);
      const db = rotatedAabb(d);
      const cRot = normalizeRot(d.rot + 180);
      const pad = f.d / 2 + 120;
      if (dFwd.dy !== 0) {
        const y = dFwd.dy > 0 ? db.y1 + pad : db.y0 - pad;
        push(d.x, y, cRot, "semantic");
      } else {
        const x = dFwd.dx > 0 ? db.x1 + pad : db.x0 - pad;
        push(x, d.y, cRot, "semantic");
      }
    }
  } else if (role === "decorCorner") {
    for (const s of roomPeers.filter((p) => furnitureRole(p) === "sofa" || furnitureRole(p) === "tvCabinet")) {
      const sb = rotatedAabb(s);
      const pad = Math.max(f.w, f.d) / 2 + 100;
      push(sb.x0 - pad, s.y, baseRot, "semantic");
      push(sb.x1 + pad, s.y, baseRot, "semantic");
      push(s.x, sb.y0 - pad, baseRot, "semantic");
      push(s.x, sb.y1 + pad, baseRot, "semantic");
    }
    if (region) {
      const m = 150 + Math.max(f.w, f.d) / 2;
      push(region.bb.x + m, region.bb.y + m, baseRot, "semantic");
      push(region.bb.x + region.bb.w - m, region.bb.y + m, baseRot, "semantic");
      push(region.bb.x + m, region.bb.y + region.bb.h - m, baseRot, "semantic");
      push(region.bb.x + region.bb.w - m, region.bb.y + region.bb.h - m, baseRot, "semantic");
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
      const semPen = itemSemanticPenalty(plan, cand, region, winZones);
      let penalty = semPen * 1.6 + Math.hypot(pose.x - f.x, pose.y - f.y) * 0.25;
      if (pose.rot !== baseRot) penalty += 120;
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
  for (const r of ranked.filter((x) => x.pose.bucket === "semantic").slice(0, 8)) {
    addPose(r.pose);
  }
  for (const r of ranked.filter((x) => x.pose.bucket === "local").slice(0, preferPerimeter ? 3 : 5)) {
    addPose(r.pose);
  }
  for (const side of ["N", "S", "W", "E"]) {
    for (const r of ranked.filter((x) => x.pose.bucket === "wall" && x.pose.wallSide === side).slice(0, 3)) {
      addPose(r.pose);
    }
  }
  for (const r of ranked.filter((x) => x.pose.bucket === "grid").slice(0, 3)) {
    addPose(r.pose);
  }
  return picked.slice(0, 22);
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
  const initialQuickIssues = filterScopeIssues(
    collectAllIssues(working, includeSafety),
    options.roomId,
    furnitureIdsInRoom(working, targetRegion),
    targetIdSet,
  );
  const affectedRegions: RoomRegionInfo[] = targetRegion
    ? [targetRegion]
    : (() => {
        const regSet = new Set<RoomRegionInfo>();
        for (const iss of initialQuickIssues) {
          for (const id of iss.objectIds || []) {
            const f = working.furniture.find((x) => x.id === id);
            const r = f ? regionForFurniture(f, regions) : undefined;
            if (r) regSet.add(r);
          }
        }
        return regSet.size ? [...regSet] : regions;
      })();
  const roomFurnitureIds = new Set<string>(
    working.furniture
      .filter((f) =>
        affectedRegions.some((r) => pointInRects(f.x, f.y, r.rects, -120)),
      )
      .map((f) => f.id),
  );
  const doors = doorZones(working, geo);
  const winZones = windowZones(working, geo);

  const initialEval = evaluatePlan(
    working,
    originals,
    includeSafety,
    options.roomId,
    roomFurnitureIds,
    targetIdSet,
    regions,
    winZones,
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

      const effectivePriority = (item: Furniture) => {
        const reg = targetRegion || regionForFurniture(item, regions);
        const curSem = itemSemanticPenalty(currentPlan, item, reg, winZones);
        return movePriority(item, preferred) - Math.min(200, curSem * 0.035);
      };
      const orderedTargets = [...candidateIds]
        .map((id) => currentPlan.furniture.find((f) => f.id === id)!)
        .filter(Boolean)
        .filter((f) => !DECOR_COVERINGS.has(f.key) || involvedIds.length === 1)
        .sort((a, b) => effectivePriority(a) - effectivePriority(b));

      let bestPlan = currentPlan;
      let bestEval = currentEval;

      for (const f of orderedTargets) {
        const origItem = originals.get(f.id) || f;
        const fRegion = targetRegion || regionForFurniture(origItem, regions);
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
              regions,
              winZones,
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
                regions,
                winZones,
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
            winZones,
          );
          const coupledChairs =
            furnitureRole(f) === "diningTable"
              ? currentPlan.furniture.filter(
                  (o) =>
                    o.id !== f.id &&
                    furnitureRole(o) === "diningChair" &&
                    (!targetIdSet || targetIdSet.has(o.id)) &&
                    boxEdgeGap(rotatedAabb(f), rotatedAabb(o)) <= 800,
                )
              : [];
          for (const pose of poses) {
            if (Date.now() - startedAt > timeBudgetMs) break;
            const trials: Plan[] = [applyPose(currentPlan, f.id, pose)];
            if (coupledChairs.length > 0 && pose.rot === normalizeRot(f.rot)) {
              const dx = pose.x - f.x;
              const dy = pose.y - f.y;
              if (Math.hypot(dx, dy) >= 50) {
                const grouped = clone(trials[0]);
                let allInside = true;
                for (const ch of coupledChairs) {
                  const targetCh = grouped.furniture.find((item) => item.id === ch.id);
                  if (!targetCh) continue;
                  targetCh.x = snap50(targetCh.x + dx);
                  targetCh.y = snap50(targetCh.y + dy);
                  if (fRegion && !aabbInsideRects(rotatedAabb(targetCh), fRegion.rects, 45)) {
                    allInside = false;
                    break;
                  }
                }
                if (allInside) trials.unshift(grouped);
              }
            }
            for (const trial of trials) {
              const ev = evaluatePlan(
                trial,
                originals,
                includeSafety,
                options.roomId,
                roomFurnitureIds,
                targetIdSet,
                regions,
                winZones,
              );
              if (isBetter(ev.score, bestEval.score)) {
                bestPlan = trial;
                bestEval = ev;
                if (ev.score.scopedCount === 0 && ev.score.semanticPenalty <= 250) break;
              }
            }
            if (bestEval.score.scopedCount === 0 && bestEval.score.semanticPenalty <= 250) break;
          }
        }
        if (
          bestEval.score.scopedCount < currentEval.score.scopedCount &&
          bestEval.score.semanticPenalty <= 600
        ) {
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
              regions,
              winZones,
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
    semanticPenaltyBefore: initialEval.score.semanticPenalty,
    semanticPenaltyAfter: currentEval.score.semanticPenalty,
    elapsedMs,
    summary,
  };
}
