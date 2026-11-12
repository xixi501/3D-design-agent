import { q0 } from "./inherited/catalog.js";
import type { Command, Furniture, Plan } from "./types.js";

export type OpenableMode = "hinge" | "drawer" | "slide";

export interface OpenableSpec {
  mode: OpenableMode;
  /** Required clear depth in front of the front face, in millimetres. */
  clearance: number;
}

const OPENABLE_BY_KEY: Record<string, OpenableSpec> = {
  wardrobe: { mode: "hinge", clearance: 600 },
  wardrobe2: { mode: "hinge", clearance: 600 },
  wardrobe3: { mode: "hinge", clearance: 600 },
  cabWardrobe: { mode: "hinge", clearance: 600 },
  cabSlide: { mode: "slide", clearance: 500 },
  fridge: { mode: "hinge", clearance: 600 },
  fridgeDouble: { mode: "hinge", clearance: 600 },
  fridgeFrench: { mode: "hinge", clearance: 600 },
  freezer: { mode: "hinge", clearance: 600 },
  cabTall: { mode: "hinge", clearance: 450 },
  cabBase: { mode: "hinge", clearance: 450 },
  cabWall: { mode: "hinge", clearance: 450 },
  cabCorner: { mode: "hinge", clearance: 450 },
  cabShoe: { mode: "hinge", clearance: 450 },
  cabSideboard: { mode: "hinge", clearance: 450 },
  cabTV: { mode: "hinge", clearance: 450 },
  tvCabinet: { mode: "hinge", clearance: 450 },
  sideboard: { mode: "hinge", clearance: 450 },
  displayCabinet: { mode: "hinge", clearance: 450 },
  fileCabinet: { mode: "hinge", clearance: 450 },
  wineCabinet: { mode: "hinge", clearance: 450 },
  lockers: { mode: "hinge", clearance: 450 },
  shoeCabinet: { mode: "hinge", clearance: 450 },
  hallCabinet: { mode: "hinge", clearance: 450 },
  nightstand: { mode: "drawer", clearance: 450 },
  desk: { mode: "drawer", clearance: 450 },
  island: { mode: "drawer", clearance: 450 },
};

const OPENABLE_BY_TYPE: Record<string, OpenableSpec> = {
  wardrobe: { mode: "hinge", clearance: 600 },
  cabinet: { mode: "hinge", clearance: 450 },
  tvCabinet: { mode: "hinge", clearance: 450 },
  nightstand: { mode: "drawer", clearance: 450 },
  desk: { mode: "drawer", clearance: 450 },
  fridge: { mode: "hinge", clearance: 600 },
  sideboard: { mode: "hinge", clearance: 450 },
};

const SURFACE_HOST_KEYS = new Set([
  "coffeeTable",
  "roundCoffee",
  "ovalCoffee",
  "nestTables",
  "diningTable",
  "diningTable4",
  "diningTable6",
  "roundTable",
  "desk",
  "officeDesk",
  "lDesk",
  "standingDesk",
  "sideTable",
  "consoleTable",
  "tvCabinet",
  "cabTV",
  "nightstand",
  "counter",
  "lCounter",
  "uCounter",
  "island",
  "kitchenIsland",
]);

export function openableSpec(f: Furniture): OpenableSpec | undefined {
  if (f.opt?.openable === false) return undefined;
  const byKey = OPENABLE_BY_KEY[f.key];
  if (byKey) return byKey;
  return OPENABLE_BY_TYPE[f.type];
}

export function isOpenableFurniture(f: Furniture): boolean {
  return Boolean(openableSpec(f));
}

export function isTogglableFurniture(f: Furniture): boolean {
  return (
    /lamp|light|tv|curtain|screen|projector/i.test(f.type) ||
    f.opt?.on !== undefined
  );
}

export function isSurfaceHost(f: Furniture): boolean {
  if (!Number.isFinite(f.h) || f.h <= 0 || f.h > 1400) return false;
  if (SURFACE_HOST_KEYS.has(f.key)) return true;
  const type = f.type || (q0 as Record<string, any>)[f.key]?.type;
  return [
    "table",
    "desk",
    "counter",
    "nightstand",
    "cabinet",
    "island",
  ].includes(type);
}

export interface Aabb {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Axis-aligned bounds of a rotated rectangular footprint. */
export function rotatedAabb(f: Furniture): Aabb {
  const radians = ((f.rot || 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const w = f.w * cos + f.d * sin;
  const d = f.w * sin + f.d * cos;
  return {
    x0: f.x - w / 2,
    y0: f.y - d / 2,
    x1: f.x + w / 2,
    y1: f.y + d / 2,
  };
}

export interface OpenEnvelope {
  spec: OpenableSpec;
  polygon: { x: number; y: number }[];
  aabb: Aabb;
}

/**
 * Rectangular action envelope in front of one openable object. The envelope is
 * independent of the current `opt.open` state: it is the space the door/drawer
 * needs when opened, so layout problems are caught even while closed.
 */
export function openEnvelope(f: Furniture): OpenEnvelope | undefined {
  const spec = openableSpec(f);
  if (!spec) return undefined;
  const rot = (((Math.round(f.rot / 90) * 90) % 360) + 360) % 360;
  const halfW = f.w / 2;
  const halfD = f.d / 2;
  let polygon: { x: number; y: number }[];
  if (rot === 0)
    polygon = [
      { x: f.x - halfW, y: f.y + halfD },
      { x: f.x + halfW, y: f.y + halfD },
      { x: f.x + halfW, y: f.y + halfD + spec.clearance },
      { x: f.x - halfW, y: f.y + halfD + spec.clearance },
    ];
  else if (rot === 180)
    polygon = [
      { x: f.x - halfW, y: f.y - halfD },
      { x: f.x - halfW, y: f.y - halfD - spec.clearance },
      { x: f.x + halfW, y: f.y - halfD - spec.clearance },
      { x: f.x + halfW, y: f.y - halfD },
    ];
  else if (rot === 90) {
    const front = f.x + halfD,
      side = halfW;
    polygon = [
      { x: front, y: f.y - side },
      { x: front + spec.clearance, y: f.y - side },
      { x: front + spec.clearance, y: f.y + side },
      { x: front, y: f.y + side },
    ];
  } else {
    const front = f.x - halfD,
      side = halfW;
    polygon = [
      { x: front, y: f.y - side },
      { x: front, y: f.y + side },
      { x: front - spec.clearance, y: f.y + side },
      { x: front - spec.clearance, y: f.y - side },
    ];
  }
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  return {
    spec,
    polygon,
    aabb: {
      x0: Math.min(...xs),
      y0: Math.min(...ys),
      x1: Math.max(...xs),
      y1: Math.max(...ys),
    },
  };
}

export function surfaceHostFor(
  plan: Plan,
  item: Furniture,
): Furniture | undefined {
  if (item.parentObjectId) {
    const host = plan.furniture.find((f) => f.id === item.parentObjectId);
    if (host && host.id !== item.id && isSurfaceHost(host)) return host;
  }
  if (item.placement !== "surface" && item.opt?.surface !== true) return;
  const bounds = rotatedAabb(item);
  return plan.furniture.find(
    (host) =>
      host.id !== item.id &&
      isSurfaceHost(host) &&
      item.x >= rotatedAabb(host).x0 &&
      item.x <= rotatedAabb(host).x1 &&
      item.y >= rotatedAabb(host).y0 &&
      item.y <= rotatedAabb(host).y1,
  );
}

/** Effective bottom elevation for a tabletop item, following its host chain. */
export function surfaceElevation(plan: Plan, item: Furniture): number {
  const host = surfaceHostFor(plan, item);
  if (!host) return item.z || 0;
  const hostBase =
    host.parentObjectId || host.placement === "surface"
      ? surfaceElevation(plan, host)
      : host.z || 0;
  return hostBase + host.h;
}

export function surfaceOverhang(item: Furniture, host: Furniture): number {
  const i = rotatedAabb(item);
  const h = rotatedAabb(host);
  return Math.max(0, h.x0 - i.x0, i.x1 - h.x1, h.y0 - i.y0, i.y1 - h.y1);
}

/**
 * Place a tabletop item on its host: `z = host.z + host.h`, with the host
 * resolved from an explicit parent or from the item's footprint centre.
 */
export function resolveSurfacePlacement(
  plan: Plan,
  item: Furniture,
): Furniture {
  const host = surfaceHostFor(plan, item);
  if (!host) return item;
  item.parentObjectId = host.id;
  item.placement = "surface";
  item.z = surfaceElevation(plan, host) + host.h;
  return item;
}

export interface SceneActionState {
  open: Record<string, boolean>;
  on: Record<string, boolean>;
}

export function sceneActionState(plan: Plan): SceneActionState {
  const state: SceneActionState = { open: {}, on: {} };
  for (const opening of plan.openings)
    if (opening.open !== undefined)
      state.open[opening.id] = Boolean(opening.open);
  for (const f of plan.furniture) {
    if (f.opt?.open !== undefined) state.open[f.id] = Boolean(f.opt.open);
    if (f.opt?.on !== undefined) state.on[f.id] = Boolean(f.opt.on);
  }
  return state;
}

const OPENING_TYPES = new Set([
  "door",
  "double",
  "unequal",
  "sliding",
  "folding",
  "pocket",
  "garage",
]);

/** Set or toggle a door, cabinet, drawer, lamp, TV or curtain state. */
export function actionCommand(
  plan: Plan,
  collection: "openings" | "furniture",
  id: string,
  desiredState?: boolean,
  action?: "toggle_open" | "toggle_on",
): Command | undefined {
  if (collection === "openings") {
    const opening = plan.openings.find((o) => o.id === id);
    if (!opening || !OPENING_TYPES.has(opening.type)) return;
    return {
      type: "update",
      collection: "openings",
      id,
      patch: { open: desiredState ?? !opening.open },
    };
  }
  const f = plan.furniture.find((f) => f.id === id);
  if (!f) return;
  if (action === "toggle_on" && isTogglableFurniture(f))
    return {
      type: "update",
      collection: "furniture",
      id,
      patch: {
        opt: { ...(f.opt || {}), on: desiredState ?? f.opt?.on === false },
      },
    };
  if (action === "toggle_open" && isOpenableFurniture(f))
    return {
      type: "update",
      collection: "furniture",
      id,
      patch: { opt: { ...(f.opt || {}), open: desiredState ?? !f.opt?.open } },
    };
  if (!action && isOpenableFurniture(f))
    return {
      type: "update",
      collection: "furniture",
      id,
      patch: { opt: { ...(f.opt || {}), open: desiredState ?? !f.opt?.open } },
    };
  if (!action && isTogglableFurniture(f)) {
    const isOn = f.opt?.on !== false;
    return {
      type: "update",
      collection: "furniture",
      id,
      patch: { opt: { ...(f.opt || {}), on: desiredState ?? !isOn } },
    };
  }
}

/** Backwards-compatible toggle used by the editor and legacy API callers. */
export function toggleActionCommand(
  plan: Plan,
  collection: "openings" | "furniture",
  id: string,
): Command | undefined {
  return actionCommand(plan, collection, id);
}

/** One-click open/close of all doors and openable furniture for layout checks. */
export function allDoorCabinetCommands(
  plan: Plan,
  mode: "open" | "close" | "toggle" = "toggle",
): { commands: Command[]; mode: "open" | "close" } {
  const openable = plan.openings.filter((o) => OPENING_TYPES.has(o.type));
  const cabinets = plan.furniture.filter(isOpenableFurniture);
  const allOpen =
    openable.every((o) => Boolean(o.open)) &&
    cabinets.every((f) => Boolean(f.opt?.open));
  const next: "open" | "close" =
    mode === "toggle" ? (allOpen ? "close" : "open") : mode;
  const commands: Command[] = [];
  for (const opening of openable)
    if (Boolean(opening.open) !== (next === "open"))
      commands.push({
        type: "update",
        collection: "openings",
        id: opening.id,
        patch: { open: next === "open" },
      });
  for (const f of cabinets)
    if (Boolean(f.opt?.open) !== (next === "open"))
      commands.push({
        type: "update",
        collection: "furniture",
        id: f.id,
        patch: { opt: { ...(f.opt || {}), open: next === "open" } },
      });
  return { commands, mode: next };
}
