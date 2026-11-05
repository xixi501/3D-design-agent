/** Derived from ZWD11/house-plan-designer@b94183f9 (MIT, Copyright 2026 ZWD11).
 * Scope-aware extraction: scripts/extract-upstream.mjs. See reference/upstream/LICENSE.
 * Three.js core is an npm dependency; inherited modelling helpers retain their original behaviour. */
import { on } from "./furniture-3d.js";
import { we } from "./furniture-2d.js";
export const Qu = {
  latexWhite: {
    name: "白色乳胶漆",
    color: "#f3f1ec",
  },
  latexGrey: {
    name: "浅灰乳胶漆",
    color: "#dcdad5",
  },
  latexSage: {
    name: "灰绿乳胶漆",
    color: "#c9d2c4",
  },
  latexWarm: {
    name: "奶咖乳胶漆",
    color: "#e6d9c8",
  },
  wallpaper: {
    name: "墙布",
    color: "#ece4d8",
  },
  wallTile: {
    name: "墙砖",
    color: "#e9ecee",
    tex: "wallTile",
  },
  woodPanel: {
    name: "木饰面",
    color: "#b99572",
    tex: "woodPanel",
  },
};
export const C4 = {
  none: "不吊顶（刷漆）",
  flat: "平顶吊顶",
  edge: "边吊（双眼皮）",
};
export const D8 = () => ({
  type: "none",
  drop: 0,
  edgeW: 400,
  cove: !1,
});
export const eM = {
  none: "无",
  wood: "实木 80mm",
  metal: "金属 40mm",
};
export const $y = {
  grid: "直铺（对缝）",
  half: "工字铺（1/2 错缝）",
  third: "1/3 错缝",
  diag: "斜铺 45°",
  herring: "人字拼",
  basket: "田字编织",
  checker: "双色棋盘",
  random: "随机错缝（木纹砖）",
};
export const BM = {
  plain: "素色",
  marble: "大理石纹",
  stone: "石纹",
  wood: "木纹",
  terrazzo: "水磨石",
  cement: "水泥灰",
};
export const jy = (n, e, t = 0.5) =>
  n.rects.some(
    (i) =>
      e.x >= i.x - t &&
      e.x <= i.x + i.w + t &&
      e.y >= i.y - t &&
      e.y <= i.y + i.h + t,
  );
export function e6(n, e) {
  let t = !1;
  for (let i = 0, s = n.length - 1; i < n.length; s = i++) {
    const o = n[i],
      a = n[s];
    o.y > e.y != a.y > e.y &&
      e.x < ((a.x - o.x) * (e.y - o.y)) / (a.y - o.y) + o.x &&
      (t = !t);
  }
  return t;
}
export const t6 = new WeakMap();
export function HM(n) {
  let e = t6.get(n);
  if (e) return e;
  e = [];
  for (const t of n.rects)
    for (const i of [
      {
        x: t.x,
        y: t.y,
      },
      {
        x: t.x + t.w,
        y: t.y,
      },
      {
        x: t.x,
        y: t.y + t.h,
      },
      {
        x: t.x + t.w,
        y: t.y + t.h,
      },
    ])
      [
        [2, 2],
        [-2, 2],
        [2, -2],
        [-2, -2],
      ].filter(([o, a]) =>
        jy(
          n,
          {
            x: i.x + o,
            y: i.y + a,
          },
          0,
        ),
      ).length === 3 &&
        !e.some((o) => Math.abs(o.x - i.x) < 1 && Math.abs(o.y - i.y) < 1) &&
        e.push(i);
  return (t6.set(n, e), e);
}
export const vf = new Map();
export function wd(n, e) {
  const t =
      JSON.stringify(e) +
      "|" +
      n.rects
        .map((I) => [I.x, I.y, I.w, I.h].map(Math.round).join(","))
        .join(";"),
    i = vf.get(t);
  if (i) return i;
  vf.size > 200 && vf.clear();
  const s = e,
    o = Math.max(0, s.gap),
    a = Math.max(20, s.w),
    r = Math.max(20, s.h),
    l =
      (((s.pattern === "diag" || s.pattern === "herring" ? 45 : 0) +
        (s.rot || 0)) *
        Math.PI) /
      180,
    c = Math.cos(l),
    f = Math.sin(l),
    u = n.bb,
    h =
      s.pattern === "grid" || s.pattern === "checker" || s.pattern === "diag"
        ? {
            u: a / 2,
            v: r / 2,
          }
        : {
            u: 0,
            v: 0,
          },
    p =
      s.origin === "corner"
        ? {
            x: u.x + (s.ox || 0),
            y: u.y + (s.oy || 0),
          }
        : {
            x: u.x + u.w / 2 - (h.u * c - h.v * f) + (s.ox || 0),
            y: u.y + u.h / 2 - (h.u * f + h.v * c) + (s.oy || 0),
          },
    d = (I, B) => ({
      x: p.x + I * c - B * f,
      y: p.y + I * f + B * c,
    });
  let y = 1 / 0,
    m = -1 / 0,
    g = 1 / 0,
    v = -1 / 0;
  for (const I of [
    [u.x, u.y],
    [u.x + u.w, u.y],
    [u.x, u.y + u.h],
    [u.x + u.w, u.y + u.h],
  ]) {
    const B = I[0] - p.x,
      z = I[1] - p.y,
      V = B * c + z * f,
      W = -B * f + z * c;
    ((y = Math.min(y, V)),
      (m = Math.max(m, V)),
      (g = Math.min(g, W)),
      (v = Math.max(v, W)));
  }
  const w = [],
    x = a + o,
    b = r + o,
    M = (I, B, z, V = 2) => {
      for (let W = Math.floor(g / z) - V; W <= Math.ceil(v / z) + V; W++)
        for (let K = Math.floor(y / B) - V; K <= Math.ceil(m / B) + V; K++)
          I(K, W);
    },
    T = (I, B, z = 0) =>
      ((I * 73856093) ^ (B * 19349663) ^ (z * 83492791)) >>> 0;
  if (s.pattern === "grid" || s.pattern === "diag" || s.pattern === "checker")
    M(
      (I, B) =>
        w.push({
          u: I * x,
          v: B * b,
          w: a,
          h: r,
          col: s.pattern === "checker" && (I + B) % 2 ? 1 : 0,
          seed: T(I, B),
        }),
      x,
      b,
    );
  else if (
    s.pattern === "half" ||
    s.pattern === "third" ||
    s.pattern === "random"
  ) {
    const I = s.pattern === "half" ? 0.5 : 0.3333333333333333;
    M(
      (B, z) => {
        const V =
          s.pattern === "random"
            ? on(T(7, z))() * x
            : ((((z % (s.pattern === "half" ? 2 : 3)) + 3) % 3) * I * x) % x;
        w.push({
          u: B * x + V,
          v: z * b,
          w: a,
          h: r,
          col: 0,
          seed: T(B, z),
        });
      },
      x,
      b,
      3,
    );
  } else if (s.pattern === "basket") {
    const I = Math.max(a, r),
      B = Math.min(a, r),
      z = Math.max(1, Math.round((I + o) / (B + o))),
      V = I + o;
    M(
      (W, K) => {
        for (let C = 0; C < z; C++)
          (W + K) % 2 === 0
            ? w.push({
                u: W * V,
                v: K * V + C * (B + o),
                w: I,
                h: B,
                col: 0,
                seed: T(W, K, C),
              })
            : w.push({
                u: W * V + C * (B + o),
                v: K * V,
                w: B,
                h: I,
                col: 0,
                seed: T(W, K, C),
              });
      },
      V,
      V,
    );
  } else if (s.pattern === "herring") {
    const I = Math.max(a, r),
      B = Math.min(a, r),
      z = B + o,
      V = I + o,
      W = (U, q) => ({
        k: (U + q) / (2 * z),
        m: (U - q) / (2 * V),
      });
    let K = 1 / 0,
      C = -1 / 0,
      F = 1 / 0,
      G = -1 / 0;
    for (const [U, q] of [
      [y, g],
      [m, g],
      [y, v],
      [m, v],
    ]) {
      const Q = W(U, q);
      ((K = Math.min(K, Q.k)),
        (C = Math.max(C, Q.k)),
        (F = Math.min(F, Q.m)),
        (G = Math.max(G, Q.m)));
    }
    for (let U = Math.floor(F) - 2; U <= Math.ceil(G) + 2; U++)
      for (
        let q = Math.floor(K) - Math.ceil(I / z) - 2;
        q <= Math.ceil(C) + 2;
        q++
      ) {
        const Q = q * z + U * V,
          j = q * z - U * V;
        (w.push({
          u: Q,
          v: j,
          w: I,
          h: B,
          col: 0,
          seed: T(q, U, 1),
        }),
          w.push({
            u: Q,
            v: j + z,
            w: B,
            h: I,
            col: 0,
            seed: T(q, U, 2),
          }));
      }
  }
  const k = [];
  let S = 0,
    E = 0;
  const _ = u.x,
    A = u.y,
    P = u.x + u.w,
    D = u.y + u.h;
  for (const I of w) {
    if (I.u + I.w < y - 1 || I.u > m + 1 || I.v + I.h < g - 1 || I.v > v + 1)
      continue;
    const B = [
        d(I.u, I.v),
        d(I.u + I.w, I.v),
        d(I.u + I.w, I.v + I.h),
        d(I.u, I.v + I.h),
      ],
      z = B.map((F) => F.x),
      V = B.map((F) => F.y);
    if (
      Math.max(...z) < _ ||
      Math.min(...z) > P ||
      Math.max(...V) < A ||
      Math.min(...V) > D
    )
      continue;
    const W = [
        ...B,
        d(I.u + I.w / 2, I.v + I.h / 2),
        d(I.u + I.w / 2, I.v),
        d(I.u + I.w / 2, I.v + I.h),
        d(I.u, I.v + I.h / 2),
        d(I.u + I.w, I.v + I.h / 2),
      ],
      K = W.filter((F) => jy(n, F)).length;
    let C = K === W.length;
    (C && HM(n).some((F) => e6(B, F)) && (C = !1),
      !(
        !K &&
        !n.rects.some((F) =>
          [
            {
              x: F.x + 1,
              y: F.y + 1,
            },
            {
              x: F.x + F.w - 1,
              y: F.y + 1,
            },
            {
              x: F.x + 1,
              y: F.y + F.h - 1,
            },
            {
              x: F.x + F.w - 1,
              y: F.y + F.h - 1,
            },
          ].some((G) => e6(B, G)),
        )
      ) &&
        (C ? S++ : E++,
        k.push({
          pts: B,
          col: I.col,
          seed: I.seed,
          whole: C,
          o: B[0],
          ang: l,
          w: I.w,
          h: I.h,
        })));
  }
  const O = {
    tiles: k,
    whole: S,
    cut: E,
    total: Math.ceil((S + E) * 1.03),
    ang: l,
  };
  return (vf.set(t, O), O);
}
export const je = 512;
export function eh(n, e, t, i, s, o = 0) {
  const a = on(s),
    r = je / e;
  for (let l = 0; l < e; l++) {
    const c = l * r;
    let f = a() * je;
    const u = f;
    for (; f < u + je;) {
      const h = je * (0.35 + a() * 0.4),
        p = t[Math.floor(a() * t.length)];
      for (const d of [0, -je]) {
        ((n.fillStyle = p),
          n.fillRect(f + d, c, h, r),
          (n.globalAlpha = 0.12),
          (n.strokeStyle = we(p, -0.35)),
          (n.lineWidth = 1));
        for (let y = 0; y < 4; y++) {
          const m = c + 3 + a() * (r - 6);
          (n.beginPath(),
            n.moveTo(f + d, m),
            n.bezierCurveTo(
              f + d + h * 0.3,
              m + (a() - 0.5) * 4,
              f + d + h * 0.7,
              m + (a() - 0.5) * 4,
              f + d + h,
              m,
            ),
            n.stroke());
        }
        ((n.globalAlpha = 1), (n.fillStyle = i), n.fillRect(f + d, c, 1.5, r));
      }
      f += h;
    }
    ((n.fillStyle = i), n.fillRect(0, c, je, o || 1.5));
  }
}
export function m9(n, e, t, i, s, o) {
  const a = on(s),
    r = je / e;
  for (let c = 0; c < e; c++)
    for (let f = 0; f < e; f++) {
      ((n.fillStyle = we(t, (a() - 0.5) * 0.05)),
        n.fillRect(c * r, f * r, r, r),
        (n.globalAlpha = 0.07));
      for (let u = 0; u < 500; u++)
        ((n.fillStyle = a() > 0.5 ? "#000" : "#fff"),
          n.fillRect(c * r + a() * r, f * r + a() * r, 1.5, 1.5));
      n.globalAlpha = 1;
    }
  n.fillStyle = i;
  const l = o / 2;
  for (let c = 0; c <= e; c++)
    (n.fillRect(c * r - l / 2, 0, l, je), n.fillRect(0, c * r - l / 2, je, l));
}
export const Ko = {
  oak: {
    name: "橡木地板",
    tile: 1200,
    rough: 0.7,
    make: (n) =>
      eh(
        n,
        8,
        ["#d4b28c", "#caa47c", "#d8b893", "#c9a57f", "#d1ad86"],
        "#a07c58",
        7,
      ),
  },
  walnut: {
    name: "胡桃木",
    tile: 1200,
    rough: 0.7,
    make: (n) =>
      eh(
        n,
        8,
        ["#7a553d", "#6a4631", "#835d43", "#5f3f2c", "#735039"],
        "#3e2a1e",
        11,
      ),
  },
  herring: {
    name: "人字拼",
    tile: 1200,
    rough: 0.7,
    make: (n) => {
      const e = on(5),
        t = ["#c9a176", "#d3ae86", "#bf966b", "#d8b58f"];
      ((n.fillStyle = "#c9a176"), n.fillRect(0, 0, je, je));
      for (let i = 0; i < 8; i++) {
        const s = i * 64,
          o = i % 2 ? 1 : -1;
        for (let a = -3; a < 19; a++) {
          const r = a * 32;
          (n.beginPath(),
            o > 0
              ? (n.moveTo(s, r),
                n.lineTo(s + 64, r + 64),
                n.lineTo(s + 64, r + 96),
                n.lineTo(s, r + 32))
              : (n.moveTo(s, r + 64),
                n.lineTo(s + 64, r),
                n.lineTo(s + 64, r + 32),
                n.lineTo(s, r + 96)),
            n.closePath(),
            (n.fillStyle = t[(i * 7 + (((a % 16) + 16) % 16) * 3) % 4]),
            n.fill(),
            (n.strokeStyle = "#9b7552"),
            (n.lineWidth = 1.2),
            n.stroke());
        }
      }
      n.globalAlpha = 0.08;
      for (let i = 0; i < 900; i++)
        ((n.fillStyle = e() > 0.5 ? "#000" : "#fff"),
          n.fillRect(e() * je, e() * je, 2, 1));
      n.globalAlpha = 1;
    },
  },
  tile: {
    name: "灰白大板",
    tile: 1600,
    rough: 0.45,
    make: (n) => m9(n, 2, "#e8e6e2", "#c9c5bf", 3, 10),
  },
  marble: {
    name: "米白大理石",
    tile: 1600,
    rough: 0.25,
    make: (n) => {
      const e = on(21);
      ((n.fillStyle = "#f1ece3"), n.fillRect(0, 0, je, je));
      for (let t = 0; t < 14; t++) {
        ((n.strokeStyle = `rgba(${140 + e() * 30},${130 + e() * 25},${115 + e() * 20},${0.18 + e() * 0.25})`),
          (n.lineWidth = 0.6 + e() * 2.2),
          n.beginPath());
        let i = e() * je,
          s = e() * je;
        n.moveTo(i, s);
        for (let o = 0; o < 5; o++) {
          const a = i + (e() - 0.3) * 180,
            r = s + (e() - 0.5) * 140;
          (n.quadraticCurveTo(
            (i + a) / 2 + (e() - 0.5) * 60,
            (s + r) / 2 + (e() - 0.5) * 60,
            a,
            r,
          ),
            (i = a),
            (s = r));
        }
        n.stroke();
      }
      ((n.fillStyle = "#d8d1c4"),
        n.fillRect(0, 0, je, 1.5),
        n.fillRect(0, je / 2, je, 1.5),
        n.fillRect(0, 0, 1.5, je),
        n.fillRect(je / 2, 0, 1.5, je));
    },
  },
  paving: {
    name: "庭院石材",
    tile: 1200,
    rough: 0.85,
    make: (n) => m9(n, 2, "#cfc8bb", "#9f988c", 7, 22),
  },
  grass: {
    name: "草坪",
    tile: 1600,
    rough: 1,
    make: (n) => {
      const e = on(41);
      ((n.fillStyle = "#7fae5a"), n.fillRect(0, 0, je, je));
      for (let t = 0; t < 5e3; t++) {
        n.fillStyle = ["#6f9f4c", "#8fbd66", "#79a855", "#9cc472"][t % 4];
        const i = e() * je,
          s = e() * je;
        n.fillRect(i, s, 1.5, 3 + e() * 4);
      }
    },
  },
  epoxy: {
    name: "环氧地坪",
    tile: 2400,
    rough: 0.35,
    make: (n) => {
      const e = on(52);
      ((n.fillStyle = "#9aa3a6"), n.fillRect(0, 0, je, je));
      for (let t = 0; t < 2500; t++)
        ((n.fillStyle =
          e() > 0.5 ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.06)"),
          n.fillRect(e() * je, e() * je, 2, 2));
    },
  },
  cement: {
    name: "微水泥",
    tile: 2400,
    rough: 0.7,
    make: (n) => {
      const e = on(33);
      ((n.fillStyle = "#bdb9b2"), n.fillRect(0, 0, je, je));
      for (let t = 0; t < 60; t++) {
        const i = e() * je,
          s = e() * je,
          o = 20 + e() * 90,
          a = n.createRadialGradient(i, s, 0, i, s, o),
          r = e() * 0.12;
        (a.addColorStop(
          0,
          e() > 0.5 ? `rgba(255,255,255,${r})` : `rgba(60,55,50,${r})`,
        ),
          a.addColorStop(1, "rgba(0,0,0,0)"),
          (n.fillStyle = a),
          n.fillRect(i - o, s - o, o * 2, o * 2));
      }
      n.globalAlpha = 0.1;
      for (let t = 0; t < 2500; t++)
        ((n.fillStyle = e() > 0.5 ? "#000" : "#fff"),
          n.fillRect(e() * je, e() * je, 1, 1));
      n.globalAlpha = 1;
    },
  },
  carpet: {
    name: "方块地毯",
    tile: 1e3,
    rough: 1,
    make: (n) => {
      const e = on(77);
      ((n.fillStyle = "#7b8088"), n.fillRect(0, 0, je, je));
      for (let t = 0; t < 9e3; t++)
        ((n.fillStyle =
          e() > 0.5 ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.08)"),
          n.fillRect(e() * je, e() * je, 1.5, 1.5));
      ((n.strokeStyle = "rgba(40,44,50,.10)"), (n.lineWidth = 1));
      for (let t = 0; t < 2; t++)
        for (let i = 0; i < 2; i++) {
          const s = (t * je) / 2,
            o = (i * je) / 2,
            a = (t + i) % 2;
          for (let r = 4; r < je / 2; r += 6)
            (n.beginPath(),
              a
                ? (n.moveTo(s + r, o), n.lineTo(s + r, o + je / 2))
                : (n.moveTo(s, o + r), n.lineTo(s + je / 2, o + r)),
              n.stroke());
        }
      ((n.fillStyle = "rgba(30,34,40,.25)"),
        n.fillRect(0, 0, je, 1),
        n.fillRect(0, je / 2, je, 1),
        n.fillRect(0, 0, 1, je),
        n.fillRect(je / 2, 0, 1, je));
    },
  },
  bath: {
    name: "防滑砖 300",
    tile: 1200,
    rough: 0.6,
    make: (n) => m9(n, 4, "#d2d8db", "#a9b1b5", 5, 7),
  },
  terrazzo: {
    name: "水磨石",
    tile: 1200,
    rough: 0.4,
    make: (n) => {
      const e = on(9);
      ((n.fillStyle = "#e7e3dc"), n.fillRect(0, 0, je, je));
      const t = [
        "#8a8f96",
        "#c9b8a4",
        "#6d6a66",
        "#b8c2c8",
        "#d9cfc1",
        "#9b8a78",
      ];
      for (let i = 0; i < 1400; i++) {
        n.fillStyle = t[Math.floor(e() * t.length)];
        const s = e() * je,
          o = e() * je,
          a = 1 + e() * 4;
        (n.beginPath(),
          n.ellipse(s, o, a, a * (0.5 + e() * 0.5), e() * 3, 0, 7),
          n.fill());
      }
    },
  },
  deck: {
    name: "户外木塑",
    tile: 1400,
    rough: 0.8,
    make: (n) => {
      ((n.fillStyle = "#4b3a2d"),
        n.fillRect(0, 0, je, je),
        eh(
          n,
          10,
          ["#8d6a4f", "#94705a", "#86644a", "#9a7760"],
          "#4b3a2d",
          17,
          4,
        ));
    },
  },
};
export const g9 = {};
export function zd(n) {
  if ((Ko[n] || (n = "oak"), !g9[n])) {
    const e = document.createElement("canvas");
    ((e.width = e.height = je), Ko[n].make(e.getContext("2d")), (g9[n] = e));
  }
  return g9[n];
}
export const h7 = new WeakMap();
export function Mv(n, e) {
  Ko[e] || (e = "oak");
  let t = h7.get(n);
  if ((t || ((t = {}), h7.set(n, t)), !t[e])) {
    const i = n.createPattern(zd(e), "repeat"),
      s = Ko[e].tile / je;
    (i.setTransform(new DOMMatrix([s, 0, 0, s, 0, 0])), (t[e] = i));
  }
  return t[e];
}
export const O1 = {
  wallTile: {
    tile: 1200,
    make: (n) => {
      const e = on(41);
      ((n.fillStyle = "#b9c0c4"), n.fillRect(0, 0, je, je));
      for (let t = 0; t < 4; t++)
        for (let i = 0; i < 2; i++)
          ((n.fillStyle = we("#eceff1", (e() - 0.5) * 0.04)),
            n.fillRect(i * 256 + 2, t * 128 + 2, 252, 124));
    },
  },
  woodPanel: {
    tile: 1200,
    make: (n) => {
      eh(n, 1, ["#b99572"], "#8a6a4d", 3);
      const e = on(8);
      for (let t = 0; t < 4; t++) {
        const i = t * 128;
        ((n.fillStyle = we("#b99572", (e() - 0.5) * 0.12)),
          n.fillRect(i, 0, 128, je),
          (n.globalAlpha = 0.15),
          (n.strokeStyle = "#6d4f36"));
        for (let s = 0; s < 10; s++) {
          const o = i + 6 + e() * 116;
          (n.beginPath(),
            n.moveTo(o, 0),
            n.bezierCurveTo(
              o + (e() - 0.5) * 8,
              je * 0.3,
              o + (e() - 0.5) * 8,
              je * 0.7,
              o,
              je,
            ),
            n.stroke());
        }
        ((n.globalAlpha = 1),
          (n.fillStyle = "#6d4f36"),
          n.fillRect(i, 0, 2, je));
      }
    },
  },
};
export const b9 = {};
export function Lu(n) {
  if (!b9[n]) {
    const e = document.createElement("canvas");
    ((e.width = e.height = je), O1[n].make(e.getContext("2d")), (b9[n] = e));
  }
  return b9[n];
}
export const _p = (n) => n.mat === "bath";
export const $C = (n) =>
  n.mat === "deck" || n.mat === "paving" || n.mat === "grass";
export function Ps(n) {
  if (!n) return "latexWhite";
  const e = n.wallMat;
  return e && Qu[e] ? e : _p(n) ? "wallTile" : "latexWhite";
}
export function Hd(n) {
  return n
    ? (n.skirting ?? (_p(n) || $C(n) || Ps(n) === "wallTile" ? "none" : "wood"))
    : "none";
}
export function ei(n) {
  return n
    ? (n.ceil ??
        (_p(n)
          ? {
              type: "flat",
              drop: 300,
              edgeW: 400,
              cove: !1,
            }
          : D8()))
    : D8();
}
export const L0 = 512;
export const p7 = 1200;
export const v9 = {};
export function jC(n) {
  if (v9[n]) return v9[n];
  const e = document.createElement("canvas");
  e.width = e.height = L0;
  const t = e.getContext("2d"),
    i = on(n.length * 977 + 13);
  ((t.fillStyle = "#ffffff"), t.fillRect(0, 0, L0, L0));
  const s = (o, a, r = 1.6) => {
    t.globalAlpha = a;
    for (let l = 0; l < o; l++)
      ((t.fillStyle = i() > 0.5 ? "#000" : "#888"),
        t.fillRect(i() * L0, i() * L0, r, r));
    t.globalAlpha = 1;
  };
  if (n === "plain") s(2600, 0.05);
  else if (n === "marble" || n === "stone") {
    s(1800, 0.04);
    for (let o = 0; o < (n === "marble" ? 16 : 34); o++) {
      ((t.strokeStyle = `rgba(${90 + i() * 40},${85 + i() * 35},${80 + i() * 30},${n === "marble" ? 0.12 + i() * 0.25 : 0.05 + i() * 0.1})`),
        (t.lineWidth = n === "marble" ? 0.5 + i() * 2.4 : 1 + i() * 6),
        t.beginPath());
      let a = i() * L0,
        r = i() * L0;
      t.moveTo(a, r);
      for (let l = 0; l < 6; l++) {
        const c = a + (i() - 0.3) * 200,
          f = r + (i() - 0.5) * 160;
        (t.quadraticCurveTo(
          (a + c) / 2 + (i() - 0.5) * 70,
          (r + f) / 2 + (i() - 0.5) * 70,
          c,
          f,
        ),
          (a = c),
          (r = f));
      }
      t.stroke();
    }
  } else if (n === "wood") {
    for (let o = 0; o < 90; o++) {
      const a = i() * L0;
      ((t.strokeStyle = `rgba(80,50,25,${0.05 + i() * 0.12})`),
        (t.lineWidth = 0.6 + i() * 1.8),
        t.beginPath(),
        t.moveTo(0, a),
        t.bezierCurveTo(
          L0 * 0.3,
          a + (i() - 0.5) * 14,
          L0 * 0.7,
          a + (i() - 0.5) * 14,
          L0,
          a + (i() - 0.5) * 8,
        ),
        t.stroke());
    }
    for (let o = 0; o < 5; o++) {
      const a = i() * L0,
        r = i() * L0;
      t.strokeStyle = "rgba(70,40,20,.18)";
      for (let l = 1; l < 5; l++)
        (t.beginPath(), t.ellipse(a, r, l * 7, l * 2.4, 0, 0, 7), t.stroke());
    }
  } else if (n === "terrazzo") {
    const o = [
      "#7d8188",
      "#b8a48e",
      "#5e5b57",
      "#a6b1b8",
      "#cbbfae",
      "#8d7b69",
    ];
    for (let a = 0; a < 1500; a++) {
      t.fillStyle = o[Math.floor(i() * o.length)];
      const r = 1 + i() * 5;
      (t.beginPath(),
        t.ellipse(i() * L0, i() * L0, r, r * (0.5 + i() * 0.5), i() * 3, 0, 7),
        t.fill());
    }
  } else if (n === "cement") {
    for (let o = 0; o < 70; o++) {
      const a = i() * L0,
        r = i() * L0,
        l = 20 + i() * 100,
        c = t.createRadialGradient(a, r, 0, a, r, l);
      (c.addColorStop(0, `rgba(90,85,80,${i() * 0.14})`),
        c.addColorStop(1, "rgba(0,0,0,0)"),
        (t.fillStyle = c),
        t.fillRect(a - l, r - l, l * 2, l * 2));
    }
    s(3e3, 0.08, 1);
  }
  return (v9[n] = e);
}
export function Sv(n, e, t, i, s = wd(e, t)) {
  const o = e.bb,
    a = Math.min(t.w, t.h) * i;
  if (
    ((n.fillStyle = t.grout),
    n.fillRect(o.x - 10, o.y - 10, o.w + 20, o.h + 20),
    a < 1.2)
  ) {
    ((n.fillStyle = t.color),
      (n.globalAlpha = 0.9),
      n.fillRect(o.x, o.y, o.w, o.h),
      (n.globalAlpha = 1));
    return;
  }
  const r = t.tex && a > 6 ? jC(t.tex) : null,
    l = t.gap * i < 0.9;
  for (const c of s.tiles) {
    const f = on(c.seed),
      u = c.col && t.color2 ? t.color2 : t.color;
    if (
      (n.beginPath(),
      c.pts.forEach((h, p) => (p ? n.lineTo(h.x, h.y) : n.moveTo(h.x, h.y))),
      n.closePath(),
      (n.fillStyle = we(u, (f() - 0.5) * (t.tex === "wood" ? 0.12 : 0.05))),
      n.fill(),
      r)
    ) {
      (n.save(), n.clip(), n.translate(c.o.x, c.o.y), n.rotate(c.ang));
      const h = c.w >= c.h,
        p = Math.max(c.w, c.h),
        d = Math.min(c.w, c.h);
      h || (n.translate(c.w, 0), n.rotate(Math.PI / 2));
      const y = Math.min(L0, (p / p7) * L0),
        m = Math.min(L0, (d / p7) * L0),
        g = f() * (L0 - y),
        v = f() * (L0 - m);
      ((n.globalCompositeOperation = "multiply"),
        (n.globalAlpha = t.tex === "plain" ? 0.5 : 0.75),
        n.drawImage(r, g, v, Math.max(1, y), Math.max(1, m), 0, 0, p, d),
        n.restore());
    }
    l &&
      ((n.strokeStyle = t.grout),
      (n.lineWidth = Math.max(t.gap, 0.8 / i)),
      n.stroke());
  }
}
export const m7 = new WeakMap();
export function qC(n, e) {
  const t = wd(n, e),
    i = m7.get(t);
  if (i) return i;
  const s = n.bb,
    o = Math.max(1.5, Math.max(s.w, s.h) / 2048),
    a = document.createElement("canvas");
  ((a.width = Math.max(2, Math.ceil(s.w / o))),
    (a.height = Math.max(2, Math.ceil(s.h / o))));
  const r = a.getContext("2d");
  return (
    r.setTransform(1 / o, 0, 0, 1 / o, -s.x / o, -s.y / o),
    Sv(r, n, e, 1 / o, t),
    m7.set(t, a),
    a
  );
}
