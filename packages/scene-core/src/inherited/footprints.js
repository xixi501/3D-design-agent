/** Derived from ZWD11/house-plan-designer@b94183f9 (MIT, Copyright 2026 ZWD11).
 * Scope-aware extraction: scripts/extract-upstream.mjs. See reference/upstream/LICENSE.
 * Three.js core is an npm dependency; inherited modelling helpers retain their original behaviour. */
import { qe, Ls } from "./topology.js";
export function i0(n, e, t) {
  const i = Math.cos(t),
    s = Math.sin(t);
  return {
    x: n * i - e * s,
    y: n * s + e * i,
  };
}
export function vi(n, e, t, i, s) {
  const o = s * qe;
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, r]) => {
    const l = i0((a * t) / 2, (r * i) / 2, o);
    return {
      x: n + l.x,
      y: e + l.y,
    };
  });
}
export function jw(n, e) {
  let t = 1 / 0;
  for (const i of [n, e])
    for (let s = 0; s < i.length; s++) {
      const o = i[s],
        a = i[(s + 1) % i.length],
        r = -(a.y - o.y),
        l = a.x - o.x,
        c = Math.hypot(r, l) || 1;
      let f = 1 / 0,
        u = -1 / 0,
        h = 1 / 0,
        p = -1 / 0;
      for (const y of n) {
        const m = (y.x * r + y.y * l) / c;
        ((f = Math.min(f, m)), (u = Math.max(u, m)));
      }
      for (const y of e) {
        const m = (y.x * r + y.y * l) / c;
        ((h = Math.min(h, m)), (p = Math.max(p, m)));
      }
      const d = Math.min(u, p) - Math.max(f, h);
      if (d <= 0) return 0;
      t = Math.min(t, d);
    }
  return t;
}
export const qw = ["curvedSofa", "bendSofa"];
export const vy = (n) => qw.includes(n.type);
export const bf = new Map();
export function dd(n) {
  var i, s, o, a;
  const e = JSON.stringify([
    n.type,
    n.w,
    n.d,
    (i = n.opt) == null ? void 0 : i.path,
    (s = n.opt) == null ? void 0 : s.open,
    (o = n.opt) == null ? void 0 : o.back,
    (a = n.opt) == null ? void 0 : a.flip,
  ]);
  let t = bf.get(e);
  return (t || ((t = Kw(n)), bf.size > 200 && bf.clear(), bf.set(e, t)), t);
}
export function Xw(n) {
  var f, u, h;
  const e = String(((f = n.opt) == null ? void 0 : f.path) ?? "").trim();
  if (e) {
    const p = e
      .split("|")
      .map((d) => d.split(",").map(Number))
      .filter((d) => d.length >= 2 && d.every(Number.isFinite))
      .map((d) => ({
        p: {
          x: d[0],
          y: d[1],
        },
        d: d[2] > 0 ? d[2] : 0,
      }));
    if (p.length >= 2) {
      const d = ((u = p.find((m) => m.d)) == null ? void 0 : u.d) || 900,
        y = (h = n.opt) != null && h.flip ? -1 : 1;
      return p.map((m) => ({
        p: {
          x: m.p.x * y,
          y: m.p.y,
        },
        d: m.d || d,
      }));
    }
  }
  const t = Math.min(1e3, Math.max(650, n.d * 0.75)),
    i = n.w / 2,
    s = n.d / 2,
    o = i - t / 2,
    a = Math.max(200, n.d - t / 2),
    r = [],
    l = 9,
    c = Math.PI * 0.78;
  for (let p = 0; p < l; p++) {
    const d = -Math.PI / 2 - c / 2 + (c * p) / (l - 1);
    r.push({
      p: {
        x: Math.cos(d) * o,
        y: s + Math.sin(d) * a,
      },
      d: t,
    });
  }
  return r;
}
export function Yw(n) {
  const e = [],
    t = [],
    i = (s) => n[Math.max(0, Math.min(n.length - 1, s))];
  for (let s = 0; s < n.length - 1; s++) {
    const o = i(s - 1).p,
      a = i(s).p,
      r = i(s + 1).p,
      l = i(s + 2).p,
      c = Math.hypot(r.x - a.x, r.y - a.y),
      f = Math.max(2, Math.ceil(c / 40));
    for (let u = 0; u < f; u++) {
      const h = u / f,
        p = h * h,
        d = p * h,
        y = (m, g, v, w) =>
          0.5 *
          (2 * g +
            (-m + v) * h +
            (2 * m - 5 * g + 4 * v - w) * p +
            (-m + 3 * g - 3 * v + w) * d);
      (e.push({
        x: y(o.x, a.x, r.x, l.x),
        y: y(o.y, a.y, r.y, l.y),
      }),
        t.push(i(s).d + (i(s + 1).d - i(s).d) * h));
    }
  }
  return (
    e.push({
      ...n[n.length - 1].p,
    }),
    t.push(n[n.length - 1].d),
    {
      pts: e,
      dep: t,
    }
  );
}
export function Kw(n) {
  var C, F, G;
  const { pts: e, dep: t } = Yw(Xw(n)),
    i = e.length,
    s = [],
    o = [0],
    a = (C = n.opt) != null && C.flip ? -1 : 1;
  for (let U = 0; U < i; U++) {
    const q = e[Math.max(0, U - 1)],
      Q = e[Math.min(i - 1, U + 1)],
      j = Q.x - q.x,
      te = Q.y - q.y,
      oe = Math.hypot(j, te) || 1;
    (s.push({
      x: (a * te) / oe,
      y: (-a * j) / oe,
    }),
      U &&
        o.push(
          o[U - 1] + Math.hypot(e[U].x - e[U - 1].x, e[U].y - e[U - 1].y),
        ));
  }
  const r = (U, q) => ({
      x: e[U].x + s[U].x * q,
      y: e[U].y + s[U].y * q,
    }),
    l = (U) => r(U, t[U] / 2),
    c = (U) => r(U, -t[U] / 2),
    f = (U, q) => {
      const Q = -s[U].y * q,
        j = s[U].x * q,
        te = Math.min(160, t[U] * 0.22),
        oe = [];
      for (let ce = 0; ce <= 8; ce++) {
        const X = (Math.PI * ce) / 8,
          ie = (Math.cos(X) * t[U]) / 2,
          ne = Math.sin(X) * te;
        oe.push({
          x: e[U].x + s[U].x * ie + Q * ne,
          y: e[U].y + s[U].y * ie + j * ne,
        });
      }
      return oe;
    },
    u = [
      ...Array.from(
        {
          length: i,
        },
        (U, q) => l(q),
      ),
      ...f(i - 1, 1).slice(1, -1),
      ...Array.from(
        {
          length: i,
        },
        (U, q) => c(i - 1 - q),
      ),
      ...f(0, -1).reverse().slice(1, -1),
    ],
    h = u.map((U) => U.x),
    p = u.map((U) => U.y),
    d = Math.min(...h),
    y = Math.max(...h),
    m = Math.min(...p),
    g = Math.max(...p),
    v = n.w / Math.max(1, y - d),
    w = n.d / Math.max(1, g - m),
    x = (d + y) / 2,
    b = (m + g) / 2,
    M = (U) => ({
      x: (U.x - x) * v,
      y: (U.y - b) * w,
    }),
    T = Math.sqrt(v * w),
    k =
      Math.min(
        260,
        Math.max(150, Number((F = n.opt) == null ? void 0 : F.back) || 220),
      ) * T,
    S = Math.max(0, Number((G = n.opt) == null ? void 0 : G.open) || 0),
    E = e.map(M),
    _ = t.map((U) => U * T),
    A = E.map((U, q) => {
      const Q = E[Math.max(0, q - 1)],
        j = E[Math.min(i - 1, q + 1)],
        te = j.x - Q.x,
        oe = j.y - Q.y,
        ce = Math.hypot(te, oe) || 1;
      return {
        x: (a * oe) / ce,
        y: (-a * te) / ce,
      };
    }),
    P = [0];
  for (let U = 1; U < i; U++)
    P.push(P[U - 1] + Math.hypot(E[U].x - E[U - 1].x, E[U].y - E[U - 1].y));
  const D = (U, q) => ({
      x: E[U].x + A[U].x * q,
      y: E[U].y + A[U].y * q,
    }),
    O = Math.max(
      0,
      P.findIndex((U) => U >= S * T),
    ),
    I =
      O < i - 2
        ? [
            ...Array.from(
              {
                length: i - O,
              },
              (U, q) => D(O + q, _[O + q] / 2),
            ),
            ...Array.from(
              {
                length: i - O,
              },
              (U, q) => D(i - 1 - q, _[i - 1 - q] / 2 - k),
            ),
          ]
        : [],
    B = [
      ...Array.from(
        {
          length: i,
        },
        (U, q) => D(q, q >= O && I.length ? _[q] / 2 - k : _[q] / 2 - 40),
      ),
      ...Array.from(
        {
          length: i,
        },
        (U, q) => D(i - 1 - q, -_[i - 1 - q] / 2 + 30),
      ),
    ],
    z = P[i - 1],
    V = Math.max(1, Math.round(z / 800)),
    W = Array.from(
      {
        length: V - 1,
      },
      (U, q) => (z * (q + 1)) / V,
    ),
    K = [];
  for (let U = 0; U < i - 1; U += 4) {
    const q = Math.min(i - 1, U + 4);
    K.push([D(U, _[U] / 2), D(q, _[q] / 2), D(q, -_[q] / 2), D(U, -_[U] / 2)]);
  }
  return {
    pts: E,
    dep: _,
    nrm: A,
    s: P,
    outline: u.map(M),
    back: I,
    seat: B,
    splits: W,
    quads: K,
    bk: k,
    open: S * T,
    len: z,
  };
}
export const Zw = [
  ["chair", "trainingTable"],
  ["officeChair", "trainingTable"],
  ["chair", "diningTable"],
  ["chair", "desk"],
  ["officeChair", "desk"],
  ["officeChair", "diningTable"],
  ["sideTable", "lounge"],
  ["sideTable", "sofa"],
  ["sideTable", "armchair"],
  ["sideTable", "lSofa"],
  ["barStool", "kitchenIsland"],
  ["barStool", "counter"],
  ["bin", "uCounter"],
  ["microwave", "uCounter"],
  ["microwave", "lCounter"],
  ["dishwasher", "lCounter"],
  ["dishwasher", "uCounter"],
  ["purifier", "lCounter"],
  ["purifier", "uCounter"],
  ["hood", "lCounter"],
  ["hood", "uCounter"],
  ["waterHeater", "lCounter"],
  ["waterHeater", "uCounter"],
  ["gasHeater", "lCounter"],
  ["gasHeater", "uCounter"],
  ["bedBench", "bed"],
  ["nightstand", "deskLamp"],
  ["desk", "deskLamp"],
  ["dresser", "deskLamp"],
  ["dresser", "officeChair"],
  ["dresser", "chair"],
  ["entryBench", "shoeCabinet"],
  ["microwave", "counter"],
  ["microwave", "cabinet"],
  ["hood", "counter"],
  ["hood", "cabinet"],
  ["dishwasher", "counter"],
  ["purifier", "counter"],
  ["purifier", "vanity"],
  ["purifier", "cabinet"],
  ["curtain", "bed"],
  ["curtain", "sofa"],
  ["curtain", "desk"],
  ["curtain", "curtain"],
  ["curtain", "plant"],
  ["curtain", "lounge"],
  ["curtain", "nightstand"],
  ["mirrorCabinet", "vanity"],
  ["towelWarmer", "toilet"],
  ["towelWarmer", "vanity"],
  ["clothesRack", "washer"],
  ["clothesRack", "dryer"],
  ["clothesRack", "laundrySink"],
  ["clothesRack", "lounge"],
  ["clothesRack", "sideTable"],
  ["clothesRack", "plant"],
  ["bathHeater", "shower"],
  ["bathHeater", "toilet"],
  ["bathHeater", "vanity"],
  ["bathHeater", "bathtub"],
  ["dryer", "washer"],
  ["acWall", "bed"],
  ["acWall", "sofa"],
  ["acWall", "lSofa"],
  ["acWall", "desk"],
  ["acWall", "wardrobe"],
  ["acWall", "cabinet"],
  ["acWall", "tvCabinet"],
  ["acWall", "nightstand"],
  ["acWall", "bookshelf"],
  ["acWall", "dresser"],
  ["acWall", "chest"],
  ["acWall", "sideboard"],
  ["waterHeater", "toilet"],
  ["waterHeater", "washer"],
  ["waterHeater", "vanity"],
  ["waterHeater", "shower"],
  ["waterHeater", "counter"],
  ["waterHeater", "cabinet"],
  ["waterHeater", "bathtub"],
  ["waterHeater", "dryer"],
  ["gasHeater", "counter"],
  ["gasHeater", "cabinet"],
  ["gasHeater", "washer"],
  ["gasHeater", "fridge"],
  ["wallTV", "tvCabinet"],
  ["wallTV", "cabinet"],
  ["radiator", "sofa"],
  ["radiator", "bed"],
  ["ottoman", "sofa"],
  ["ottoman", "lSofa"],
  ["ottoman", "uSofa"],
  ["ottoman", "curvedSofa"],
  ["ottoman", "armchair"],
  ["stool", "dresser"],
  ["stool", "desk"],
  ["stool", "kitchenIsland"],
  ["bedBench", "diningTable"],
  ["bedBench", "roundTable"],
  ["chair", "roundTable"],
  ["booth", "diningTable"],
  ["booth", "roundTable"],
  ["officeChair", "lDesk"],
  ["chair", "lDesk"],
  ["projScreen", "tvCabinet"],
  ["projScreen", "cabinet"],
  ["projScreen", "sofa"],
  ["wallArt", "sofa"],
  ["wallArt", "bed"],
  ["wallArt", "sideboard"],
  ["wallArt", "consoleTable"],
  ["hangingPlant", "sofa"],
  ["hangingPlant", "plant"],
  ["hangingPlant", "lounge"],
  ["hangingPlant", "diningTable"],
  ["bin", "counter"],
  ["bin", "lCounter"],
  ["freeTub", "bathHeater"],
  ["coffeeTable", "uSofa"],
  ["roundTable", "uSofa"],
  ["roundTable", "curvedSofa"],
  ["roundTable", "lSofa"],
  ["roundTable", "sofa"],
  ["coffeeTable", "curvedSofa"],
  ["ovalTable", "bendSofa"],
  ["roundTable", "bendSofa"],
  ["coffeeTable", "bendSofa"],
  ["ottoman", "bendSofa"],
  ["sideTable", "bendSofa"],
  ["showerSet", "shower"],
  ["showerSet", "bathtub"],
  ["showerSet", "freeTub"],
  ["showerSet", "toilet"],
  ["showerSet", "vanity"],
  ["showerSet", "showerScreen"],
  ["showerSet", "shelfRack"],
  ...[
    "bed",
    "nightstand",
    "cabinet",
    "tvCabinet",
    "sofa",
    "bendSofa",
    "curvedSofa",
    "desk",
    "sideboard",
    "chair",
    "armchair",
    "lounge",
    "chaise",
    "dresser",
    "plant",
    "floorLamp",
    "curtain",
    "consoleTable",
    "acWall",
    "wallArt",
    "wallTV",
    "mirror",
    "radiator",
  ].map((n) => ["wallPanel", n]),
  ["chair", "ovalTable"],
  ["bedBench", "ovalTable"],
  ["booth", "ovalTable"],
  ["hangingPlant", "ovalTable"],
  ["ovalTable", "uSofa"],
  ["ovalTable", "curvedSofa"],
  ["ovalTable", "lSofa"],
  ["ovalTable", "sofa"],
];
export function L4(n) {
  var a;
  const e = String(((a = n.opt) == null ? void 0 : a.outline) || "")
    .split("|")
    .map((r) => r.split(",").map(Number));
  if (
    e.length < 4 ||
    e.length % 2 ||
    !e.every((r) => r.length === 2 && r.every(Number.isFinite))
  )
    return [];
  const t = e.map((r) => r[0]),
    i = e.map((r) => r[1]),
    s = Math.max(...t) - Math.min(...t),
    o = Math.max(...i) - Math.min(...i);
  return s <= 0 || o <= 0
    ? []
    : e.map(([r, l]) => [(r * n.w) / s, (l * n.d) / o]);
}
export const Dr = (n, e, t, i) => ({
  x0: Math.min(n, t),
  y0: Math.min(e, i),
  x1: Math.max(n, t),
  y1: Math.max(e, i),
});
export const iM = ["counter", "lCounter", "uCounter"];
export const Ci = (n) => iM.includes(n.type);
export function Ns(n) {
  var a, r, l, c, f, u, h, p, d, y, m, g, v, w, x, b, M, T, k;
  const e =
      ((a = n.kit) == null ? void 0 : a.shape) ??
      (n.type === "uCounter" ? "U" : n.type === "lCounter" ? "L" : "I"),
    t = I8(
      ((r = n.kit) == null ? void 0 : r.depth) ??
        (e === "I" ? Math.min(n.d, 650) : 600),
      350,
      900,
    ),
    i = {
      shape: e,
      corner: ((l = n.kit) == null ? void 0 : l.corner) ?? "left",
      depth: t,
      sink: {
        leg: 0,
        at: 0,
        w: e === "I" && n.w < 2600 ? 600 : 800,
        bowls: 1,
        ...(((c = n.kit) == null ? void 0 : c.sink) || {}),
        ...(((f = n.kit) == null ? void 0 : f.sink) === !1
          ? {
              off: !0,
            }
          : {}),
      },
      hob: {
        leg: 0,
        at: 0,
        w: 750,
        burners: 2,
        ...(((u = n.kit) == null ? void 0 : u.hob) || {}),
        ...(((h = n.kit) == null ? void 0 : h.hob) === !1
          ? {
              off: !0,
            }
          : {}),
      },
      wallLegs: (p = n.kit) == null ? void 0 : p.wallLegs,
      wall: ((d = n.kit) == null ? void 0 : d.wall) ?? !0,
      wallH: ((y = n.kit) == null ? void 0 : y.wallH) ?? 700,
      wallD: ((m = n.kit) == null ? void 0 : m.wallD) ?? 350,
      wallZ: ((g = n.kit) == null ? void 0 : g.wallZ) ?? 1550,
      hood: ((v = n.kit) == null ? void 0 : v.hood) ?? !0,
      top: ((w = n.kit) == null ? void 0 : w.top) ?? "#eceae6",
      thick: ((x = n.kit) == null ? void 0 : x.thick) ?? 40,
      tall: ((b = n.kit) == null ? void 0 : b.tall) ?? "none",
      tallW: ((M = n.kit) == null ? void 0 : M.tallW) ?? 600,
      tallH: ((T = n.kit) == null ? void 0 : T.tallH) ?? 2200,
    },
    s = yi(n, i),
    o = (S, E) => {
      s[S.leg] || (S.leg = 0);
      const _ = s[S.leg],
        A = _.usable[0] + S.w / 2,
        P = _.usable[1] - S.w / 2;
      ((!n.kit || !n.kit[S === i.sink ? "sink" : "hob"]) &&
        (S.at =
          e === "I"
            ? S === i.sink
              ? _.usable[0] + 100 + S.w / 2
              : _.usable[1] - 150 - S.w / 2
            : _.usable[0] + (_.usable[1] - _.usable[0]) * E),
        (S.at = P < A ? (_.usable[0] + _.usable[1]) / 2 : I8(S.at, A, P)));
    };
  return (
    !((k = n.kit) != null && k.sink) && e !== "I" && (i.sink.leg = 1),
    i.hob.off && (i.hood = !1),
    o(i.sink, e === "I" ? 0.22 : 0.5),
    o(i.hob, e === "I" ? 0.75 : 0.62),
    i
  );
}
export function yi(n, e) {
  const t = n.w / 2,
    i = n.d / 2,
    s = Math.min(e.depth, n.d, n.w / 2),
    o = [],
    a =
      e.shape === "U"
        ? ["left", "right"]
        : e.shape === "L"
          ? [e.corner || "left"]
          : [],
    r = {
      dir: "x",
      s0: 0,
      s1: n.w,
      back: -i,
      front: 1,
      depth: s,
      rect: Dr(-t, -i, t, -i + s),
      usable: [0, n.w],
      name: "主段（靠背墙）",
    };
  (a.includes("left") && (r.usable[0] = s + 50),
    a.includes("right") && (r.usable[1] = n.w - s - 50),
    o.push(r));
  for (const c of a) {
    const f = c === "left" ? -t : t - s,
      u =
        c === "right" && e.shape === "U" && e.d2
          ? Math.max(s + 300, Math.min(n.d, e.d2))
          : n.d;
    o.push({
      dir: "y",
      s0: s,
      s1: u,
      back: c === "left" ? -t : t,
      front: c === "left" ? 1 : -1,
      depth: s,
      rect: Dr(f, -i + s, f + s, -i + u),
      usable: [s + 50, u],
      name: c === "left" ? "左侧段" : "右侧段",
    });
  }
  const l = Ty(o, e);
  if (e.tall && e.tall !== "none") {
    const c = l[e.tall === "start" ? 0 : 1],
      f = o[c.leg],
      u = e.tallW || 600;
    c.atStart
      ? (f.usable[0] = Math.max(f.usable[0], f.s0 + u + 50))
      : (f.usable[1] = Math.min(f.usable[1], f.s1 - u - 50));
  }
  return o;
}
export function Ty(n, e) {
  return e.shape === "I"
    ? [
        {
          leg: 0,
          atStart: !0,
        },
        {
          leg: 0,
          atStart: !1,
        },
      ]
    : e.shape === "L"
      ? e.corner === "right"
        ? [
            {
              leg: 0,
              atStart: !0,
            },
            {
              leg: 1,
              atStart: !1,
            },
          ]
        : [
            {
              leg: 1,
              atStart: !1,
            },
            {
              leg: 0,
              atStart: !1,
            },
          ]
      : [
          {
            leg: 1,
            atStart: !1,
          },
          {
            leg: 2,
            atStart: !1,
          },
        ];
}
export function X1(n, e, t, i) {
  const s = n.w / 2,
    o = n.d / 2;
  return e.dir === "x"
    ? {
        x: -s + t,
        y: e.back + i,
      }
    : {
        x: e.back + e.front * i,
        y: -o + t,
      };
}
export function Pt(n, e, t, i, s, o) {
  const a = X1(n, e, t, s),
    r = X1(n, e, i, o);
  return Dr(a.x, a.y, r.x, r.y);
}
export function Hr(n) {
  var r;
  const e = n.cab,
    t = n.w / 2,
    i = n.d / 2;
  if (e.shape !== "L")
    return [
      {
        run: {
          dir: "x",
          s0: 0,
          s1: n.w,
          back: -i,
          front: 1,
          depth: n.d,
          rect: Dr(-t, -i, t, i),
        },
        cols: e.cols,
        ws: e.ws,
      },
    ];
  const s = Math.min(e.depth || 600, n.d - 200, n.w - 200),
    o = e.corner !== "right",
    a = o ? -t : t - s;
  return [
    {
      run: {
        dir: "x",
        s0: 0,
        s1: n.w,
        back: -i,
        front: 1,
        depth: s,
        rect: Dr(-t, -i, t, -i + s),
      },
      cols: e.cols,
      ws: e.ws,
      corner: o ? "start" : "end",
    },
    {
      run: {
        dir: "y",
        s0: s,
        s1: n.d,
        back: o ? -t : t,
        front: o ? 1 : -1,
        depth: s,
        rect: Dr(a, -i + s, a + s, i),
      },
      cols: (r = e.cols2) != null && r.length ? e.cols2 : ["door", "door"],
      ws: void 0,
    },
  ];
}
export function Ey(n) {
  var i;
  const e = n.w / 2,
    t = n.d / 2;
  if (Ci(n)) {
    const s = Ns(n);
    return yi(n, s).map((o) => o.rect);
  }
  return n.type === "cabinet" &&
    ((i = n.cab) == null ? void 0 : i.shape) === "L"
    ? Hr(n).map((s) => s.run.rect)
    : [Dr(-e, -t, e, t)];
}
export function lM(n) {
  if (n.type === "curveTrainingTable") {
    const e = L4(n);
    if (
      e.length >= 4 &&
      e.length % 2 === 0 &&
      e.every((t) => t.length === 2 && t.every(Number.isFinite))
    ) {
      const t = e.length / 2,
        i = [];
      for (let s = 0; s < t - 1; s++)
        i.push(
          [e[s], e[s + 1], e[e.length - 2 - s], e[e.length - 1 - s]].map(
            ([o, a]) => ({
              x: o,
              y: a,
            }),
          ),
        );
      return i;
    }
  }
  return vy(n)
    ? dd(n).quads
    : Ey(n).map((e) => [
        {
          x: e.x0,
          y: e.y0,
        },
        {
          x: e.x1,
          y: e.y0,
        },
        {
          x: e.x1,
          y: e.y1,
        },
        {
          x: e.x0,
          y: e.y1,
        },
      ]);
}
export function I8(n, e, t) {
  return Math.max(e, Math.min(t, n));
}
export const B4 = {
  w: 600,
  h: 600,
  gap: 2,
  pattern: "grid",
  color: "#e6e1d8",
  color2: "#6f6c68",
  grout: "#c4beb4",
  tex: "plain",
  origin: "center",
  ox: 0,
  oy: 0,
  rot: 0,
};
export const Gr = (n) => ({
  ...B4,
  ...(n || {}),
});
export const g0 = (n, e, t) => (n.opt && n.opt[e] !== void 0 ? n.opt[e] : t);
export const Qc = (n) => String(g0(n, "shape", "box"));
export const rv = (n) =>
  String(n || "")
    .split("|")
    .map((e) => e.split(",").map(Number))
    .filter((e) => e.length === 2 && e.every(Number.isFinite));
export const lv = (n) =>
  n.map(([e, t]) => `${Math.round(e)},${Math.round(t)}`).join("|");
export function xp(n) {
  const e = rv(String(g0(n, "outline", "")));
  if (e.length < 3)
    return [
      [-n.w / 2, -n.d / 2],
      [n.w / 2, -n.d / 2],
      [n.w / 2, n.d / 2],
      [-n.w / 2, n.d / 2],
    ];
  const t = e.map((l) => l[0]),
    i = e.map((l) => l[1]),
    s = Math.max(...t) - Math.min(...t) || 1,
    o = Math.max(...i) - Math.min(...i) || 1,
    a = (Math.max(...t) + Math.min(...t)) / 2,
    r = (Math.max(...i) + Math.min(...i)) / 2;
  return e.map(([l, c]) => [((l - a) * n.w) / s, ((c - r) * n.d) / o]);
}
export function qP(n) {
  const e = n.map((o) => o.x),
    t = n.map((o) => o.y),
    i = (Math.max(...e) + Math.min(...e)) / 2,
    s = (Math.max(...t) + Math.min(...t)) / 2;
  return {
    x: Math.round(i),
    y: Math.round(s),
    w: Math.round(Math.max(...e) - Math.min(...e)),
    d: Math.round(Math.max(...t) - Math.min(...t)),
    outline: lv(n.map((o) => [o.x - i, o.y - s])),
  };
}
export function Cu(n) {
  const e = Qc(n),
    t = n.w / 2,
    i = n.d / 2,
    s = (o = 40, a = 0, r = Math.PI * 2, l = i, c = 0) =>
      Array.from(
        {
          length: o + 1,
        },
        (f, u) => {
          const h = a + ((r - a) * u) / o;
          return [Math.cos(h) * t, c + Math.sin(h) * l];
        },
      );
  switch (e) {
    case "extrude":
      return xp(n);
    case "cyl":
    case "tube":
    case "sphere":
    case "hemi":
    case "cone":
    case "torus":
    case "lathe":
      return s();
    case "halfCyl":
      return [...s(24, Math.PI, Math.PI * 2, n.d, i), [t, i]];
    case "arcWall": {
      const o =
          (Math.max(10, Math.min(359, Number(g0(n, "arc", 90)))) * Math.PI) /
          180,
        a = Number(g0(n, "t", 120)),
        r = t / Math.max(0.05, Math.sin(Math.min(o, Math.PI) / 2)) || t,
        l = [],
        c = 24,
        f = r - i * 0;
      for (let p = 0; p <= c; p++) {
        const d = -Math.PI / 2 - o / 2 + (o * p) / c;
        l.push([Math.cos(d) * r, Math.sin(d) * r + f]);
      }
      for (let p = c; p >= 0; p--) {
        const d = -Math.PI / 2 - o / 2 + (o * p) / c;
        l.push([Math.cos(d) * (r - a), Math.sin(d) * (r - a) + f]);
      }
      const u = l.map((p) => p[1]),
        h = (Math.max(...u) + Math.min(...u)) / 2;
      return l.map(([p, d]) => [p, d - h]);
    }
    default:
      return [
        [-t, -i],
        [t, -i],
        [t, i],
        [-t, i],
      ];
  }
}
export const V1 = (n) => vi(n.x, n.y, n.w, n.d, n.rot);
export const Zg = (n) =>
  lM(n).map((e) =>
    e.map(({ x: t, y: i }) => {
      const s = i0(t, i, n.rot * qe);
      return {
        x: n.x + s.x,
        y: n.y + s.y,
      };
    }),
  );
export const Ts = (n, e) =>
  Math.max(0, ...n.flatMap((t) => e.map((i) => jw(t, i))));
export const Jg = (n) => ({
  x: n.reduce((e, t) => e + t.x, 0) / n.length,
  y: n.reduce((e, t) => e + t.y, 0) / n.length,
});
export const KU = (n, e) =>
  Zw.some(([t, i]) => (t === n && i === e) || (t === e && i === n));
export { Ls };
