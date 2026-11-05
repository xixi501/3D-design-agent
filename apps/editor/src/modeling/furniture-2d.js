/** Derived from ZWD11/house-plan-designer@b94183f9 (MIT, Copyright 2026 ZWD11).
 * Scope-aware extraction: scripts/extract-upstream.mjs. See reference/upstream/LICENSE.
 * Three.js core is an npm dependency; inherited modelling helpers retain their original behaviour. */
import {
  Ci,
  Ns,
  yi,
  Pt,
  Cu,
  Qc,
  L4,
  dd,
  Hr,
} from "../../../../packages/scene-core/src/inherited/footprints.js";
import { I4 } from "../../../../packages/scene-core/src/inherited/house-spec.js";
import { LC } from "./asset-cache.ts";
export function we(n, e) {
  const t = parseInt(n.slice(1), 16);
  let i = t >> 16,
    s = (t >> 8) & 255,
    o = t & 255;
  const a = e < 0 ? 0 : 255,
    r = Math.abs(e);
  return (
    (i = Math.round(i + (a - i) * r)),
    (s = Math.round(s + (a - s) * r)),
    (o = Math.round(o + (a - o) * r)),
    "#" + ((1 << 24) | (i << 16) | (s << 8) | o).toString(16).slice(1)
  );
}
export function ls(n, e, t, i, s, o) {
  ((o = Math.max(0, Math.min(o, i / 2, s / 2))),
    n.moveTo(e + o, t),
    n.lineTo(e + i - o, t),
    n.quadraticCurveTo(e + i, t, e + i, t + o),
    n.lineTo(e + i, t + s - o),
    n.quadraticCurveTo(e + i, t + s, e + i - o, t + s),
    n.lineTo(e + o, t + s),
    n.quadraticCurveTo(e, t + s, e, t + s - o),
    n.lineTo(e, t + o),
    n.quadraticCurveTo(e, t, e + o, t),
    n.closePath());
}
export function xy(n, e) {
  const t = Math.max(
      1,
      n.s.findIndex((a) => a >= e),
    ),
    i = t - 1,
    s = Math.min(
      1,
      Math.max(0, (e - n.s[i]) / Math.max(1e-6, n.s[t] - n.s[i])),
    ),
    o = (a, r) => a + (r - a) * s;
  return {
    p: {
      x: o(n.pts[i].x, n.pts[t].x),
      y: o(n.pts[i].y, n.pts[t].y),
    },
    d: o(n.dep[i], n.dep[t]),
    n: {
      x: o(n.nrm[i].x, n.nrm[t].x),
      y: o(n.nrm[i].y, n.nrm[t].y),
    },
  };
}
export function _y(n, e) {
  const t = n.w / 2,
    i = n.d / 2,
    s = Math.min(e.depth, n.d, n.w / 2);
  if (e.shape === "I")
    return [
      {
        x: -t,
        y: -i,
      },
      {
        x: t,
        y: -i,
      },
      {
        x: t,
        y: -i + s,
      },
      {
        x: -t,
        y: -i + s,
      },
    ];
  if (e.shape === "L" && e.corner !== "right")
    return [
      {
        x: -t,
        y: -i,
      },
      {
        x: t,
        y: -i,
      },
      {
        x: t,
        y: -i + s,
      },
      {
        x: -t + s,
        y: -i + s,
      },
      {
        x: -t + s,
        y: i,
      },
      {
        x: -t,
        y: i,
      },
    ];
  if (e.shape === "L")
    return [
      {
        x: -t,
        y: -i,
      },
      {
        x: t,
        y: -i,
      },
      {
        x: t,
        y: i,
      },
      {
        x: t - s,
        y: i,
      },
      {
        x: t - s,
        y: -i + s,
      },
      {
        x: -t,
        y: -i + s,
      },
    ];
  const o = e.d2 ? -i + Math.max(s + 300, Math.min(n.d, e.d2)) : i;
  return [
    {
      x: -t,
      y: -i,
    },
    {
      x: t,
      y: -i,
    },
    {
      x: t,
      y: o,
    },
    {
      x: t - s,
      y: o,
    },
    {
      x: t - s,
      y: -i + s,
    },
    {
      x: -t + s,
      y: -i + s,
    },
    {
      x: -t + s,
      y: i,
    },
    {
      x: -t,
      y: i,
    },
  ];
}
export function ef(n, e, t) {
  const i = n.length;
  if (!e || e.length !== i || e.some((o) => !(o > 0)))
    return n.map(() => t / i);
  const s = e.reduce((o, a) => o + a, 0);
  return e.map((o) => (o * t) / s);
}
export function rM(n) {
  const e = n.cab;
  return e.shape !== "L"
    ? null
    : _y(n, {
        shape: "L",
        corner: e.corner,
        depth: Math.min(e.depth || 600, n.d - 200, n.w - 200),
      });
}
export const Yt = (n, e, t) => {
  var i;
  return ((i = n.opt) == null ? void 0 : i[e]) ?? t;
};
export const Mp = 170;
export const mv = (n) => {
  var t;
  const e = Math.round(+(((t = n.opt) == null ? void 0 : t.steps) || 0));
  return e >= 1 ? e : Math.max(2, Math.round(Math.abs(n.h) / Mp));
};
export function gv(n) {
  var m;
  const e = (m = n.opt) == null ? void 0 : m.winder;
  if (typeof e != "string" || !e.includes("|")) return null;
  const t = e.split("|").map((g) => {
    const [v, w] = g.split(",").map(Number);
    return {
      x: v,
      y: w,
    };
  });
  if (t.length < 3 || t.some((g) => !isFinite(g.x) || !isFinite(g.y)))
    return null;
  const [i, ...s] = t,
    o = n.w / 2,
    a = n.d / 2,
    r = (g) => Math.atan2(g.y - i.y, g.x - i.x),
    l = r(s[0]),
    c = (g) => {
      for (; g <= -Math.PI;) g += 2 * Math.PI;
      for (; g > Math.PI;) g -= 2 * Math.PI;
      return g;
    },
    f = Math.sign(c(r(s[1]) - l)) || 1,
    u = (g) => {
      let v = f * c(r(g) - l);
      return (v < -1e-6 && (v += 2 * Math.PI), v);
    },
    h = [
      {
        x: -o,
        y: -a,
      },
      {
        x: o,
        y: -a,
      },
      {
        x: o,
        y: a,
      },
      {
        x: -o,
        y: a,
      },
    ].filter((g) => Math.hypot(g.x - i.x, g.y - i.y) > 1),
    p = s.map(u),
    d = [];
  for (let g = 0; g + 1 < s.length; g++) {
    const v = h
      .filter((w) => {
        const x = u(w);
        return x > p[g] + 1e-6 && x < p[g + 1] - 1e-6;
      })
      .sort((w, x) => u(w) - u(x));
    d.push([i, s[g], ...v, s[g + 1]]);
  }
  const y = [
    ...s,
    ...h.filter((g) => {
      const v = u(g);
      return (
        v > 1e-6 &&
        v < p[p.length - 1] - 1e-6 &&
        !s.some((w) => Math.hypot(w.x - g.x, w.y - g.y) < 1)
      );
    }),
  ].sort((g, v) => u(g) - u(v));
  return {
    pv: i,
    rays: s,
    treads: d,
    path: y,
    rayAt: p,
  };
}
export function qa(n) {
  const e = n.w,
    t = n.d,
    i = n.h,
    s = e / 2,
    o = t / 2,
    a = n.opt || {},
    r = [],
    l = [],
    c = [],
    f = [];
  if (n.type === "stage")
    return (
      c.push({
        x0: -s,
        y0: -o,
        x1: s,
        y1: o - 400,
        top: i,
      }),
      r.push(
        {
          x0: -s,
          y0: o - 400,
          x1: s,
          y1: o - 200,
          top: (i * 2) / 3,
        },
        {
          x0: -s,
          y0: o - 200,
          x1: s,
          y1: o,
          top: i / 3,
        },
      ),
      {
        steps: r,
        flights: l,
        landings: c,
        rails: f,
      }
    );
  if (n.type === "stairRun") {
    if (a.flat)
      return (
        c.push({
          x0: -s,
          y0: -o,
          x1: s,
          y1: o,
          top: i,
        }),
        {
          steps: r,
          flights: l,
          landings: c,
          rails: f,
        }
      );
    const I = gv(n);
    if (I) {
      const W = i / I.treads.length;
      return (
        I.treads.forEach((K, C) =>
          r.push({
            x0: Math.min(...K.map((F) => F.x)),
            x1: Math.max(...K.map((F) => F.x)),
            y0: Math.min(...K.map((F) => F.y)),
            y1: Math.max(...K.map((F) => F.y)),
            top: (C + 1) * W,
            poly: K,
          }),
        ),
        {
          steps: r,
          flights: l,
          landings: c,
          rails: f,
        }
      );
    }
    const B = mv(n),
      z = i / B,
      V = t / B;
    for (let W = 0; W < B; W++)
      r.push({
        x0: -s,
        x1: s,
        y1: o - W * V,
        y0: o - (W + 1) * V,
        top: (W + 1) * z,
      });
    l.push({
      pts: [
        {
          x: 0,
          y: o - V / 2,
        },
        {
          x: 0,
          y: -o + V / 2,
        },
      ],
      z0: z,
      z1: i,
    });
    for (const W of a.rail === "both"
      ? [-1, 1]
      : a.rail === "left"
        ? [-1]
        : a.rail === "right"
          ? [1]
          : [])
      f.push([
        {
          x: W * (s - 40),
          y: o,
          z,
        },
        {
          x: W * (s - 40),
          y: -o,
          z: i,
        },
      ]);
    return {
      steps: r,
      flights: l,
      landings: c,
      rails: f,
    };
  }
  if (n.type === "stairDogleg") return HC(n);
  const { run: u, land: h, r: p, n1: d, n2: y, k: m, sgn: g } = vv(n),
    v = t - h,
    w = e - 2 * u,
    x = Math.max(1, Math.round(i / p) - d - y - 2 * m),
    b = (I) => I * g,
    M = (I, B, z, V, W) => ({
      x0: Math.min(b(I), b(B)),
      x1: Math.max(b(I), b(B)),
      y0: Math.min(z, V),
      y1: Math.max(z, V),
      top: W,
    }),
    T = v / d;
  for (let I = 0; I < d; I++)
    r.push(M(s - u, s, o - I * T, o - (I + 1) * T, (I + 1) * p));
  if (m) {
    const I = h / m;
    for (let B = 0; B < m; B++)
      r.push(
        M(s - u, s, -o + h - B * I, -o + h - (B + 1) * I, (d + B + 1) * p),
      );
  } else c.push(M(s - u, s, -o, -o + h, d * p));
  if (y) {
    const I = w / y;
    for (let B = 0; B < y; B++)
      r.push(
        M(s - u - B * I, s - u - (B + 1) * I, -o, -o + h, (d + m + B + 1) * p),
      );
  }
  if (m) {
    const I = h / m;
    for (let B = 0; B < m; B++)
      r.push(
        M(-s, -s + u, -o + B * I, -o + (B + 1) * I, (d + m + y + B + 1) * p),
      );
  } else c.push(M(-s, -s + u, -o, -o + h, (d + y) * p));
  const k = d + y + 2 * m,
    S = v / x;
  for (let I = 0; I < x; I++)
    r.push(
      M(-s, -s + u, -o + h + I * S, -o + h + (I + 1) * S, (k + I + 1) * p),
    );
  const E = b(s - u / 2),
    _ = b(-s + u / 2),
    A = -o + h / 2;
  l.push({
    pts: [
      {
        x: E,
        y: o - T / 2,
      },
      {
        x: E,
        y: A,
      },
      {
        x: _,
        y: A,
      },
      {
        x: _,
        y: o - S / 2,
      },
    ],
    z0: p,
    z1: i,
  });
  const P = b(s - u - 40),
    D = b(-s + u + 40),
    O = -o + h + 40;
  return (
    f.push([
      {
        x: P,
        y: o,
        z: p,
      },
      {
        x: P,
        y: O,
        z: d * p,
      },
      {
        x: D,
        y: O,
        z: (d + 2 * m + y) * p,
      },
      {
        x: D,
        y: o,
        z: i,
      },
    ]),
    {
      steps: r,
      flights: l,
      landings: c,
      rails: f,
    }
  );
}
export function bv(n) {
  const e = n.w,
    t = n.d,
    i = n.h,
    s = e / 2,
    o = t / 2,
    a = n.opt || {},
    r = Math.max(0, +(a.gap ?? 120)),
    l = (e - r) / 2,
    c = Math.min(l, t * 0.5),
    f = Math.max(6, Math.round(i / Mp)),
    u = i / f,
    h = Math.max(3, Math.min(Math.round(+(a.winders ?? 7)), f - 4)),
    p = Math.ceil((f - h) / 2),
    d = f - h - p,
    y = a.start === "left" ? -1 : 1,
    m = {
      x: 0,
      y: -o + c,
    };
  return {
    W: e,
    D: t,
    H: i,
    hw: s,
    hd: o,
    gap: r,
    run: l,
    turn: c,
    N: f,
    r: u,
    k: h,
    n1: p,
    n3: d,
    sgn: y,
    pv: m,
  };
}
export function HC(n) {
  const {
      hw: e,
      hd: t,
      gap: i,
      run: s,
      turn: o,
      r: a,
      k: r,
      n1: l,
      n3: c,
      sgn: f,
      pv: u,
      H: h,
    } = bv(n),
    p = [],
    d = [],
    y = [],
    m = [],
    g = (A) => A * f,
    v = 2 * t - o,
    w = (A, P, D, O, I) => ({
      x0: Math.min(g(A), g(P)),
      x1: Math.max(g(A), g(P)),
      y0: Math.min(D, O),
      y1: Math.max(D, O),
      top: I,
    }),
    x = v / l;
  for (let A = 0; A < l; A++)
    p.push(w(i / 2, e, t - A * x, t - (A + 1) * x, (A + 1) * a));
  const b = (A) => {
      const P = Math.cos(A) * f,
        D = -Math.sin(A);
      let O = 1 / 0;
      return (
        P > 1e-9 && (O = Math.min(O, (e - u.x) / P)),
        P < -1e-9 && (O = Math.min(O, (-e - u.x) / P)),
        D < -1e-9 && (O = Math.min(O, (-t - u.y) / D)),
        {
          x: u.x + P * O,
          y: u.y + D * O,
        }
      );
    },
    M = [
      {
        a: Math.atan2(o, e),
        p: {
          x: g(e),
          y: -t,
        },
      },
      {
        a: Math.PI - Math.atan2(o, e),
        p: {
          x: g(-e),
          y: -t,
        },
      },
    ];
  for (let A = 0; A < r; A++) {
    const P = (Math.PI * A) / r,
      D = (Math.PI * (A + 1)) / r,
      O = [
        u,
        b(P),
        ...M.filter((I) => I.a > P + 1e-6 && I.a < D - 1e-6).map((I) => I.p),
        b(D),
      ];
    p.push({
      x0: Math.min(...O.map((I) => I.x)),
      x1: Math.max(...O.map((I) => I.x)),
      y0: Math.min(...O.map((I) => I.y)),
      y1: Math.max(...O.map((I) => I.y)),
      top: (l + A + 1) * a,
      poly: O,
    });
  }
  const T = v / c;
  for (let A = 0; A < c; A++)
    p.push(w(-e, -i / 2, u.y + A * T, u.y + (A + 1) * T, (l + r + A + 1) * a));
  const k = g(i / 2 + s / 2),
    S = g(-i / 2 - s / 2);
  d.push({
    pts: [
      {
        x: k,
        y: t - x / 2,
      },
      {
        x: k,
        y: u.y,
      },
      {
        x: g(0),
        y: u.y - o / 2,
      },
      {
        x: S,
        y: u.y,
      },
      {
        x: S,
        y: t - T / 2,
      },
    ],
    z0: a,
    z1: h,
  });
  const E = i / 2 + 40,
    _ = [
      {
        x: g(E),
        y: t,
        z: a,
      },
    ];
  for (let A = 0; A <= 12; A++) {
    const P = (Math.PI * A) / 12;
    _.push({
      x: u.x + Math.cos(P) * E * f,
      y: u.y - Math.sin(P) * E,
      z: (l + (r * A) / 12) * a,
    });
  }
  return (
    _.push({
      x: g(-E),
      y: t,
      z: h,
    }),
    m.push(_),
    {
      steps: p,
      flights: d,
      landings: y,
      rails: m,
    }
  );
}
export function vv(n) {
  const e = n.w,
    t = n.d,
    i = n.h,
    s = n.opt || {},
    o = Math.min(+(s.run || e * 0.32), e * 0.5),
    a = Math.min(+(s.land || 1050), t * 0.6),
    r = t - a,
    l = e - 2 * o,
    c = 2 * r + l,
    f = Math.max(6, Math.round(i / Mp)),
    u = i / f,
    h = Math.max(
      0,
      Math.min(Math.round(+(s.winders || 0)), Math.floor((f - 2) / 2)),
    ),
    p = Math.max(l > 200 ? 1 : 0, Math.round(((f - 2 * h) * l) / c)),
    d = Math.max(1, Math.round((f - p - 2 * h) / 2));
  return {
    run: o,
    land: a,
    N: f,
    r: u,
    n1: d,
    n2: p,
    k: h,
    sgn: s.start === "left" ? -1 : 1,
  };
}
export function Fh(n, e, t) {
  var h, p, d, y, m, g, v, w, x, b, M, T, k, S, E;
  if (Ci(e)) {
    GC(n, e, t);
    return;
  }
  const i = e.w,
    s = e.d,
    o = i / 2,
    a = s / 2,
    r = e.color;
  ((n.lineWidth = t * 1.1),
    (n.strokeStyle = "#4b525d"),
    (n.lineJoin = "round"),
    n.setLineDash([]));
  const l = (_, A, P, D, O, I) => {
      (n.beginPath(),
        ls(n, _, A, P, D, O),
        I && ((n.fillStyle = I), n.fill()),
        n.stroke());
    },
    c = (_, A, P, D) => {
      (n.beginPath(), n.moveTo(_, A), n.lineTo(P, D), n.stroke());
    },
    f = (_, A, P, D) => {
      (n.beginPath(),
        n.arc(_, A, Math.max(1, P), 0, Math.PI * 2),
        D && ((n.fillStyle = D), n.fill()),
        n.stroke());
    },
    u = (_, A, P, D, O) => {
      (n.beginPath(),
        n.ellipse(_, A, Math.max(1, P), Math.max(1, D), 0, 0, Math.PI * 2),
        O && ((n.fillStyle = O), n.fill()),
        n.stroke());
    };
  switch (e.type) {
    case "free": {
      const _ = Cu(e),
        A = Qc(e),
        P = String(((h = e.opt) == null ? void 0 : h.mat) || "paint"),
        D = P === "glass" || P === "frosted";
      if (
        (n.beginPath(),
        _.forEach(([O, I], B) => (B ? n.lineTo(O, I) : n.moveTo(O, I))),
        n.closePath(),
        (n.fillStyle = D ? "rgba(188,216,234,.35)" : r),
        n.fill(),
        n.stroke(),
        A === "slats")
      ) {
        const O = Math.max(
          2,
          Number((p = e.opt) == null ? void 0 : p.n) || Math.round(i / 120),
        );
        for (let I = 1; I < O; I++)
          c(-o + (i * I) / O, -a, -o + (i * I) / O, a);
      }
      if (A === "steps") {
        const O = Math.max(1, Number((d = e.opt) == null ? void 0 : d.n) || 3);
        for (let I = 1; I < O; I++)
          c(-o, -a + (s * I) / O, o, -a + (s * I) / O);
      }
      if (A === "arch") {
        const O = Number((y = e.opt) == null ? void 0 : y.t) || 200;
        l(-o + O, -a, i - 2 * O, s, 0, "#ffffff");
      }
      if (A === "tube") {
        const O = Number((m = e.opt) == null ? void 0 : m.t) || 100;
        u(0, 0, Math.max(1, o - O), Math.max(1, a - O), "#ffffff");
      }
      (A === "wedge" && (c(-o, -a, o, a), c(o, -a, -o, a)),
        A === "pyramid" && (c(-o, -a, o, a), c(o, -a, -o, a)),
        (A === "cone" || A === "hemi" || A === "sphere") &&
          f(0, 0, Math.min(i, s) * 0.06));
      break;
    }
    case "airVent":
      l(-o, -a, i, s, 0, r);
      for (let _ = -o + 40; _ < o; _ += 50) c(_, -a + 20, _, a - 20);
      break;
    case "curveTrainingTable": {
      const _ = L4(e);
      _.length >= 3 &&
      _.every((A) => A.length === 2 && A.every(Number.isFinite))
        ? (n.beginPath(),
          _.forEach(([A, P], D) => (D ? n.lineTo(A, P) : n.moveTo(A, P))),
          n.closePath(),
          (n.fillStyle = r),
          n.fill(),
          n.stroke())
        : l(-o, -a, i, s, 20, r);
      break;
    }
    case "trainingTable":
      (l(-o, -a, i, s, 12, r), c(-o + 60, a - 50, o - 60, a - 50));
      break;
    case "stage":
      (l(-o, -a, i, s, 2, r),
        c(-o, a - 180, o, a - 180),
        c(-o, a - 360, o, a - 360));
      break;
    case "lectern":
      (l(-o, -a, i, s, 15, r),
        l(-o + 70, -a + 70, i - 140, s * 0.45, 5, "#414a53"),
        c(-o + 40, a - 90, o - 40, a - 90));
      break;
    case "slidingBoard":
      l(-o, -a, i, s, 0, r);
      for (let _ = 1; _ < 3; _++) c(-o + (i * _) / 3, -a, -o + (i * _) / 3, a);
      break;
    case "mobileDisplay":
      (l(-o, -a, i, Math.min(100, s), 4, "#293443"),
        c(0, -a + 100, 0, a),
        c(-o * 0.65, a - 30, o * 0.65, a - 30));
      break;
    case "printer":
      (l(-o, -a, i, s, 20, r),
        l(-o + 60, -a + 60, i - 120, s * 0.45, 12, "#4e5966"),
        l(-o + 80, a - 150, i - 160, 100, 4, "#f9f9f5"));
      break;
    case "coffeeMachine":
      (l(-o, -a, i, s, 15, r),
        f(-i * 0.2, -s * 0.2, 50),
        l(-o + 60, 0, i - 120, s * 0.4, 3, "#87909b"));
      break;
    case "urinal":
      (l(-o, -a, i, s, Math.min(i, s) * 0.2, r),
        u(0, 15, i * 0.32, s * 0.32, "#d3e5e7"),
        f(0, s * 0.18, 18));
      break;
    case "serviceSink":
      (l(-o, -a, i, s, 10, r),
        l(-o + 55, -a + 70, i - 110, s - 120, 20, "#cbdde0"),
        f(0, -a + 40, 20));
      break;
    case "wifiAP":
      (f(0, 0, Math.min(i, s) * 0.48, r), f(0, 0, 18, "#50b5b0"));
      break;
    case "ceilingSpeaker":
      f(0, 0, Math.min(i, s) * 0.48, r);
      for (let _ = 30; _ < Math.min(i, s) * 0.42; _ += 30) f(0, 0, _);
      break;
    case "bed": {
      (l(-o, -a, i, s, 30, "#f4efe8"), l(-o, -a, i, 100, 20, we(r, -0.3)));
      const _ = i > 1300 ? 2 : 1,
        A = 60,
        P = (i - 160 - (_ - 1) * A) / _;
      for (let D = 0; D < _; D++)
        l(-o + 80 + D * (P + A), -a + 160, P, 360, 70, "#ffffff");
      (l(-o + 15, -a + s * 0.4, i - 30, s * 0.6 - 15, 30, r),
        c(-o + 15, -a + s * 0.4 + 200, o - 15, -a + s * 0.4 + 200));
      break;
    }
    case "nightstand":
      (l(-o, -a, i, s, 20, r),
        f(0, 0, Math.min(i, s) * 0.28, "#f7f1e3"),
        f(0, 0, Math.min(i, s) * 0.07));
      break;
    case "wardrobe": {
      (l(-o, -a, i, s, 8, r),
        n.setLineDash([t * 5, t * 4]),
        c(-o + 50, 0, o - 50, 0),
        n.setLineDash([]));
      for (let _ = -o + 160; _ < o - 80; _ += 200)
        c(_ - 50, -s * 0.3, _ + 50, s * 0.3);
      c(-o, a - 40, o, a - 40);
      break;
    }
    case "sofa":
    case "armchair":
    case "lounge": {
      const _ = Math.min(230, s * 0.26),
        A = e.type === "lounge" ? 90 : Math.min(180, i * 0.14),
        P = String(Yt(e, "arms", "both")),
        D = P === "both" || P === "left" ? A : 0,
        O = P === "both" || P === "right" ? A : 0;
      (l(-o, -a, i, s, 70, we(r, -0.15)),
        l(-o + D, -a + _, i - D - O, s - _ - 25, 45, r));
      const I =
          e.type !== "sofa"
            ? 1
            : P === "both"
              ? i > 1700
                ? 3
                : 2
              : Math.max(1, Math.round((i - D - O) / 750)),
        B = (i - D - O) / I;
      for (let z = 1; z < I; z++)
        c(-o + D + B * z, -a + _, -o + D + B * z, a - 25);
      break;
    }
    case "coffeeTable":
      (l(-o, -a, i, s, Math.min(i, s) * 0.2, r),
        l(-o + 50, -a + 50, i - 100, s - 100, Math.min(i, s) * 0.16, null));
      break;
    case "tvCabinet":
      (l(-o, -a, i, s, 8, r),
        l(
          -Math.min(i * 0.36, 800),
          -a + 40,
          Math.min(i * 0.72, 1600),
          55,
          10,
          "#2a2d33",
        ));
      for (let _ = 1; _ < 3; _++) c(-o + (i * _) / 3, 0, -o + (i * _) / 3, a);
      break;
    case "diningTable":
      (l(-o, -a, i, s, 40, r), l(-o + 40, -a + 40, i - 80, s - 80, 30, null));
      break;
    case "desk":
      (l(-o, -a, i, s, 12, r),
        l(
          -Math.min(280, i * 0.3),
          -a + 60,
          Math.min(560, i * 0.6),
          50,
          10,
          "#2a2d33",
        ),
        l(
          -Math.min(220, i * 0.25),
          20,
          Math.min(440, i * 0.5),
          140,
          12,
          "#eceae6",
        ));
      break;
    case "sideTable":
      (f(0, 0, Math.min(i, s) / 2, r), f(0, 0, Math.min(i, s) * 0.38));
      break;
    case "chair":
      (l(-o, -a + 40, i, s - 40, 70, r), l(-o, -a, i, 90, 40, we(r, -0.3)));
      break;
    case "officeChair":
      (f(0, 30, Math.min(i, s) * 0.38, r),
        l(-o + 50, -a, i - 100, 120, 55, we(r, -0.3)),
        l(-o, -40, 70, 260, 30, we(r, -0.2)),
        l(o - 70, -40, 70, 260, 30, we(r, -0.2)));
      break;
    case "bookshelf":
      l(-o, -a, i, s, 6, r);
      for (let _ = -o + 300; _ < o - 50; _ += 300) c(_, -a, _, a);
      break;
    case "counter": {
      (l(-o, -a, i, s, 8, r), c(-o, -a + 40, o, -a + 40));
      const _ = Math.min(750, i * 0.3);
      (l(-o + i * 0.12, -a + 90, _, s - 180, 50, "#dfe3e6"),
        f(-o + i * 0.12 + _ / 2, -a + 150, 22));
      const A = o - Math.min(i * 0.25, 600);
      (l(A - 320, -a + 70, 640, s - 140, 16, "#2b2e33"),
        (n.strokeStyle = "#9aa1ab"),
        f(A - 160, 0, 95),
        f(A + 160, 0, 95));
      break;
    }
    case "fridge":
      (l(-o, -a, i, s, 20, r), c(-o, a - 90, o, a - 90), c(0, a - 90, 0, a));
      break;
    case "shoeCabinet":
    case "island": {
      l(-o, -a, i, s, 10, r);
      const _ = Math.max(1, Math.round(i / 400));
      for (let A = 1; A < _; A++)
        c(-o + (A * i) / _, -a + 30, -o + (A * i) / _, a - 30);
      break;
    }
    case "rug": {
      ((n.globalAlpha = 0.85),
        l(-o, -a, i, s, 30, r),
        (n.globalAlpha = 1),
        n.setLineDash([t * 6, t * 4]),
        (n.strokeStyle = we(r, -0.3)),
        l(-o + 120, -a + 120, i - 240, s - 240, 20, null),
        n.setLineDash([]));
      break;
    }
    case "plant": {
      const _ = Math.min(i, s) / 2;
      n.strokeStyle = "#3f5f38";
      for (let A = 0; A < 8; A++) {
        const P = (A / 8) * Math.PI * 2;
        f(
          Math.cos(P) * _ * 0.5,
          Math.sin(P) * _ * 0.5,
          _ * 0.45,
          A % 2 ? we(r, 0.15) : r,
        );
      }
      f(0, 0, _ * 0.35, we(r, -0.1));
      break;
    }
    case "toilet":
      (l(-o, -a, i, s * 0.26, 40, r),
        u(0, -a + s * 0.63, o * 0.9, s * 0.37, r),
        u(0, -a + s * 0.65, o * 0.6, s * 0.27, "#eef3f6"));
      break;
    case "vanity": {
      (Yt(e, "hang", !1) && n.setLineDash([t * 6, t * 4]),
        l(-o, -a, i, s, 20, r),
        n.setLineDash([]));
      const _ = Yt(e, "basins", i >= 1200 ? 2 : 1);
      for (let A = 0; A < _; A++) {
        const P = -o + (i * (A + 0.5)) / _;
        (u(P, 20, Math.min((i / _) * 0.3, 250), s * 0.3, "#ffffff"),
          f(P, -a + 70, 18));
      }
      Yt(e, "mirror", !0) &&
        ((n.strokeStyle = "#7fb0cc"), c(-o * 0.85, -a - 25, o * 0.85, -a - 25));
      break;
    }
    case "shower": {
      const _ = Yt(e, "shape", "square"),
        A = Math.min(i, s) * 0.38;
      (n.beginPath(),
        _ === "diamond"
          ? (n.moveTo(-o, -a),
            n.lineTo(o, -a),
            n.lineTo(o, a - A),
            n.lineTo(o - A, a),
            n.lineTo(-o, a),
            n.closePath())
          : _ === "arc"
            ? (n.moveTo(-o, -a),
              n.lineTo(o, -a),
              n.ellipse(-o, -a, i, s, 0, 0, Math.PI / 2),
              n.closePath())
            : n.rect(-o, -a, i, s),
        (n.fillStyle = "#eef3f6"),
        n.fill(),
        n.stroke(),
        f(-o + Math.min(i, s) * 0.35, -a + Math.min(i, s) * 0.35, 40, "#fff"),
        (n.lineWidth = t * 3),
        (n.strokeStyle = "#7fb0cc"),
        _ === "diamond"
          ? (n.beginPath(),
            n.moveTo(-o, a),
            n.lineTo(o - A, a),
            n.lineTo(o, a - A),
            n.lineTo(o, -a),
            n.stroke())
          : _ === "arc"
            ? (n.beginPath(),
              n.ellipse(-o, -a, i, s, 0, 0, Math.PI / 2),
              n.stroke())
            : _ === "line"
              ? c(-o, a, o, a)
              : (c(-o, a, o, a), c(o, -a, o, a)));
      break;
    }
    case "bathtub":
      (l(-o, -a, i, s, s * 0.25, r),
        l(-o + 70, -a + 70, i - 140, s - 140, s * 0.3, "#e3f1f7"),
        f(-o + 220, 0, 28));
      break;
    case "washer":
      (l(-o, -a, i, s, 40, r),
        f(0, 40, Math.min(i, s) * 0.3, "#dfe6ea"),
        c(-o + 40, -a + 90, o - 40, -a + 90));
      break;
    case "bunkBed": {
      (l(-o, -a, i, s, 20, "#f4efe8"),
        l(-o, -a, i, 80, 10, we(r, -0.2)),
        l(-o, a - 80, i, 80, 10, we(r, -0.2)),
        l(-o + 60, -a + 140, i - 120, 300, 60, "#ffffff"),
        l(-o + 15, -a + s * 0.35, i - 30, s * 0.65 - 95, 30, r),
        n.setLineDash([t * 5, t * 3]),
        c(-o, -a, o, a),
        n.setLineDash([]),
        l(o - 120, -a + s * 0.3, 100, s * 0.4, 10, we(r, -0.25)));
      break;
    }
    case "crib": {
      (l(-o, -a, i, s, 20, r),
        l(-o + 50, -a + 50, i - 100, s - 100, 16, "#ffffff"));
      for (let _ = -o + 100; _ < o - 60; _ += 90) c(_, -a + 10, _, -a + 45);
      for (let _ = -o + 100; _ < o - 60; _ += 90) c(_, a - 45, _, a - 10);
      break;
    }
    case "tatami": {
      l(-o, -a, i, s, 10, r);
      const _ = Math.max(1, Math.round(i / 900)),
        A = Math.max(1, Math.round(s / 900));
      for (let P = 1; P < _; P++) c(-o + (i * P) / _, -a, -o + (i * P) / _, a);
      for (let P = 1; P < A; P++) c(-o, -a + (s * P) / A, o, -a + (s * P) / A);
      l(
        -o + 80,
        -a + 80,
        Math.min(600, i * 0.3),
        Math.min(400, s * 0.2),
        40,
        "#ffffff",
      );
      break;
    }
    case "bedBench":
    case "entryBench":
      (l(-o, -a, i, s, 40, r),
        l(-o + 40, -a + 40, i - 80, s - 80, 30, we(r, 0.15)));
      break;
    case "dresser":
      (l(-o, -a, i, s, 12, r),
        l(
          -Math.min(300, i * 0.3),
          -a + 10,
          Math.min(600, i * 0.6),
          40,
          10,
          "#dfe9ef",
        ),
        f(0, 60, Math.min(i, s) * 0.18));
      break;
    case "mirror":
      (l(-o, -a, i, s, 6, "#dfe9ef"), c(-o + 40, a, o - 40, a));
      break;
    case "lSofa": {
      const P = Math.min(950, s * 0.56),
        D = we(r, -0.15);
      (n.beginPath(),
        n.moveTo(-o, -a),
        n.lineTo(o, -a),
        n.lineTo(o, -a + P),
        n.lineTo(-o + P, -a + P),
        n.lineTo(-o + P, a),
        n.lineTo(-o, a),
        n.closePath(),
        (n.fillStyle = D),
        n.fill(),
        n.stroke(),
        l(-o + 230, -a + 230, i - 230 - 160, P - 230 - 25, 40, r),
        l(-o + 230, -a + P - 30, P - 230 - 25, s - P - 160 + 30, 40, r));
      const O = 3,
        I = (i - 230 - 160) / O;
      for (let B = 1; B < O; B++)
        c(-o + 230 + I * B, -a + 230, -o + 230 + I * B, -a + P - 25);
      break;
    }
    case "sideboard":
      (l(-o, -a, i, s, 6, r), c(-o, -a, o, a), c(o, -a, -o, a));
      for (let _ = 1; _ < 4; _++)
        c(-o + (i * _) / 4, a - 60, -o + (i * _) / 4, a);
      break;
    case "kitchenIsland": {
      const _ = Yt(e, "seat", 0);
      (l(-o, -a, i, s, 20, r),
        l(-o + 30, -a + 30, i - 60, s - 60, 14, null),
        _ > 0 &&
          (n.setLineDash([t * 5, t * 3]),
          c(-o, a - _, o, a - _),
          n.setLineDash([])));
      const A = s - Math.max(0, _);
      if (
        (Yt(e, "sink", !0) &&
          (l(
            -o + i * 0.14,
            -a + 90,
            Math.min(600, i * 0.3),
            Math.max(200, A - 180),
            30,
            "#dfe3e6",
          ),
          f(-o + i * 0.14 + Math.min(300, i * 0.15), -a + 130, 20)),
        Yt(e, "hob", !1))
      ) {
        const P = o - Math.min(i * 0.25, 450);
        (l(P - 300, -a + 80, 600, Math.max(200, A - 160), 14, "#2b2e33"),
          (n.strokeStyle = "#9aa1ab"),
          f(P - 140, -a + A / 2, 80),
          f(P + 140, -a + A / 2, 80));
      }
      break;
    }
    case "barStool":
      (f(0, 0, Math.min(i, s) * 0.42, r), f(0, 0, Math.min(i, s) * 0.25));
      break;
    case "piano":
      (l(-o, -a, i, s, 12, r), l(-o + 60, a - 220, i - 120, 160, 8, "#f6f6f2"));
      for (let _ = -o + 110; _ < o - 70; _ += 70) c(_, a - 220, _, a - 60);
      break;
    case "acWall":
    case "acFloor": {
      (n.setLineDash(e.type === "acWall" ? [t * 5, t * 3] : []),
        l(-o, -a, i, s, 20, r),
        n.setLineDash([]),
        (n.strokeStyle = "#7fa4c4"));
      for (let _ = 1; _ <= 3; _++)
        c(-o + 60, -a + (s * _) / 4, o - 60, -a + (s * _) / 4);
      break;
    }
    case "waterHeater":
    case "gasHeater": {
      (n.setLineDash([t * 5, t * 3]),
        l(-o, -a, i, s, e.type === "waterHeater" ? s / 2 : 20, r),
        n.setLineDash([]),
        (n.strokeStyle = "#e03131"),
        f(-i * 0.15, 0, Math.min(i, s) * 0.12),
        (n.strokeStyle = "#1c7ed6"),
        f(i * 0.15, 0, Math.min(i, s) * 0.12));
      break;
    }
    case "waterDispenser":
    case "purifier":
    case "airPurifier":
      (l(-o, -a, i, s, 30, r), f(0, 0, Math.min(i, s) * 0.28, "#dbe8f2"));
      break;
    case "dishwasher":
    case "dryer":
    case "tallOven":
      (l(-o, -a, i, s, 16, r),
        l(-o + 50, -a + 70, i - 100, 60, 8, "#9aa1ab"),
        e.type === "dryer"
          ? f(0, 40, Math.min(i, s) * 0.3, "#e6eaee")
          : c(-o + 50, a - 60, o - 50, a - 60));
      break;
    case "hood":
      (n.setLineDash([t * 5, t * 3]),
        l(-o, -a, i, s, 16, r),
        c(-o, -a, o, a),
        c(o, -a, -o, a),
        n.setLineDash([]));
      break;
    case "microwave":
      (l(-o, -a, i, s, 12, r),
        l(-o + 30, -a + 40, i * 0.65, s - 80, 8, "#2b2e33"));
      break;
    case "wallTV":
      (n.setLineDash([t * 5, t * 3]),
        l(-o, -a, i, Math.max(s, 40), 4, "#2a2d33"),
        n.setLineDash([]));
      break;
    case "robotVac":
      (l(-o, -a, i, s, 30, r), f(0, s * 0.1, Math.min(i, s) * 0.36, "#55595f"));
      break;
    case "treadmill":
      (l(-o, -a, i, s, 30, r),
        l(-o + 80, -a + 260, i - 160, s - 360, 40, "#4a4e55"),
        l(-o + 40, -a + 20, i - 80, 180, 30, "#3b3f46"));
      break;
    case "floorLamp":
    case "deskLamp":
      (f(0, 0, Math.min(i, s) / 2, "#fff8e6"),
        f(0, 0, Math.min(i, s) * 0.18, r),
        c(-o * 0.7, 0, o * 0.7, 0),
        c(0, -a * 0.7, 0, a * 0.7));
      break;
    case "curtain": {
      ((n.strokeStyle = we(r, -0.35)),
        c(-o, -a + 20, o, -a + 20),
        n.beginPath());
      const _ = Math.max(6, Math.round(i / 120));
      for (let A = 0; A <= _; A++) {
        const P = -o + (i * A) / _,
          D = A % 2 ? a : -a + 50;
        A ? n.lineTo(P, D) : n.moveTo(P, D);
      }
      n.stroke();
      break;
    }
    case "showerScreen":
      ((n.lineWidth = t * 3),
        (n.strokeStyle = "#7fb0cc"),
        c(-o, 0, o, 0),
        (n.lineWidth = t * 1.1),
        (n.strokeStyle = "#4b525d"),
        f(-o, 0, 20));
      break;
    case "showerSet": {
      const _ = Math.min(260, i * 0.3);
      (l(-o, -a, i, s, 6, r),
        l(o - _, -a, _, s, 4, we(r, -0.12)),
        c(o - _ + 20, a - 10, o - 30, -a + 15));
      const A = Math.min(60, s * 0.35, (i - _) / 8);
      for (let P = 0; P < 3; P++) f(-o + ((i - _) * (P + 1)) / 4, 0, A);
      break;
    }
    case "towelWarmer":
      l(-o, -a, i, s, 10, r);
      for (let _ = -o + 60; _ < o - 30; _ += 90) c(_, -a, _, a);
      break;
    case "mirrorCabinet":
      (n.setLineDash([t * 5, t * 3]),
        l(-o, -a, i, s, 6, "#dfe9ef"),
        n.setLineDash([]),
        c(0, -a, 0, a));
      break;
    case "bathHeater":
      (n.setLineDash([t * 5, t * 3]),
        l(-o, -a, i, s, 20, r),
        n.setLineDash([]),
        f(0, 0, Math.min(i, s) * 0.3));
      for (let _ = 0; _ < 4; _++) {
        const A = (_ * Math.PI) / 2 + 0.6;
        c(0, 0, Math.cos(A) * i * 0.28, Math.sin(A) * s * 0.28);
      }
      break;
    case "clothesRack":
      (n.setLineDash([t * 5, t * 3]),
        l(-o, -a, i, s, 20, null),
        n.setLineDash([]),
        (n.strokeStyle = "#7d8793"));
      for (const _ of [-s * 0.3, 0, s * 0.3]) c(-o + 40, _, o - 40, _);
      break;
    case "laundrySink":
      (l(-o, -a, i, s, 16, r),
        l(-o + 60, -a + 60, i - 120, s - 140, 40, "#dfe3e6"),
        f(0, -a + 100, 20));
      break;
    case "roundBed": {
      const _ = Math.min(i, s) / 2;
      (f(0, 0, _, "#f4efe8"),
        n.beginPath(),
        n.arc(0, 0, _, Math.PI * 1.15, Math.PI * 1.85),
        (n.lineWidth = t * 6),
        (n.strokeStyle = we(r, -0.3)),
        n.stroke(),
        (n.lineWidth = t * 1.1),
        (n.strokeStyle = "#4b525d"),
        f(0, _ * 0.2, _ * 0.72, r),
        l(-_ * 0.45, -_ * 0.62, _ * 0.4, _ * 0.22, 30, "#fff"),
        l(_ * 0.05, -_ * 0.62, _ * 0.4, _ * 0.22, 30, "#fff"));
      break;
    }
    case "chest":
      l(-o, -a, i, s, 8, r);
      for (let _ = 1; _ < 4; _++)
        c(-o + 30, -a + (s * _) / 4, o - 30, -a + (s * _) / 4);
      break;
    case "coatRack":
      f(0, 0, Math.min(i, s) * 0.35, r);
      for (let _ = 0; _ < 3; _++) {
        const A = _ * 2.09;
        c(0, 0, Math.cos(A) * o, Math.sin(A) * a);
      }
      break;
    case "stool":
    case "ottoman":
      (f(0, 0, Math.min(i, s) / 2, r), f(0, 0, Math.min(i, s) * 0.36));
      break;
    case "bayCushion":
      l(-o, -a, i, s, 30, r);
      for (let _ = 0; _ < 3; _++)
        l(-o + 100 + _ * 500, -a + 30, 420, 120, 40, we(r, -0.1));
      break;
    case "lDesk": {
      const _ = Math.min(600, i * 0.4);
      (n.beginPath(),
        n.moveTo(-o, -a),
        n.lineTo(o, -a),
        n.lineTo(o, a),
        n.lineTo(o - _, a),
        n.lineTo(o - _, -a + 600),
        n.lineTo(-o, -a + 600),
        n.closePath(),
        (n.fillStyle = r),
        n.fill(),
        n.stroke(),
        l(-o + 200, -a + 60, 560, 50, 10, "#2a2d33"));
      break;
    }
    case "uSofa": {
      const _ = Math.min(950, s * 0.48),
        A = we(r, -0.15);
      (n.beginPath(),
        n.moveTo(-o, -a),
        n.lineTo(o, -a),
        n.lineTo(o, a),
        n.lineTo(o - _, a),
        n.lineTo(o - _, -a + _),
        n.lineTo(-o + _, -a + _),
        n.lineTo(-o + _, a),
        n.lineTo(-o, a),
        n.closePath(),
        (n.fillStyle = A),
        n.fill(),
        n.stroke(),
        l(-o + 200, -a + 230, i - 400, _ - 250, 40, r),
        l(-o + 200, -a + _ - 20, _ - 220, s - _ - 30, 40, r),
        l(o - _ + 20, -a + _ - 20, _ - 220, s - _ - 30, 40, r));
      break;
    }
    case "curvedSofa":
    case "bendSofa": {
      const _ = dd(e),
        A = (P, D) => {
          (n.beginPath(),
            P.forEach((O, I) => (I ? n.lineTo(O.x, O.y) : n.moveTo(O.x, O.y))),
            n.closePath(),
            (n.fillStyle = D),
            n.fill(),
            n.stroke());
        };
      (A(_.outline, we(r, -0.14)),
        A(_.seat, r),
        _.back.length && A(_.back, we(r, -0.24)));
      for (const P of _.splits) {
        const D = xy(_, P),
          O = P >= _.open && _.back.length ? D.d / 2 - _.bk : D.d / 2 - 40;
        c(
          D.p.x + D.n.x * O,
          D.p.y + D.n.y * O,
          D.p.x - D.n.x * (D.d / 2 - 30),
          D.p.y - D.n.y * (D.d / 2 - 30),
        );
      }
      break;
    }
    case "chaise":
      (l(-o, -a, i, s, 60, we(r, -0.12)),
        l(-o + 60, -a + 60, i - 120, s - 120, 50, r),
        l(-o + 40, -a + 40, 420, s - 80, 60, we(r, -0.2)));
      break;
    case "beanbag":
      (n.beginPath(),
        n.ellipse(0, 0, o, a, 0.3, 0, Math.PI * 2),
        (n.fillStyle = r),
        n.fill(),
        n.stroke(),
        n.beginPath(),
        n.ellipse(0, -a * 0.3, o * 0.55, a * 0.4, 0.3, 0, Math.PI * 2),
        n.stroke());
      break;
    case "roundTable":
      (f(0, 0, Math.min(i, s) / 2, r), f(0, 0, Math.min(i, s) / 2 - 50));
      break;
    case "ovalTable":
      (u(0, 0, o, a, r), u(0, 0, o - 50, a - 50));
      break;
    case "booth":
      (l(-o, -a, i, s, 20, we(r, -0.15)),
        l(-o + 20, -a + 160, i - 40, s - 180, 20, r));
      break;
    case "wineCabinet":
    case "displayCabinet":
      (l(-o, -a, i, s, 6, r),
        (n.strokeStyle = "#7fb0cc"),
        c(-o + 30, a - 25, o - 30, a - 25),
        (n.strokeStyle = "#4b525d"),
        c(0, a - 60, 0, a));
      break;
    case "consoleTable":
      (l(-o, -a, i, s, 12, r),
        f(-o + 250, 0, Math.min(s * 0.25, 90), "#d9cdb8"));
      break;
    case "rockingChair":
      (l(-o, -a + 100, i, s - 200, 60, r),
        (n.lineWidth = t * 3),
        c(-o + 40, -a, -o + 40, a),
        c(o - 40, -a, o - 40, a),
        (n.lineWidth = t * 1.1));
      break;
    case "hangingChair": {
      const _ = Math.min(i, s) / 2;
      (n.setLineDash([t * 5, t * 3]),
        f(0, 0, _ * 0.9),
        n.setLineDash([]),
        f(0, 0, _ * 0.55, r),
        f(0, 0, _ * 0.3, "#f2ede4"));
      break;
    }
    case "fireplace":
      (l(-o, -a, i, s, 8, r), l(-i * 0.3, a - 90, i * 0.6, 70, 6, "#2b2e33"));
      break;
    case "fishTank":
      (l(-o, -a, i, s, 8, r),
        l(-o + 30, -a + 30, i - 60, s - 60, 6, "#bfe3ef"));
      break;
    case "projScreen":
      (n.setLineDash([t * 5, t * 3]),
        l(-o, -a, i, Math.max(s, 40), 4, "#f4f4f2"),
        n.setLineDash([]));
      break;
    case "speaker":
      (l(-o, -a, i, s, 20, r), f(0, 30, Math.min(i, s) * 0.3, "#555"));
      break;
    case "screenDivider": {
      ((n.lineWidth = t * 3), (n.strokeStyle = we(r, -0.2)));
      const _ = Math.max(3, Math.round(i / 450));
      n.beginPath();
      for (let A = 0; A <= _; A++) {
        const P = -o + (i * A) / _,
          D = A % 2 ? 60 : -60;
        A ? n.lineTo(P, D) : n.moveTo(P, D);
      }
      (n.stroke(), (n.lineWidth = t * 1.1));
      break;
    }
    case "hangingPlant": {
      (n.setLineDash([t * 5, t * 3]),
        f(0, 0, Math.min(i, s) / 2),
        n.setLineDash([]));
      const _ = Math.min(i, s) / 2;
      n.strokeStyle = "#3f5f38";
      for (let A = 0; A < 6; A++) {
        const P = (A / 6) * Math.PI * 2;
        f(
          Math.cos(P) * _ * 0.5,
          Math.sin(P) * _ * 0.5,
          _ * 0.3,
          A % 2 ? we(r, 0.15) : r,
        );
      }
      break;
    }
    case "vase":
      (f(0, 0, Math.min(i, s) / 2, r),
        f(0, 0, Math.min(i, s) * 0.2, we(r, -0.2)));
      break;
    case "wallPanel": {
      l(-o, -a, i, s, 4, r);
      const _ = String(Yt(e, "style", "slat"));
      if (_ === "slat")
        for (let A = -o + 120; A < o - 60; A += 120) c(A, -a, A, a);
      else {
        const A = Math.max(1, Math.round(i / (_ === "soft" ? 500 : 1200)));
        for (let P = 1; P < A; P++)
          c(-o + (i * P) / A, -a, -o + (i * P) / A, a);
      }
      break;
    }
    case "wallArt": {
      n.setLineDash([t * 5, t * 3]);
      const _ = i > 1200 ? 3 : 1,
        A = (i - (_ - 1) * 60) / _;
      for (let P = 0; P < _; P++)
        l(-o + P * (A + 60), -a, A, Math.max(s, 40), 2, r);
      n.setLineDash([]);
      break;
    }
    case "clock":
      (n.setLineDash([t * 5, t * 3]),
        l(-o, -a, i, Math.max(s, 40), 20, r),
        n.setLineDash([]));
      break;
    case "rugRound": {
      ((n.globalAlpha = 0.85),
        f(0, 0, Math.min(i, s) / 2, r),
        (n.globalAlpha = 1),
        n.setLineDash([t * 6, t * 4]),
        (n.strokeStyle = we(r, -0.3)),
        f(0, 0, Math.min(i, s) / 2 - 150),
        n.setLineDash([]));
      break;
    }
    case "fan":
      f(0, 0, Math.min(i, s) / 2, r);
      for (let _ = 0; _ < 3; _++) {
        const A = _ * 2.09;
        u(
          Math.cos(A) * i * 0.2,
          Math.sin(A) * i * 0.2,
          i * 0.14,
          i * 0.07,
          "#dfe3e6",
        );
      }
      break;
    case "radiator":
      (n.setLineDash([t * 4, t * 3]),
        l(-o, -a, i, Math.max(s, 40), 4, r),
        n.setLineDash([]));
      for (let _ = -o + 80; _ < o; _ += 80) c(_, -a, _, a);
      break;
    case "lCounter": {
      (n.beginPath(),
        n.moveTo(-o, -a),
        n.lineTo(o, -a),
        n.lineTo(o, -a + 600),
        n.lineTo(-o + 600, -a + 600),
        n.lineTo(-o + 600, a),
        n.lineTo(-o, a),
        n.closePath(),
        (n.fillStyle = r),
        n.fill(),
        n.stroke(),
        l(-o + 650, -a + 90, 700, 420, 50, "#dfe3e6"));
      const A = o - 640;
      (l(A - 320, -a + 70, 640, 460, 16, "#2b2e33"),
        (n.strokeStyle = "#9aa1ab"),
        f(A - 160, -a + 300, 95),
        f(A + 160, -a + 300, 95));
      break;
    }
    case "freezer":
      (l(-o, -a, i, s, 20, r), c(-o + 40, -a + 40, o - 40, -a + 40));
      break;
    case "bin":
      (f(0, 0, Math.min(i, s) / 2, r), f(0, 0, Math.min(i, s) * 0.3));
      break;
    case "squat":
      (l(-o, -a, i, s, 30, "#eef3f6"),
        u(0, 30, o * 0.7, a * 0.7, r),
        u(0, 50, o * 0.4, a * 0.45, "#dfe9ef"));
      break;
    case "pedestalSink":
      (u(0, 0, o, a, r),
        u(0, 20, o * 0.6, a * 0.55, "#eef3f6"),
        f(0, -a + 60, 18));
      break;
    case "freeTub":
      (u(0, 0, o, a, r), u(0, 0, o - 80, a - 80, "#e3f1f7"), f(o + 100, 0, 25));
      break;
    case "shelfRack":
      (l(-o, -a, i, s, 4, r), c(-o, -a, o, a));
      break;
    case "outdoorSet":
      (f(0, 0, 400, r),
        l(-o + 20, -250, 500, 500, 30, we(r, 0.2)),
        l(o - 520, -250, 500, 500, 30, we(r, 0.2)),
        n.setLineDash([t * 5, t * 3]),
        f(0, 0, Math.min(i, s) / 2 - 50),
        n.setLineDash([]));
      break;
    case "plantShelf":
      (l(-o, -a, i, s, 6, r), (n.strokeStyle = "#3f5f38"));
      for (let _ = -o + 150; _ < o - 50; _ += 300) f(_, 0, 90, "#6f9a5f");
      break;
    case "bike":
      (l(-o, -a, i, s, 40, r),
        l(-60, -a + 60, 120, s - 120, 30, "#555"),
        c(-o + 60, a - 150, o - 60, a - 150));
      break;
    case "yogaMat":
      (l(-o, -a, i, s, 30, r), f(0, -a + 40, 45, we(r, -0.15)));
      break;
    case "catTree":
      (l(-o, -a, i, s, 20, r),
        f(-i * 0.2, -s * 0.2, 60, "#c9b28c"),
        f(i * 0.22, s * 0.2, 60, "#c9b28c"),
        l(-i * 0.4, -s * 0.3, i * 0.45, s * 0.4, 20, null));
      break;
    case "petBed":
      (u(0, 0, o, a, r), u(0, 0, o * 0.7, a * 0.7, we(r, 0.3)));
      break;
    case "cabinet": {
      const _ = e.cab,
        A = (_ == null ? void 0 : _.kind) === "wall";
      if (!_) {
        l(-o, -a, i, s, 6, r);
        break;
      }
      A && n.setLineDash([t * 6, t * 4]);
      const P = rM(e);
      P
        ? (n.beginPath(),
          P.forEach((D, O) => (O ? n.lineTo(D.x, D.y) : n.moveTo(D.x, D.y))),
          n.closePath(),
          A || ((n.fillStyle = r), n.fill()),
          n.stroke())
        : l(-o, -a, i, s, 6, A ? null : r);
      for (const { run: D, cols: O, ws: I } of Hr(e)) {
        const B = D.rect,
          z = B.x1 - B.x0,
          V = B.y1 - B.y0;
        (_.kind === "tall" || A) &&
          (c(B.x0, B.y0, B.x1, B.y1), c(B.x1, B.y0, B.x0, B.y1));
        const W = ef(O, I, D.dir === "x" ? z : V);
        let K = 0;
        for (let C = 0; C < W.length - 1; C++)
          if (((K += W[C]), D.dir === "x"))
            c(B.x0 + K, B.y1 - Math.min(80, V * 0.2), B.x0 + K, B.y1);
          else {
            const F = D.front > 0 ? B.x1 : B.x0;
            c(F - D.front * Math.min(80, z * 0.2), B.y0 + K, F, B.y0 + K);
          }
        if (D.dir === "x") c(B.x0, B.y1 - 30, B.x1, B.y1 - 30);
        else {
          const C = D.front > 0 ? B.x1 - 30 : B.x0 + 30;
          c(C, B.y0, C, B.y1);
        }
      }
      n.setLineDash([]);
      break;
    }
    case "model": {
      const _ = e.modelId ? LC(e.modelId) : null;
      (_
        ? (n.drawImage(_, -o, -a, i, s),
          (n.strokeStyle = "rgba(75,82,93,.6)"),
          n.strokeRect(-o, -a, i, s))
        : (l(-o, -a, i, s, 10, "#eceae6"), c(-o, -a, o, a), c(o, -a, -o, a)),
        c(-o * 0.3, -a + 30, o * 0.3, -a + 30));
      break;
    }
    case "elevator": {
      (l(-o, -a, i, s, 0, "#eef0f3"),
        c(-o, -a, o, a),
        c(o, -a, -o, a),
        (n.lineWidth = t * 2.4),
        c(-o * 0.8, a - 20, o * 0.8, a - 20),
        (n.lineWidth = t * 1.1),
        n.save(),
        (n.font = `700 ${Math.min(220, i * 0.2)}px sans-serif`),
        (n.textAlign = "center"),
        (n.textBaseline = "middle"),
        (n.fillStyle = "#2f6fed"),
        (n.fillStyle = "rgba(255,255,255,.9)"),
        n.fillRect(-i * 0.22, -i * 0.13, i * 0.44, i * 0.26),
        (n.fillStyle = "#2f6fed"),
        n.fillText("电梯", 0, 0),
        n.restore());
      break;
    }
    case "stairU":
    case "stairRun":
    case "stairDogleg": {
      const { steps: _, flights: A, landings: P } = qa(e),
        D = ((g = e.opt) == null ? void 0 : g.view) === "below",
        O = e.z || 0,
        I = +(((v = e.opt) == null ? void 0 : v.cut) ?? 1500),
        B = (U) => {
          var q;
          return (
            e.type === "stairRun" &&
            !D &&
            ((q = e.opt) == null ? void 0 : q.label) !== "下" &&
            O + U.top > I
          );
        };
      n.lineWidth = t * 0.9;
      for (const U of [...P, ..._])
        (n.beginPath(),
          U.poly
            ? (U.poly.forEach((q, Q) =>
                Q ? n.lineTo(q.x, q.y) : n.moveTo(q.x, q.y),
              ),
              n.closePath())
            : n.rect(U.x0, U.y0, U.x1 - U.x0, U.y1 - U.y0),
          B(U)
            ? (n.setLineDash([t * 6, t * 4]),
              (n.strokeStyle = "#9aa1ab"),
              n.stroke(),
              n.setLineDash([]))
            : ((n.fillStyle = "#f3f1ec"),
              n.fill(),
              (n.strokeStyle = "#7d8793"),
              n.stroke()));
      const z = _.filter((U) => !B(U)),
        V = e.type === "stairRun" && _.length > 0 && !z.length,
        W =
          e.type === "stairRun" && z.length && z.length < _.length
            ? Math.min(...z.map((U) => U.y0))
            : null;
      if (
        ((n.strokeStyle = "#4b525d"),
        (n.lineWidth = t * 1.3),
        V ||
          (e.type === "stairRun" &&
            (w = e.opt) != null &&
            w.flat &&
            B({
              top: e.h || 0,
            })))
      )
        (n.setLineDash([t * 6, t * 4]),
          (n.strokeStyle = "#9aa1ab"),
          n.strokeRect(-o, -a, i, s),
          n.setLineDash([]));
      else if (W === null) n.strokeRect(-o, -a, i, s);
      else {
        (n.beginPath(),
          n.moveTo(-o, W),
          n.lineTo(-o, a),
          n.lineTo(o, a),
          n.lineTo(o, W),
          n.stroke(),
          n.setLineDash([t * 6, t * 4]),
          (n.strokeStyle = "#9aa1ab"),
          n.beginPath(),
          n.moveTo(-o, W),
          n.lineTo(-o, -a),
          n.lineTo(o, -a),
          n.lineTo(o, W),
          n.stroke(),
          n.setLineDash([]));
        const U = Math.min(o, 400),
          q = Math.min(90, i * 0.06);
        ((n.strokeStyle = "#1f2329"),
          (n.lineWidth = t * 1.2),
          n.beginPath(),
          n.moveTo(-o, W + U),
          n.lineTo(-q * 1.5, W + (q * 1.5 * U) / o),
          n.lineTo(q, W + q * 2.5),
          n.lineTo(-q, W - q * 2.5),
          n.lineTo(q * 1.5, W - (q * 1.5 * U) / o),
          n.lineTo(o, W - U),
          n.stroke());
      }
      const K = ((e.rot || 0) * Math.PI) / 180,
        C = Math.max(200, Math.min(260, i * 0.1)),
        F = (x = e.opt) == null ? void 0 : x.label,
        G = (U, q) => {
          if (U.length < 2) return;
          ((n.strokeStyle = "#1f2329"),
            (n.lineWidth = t * 1.2),
            n.beginPath(),
            U.forEach((ye, Y) =>
              Y ? n.lineTo(ye.x, ye.y) : n.moveTo(ye.x, ye.y),
            ),
            n.stroke());
          const Q = U[U.length - 2],
            j = U[U.length - 1],
            te = Math.hypot(j.x - Q.x, j.y - Q.y) || 1,
            oe = (j.x - Q.x) / te,
            ce = (j.y - Q.y) / te,
            X = Math.min(240, i * 0.1);
          if (
            ((n.fillStyle = "#1f2329"),
            n.beginPath(),
            n.moveTo(j.x, j.y),
            n.lineTo(j.x - oe * X - ce * X * 0.4, j.y - ce * X + oe * X * 0.4),
            n.lineTo(j.x - oe * X + ce * X * 0.4, j.y - ce * X - oe * X * 0.4),
            n.closePath(),
            n.fill(),
            f(U[0].x, U[0].y, Math.min(60, i * 0.025), "#1f2329"),
            !q)
          )
            return;
          const ie = U[0],
            ne = U[1],
            ae = Math.hypot(ne.x - ie.x, ne.y - ie.y) || 1,
            re = ie.x - ((ne.x - ie.x) / ae) * C * 1.1,
            me = ie.y - ((ne.y - ie.y) / ae) * C * 1.1;
          (n.save(),
            n.translate(re, me),
            n.rotate(-K),
            (n.font = `700 ${C}px sans-serif`),
            (n.textAlign = "center"),
            (n.textBaseline = "middle"),
            (n.fillStyle = "rgba(255,255,255,.85)"),
            n.fillRect(-C * 0.6, -C * 0.6, C * 1.2, C * 1.2),
            (n.fillStyle = "#2f6fed"),
            n.fillText(q, 0, 0),
            n.restore());
        };
      if (e.type === "stairU") {
        const U = A[0].pts,
          q = {
            x: (U[1].x + U[2].x) / 2,
            y: U[1].y,
          },
          Q = Math.min(
            +(((b = e.opt) == null ? void 0 : b.land) || 1050),
            s * 0.6,
          ),
          j = -a,
          te = -a + Q,
          oe = Math.min(120, i * 0.04);
        ((n.strokeStyle = "#1f2329"),
          (n.lineWidth = t * 1.1),
          n.beginPath(),
          n.moveTo(q.x - oe, j),
          n.lineTo(q.x - oe, (j + te) / 2 - oe),
          n.lineTo(q.x + oe, (j + te) / 2 - oe * 0.3),
          n.lineTo(q.x - oe * 0.2, (j + te) / 2 + oe * 0.6),
          n.lineTo(q.x + oe, te),
          n.stroke(),
          G(
            [
              U[0],
              U[1],
              {
                x: q.x + (U[1].x > U[2].x ? oe * 2 : -oe * 2),
                y: q.y,
              },
            ],
            "上",
          ),
          ((M = e.opt) == null ? void 0 : M.down) !== !1 &&
            G(
              [
                U[3],
                {
                  x: U[3].x,
                  y: U[2].y + (U[3].y > U[2].y ? 1 : -1) * 120,
                },
              ],
              "下",
            ));
      } else
        for (const U of A) {
          const q = U.pts;
          if (D) {
            const Q = q[q.length - 1],
              j = q[0],
              te = Math.hypot(j.x - Q.x, j.y - Q.y) || 1,
              oe = (j.x - Q.x) / te,
              ce = (j.y - Q.y) / te;
            (G(
              [
                {
                  x: Q.x + oe * C * 1.6,
                  y: Q.y + ce * C * 1.6,
                },
                j,
              ],
              "",
            ),
              n.save(),
              n.translate(Q.x + oe * C * 0.7, Q.y + ce * C * 0.7),
              n.rotate(-K),
              (n.font = `700 ${C}px sans-serif`),
              (n.textAlign = "center"),
              (n.textBaseline = "middle"),
              (n.fillStyle = "rgba(255,255,255,.85)"),
              n.fillRect(-C * 0.6, -C * 0.6, C * 1.2, C * 1.2),
              (n.fillStyle = "#2f6fed"),
              n.fillText("下", 0, 0),
              n.restore());
          } else
            F === "下"
              ? G([q[q.length - 1], q[0]], "下")
              : V ||
                (W !== null && W >= q[0].y - 1) ||
                G(
                  W !== null
                    ? [
                        q[0],
                        {
                          x: q[0].x,
                          y: W + Math.min(250, i * 0.25),
                        },
                      ]
                    : q,
                  F === "" || F === "none" ? "" : "上",
                );
        }
      break;
    }
    case "car": {
      (l(-o, -a, i, s, Math.min(i, s) * 0.22, r),
        l(-o + 120, a * 0.05, i - 240, s * 0.16, 120, "#cfd8e0"),
        l(-o + 140, -a * 0.62, i - 280, s * 0.12, 100, "#cfd8e0"),
        l(-o + 160, -a * 0.45, i - 320, s * 0.5, 80, we(r, 0.12)));
      for (const _ of [-1, 1])
        for (const A of [-1, 1])
          l(
            _ * o - (_ > 0 ? 90 : -10) - 40,
            A * (a - 850) - 330,
            120,
            660,
            40,
            "#2b2e33",
          );
      break;
    }
    case "evCharger":
      (l(-o, -a, i, s, 20, r),
        n.beginPath(),
        n.moveTo(30, -a + 20),
        n.lineTo(-40, 10),
        n.lineTo(20, 10),
        n.lineTo(-30, a - 20),
        n.stroke());
      break;
    case "carport": {
      (n.setLineDash([t * 6, t * 4]),
        l(-o, -a, i, s, 0, null),
        c(-o, -a, o, a),
        c(o, -a, -o, a),
        n.setLineDash([]));
      const _ = o - 100,
        A = a - 200;
      for (const P of [-1, 1])
        for (const D of [-1, 1])
          l(P * _ - 50, D * A - 50, 100, 100, 0, "#3b3f46");
      break;
    }
    case "garageShelf":
      l(-o, -a, i, s, 6, r);
      for (let _ = -o + 500; _ < o - 50; _ += 500) c(_, -a, _, a);
      c(-o, 0, o, 0);
      break;
    case "workbench":
      (l(-o, -a, i, s, 8, r),
        l(-o, -a, i, 40, 0, "#d9cdb8"),
        l(-o + 200, -a + 120, 380, 160, 10, "#c8442b"));
      break;
    case "bicycle":
      (f(0, -a + 330, 300),
        f(0, a - 330, 300),
        c(0, -a + 330, 0, a - 330),
        c(-250, a - 450, 250, a - 450));
      break;
    case "pool": {
      (l(-o, -a, i, s, 60, "#e6e1d6"),
        l(-o + 300, -a + 300, i - 600, s - 600, 40, r),
        (n.strokeStyle = "rgba(255,255,255,.8)"));
      for (let _ = -a + 700; _ < a - 400; _ += 700) {
        n.beginPath();
        for (let A = -o + 400; A <= o - 400; A += 100) {
          const P = _ + Math.sin(A / 160) * 60;
          A === -o + 400 ? n.moveTo(A, P) : n.lineTo(A, P);
        }
        n.stroke();
      }
      n.strokeStyle = "#4b525d";
      for (let _ = 0; _ < 3; _++)
        c(-o + 320, -a + 450 + _ * 250, -o + 820, -a + 450 + _ * 250);
      break;
    }
    case "lawn": {
      (l(-o, -a, i, s, 30, r), (n.fillStyle = we(r, -0.2)));
      for (let _ = -o + 150; _ < o; _ += 300)
        for (let A = -a + 150; A < a; A += 300)
          n.fillRect(_ + ((A / 300) % 2) * 120, A, 30, 30);
      break;
    }
    case "stepStones": {
      const _ = Math.max(2, Math.round(s / 600));
      for (let A = 0; A < _; A++)
        l(
          -o * 0.9 + (A % 2 ? 0.05 : -0.05) * i,
          -a + (s / _) * A + (s / _) * 0.15,
          i * 0.85,
          (s / _) * 0.7,
          40,
          r,
        );
      break;
    }
    case "tree": {
      const _ = Math.min(i, s) / 2;
      ((n.fillStyle = r), (n.globalAlpha = 0.55), n.beginPath());
      for (let A = 0; A <= 24; A++) {
        const P = (A / 24) * Math.PI * 2,
          D = _ * (A % 2 ? 0.82 : 1);
        A
          ? n.lineTo(Math.cos(P) * D, Math.sin(P) * D)
          : n.moveTo(Math.cos(P) * D, Math.sin(P) * D);
      }
      (n.closePath(),
        n.fill(),
        (n.globalAlpha = 1),
        n.stroke(),
        f(0, 0, _ * 0.12, "#6b5442"),
        c(-_ * 0.5, 0, _ * 0.5, 0),
        c(0, -_ * 0.5, 0, _ * 0.5));
      break;
    }
    case "shrub": {
      const _ = Math.min(i, s) / 2;
      ((n.globalAlpha = 0.7),
        f(0, 0, _, r),
        (n.globalAlpha = 1),
        f(-_ * 0.3, -_ * 0.2, _ * 0.35),
        f(_ * 0.3, _ * 0.15, _ * 0.3));
      break;
    }
    case "gazebo": {
      (l(-o, -a, i, s, 0, "#e6e1d6"), c(-o, -a, o, a), c(o, -a, -o, a));
      for (const _ of [-1, 1])
        for (const A of [-1, 1]) f(_ * (o - 120), A * (a - 120), 80, r);
      break;
    }
    case "parasol": {
      const _ = Math.min(i, s) / 2;
      ((n.globalAlpha = 0.5), f(0, 0, _, r), (n.globalAlpha = 1));
      for (let A = 0; A < 8; A++) {
        const P = (A * Math.PI) / 4;
        c(0, 0, Math.cos(P) * _, Math.sin(P) * _);
      }
      f(0, 0, 450, "#e9e4dc");
      break;
    }
    case "sunLounger":
      (l(-o, -a, i, s, 60, r), c(-o, -a + s * 0.35, o, -a + s * 0.35));
      for (let _ = -a + s * 0.45; _ < a - 50; _ += 180)
        c(-o + 60, _, o - 60, _);
      break;
    case "swing":
      (l(-o, -a, i, s, 0, null),
        c(-o, 0, o, 0),
        l(-550, -230, 1100, 460, 40, r));
      break;
    case "bbq":
      (l(-o, -a, i, s, 12, r),
        l(-o + i * 0.15, -a + 80, i * 0.4, s - 160, 10, "#2b2e33"));
      for (let _ = -o + i * 0.18; _ < -o + i * 0.53; _ += 80)
        c(_, -a + 100, _, a - 100);
      l(i * 0.15, -a + 120, i * 0.25, s - 240, 30, "#e3e7ea");
      break;
    case "waterFeature":
      (l(-o, -a, i, s, 10, r),
        l(-o + 50, -a + 250, i - 100, s - 300, 10, "#a9d8ea"));
      break;
    case "fence":
      l(-o, -a, i, s, 0, r);
      for (let _ = -o + 140; _ < o; _ += 140) c(_, -a, _, a);
      break;
    case "gate": {
      (l(-o, -a, 200, s, 0, "#cfc8bb"),
        l(o - 200, -a, 200, s, 0, "#cfc8bb"),
        (n.lineWidth = t * 2),
        c(-o + 200, 0, o - 200, 0),
        (n.lineWidth = t * 1.1),
        n.setLineDash([t * 4, t * 3]),
        n.beginPath(),
        n.arc(-o + 200, 0, (i - 400) / 2, 0, Math.PI / 2),
        n.stroke(),
        n.beginPath(),
        n.arc(o - 200, 0, (i - 400) / 2, Math.PI / 2, Math.PI),
        n.stroke(),
        n.setLineDash([]));
      break;
    }
    case "lawnLamp":
      (f(0, 0, Math.min(i, s) / 2, "#fff3d6"),
        c(-60, -60, 60, 60),
        c(60, -60, -60, 60));
      break;
    case "billiards": {
      (l(-o, -a, i, s, 60, "#5a3b26"),
        l(-o + 120, -a + 120, i - 240, s - 240, 20, r));
      for (const _ of [-1, 1])
        for (const A of [-1, 0, 1]) f(_ * (o - 120), A * (a - 120), 55, "#111");
      break;
    }
    case "mahjong": {
      (l(-o, -a, i, s, 30, r),
        l(-o + 80, -a + 80, i - 160, s - 160, 20, "#2f6b45"));
      for (const [_, A] of [
        [0, -a - 300],
        [0, a + 300],
        [-o - 300, 0],
        [o + 300, 0],
      ])
        l(_ - 225, A - 225, 450, 450, 60, "#d6d9dd");
      break;
    }
    case "teaTable":
      (l(-o, -a, i, s, 30, r),
        l(-i * 0.35, -a + 120, i * 0.3, s * 0.5, 10, "#2b2e33"),
        f(i * 0.25, -a + s * 0.45, 70, "#c7ccd2"));
      for (const _ of [-1, 0, 1])
        l(_ * i * 0.32 - 225, a + 130, 450, 450, 40, we(r, 0.15));
      break;
    case "theaterSofa": {
      l(-o, -a, i, s, 40, r);
      const _ = i / 3;
      for (let A = 1; A < 3; A++)
        l(-o + _ * A - 70, -a, 140, s, 20, we(r, -0.15));
      l(-o + 30, -a, i - 60, 250, 30, we(r, -0.1));
      break;
    }
    case "grandPiano": {
      (n.beginPath(),
        n.moveTo(-o, -a),
        n.lineTo(o, -a),
        n.lineTo(o, s * 0.05),
        n.bezierCurveTo(o, s * 0.35, i * 0.1, s * 0.2, 0, a),
        n.bezierCurveTo(-i * 0.3, s * 0.55, -o, s * 0.4, -o, s * 0.2),
        n.closePath(),
        (n.fillStyle = r),
        n.fill(),
        n.stroke(),
        l(-o + 50, -a - 200, i - 100, 200, 0, "#f6f6f2"),
        l(-o + 50, -a - 120, i - 100, 60, 0, "#2b2e33"));
      break;
    }
    case "barCounter":
      (l(-o, -a, i, s, 8, r),
        l(-o, a - 120, i, 420, 20, "#e8e3da"),
        l(i * 0.2 - 225, -a + 150, 450, 350, 30, "#dfe6ea"));
      for (let _ = 0; _ < 3; _++)
        f(-o + 450 + (_ * (i - 900)) / 2, a + 500, 190, "#3b3f46");
      break;
    case "sauna":
      (l(-o, -a, i, s, 0, r),
        l(-o + 50, -a + 50, i - 100, 400, 0, we(r, 0.15)),
        l(-o + 50, -a + 50, 400, s - 100, 0, we(r, 0.15)),
        c(-o * 0.3, a, o * 0.5, a - 300));
      break;
    case "chandelier": {
      const _ = Math.min(i, s) / 2;
      (n.setLineDash([t * 3, t * 3]),
        f(0, 0, _),
        f(0, 0, _ * 0.7),
        n.setLineDash([]),
        c(-_, 0, _, 0),
        c(0, -_, 0, _),
        f(0, 0, _ * 0.15, "#e9e2d0"));
      break;
    }
    case "riser": {
      const _ = Math.min(i, s) / 2;
      (f(0, 0, _, "#ffffff"),
        n.save(),
        n.beginPath(),
        n.arc(0, 0, _, 0, Math.PI * 2),
        n.clip());
      for (let A = -_; A < _; A += Math.max(15, _ / 3)) c(A - _, _, A + _, -_);
      (n.restore(), f(0, 0, _));
      break;
    }
    case "acOutdoor":
      (l(-o, -a, i, s, 10, r), f(-i * 0.12, 0, Math.min(s * 0.4, i * 0.28)));
      for (let _ = 1; _ < 4; _++)
        c(i * 0.22, -a + (s * _) / 4, o - 30, -a + (s * _) / 4);
      break;
    case "louver":
      l(-o, -a, i, s, 0, "#ffffff");
      for (let _ = -o + 40; _ < o; _ += 80) c(_ - 30, a, _ + 30, -a);
      break;
    case "meterBox":
      (l(-o, -a, i, s, 0, r), c(-o, -a, o, a), c(o, -a, -o, a));
      break;
    case "cornerShelf": {
      const _ = ((T = e.opt) == null ? void 0 : T.corner) !== "right";
      (n.beginPath(),
        _
          ? (n.moveTo(-o, -a), n.lineTo(o, -a), n.lineTo(-o, a))
          : (n.moveTo(-o, -a), n.lineTo(o, -a), n.lineTo(o, a)),
        n.closePath(),
        (n.fillStyle = r),
        n.fill(),
        n.stroke());
      const A = Math.max(2, +(((k = e.opt) == null ? void 0 : k.shelves) || 5));
      for (let P = 1; P < A; P++) {
        const D = P / A;
        _
          ? c(-o, -a + s * D, -o + i * (1 - D), -a + s * D)
          : c(o - i * (1 - D), -a + s * D, o, -a + s * D);
      }
      break;
    }
    case "modularSofa": {
      const _ = Math.max(
          1,
          Math.round(+(((S = e.opt) == null ? void 0 : S.n) || 3)),
        ),
        A = i / _;
      for (let P = 0; P < _; P++) l(-o + P * A, -a, A, s, 40, r);
      (l(-o, -a, i, s * 0.22, 20, we(r, -0.12)),
        (E = e.opt) != null &&
          E.ottoman &&
          l(-A / 2, a + 120, A, A * 0.7, 40, we(r, 0.08)));
      break;
    }
    case "bayDeck":
      (l(-o, -a, i, s, 0, r), c(-o, a - 40, o, a - 40));
      break;
    case "plushToy":
      (f(0, s * 0.1, Math.min(i, s) * 0.38, r),
        f(0, -s * 0.25, Math.min(i, s) * 0.25, r));
      break;
    case "tableVase":
      (f(0, 0, Math.min(i, s) / 2, r), f(0, 0, Math.min(i, s) * 0.2));
      break;
    case "bookSet": {
      const _ = Math.max(3, Math.round(i / 40));
      for (let A = 0; A < _; A++)
        l(-o + (A * i) / _, -a, i / _, s, 0, A % 2 ? r : we(r, 0.2));
      break;
    }
    case "boiler":
      (l(-o, -a, i, s, 20, r), l(-i * 0.3, a - 60, i * 0.6, 40, 0, "#3bc3ff"));
      break;
    case "manifold":
      l(-o, -a, i, s, 10, r);
      for (let _ = -o + 80; _ < o - 40; _ += 100) c(_, -a, _, a);
      break;
    case "waterSoftener":
      (f(-i * 0.15, 0, Math.min(i, s) * 0.3, "#2f6fed"),
        l(i * 0.2 - i * 0.27, -a + s * 0.1, i * 0.55, s * 0.8, 20, r));
      break;
    default:
      l(-o, -a, i, s, 20, r);
  }
}
export function GC(n, e, t) {
  const i = Ns(e),
    s = yi(e, i),
    o = _y(e, i),
    a = e.color;
  ((n.lineWidth = t * 1.1),
    (n.strokeStyle = "#4b525d"),
    (n.lineJoin = "round"),
    n.setLineDash([]));
  const r = (v, w) => {
      (n.beginPath(),
        v.forEach((x, b) => (b ? n.lineTo(x.x, x.y) : n.moveTo(x.x, x.y))),
        n.closePath(),
        w && ((n.fillStyle = w), n.fill()),
        n.stroke());
    },
    l = (v, w, x = 0) => {
      (n.beginPath(),
        ls(n, v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0, x),
        w && ((n.fillStyle = w), n.fill()),
        n.stroke());
    };
  (r(o, i.top), (n.strokeStyle = we(a, -0.35)));
  for (const v of s) {
    const w = Pt(e, v, v.s0, v.s1, v.depth - 30, v.depth - 30);
    (n.beginPath(), n.moveTo(w.x0, w.y0), n.lineTo(w.x1, w.y1), n.stroke());
  }
  n.strokeStyle = "#4b525d";
  const c = s[i.sink.leg] || s[0],
    f = i.sink.off ? 0 : i.sink.bowls === 2 ? 2 : 1,
    u = i.sink.w;
  for (let v = 0; v < f; v++) {
    const w = i.sink.at - u / 2 + (u * v) / f + 25,
      x = i.sink.at - u / 2 + (u * (v + 1)) / f - 25;
    l(Pt(e, c, w, x, 90, c.depth - 90), "#dfe3e6", 40);
    const b = Pt(e, c, (w + x) / 2, (w + x) / 2, c.depth / 2, c.depth / 2);
    (n.beginPath(), n.arc(b.x0, b.y0, 22, 0, 7), n.stroke());
  }
  if (!i.sink.off) {
    const v = Pt(e, c, i.sink.at, i.sink.at, 50, 50);
    (n.beginPath(),
      n.arc(v.x0, v.y0, 18, 0, 7),
      (n.fillStyle = "#9aa1ab"),
      n.fill(),
      n.stroke());
  }
  const h = s[i.hob.leg] || s[0],
    p = i.hob.w;
  (i.hob.off ||
    l(
      Pt(e, h, i.hob.at - p / 2, i.hob.at + p / 2, 70, h.depth - 70),
      "#2b2e33",
      16,
    ),
    (n.strokeStyle = "#9aa1ab"));
  const d = i.hob.off ? 0 : i.hob.burners,
    y =
      d === 2
        ? [
            [-0.25, 0.5],
            [0.25, 0.5],
          ]
        : d === 3
          ? [
              [-0.28, 0.62],
              [0.28, 0.62],
              [0, 0.3],
            ]
          : d === 4
            ? [
                [-0.25, 0.3],
                [0.25, 0.3],
                [-0.25, 0.7],
                [0.25, 0.7],
              ]
            : [];
  for (const [v, w] of y) {
    const x = Pt(
      e,
      h,
      i.hob.at + v * p,
      i.hob.at + v * p,
      70 + (h.depth - 140) * w,
      70 + (h.depth - 140) * w,
    );
    (n.beginPath(),
      n.arc(x.x0, x.y0, Math.min(95, p * 0.13), 0, 7),
      n.stroke());
  }
  n.strokeStyle = "#4b525d";
  const m = I4(e, i);
  (m &&
    (l(m, we(a, -0.06)),
    n.beginPath(),
    n.moveTo(m.x0, m.y0),
    n.lineTo(m.x1, m.y1),
    n.moveTo(m.x1, m.y0),
    n.lineTo(m.x0, m.y1),
    n.stroke()),
    n.setLineDash([t * 6, t * 4]),
    (n.strokeStyle = "#7d8793"));
  const g = Math.max(450, p / 2 + 75);
  if (i.wall)
    for (let v = 0; v < s.length; v++) {
      if (i.wallLegs && !i.wallLegs.includes(v)) continue;
      const w = s[v],
        x = i.hood && i.hob.leg === v ? [i.hob.at - g, i.hob.at + g] : null,
        b = x
          ? [
              [w.s0, x[0]],
              [x[1], w.s1],
            ]
          : [[w.s0, w.s1]];
      for (const [M, T] of b)
        T - M > 150 && l(Pt(e, w, M, T, 0, i.wallD), null);
    }
  if (i.hood) {
    const v = Pt(e, h, i.hob.at - g, i.hob.at + g, 0, 520);
    (l(v, null),
      n.beginPath(),
      n.moveTo(v.x0, v.y0),
      n.lineTo(v.x1, v.y1),
      n.moveTo(v.x1, v.y0),
      n.lineTo(v.x0, v.y1),
      n.stroke());
  }
  n.setLineDash([]);
}
