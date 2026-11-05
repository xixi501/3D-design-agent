/** Derived from ZWD11/house-plan-designer@b94183f9 (MIT, Copyright 2026 ZWD11).
 * Scope-aware extraction: scripts/extract-upstream.mjs. See reference/upstream/LICENSE.
 * Three.js core is an npm dependency; inherited modelling helpers retain their original behaviour. */
import { q0, Ut, ii, Q0, Hc, cs, tf, $r } from "./catalog.js";
import {
  Vr,
  F4,
  yd,
  _0,
  F0,
  xe,
  bd,
  Hy,
  Wr,
  Vc,
  Wc,
  D4,
  Xe,
  X0,
  Vt,
  Ls,
  ms,
  Te,
  qe,
} from "./topology.js";
import { B4, vi, i0, Ci, yi, X1, Ty, Pt, Ns } from "./footprints.js";
export function by(n, e, t, i) {
  const s = (e.x - n.x) * (i.y - t.y) - (e.y - n.y) * (i.x - t.x);
  if (Math.abs(s) < 1e-9) return null;
  const o = ((t.x - n.x) * (i.y - t.y) - (t.y - n.y) * (i.x - t.x)) / s,
    a = ((t.x - n.x) * (e.y - n.y) - (t.y - n.y) * (e.x - n.x)) / s;
  return {
    x: n.x + (e.x - n.x) * o,
    y: n.y + (e.y - n.y) * o,
    t: o,
    u: a,
  };
}
export const Vn = (n) =>
  n === "door" ||
  n === "double" ||
  n === "unequal" ||
  n === "sliding" ||
  n === "folding" ||
  n === "pocket" ||
  n === "hole" ||
  n === "garage";
export const zn = (n) => !Vn(n);
export const mt = {
  socket: {
    name: "五孔插座",
    short: "插",
    h: 300,
    group: "强电",
    wall: !0,
    desc: "10A 普通插座，离地 300mm",
  },
  socketUSB: {
    name: "USB 插座",
    short: "U",
    h: 700,
    group: "强电",
    wall: !0,
    desc: "床头、书桌，带 USB / Type-C",
  },
  socketW: {
    name: "防水插座",
    short: "防",
    h: 1400,
    group: "强电",
    wall: !0,
    desc: "带防溅盒，卫生间/阳台",
  },
  socket16: {
    name: "16A 插座",
    short: "16",
    h: 300,
    group: "强电",
    wall: !0,
    desc: "柜机空调、烤箱、热水器",
  },
  socketAC: {
    name: "空调插座",
    short: "空",
    h: 2200,
    group: "强电",
    wall: !0,
    desc: "挂机空调，离地约 2.2m",
  },
  socketHood: {
    name: "烟机插座",
    short: "烟",
    h: 2150,
    group: "强电",
    wall: !0,
    desc: "油烟机上方，被烟机罩挡住",
  },
  socketEV: {
    name: "充电桩电源",
    short: "充",
    h: 1300,
    group: "强电",
    wall: !0,
    desc: "车库 / 车位旁，独立回路 32A（7kW 交流桩）",
  },
  socketFloor: {
    name: "地插",
    short: "地",
    h: 0,
    group: "强电",
    wall: !1,
    desc: "餐桌、岛台、沙发背后没有墙时用",
  },
  panel: {
    name: "强电箱",
    short: "强",
    h: 1800,
    group: "强电",
    wall: !0,
    desc: "配电箱",
  },
  switch1: {
    name: "单控开关",
    short: "开",
    h: 1300,
    group: "开关",
    wall: !0,
    desc: "门边 150~200mm，离地 1.3m。3D 里点击可开关灯",
  },
  switch2: {
    name: "双控开关",
    short: "双",
    h: 1300,
    group: "开关",
    wall: !0,
    desc: "卧室门口 + 床头各一个，关联同一盏灯，两处都能开关",
  },
  switch3: {
    name: "三开开关",
    short: "三",
    h: 1300,
    group: "开关",
    wall: !0,
    desc: "一个面板控制多路灯，3D 里点击依次切换",
  },
  dimmer: {
    name: "调光开关",
    short: "调",
    h: 1300,
    group: "开关",
    wall: !0,
    desc: "3D 里点击依次切换 关 / 暗 / 亮",
  },
  light: {
    name: "吸顶灯",
    short: "灯",
    h: 0,
    group: "灯具",
    wall: !1,
    desc: "主灯",
  },
  pendant: {
    name: "吊灯",
    short: "吊",
    h: 0,
    group: "灯具",
    wall: !1,
    desc: "餐桌、客厅主灯",
  },
  downlight: {
    name: "筒灯",
    short: "筒",
    h: 0,
    group: "灯具",
    wall: !1,
    desc: "无主灯、边吊，泛光",
  },
  spot: {
    name: "射灯",
    short: "射",
    h: 0,
    group: "灯具",
    wall: !1,
    desc: "窄光束，打墙面、挂画",
  },
  wallLamp: {
    name: "壁灯",
    short: "壁",
    h: 1700,
    group: "灯具",
    wall: !0,
    desc: "床头、过道、镜前",
  },
  weak: {
    name: "弱电箱",
    short: "弱",
    h: 300,
    group: "弱电",
    wall: !0,
    desc: "光猫、路由器",
  },
  net: {
    name: "网络插座",
    short: "网",
    h: 300,
    group: "弱电",
    wall: !0,
    desc: "网线点位",
  },
  tv: {
    name: "电视插座",
    short: "视",
    h: 1100,
    group: "弱电",
    wall: !0,
    desc: "电视墙中间，壁挂高度",
  },
  intercom: {
    name: "可视对讲",
    short: "讲",
    h: 1400,
    group: "弱电",
    wall: !0,
    desc: "入户门旁",
  },
  smoke: {
    name: "烟感 / 燃气报警",
    short: "感",
    h: 0,
    group: "弱电",
    wall: !1,
    desc: "厨房吸顶",
  },
  cold: {
    name: "冷水点",
    short: "冷",
    h: 500,
    group: "给水",
    wall: !0,
    desc: "台盆 500、淋浴 1100、洗衣机 1200",
  },
  hot: {
    name: "热水点",
    short: "热",
    h: 500,
    group: "给水",
    wall: !0,
    desc: "冷热水间距 150mm，左热右冷",
  },
  waterIn: {
    name: "进水总阀",
    short: "阀",
    h: 300,
    group: "给水",
    wall: !0,
    desc: "进户总阀 / 分水器位置，冷水管从这里出发（不放就按管井或厨房估）",
  },
  waste: {
    name: "墙排水口",
    short: "排",
    h: 400,
    group: "给水",
    wall: !0,
    desc: "台盆、洗碗机、净水器排水",
  },
  acHole: {
    name: "空调孔",
    short: "孔",
    h: 2350,
    group: "暖通燃气",
    wall: !0,
    desc: "外墙开孔 Φ75，挂机在上方、柜机在下方",
  },
  freshAir: {
    name: "新风口",
    short: "新",
    h: 0,
    group: "暖通燃气",
    wall: !1,
    desc: "吸顶风口",
  },
  gas: {
    name: "燃气点",
    short: "气",
    h: 600,
    group: "暖通燃气",
    wall: !0,
    desc: "灶具、燃气热水器",
  },
};
export const C0 = ["light", "pendant", "downlight", "spot", "wallLamp"];
export const Os = ["switch1", "switch2", "switch3", "dimmer"];
export function I4(n, e) {
  if (!e.tall || e.tall === "none") return null;
  const t = yi(n, e),
    i = Ty(t, e)[e.tall === "start" ? 0 : 1],
    s = t[i.leg],
    o = e.tallW || 600;
  return i.atStart
    ? Pt(n, s, s.s0, s.s0 + o, 0, s.depth)
    : Pt(n, s, s.s1 - o, s.s1, 0, s.depth);
}
export function oM(n, e) {
  const t = yi(n, e),
    i = [],
    s = (l, c) => {
      const f = t[l] || t[0];
      return X1(n, f, c, -10);
    },
    o = e.sink,
    a = e.hob;
  if (!o.off) {
    const l = t[o.leg] || t[0],
      c = s(o.leg, o.at - 75),
      f = s(o.leg, o.at + 75),
      u = X1(n, l, o.at, l.depth),
      h = X1(n, l, o.at, -10),
      p = h.y - u.y,
      d = -(h.x - u.x),
      y = (c.x - f.x) * p + (c.y - f.y) * d > 0;
    i.push(
      ["hot", 500, y ? c : f],
      ["cold", 500, y ? f : c],
      ["waste", 400, s(o.leg, o.at + 200)],
    );
  }
  (e.hood && i.push(["socketHood", 2150, s(a.leg, a.at)]),
    a.off || i.push(["gas", 600, s(a.leg, a.at + 250)]));
  const r = o.off ? (a.off ? null : a) : a.off ? o : void 0;
  if (r !== void 0) {
    const l = t[r ? r.leg : 0],
      c = r
        ? r.at + (r.at > (l.s0 + l.s1) / 2 ? -r.w : r.w)
        : (l.s0 + l.s1) / 2;
    i.push(
      ["socket", 1100, s(r ? r.leg : 0, c - 150)],
      ["socket", 1100, s(r ? r.leg : 0, c + 150)],
    );
  } else if (o.leg === a.leg) {
    const l = (o.at + a.at) / 2;
    i.push(
      ["socket", 1100, s(o.leg, l - 150)],
      ["socket", 1100, s(o.leg, l + 150)],
    );
  } else
    i.push(
      [
        "socket",
        1100,
        s(o.leg, o.at + (o.at > (t[o.leg].s0 + t[o.leg].s1) / 2 ? -o.w : o.w)),
      ],
      [
        "socket",
        1100,
        s(a.leg, a.at + (a.at > (t[a.leg].s0 + t[a.leg].s1) / 2 ? -a.w : a.w)),
      ],
    );
  if (e.tall && e.tall !== "none") {
    const l = I4(n, e);
    i.push([
      "socket16",
      300,
      {
        x: (l.x0 + l.x1) / 2,
        y: (l.y0 + l.y1) / 2,
      },
    ]);
  }
  return i;
}
export const uM = [
  "living",
  "bed",
  "kitchen",
  "bath",
  "balcony",
  "garage",
  "other",
];
export function Ma(n) {
  const e = n
    .split(/[+＋、/]/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (e.length > 1) {
    const t = e.map(N8);
    return uM.find((i) => t.includes(i));
  }
  return N8(n);
}
export function N8(n) {
  return /车库|车位|车棚/.test(n)
    ? "garage"
    : /卫|洗手|淋浴/.test(n)
      ? "bath"
      : /厨/.test(n)
        ? "kitchen"
        : /阳台|露台|花园|平台|庭院|院子|天井/.test(n)
          ? "balcony"
          : /卧|儿童|老人|客房/.test(n)
            ? "bed"
            : /客|餐|厅|起居/.test(n)
              ? "living"
              : "other";
}
export function gr(n, e, t = 450) {
  let i = null;
  for (const s of n.active) {
    const o = F0(e, s.a, s.b);
    if (
      o.along < 0 ||
      o.along > s.len ||
      o.d >= ((i == null ? void 0 : i.d) ?? t)
    )
      continue;
    const a = Math.sign((e.x - s.a.x) * s.n.x + (e.y - s.a.y) * s.n.y) || 1;
    i = {
      g: s,
      along: o.along,
      side: a,
      d: o.d,
    };
  }
  return i;
}
export const fM = (n, e) => Math.round(Math.atan2(-n.n.x * e, n.n.y * e) / qe);
export const hM = (n, e) =>
  e !== void 0 &&
  n.o.type !== "bay" &&
  !Vn(n.o.type) &&
  (e + 120 < n.o.sill || e - 120 > n.o.head);
export const Cs = (n, e, t = 60, i) =>
  e < n.endA + 80 ||
  e > n.len - n.endB - 80 ||
  n.ops.some((s) => e > s.s0 - t && e < s.s1 + t && !hM(s, i));
export function al(n, e, t = 1500, i = 40, s) {
  for (let o = 0; o <= t; o += 50)
    for (const a of o ? [e - o, e + o] : [e]) if (!Cs(n, a, i, s)) return a;
  return null;
}
export function yr(n, e, t, i, s = mt[e].h) {
  if ((e === "socket" || e === "socket16" || e === "socketUSB") && mt[e].wall) {
    const r = Xe(n.rooms, t);
    r && ms(r) === "bath" && (e = "socketW");
  }
  if (
    [...n.plan.elec, ...n.out].some(
      (r) => r.kind === e && Math.abs(r.h - s) < 150 && xe(r, t) < 150,
    ) ||
    (mt[e].wall && bu(n, t))
  )
    return null;
  const a = {
    id: Ut(),
    kind: e,
    x: Math.round(t.x),
    y: Math.round(t.y),
    rot: i,
    h: s,
  };
  return (n.out.push(a), a);
}
export const ky = [
  "wardrobe",
  "cabinet",
  "bookshelf",
  "shoeCabinet",
  "sideboard",
  "tallOven",
  "fridge",
  "acFloor",
];
export function X2(n, e, t) {
  return n.plan.furniture.some(
    (i) =>
      ky.includes(i.type) &&
      (i.z || 0) < t &&
      (i.z || 0) + i.h > t &&
      Ls(e, vi(i.x, i.y, i.w + 160, i.d + 160, i.rot)),
  );
}
export const dM = [
  "rug",
  "rugRound",
  "yogaMat",
  "curtain",
  "lawn",
  "stepStones",
  "chair",
  "officeChair",
  "barStool",
  "plant",
  "ottoman",
  "beanbag",
  "petBed",
  "robotVac",
  "floorLamp",
  "lawnLamp",
];
export function N4(n, e, t) {
  return n.plan.furniture.some((i) => {
    var s;
    return (
      !dM.includes(i.type) &&
      !((s = q0[i.key]) != null && s.ceil) &&
      (i.z || 0) < t + 60 &&
      (i.z || 0) + i.h > t - 60 &&
      Ls(e, vi(i.x, i.y, i.w + 160, i.d + 160, i.rot))
    );
  });
}
export function Ft(n, e, t, i, s, o = mt[e].h, a = !1) {
  const r = (f) => Te(t, Math.round(f / 10) * 10, s * (t.ht + 60)),
    l = (f) => (a ? N4(n, f, o) : X2(n, f, o));
  let c = i;
  if (l(r(i))) {
    let f = null;
    for (let u = 50; u <= 1500 && f === null; u += 50)
      for (const h of [i - u, i + u])
        if (!Cs(t, h, 20, o) && !l(r(h))) {
          f = h;
          break;
        }
    if (f === null && a) return null;
    f !== null && (c = f);
  }
  return yr(n, e, r(c), fM(t, s), o);
}
export function y3(n, e, t) {
  const i = [];
  for (const s of n.geo.active)
    for (const o of s.ops)
      if (t(o))
        for (const a of [1, -1]) {
          const r = o.o.type === "bay" ? 520 : 300;
          Xe(n.rooms, Te(s, o.o.pos, a * (s.ht + r))) === e &&
            i.push({
              g: s,
              q: o,
              side: a,
              other: Xe(n.rooms, Te(s, o.o.pos, -a * (s.ht + 300))),
            });
        }
  return i;
}
export function b3(n, e, t) {
  const o = (
    (e.o.type === "door" && e.o.hinge ? 0 : 1)
      ? [e.s1 + t, e.s0 - t]
      : [e.s0 - t, e.s1 + t]
  ).find((a) => !Cs(n, a));
  return o === void 0
    ? null
    : {
        s: o,
        dir: o > e.o.pos ? 1 : -1,
      };
}
export const pM = ["diningTable", "roundTable", "ovalTable", "booth"];
export const O8 = ["sofa", "lSofa", "uSofa", "curvedSofa", "bendSofa"];
export const F8 = ["bed", "bunkBed", "tatami"];
export const mM = /露台|花园|平台|庭院/;
export const U8 = /走廊|过道|过厅|玄关|门厅|入户|楼梯|走道|廊/;
export const gM = /空调|管井|烟道|风井|水井/;
export const B8 =
  /电梯厅|候梯|前室|公共|楼梯间|核心筒|消防|电井|强电井|弱电井|走道|连廊/;
export const v3 =
  /衣帽|储|设备|锅炉|洗衣|工具|杂物|电梯|楼梯|强电|弱电|管井|消防|厕位/;
export const x3 = {
  light: 2600,
  pendant: 1500,
  downlight: 1700,
  spot: 900,
  wallLamp: 2600,
};
export const a1 = ["socket", "socketUSB", "socketW", "socket16", "socketFloor"];
export const bu = (n, e) =>
  (n.plan.voids || []).some(
    (t) => e.x > t.x && e.x < t.x + t.w && e.y > t.y && e.y < t.y + t.h,
  );
export function r1(n, e, t, i) {
  const s = (r) => Xe(n.rooms, r) === e && !bu(n, r),
    o = n.plan.furniture
      .filter((r) => ky.includes(r.type))
      .map((r) => vi(r.x, r.y, r.w, r.d, r.rot)),
    a = [];
  for (let r = e.bb.x + t / 2; r < e.bb.x + e.bb.w; r += t)
    for (let l = e.bb.y + t / 2; l < e.bb.y + e.bb.h; l += t) {
      const c = {
        x: r,
        y: l,
      };
      s(c) &&
        ((i &&
          ![
            [i, 0],
            [-i, 0],
            [0, i],
            [0, -i],
          ].every(([f, u]) =>
            s({
              x: r + f,
              y: l + u,
            }),
          )) ||
          o.some((f) => Ls(c, f)) ||
          a.push(c));
    }
  return a;
}
export function w3(n, e, t, i, s) {
  const o = n.map((r) => e.some((l) => xe(l.p, r) <= l.R)),
    a = [];
  for (let r = 0; r < s; r++) {
    const l = n.filter((p, d) => !o[d]);
    if (l.length < 2) break;
    let c = null,
      f = 0,
      u = 0;
    for (const p of t) {
      let d = 0,
        y = 0;
      for (const m of l) {
        const g = xe(p.p, m);
        g <= i && (d++, (y += g));
      }
      (d > f || (d === f && d && y < u)) && ((c = p), (f = d), (u = y));
    }
    if (!c || f < 2) break;
    const h = c;
    (a.push(h),
      n.forEach((p, d) => {
        !o[d] && xe(h.p, p) <= i && (o[d] = !0);
      }));
  }
  return a;
}
export function rl(n, e, t, i = 200, s = 100) {
  const o = [];
  for (const a of n.geo.active)
    for (const r of [1, -1])
      for (let l = a.endA + 150; l < a.len - a.endB - 150; l += i) {
        if (Cs(a, l, s, t)) continue;
        const c = Te(a, l, r * (a.ht + 60));
        Xe(n.rooms, c) !== e ||
          N4(n, c, t) ||
          o.push({
            p: c,
            g: a,
            s: l,
            side: r,
          });
      }
  return o;
}
export function z8(n, e, t, i) {
  let s = t;
  for (let a = 100; a < 12e3; a += 50) {
    const r = {
      x: t.x + i.x * a,
      y: t.y + i.y * a,
    };
    if (Xe(n.rooms, r) !== e) break;
    s = r;
  }
  const o = gr(n.geo, s, 300);
  return o && !Cs(o.g, o.along, 40) ? o : null;
}
export function Ry(n, e, t, i = !0) {
  i && (n.elec = []);
  const s = {
      plan: n,
      geo: e,
      rooms: t,
      out: [],
    },
    o = () => [...n.elec, ...s.out],
    a = (d, y) => Xe(t, d) === y,
    r = (() => {
      for (const d of e.active)
        for (const y of d.ops)
          if (y.o.entry)
            return {
              g: d,
              q: y,
            };
      return null;
    })(),
    l = t.regions.filter(
      (d) =>
        d.area >= X0 &&
        (d.labels.length
          ? !d.labels.every((y) => gM.test(y.name))
          : d.area >= 1.5),
    ),
    c = new Map(),
    f = (d) => !d || ["living", "other"].includes(Ma(Vt(d)));
  for (const d of l) {
    const y = d.labels.map((z) => Ma(z.name)),
      m = Vt(d),
      g = y.length ? (y.includes("living") ? "living" : y[0]) : "other",
      v = !!d.labels.length && d.labels.every((z) => U8.test(z.name)),
      w = mM.test(m);
    let x = r1(s, d, 300, 300);
    if ((x.length || (x = r1(s, d, 200, 0)), !x.length)) continue;
    const b = n.furniture.filter((z) => a(z, d)),
      M = (...z) => b.filter((V) => z.includes(V.type)),
      T = [],
      k = (z, V, W = 0) => {
        if (!a(V, d) || bu(s, V) || (W && T.some((C) => xe(C, V) < W)))
          return null;
        const K = yr(s, z, V, 0);
        return (K && T.push(K), K);
      };
    if (w) {
      const z = rl(s, d, 1800, 300, 150);
      for (const V of w3(x, [], z, x3.wallLamp, 8)) {
        const W = Ft(s, "wallLamp", V.g, V.s, V.side, 1800);
        W && T.push(W);
      }
    } else {
      if (d.area > 80 && !v3.test(m))
        for (const C of r1(s, d, 2200, 500)) k("downlight", C, 1400);
      for (const C of M(...pM, "kitchenIsland").filter((F) => F.h >= 600))
        k("pendant", C);
      for (const C of M(...O8)) {
        const F = M("tvCabinet", "wallTV").sort(
            (U, q) => xe(U, C) - xe(q, C),
          )[0],
          G = i0(0, C.d / 2 + 1300, C.rot * qe);
        k(
          "light",
          F && xe(F, C) < 6e3
            ? {
                x: (C.x + F.x) / 2,
                y: (C.y + F.y) / 2,
              }
            : {
                x: C.x + G.x,
                y: C.y + G.y,
              },
          1800,
        );
      }
      g === "bed" && k("light", d.interior, 1500);
      for (const C of d.labels) {
        const F = Ma(C.name);
        if (U8.test(C.name)) k("downlight", C, 1500);
        else {
          if (F === "kitchen" && b.some(Ci)) continue;
          F === "kitchen" || F === "bath"
            ? k("light", C, 1600)
            : k("light", C, 2200);
        }
      }
      T.length ||
        k(v ? "downlight" : "light", d.interior) ||
        k(v ? "downlight" : "light", x[Math.floor(x.length / 2)]);
      const z = b.filter((C) => Ci(C)).sort((C, F) => F.w - C.w)[0];
      if (
        y.includes("kitchen") ||
        d.labels.some((C) => /厨/.test(C.name)) ||
        !!z
      ) {
        let C = d.labels.find((F) => /厨/.test(F.name)) || d.interior;
        if (z) {
          const F = i0(0, z.d / 2 + 500, z.rot * qe),
            G = {
              x: z.x + F.x,
              y: z.y + F.y,
            };
          (a(G, d) && (C = G), g !== "kitchen" && k("light", C, 1500));
        }
        yr(s, "smoke", a(C, d) ? C : d.interior, 0);
      }
      let W = r1(s, d, 200, 500);
      W.length || (W = r1(s, d, 200, 150));
      const K = g === "garage" ? "light" : "downlight";
      for (const C of w3(
        x,
        T.map((F) => ({
          p: F,
          R: x3[F.kind] || 1500,
        })),
        W.map((F) => ({
          p: F,
        })),
        x3[K],
        12,
      ))
        k(K, C.p);
    }
    c.set(d, {
      kind: g,
      passage: v,
      outdoor: w,
    });
    const S = y3(s, d, (z) => Vn(z.o.type)),
      E = g === "bath" || g === "balcony",
      _ = (z) =>
        z.q.o.entry
          ? 0
          : g === "garage" && z.q.o.type === "garage"
            ? 5
            : z.other
              ? f(z.other)
                ? 1
                : ["bath", "balcony"].includes(Ma(Vt(z.other)))
                  ? 4
                  : 2
              : 3,
      A = E
        ? S.find((z) => z.q.o.entry) || S.find((z) => z.other) || S[0]
        : S.slice().sort((z, V) => _(z) - _(V))[0],
      P = () => T.map((z) => z.id),
      D = (z, V) =>
        o().some((W) => Os.includes(W.kind) && xe(W, z) < V && a(W, d)),
      O = E ? [] : S.filter((z) => z !== A && (z.q.o.entry || f(z.other)));
    let I = !1;
    if (A && T.length) {
      let z = E && A.other ? -A.side : A.side,
        V = b3(A.g, A.q, 200);
      if (!V) {
        const W = al(A.g, A.q.s1 + 200, 1200);
        W !== null &&
          (V = {
            s: W,
            dir: W > A.q.o.pos ? 1 : -1,
          });
      }
      if (
        (V &&
          z !== A.side &&
          X2(s, Te(A.g, V.s, z * (A.g.ht + 60)), 1300) &&
          (z = A.side),
        V)
      ) {
        I = !0;
        const W =
            g === "bed" || (O.length && T.length === 1)
              ? "switch2"
              : T.length > 1
                ? "switch3"
                : "switch1",
          K = Ft(s, W, A.g, V.s, z);
        if (
          (K && (K.links = P()),
          (g === "bed" || g === "living") &&
            Ft(s, "socket", A.g, V.s + V.dir * 150, z, 300, !0),
          A.q.o.entry && !w && g !== "balcony" && !B8.test(m))
        ) {
          o().some((q) => q.kind === "intercom") ||
            Ft(s, "intercom", A.g, V.s + V.dir * 250, z);
          const C = o().some((q) => q.kind === "panel"),
            F = o().some((q) => q.kind === "weak"),
            G = al(A.g, V.s + V.dir * 650, 900, 250),
            U = !C && G !== null ? Ft(s, "panel", A.g, G, z, void 0, !0) : null;
          if (!F) {
            const q = U
              ? al(A.g, G + (G > A.q.o.pos ? 1 : -1) * 350, 600, 60)
              : null;
            q !== null && Ft(s, "weak", A.g, q, z, void 0, !0);
          }
        }
      }
      for (const W of O) {
        const K = b3(W.g, W.q, 200);
        if (!K || D(Te(W.g, K.s), 2500)) continue;
        const C = Ft(s, "switch2", W.g, K.s, W.side);
        C && (C.links = P());
      }
    }
    if (!I && T.length) {
      const z = tr(s, d);
      if (z) {
        const V = Ft(s, "switch1", z.g, z.s, z.side);
        V && (V.links = P());
      }
    }
    const B = [
      ...M("stairU", "stairRun", "stairDogleg").map((z) => ({
        x: z.x,
        y: z.y,
      })),
      ...(n.voids || [])
        .filter((z) => !z.shaft)
        .map((z) => ({
          x: z.x + z.w / 2,
          y: z.y + z.h / 2,
        }))
        .filter(
          (z) => xe(z, d.interior) < 8e3 && x.some((V) => xe(V, z) < 2500),
        ),
    ];
    for (const z of B) {
      if (!T.length || D(z, 2200)) continue;
      const V = tr(s, d, z);
      if (V && xe(Te(V.g, V.s), z) < 3500) {
        const W = Ft(s, "switch2", V.g, V.s, V.side);
        W && (W.links = P());
      }
    }
    for (const z of M(...F8)) {
      const V = (C) => {
        const F = i0(C, -z.d / 2 - 10, z.rot * qe);
        return {
          x: z.x + F.x,
          y: z.y + F.y,
        };
      };
      if (g === "bed" && T.length) {
        const C = gr(e, V(z.w / 2 + 70), 300);
        if (C && !Cs(C.g, C.along, 20)) {
          const F = Ft(s, "switch2", C.g, C.along, C.side, 900);
          F && (F.links = P());
        }
      }
      if (
        !n.furniture.filter(
          (C) =>
            C.type === "nightstand" && xe(C, z) < Math.max(z.w, z.d) / 2 + 700,
        ).length
      )
        for (const C of [-1, 1]) {
          const F = gr(e, V(C * (z.w / 2 + 250)), 300);
          F &&
            !Cs(F.g, F.along, 20, 700) &&
            Ft(s, "socket", F.g, F.along, F.side, 700);
        }
      const K = gr(e, V(-(z.w / 2 + 450)), 300);
      if (
        (K &&
          !Cs(K.g, K.along, 20, 300) &&
          Ft(s, "net", K.g, K.along, K.side, 300),
        g === "bed" &&
          d.area >= 9 &&
          !M("tvCabinet", "wallTV", "desk", "lDesk").length)
      ) {
        const C = z8(s, d, z, i0(0, 1, z.rot * qe));
        C &&
          xe(Te(C.g, C.along), z) > z.d / 2 + 900 &&
          !X2(s, Te(C.g, C.along, C.side * (C.g.ht + 60)), 1100) &&
          (Ft(s, "tv", C.g, C.along, C.side, 1100),
          Ft(s, "socket", C.g, C.along - 300, C.side, 1100));
      }
    }
    if (
      (g === "bed" ||
        g === "living" ||
        (g === "other" &&
          !v &&
          d.labels.length &&
          d.area >= 8 &&
          !v3.test(m))) &&
      !M("acWall", "acFloor").length
    ) {
      const z = y3(s, d, (W) => zn(W.o.type) || W.o.type === "sliding").sort(
          (W, K) => K.q.o.width - W.q.o.width,
        ),
        V = z.find((W) => !W.other) || z[0];
      if (V)
        for (const W of [1, -1]) {
          const K = W > 0 ? V.q.s1 + 300 : V.q.s0 - 300,
            C = K + W * 300;
          if (!(Cs(V.g, K) || Cs(V.g, C))) {
            g === "living"
              ? (Ft(s, "acHole", V.g, K, V.side, 300),
                Ft(s, "socket16", V.g, C, V.side, 300))
              : (Ft(s, "acHole", V.g, K, V.side),
                Ft(s, "socketAC", V.g, C, V.side));
            break;
          }
        }
    }
    if (g === "balcony" && !M("washer", "laundrySink").length && A) {
      const z = b3(A.g, A.q, 400);
      z && Ft(s, "socketW", A.g, z.s, A.side, 1300);
    }
  }
  for (const d of n.furniture) {
    const y = q0[d.key];
    if (!Ci(d) && !(y != null && y.pw)) continue;
    if (y.ceil && !Ci(d)) {
      for (const [g, v] of y.pw)
        yr(
          s,
          g,
          {
            x: d.x,
            y: d.y,
          },
          0,
          Math.max(v, n.height - 300),
        );
      continue;
    }
    const m = Ci(d)
      ? oM(d, Ns(d))
      : y.pw.map(([g, v, w = 0]) => [
          g,
          v,
          {
            x: w,
            y: -d.d / 2 - 10,
          },
        ]);
    for (const [g, v, w] of m) {
      if (!mt[g].wall) {
        const A = i0(w.x, 0, d.rot * qe);
        yr(
          s,
          g,
          {
            x: d.x + A.x,
            y: d.y + A.y,
          },
          0,
          0,
        );
        continue;
      }
      const x = Xe(t, d),
        b = (A) =>
          !!A && (!x || Xe(t, Te(A.g, A.along, A.side * (A.g.ht + 60))) === x),
        M = (A) => {
          const P = i0(A, w.y, d.rot * qe);
          return {
            x: d.x + P.x,
            y: d.y + P.y,
          };
        };
      let T = M(w.x),
        k = gr(e, T, 350);
      (!b(k) &&
        Math.abs(w.x) > d.w / 2 - 100 &&
        ((T = M(Math.sign(w.x) * Math.max(0, d.w / 2 - 100))),
        (k = gr(e, T, 350))),
        b(k) || (k = null));
      const S = k ? al(k.g, k.along, 1500, 20, v) : null;
      if (k && S !== null) {
        Ft(s, g, k.g, S, k.side, v);
        continue;
      }
      const E = Xe(t, d);
      if (!E) continue;
      const _ = rl(s, E, v, 100, 40).sort((A, P) => xe(A.p, T) - xe(P.p, T))[0];
      _ && xe(_.p, d) < Math.max(d.w, d.d) / 2 + 1200
        ? Ft(s, g, _.g, _.s, _.side, v)
        : a1.includes(g) && g !== "socketW"
          ? yr(s, "socketFloor", T, 0, 0)
          : g === "net" &&
            yr(
              s,
              "net",
              {
                x: d.x,
                y: d.y,
              },
              0,
              0,
            );
    }
  }
  for (const [d, y] of c) {
    const m = () => o().filter((g) => a(g, d));
    if (y.kind === "living" && !m().some((g) => g.kind === "tv")) {
      const g = n.furniture.find((w) => O8.includes(w.type) && a(w, d)),
        v = g && z8(s, d, g, i0(0, 1, g.rot * qe));
      v &&
        !X2(s, Te(v.g, v.along, v.side * (v.g.ht + 60)), 1100) &&
        (Ft(s, "tv", v.g, v.along, v.side, 1100),
        Ft(s, "socket", v.g, v.along - 350, v.side, 1100),
        Ft(s, "socket", v.g, v.along + 350, v.side, 1100),
        Ft(s, "net", v.g, v.along + 600, v.side, 300));
    }
    if (
      ["living", "bed", "other"].includes(y.kind) &&
      !y.passage &&
      d.area >= 5 &&
      !v3.test(Vt(d)) &&
      !m().some((g) => g.kind === "net")
    ) {
      const g = tr(s, d, d.interior, 300);
      g && Ft(s, "net", g.g, g.s, g.side, 300);
    }
    if (!y.outdoor && !y.passage && y.kind !== "bath" && y.kind !== "balcony") {
      const g = y.kind === "kitchen" ? 1100 : y.kind === "garage" ? 1300 : 300,
        v = rl(s, d, g, 200, 150),
        w = m()
          .filter((x) => a1.includes(x.kind))
          .map((x) => ({
            p: x,
            R: 1800,
          }));
      for (const x of w3(
        v.map((b) => b.p),
        w,
        v,
        1800,
        10,
      ))
        Ft(s, "socket", x.g, x.s, x.side, g);
    } else if (
      (y.passage || y.outdoor) &&
      d.area >= 3 &&
      !m().some((g) => a1.includes(g.kind))
    ) {
      const g = tr(s, d, d.interior, y.outdoor ? 1400 : 300);
      g &&
        Ft(
          s,
          y.outdoor ? "socketW" : "socket",
          g.g,
          g.s,
          g.side,
          y.outdoor ? 1400 : 300,
        );
    }
    for (const g of n.furniture.filter((v) => F8.includes(v.type) && a(v, d))) {
      if (
        o().some(
          (x) => a1.includes(x.kind) && xe(x, g) < Math.max(g.w, g.d) / 2 + 700,
        )
      )
        continue;
      const v = (() => {
          const x = i0(0, -g.d / 2, g.rot * qe);
          return {
            x: g.x + x.x,
            y: g.y + x.y,
          };
        })(),
        w = rl(s, d, 700, 100, 40).sort((x, b) => xe(x.p, v) - xe(b.p, v))[0];
      w &&
        xe(w.p, g) < Math.max(g.w, g.d) / 2 + 700 &&
        Ft(s, "socket", w.g, w.s, w.side, 700);
    }
    if (y.kind === "garage") {
      for (const v of y3(s, d, (w) => w.o.type === "garage"))
        Ft(
          s,
          "socket",
          v.g,
          v.q.o.pos,
          v.side,
          Math.min(n.height - 150, v.q.o.head + 350),
        );
      const g = n.furniture.filter((v) => v.type === "car" && a(v, d));
      for (const v of g.length ? g : [null]) {
        const w = v
            ? (() => {
                const M = i0(0, v.d / 2, v.rot * qe);
                return {
                  x: v.x + M.x,
                  y: v.y + M.y,
                };
              })()
            : d.interior,
          x = (M) => g.slice().sort((T, k) => xe(T, M) - xe(k, M))[0];
        if (
          o().some(
            (M) => M.kind === "socketEV" && a(M, d) && (!v || x(M) === v),
          )
        )
          continue;
        const b = rl(s, d, 1300, 100, 60).sort(
          (M, T) => xe(M.p, w) - xe(T.p, w),
        )[0];
        b && Ft(s, "socketEV", b.g, b.s, b.side, 1300);
      }
    }
    if (y.outdoor || y.kind === "balcony") {
      for (const g of n.furniture.filter(
        (v) => v.type === "carport" && a(v, d),
      )) {
        if (
          o().some(
            (w) =>
              w.kind === "socketEV" && xe(w, g) < Math.max(g.w, g.d) / 2 + 1500,
          )
        )
          continue;
        const v = rl(s, d, 1300, 100, 60).sort(
          (w, x) => xe(w.p, g) - xe(x.p, g),
        )[0];
        v &&
          xe(v.p, g) < Math.max(g.w, g.d) / 2 + 2500 &&
          Ft(s, "socketEV", v.g, v.s, v.side, 1300);
      }
      if (y.outdoor && d.area >= 8 && !m().some((g) => g.kind === "cold")) {
        const g = tr(s, d, d.interior, 600);
        g && Ft(s, "cold", g.g, g.s, g.side, 600);
      }
    }
    if (y.kind === "bath" && !m().some((g) => a1.includes(g.kind))) {
      const g = tr(s, d, d.interior, 1400);
      g && Ft(s, "socketW", g.g, g.s, g.side, 1400);
    }
  }
  const u = !o().some((d) => d.kind === "panel"),
    h = !o().some((d) => d.kind === "weak");
  if (u || h) {
    const d = l.filter((b) => {
        const M = c.get(b);
        return (
          M &&
          !M.outdoor &&
          !["balcony", "bath", "garage"].includes(M.kind) &&
          !B8.test(Vt(b))
        );
      }),
      y = n.furniture.find(
        (b) =>
          b.type === "stairU" ||
          b.type === "stairRun" ||
          b.type === "stairDogleg",
      ),
      m = (n.voids || []).find((b) => !b.shaft && /楼梯/.test(b.name || "")),
      g = r
        ? Te(r.g, r.q.o.pos)
        : y ||
          (m
            ? {
                x: m.x + m.w / 2,
                y: m.y + m.h / 2,
              }
            : void 0),
      v = (b, M) =>
        Math.hypot(
          Math.max(b.bb.x - M.x, 0, M.x - b.bb.x - b.bb.w),
          Math.max(b.bb.y - M.y, 0, M.y - b.bb.y - b.bb.h),
        ),
      w = (d.length ? d : l)
        .slice()
        .sort(
          (b, M) =>
            (g ? v(b, g) - v(M, g) : 0) || +f(M) - +f(b) || M.area - b.area,
        )[0],
      x = w && tr(s, w, g);
    if (x) {
      u && Ft(s, "panel", x.g, x.s, x.side);
      const b = h ? al(x.g, x.s + (u ? 350 : 0), 600, 60) : null;
      b !== null && Ft(s, "weak", x.g, b, x.side);
    }
  }
  const p = [...n.elec, ...s.out].filter((d) => d.kind === "cold");
  if (
    r &&
    p.length &&
    ![...n.elec, ...s.out].some((d) => d.kind === "waterIn")
  ) {
    const d =
        p.find((v) => {
          const w = Xe(t, v);
          return !!w && Ma(Vt(w)) === "kitchen";
        }) || p[0],
      y = n.structs
        .filter((v) => v.kind === "shaft")
        .sort((v, w) => xe(v, d) - xe(w, d))[0],
      m =
        y && xe(y, d) < 6e3
          ? {
              x: y.x,
              y: y.y,
            }
          : d,
      g = gr(e, m, y && m === y ? Math.max(y.w, y.d) / 2 + 500 : 450);
    if (g) {
      const v = al(g.g, g.along + (m === d ? 250 : 0), 1200, 60, 300);
      v !== null && Ft(s, "waterIn", g.g, v, g.side, 300);
    }
  }
  return (n.elec.push(...s.out), s.out.length);
}
export function tr(n, e, t = e.interior, i = 1300) {
  let s = null;
  for (const o of n.geo.active)
    for (const a of [1, -1])
      for (let r = o.endA + 150; r < o.len - o.endB - 150; r += 100) {
        if (Cs(o, r, 150, i)) continue;
        const l = Te(o, r, a * (o.ht + 60));
        if (
          Xe(n.rooms, l) !== e ||
          N4(n, l, i) ||
          bu(n, l) ||
          bu(n, Te(o, r, a * (o.ht + 600)))
        )
          continue;
        const c = xe(l, t);
        (!s || c < s.d) &&
          (s = {
            g: o,
            s: r,
            side: a,
            d: c,
          });
      }
  return s;
}
export function Py(n, e) {
  let t = 0;
  const i = n.elec.filter((s) => C0.includes(s.kind));
  for (const s of n.elec.filter((o) => {
    var a;
    return Os.includes(o.kind) && !((a = o.links) != null && a.length);
  })) {
    const o = Xe(e, s);
    if (!o) continue;
    let a = i.filter((r) => Xe(e, r) === o);
    if (!a.length) {
      const r = i
          .filter(
            (c) =>
              !n.elec.some((f) => {
                var u;
                return (u = f.links) == null ? void 0 : u.includes(c.id);
              }) && xe(c, s) < 3500,
          )
          .sort((c, f) => xe(c, s) - xe(f, s)),
        l = r[0] && Xe(e, r[0]);
      a = l ? r.filter((c) => Xe(e, c) === l) : [];
    }
    a.length && ((s.links = a.map((r) => r.id)), t++);
  }
  return t;
}
export function Wy(n, e, t = yd, i = !1) {
  let s = null;
  for (const o of n.walls) {
    if (!i && o.status === "removed") continue;
    const a = _0(n, o.a),
      r = _0(n, o.b),
      l = F0(e, a, r);
    l.d <= t &&
      l.along > t &&
      l.along < l.len - t &&
      (!s || l.d < s.d) &&
      (s = {
        w: o,
        along: l.along,
        d: l.d,
      });
  }
  return s;
}
export function Y8(n, e, t = yd) {
  const i = F4(n, e, t);
  if (i) return i;
  const s = Wy(n, e, t, !0);
  return s ? bd(n, s.w, e) : Hy(n, e);
}
export function Jl(n, e, t, i) {
  const s = Y8(n, e),
    o = Y8(n, t);
  if (s === o) return [];
  const a = [
    {
      n: s,
      t: 0,
    },
    {
      n: o,
      t: 1,
    },
  ];
  for (const l of [...n.walls]) {
    if (
      l.status === "removed" ||
      [s.id, o.id].includes(l.a) ||
      [s.id, o.id].includes(l.b)
    )
      continue;
    const c = _0(n, l.a),
      f = _0(n, l.b),
      u = by(s, o, c, f);
    u &&
      u.t > 1e-4 &&
      u.t < 1 - 1e-4 &&
      u.u > 1e-4 &&
      u.u < 1 - 1e-4 &&
      a.push({
        n: bd(n, l, u),
        t: u.t,
      });
  }
  for (const l of n.nodes) {
    if (a.some((f) => f.n === l) || !Wr(n, l.id).length) continue;
    const c = F0(l, s, o);
    c.t > 1e-4 &&
      c.t < 1 - 1e-4 &&
      c.d < yd &&
      a.push({
        n: l,
        t: c.t,
      });
  }
  a.sort((l, c) => l.t - c.t);
  const r = [];
  for (let l = 0; l < a.length - 1; l++) {
    const c = a[l].n,
      f = a[l + 1].n;
    if (c === f) continue;
    const u = n.walls.find(
      (p) => (p.a === c.id && p.b === f.id) || (p.a === f.id && p.b === c.id),
    );
    if (u) {
      u.status === "removed" && i.status === "new" && (u.status = "existing");
      continue;
    }
    const h = {
      id: Ut(),
      a: c.id,
      b: f.id,
      ...i,
    };
    (n.walls.push(h), r.push(h));
  }
  return r;
}
export function xd() {
  return {
    version: 2,
    name: "新户型",
    height: 2800,
    phase: "original",
    nodes: [],
    walls: [],
    openings: [],
    furniture: [],
    structs: [],
    beams: [],
    rooms: [],
    measures: [],
    elec: [],
    prices: {},
  };
}
export const mp = [
  {
    name: "哈尔滨",
    lat: 45.8,
  },
  {
    name: "乌鲁木齐",
    lat: 43.8,
  },
  {
    name: "沈阳",
    lat: 41.8,
  },
  {
    name: "北京",
    lat: 39.9,
  },
  {
    name: "天津",
    lat: 39.1,
  },
  {
    name: "济南",
    lat: 36.7,
  },
  {
    name: "青岛",
    lat: 36.1,
  },
  {
    name: "西安",
    lat: 34.3,
  },
  {
    name: "郑州",
    lat: 34.7,
  },
  {
    name: "南京",
    lat: 32.1,
  },
  {
    name: "合肥",
    lat: 31.8,
  },
  {
    name: "上海",
    lat: 31.2,
  },
  {
    name: "成都",
    lat: 30.7,
  },
  {
    name: "武汉",
    lat: 30.6,
  },
  {
    name: "杭州",
    lat: 30.3,
  },
  {
    name: "重庆",
    lat: 29.6,
  },
  {
    name: "长沙",
    lat: 28.2,
  },
  {
    name: "南昌",
    lat: 28.7,
  },
  {
    name: "贵阳",
    lat: 26.6,
  },
  {
    name: "福州",
    lat: 26.1,
  },
  {
    name: "昆明",
    lat: 25,
  },
  {
    name: "台北",
    lat: 25,
  },
  {
    name: "厦门",
    lat: 24.5,
  },
  {
    name: "广州",
    lat: 23.1,
  },
  {
    name: "深圳",
    lat: 22.5,
  },
  {
    name: "香港",
    lat: 22.3,
  },
  {
    name: "南宁",
    lat: 22.8,
  },
  {
    name: "海口",
    lat: 20,
  },
  {
    name: "三亚",
    lat: 18.3,
  },
];
export const Zm = 40;
export const rr = (n) => ({
  x: Vr(n[0]),
  y: Vr(n[1]),
});
export function Jm(n, e) {
  const t = F4(n, e, Zm);
  if (t)
    return {
      x: t.x,
      y: t.y,
    };
  const i = Wy(n, e, Zm, !0);
  if (i) {
    const s = n.nodes.find((r) => r.id === i.w.a),
      o = n.nodes.find((r) => r.id === i.w.b),
      a = F0(e, s, o).foot;
    return {
      x: Vr(a.x),
      y: Vr(a.y),
    };
  }
  return e;
}
export function dP(n, e) {
  const t = (s) => n.nodes.find((o) => o.id === s),
    i = n.walls.filter((s) => s.status !== "removed");
  for (const s of i) {
    if (e.has(s) || s.align) continue;
    const o = t(s.a),
      a = t(s.b),
      r = xe(o, a);
    if (r < 1) continue;
    const l = {
        x: (a.x - o.x) / r,
        y: (a.y - o.y) / r,
      },
      c = {
        x: -l.y,
        y: l.x,
      };
    for (const [f, u] of [
      [s.a, l],
      [
        s.b,
        {
          x: -l.x,
          y: -l.y,
        },
      ],
    ]) {
      const h = t(f),
        p = (m) => {
          const g = t(m.a === f ? m.b : m.a),
            v = xe(h, g) || 1;
          return {
            x: (g.x - h.x) / v,
            y: (g.y - h.y) / v,
          };
        },
        d = i.filter((m) => m !== s && (m.a === f || m.b === f));
      if (
        !d.some((m) => {
          const g = p(m);
          return m.t > s.t + 1 && g.x * u.x + g.y * u.y < -0.999;
        })
      )
        continue;
      const y = new Set();
      for (const m of d) {
        const g = p(m);
        Math.abs(g.x * u.x + g.y * u.y) < 0.9 &&
          y.add(Math.sign(g.x * c.x + g.y * c.y));
      }
      if (y.size === 1) {
        s.align = -[...y][0];
        break;
      }
    }
  }
}
export function Gb(n) {
  var f;
  const e = (n.furniture || []).filter((u) => !q0[u.key]).map((u) => u.key);
  if (e.length)
    throw new Error(
      `家具库缺少：${[...new Set(e)].join("、")}。请补齐后重新生成。`,
    );
  const t = xd();
  if (
    ((t.name = n.name || "我的户型"),
    (t.height = n.height || 2800),
    (t.phase = n.phase || "renovate"),
    n.north !== void 0 && (t.north = n.north),
    n.site)
  ) {
    const u = mp.find((h) => h.name === n.site.city);
    t.site = {
      city: n.site.city || (u == null ? void 0 : u.name) || "",
      lat: n.site.lat ?? (u == null ? void 0 : u.lat) ?? 31.2,
      month: n.site.month ?? 9,
    };
  }
  (n.mep &&
    (t.mep = {
      ...(n.mep.power
        ? {
            power: n.mep.power,
          }
        : {}),
      ...(n.mep.water
        ? {
            water: n.mep.water,
          }
        : {}),
      ...(n.mep.floorStyle
        ? {
            floorStyle: n.mep.floorStyle,
          }
        : {}),
      ...((f = n.mep.custom) != null && f.length
        ? {
            custom: n.mep.custom.map((u) => ({
              ...u,
              id: Ut(),
              pts: u.pts.map(([h, p]) => ({
                x: h,
                y: p,
              })),
            })),
          }
        : {}),
    }),
    n.look &&
      (t.look = {
        style: "real",
        palette: "plan",
        glow: !0,
        labels: !0,
        round: !0,
        ...n.look,
      }));
  const i = [];
  n = {
    ...n,
    walls: n.walls.map((u) => {
      var h;
      return (h = u.openings) != null && h.some((p) => p.type === "bayInner")
        ? {
            ...u,
            openings: u.openings.map((p) => {
              if (p.type !== "bayInner") return p;
              const [d, y] = u.a,
                [m, g] = u.b,
                v = Math.abs(g - y) < Math.abs(m - d),
                w = u.t ?? 120,
                x = p.depth ?? 500,
                b = (p.from + p.to) / 2,
                M = Math.abs(p.to - p.from),
                T = v
                  ? [b, y + (d === m ? 0 : ((b - d) / (m - d)) * (g - y))]
                  : [d + (y === g ? 0 : ((b - y) / (g - y)) * (m - d)), b],
                k =
                  (p.into &&
                    Math.sign(v ? p.into[1] - T[1] : p.into[0] - T[0])) ||
                  1,
                S = w / 2 + x / 2;
              i.push(
                v
                  ? {
                      key: "bayDeck",
                      at: [Math.round(T[0]), Math.round(T[1] + k * S)],
                      rot: k > 0 ? 0 : 180,
                      w: M,
                      d: x,
                      h: p.sill ?? 450,
                    }
                  : {
                      key: "bayDeck",
                      at: [Math.round(T[0] + k * S), Math.round(T[1])],
                      rot: k > 0 ? -90 : 90,
                      w: M,
                      d: x,
                      h: p.sill ?? 450,
                    },
              );
              const { depth: E, ..._ } = p;
              return {
                ..._,
                type: "window",
                sill: p.sill ?? 450,
              };
            }),
          }
        : u;
    }),
    furniture: [...(n.furniture || []), ...i],
  };
  const s = [];
  for (const u of n.walls) {
    let h = rr(u.a),
      p = rr(u.b);
    const d = u.t ?? 120;
    if (((h = Jm(t, h)), (p = Jm(t, p)), xe(h, p) < 10)) continue;
    const y = u.bearingFrom ?? (u.bearing === void 0 ? "inferred" : void 0);
    Jl(t, h, p, {
      t: d,
      bearing: u.bearing ?? d >= 180,
      status: u.status ?? "existing",
      ...(y
        ? {
            bearingFrom: y,
          }
        : {}),
    });
    const m = xe(h, p),
      g = {
        x: (p.x - h.x) / m,
        y: (p.y - h.y) / m,
      },
      v = Math.abs(g.y) < 0.001,
      w = Math.abs(g.x) < 0.001;
    for (const x of u.openings || []) {
      const b = (k) =>
        v ? (k - h.x) * Math.sign(g.x) : w ? (k - h.y) * Math.sign(g.y) : k;
      let M = b(x.from),
        T = b(x.to);
      (M > T && ([M, T] = [T, M]),
        s.push({
          c: {
            x: h.x + (g.x * (M + T)) / 2,
            y: h.y + (g.y * (M + T)) / 2,
          },
          width: T - M,
          o: x,
          u: g,
          a0: h,
          s0: M,
          s1: T,
        }));
    }
  }
  Vc(t);
  const o = (u) => t.nodes.find((h) => h.id === u),
    a = {
      N: {
        x: 0,
        y: -1,
      },
      S: {
        x: 0,
        y: 1,
      },
      E: {
        x: 1,
        y: 0,
      },
      W: {
        x: -1,
        y: 0,
      },
    },
    r = new Set();
  for (const u of n.walls) {
    if (!u.flush) continue;
    const h = u.flush === "C" ? null : a[u.flush],
      p = rr(u.a),
      d = rr(u.b);
    for (const y of t.walls) {
      const m = o(y.a),
        g = o(y.b),
        v = F0(m, p, d),
        w = F0(g, p, d);
      if (
        v.d > 30 ||
        w.d > 30 ||
        v.along < -30 ||
        w.along < -30 ||
        v.along > v.len + 30 ||
        w.along > w.len + 30
      )
        continue;
      const x = xe(m, g);
      if (x < 1) continue;
      if ((r.add(y), !h)) {
        delete y.align;
        continue;
      }
      const b = (-(g.y - m.y) * h.x + (g.x - m.x) * h.y) / x;
      Math.abs(b) > 0.5 && (y.align = b > 0 ? 1 : -1);
    }
  }
  dP(t, r);
  const l = [];
  for (const u of s) {
    const { o: h, u: p, a0: d, s0: y, s1: m } = u;
    if (
      ![
        "glassWall",
        "window",
        "slideWindow",
        "floorWindow",
        "highWindow",
      ].includes(h.type) ||
      m - y < 1500
    ) {
      l.push(u);
      continue;
    }
    const g = [];
    for (const v of t.walls) {
      const w = o(v.a),
        x = o(v.b),
        b = F0(w, d, {
          x: d.x + p.x,
          y: d.y + p.y,
        }),
        M = F0(x, d, {
          x: d.x + p.x,
          y: d.y + p.y,
        });
      if (b.d > v.t / 2 + 20 || M.d > v.t / 2 + 20) continue;
      const T = (w.x - d.x) * p.x + (w.y - d.y) * p.y,
        k = (x.x - d.x) * p.x + (x.y - d.y) * p.y,
        S = Math.min(T, k),
        E = Math.max(T, k);
      E > y + 1 && S < m - 1 && g.push([S, E]);
    }
    if (g.length < 2) {
      l.push(u);
      continue;
    }
    for (const [v, w] of g.sort((x, b) => x[0] - b[0])) {
      const x = Math.max(y, v) + (v > y + 1 ? 80 : 0),
        b = Math.min(m, w) - (w < m - 1 ? 80 : 0);
      b - x < 300 ||
        l.push({
          ...u,
          c: {
            x: d.x + (p.x * (x + b)) / 2,
            y: d.y + (p.y * (x + b)) / 2,
          },
          width: b - x,
          s0: x,
          s1: b,
        });
    }
  }
  for (const { c: u, width: h, o: p, u: d } of l) {
    let y = null;
    for (const A of t.walls) {
      const P = F0(u, o(A.a), o(A.b));
      P.along >= 0 &&
        P.along <= P.len &&
        P.d < A.t / 2 + 20 &&
        (!y || P.d < y.d) &&
        (y = {
          w: A,
          along: P.along,
          d: P.d,
        });
    }
    if (!y) continue;
    const m = o(y.w.a),
      g = o(y.w.b),
      v = xe(m, g),
      w = {
        x: (g.x - m.x) / v,
        y: (g.y - m.y) / v,
      },
      x = {
        x: -w.y,
        y: w.x,
      },
      b = w.x * d.x + w.y * d.y > 0,
      M = (p.hinge ?? "from") === "from",
      T = b === M ? 0 : 1;
    let k = 1;
    if (p.into) {
      const A = rr(p.into);
      k = (A.x - u.x) * x.x + (A.y - u.y) * x.y >= 0 ? 1 : -1;
    }
    const S = p.type,
      E = ii[S] || ii.door,
      _ = {
        id: Ut(),
        wall: y.w.id,
        type: S,
        pos: y.along,
        width: Vr(h),
        sill: p.sill ?? E.sill,
        head: p.head ?? E.head,
        hinge: T,
        side: k,
      };
    (p.type === "hole" &&
      _.sill >= 900 &&
      p.head === void 0 &&
      (_.head = t.height),
      p.entry && (_.entry = !0),
      p.name && (_.name = p.name),
      p.material && (_.material = p.material),
      p.fireRating && (_.fireRating = p.fireRating),
      t.openings.push(_));
  }
  ((t.voids = (n.voids || []).map((u) => {
    const [h, p, d, y] = u.rect;
    return {
      id: Ut(),
      x: Math.min(h, d),
      y: Math.min(p, y),
      w: Math.abs(d - h),
      h: Math.abs(y - p),
      depth: u.depth ?? 0,
      name: u.name || (u.shaft ? "电梯井" : u.depth ? "下沉区" : "挑空"),
      ...(u.shaft
        ? {
            shaft: !0,
          }
        : {}),
    };
  })),
    (t.rooms = (n.rooms || []).map((u) => {
      const h = {
        id: Ut(),
        x: u.at[0],
        y: u.at[1],
        name: u.name,
        mat: u.mat || mP(u.name),
      };
      return (
        u.wallMat && (h.wallMat = u.wallMat),
        u.tile &&
          (h.tile = {
            ...B4,
            ...u.tile,
          }),
        u.skirting && (h.skirting = u.skirting),
        u.ceil
          ? (h.ceil = {
              type: "none",
              drop: 0,
              edgeW: 400,
              cove: !1,
              ...u.ceil,
            })
          : /卫|厨/.test(u.name) &&
            (h.wallMat || (h.wallMat = "wallTile"),
            (h.ceil = {
              type: "flat",
              drop: 300,
              edgeW: 400,
              cove: !1,
            })),
        h
      );
    })),
    (t.structs = (n.structs || [])
      .filter((u) => Q0[u.kind])
      .map((u) => ({
        id: Ut(),
        kind: u.kind,
        x: u.at[0],
        y: u.at[1],
        w: u.w ?? Q0[u.kind].w,
        d: u.d ?? Q0[u.kind].d,
        rot: u.rot ?? 0,
      }))),
    (t.beams = (n.beams || []).map((u) => ({
      id: Ut(),
      a: rr(u.a),
      b: rr(u.b),
      w: u.w ?? 200,
      depth: u.depth ?? 400,
    }))),
    (t.furniture = (n.furniture || [])
      .filter((u) => q0[u.key])
      .map((u) => {
        var d, y;
        const h = {};
        for (const m of [
          "w",
          "d",
          "h",
          "z",
          "name",
          "color",
          "price",
          "brand",
          "kit",
          "opt",
        ])
          u[m] !== void 0 && (h[m] = u[m]);
        const p = Hc(u.key, u.at[0], u.at[1], u.rot ?? 0, h);
        return (
          u.cab &&
            p.cab &&
            (p.cab = {
              ...p.cab,
              ...u.cab,
            }),
          n.style &&
          cs[n.style] &&
          tf.includes(p.type) &&
          !((d = u.opt) != null && d.style) &&
          !u.color
            ? $r(p, n.style)
            : typeof ((y = u.opt) == null ? void 0 : y.style) == "string" &&
              !u.color &&
              $r(p, u.opt.style),
          p
        );
      })),
    wP(t),
    yP(t));
  const c = new Map();
  if (
    ((t.elec = (n.elec || [])
      .filter((u) => mt[u.kind])
      .map((u) => {
        const h = Ut();
        return (
          u.id && c.set(u.id, h),
          {
            id: h,
            kind: u.kind,
            x: u.at[0],
            y: u.at[1],
            rot: u.rot ?? 0,
            h: u.h ?? mt[u.kind].h,
            ...(u.links
              ? {
                  links: u.links,
                }
              : {}),
          }
        );
      })),
    t.elec.forEach((u) => {
      u.links && (u.links = u.links.map((h) => c.get(h)).filter((h) => !!h));
    }),
    (t.comments = pP(n, t)),
    t.elec.length || n.autoElec)
  ) {
    const u = Wc(t),
      h = D4(t, u);
    (n.autoElec && Ry(t, u, h, !1), Py(t, h));
  }
  return t;
}
export function pP(n, e) {
  const t = [],
    i = Date.now(),
    s = (o, a, r) =>
      t.push({
        id: Ut(),
        x: Math.round(o),
        y: Math.round(a),
        author: "识图待确认",
        text: r,
        time: i,
        resolved: !1,
        replies: [],
      });
  for (const o of n.comments || []) s(o.at[0], o.at[1], o.text);
  if (n.heightFrom === "estimated") {
    const o = Wc(e).bounds;
    s(
      o.x + o.w / 2,
      o.y + o.h / 2,
      `层高 ${e.height}mm 是估的（平面图上没有标），请按实际量房 / 剖面图确认`,
    );
  }
  for (const o of n.walls)
    o.bearingFrom !== "inferred" ||
      !(o.bearing ?? (o.t ?? 120) >= 180) ||
      s(
        (o.a[0] + o.b[0]) / 2,
        (o.a[1] + o.b[1]) / 2,
        `这面墙（厚 ${o.t ?? 120}）按厚度推断为承重墙，图上没有明确标注。以物业结构图为准：原始结构阶段选中墙可改“承重墙”`,
      );
  for (const o of n.walls)
    for (const a of o.openings || []) {
      if (!a.unsure) continue;
      const r = Math.abs(o.a[1] - o.b[1]) < Math.abs(o.a[0] - o.b[0]),
        l = (a.from + a.to) / 2;
      r ? s(l, o.a[1], a.unsure) : s(o.a[0], l, a.unsure);
    }
  return t;
}
export function mP(n) {
  return /卫|厨|洗|淋浴/.test(n)
    ? "bath"
    : /车库|车位/.test(n)
      ? "epoxy"
      : /庭院|院子|花园|天井/.test(n)
        ? "paving"
        : /阳台|露台|平台/.test(n)
          ? "deck"
          : /客|餐|厅|过道|走廊|玄关|门厅/.test(n)
            ? "tile"
            : /主卧/.test(n)
              ? "walnut"
              : "oak";
}
export function yP(n) {
  const e = n.furniture.filter((s) => s.type === "free"),
    t = (s) => {
      const o = vi(s.x, s.y, s.w, s.d, s.rot),
        a = o.map((l) => l.x),
        r = o.map((l) => l.y);
      return [Math.min(...a), Math.min(...r), Math.max(...a), Math.max(...r)];
    },
    i = (s, o) =>
      Math.min(s[2], o[2]) - Math.max(s[0], o[0]) > 1 &&
      Math.min(s[3], o[3]) - Math.max(s[1], o[1]) > 1;
  for (let s = 0; s < e.length; s++)
    for (let o = s + 1; o < e.length; o++) {
      const a = e[s],
        r = e[o];
      if (!i(t(a), t(r))) continue;
      const [l, c] = a.w * a.d >= r.w * r.d ? [a, r] : [r, a];
      if (
        (Math.abs((a.z || 0) + a.h - (r.z || 0) - r.h) < 20 &&
          l.h > 40 &&
          (l.h -= 20 - Math.abs((l.z || 0) + l.h - (c.z || 0) - c.h)),
        Math.abs((a.z || 0) - (r.z || 0)) < 20 && c.h > 40)
      ) {
        const f = 20 - Math.abs((c.z || 0) - (l.z || 0));
        ((c.z = (c.z || 0) + f), (c.h -= f));
      }
    }
}
export function wP(n) {
  var t;
  const e = Wc(n);
  for (const i of n.furniture)
    if (!((t = q0[i.key]) != null && t.ceil))
      for (let s = 0; s < 3; s++) {
        let o = !1;
        for (const a of e.active)
          for (const r of [1, -1]) {
            const l = {
                x: a.n.x * r,
                y: a.n.y * r,
              },
              c = {
                x: a.a.x + l.x * a.ht,
                y: a.a.y + l.y * a.ht,
              };
            if ((i.x - c.x) * l.x + (i.y - c.y) * l.y <= 0) continue;
            let f = 1 / 0,
              u = 1 / 0,
              h = -1 / 0;
            for (const p of vi(i.x, i.y, i.w, i.d, i.rot)) {
              f = Math.min(f, (p.x - c.x) * l.x + (p.y - c.y) * l.y);
              const d = (p.x - a.a.x) * a.u.x + (p.y - a.a.y) * a.u.y;
              ((u = Math.min(u, d)), (h = Math.max(h, d)));
            }
            h < -a.extA + 20 ||
              u > a.len + a.extB - 20 ||
              (f < -0.5 &&
                f > -120 &&
                ((i.x = Math.round(i.x - f * l.x)),
                (i.y = Math.round(i.y - f * l.y)),
                (o = !0)));
          }
        if (!o) break;
      }
}
