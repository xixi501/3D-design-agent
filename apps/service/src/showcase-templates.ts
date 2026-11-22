import fs from "node:fs";
import path from "node:path";
import {
  applyStyle,
  auditSafety,
  catalog,
  checkScene,
  clone,
  importDocument,
  SceneError,
  styleTypes,
  type Plan,
  type SafetyProfile,
} from "../../../packages/scene-core/src/index.js";

export interface StyleThemePack {
  id: string;
  label: string;
  badge: string;
  furnitureStyle: string;
  floorMaterial: string;
  wallMaterial: string;
  ceiling: { type: "none" | "flat" | "edge"; drop: number; edgeW: number; cove: boolean };
  enableSafetyProfile?: boolean;
  description: string;
}

export const STYLE_THEME_PACKS: Record<string, StyleThemePack> = {
  european: {
    id: "european",
    label: "欧式古典",
    badge: "🏛️ 欧式古典",
    furnitureStyle: "luxury",
    floorMaterial: "marble",
    wallMaterial: "latexWarm",
    ceiling: { type: "edge", drop: 160, edgeW: 400, cove: true },
    description: "大理石地面、暖杏护墙、回光灯槽吊顶与胡桃鎏金弧形家具",
  },
  chinese: {
    id: "chinese",
    label: "新中式",
    badge: "🎋 新中式",
    furnitureStyle: "chinese",
    floorMaterial: "#7c583c",
    wallMaterial: "latexWarm",
    ceiling: { type: "edge", drop: 140, edgeW: 360, cove: true },
    description: "深胡桃木地面、东方留白暖墙、格栅床屏与黄铜五金茶韵家具",
  },
  modern: {
    id: "modern",
    label: "现代极简",
    badge: "✨ 现代极简",
    furnitureStyle: "modern",
    floorMaterial: "oak",
    wallMaterial: "latexWhite",
    ceiling: { type: "flat", drop: 80, edgeW: 300, cove: false },
    description: "利落几何线条、暖橡木地板、极简白墙与哑光黑金属脚架",
  },
  japanese: {
    id: "japanese",
    label: "日式原木",
    badge: "🌿 日式原木",
    furnitureStyle: "japanese",
    floorMaterial: "oak",
    wallMaterial: "latexWarm",
    ceiling: { type: "none", drop: 0, edgeW: 300, cove: false },
    description: "温润浅原木与棉麻肌理、低重心通透排布与自然绿意点缀",
  },
  cream: {
    id: "cream",
    label: "法式奶油",
    badge: "🧁 法式奶油",
    furnitureStyle: "cream",
    floorMaterial: "#e5dacb",
    wallMaterial: "#f6f1ea",
    ceiling: { type: "edge", drop: 120, edgeW: 340, cove: true },
    description: "羊羔绒圆润墩座造型、奶杏柔光墙地一体与纱帘漫射光感",
  },
  aging_care: {
    id: "aging_care",
    label: "适老康养",
    badge: "🛡️ 适老康养",
    furnitureStyle: "nordic",
    floorMaterial: "oak",
    wallMaterial: "latexWarm",
    ceiling: { type: "flat", drop: 80, edgeW: 300, cove: true },
    enableSafetyProfile: true,
    description: "国标 Ø1500mm 轮椅无障碍动线、全高柜 L 型防震墙锚与鸿蒙雷达全覆盖",
  },
};

const STYLEABLE_TYPES = new Set<string>(styleTypes as string[]);

export function applyStylePackToPlan(plan: Plan, styleId: string): Plan {
  const pack = STYLE_THEME_PACKS[styleId] || STYLE_THEME_PACKS.modern;
  const next = clone(plan);
  const wetKeywords = ["厨", "卫", "浴", "厕", "阳"];
  for (const room of next.rooms) {
    const isWet = wetKeywords.some((kw) => (room.name || "").includes(kw));
    if (!isWet) {
      room.mat = pack.floorMaterial;
      room.wallMat = pack.wallMaterial;
      room.ceil = clone(pack.ceiling);
    }
  }
  for (const item of next.furniture) {
    if (STYLEABLE_TYPES.has(item.type)) {
      applyStyle(item, pack.furnitureStyle);
    }
    if (
      pack.enableSafetyProfile &&
      item.h >= 1400 &&
      item.h / Math.max(1, Math.min(item.w, item.d)) >= 2.0
    ) {
      item.opt = { ...(item.opt || {}), wallAnchored: true };
    }
  }
  if (pack.enableSafetyProfile) {
    const existingSource = next.source || { kind: "style-pack" };
    const roomSensors = next.rooms.length
      ? next.rooms.map((r, idx) => ({
          id: `radar-room-${idx + 1}`,
          name: `${r.name || "空间"}吸顶康养雷达`,
          x: r.x,
          y: r.y,
          z: Math.min(2750, (next.height || 2800) - 50),
          fovDeg: 360,
          maxRangeMm: 7500,
        }))
      : [
          {
            id: "radar-auto-1",
            name: "鸿蒙AI超感防跌倒雷达",
            x: 2400,
            y: 2000,
            z: 2700,
            fovDeg: 360,
            maxRangeMm: 7500,
          },
        ];
    next.source = {
      ...existingSource,
      kind: existingSource.kind || "style-pack",
      safetyProfile: {
        enabled: true,
        elderlyWheelchair: true,
        wheelchairDiameterMm: 1500,
        accessibleCorridorMm: 850,
        seismicIntensity: 7,
        radarCheck: true,
        minRadarCoverageRatio: 0.85,
        radarSensors: existingSource.safetyProfile?.radarSensors?.length
          ? existingSource.safetyProfile.radarSensors
          : roomSensors,
      },
    };
  }
  return next;
}

export interface CompileHouseSpecOptions {
  styleId?: string;
  furnitureStyle?: string;
  safetyProfile?: SafetyProfile;
  anchorTallCabinets?: boolean;
  autoHealCollisions?: boolean;
}

export function compileSafeHouseSpec(
  rawSpec: Record<string, any>,
  options: CompileHouseSpecOptions = {},
): Plan {
  const spec = clone(rawSpec);
  if (Array.isArray(spec.furniture)) {
    spec.furniture = spec.furniture.filter(
      (f: any) => f && typeof f.key === "string" && Object.hasOwn(catalog, f.key),
    );
  }
  const imported = importDocument(spec);
  let plan = imported.plan;

  if (options.safetyProfile) {
    plan.source = {
      ...(plan.source || { kind: "housespec-init" }),
      safetyProfile: options.safetyProfile,
    };
  }

  if (options.styleId && STYLE_THEME_PACKS[options.styleId]) {
    plan = applyStylePackToPlan(plan, options.styleId);
  } else if (options.furnitureStyle) {
    for (const item of plan.furniture) {
      if (STYLEABLE_TYPES.has(item.type)) {
        applyStyle(item, options.furnitureStyle);
      }
    }
  }

  if (options.safetyProfile) {
    plan.source = {
      ...(plan.source || { kind: "housespec-init" }),
      safetyProfile: options.safetyProfile,
    };
  }

  if (options.anchorTallCabinets) {
    for (const item of plan.furniture) {
      if (item.h >= 1400 && item.h / Math.max(1, Math.min(item.w, item.d)) >= 2.0) {
        item.opt = { ...(item.opt || {}), wallAnchored: true };
      }
    }
  }

  if (options.autoHealCollisions) {
    const essentialTypes = new Set([
      "bed",
      "sofa",
      "lSofa",
      "diningTable",
      "roundTable",
      "ovalTable",
      "teaTable",
      "desk",
      "toilet",
      "vanity",
      "shower",
      "counter",
      "lCounter",
    ]);
    for (let pass = 0; pass < 14; pass++) {
      const report = checkScene(plan);
      const blocking = report.issues.filter((i: any) => i.blocking !== false && i.level === "error");
      if (!blocking.length) break;
      const issue = blocking.find((i) => (i.objectIds || []).length > 0);
      if (!issue) break;
      const candidates = (issue.objectIds || [])
        .map((oid) => plan.furniture.find((f) => f.id === oid))
        .filter(Boolean) as any[];
      if (!candidates.length) break;
      // If openable furniture faces wall, rotate it 180 deg first before deleting!
      if (issue.code === "OPENABLE_FRONT_BLOCKED" && candidates.length === 1) {
        const target = candidates[0];
        if (!target._rotatedOnce) {
          target.rot = ((target.rot || 0) + 180) % 360;
          target._rotatedOnce = true;
          continue;
        }
      }
      const removable =
        candidates.find((f) => !essentialTypes.has(f.type)) ||
        candidates[candidates.length - 1];
      plan.furniture = plan.furniture.filter((f) => f.id !== removable.id);
    }
    for (const item of plan.furniture as any[]) {
      delete item._rotatedOnce;
    }
  }

  return plan;
}

export interface ShowcaseTemplateMeta {
  id: string;
  name: string;
  tier: "single" | "suite" | "full_home" | "safety_lab";
  tierLabel: string;
  styleId: string;
  styleLabel: string;
  roomCount: number;
  areaSummary: string;
  highlights: string[];
  fixtureFile?: string;
  spec?: Record<string, any>;
  anchorTallCabinets?: boolean;
  safetyProfile?: SafetyProfile;
}

export const SHOWCASE_TEMPLATES: ShowcaseTemplateMeta[] = [
  {
    id: "euro-banquet-dining",
    name: "演境 · 欧式古典三桌宴会餐厅",
    tier: "single",
    tierLabel: "精品单间",
    styleId: "european",
    styleLabel: "🏛️ 欧式古典",
    roomCount: 1,
    areaSummary: "8.4m × 6.0m（50.4㎡）",
    highlights: ["3 张主副餐桌 + 12 把餐椅", "大理石地面 + 鎏金边吊灯槽", "定制壁炉 + 餐边柜 + 酒柜 + 三联画"],
    anchorTallCabinets: true,
    spec: {
      name: "演境 · 欧式古典三桌宴会餐厅",
      height: 3100,
      phase: "renovate",
      autoElec: false,
      walls: [
        {
          a: [0, 0],
          b: [8400, 0],
          t: 200,
          bearing: true,
          openings: [
            { type: "window", from: 1400, to: 3400, sill: 800, head: 2500 },
            { type: "window", from: 5000, to: 7000, sill: 800, head: 2500 },
          ],
        },
        { a: [8400, 0], b: [8400, 6000], t: 200, bearing: true },
        {
          a: [8400, 6000],
          b: [0, 6000],
          t: 200,
          bearing: true,
          openings: [{ type: "double", from: 3500, to: 4900, into: [4200, 4800] }],
        },
        { a: [0, 6000], b: [0, 0], t: 200, bearing: true },
      ],
      rooms: [
        {
          at: [4200, 3000],
          name: "欧式宴会餐厅",
          mat: "marble",
          wallMat: "latexWarm",
          ceil: { type: "edge", drop: 160, edgeW: 400, cove: true },
        },
      ],
      furniture: [
        { key: "diningTable6", at: [4200, 2700], rot: 0 },
        { key: "armDiningChair", at: [3750, 1900], rot: 0 },
        { key: "armDiningChair", at: [4650, 1900], rot: 0 },
        { key: "armDiningChair", at: [3750, 3500], rot: 180 },
        { key: "armDiningChair", at: [4650, 3500], rot: 180 },
        { key: "roundTable", at: [1650, 2700], rot: 0 },
        { key: "chair", at: [1650, 1750], rot: 0 },
        { key: "chair", at: [1650, 3650], rot: 180 },
        { key: "chair", at: [700, 2700], rot: 270 },
        { key: "chair", at: [2600, 2700], rot: 90 },
        { key: "roundTable", at: [6750, 2700], rot: 0 },
        { key: "chair", at: [6750, 1750], rot: 0 },
        { key: "chair", at: [6750, 3650], rot: 180 },
        { key: "chair", at: [5800, 2700], rot: 270 },
        { key: "chair", at: [7700, 2700], rot: 90 },
        { key: "fireplace", at: [4200, 380], rot: 0 },
        { key: "sideboard", at: [1600, 5620], rot: 180 },
        { key: "wineCabinet", at: [6900, 5600], rot: 180 },
        { key: "bigPlant", at: [600, 650], rot: 0 },
        { key: "bigPlant", at: [7800, 650], rot: 0 },
        { key: "floorLamp", at: [7850, 5400], rot: 0 },
        { key: "wallArt3", at: [8260, 3000], rot: 90 },
        { key: "wallArt3", at: [140, 3000], rot: 270 },
      ],
    },
  },
  {
    id: "chinese-zen-tearoom",
    name: "演境 · 新中式雅致茶室与书斋",
    tier: "single",
    tierLabel: "精品单间",
    styleId: "chinese",
    styleLabel: "🎋 新中式",
    roomCount: 1,
    areaSummary: "6.6m × 4.8m（31.7㎡）",
    highlights: ["茶台主宾席 + 罗汉床卧榻", "博古展示柜 + 对称书架", "胡桃木格栅与东方留白意境"],
    anchorTallCabinets: true,
    spec: {
      name: "演境 · 新中式雅致茶室与书斋",
      height: 2900,
      phase: "renovate",
      autoElec: false,
      walls: [
        {
          a: [0, 0],
          b: [6600, 0],
          t: 200,
          bearing: true,
          openings: [{ type: "window", from: 2100, to: 4500, sill: 750, head: 2450 }],
        },
        { a: [6600, 0], b: [6600, 4800], t: 200, bearing: true },
        {
          a: [6600, 4800],
          b: [0, 4800],
          t: 200,
          bearing: true,
          openings: [{ type: "sliding", from: 2500, to: 4100 }],
        },
        { a: [0, 4800], b: [0, 0], t: 200, bearing: true },
      ],
      rooms: [
        {
          at: [3300, 2400],
          name: "新中式茶室",
          mat: "#7c583c",
          wallMat: "latexWarm",
          ceil: { type: "edge", drop: 140, edgeW: 360, cove: true },
        },
      ],
      furniture: [
        { key: "teaTable", at: [3300, 2300], rot: 0 },
        { key: "armDiningChair", at: [3300, 1450], rot: 0 },
        { key: "chair", at: [2850, 3100], rot: 180 },
        { key: "chair", at: [3750, 3100], rot: 180 },
        { key: "dayBed", at: [5950, 2400], rot: 90 },
        { key: "displayCabinet", at: [1050, 380], rot: 0 },
        { key: "bookshelf", at: [5550, 350], rot: 0 },
        { key: "consoleTable", at: [420, 2400], rot: 270 },
        { key: "bigPlant", at: [650, 4200], rot: 0 },
        { key: "floorVase", at: [5950, 4250], rot: 0 },
        { key: "floorLamp", at: [5950, 1100], rot: 0 },
        { key: "wallArt3", at: [140, 2400], rot: 270 },
      ],
    },
  },
  {
    id: "cream-media-lounge",
    name: "演境 · 法式奶油沉浸影音阅读厅",
    tier: "single",
    tierLabel: "精品单间",
    styleId: "cream",
    styleLabel: "🧁 法式奶油",
    roomCount: 1,
    areaSummary: "6.8m × 5.0m（34.0㎡）",
    highlights: ["羊羔绒奶油圆润家具", "客厅影音 + 立式钢琴音乐角", "圆润茶几 + 落地灯柔和氛围"],
    spec: {
      name: "演境 · 法式奶油沉浸影音阅读厅",
      height: 2850,
      phase: "renovate",
      autoElec: false,
      walls: [
        {
          a: [0, 0],
          b: [6800, 0],
          t: 200,
          bearing: true,
          openings: [{ type: "window", from: 2000, to: 4800, sill: 600, head: 2450 }],
        },
        { a: [6800, 0], b: [6800, 5000], t: 200, bearing: true },
        {
          a: [0, 5000],
          b: [6800, 5000],
          t: 200,
          bearing: true,
          openings: [{ type: "door", from: 5400, to: 6350, into: [5800, 4100] }],
        },
        { a: [0, 5000], b: [0, 0], t: 200, bearing: true },
      ],
      rooms: [
        {
          at: [3400, 2500],
          name: "奶油影音阅读厅",
          mat: "#e5dacb",
          wallMat: "#f6f1ea",
          ceil: { type: "edge", drop: 120, edgeW: 340, cove: true },
        },
      ],
      furniture: [
        { key: "fourSofa", at: [2400, 1450], rot: 0 },
        { key: "roundCoffee", at: [2400, 2750], rot: 0 },
        { key: "tvCabinet", at: [2100, 4580], rot: 180 },
        { key: "readingChair", at: [4500, 2400], rot: 90 },
        { key: "piano", at: [6320, 2000], rot: 90 },
        { key: "bookshelfLow", at: [4200, 4680], rot: 180 },
        { key: "floorLamp", at: [750, 1200], rot: 0 },
        { key: "bigPlant", at: [6150, 750], rot: 0 },
        { key: "wallArt3", at: [140, 2300], rot: 270 },
      ],
    },
  },
  {
    id: "elderly-master-suite",
    name: "演境 · 鸿蒙康养主卧+衣帽+无障碍独卫套间",
    tier: "suite",
    tierLabel: "连通套间",
    styleId: "aging_care",
    styleLabel: "🛡️ 适老康养",
    roomCount: 3,
    areaSummary: "9.8m × 6.4m（62.7㎡ · 3连通空间）",
    highlights: ["主卧 + 步入式衣帽间 + 无障碍独卫", "全屋 3 空间 Ø1500mm 轮椅回转圆达标", "多点鸿蒙毫米波吸顶协同看护 + 全高柜墙锚"],
    anchorTallCabinets: true,
    safetyProfile: {
      enabled: true,
      elderlyWheelchair: true,
      wheelchairDiameterMm: 1500,
      accessibleCorridorMm: 850,
      seismicIntensity: 8,
      radarCheck: true,
      minRadarCoverageRatio: 0.85,
      radarSensors: [
        { id: "suite-radar-bed1", name: "主卧床侧看护雷达", x: 3200, y: 2600, z: 2780, fovDeg: 360, maxRangeMm: 7500 },
        { id: "suite-radar-bed2", name: "主卧起夜动线雷达", x: 1200, y: 5200, z: 2780, fovDeg: 360, maxRangeMm: 7500 },
        { id: "suite-radar-closet", name: "衣帽间吸顶看护雷达", x: 7400, y: 1550, z: 2780, fovDeg: 360, maxRangeMm: 6500 },
        { id: "suite-radar-bath", name: "独卫吸顶防跌倒雷达", x: 7400, y: 4900, z: 2780, fovDeg: 360, maxRangeMm: 6500 },
      ],
    },
    spec: {
      name: "演境 · 鸿蒙康养主卧+衣帽+无障碍独卫套间",
      height: 2850,
      phase: "renovate",
      autoElec: false,
      walls: [
        {
          a: [0, 0],
          b: [5600, 0],
          t: 200,
          bearing: true,
          openings: [{ type: "window", from: 1600, to: 4000, sill: 800, head: 2400 }],
        },
        {
          a: [5600, 0],
          b: [9800, 0],
          t: 200,
          bearing: true,
          openings: [{ type: "window", from: 1300, to: 2900, sill: 1000, head: 2300 }],
        },
        { a: [9800, 0], b: [9800, 3100], t: 200, bearing: true },
        { a: [9800, 3100], b: [9800, 6400], t: 200, bearing: true },
        { a: [9800, 6400], b: [5600, 6400], t: 200, bearing: true },
        {
          a: [0, 6400],
          b: [5600, 6400],
          t: 200,
          bearing: true,
          openings: [{ type: "door", from: 4100, to: 5100, into: [4500, 5200] }],
        },
        { a: [0, 6400], b: [0, 0], t: 200, bearing: true },
        {
          a: [5600, 0],
          b: [5600, 3100],
          t: 160,
          openings: [{ type: "sliding", from: 1000, to: 2100 }],
        },
        {
          a: [5600, 3100],
          b: [5600, 6400],
          t: 160,
          openings: [{ type: "sliding", from: 1100, to: 2200 }],
        },
        { a: [5600, 3100], b: [9800, 3100], t: 160 },
      ],
      rooms: [
        { at: [2800, 3200], name: "无障碍康养主卧", mat: "oak", wallMat: "latexWarm", ceil: { type: "flat", drop: 80, edgeW: 300, cove: true } },
        { at: [7700, 1550], name: "步入式衣帽间", mat: "oak", wallMat: "latexWarm", ceil: { type: "none" } },
        { at: [7700, 4750], name: "适老无障碍独卫", mat: "tile", wallMat: "tile", ceil: { type: "flat", drop: 100, edgeW: 300, cove: false } },
      ],
      furniture: [
        { key: "bed18", at: [1200, 2700], rot: 270 },
        { key: "nightstand", at: [380, 1400], rot: 270 },
        { key: "nightstand", at: [380, 4000], rot: 270 },
        { key: "tvCabinet", at: [1900, 5980], rot: 180 },
        { key: "armchair", at: [3400, 800], rot: 0 },
        { key: "cabSlide", at: [9320, 1550], rot: 90 },
        { key: "dresser", at: [7200, 2650], rot: 180 },
        { key: "vanity", at: [7400, 3550], rot: 0 },
        { key: "toilet", at: [9280, 4050], rot: 90 },
        { key: "shower", at: [9180, 5780], rot: 180 },
      ],
    },
  },
  {
    id: "youth-studio-suite",
    name: "演境 · 日式原木一室一厅一卫青年微公寓",
    tier: "suite",
    tierLabel: "连通套间",
    styleId: "japanese",
    styleLabel: "🌿 日式原木",
    roomCount: 3,
    areaSummary: "9.4m × 6.0m（56.4㎡ · 3连通空间）",
    highlights: ["开放式起居餐厨一体厅", "独立原木静谧卧室兼书房", "干湿分离卫浴 + 15件精致原木软装"],
    anchorTallCabinets: true,
    spec: {
      name: "演境 · 日式原木一室一厅一卫青年微公寓",
      height: 2800,
      phase: "renovate",
      autoElec: false,
      walls: [
        {
          a: [0, 0],
          b: [5600, 0],
          t: 200,
          bearing: true,
          openings: [{ type: "window", from: 1500, to: 3900, sill: 850, head: 2400 }],
        },
        {
          a: [5600, 0],
          b: [9400, 0],
          t: 200,
          bearing: true,
          openings: [{ type: "window", from: 1100, to: 2700, sill: 850, head: 2400 }],
        },
        { a: [9400, 0], b: [9400, 3600], t: 200, bearing: true },
        { a: [9400, 3600], b: [9400, 6000], t: 200, bearing: true },
        { a: [9400, 6000], b: [5600, 6000], t: 200, bearing: true },
        {
          a: [0, 6000],
          b: [5600, 6000],
          t: 200,
          bearing: true,
          openings: [{ type: "door", from: 4200, to: 5150, into: [4600, 5000] }],
        },
        { a: [0, 6000], b: [0, 0], t: 200, bearing: true },
        {
          a: [5600, 0],
          b: [5600, 3600],
          t: 160,
          openings: [{ type: "sliding", from: 2200, to: 3200 }],
        },
        {
          a: [5600, 3600],
          b: [5600, 6000],
          t: 160,
          openings: [{ type: "sliding", from: 700, to: 1650 }],
        },
        { a: [5600, 3600], b: [9400, 3600], t: 160 },
      ],
      rooms: [
        { at: [2800, 3000], name: "原木客餐厨一体厅", mat: "oak", wallMat: "latexWarm", ceil: { type: "none" } },
        { at: [7500, 1800], name: "静谧原木卧室", mat: "oak", wallMat: "latexWarm", ceil: { type: "none" } },
        { at: [7500, 4800], name: "独立卫浴", mat: "tile", wallMat: "tile", ceil: { type: "flat", drop: 100, edgeW: 300, cove: false } },
      ],
      furniture: [
        { key: "loveseat", at: [1450, 1050], rot: 0 },
        { key: "roundCoffee", at: [1450, 2150], rot: 0 },
        { key: "tvCabinet", at: [1450, 3300], rot: 180 },
        { key: "counter", at: [1450, 5520], rot: 180 },
        { key: "fridge", at: [3050, 5480], rot: 180 },
        { key: "diningTable4", at: [4100, 1250], rot: 0 },
        { key: "chair", at: [4100, 550], rot: 0 },
        { key: "chair", at: [4100, 1950], rot: 180 },
        { key: "plant", at: [450, 450], rot: 0 },
        { key: "bed15", at: [8220, 1250], rot: 90 },
        { key: "nightstand", at: [9020, 2350], rot: 90 },
        { key: "cabSlide", at: [7600, 3120], rot: 180 },
        { key: "vanity", at: [7200, 4020], rot: 0 },
        { key: "toilet", at: [8880, 4250], rot: 90 },
        { key: "shower", at: [8800, 5400], rot: 180 },
      ],
    },
  },
  {
    id: "modern-3bhk-fullhome",
    name: "演境 · 现代轻奢三室两厅一厨一卫全屋大平层",
    tier: "full_home",
    tierLabel: "单层复杂全屋",
    styleId: "modern",
    styleLabel: "✨ 现代极简",
    roomCount: 6,
    areaSummary: "13.6m × 9.6m（130.6㎡ · 6房间全屋）",
    highlights: ["三室两厅一厨一卫完整大户型", "宽幕客餐厅 + 主卧 + 次卧 + 独立书房", "26 件全屋成套家具零穿模门禁通过"],
    anchorTallCabinets: true,
    spec: {
      name: "演境 · 现代轻奢三室两厅一厨一卫全屋大平层",
      height: 2900,
      phase: "renovate",
      autoElec: false,
      walls: [
        {
          a: [0, 0],
          b: [13600, 0],
          t: 200,
          bearing: true,
          openings: [
            { type: "window", from: 1200, to: 3200, sill: 800, head: 2450 },
            { type: "window", from: 5700, to: 8100, sill: 600, head: 2500 },
            { type: "window", from: 10300, to: 11700, sill: 950, head: 2400 },
          ],
        },
        {
          a: [13600, 0],
          b: [13600, 9600],
          t: 200,
          bearing: true,
          openings: [{ type: "window", from: 5300, to: 6500, sill: 900, head: 2350 }],
        },
        {
          a: [0, 9600],
          b: [13600, 9600],
          t: 200,
          bearing: true,
          openings: [
            { type: "window", from: 1200, to: 3200, sill: 800, head: 2450 },
            { type: "double", from: 6300, to: 7500, into: [6900, 8400] },
          ],
        },
        { a: [0, 0], b: [0, 9600], t: 200, bearing: true },
        {
          a: [4400, 0],
          b: [4400, 9600],
          t: 160,
          openings: [
            { type: "sliding", from: 3400, to: 4400 },
            { type: "sliding", from: 5200, to: 6200 },
          ],
        },
        { a: [0, 4800], b: [4400, 4800], t: 160 },
        {
          a: [9400, 0],
          b: [9400, 9600],
          t: 160,
          openings: [
            { type: "sliding", from: 3200, to: 4300 },
            { type: "sliding", from: 5400, to: 6400 },
            { type: "sliding", from: 7900, to: 8850 },
          ],
        },
        { a: [9400, 4600], b: [13600, 4600], t: 160 },
        { a: [9400, 7200], b: [13600, 7200], t: 160 },
      ],
      rooms: [
        { at: [6900, 4800], name: "宽幕客餐厅", mat: "oak", wallMat: "latexWhite", ceil: { type: "edge", drop: 120, edgeW: 360, cove: true } },
        { at: [2200, 2400], name: "主卧室", mat: "oak", wallMat: "latexWarm", ceil: { type: "flat", drop: 80, edgeW: 300, cove: false } },
        { at: [2200, 7200], name: "次卧长辈房", mat: "oak", wallMat: "latexWarm", ceil: { type: "none" } },
        { at: [11500, 2300], name: "中西厨房", mat: "tile", wallMat: "tile", ceil: { type: "flat", drop: 100, edgeW: 300, cove: false } },
        { at: [11500, 5900], name: "独立书房", mat: "oak", wallMat: "latexWhite", ceil: { type: "none" } },
        { at: [11500, 8400], name: "公共卫浴", mat: "tile", wallMat: "tile", ceil: { type: "flat", drop: 100, edgeW: 300, cove: false } },
      ],
      furniture: [
        { key: "sofa", at: [6900, 1250], rot: 0 },
        { key: "coffeeTable", at: [6900, 2350], rot: 0 },
        { key: "tvCabinet", at: [6900, 3350], rot: 180 },
        { key: "diningTable4", at: [6900, 6800], rot: 0 },
        { key: "chair", at: [6900, 6050], rot: 0 },
        { key: "chair", at: [6900, 7550], rot: 180 },
        { key: "shoeCabinet", at: [5200, 9180], rot: 180 },
        { key: "floorLamp", at: [4850, 550], rot: 0 },
        { key: "plant", at: [8950, 550], rot: 0 },
        { key: "bed18", at: [1200, 2100], rot: 270 },
        { key: "nightstand", at: [380, 900], rot: 270 },
        { key: "nightstand", at: [380, 3300], rot: 270 },
        { key: "cabSlide", at: [1800, 4350], rot: 180 },
        { key: "bed15", at: [1180, 7400], rot: 270 },
        { key: "nightstand", at: [380, 8550], rot: 270 },
        { key: "cabSlide", at: [1800, 5250], rot: 0 },
        { key: "counter", at: [11800, 4120], rot: 180 },
        { key: "fridgeDouble", at: [13080, 2200], rot: 90 },
        { key: "desk", at: [11500, 5120], rot: 0 },
        { key: "officeChair", at: [11500, 5880], rot: 180 },
        { key: "bookshelf", at: [11500, 6780], rot: 180 },
        { key: "vanity", at: [11000, 7620], rot: 0 },
        { key: "toilet", at: [13080, 7850], rot: 90 },
        { key: "shower", at: [13000, 9000], rot: 180 },
      ],
    },
  },
  {
    id: "elderly-care-hazard",
    name: "演境 · 独居老人适老与鸿蒙看护隐患房（整改演练）",
    tier: "safety_lab",
    tierLabel: "安全推演样板",
    styleId: "aging_care",
    styleLabel: "🧓 待整改适老样板",
    roomCount: 1,
    areaSummary: "5.2m × 4.2m（含轮椅受阻与雷达盲区隐患）",
    highlights: ["高柜遮挡毫米波雷达形成红色盲区", "中置茶几阻断 Ø1500mm 轮椅回转圆", "可一键呼叫 AgentArts 自动适老改造"],
    fixtureFile: "elderly-care-hazard.plan.json",
  },
  {
    id: "seismic-bedroom-hazard",
    name: "演境 · 7度地震非结构震害推演房（防震演练）",
    tier: "safety_lab",
    tierLabel: "安全推演样板",
    styleId: "modern",
    styleLabel: "⚡ 地震演练样板",
    roomCount: 1,
    areaSummary: "5.0m × 4.0m（含砸床与封堵逃生门隐患）",
    highlights: ["未锚固高衣柜处于床头倾覆半径内", "门旁高窄书柜震后翻倒顶死逃生门", "支持 8 秒刚体地震波翻倒对比演练"],
    fixtureFile: "seismic-bedroom-hazard.plan.json",
  },
];

export function buildTemplatePlan(
  templateId: string,
  fixturesDir: string,
): { meta: ShowcaseTemplateMeta; plan: Plan } {
  const meta = SHOWCASE_TEMPLATES.find((t) => t.id === templateId);
  if (!meta) {
    throw new SceneError("UNKNOWN_TEMPLATE", `未知样板场景 ID: ${templateId}`, 404);
  }
  if (meta.fixtureFile) {
    const raw = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, meta.fixtureFile), "utf8"),
    );
    const plan = raw.plan ? raw.plan : importDocument(raw).plan;
    return { meta, plan };
  }
  const plan = compileSafeHouseSpec(meta.spec!, {
    styleId: meta.styleId,
    anchorTallCabinets: meta.anchorTallCabinets,
    safetyProfile: meta.safetyProfile,
    autoHealCollisions: true,
  });
  return { meta, plan };
}
