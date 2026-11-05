/** Derived from ZWD11/house-plan-designer@b94183f9 (MIT, Copyright 2026 ZWD11).
 * Scope-aware extraction: scripts/extract-upstream.mjs. See reference/upstream/LICENSE.
 * Three.js core is an npm dependency; inherited modelling helpers retain their original behaviour. */
import {
  Group as ht,
  Mesh as Me,
  CylinderGeometry as Hn,
  MeshStandardMaterial as Jt,
  BoxGeometry as ot,
  Vector3 as H,
  BufferAttribute as jt,
  MathUtils as pc,
  TubeGeometry as cp,
  CatmullRomCurve3 as Eb,
  DoubleSide as e0,
  FrontSide as Hi,
  Shape as Is,
  Path as _u,
  ExtrudeGeometry as to,
  PlaneGeometry as mo,
  SphereGeometry as ds,
  CircleGeometry as rp,
  ConeGeometry as Cc,
  BufferGeometry as Bt,
  Float32BufferAttribute as vt,
  TorusGeometry as Zs,
  LatheGeometry as of,
  Vector2 as pe,
  PointLight as uo,
  CanvasTexture as gs,
  SRGBColorSpace as Et,
  ShapeGeometry as Nd,
  IcosahedronGeometry as Ru,
  OctahedronGeometry as lp,
} from "three";
import {
  cs,
  ja,
  F5,
} from "../../../../packages/scene-core/src/inherited/catalog.js";
import { we, Yt, xy, ef, bv, qa, gv, mv, vv } from "./furniture-2d.js";
import {
  Qc,
  g0,
  Cu,
  rv,
  xp,
  L4,
  dd,
  Hr,
  Pt,
  Ns,
  yi,
} from "../../../../packages/scene-core/src/inherited/footprints.js";
import { I4 } from "../../../../packages/scene-core/src/inherited/house-spec.js";
import { DC, fv } from "./asset-cache.ts";
export function on(n) {
  let e = n >>> 0;
  return () => (e = (e * 1664525 + 1013904223) >>> 0) / 4294967296;
}
export const WM = (n) => {
  var t;
  const e = (t = n.opt) == null ? void 0 : t.style;
  return typeof e == "string" && cs[e] ? cs[e] : null;
};
export function YP(n, e = 1e-4) {
  e = Math.max(e, Number.EPSILON);
  const t = {},
    i = n.getIndex(),
    s = n.getAttribute("position"),
    o = i ? i.count : s.count;
  let a = 0;
  const r = Object.keys(n.attributes),
    l = {},
    c = {},
    f = [],
    u = ["getX", "getY", "getZ", "getW"],
    h = ["setX", "setY", "setZ", "setW"];
  for (let v = 0, w = r.length; v < w; v++) {
    const x = r[v],
      b = n.attributes[x];
    l[x] = new jt(
      new b.array.constructor(b.count * b.itemSize),
      b.itemSize,
      b.normalized,
    );
    const M = n.morphAttributes[x];
    M &&
      (c[x] = new jt(
        new M.array.constructor(M.count * M.itemSize),
        M.itemSize,
        M.normalized,
      ));
  }
  const p = e * 0.5,
    d = Math.log10(1 / e),
    y = Math.pow(10, d),
    m = p * y;
  for (let v = 0; v < o; v++) {
    const w = i ? i.getX(v) : v;
    let x = "";
    for (let b = 0, M = r.length; b < M; b++) {
      const T = r[b],
        k = n.getAttribute(T),
        S = k.itemSize;
      for (let E = 0; E < S; E++) x += `${~~(k[u[E]](w) * y + m)},`;
    }
    if (x in t) f.push(t[x]);
    else {
      for (let b = 0, M = r.length; b < M; b++) {
        const T = r[b],
          k = n.getAttribute(T),
          S = n.morphAttributes[T],
          E = k.itemSize,
          _ = l[T],
          A = c[T];
        for (let P = 0; P < E; P++) {
          const D = u[P],
            O = h[P];
          if ((_[O](a, k[D](w)), S))
            for (let I = 0, B = S.length; I < B; I++) A[I][O](a, S[I][D](w));
        }
      }
      ((t[x] = a), f.push(a), a++);
    }
  }
  const g = n.clone();
  for (const v in n.attributes) {
    const w = l[v];
    if (
      (g.setAttribute(
        v,
        new jt(w.array.slice(0, a * w.itemSize), w.itemSize, w.normalized),
      ),
      v in c)
    )
      for (let x = 0; x < c[v].length; x++) {
        const b = c[v][x];
        g.morphAttributes[v][x] = new jt(
          b.array.slice(0, a * b.itemSize),
          b.itemSize,
          b.normalized,
        );
      }
  }
  return (g.setIndex(f), g);
}
export const Yo = (n) =>
  n === "stairU" || n === "stairRun" || n === "stairDogleg" || n === "stage";
export const pv = (n) => Yo(n) || n === "elevator";
export function yv(n, e, t, i = 0) {
  if (e < n.x0 - i || e > n.x1 + i || t < n.y0 - i || t > n.y1 + i) return !1;
  if (!n.poly) return !0;
  const s = n.poly;
  let o = !1;
  for (let a = 0, r = s.length - 1; a < s.length; r = a++)
    s[a].y > t != s[r].y > t &&
      e < ((s[r].x - s[a].x) * (t - s[a].y)) / (s[r].y - s[a].y) + s[a].x &&
      (o = !o);
  if (o || i <= 0) return o;
  for (let a = 0, r = s.length - 1; a < s.length; r = a++) {
    const l = s[r].x,
      c = s[r].y,
      f = s[a].x - l,
      u = s[a].y - c,
      h = f * f + u * u || 1,
      p = Math.max(0, Math.min(1, ((e - l) * f + (t - c) * u) / h));
    if (Math.hypot(l + f * p - e, c + u * p - t) <= i) return !0;
  }
  return !1;
}
export function WC(n) {
  if (n.type === "stage") return [];
  const e = n.w,
    t = n.d,
    i = n.h,
    s = e / 2,
    o = t / 2,
    a = n.opt || {},
    r = 40;
  if (n.type === "stairRun") {
    if (a.rail) return [];
    const v = gv(n);
    if (v) {
      const b = v.treads.length,
        M = i / b,
        T = v.rayAt[v.rayAt.length - 1],
        k = (P) => Math.atan2(P.y - v.pv.y, P.x - v.pv.x),
        S = (P) => {
          const D = k(v.rays[0]);
          let I =
            (Math.sign(
              Math.atan2(
                Math.sin(k(v.rays[1]) - D),
                Math.cos(k(v.rays[1]) - D),
              ),
            ) || 1) * Math.atan2(Math.sin(k(P) - D), Math.cos(k(P) - D));
          return (I < -1e-6 && (I += 2 * Math.PI), I);
        },
        E = (P) => {
          const D = Math.max(0, Math.min(1, S(P) / (T || 1)));
          return M + D * (i - M);
        },
        _ = v.path.map((P) => ({
          x: Math.max(-s + r, Math.min(s - r, P.x)),
          y: Math.max(-o + r, Math.min(o - r, P.y)),
          z: E(P),
        })),
        A = [];
      for (let P = 0; P + 1 < _.length; P++) {
        const D = _[P],
          O = _[P + 1],
          I = (D.x + O.x) / 2,
          B = (D.y + O.y) / 2,
          z =
            Math.abs(Math.abs(I) - (s - r)) < 2
              ? {
                  x: Math.sign(I),
                  y: 0,
                }
              : {
                  x: 0,
                  y: Math.sign(B),
                };
        A.push({
          pts: [D, O],
          n: z,
        });
      }
      return A;
    }
    if (a.flat)
      return [
        {
          pts: [
            {
              x: -s + r,
              y: -o + r,
              z: i,
            },
            {
              x: s - r,
              y: -o + r,
              z: i,
            },
          ],
          n: {
            x: 0,
            y: -1,
          },
        },
        {
          pts: [
            {
              x: s - r,
              y: -o + r,
              z: i,
            },
            {
              x: s - r,
              y: o - r,
              z: i,
            },
          ],
          n: {
            x: 1,
            y: 0,
          },
        },
        {
          pts: [
            {
              x: s - r,
              y: o - r,
              z: i,
            },
            {
              x: -s + r,
              y: o - r,
              z: i,
            },
          ],
          n: {
            x: 0,
            y: 1,
          },
        },
        {
          pts: [
            {
              x: -s + r,
              y: o - r,
              z: i,
            },
            {
              x: -s + r,
              y: -o + r,
              z: i,
            },
          ],
          n: {
            x: -1,
            y: 0,
          },
        },
      ];
    const w = mv(n),
      x = i / w;
    return [-1, 1].map((b) => ({
      pts: [
        {
          x: b * (s - r),
          y: o,
          z: x,
        },
        {
          x: b * (s - r),
          y: -o,
          z: i,
        },
      ],
      n: {
        x: b,
        y: 0,
      },
    }));
  }
  if (n.type !== "stairU") return [];
  const { run: l, land: c, r: f, n1: u, n2: h, k: p, sgn: d } = vv(n),
    y = (v) => v * d,
    m = (u + p) * f,
    g = (u + p + h) * f;
  return [
    {
      pts: [
        {
          x: y(s - r),
          y: o,
          z: f,
        },
        {
          x: y(s - r),
          y: -o + c,
          z: u * f,
        },
        {
          x: y(s - r),
          y: -o + r,
          z: m,
        },
      ],
      n: {
        x: d,
        y: 0,
      },
    },
    {
      pts: [
        {
          x: y(s - r),
          y: -o + r,
          z: m,
        },
        {
          x: y(s - l),
          y: -o + r,
          z: m,
        },
        {
          x: y(-s + l),
          y: -o + r,
          z: g,
        },
        {
          x: y(-s + r),
          y: -o + r,
          z: g,
        },
      ],
      n: {
        x: 0,
        y: -1,
      },
    },
    {
      pts: [
        {
          x: y(-s + r),
          y: -o + r,
          z: g,
        },
        {
          x: y(-s + r),
          y: -o + c,
          z: g + p * f,
        },
        {
          x: y(-s + r),
          y: o,
          z: i,
        },
      ],
      n: {
        x: -d,
        y: 0,
      },
    },
  ];
}
export function Sp(n, e) {
  const t = (n.rot * Math.PI) / 180,
    i = Math.cos(t),
    s = Math.sin(t),
    o = (d, y) => ({
      x: n.x + d * i - y * s,
      y: n.y + d * s + y * i,
    }),
    a = new Map(e.nodes.map((d) => [d.id, d])),
    r = (d) =>
      e.walls.some((y) => {
        if (y.status === "removed") return !1;
        const m = a.get(y.a),
          g = a.get(y.b);
        if (!m || !g) return !1;
        const v = g.x - m.x,
          w = g.y - m.y,
          x = v * v + w * w;
        if (!x) return !1;
        const b = ((d.x - m.x) * v + (d.y - m.y) * w) / x;
        return b < -0.02 || b > 1.02
          ? !1
          : Math.hypot(m.x + v * b - d.x, m.y + w * b - d.y) <= y.t / 2 + 30;
      }),
    l = n.z || 0,
    c = (d, y) =>
      e.furniture.some((m) => {
        if (m.id === n.id || !pv(m.type)) return !1;
        const g = (m.rot * Math.PI) / 180,
          v = d.x - m.x,
          w = d.y - m.y,
          x = v * Math.cos(g) + w * Math.sin(g),
          b = -v * Math.sin(g) + w * Math.cos(g);
        if (Math.abs(x) > m.w / 2 + 30 || Math.abs(b) > m.d / 2 + 30) return !1;
        if (!Yo(m.type)) return !0;
        const M = m.z || 0,
          T = qa(m);
        return [...T.steps, ...T.landings].some(
          (k) => yv(k, x, b, 30) && Math.abs(M + k.top - y) <= 450,
        );
      }),
    f = (d, y, m, g) =>
      [60, 160].some((v) => {
        const w = o(d + g.x * v, y + g.y * v);
        return r(w) || c(w, l + m);
      }),
    u = [],
    h = (d, y, m) => ({
      x: d.x + (y.x - d.x) * m,
      y: d.y + (y.y - d.y) * m,
      z: d.z + (y.z - d.z) * m,
    });
  for (const d of WC(n)) {
    let y = null;
    for (let m = 0; m + 1 < d.pts.length; m++) {
      const g = d.pts[m],
        v = d.pts[m + 1],
        w = Math.hypot(v.x - g.x, v.y - g.y);
      if (w < 1) continue;
      const x = Math.max(2, Math.round(w / 250));
      for (let b = 0; b < x; b++) {
        const M = h(g, v, (b + 0.5) / x);
        if (f(M.x, M.y, M.z, d.n)) y = null;
        else {
          const T = h(g, v, b / x),
            k = h(g, v, (b + 1) / x);
          (y || ((y = [T]), u.push(y)), y.push(k));
        }
      }
    }
  }
  const p = (d) =>
    d.filter((y, m) => {
      if (m === 0 || m === d.length - 1) return !0;
      const g = d[m - 1],
        v = d[m + 1],
        w = (y.x - g.x) * (v.y - y.y) - (y.y - g.y) * (v.x - y.x),
        x = Math.hypot(y.x - g.x, y.y - g.y),
        b = Math.hypot(v.x - y.x, v.y - y.y);
      return (
        Math.abs(w) > 1 ||
        Math.abs((y.z - g.z) / (x || 1) - (v.z - y.z) / (b || 1)) > 0.001
      );
    });
  return u
    .map(p)
    .filter(
      (d) =>
        d.reduce(
          (y, m, g) =>
            g ? y + Math.hypot(m.x - d[g - 1].x, m.y - d[g - 1].y) : 0,
          0,
        ) >= 350,
    );
}
export const w1 = new H();
export function ji(n, e, t, i, s, o) {
  const a = (2 * Math.PI * s) / 4,
    r = Math.max(o - 2 * s, 0),
    l = Math.PI / 4;
  (w1.copy(e), (w1[i] = 0), w1.normalize());
  const c = (0.5 * a) / (a + r),
    f = 1 - w1.angleTo(n) / l;
  return Math.sign(w1[t]) === 1 ? f * c : r / (a + r) + c + c * (1 - f);
}
export class Nv extends ot {
  constructor(e = 1, t = 1, i = 1, s = 2, o = 0.1) {
    if (
      ((s = s * 2 + 1),
      (o = Math.min(e / 2, t / 2, i / 2, o)),
      super(1, 1, 1, s, s, s),
      s === 1)
    )
      return;
    const a = this.toNonIndexed();
    ((this.index = null),
      (this.attributes.position = a.attributes.position),
      (this.attributes.normal = a.attributes.normal),
      (this.attributes.uv = a.attributes.uv));
    const r = new H(),
      l = new H(),
      c = new H(e, t, i).divideScalar(2).subScalar(o),
      f = this.attributes.position.array,
      u = this.attributes.normal.array,
      h = this.attributes.uv.array,
      p = f.length / 6,
      d = new H(),
      y = 0.5 / s;
    for (let m = 0, g = 0; m < f.length; m += 3, g += 2)
      switch (
        (r.fromArray(f, m),
        l.copy(r),
        (l.x -= Math.sign(l.x) * y),
        (l.y -= Math.sign(l.y) * y),
        (l.z -= Math.sign(l.z) * y),
        l.normalize(),
        (f[m + 0] = c.x * Math.sign(r.x) + l.x * o),
        (f[m + 1] = c.y * Math.sign(r.y) + l.y * o),
        (f[m + 2] = c.z * Math.sign(r.z) + l.z * o),
        (u[m + 0] = l.x),
        (u[m + 1] = l.y),
        (u[m + 2] = l.z),
        Math.floor(m / p))
      ) {
        case 0:
          (d.set(1, 0, 0),
            (h[g + 0] = ji(d, l, "z", "y", o, i)),
            (h[g + 1] = 1 - ji(d, l, "y", "z", o, t)));
          break;
        case 1:
          (d.set(-1, 0, 0),
            (h[g + 0] = 1 - ji(d, l, "z", "y", o, i)),
            (h[g + 1] = 1 - ji(d, l, "y", "z", o, t)));
          break;
        case 2:
          (d.set(0, 1, 0),
            (h[g + 0] = 1 - ji(d, l, "x", "z", o, e)),
            (h[g + 1] = ji(d, l, "z", "x", o, i)));
          break;
        case 3:
          (d.set(0, -1, 0),
            (h[g + 0] = 1 - ji(d, l, "x", "z", o, e)),
            (h[g + 1] = 1 - ji(d, l, "z", "x", o, i)));
          break;
        case 4:
          (d.set(0, 0, 1),
            (h[g + 0] = 1 - ji(d, l, "x", "y", o, e)),
            (h[g + 1] = 1 - ji(d, l, "y", "x", o, t)));
          break;
        case 5:
          (d.set(0, 0, -1),
            (h[g + 0] = ji(d, l, "x", "y", o, e)),
            (h[g + 1] = 1 - ji(d, l, "y", "x", o, t)));
          break;
      }
  }
}
export function cr(n, e, t, i, s, o = 0.02) {
  if (e.length < 3) return;
  const a = Math.min(o, i / 2 - 0.002),
    r = new Is(e.map((f) => new pe(f.x / 1e3, f.y / 1e3))),
    l = new to(r, {
      depth: Math.max(0.001, i - 2 * a),
      bevelEnabled: a > 0,
      bevelThickness: a,
      bevelSize: a,
      bevelOffset: -a,
      bevelSegments: 3,
      curveSegments: 6,
    });
  (l.rotateX(Math.PI / 2),
    l.translate(0, t + i - a, 0),
    l.computeVertexNormals());
  const c = new Me(l, s);
  return ((c.castShadow = !0), (c.receiveShadow = !0), n.add(c), c);
}
export function a2(n, e, t, i, s) {
  const o = Math.max(2, Math.ceil((t - e) / 40)),
    a = [],
    r = [];
  for (let l = 0; l <= o; l++) {
    const c = xy(n, e + ((t - e) * l) / o);
    (a.push({
      x: c.p.x + c.n.x * i(c.d),
      y: c.p.y + c.n.y * i(c.d),
    }),
      r.push({
        x: c.p.x + c.n.x * s(c.d),
        y: c.p.y + c.n.y * s(c.d),
      }));
  }
  return [...a, ...r.reverse()];
}
export function MD(n, e) {
  const t = dd(e),
    i = e.color,
    s = e.h / 1e3,
    o = L(we(i, -0.08), 0.95),
    a = L(i, 0.95),
    r = L(we(i, -0.04), 0.95),
    l = L("#3a2e25", 0.6),
    c = 0.4,
    f = 12;
  (cr(n, t.seat, 0, 0.08, l, 0),
    cr(n, t.outline, 0.07, c - 0.07, o, 0.03),
    t.back.length &&
      cr(n, t.back, c - 0.02, Math.max(0.2, s - c + 0.02), r, 0.05));
  const u = [0, ...t.splits, t.len];
  for (let h = 0; h < u.length - 1; h++) {
    const p = u[h] + (h ? f : 0),
      d = u[h + 1] - (h < u.length - 2 ? f : 0),
      y = (v) =>
        v >= t.open && t.back.length
          ? (w) => w / 2 - t.bk - 10
          : (w) => w / 2 - 50;
    t.back.length && p < t.open && d > t.open
      ? (cr(
          n,
          a2(t, p, t.open, y(p), (v) => -v / 2 + 40),
          c,
          0.15,
          a,
          0.065,
        ),
        cr(
          n,
          a2(t, t.open, d, y(d), (v) => -v / 2 + 40),
          c,
          0.15,
          a,
          0.065,
        ))
      : cr(
          n,
          a2(t, p, d, y(p), (v) => -v / 2 + 40),
          c,
          0.15,
          a,
          0.065,
        );
    const m = Math.max(p, t.open) + 30,
      g = d - 30;
    t.back.length &&
      g - m > 250 &&
      cr(
        n,
        a2(
          t,
          m,
          g,
          (v) => v / 2 - t.bk - 10,
          (v) => v / 2 - t.bk - 170,
        ),
        c + 0.15,
        Math.max(0.18, s - c - 0.2),
        a,
        0.08,
      );
  }
}
export const Da = (n) => n / 1e3;
export function x0(n, e, t, i, s, o = !0) {
  return N(
    n,
    Da(e.x1 - e.x0),
    i,
    Da(e.y1 - e.y0),
    Da((e.x0 + e.x1) / 2),
    t,
    Da((e.y0 + e.y1) / 2),
    s,
    o,
  );
}
export function pn(n, e, t, i, s, o, a, r, l = 18, c = 0, f = !1) {
  return x0(
    n,
    Pt(e, t, i, s, t.depth - 2 + c, t.depth - 2 + c + l),
    o,
    a - o,
    r,
    f,
  );
}
export function Qs(n, e, t, i, s, o, a, r = 0.3) {
  const l = L("#8a8f96", 0.3, 0.8);
  if (o !== "hidden") {
    if (o === "knob") {
      const c = Pt(e, t, i - 12, i + 12, t.depth + 16, t.depth + 36);
      x0(n, c, s - 0.012, 0.024, l, !1);
      return;
    }
    a
      ? pn(n, e, t, i - 6, i + 6, s - r / 2, s + r / 2, l, 14, 18)
      : pn(n, e, t, i - r * 500, i + r * 500, s - 0.007, s + 0.007, l, 14, 18);
  }
}
export function SD(n, e) {
  const t = Ns(e),
    i = yi(e, t),
    s = e.h / 1e3,
    o = t.thick / 1e3,
    a = e.color,
    r = L(a, 0.45),
    l = L(a, 0.4),
    c = L(we(a, -0.35), 0.7),
    f = L(
      t.top,
      t.top === "#c7ccd2" ? 0.25 : 0.3,
      t.top === "#c7ccd2" ? 0.7 : 0,
    ),
    u = 0.1,
    h = Math.max(450, t.hob.w / 2 + 75),
    p = I4(e, t);
  i.forEach((b, M) => {
    (x0(n, Pt(e, b, b.s0, b.s1, 0, b.depth - 70), 0, u, c),
      x0(n, Pt(e, b, b.s0, b.s1, 0, b.depth - 20), u, s - o - u, r),
      x0(n, Pt(e, b, b.s0, b.s1, 0, b.depth + 20), s - o, o, f));
    const T =
        M === 0 && i.length > 1 && i.some((P) => P.dir === "y" && P.back < 0)
          ? b.depth
          : 0,
      k = M === 0 && i.some((P) => P.dir === "y" && P.back > 0) ? b.depth : 0;
    let S = b.s0 + (M === 0 ? T : 0),
      E = b.s1 - (M === 0 ? k : 0);
    (T && pn(n, e, b, b.s0, S, u, s - o - 0.005, L(we(a, -0.06), 0.5)),
      k && pn(n, e, b, E, b.s1, u, s - o - 0.005, L(we(a, -0.06), 0.5)));
    const _ = Math.max(1, Math.round((E - S) / 600)),
      A = (E - S) / _;
    for (let P = 0; P < _; P++) {
      const D = S + A * P + 2,
        O = S + A * (P + 1) - 2,
        I = (D + O) / 2,
        B = !t.hob.off && t.hob.leg === M && Math.abs(I - t.hob.at) < A / 2;
      if (!(
        p &&
        (() => {
          const V = Pt(e, b, D, O, 0, b.depth);
          return (
            V.x0 < p.x1 - 5 &&
            V.x1 > p.x0 + 5 &&
            V.y0 < p.y1 - 5 &&
            V.y1 > p.y0 + 5
          );
        })()
      ))
        if (B) {
          const V = (s - o - u) / 3;
          for (let W = 0; W < 3; W++) {
            const K = u + V * W + 0.003;
            (pn(n, e, b, D, O, K, K + V - 0.006, l),
              Qs(n, e, b, I, K + V - 0.05, "bar", !1, Math.min(0.35, A / 2e3)));
          }
        } else
          (pn(n, e, b, D, O, u + 0.003, s - o - 0.006, l),
            Qs(
              n,
              e,
              b,
              P % 2 ? D + 50 : O - 50,
              s - o - 0.07,
              "bar",
              !0,
              0.15,
            ));
    }
  });
  const d = i[t.sink.leg] || i[0],
    y = t.sink.off ? 0 : t.sink.bowls === 2 ? 2 : 1;
  for (let b = 0; b < y; b++) {
    const M = t.sink.at - t.sink.w / 2 + (t.sink.w * b) / y + 25,
      T = t.sink.at - t.sink.w / 2 + (t.sink.w * (b + 1)) / y - 25;
    (x0(
      n,
      Pt(e, d, M, T, 90, d.depth - 90),
      s - 0.004,
      0.006,
      L("#aab1b8", 0.25, 0.8),
      !1,
    ),
      x0(
        n,
        Pt(e, d, M + 15, T - 15, 105, d.depth - 105),
        s - 0.012,
        0.01,
        L("#6e767e", 0.3, 0.7),
        !1,
      ));
  }
  if (!t.sink.off) {
    const b = Pt(e, d, t.sink.at - 15, t.sink.at + 15, 35, 65);
    ue(
      n,
      0.015,
      0.015,
      0.32,
      Da((b.x0 + b.x1) / 2),
      s,
      Da((b.y0 + b.y1) / 2),
      L("#c7ccd2", 0.2, 0.9),
    );
  }
  const m = i[t.hob.leg] || i[0];
  t.hob.off ||
    x0(
      n,
      Pt(
        e,
        m,
        t.hob.at - t.hob.w / 2,
        t.hob.at + t.hob.w / 2,
        70,
        m.depth - 70,
      ),
      s,
      0.008,
      L("#0f1012", 0.1, 0.2),
      !1,
    );
  const g = t.hob.off ? 0 : t.hob.burners,
    v =
      g === 2
        ? [
            [-0.25, 0.5],
            [0.25, 0.5],
          ]
        : g === 3
          ? [
              [-0.28, 0.62],
              [0.28, 0.62],
              [0, 0.3],
            ]
          : g === 4
            ? [
                [-0.25, 0.3],
                [0.25, 0.3],
                [-0.25, 0.7],
                [0.25, 0.7],
              ]
            : [];
  for (const [b, M] of v) {
    const T = Pt(
        e,
        m,
        t.hob.at + b * t.hob.w,
        t.hob.at + b * t.hob.w,
        70 + (m.depth - 140) * M,
        70 + (m.depth - 140) * M,
      ),
      k = ue(
        n,
        0.07,
        0.07,
        0.012,
        Da(T.x0),
        s + 0.008,
        Da(T.y0),
        L("#2b2e33", 0.4, 0.5),
        24,
      );
    k.castShadow = !1;
  }
  const w = t.wallZ / 1e3,
    x = t.wallH / 1e3;
  if (
    (t.wall &&
      i.forEach((b, M) => {
        if (t.wallLegs && !t.wallLegs.includes(M)) return;
        const T =
            t.hood && t.hob.leg === M ? [t.hob.at - h, t.hob.at + h] : null,
          k = T
            ? [
                [b.s0, T[0]],
                [T[1], b.s1],
              ]
            : [[b.s0, b.s1]];
        for (const [S, E] of k) {
          if (E - S < 150) continue;
          const _ = {
            ...b,
            depth: t.wallD,
          };
          x0(n, Pt(e, b, S, E, 0, t.wallD - 20), w, x, r);
          const A = Math.max(1, Math.round((E - S) / 450)),
            P = (E - S) / A;
          for (let D = 0; D < A; D++) {
            const O = S + P * D + 2,
              I = S + P * (D + 1) - 2;
            (pn(n, e, _, O, I, w + 0.003, w + x - 0.003, l),
              Qs(n, e, _, D % 2 ? O + 40 : I - 40, w + 0.07, "bar", !0, 0.12));
          }
        }
      }),
    t.hood)
  ) {
    const b = s + 0.68;
    (x0(
      n,
      Pt(e, m, t.hob.at - h + 30, t.hob.at + h - 30, 0, 520),
      b,
      0.12,
      L("#b9bec5", 0.3, 0.7),
    ),
      x0(
        n,
        Pt(e, m, t.hob.at - h + 30, t.hob.at + h - 30, 0, 380),
        b + 0.12,
        0.3,
        L("#c7ccd2", 0.3, 0.7),
      ),
      x0(
        n,
        Pt(e, m, t.hob.at - 150, t.hob.at + 150, 0, 250),
        b + 0.42,
        Math.max(0.05, w + x - b - 0.42),
        L("#c7ccd2", 0.3, 0.7),
      ));
  }
  if (p) {
    const b = (t.tallH || 2200) / 1e3;
    x0(n, p, 0, b, r);
    const M =
        i.find((S) => {
          const E = S.rect;
          return (
            p.x0 >= E.x0 - 1 &&
            p.x1 <= E.x1 + 1 &&
            p.y0 >= E.y0 - 1 &&
            p.y1 <= E.y1 + 1
          );
        }) || i[0],
      T = M.dir === "x" ? p.x0 + e.w / 2 : p.y0 + e.d / 2,
      k = M.dir === "x" ? p.x1 + e.w / 2 : p.y1 + e.d / 2;
    (pn(n, e, M, T + 2, k - 2, u, 0.85, l),
      pn(n, e, M, T + 2, k - 2, 0.87, 1.45, L("#15171a", 0.15, 0.3)),
      pn(n, e, M, T + 2, k - 2, 1.47, b - 0.003, l),
      Qs(n, e, M, k - 50, 0.7, "bar", !0, 0.2),
      Qs(n, e, M, k - 50, 1.6, "bar", !0, 0.2));
  }
}
export function TD(n, e) {
  const t = e.cab,
    i = e.h / 1e3,
    s = e.color,
    o = L(s, 0.55),
    a = L(we(s, -0.12), 0.7),
    r = L(s, 0.45),
    l = t.kind === "wall" ? 0 : (t.plinth ?? 80) / 1e3,
    c = t.kind === "tall" && t.top ? t.top / 1e3 : 0,
    f = t.handle || "bar",
    u = Hr(e),
    h = t.shape === "L";
  if (
    (u.forEach(({ run: p, cols: d, ws: y }, m) => {
      (x0(n, Pt(e, p, p.s0, p.s1, 0, 8), l, i - l, a),
        x0(n, Pt(e, p, p.s0, p.s1, 0, p.depth), i - 0.018, 0.018, o),
        x0(n, Pt(e, p, p.s0, p.s1, 0, p.depth), l, 0.018, o),
        l &&
          x0(
            n,
            Pt(e, p, p.s0, p.s1, 0, p.depth - 50),
            0,
            l,
            L(we(s, -0.25), 0.7),
          ));
      for (const T of [p.s0, p.s1])
        x0(
          n,
          Pt(
            e,
            p,
            T === p.s0 ? T : T - 18,
            T === p.s0 ? T + 18 : T,
            0,
            p.depth,
          ),
          l,
          i - l,
          o,
        );
      let g = p.s0,
        v = p.s1;
      if (h && m === 0) {
        const T = u[1].run.depth;
        t.corner !== "right" ? (g += T) : (v -= T);
      }
      h &&
        m === 0 &&
        pn(
          n,
          e,
          p,
          t.corner !== "right" ? p.s0 : v,
          t.corner !== "right" ? g : p.s1,
          l,
          i,
          L(we(s, -0.05), 0.5),
        );
      const w = ef(d, y, v - g),
        x = l,
        b = i - c;
      if (t.door === "sliding" && t.kind === "tall") {
        const T = Math.max(2, Math.round((v - g) / 900)),
          k = (v - g) / T;
        for (let E = 0; E < T; E++) {
          const _ = g + k * E - 15,
            A = g + k * (E + 1) + 15,
            P = E % 2 ? 4 : 26;
          (pn(
            n,
            e,
            p,
            Math.max(g, _),
            Math.min(v, A),
            x + 0.003,
            b - 0.003,
            L(E % 2 ? s : we(s, -0.05), 0.45),
            18,
            P,
          ),
            Qs(n, e, p, E % 2 ? _ + 60 : A - 60, (x + b) * 0.45, f, !0, 0.5));
        }
        c && pn(n, e, p, g, v, b + 0.003, i - 0.003, r);
        let S = g;
        w.forEach((E) => {
          ((S += E),
            S < v - 5 &&
              x0(n, Pt(e, p, S - 9, S + 9, 10, p.depth - 30), x, b - x, o));
        });
        return;
      }
      let M = g;
      w.forEach((T, k) => {
        const S = M,
          E = M + T,
          _ = (S + E) / 2;
        ((M = E),
          k < w.length - 1 &&
            x0(n, Pt(e, p, E - 9, E + 9, 10, p.depth - 2), x, i - x - 0.018, o),
          _D(n, e, p, d[k], S + 1.5, E - 1.5, _, x, b, k, t.kind, f, s, o),
          c &&
            d[k] !== "open" &&
            (x0(n, Pt(e, p, S, E, 10, p.depth - 2), b - 0.009, 0.018, o),
            pn(n, e, p, S + 1.5, E - 1.5, b + 0.003, i - 0.003, r),
            Qs(n, e, p, k % 2 ? S + 50 : E - 50, b + 0.06, f, !0, 0.12)));
      });
    }),
    t.kind === "base")
  )
    for (const { run: p } of u)
      x0(n, Pt(e, p, p.s0, p.s1, 0, p.depth + 20), i, 0.03, L("#e5e2dc", 0.25));
}
export function _D(n, e, t, i, s, o, a, r, l, c, f, u, h, p) {
  const d = L(h, 0.45),
    y = l - r,
    m = c % 2 ? s + 50 : o - 50,
    g = (x, b) => {
      const M = Math.max(1, Math.round((b - x) / 0.36));
      for (let T = 1; T < M; T++)
        x0(
          n,
          Pt(e, t, s + 9, o - 9, 20, t.depth - 25),
          x + ((b - x) * T) / M,
          0.018,
          p,
        );
    },
    v = (x, b, M = d) => {
      (pn(n, e, t, s, o, x + 0.003, b - 0.003, M),
        Qs(
          n,
          e,
          t,
          m,
          f === "wall" ? x + 0.07 : f === "base" ? b - 0.1 : x + (b - x) * 0.45,
          u,
          !0,
          f === "tall" ? 0.4 : 0.12,
        ));
    },
    w = (x, b) => {
      const M = Math.max(1, Math.round((b - x) / (f === "wall" ? 0.35 : 0.22)));
      for (let T = 0; T < M; T++) {
        const k = x + ((b - x) * T) / M;
        (pn(n, e, t, s, o, k + 0.003, k + (b - x) / M - 0.003, d),
          Qs(
            n,
            e,
            t,
            a,
            k + ((b - x) / M) * 0.72,
            u,
            !1,
            Math.min(0.3, ((o - s) * 0.45) / 1e3),
          ));
      }
    };
  switch (i) {
    case "open":
      g(r, l);
      return;
    case "hangOpen": {
      const x = l - Math.min(0.4, y * 0.22);
      (x0(n, Pt(e, t, s + 9, o - 9, 20, t.depth - 25), x, 0.018, p),
        x0(
          n,
          Pt(e, t, s + 12, o - 12, t.depth * 0.46, t.depth * 0.54),
          x - 0.08,
          0.022,
          L("#b9bec5", 0.25, 0.85),
        ));
      return;
    }
    case "glass":
      (g(r, l),
        pn(n, e, t, s, o, r + 0.003, l - 0.003, Es()),
        pn(n, e, t, s, s + 25, r, l, d),
        pn(n, e, t, o - 25, o, r, l, d),
        Qs(n, e, t, m, r + y * 0.45, u, !0, 0.3));
      return;
    case "drawer": {
      const x = f === "tall" ? Math.min(0.8, y * 0.35) : y;
      (w(r, r + x), f === "tall" && v(r + x, l));
      return;
    }
    case "mixed": {
      const x = Math.min(0.45, y * 0.4);
      (w(r, r + x), v(r + x, l));
      return;
    }
    case "niche": {
      if (f !== "tall") {
        g(r, l);
        return;
      }
      const x = Math.min(0.9, y * 0.4),
        b = Math.min(x + 0.4, y * 0.65);
      (v(r, r + x),
        x0(n, Pt(e, t, s, o, 10, t.depth - 2), r + x, 0.025, L("#e5e2dc", 0.3)),
        v(r + b, l),
        x0(n, Pt(e, t, s, o, 10, t.depth - 2), r + b - 0.018, 0.018, p));
      return;
    }
    default:
      v(r, l);
  }
}
export function AD(n, e) {
  const t = e.w / 1e3,
    i = e.d / 1e3,
    s = i / 2,
    o = e.color,
    a = Yt(e, "hang", !1),
    r = Yt(e, "basins", e.w >= 1200 ? 2 : 1),
    l = a ? 0.3 : 0,
    c = 0.82 - l;
  (N(n, t, c - 0.03, i, 0, l, 0, L(o, 0.5)),
    N(n, t + 0.01, 0.03, i + 0.01, 0, 0.79, 0, L("#f3f2ef", 0.2)),
    a || N(n, t - 0.04, 0.08, i - 0.05, 0, 0, -0.02, L(we(o, -0.25), 0.7)));
  for (let f = 0; f < r; f++) {
    const u = -t / 2 + (t * (f + 0.5)) / r;
    (ue(
      n,
      Math.min((t / r) * 0.28, 0.22),
      Math.min((t / r) * 0.22, 0.18),
      0.12,
      u,
      0.82,
      0.02,
      L("#ffffff", 0.15),
    ),
      ue(n, 0.012, 0.012, 0.18, u, 0.82, -s + 0.07, L("#c7ccd2", 0.2, 0.9)),
      (r > 1 || t > 0.7) &&
        N(
          n,
          0.005,
          c - 0.1,
          0.005,
          u + t / r / 2 - (f === r - 1 ? t / r / 2 : 0),
          l + 0.05,
          s,
          "#a8a196",
          !1,
        ));
  }
  Yt(e, "mirror", !0) &&
    N(n, t * 0.85, 0.75, 0.025, 0, 1.15, -s + 0.0125, L("#dfe9ef", 0.02, 0.9));
}
export function ED(n, e) {
  const t = e.w / 1e3,
    i = e.d / 1e3,
    s = t / 2,
    o = i / 2,
    a = Math.max(1.8, e.h / 1e3 - 0.05),
    r = Yt(e, "shape", "square");
  N(n, t, 0.05, i, 0, 0, 0, L("#f1f1f1", 0.5));
  const l = (c, f, u, h) => {
    const p = Math.hypot(u - c, h - f),
      d = N(n, p, a, 0.01, (c + u) / 2, 0.05, (f + h) / 2, Es(), !1);
    ((d.rotation.y = -Math.atan2(h - f, u - c)),
      ue(n, 0.012, 0.012, a, u, 0.05, h, L("#b9bec6", 0.3, 0.8), 8));
  };
  if (r === "line") l(-s, o, s, o);
  else if (r === "diamond") {
    const c = Math.min(t, i) * 0.38;
    (l(-s, o, s - c, o), l(s - c, o, s, o - c), l(s, o - c, s, -o));
  } else if (r === "arc")
    for (let f = 0; f < 8; f++) {
      const u = ((f / 8) * Math.PI) / 2,
        h = (((f + 1) / 8) * Math.PI) / 2;
      l(
        -s + Math.cos(h) * t,
        -o + Math.sin(h) * i,
        -s + Math.cos(u) * t,
        -o + Math.sin(u) * i,
      );
    }
  else (l(-s, o, s, o), l(s, o, s, -o));
  (ue(n, 0.012, 0.012, 1.9, -s + 0.12, 0, -o + 0.05, L("#c7ccd2", 0.2, 0.9)),
    ue(
      n,
      0.12,
      0.12,
      0.015,
      -s + 0.25,
      1.95,
      -o + 0.2,
      L("#c7ccd2", 0.2, 0.9),
    ));
}
export function kD(n, e) {
  const t = e.w / 1e3,
    i = e.d / 1e3,
    s = e.h / 1e3,
    o = t / 2,
    a = i / 2,
    r = e.color,
    l = Yt(e, "seat", 0) / 1e3,
    c = Math.max(0.3, i - l);
  (N(n, t, 0.1, c - 0.05, 0, 0, -a + c / 2 - 0.02, L(we(r, -0.25), 0.7)),
    N(n, t, s - 0.14, c, 0, 0.1, -a + c / 2, L(r, 0.45)),
    N(n, t + 0.02, 0.04, i + 0.02, 0, s - 0.04, 0, L("#e9e6e1", 0.3)));
  const f = Math.max(2, Math.round(t / 0.6));
  for (let u = 1; u < f; u++)
    N(n, 0.005, s - 0.26, 0.005, -o + (t * u) / f, 0.12, -a, "#b9b4ab", !1);
  if (Yt(e, "sink", !0)) {
    const u = Math.min(0.6, t * 0.3),
      h = -o + t * 0.14 + u / 2;
    (N(
      n,
      u,
      0.006,
      Math.max(0.2, c - 0.18),
      h,
      s,
      -a + c / 2,
      L("#aab1b8", 0.25, 0.8),
      !1,
    ),
      ue(n, 0.015, 0.015, 0.3, h, s, -a + 0.08, L("#c7ccd2", 0.2, 0.9)));
  }
  if (Yt(e, "hob", !1)) {
    const u = o - Math.min(t * 0.25, 0.45);
    N(
      n,
      0.6,
      0.008,
      Math.max(0.2, c - 0.16),
      u,
      s,
      -a + c / 2,
      L("#0f1012", 0.1, 0.2),
      !1,
    );
  }
  if (l > 0)
    for (const u of [-1, 1])
      N(n, 0.04, s - 0.04, l, u * (o - 0.02), 0, a - l / 2, L("#e9e6e1", 0.3));
}
export const Ui = (n = 0) => ({
  x: n,
  v: 0,
});
export function Zo(n, e, t, i = 7) {
  if (n.x === e && n.v === 0) return !1;
  let s = Math.min(t, 0.25);
  for (; s > 1e-6;) {
    const o = Math.min(s, 0.016666666666666666);
    ((s -= o),
      (n.v += (i * i * (e - n.x) - 2 * i * n.v) * o),
      (n.x += n.v * o));
  }
  return (
    Math.abs(e - n.x) < 5e-4 && Math.abs(n.v) < 0.005 && ((n.x = e), (n.v = 0)),
    !0
  );
}
export const zt = (n, e = 0) => L(we(n.wood, e), 0.6);
export const Mn = (n) => L(n.metal, 0.32, 0.85);
export function xr(n, e, t, i, s, o = 0.05, a = 0, r = 0) {
  const l = t / 2 - o,
    c = i / 2 - o,
    f = (u) => {
      for (const h of [-1, 1])
        for (const p of [-1, 1]) u(a + h * l, r + p * c, h, p);
    };
  switch (e.legs) {
    case "metal":
      f((u, h) => ue(n, 0.011, 0.011, s, u, 0, h, Mn(e), 10));
      break;
    case "gold":
      f((u, h) => {
        (ue(n, 0.01, 0.014, s, u, 0, h, Mn(e), 10),
          ue(n, 0.02, 0.02, 0.01, u, 0, h, Mn(e), 12));
      });
      break;
    case "taper":
      f((u, h, p, d) => {
        ue(
          n,
          0.022,
          0.012,
          s,
          u - p * 0.015,
          0,
          h - d * 0.015,
          zt(e),
          10,
        ).rotation.set(d * -0.09, 0, p * 0.09);
      });
      break;
    case "block":
      f((u, h) => N(n, 0.05, s, 0.05, u, 0, h, zt(e)));
      break;
    case "frame":
      f((u, h) => N(n, 0.045, s, 0.045, u, 0, h, zt(e)));
      for (const u of [-1, 1])
        N(n, t - o * 2, 0.04, 0.025, a, s - 0.06, r + u * c, zt(e, -0.05));
      for (const u of [-1, 1])
        N(n, 0.025, 0.04, i - o * 2, a + u * l, s - 0.06, r, zt(e, -0.05));
      for (const u of [-1, 1])
        N(n, t - o * 2, 0.02, 0.02, a, s * 0.22, r + u * c, zt(e, -0.08));
      break;
    case "turned":
      f((u, h) => {
        (ue(n, 0.018, 0.026, s * 0.45, u, 0, h, zt(e), 12),
          ue(n, 0.03, 0.03, s * 0.12, u, s * 0.45, h, zt(e), 12),
          ue(n, 0.026, 0.02, s * 0.43, u, s * 0.57, h, zt(e), 12));
      });
      break;
    case "sled":
      for (const u of [-1, 1]) {
        const h = a + u * l;
        (N(n, 0.03, s, 0.03, h, 0, r - c, Mn(e)),
          N(n, 0.03, s, 0.03, h, 0, r + c, Mn(e)),
          N(n, 0.03, 0.03, i - o * 2, h, 0, r, Mn(e)));
      }
      break;
    case "plinth":
      N(n, t - o * 2.4, s, i - o * 2.4, a, 0, r, L(we(e.fabric, -0.12), 0.9));
      break;
    case "skirt":
      N(n, t - 0.01, s, i - 0.01, a, 0, r, L(we(e.fabric, -0.05), 1));
      break;
  }
}
export function RD(n, e, t) {
  var f;
  const i = e.w / 1e3,
    s = e.d / 1e3,
    o = e.h / 1e3,
    a = i / 2,
    r = s / 2,
    l = e.color,
    c = (u) => 0.012 + 0.07 * t.round * u;
  switch (e.type) {
    case "sofa":
    case "armchair": {
      const u = L(we(l, -0.06), 0.95),
        h = L(l, 0.95),
        p = t.legs === "plinth" ? 0.06 : t.legs === "skirt" ? 0.1 : 0.12,
        d = String(((f = e.opt) == null ? void 0 : f.arms) ?? "both"),
        y =
          t.arm === "slim"
            ? 0.08
            : t.arm === "block"
              ? Math.min(0.24, i * 0.16)
              : t.arm === "round"
                ? Math.min(0.26, i * 0.17)
                : t.arm === "roll"
                  ? Math.min(0.2, i * 0.14)
                  : Math.min(0.16, i * 0.13),
        m = d === "both" || d === "left" ? y : 0,
        g = d === "both" || d === "right" ? y : 0;
      xr(n, t, i, s, p, 0.07);
      const v = p,
        w = 0.3 - (p - 0.1);
      if (t.arm === "wood") {
        (N(n, i, 0.08, s, 0, v, 0, zt(t)),
          N(n, i, o - v - 0.08, 0.05, 0, v + 0.08, -r + 0.025, zt(t, -0.04)));
        for (const [T, k] of [
          [m, -1],
          [g, 1],
        ])
          T &&
            (N(n, 0.05, 0.58 - v, s, k * (a - 0.025), v, 0, zt(t)),
            N(n, 0.1, 0.03, s, k * (a - 0.05), 0.58, 0, zt(t, 0.04)));
        if (t.head === "lattice")
          for (let T = -a + 0.15; T < a - 0.1; T += 0.16)
            N(
              n,
              0.012,
              o - v - 0.2,
              0.012,
              T,
              v + 0.12,
              -r + 0.055,
              zt(t, -0.1),
            );
      } else {
        (ft(n, i, w, s, 0, v, 0, u, c(0.6)),
          ft(n, i, o - v, 0.2, 0, v, -r + 0.1, u, c(0.8)));
        const T = t.arm === "slim" ? 0.62 - v : 0.64 - v;
        for (const [k, S] of [
          [m, -1],
          [g, 1],
        ])
          if (k) {
            const E = S * (a - k / 2);
            if (t.arm === "roll") {
              ft(n, k, T - 0.08, s, E, v, 0, u, c(0.6));
              const _ = ue(
                n,
                0.07,
                0.07,
                s,
                E + S * 0.01,
                v + T - 0.1,
                0,
                u,
                20,
              );
              ((_.rotation.x = Math.PI / 2), (_.position.y = v + T - 0.05));
            } else
              ft(
                n,
                k,
                T,
                s,
                E,
                v,
                0,
                u,
                t.arm === "round" ? Math.min(k / 2.1, 0.1) : c(0.5),
              );
          }
        t.legs === "gold" &&
          N(n, i - 0.02, 0.012, 0.012, 0, v + 0.01, r - 0.005, Mn(t));
      }
      const x = v + (t.arm === "wood" ? 0.08 : w),
        b = e.type !== "sofa" ? 1 : Math.max(1, Math.round((i - m - g) / 0.72)),
        M = (i - m - g) / b;
      for (let T = 0; T < b; T++) {
        const k = -a + m + M * (T + 0.5);
        ft(
          n,
          M - 0.015,
          0.14 + t.round * 0.03,
          s - 0.26,
          k,
          x,
          0.1,
          h,
          c(0.7),
          {
            puff: [0.006, 0.012 + t.round * 0.02, 0.006],
          },
        );
        const S = ft(
          n,
          M - 0.025,
          Math.max(0.24, o - x - 0.12),
          0.16 + t.round * 0.04,
          k,
          x + 0.1,
          -r + 0.27,
          h,
          c(1),
          {
            puff: [0.006, 0.006, 0.02 + t.round * 0.02],
          },
        );
        S.rotation.x = -0.12;
      }
      if (e.type === "sofa" && i > 1.3)
        for (const T of [-1, 1])
          ft(
            n,
            0.42,
            0.4,
            0.1,
            T * (a - (T < 0 ? m : g) - 0.3),
            x + 0.1,
            -r + 0.42,
            L(t.fabric2, 0.95),
            0.04,
            {
              puff: [0.01, 0.01, 0.035],
            },
          ).rotation.set(-0.3, T * 0.25, T * 0.12);
      return !0;
    }
    case "bed": {
      const u = L("#f7f5f1", 0.95),
        h = L(we(l, -0.2), 0.9),
        p = t.legs === "plinth" || t.head === "low" ? 0.05 : 0.16,
        d = t.head === "low" ? 0.2 : 0.26;
      t.head === "low" ||
      t.legs === "block" ||
      t.legs === "frame" ||
      t.legs === "turned"
        ? (N(n, i, d, s - 0.05, 0, p, 0.025, zt(t)),
          xr(n, t, i, s - 0.05, p, 0.06, 0, 0.025))
        : (ft(n, i, d, s - 0.06, 0, p, 0.03, L(we(l, 0.05), 0.9), c(0.5)),
          xr(n, t, i, s - 0.06, p, 0.08, 0, 0.03));
      const y = p + d;
      ft(n, i - 0.08, 0.22, s - 0.18, 0, y - 0.06, 0.06, u, 0.05, {
        puff: [0, 0.01, 0],
      });
      const m =
          t.head === "low"
            ? 0.55
            : t.head === "tufted" || t.head === "roll" || t.head === "wing"
              ? Math.max(1.15, o)
              : Math.max(0.95, o),
        g = -r + 0.04;
      switch (t.head) {
        case "panel":
          ft(n, i + 0.02, m - p, 0.08, 0, p, g, h, c(0.4));
          break;
        case "slat":
          N(n, i + 0.04, 0.05, 0.05, 0, m - 0.05, g, zt(t));
          for (const b of [-1, 1])
            N(n, 0.05, m, 0.05, b * (a + 0), 0, g, zt(t));
          for (let b = -a + 0.1; b < a - 0.05; b += 0.09)
            N(n, 0.035, m - y - 0.1, 0.02, b, y, g, zt(t, 0.05));
          break;
        case "lattice":
          (N(n, i + 0.08, m, 0.05, 0, 0, g, zt(t)),
            N(
              n,
              i - 0.1,
              m - y - 0.15,
              0.02,
              0,
              y + 0.05,
              g + 0.03,
              L(we(t.fabric, 0.1), 0.9),
            ));
          for (let b = -a + 0.1; b < a - 0.05; b += 0.15)
            N(
              n,
              0.015,
              m - y - 0.15,
              0.015,
              b,
              y + 0.05,
              g + 0.045,
              zt(t, -0.1),
            );
          for (let b = y + 0.1; b < m - 0.1; b += 0.15)
            N(n, i - 0.1, 0.015, 0.015, 0, b, g + 0.045, zt(t, -0.1));
          break;
        case "tufted": {
          ft(n, i + 0.1, m - p, 0.12, 0, p, g, h, c(0.5));
          for (let b = y + 0.2; b < m - 0.1; b += 0.18)
            for (let M = -a + 0.12; M < a - 0.05; M += 0.2) {
              const T = ue(
                n,
                0.012,
                0.012,
                0.02,
                M + (Math.round(b * 10) % 2) * 0.1,
                b,
                g + 0.065,
                L(we(l, -0.35), 0.6),
                8,
              );
              T.rotation.x = Math.PI / 2;
            }
          N(n, i + 0.12, 0.015, 0.13, 0, m - 0.015, g, Mn(t));
          break;
        }
        case "low":
          (N(n, i + 0.2, m, 0.06, 0, 0, g, zt(t)),
            ft(n, i - 0.1, 0.3, 0.06, 0, y + 0.02, g + 0.05, h, 0.03));
          break;
        case "roll": {
          ft(n, i + 0.04, m - p - 0.08, 0.1, 0, p, g, h, c(0.5));
          const b = ue(n, 0.08, 0.08, i + 0.04, 0, m - 0.1, g, h, 20);
          ((b.rotation.z = Math.PI / 2), (b.position.y = m - 0.08));
          for (const M of [-1, 1])
            ue(n, 0.03, 0.035, m + 0.05, M * (a + 0.03), 0, g, zt(t), 12);
          break;
        }
        case "metal":
          for (const b of [-1, 1])
            ue(n, 0.015, 0.015, m, b * a, 0, g, Mn(t), 10);
          {
            const b = ue(n, 0.015, 0.015, i, 0, m, g, Mn(t), 10);
            ((b.rotation.z = Math.PI / 2), (b.position.y = m));
          }
          for (let b = -a + 0.15; b < a; b += 0.15)
            ue(n, 0.008, 0.008, m - y, b, y, g, Mn(t), 8);
          break;
        case "round":
          ft(
            n,
            i + 0.12,
            m - p,
            0.2,
            0,
            p,
            g + 0.04,
            h,
            Math.min(0.15, (i + 0.12) / 4),
            {
              puff: [0.02, 0.03, 0.04],
            },
          );
          break;
        case "wing":
          ft(n, i + 0.5, m - p, 0.14, 0, p, g, h, c(0.7), {
            puff: [0.01, 0.01, 0.03],
          });
          break;
      }
      const v = i > 1.3 ? 2 : 1,
        w = (i - 0.2 - (v - 1) * 0.06) / v;
      for (let b = 0; b < v; b++) {
        const M = ft(
          n,
          w,
          0.13,
          0.42,
          -a + 0.1 + w / 2 + b * (w + 0.06),
          y + 0.16,
          -r + 0.36,
          L("#ffffff", 0.95),
          0.05,
          {
            puff: [0.01, 0.035, 0.02],
          },
        );
        M.rotation.x = -0.18;
      }
      const x = s * 0.66;
      return (
        ft(
          n,
          i + 0.02,
          0.08,
          x,
          0,
          y + 0.14,
          r - x / 2 - 0.02,
          L("#fbfaf7", 0.95),
          0.035,
          {
            puff: [0, 0.012, 0],
            wrinkle: 0.007,
          },
        ),
        ft(
          n,
          i + 0.06,
          0.03,
          s * 0.22,
          0,
          y + 0.215,
          r - s * 0.14,
          L(t.fabric2, 0.95),
          0.012,
        ),
        !0
      );
    }
    case "chair": {
      const u = L(l, 0.85),
        h = 0.44;
      if (t.legs === "plinth") {
        const d = ue(n, a, a * 0.9, h, 0, 0, 0, L(we(l, -0.05), 0.9), 32);
        return (
          (d.scale.z = s / i),
          ft(n, i - 0.02, 0.08, s - 0.04, 0, h - 0.02, 0.01, u, 0.035, {
            puff: [0, 0.012, 0],
          }),
          ft(
            n,
            i,
            o - h,
            0.1,
            0,
            h - 0.05,
            -r + 0.05,
            L(we(l, -0.05), 0.9),
            0.05,
          ),
          !0
        );
      }
      (xr(n, t, i, s, h - 0.04, 0.04),
        (t.legs === "frame" ||
          t.legs === "block" ||
          t.legs === "taper" ||
          t.legs === "turned") &&
          N(n, i, 0.04, s, 0, h - 0.04, 0, zt(t)),
        ft(n, i - 0.02, 0.06, s - 0.05, 0, h, 0.02, u, 0.02, {
          puff: [0, 0.008, 0],
        }));
      const p = o - h;
      switch (t.head) {
        case "slat":
          for (const d of [-1, 1])
            N(n, 0.03, p, 0.03, d * (a - 0.04), h, -r + 0.04, zt(t));
          {
            const d = N(n, i - 0.02, 0.06, 0.03, 0, o - 0.07, -r + 0.05, zt(t));
            d.rotation.x = -0.1;
          }
          break;
        case "lattice":
          for (const d of [-1, 1])
            N(n, 0.035, p, 0.035, d * (a - 0.04), h, -r + 0.04, zt(t));
          (N(n, i * 0.3, p - 0.1, 0.02, 0, h + 0.05, -r + 0.04, zt(t, 0.05)),
            N(n, i + 0.04, 0.04, 0.04, 0, o - 0.04, -r + 0.04, zt(t)));
          break;
        case "metal":
          for (const d of [-1, 1])
            N(n, 0.02, p, 0.02, d * (a - 0.03), h, -r + 0.03, Mn(t));
          N(n, i - 0.04, p * 0.45, 0.02, 0, o - p * 0.45, -r + 0.03, zt(t));
          break;
        case "low":
          N(n, i - 0.04, p * 0.5, 0.03, 0, h + p * 0.4, -r + 0.04, zt(t));
          for (const d of [-1, 1])
            N(n, 0.03, p, 0.03, d * (a - 0.04), h, -r + 0.04, zt(t));
          break;
        default: {
          const d = ft(n, i - 0.01, p, 0.06, 0, h + 0.02, -r + 0.04, u, c(0.4));
          ((d.rotation.x = -0.08),
            t.legs === "gold" &&
              N(n, i, 0.01, 0.07, 0, o - 0.01, -r + 0.04, Mn(t)));
        }
      }
      return !0;
    }
    case "diningTable":
    case "coffeeTable":
    case "desk": {
      const u =
          t.legs === "gold" ||
          t.legs === "metal" ||
          t.legs === "sled" ||
          t.legs === "plinth",
        h = e.type === "coffeeTable" ? 0.04 : 0.045,
        p = u ? L(t.stone, 0.25) : zt(t, 0.03);
      if (t.legs === "plinth") {
        const d = N(
          n,
          i * 0.55,
          o - h,
          s * 0.5,
          0,
          0,
          0,
          L(we(t.stone, -0.05), 0.7),
        );
        d.castShadow = !0;
      } else if (t.legs === "sled" || (t.legs === "gold" && e.type !== "desk"))
        for (const d of [-1, 1]) {
          const y = d * (a - 0.12);
          (N(n, 0.035, o - h, 0.035, y, 0, -r + 0.1, Mn(t)),
            N(n, 0.035, o - h, 0.035, y, 0, r - 0.1, Mn(t)),
            N(n, 0.035, 0.035, s - 0.2, y, 0, 0, Mn(t)),
            N(n, 0.035, 0.035, s - 0.2, y, o - h - 0.035, 0, Mn(t)));
        }
      else xr(n, t, i, s, o - h, e.type === "coffeeTable" ? 0.06 : 0.08);
      return (
        N(n, i, h, s, 0, o - h, 0, p),
        e.type === "coffeeTable" &&
          t.legs !== "plinth" &&
          N(n, i - 0.12, 0.02, s - 0.12, 0, 0.09, 0, zt(t, -0.04)),
        e.type === "desk" &&
          (N(
            n,
            Math.min(0.56, i * 0.5),
            0.33,
            0.02,
            0,
            o + 0.12,
            -r + 0.12,
            L("#15171a", 0.3),
          ),
          N(n, 0.06, 0.12, 0.02, 0, o, -r + 0.12, "#2a2c30")),
        !0
      );
    }
    case "wardrobe": {
      const u =
          t.head === "lattice" || t.head === "low" || t.head === "slat"
            ? zt(t, 0.04)
            : L(l, 0.55),
        h = Math.max(2, Math.round(i / 0.5)),
        p = i / h,
        d = t.legs === "turned" || t.legs === "taper" ? 0.12 : 0.08;
      (d > 0.1
        ? xr(n, t, i, s, d, 0.05)
        : N(n, i - 0.04, d, s - 0.06, 0, 0, -0.03, L(we(l, -0.35), 0.7)),
        N(n, i, o - d, s - 0.025, 0, d, -0.0125, u));
      for (let y = 0; y < h; y++) {
        const m = -a + p * (y + 0.5);
        if (
          (N(n, p - 0.004, o - d - 0.01, 0.022, m, d + 0.005, r - 0.011, u),
          t.head === "lattice")
        )
          for (let v = d + 0.3; v < o - 0.2; v += 0.25)
            N(n, p - 0.1, 0.012, 0.01, m, v, r + 0.002, zt(t, -0.12));
        (t.head === "roll" || t.head === "tufted") &&
          N(
            n,
            p - 0.1,
            o - d - 0.2,
            0.008,
            m,
            d + 0.1,
            r + 0.001,
            L(we(l, -0.06), 0.6),
          );
        const g = -a + p * (y + (y % 2 ? 0.1 : 0.9));
        N(
          n,
          0.012,
          t.legs === "gold" ? 0.5 : 0.3,
          0.02,
          g,
          o * 0.45,
          r + 0.01,
          Mn(t),
          !1,
        );
      }
      return (
        (t.head === "roll" || t.head === "tufted") &&
          N(n, i + 0.04, 0.06, s + 0.02, 0, o - 0.06, 0, u),
        !0
      );
    }
  }
  return !1;
}
export const A7 = new Map();
export function PD(n) {
  const e = ja[String(g0(n, "mat", "paint"))] || ja.paint,
    t = Number(g0(n, "op", e.op ?? 1)),
    i = [n.color, String(g0(n, "mat", "paint")), t].join("|");
  let s = A7.get(i);
  return (
    s ||
      ((s = new Jt({
        color: n.color,
        roughness: e.rough,
        metalness: e.metal,
        transparent: t < 1,
        opacity: t,
        depthWrite: t >= 1,
        side: t < 1 ? e0 : Hi,
        ...(e.emissive
          ? {
              emissive: n.color,
              emissiveIntensity: 1.2,
            }
          : {}),
      })),
      A7.set(i, s)),
    s
  );
}
export const dn = (n, e, t, i = 0) => {
  const s = new Me(e, t);
  return (
    (s.position.y = i),
    (s.castShadow = s.receiveShadow = !0),
    n.add(s),
    s
  );
};
export function M9(n, e, t = 0, i = []) {
  const s = new Is();
  (n.forEach(([r, l], c) =>
    c ? s.lineTo(r / 1e3, -l / 1e3) : s.moveTo(r / 1e3, -l / 1e3),
  ),
    s.closePath());
  for (const r of i) {
    const l = new _u();
    (r.forEach(([c, f], u) =>
      u ? l.lineTo(c / 1e3, -f / 1e3) : l.moveTo(c / 1e3, -f / 1e3),
    ),
      l.closePath(),
      s.holes.push(l));
  }
  const o = Math.min(t, e / 2 - 0.001),
    a = new to(s, {
      depth: Math.max(0.001, e - o * 2),
      bevelEnabled: o > 0.001,
      bevelThickness: o,
      bevelSize: o,
      bevelSegments: 3,
      curveSegments: 32,
    });
  return (a.rotateX(-Math.PI / 2), a.translate(0, o, 0), a);
}
export function CD(n, e) {
  var p;
  const t = e.w / 1e3,
    i = e.d / 1e3,
    s = e.h / 1e3,
    o = Qc(e),
    a = PD(e),
    r = Number(g0(e, "r", 0)) / 1e3,
    l = Number(g0(e, "t", 120)) / 1e3,
    c = Math.max(1, Math.round(Number(g0(e, "n", 0)))),
    f = new ht();
  switch ((n.add(f), o)) {
    case "roundBox":
    case "box": {
      const d = o === "roundBox" ? Math.max(r, Math.min(t, s, i) * 0.18) : r;
      dn(
        f,
        d > 0.002
          ? new Nv(t, s, i, 3, Math.min(d, Math.min(t, s, i) / 2 - 0.001))
          : new ot(t, s, i),
        a,
        s / 2,
      );
      break;
    }
    case "cyl": {
      const d = dn(f, new Hn(t / 2, t / 2, s, 48), a, s / 2);
      d.scale.z = i / t;
      break;
    }
    case "tube": {
      const d = Cu(e),
        y = d.map(([m, g]) => [
          m * Math.max(0.05, 1 - (2 * l * 1e3) / e.w),
          g * Math.max(0.05, 1 - (2 * l * 1e3) / e.d),
        ]);
      dn(f, M9(d, s, 0, [y.slice().reverse()]), a);
      break;
    }
    case "halfCyl": {
      const d = dn(
        f,
        new Hn(t / 2, t / 2, s, 40, 1, !1, Math.PI / 2, Math.PI),
        a,
        s / 2,
      );
      ((d.scale.z = i / (t / 2)), (d.position.z = i / 2));
      const y = dn(f, new mo(t, s), a, s / 2);
      y.position.z = i / 2;
      break;
    }
    case "sphere": {
      dn(f, new ds(0.5, 40, 28), a, s / 2).scale.set(t, s, i);
      break;
    }
    case "hemi": {
      (dn(f, new ds(0.5, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), a).scale.set(
        t,
        s * 2,
        i,
      ),
        dn(f, new rp(0.5, 40).rotateX(Math.PI / 2), a).scale.set(t, 1, i));
      break;
    }
    case "cone": {
      const d = dn(f, new Cc(t / 2, s, 48), a, s / 2);
      d.scale.z = i / t;
      break;
    }
    case "pyramid": {
      const d = dn(f, new Cc(Math.SQRT1_2, s, 4, 1), a, s / 2);
      ((d.rotation.y = Math.PI / 4), d.scale.set(t, 1, i));
      break;
    }
    case "wedge": {
      const d = new Bt(),
        y = t / 2,
        m = i / 2,
        g = [-y, 0, -m, y, 0, -m, y, 0, m, -y, 0, m, -y, s, -m, y, s, -m],
        v = [
          0, 2, 1, 0, 3, 2, 0, 1, 5, 0, 5, 4, 3, 4, 5, 3, 5, 2, 0, 4, 3, 1, 2,
          5,
        ];
      (d.setAttribute("position", new vt(g, 3)), d.setIndex(v));
      const w = d.toNonIndexed();
      (w.computeVertexNormals(), dn(f, w, a));
      break;
    }
    case "arch": {
      const d = e.w,
        y = Math.max(200, e.h - l * 1e3),
        m = Math.max(100, d - 2 * l * 1e3),
        g = m / 2,
        v = Math.max(0, y - g),
        w = [
          [-d / 2, 0],
          [d / 2, 0],
          [d / 2, -e.h],
          [-d / 2, -e.h],
        ],
        x = [
          [-m / 2, 0],
          [-m / 2, -v],
        ];
      for (let k = 0; k <= 24; k++) {
        const S = Math.PI - (Math.PI * k) / 24;
        x.push([Math.cos(S) * g, -v - Math.sin(S) * g]);
      }
      x.push([m / 2, 0]);
      const b = new Is();
      w.forEach(([k, S], E) =>
        E ? b.lineTo(k / 1e3, -S / 1e3) : b.moveTo(k / 1e3, -S / 1e3),
      );
      const M = new _u();
      (x.forEach(([k, S], E) =>
        E ? M.lineTo(k / 1e3, -S / 1e3) : M.moveTo(k / 1e3, -S / 1e3),
      ),
        b.holes.push(M));
      const T = new to(b, {
        depth: i,
        bevelEnabled: !1,
        curveSegments: 32,
      });
      (T.translate(0, 0, -i / 2), dn(f, T, a));
      break;
    }
    case "arcWall":
      dn(f, M9(Cu(e), s), a);
      break;
    case "slats": {
      const d = c > 1 ? c : Math.max(2, Math.round(e.w / 120)),
        y = Math.max(
          0.01,
          Math.min((t / d) * 0.55, Number(g0(e, "sw", 40)) / 1e3),
        );
      for (let m = 0; m < d; m++)
        dn(f, new ot(y, s, i), a, s / 2).position.x =
          -t / 2 + y / 2 + (t - y) * (d === 1 ? 0.5 : m / (d - 1));
      if (g0(e, "rail", !0))
        for (const m of [0.02, s - 0.02])
          dn(f, new ot(t, 0.04, i * 0.5), a, m).position.z = -i * 0.25;
      break;
    }
    case "steps": {
      const d = c > 1 ? c : Math.max(1, Math.round(e.h / 160));
      for (let y = 0; y < d; y++) {
        const m = (i * (d - y)) / d,
          g = (s * (y + 1)) / d;
        dn(f, new ot(t, s / d, m), a, g - s / d / 2).position.z =
          -i / 2 + m / 2;
      }
      break;
    }
    case "torus": {
      const d = Math.max(0.005, Math.min(l, t / 4)),
        y = dn(f, new Zs(t / 2 - d, d, 20, 64), a, s / 2);
      ((y.rotation.x = Math.PI / 2), y.scale.set(1, i / t, s / (2 * d)));
      break;
    }
    case "lathe": {
      const d = F5[String(g0(e, "preset", "vase"))],
        y = rv(String(g0(e, "profile", ""))),
        m = y.length >= 3 ? y : (d == null ? void 0 : d.p) || F5.vase.p,
        g = dn(
          f,
          new of(
            m.map(([v, w]) => new pe(Math.max(0, v) * 0.5, w)),
            48,
          ),
          a,
        );
      (g.scale.set(t, s, i), (g.material.side = e0));
      break;
    }
    case "extrude":
    default:
      dn(f, M9(xp(e), s, r), a);
      break;
  }
  const u = Number(g0(e, "rx", 0)),
    h = Number(g0(e, "ry", 0));
  if (
    ((u || h) && f.rotation.set((-u * Math.PI) / 180, 0, (-h * Math.PI) / 180),
    a.emissive && (p = ja[String(g0(e, "mat", "paint"))]) != null && p.emissive)
  ) {
    const d = new uo(16773336, 0.8, 3, 2);
    (d.position.set(0, s / 2, 0), n.add(d));
  }
}
export const S9 = new Map();
export function L(n, e = 0.75, t = 0, i) {
  const s = n + "|" + e + "|" + t + "|" + (i ? JSON.stringify(i) : "");
  return (
    S9.has(s) ||
      S9.set(
        s,
        new Jt({
          color: n,
          roughness: e,
          metalness: t,
          ...(i || {}),
        }),
      ),
    S9.get(s)
  );
}
export const j0 = new Map();
export const Cp = new Map();
export const el = (n) => Cp.get(n) ?? (j0.get(n) ? 1 : 0);
export function Gd(n) {
  const e = Math.max(0, Math.min(1, n.s.x));
  if (n.kind === "lamp")
    (n.mats.forEach((t) => (t.emissiveIntensity = 0.05 + 1.55 * e)),
      n.lights.forEach((t) => (t.intensity = 2.6 * e)));
  else if (n.kind === "tv") n.mat.emissiveIntensity = 0.9 * e;
  else {
    const t = n.bw + (n.hw - n.bw) * e;
    for (const i of n.halves) {
      const s = i.pleats.length,
        o = t / s,
        a = Math.acos(Math.min(1, o / n.L0));
      i.pleats.forEach((r, l) => {
        ((r.position.x = i.edge + i.dir * o * (l + 0.5)),
          (r.rotation.y = (l % 2 ? 1 : -1) * a));
      });
    }
  }
}
export function T9(n, e, t, i) {
  const s = new uo(16765594, e ? 2.6 : 0, i, 1.8);
  return (s.position.set(0, t, 0), (s.userData.lamp = !0), n.add(s), s);
}
export function _9(n, e, t, i) {
  const s = e.material.clone();
  ((e.material = s), (e.userData.noTheme = !0));
  const o = {
    kind: "lamp",
    mats: [s],
    lights: [t],
    s: Ui(i ? 1 : 0),
  };
  ((n.userData.anim = o), Gd(o));
}
export let r2 = null;
export function E7(n) {
  if (!r2) {
    const e = document.createElement("canvas");
    ((e.width = 256), (e.height = 144));
    const t = e.getContext("2d");
    let i = t.createLinearGradient(0, 0, 0, 90);
    (i.addColorStop(0, "#2f6fb3"),
      i.addColorStop(0.7, "#f2b27a"),
      i.addColorStop(1, "#f7d29a"),
      (t.fillStyle = i),
      t.fillRect(0, 0, 256, 90),
      (t.fillStyle = "#ffe9b8"),
      t.beginPath(),
      t.arc(176, 78, 12, 0, 7),
      t.fill(),
      (t.fillStyle = "#3d4f6b"),
      t.beginPath(),
      t.moveTo(0, 90),
      [
        [30, 62],
        [70, 80],
        [110, 55],
        [150, 84],
        [200, 66],
        [256, 86],
      ].forEach(([s, o]) => t.lineTo(s, o)),
      t.lineTo(256, 90),
      t.fill(),
      (i = t.createLinearGradient(0, 90, 0, 144)),
      i.addColorStop(0, "#c99a72"),
      i.addColorStop(1, "#1f3550"),
      (t.fillStyle = i),
      t.fillRect(0, 90, 256, 54),
      (r2 = new gs(e)),
      (r2.colorSpace = Et));
  }
  return new Jt({
    color: "#0e1219",
    emissive: "#ffffff",
    emissiveMap: r2,
    emissiveIntensity: n ? 0.9 : 0,
    roughness: 0.2,
  });
}
export function k7(n, e, t) {
  const i = {
    kind: "tv",
    mat: e.material,
    s: Ui(t ? 1 : 0),
  };
  n.userData.anim = i;
}
export const Es = () =>
  L("#bcd8ea", 0.05, 0.1, {
    transparent: !0,
    opacity: 0.28,
    depthWrite: !1,
  });
export const Nc = (n) => (typeof n == "string" ? L(n) : n);
export const Ba = {
  on: !1,
  max: 0.03,
  k: 0.3,
};
export const R7 = new Map();
export function DD(n, e, t) {
  ((n = Math.max(n, 0.001)),
    (e = Math.max(e, 0.001)),
    (t = Math.max(t, 0.001)));
  const i = Math.min(Ba.max, Math.min(n, e, t) * Ba.k);
  if (!Ba.on || i < 0.004) return new ot(n, e, t);
  const s = [n, e, t, i].map((a) => a.toFixed(3)).join(",");
  let o = R7.get(s);
  return (
    o || ((o = new Nv(n, e, t, 2, i)), (o.userData.shared = !0), R7.set(s, o)),
    o
  );
}
export const P7 = new Map();
export function LD(n, e, t, i, s) {
  const o = [n, e, t, i, ...(s.puff || [0, 0, 0]), s.wrinkle || 0]
    .map((w) => w.toFixed(3))
    .join(",");
  let a = P7.get(o);
  if (a) return a;
  const r = (w) => Math.max(3, Math.min(20, Math.ceil(w / 0.05)));
  let l = new ot(n, e, t, r(n), r(e), r(t));
  (l.deleteAttribute("uv"), l.deleteAttribute("normal"), (l = YP(l, 1e-5)));
  const c = l.getAttribute("position"),
    f = n / 2,
    u = e / 2,
    h = t / 2,
    [p, d, y] = s.puff || [0, 0, 0],
    m = s.wrinkle || 0,
    g = new H(),
    v = new H();
  for (let w = 0; w < c.count; w++) {
    (g.fromBufferAttribute(c, w),
      v.set(
        pc.clamp(g.x, -f + i, f - i),
        pc.clamp(g.y, -u + i, u - i),
        pc.clamp(g.z, -h + i, h - i),
      ));
    const x = g.clone().sub(v),
      b = x.length();
    b > 1e-6 && g.copy(v).addScaledVector(x, i / b);
    const M = g.x / f,
      T = g.y / u,
      k = g.z / h,
      S = (E, _) => Math.max(0, 1 - E * E) * Math.max(0, 1 - _ * _);
    ((g.x += Math.sign(g.x) * p * S(T, k) * Math.abs(M)),
      (g.y += Math.sign(g.y) * d * S(M, k) * Math.abs(T)),
      (g.z += Math.sign(g.z) * y * S(M, T) * Math.abs(k)),
      m &&
        T > 0.2 &&
        (g.y +=
          m *
          (Math.sin(g.x * 11 + Math.sin(g.z * 5) * 2) * 0.6 +
            Math.sin(g.z * 13 + g.x * 3) * 0.4) *
          S(M * 0.95, k * 0.95) *
          T),
      c.setXYZ(w, g.x, g.y, g.z));
  }
  return (l.computeVertexNormals(), (l.userData.shared = !0), P7.set(o, l), l);
}
export function ft(n, e, t, i, s, o, a, r, l = 0.05, c = {}) {
  var u;
  ((e = Math.max(e, 0.01)),
    (t = Math.max(t, 0.01)),
    (i = Math.max(i, 0.01)),
    (l = Math.min(l, e / 2 - 0.001, t / 2 - 0.001, i / 2 - 0.001)));
  const f = new Me(LD(e, t, i, l, c), Nc(r));
  if (
    (f.position.set(s, o + t / 2, a),
    (f.castShadow = f.receiveShadow = !0),
    n.add(f),
    c.pipe)
  ) {
    const h = Math.max(0.01, l * 0.8),
      p = e / 2 - l * 0.35,
      d = i / 2 - l * 0.35,
      y =
        t / 2 - l * 0.35 + (((u = c.puff) == null ? void 0 : u[1]) || 0) * 0.15,
      m = [];
    for (const [v, w, x] of [
      [p - h, d - h, 0],
      [-p + h, d - h, Math.PI / 2],
      [-p + h, -d + h, Math.PI],
      [p - h, -d + h, Math.PI * 1.5],
    ])
      for (let b = 0; b <= 4; b++) {
        const M = x + ((b / 4) * Math.PI) / 2;
        m.push(new H(v + Math.cos(M) * h, y, w + Math.sin(M) * h));
      }
    const g = new Me(
      new cp(new Eb(m, !0), 64, 0.0045, 6, !0),
      Nc(L(c.pipe, 0.9)),
    );
    ((g.castShadow = !1), f.add(g));
  }
  return f;
}
export function C7(n, e, t, i, s, o, a = 32) {
  const r = new Me(
    new of(
      e.map(([l, c]) => new pe(l, c)),
      a,
    ),
    Nc(o),
  );
  return (
    r.position.set(t, i, s),
    (r.castShadow = r.receiveShadow = !0),
    n.add(r),
    r
  );
}
export function N(n, e, t, i, s, o, a, r, l = !0) {
  const c = new Me(DD(e, t, i), Nc(r));
  return (
    c.position.set(s, o + t / 2, a),
    (c.castShadow = l),
    (c.receiveShadow = !0),
    (c.userData.bx = 1),
    n.add(c),
    c
  );
}
export function ue(n, e, t, i, s, o, a, r, l = 28, c = !1) {
  const f = new Me(new Hn(e, t, i, l, 1, c), Nc(r));
  return (
    f.position.set(s, o + i / 2, a),
    (f.castShadow = !0),
    (f.receiveShadow = !0),
    n.add(f),
    f
  );
}
export function ha(n, e, t, i, s, o) {
  const a = new Me(new ds(e, 18, 14), Nc(o));
  return (a.position.set(t, i, s), (a.castShadow = !0), n.add(a), a);
}
export function Ov(n, e) {
  const t = new ht(),
    i = n.w / 1e3,
    s = n.d / 1e3,
    o = n.h / 1e3,
    a = n.color,
    r = i / 2,
    l = s / 2,
    c = WM(n),
    f = (u, h = 0.04, p = 0.02, d = "#3b3f46") => {
      if (c) {
        xr(t, c, i, s, u, h);
        return;
      }
      for (const y of [-1, 1])
        for (const m of [-1, 1])
          ue(t, p, p, u, y * (r - h), 0, m * (l - h), d, 10);
    };
  if (n.type === "free" || (c && RD(t, n, c)))
    return (
      n.type === "free" && CD(t, n),
      D7(t),
      t.traverse((u) => (u.userData.fid = n.id)),
      t
    );
  switch (n.type) {
    case "airVent": {
      (N(t, i, o, s, 0, 0, 0, a),
        N(t, i - 0.03, 0.008, s - 0.03, 0, -0.008, 0, "#5e6970"));
      for (let u = -r + 0.04; u < r; u += 0.05)
        N(t, 0.012, 0.012, s - 0.04, u, -0.018, 0, a);
      break;
    }
    case "curveTrainingTable": {
      const u = L4(n);
      if (
        u.length >= 3 &&
        u.every((h) => h.length === 2 && h.every(Number.isFinite))
      ) {
        const h = new Is();
        (u.forEach(([y, m], g) =>
          g ? h.lineTo(y / 1e3, -m / 1e3) : h.moveTo(y / 1e3, -m / 1e3),
        ),
          h.closePath());
        const p = new to(h, {
          depth: 0.035,
          bevelEnabled: !1,
        });
        p.rotateX(-Math.PI / 2);
        const d = new Me(p, L(a));
        ((d.position.y = o - 0.035),
          (d.castShadow = d.receiveShadow = !0),
          t.add(d));
        for (const y of [
          0,
          Math.floor(u.length / 3),
          Math.floor((u.length * 2) / 3),
        ]) {
          const [m, g] = u[y];
          N(
            t,
            0.04,
            o - 0.035,
            0.18,
            (m / 1e3) * 0.92,
            0,
            (g / 1e3) * 0.92,
            "#66717a",
          );
        }
      } else (N(t, i, 0.035, s, 0, o - 0.035, 0, a), f(o - 0.035));
      break;
    }
    case "trainingTable": {
      (N(t, i, 0.035, s, 0, o - 0.035, 0, a),
        f(o - 0.035, 0.07, 0.025),
        N(t, i - 0.16, 0.22, 0.025, 0, o - 0.33, -l + 0.08, "#88929b"));
      break;
    }
    case "stage": {
      N(t, i, o, Math.max(0.1, s - 0.4), 0, 0, -0.2, a);
      for (let u = 0; u < 2; u++)
        N(
          t,
          i,
          (o * (2 - u)) / 3,
          0.2,
          0,
          0,
          l - 0.3 + u * 0.2,
          we(a, -0.08 * u),
        );
      break;
    }
    case "lectern": {
      (N(t, i * 0.8, 0.06, s * 0.9, 0, 0, 0, "#343c45"),
        N(t, i * 0.6, o - 0.16, s * 0.6, 0, 0.06, 0, a));
      const u = N(t, i, 0.06, s, 0, o - 0.1, 0, a);
      ((u.rotation.x = -0.12),
        N(t, i * 0.48, 0.025, s * 0.4, 0, o - 0.04, -0.05, "#263441"));
      const h = ue(t, 0.009, 0.009, 0.28, i * 0.3, o, -s * 0.28, "#282d33", 8);
      h.rotation.z = -0.3;
      break;
    }
    case "slidingBoard": {
      N(t, i, o, s, 0, 0, 0, "#8e969d");
      for (let u = 0; u < 3; u++)
        N(
          t,
          i / 3 - 0.025,
          o * 0.72,
          0.035,
          -r + (i * (u + 0.5)) / 3,
          o * (0.17 + u * 0.04),
          l + 0.015,
          a,
        );
      N(t, i, 0.025, 0.12, 0, o * 0.15, l + 0.04, "#b8bfc3");
      break;
    }
    case "mobileDisplay": {
      for (const u of [-i * 0.3, i * 0.3]) {
        (N(t, 0.055, o * 0.7, 0.055, u, 0.08, 0, "#606b77"),
          N(t, 0.08, 0.05, s, u, 0.04, 0, "#4a5561"));
        for (const h of [-s * 0.4, s * 0.4])
          ue(t, 0.035, 0.035, 0.05, u, 0, h, "#242a31", 10);
      }
      (N(t, i, o * 0.52, 0.08, 0, o * 0.46, -0.05, "#222d39"),
        N(
          t,
          i - 0.07,
          o * 0.52 - 0.07,
          0.01,
          0,
          o * 0.46 + 0.035,
          0,
          L("#517fa3", 0.4, 0, {
            emissive: "#22425d",
            emissiveIntensity: 0.3,
          }),
        ));
      break;
    }
    case "printer": {
      (N(t, i, o * 0.75, s, 0, 0, 0, a),
        N(t, i * 0.94, o * 0.13, s * 0.9, 0, o * 0.75, 0, "#444e59"),
        N(t, i * 0.75, o * 0.12, s * 0.7, 0, o * 0.88, -s * 0.12, a));
      for (let u = 1; u <= 3; u++)
        N(t, i * 0.88, 0.012, 0.015, 0, o * u * 0.18, l + 0.005, "#6e7985");
      N(t, i * 0.3, 0.035, s * 0.23, i * 0.22, o * 0.8, l, "#29465c");
      break;
    }
    case "coffeeMachine": {
      (N(t, i, o, s, 0, 0, 0, a),
        N(t, i * 0.66, o * 0.5, 0.025, 0, o * 0.22, l, "#161e27"),
        N(t, i * 0.8, 0.035, s * 0.35, 0, o * 0.12, l, "#a5adb3"));
      for (const u of [-i * 0.16, i * 0.16])
        (ue(t, 0.025, 0.025, 0.06, u, o * 0.46, l + 0.03, "#bfc7ca", 12),
          ue(t, 0.055, 0.045, 0.08, u, o * 0.17, l + 0.04, "#f0eee7", 14));
      break;
    }
    case "urinal": {
      (N(t, i, o, 0.08, 0, 0, -l + 0.04, a),
        ue(t, i * 0.48, i * 0.35, o * 0.4, 0, 0, 0, a, 24),
        ue(t, i * 0.34, i * 0.25, 0.015, 0, o * 0.4, 0.015, "#b7cfd1", 24),
        ue(t, 0.018, 0.018, o * 0.36, 0, o * 0.58, -l + 0.07, "#a5adb2", 10));
      break;
    }
    case "serviceSink": {
      (N(t, i, o * 0.65, s, 0, 0, 0, a),
        N(t, i, o * 0.35, 0.07, 0, o * 0.65, -l + 0.035, a),
        N(t, i - 0.12, 0.025, s - 0.14, 0, o * 0.65, 0.02, "#b9d1d2"),
        ue(t, 0.018, 0.018, 0.2, 0, o * 0.8, -l + 0.09, "#aeb7bc", 12));
      break;
    }
    case "wifiAP":
    case "ceilingSpeaker": {
      (ue(t, Math.min(i, s) / 2, Math.min(i, s) / 2, o, 0, 0, 0, a, 24),
        ue(
          t,
          n.type === "wifiAP" ? 0.012 : Math.min(i, s) * 0.38,
          n.type === "wifiAP" ? 0.012 : Math.min(i, s) * 0.38,
          0.005,
          0,
          -0.005,
          0,
          n.type === "wifiAP" ? "#54c8bb" : "#7d878b",
          24,
        ));
      break;
    }
    case "bed": {
      const u = L("#d8cdbf", 0.9),
        h = L("#f7f5f1", 0.95),
        p = L(we(a, -0.25), 0.9);
      (ft(t, i, 0.28, s - 0.08, 0, 0.06, 0.04, u, 0.03),
        f(0.06, 0.1, 0.025, "#8b6f55"),
        ft(t, i - 0.06, 0.22, s - 0.16, 0, 0.32, 0.05, h, 0.05, {
          puff: [0, 0.01, 0],
        }));
      const d = Math.max(0.9, o),
        y = Math.max(3, Math.round((i + 0.04) / 0.3)),
        m = (i + 0.04) / y;
      N(t, i + 0.04, d, 0.05, 0, 0, -l + 0.025, p);
      for (let b = 0; b < y; b++)
        ft(
          t,
          m - 0.008,
          d - 0.32,
          0.06,
          -r - 0.02 + m * (b + 0.5),
          0.3,
          -l + 0.07,
          p,
          0.025,
          {
            puff: [0.004, 0, 0.014],
          },
        );
      const g = i > 1.3 ? 2 : 1,
        v = (i - 0.2 - (g - 1) * 0.06) / g;
      for (let b = 0; b < g; b++) {
        const M = -r + 0.1 + v / 2 + b * (v + 0.06),
          T = ft(
            t,
            v,
            0.13,
            0.42,
            M,
            0.52,
            -l + 0.36,
            L("#ffffff", 0.95),
            0.05,
            {
              puff: [0.01, 0.035, 0.02],
            },
          );
        T.rotation.x = -0.18;
      }
      for (let b = 0; b < g; b++) {
        const M = -r + 0.16 + (v - 0.1) / 2 + b * (v + 0.06),
          T = ft(
            t,
            Math.min(0.45, v - 0.1),
            0.3,
            0.08,
            M,
            0.52,
            -l + 0.62,
            L(we(a, 0.05), 0.95),
            0.035,
            {
              puff: [0.01, 0.01, 0.03],
            },
          );
        T.rotation.x = -0.35;
      }
      const w = s * 0.68,
        x = l - w / 2 - 0.02;
      (ft(t, i + 0.02, 0.08, w, 0, 0.5, x, L("#fbfaf7", 0.95), 0.035, {
        puff: [0, 0.012, 0],
        wrinkle: 0.007,
      }),
        ft(t, 0.03, 0.3, w, -r - 0.005, 0.27, x, L("#fbfaf7", 0.95), 0.012),
        ft(t, 0.03, 0.3, w, r + 0.005, 0.27, x, L("#fbfaf7", 0.95), 0.012),
        ft(
          t,
          i + 0.06,
          0.03,
          s * 0.22,
          0,
          0.575,
          l - s * 0.14,
          L(a, 0.95),
          0.012,
        ),
        ft(t, i + 0.06, 0.32, 0.03, 0, 0.29, l + 0.005, L(a, 0.95), 0.012));
      break;
    }
    case "nightstand":
      (N(t, i, o - 0.06, s, 0, 0.06, 0, L(a, 0.6)),
        f(0.06, 0.04, 0.015),
        N(t, i * 0.8, 0.01, 0.01, 0, o * 0.55, l, "#8a6a4d"),
        C7(
          t,
          [
            [0, 0],
            [0.045, 0],
            [0.06, 0.02],
            [0.072, 0.07],
            [0.066, 0.12],
            [0.045, 0.17],
            [0.022, 0.2],
            [0.014, 0.22],
            [0.014, 0.25],
            [0, 0.25],
          ],
          0,
          o,
          0,
          L("#e9e1d2", 0.35),
        ));
      {
        const u = !!j0.get(n.id),
          h = ue(
            t,
            0.07,
            0.1,
            0.14,
            0,
            o + 0.25,
            0,
            L("#fbf3e2", 0.9, 0, {
              emissive: "#ffd59a",
              emissiveIntensity: u ? 1.6 : 0.05,
              side: e0,
            }),
          );
        ((h.castShadow = !1),
          (h.userData.interactive = "lamp"),
          _9(t, h, T9(t, u, o + 0.3, 2), u));
      }
      break;
    case "wardrobe": {
      const u = L(a, 0.55),
        h = Math.max(2, Math.round(i / 0.5)),
        p = i / h;
      (N(t, i, o - 0.08, s - 0.025, 0, 0.08, -0.0125, u),
        N(t, i - 0.04, 0.08, s - 0.06, 0, 0, -0.03, L(we(a, -0.35), 0.7)));
      for (let d = 0; d < h; d++)
        N(
          t,
          p - 0.003,
          o - 0.09,
          0.022,
          -r + p * (d + 0.5),
          0.085,
          l - 0.011,
          u,
        );
      N(
        t,
        i - 0.004,
        o - 0.1,
        0.004,
        0,
        0.09,
        l - 0.006,
        L(we(a, -0.12), 0.6),
        !1,
      );
      for (let d = 0; d < h; d++)
        N(
          t,
          0.012,
          0.32,
          0.02,
          -r + p * (d + (d % 2 ? 0.1 : 0.9)),
          o * 0.45,
          l + 0.01,
          L("#8a8f96", 0.3, 0.8),
          !1,
        );
      break;
    }
    case "sofa":
    case "armchair":
    case "lounge": {
      const u = L(we(a, -0.08), 0.95),
        h = L(a, 0.95),
        p = n.type === "lounge" ? 0.07 : Math.min(0.18, i * 0.14),
        d = String(Yt(n, "arms", "both")),
        y = d === "both" || d === "left" ? p : 0,
        m = d === "both" || d === "right" ? p : 0;
      for (const w of [-1, 1])
        for (const x of [-1, 1])
          ue(
            t,
            0.018,
            0.026,
            0.1,
            w * (r - 0.08),
            0,
            x * (l - 0.08),
            L("#5a4130", 0.55),
            10,
          );
      (ft(t, i, 0.3, s, 0, 0.1, 0, u, 0.04),
        ft(t, i, o - 0.1, 0.22, 0, 0.1, -l + 0.11, u, 0.05),
        y && ft(t, y, 0.3, s, -r + y / 2, 0.38, 0, u, Math.min(0.07, y / 2.2)),
        m && ft(t, m, 0.3, s, r - m / 2, 0.38, 0, u, Math.min(0.07, m / 2.2)));
      const g =
          n.type !== "sofa"
            ? 1
            : d === "both"
              ? i > 1.7
                ? 3
                : 2
              : Math.max(1, Math.round((i - y - m) / 0.75)),
        v = (i - y - m) / g;
      for (let w = 0; w < g; w++) {
        const x = -r + y + v * (w + 0.5);
        ft(t, v - 0.015, 0.15, s - 0.25, x, 0.39, 0.11, h, 0.045, {
          puff: [0.006, 0.018, 0.006],
          pipe: we(a, -0.12),
        });
        const b = ft(
          t,
          v - 0.025,
          Math.max(0.22, o - 0.58),
          0.16,
          x,
          0.52,
          -l + 0.29,
          h,
          0.06,
          {
            puff: [0.006, 0.006, 0.025],
          },
        );
        b.rotation.x = -0.13;
      }
      if (n.type === "sofa" && i > 1.3)
        for (const w of [-1, 1])
          ft(
            t,
            0.42,
            0.4,
            0.09,
            w * (r - (w < 0 ? y : m) - 0.3),
            0.52,
            -l + 0.42,
            L(we(a, w < 0 ? -0.18 : 0.12), 0.95),
            0.04,
            {
              puff: [0.01, 0.01, 0.035],
            },
          ).rotation.set(-0.3, w * 0.25, w * 0.12);
      break;
    }
    case "coffeeTable":
      (N(t, i, 0.04, s, 0, o - 0.04, 0, L(a, 0.35)),
        N(t, i - 0.1, 0.02, s - 0.1, 0, 0.08, 0, L(a, 0.5)),
        f(o - 0.04, 0.05, 0.018));
      break;
    case "tvCabinet": {
      (N(t, i, o - 0.08, s, 0, 0.08, 0, L(a, 0.5)), f(0.08, 0.06, 0.015));
      for (let y = 1; y < 3; y++)
        N(t, 0.005, o - 0.12, 0.005, -r + (i * y) / 3, 0.1, l, "#a8a196", !1);
      const u = Math.min(i * 0.75, 1.65),
        h = u * 0.5625;
      N(t, u, h, 0.035, 0, o + 0.08, -l + 0.12, L("#111316", 0.25, 0.2));
      const p = !!j0.get(n.id),
        d = N(t, u - 0.02, h - 0.02, 0.002, 0, o + 0.09, -l + 0.139, E7(p), !1);
      ((d.userData.interactive = "tv"),
        k7(t, d, p),
        N(t, 0.3, 0.015, 0.18, 0, o, -l + 0.12, "#2a2c30"),
        ue(t, 0.015, 0.015, 0.08, 0, o, -l + 0.12, "#2a2c30"));
      break;
    }
    case "diningTable":
      (N(t, i, 0.05, s, 0, o - 0.05, 0, L(a, 0.45)),
        f(o - 0.05, 0.08, 0.025, we(a, -0.3)),
        ue(t, 0.08, 0.05, 0.18, 0, o, 0, L("#f2f0ea", 0.3)),
        ha(t, 0.07, 0.05, o + 0.2, 0.02, "#7aa36a"));
      break;
    case "chair": {
      ft(t, i, 0.07, s - 0.04, 0, 0.41, 0.02, L(a, 0.85), 0.025, {
        puff: [0, 0.008, 0],
      });
      const u = ft(t, i, 0.42, 0.05, 0, 0.48, -l + 0.03, L(a, 0.85), 0.02);
      ((u.rotation.x = -0.08), f(0.41, 0.04, 0.012, "#2b2e33"));
      break;
    }
    case "desk":
      (N(t, i, 0.035, s, 0, o - 0.035, 0, L(a, 0.5)),
        N(t, 0.03, o - 0.035, s, -r + 0.015, 0, 0, L(a, 0.5)),
        N(t, 0.03, o - 0.035, s, r - 0.015, 0, 0, L(a, 0.5)),
        N(
          t,
          Math.min(0.56, i * 0.5),
          0.33,
          0.02,
          0,
          o + 0.12,
          -l + 0.12,
          L("#15171a", 0.3),
        ),
        N(t, 0.06, 0.12, 0.02, 0, o, -l + 0.12, "#2a2c30"),
        N(t, Math.min(0.44, i * 0.4), 0.015, 0.14, 0, o, 0.05, "#e8e8e8"));
      break;
    case "officeChair": {
      ue(t, 0.03, 0.03, 0.38, 0, 0.06, 0, L("#6d7178", 0.3, 0.8));
      for (let h = 0; h < 5; h++) {
        const p = (h / 5) * Math.PI * 2,
          d = N(
            t,
            0.3,
            0.025,
            0.04,
            Math.cos(p) * 0.15,
            0.04,
            Math.sin(p) * 0.15,
            "#2a2c30",
          );
        d.rotation.y = -p;
      }
      N(t, i * 0.85, 0.08, s * 0.8, 0, 0.44, 0.04, L(a, 0.9));
      const u = N(t, i * 0.8, o - 0.6, 0.06, 0, 0.56, -l + 0.08, L(a, 0.9));
      u.rotation.x = -0.08;
      break;
    }
    case "bookshelf": {
      const u = L(a, 0.6);
      (N(t, 0.025, o, s, -r + 0.0125, 0, 0, u),
        N(t, 0.025, o, s, r - 0.0125, 0, 0, u),
        N(t, i, 0.02, s, 0, 0, 0, u));
      const h = Math.max(2, Math.round(o / 0.38)),
        p = on(Math.round(n.x + n.y)),
        d = [
          "#b5523b",
          "#3b6ea5",
          "#e2c275",
          "#5f8f55",
          "#d9d2c5",
          "#6d4c7d",
          "#2f343c",
        ];
      for (let y = 1; y <= h; y++) {
        const m = (o * y) / h;
        if ((N(t, i - 0.05, 0.02, s, 0, m - 0.02, 0, u), y < h)) {
          let g = -r + 0.04;
          for (; g < r - 0.1;) {
            const v = 0.025 + p() * 0.035,
              w = (o / h) * (0.55 + p() * 0.3);
            (p() > 0.2 &&
              N(
                t,
                v,
                w,
                s * 0.75,
                g + v / 2,
                (o * (y - 1)) / h + 0.01,
                0.02,
                d[Math.floor(p() * d.length)],
              ),
              (g += v + 0.004));
          }
        }
      }
      N(t, i, o, 0.01, 0, 0, -l + 0.005, u);
      break;
    }
    case "fridge":
      if (i > 0.85) {
        (N(t, i, o, s, 0, 0, 0, L(a, 0.3, 0.4)),
          N(t, 0.006, o - 0.02, 0.006, 0, 0.01, l, "#8a8f96", !1));
        for (const u of [-1, 1])
          N(
            t,
            0.02,
            0.7,
            0.03,
            u * 0.04,
            o * 0.45,
            l + 0.01,
            L("#9aa1a8", 0.3, 0.8),
          );
        break;
      }
      (N(t, i, o, s, 0, 0, 0, L(a, 0.3, 0.4)),
        N(t, i - 0.01, 0.006, 0.006, 0, o * 0.62, l, "#8a8f96", !1),
        N(
          t,
          0.02,
          0.5,
          0.03,
          r - 0.06,
          o * 0.66,
          l + 0.01,
          L("#9aa1a8", 0.3, 0.8),
        ),
        N(
          t,
          0.02,
          0.35,
          0.03,
          r - 0.06,
          o * 0.35,
          l + 0.01,
          L("#9aa1a8", 0.3, 0.8),
        ));
      break;
    case "shoeCabinet":
    case "island": {
      (N(t, i, o - 0.08, s, 0, 0.08, 0, L(a, 0.5)),
        f(0.08, 0.05, 0.015),
        N(
          t,
          i + 0.01,
          0.025,
          s + 0.01,
          0,
          o - 0.025,
          0,
          L(n.type === "island" ? "#d8d2c8" : we(a, -0.1), 0.4),
        ));
      const u = Math.max(2, Math.round(i / 0.4));
      for (let h = 1; h < u; h++)
        N(t, 0.005, o - 0.16, 0.005, -r + (i * h) / u, 0.1, l, "#aaa398", !1);
      break;
    }
    case "rug":
      (N(t, i, 0.012, s, 0, 0, 0, L(a, 1), !1),
        N(t, i - 0.24, 0.002, s - 0.24, 0, 0.012, 0, L(we(a, -0.08), 1), !1));
      break;
    case "plant":
      L7(t, n, i, o, s, a);
      break;
    case "toilet": {
      const u = L(a, 0.2);
      if (o < 0.5) {
        const h = ue(
          t,
          i * 0.45,
          i * 0.4,
          0.32,
          0,
          0.1,
          -l + 0.05 + (s - 0.05) / 2,
          u,
        );
        ((h.scale.z = (s - 0.05) / i),
          N(t, 0.25, 0.16, 0.01, 0, 1, -l + 0.005, L("#e9ebee", 0.3), !1),
          N(
            t,
            0.1,
            0.06,
            0.012,
            0,
            1.05,
            -l + 0.01,
            L("#c7ccd2", 0.2, 0.8),
            !1,
          ));
        break;
      }
      (N(t, i * 0.9, 0.38, 0.18, 0, 0.4, -l + 0.09, u),
        (ue(
          t,
          i * 0.38,
          i * 0.3,
          0.4,
          0,
          0,
          -l + 0.18 + (s - 0.18) / 2,
          u,
        ).scale.z = (s - 0.2) / (i * 0.9)),
        (ue(
          t,
          i * 0.45,
          i * 0.45,
          0.03,
          0,
          0.4,
          -l + 0.18 + (s - 0.18) / 2,
          u,
        ).scale.z = (s - 0.2) / (i * 0.9)));
      break;
    }
    case "bathtub":
      (N(t, i, o, s, 0, 0, 0, L(a, 0.15)),
        N(
          t,
          i - 0.14,
          0.01,
          s - 0.14,
          0,
          o - 0.08,
          0,
          L("#bfe0ee", 0.05, 0, {
            transparent: !0,
            opacity: 0.85,
          }),
        ),
        ue(t, 0.015, 0.015, 0.15, -r + 0.12, o, 0, L("#c7ccd2", 0.2, 0.9)));
      break;
    case "washer": {
      N(t, i, o, s, 0, 0, 0, L(a, 0.35));
      const u = ue(t, 0.2, 0.2, 0.03, 0, o * 0.45, l, L("#8fa2ad", 0.1, 0.5));
      ((u.rotation.x = Math.PI / 2),
        (u.position.y = o * 0.45),
        N(t, i - 0.06, 0.1, 0.01, 0, o - 0.14, l, "#dadde0", !1));
      break;
    }
    case "sideTable":
      (ue(
        t,
        Math.min(i, s) / 2,
        Math.min(i, s) / 2,
        0.03,
        0,
        o - 0.03,
        0,
        L(a, 0.4),
      ),
        ue(t, 0.02, 0.02, o - 0.03, 0, 0, 0, "#2b2e33"),
        ue(t, 0.15, 0.15, 0.02, 0, 0, 0, "#2b2e33"));
      break;
    case "bunkBed": {
      const u = L(a, 0.6),
        h = 0.06;
      for (const p of [-1, 1])
        for (const d of [-1, 1])
          N(t, h, o, h, p * (r - h / 2), 0, d * (l - h / 2), u);
      for (const p of [0.25, 1.15])
        (N(t, i, 0.08, s, 0, p, 0, u),
          N(t, i - 0.06, 0.16, s - 0.06, 0, p + 0.08, 0, L("#f7f5f1", 0.95)),
          N(t, i - 0.2, 0.12, 0.36, 0, p + 0.24, -l + 0.26, L("#ffffff", 0.95)),
          N(
            t,
            i - 0.06,
            0.05,
            s * 0.55,
            0,
            p + 0.24,
            l - s * 0.3,
            L(we(a, 0.3), 0.95),
          ));
      (N(t, 0.03, 0.25, s * 0.7, -r + 0.015, 1.45, -0.05, u),
        N(t, 0.03, 0.25, s * 0.7, r - 0.015, 1.45, -0.05, u));
      for (let p = 0; p < 5; p++)
        N(t, 0.04, 0.03, 0.36, r - 0.02, 0.3 + p * 0.28, l - 0.3, u);
      break;
    }
    case "crib": {
      const u = L(a, 0.6);
      (N(t, i, 0.05, s, 0, 0.3, 0, u),
        N(t, i - 0.06, 0.1, s - 0.06, 0, 0.35, 0, L("#ffffff", 0.95)));
      for (const h of [-1, 1]) N(t, 0.05, o, s, h * (r - 0.025), 0, 0, u);
      for (const h of [-1, 1]) {
        N(t, i, 0.04, 0.03, 0, o - 0.04, h * (l - 0.015), u);
        for (let p = -r + 0.1; p < r - 0.05; p += 0.08)
          ue(t, 0.01, 0.01, o - 0.38, p, 0.34, h * (l - 0.015), u, 8);
      }
      break;
    }
    case "tatami": {
      N(t, i, o - 0.04, s, 0, 0, 0, L(we(a, -0.2), 0.7));
      const u = Math.max(1, Math.round(i / 0.9)),
        h = Math.max(1, Math.round(s / 0.9));
      for (let p = 0; p < u; p++)
        for (let d = 0; d < h; d++)
          N(
            t,
            i / u - 0.01,
            0.04,
            s / h - 0.01,
            -r + (i / u) * (p + 0.5),
            o - 0.04,
            -l + (s / h) * (d + 0.5),
            L((p + d) % 2 ? a : we(a, 0.06), 0.95),
          );
      N(
        t,
        Math.min(0.6, i * 0.3),
        0.12,
        Math.min(0.4, s * 0.2),
        -r + 0.4,
        o,
        -l + 0.3,
        L("#ffffff", 0.95),
      );
      break;
    }
    case "bedBench":
    case "entryBench":
      (N(t, i, 0.12, s, 0, o - 0.12, 0, L(a, 0.95)),
        f(o - 0.12, 0.05, 0.015, "#3b2f26"));
      break;
    case "dresser": {
      (N(t, i, 0.03, s, 0, o - 0.03, 0, L(a, 0.45)),
        N(t, i * 0.3, o - 0.2, s, -r + i * 0.15, 0.17, 0, L(a, 0.5)),
        f(0.17, 0.04, 0.012, "#b79a6b"));
      const u = ue(
        t,
        Math.min(0.32, i * 0.3),
        Math.min(0.32, i * 0.3),
        0.02,
        0,
        o + 0.45,
        -l + 0.03,
        L("#dfe9ef", 0.02, 0.9),
      );
      ((u.rotation.x = Math.PI / 2), (u.position.y = o + 0.45));
      break;
    }
    case "mirror":
      (N(t, i, o, s, 0, 0, 0, L(a, 0.5)),
        N(
          t,
          i - 0.06,
          o - 0.06,
          0.005,
          0,
          0.03,
          l,
          L("#dfe9ef", 0.02, 0.95),
          !1,
        ));
      break;
    case "lSofa": {
      const u = L(we(a, -0.08), 0.95),
        h = L(a, 0.95),
        p = Math.min(0.95, s * 0.56),
        d = 0.16;
      (f(0.1, 0.08, 0.02, "#3a2e25"),
        ft(t, i, 0.3, p, 0, 0.1, -l + p / 2, u, 0.04),
        ft(t, p, 0.3, s - p, -r + p / 2, 0.1, -l + p + (s - p) / 2, u, 0.04),
        ft(t, i, o - 0.1, 0.22, 0, 0.1, -l + 0.11, u, 0.05),
        ft(t, d, 0.3, p, r - d / 2, 0.38, -l + p / 2, u, 0.06));
      const y = (i - 0.22 - d) / 3;
      for (let m = 0; m < 3; m++) {
        ft(
          t,
          y - 0.015,
          0.15,
          p - 0.26,
          -r + 0.22 + y * (m + 0.5),
          0.39,
          -l + 0.22 + (p - 0.22) / 2,
          h,
          0.045,
          {
            puff: [0.006, 0.018, 0.006],
            pipe: we(a, -0.12),
          },
        );
        const g = ft(
          t,
          y - 0.025,
          Math.max(0.22, o - 0.58),
          0.16,
          -r + 0.22 + y * (m + 0.5),
          0.52,
          -l + 0.3,
          h,
          0.06,
          {
            puff: [0.006, 0.006, 0.025],
          },
        );
        g.rotation.x = -0.13;
      }
      ft(
        t,
        p - 0.04,
        0.15,
        s - p - 0.02,
        -r + p / 2,
        0.39,
        -l + p + (s - p) / 2,
        h,
        0.045,
        {
          puff: [0.006, 0.018, 0.006],
          pipe: we(a, -0.12),
        },
      );
      for (const [m, g, v] of [
        [r - d - 0.3, -l + 0.42, 0.2],
        [-r + 0.4, -l + 0.42, -0.2],
      ])
        ft(t, 0.42, 0.4, 0.09, m, 0.52, g, L(we(a, -0.15), 0.95), 0.04, {
          puff: [0.01, 0.01, 0.035],
        }).rotation.set(-0.3, v, 0);
      break;
    }
    case "sideboard": {
      const u = L(a, 0.5);
      (N(t, i, 0.85, s, 0, 0.05, 0, u),
        N(t, i, 0.03, s + 0.01, 0, 0.9, 0, L("#d8d2c8", 0.3)),
        N(t, i, 0.01, s * 0.9, 0, 0.93, -l + s * 0.45, L(we(a, -0.1), 0.6)),
        N(t, i, o - 1.35, s * 0.8, 0, 1.35, -l + s * 0.4, u));
      for (let h = 1; h < 4; h++)
        (N(t, 0.005, 0.75, 0.005, -r + (i * h) / 4, 0.1, l, "#a8a196", !1),
          N(
            t,
            0.005,
            o - 1.45,
            0.005,
            -r + (i * h) / 4,
            1.4,
            -l + s * 0.8,
            "#a8a196",
            !1,
          ));
      ue(t, 0.05, 0.07, 0.14, -r + 0.3, 0.93, 0, L("#7aa36a", 0.8));
      break;
    }
    case "barStool": {
      const u = Math.min(i, s) / 2;
      (ue(t, u * 0.9, u * 0.9, 0.06, 0, o - 0.06, 0, L(a, 0.7)),
        ue(t, 0.025, 0.025, o - 0.06, 0, 0, 0, L("#9aa1a8", 0.3, 0.8)),
        ue(t, u * 0.7, u * 0.7, 0.02, 0, 0, 0, L("#6d7178", 0.3, 0.8)));
      const h = new Me(new Zs(u * 0.6, 0.01, 6, 24), L("#9aa1a8", 0.3, 0.8));
      ((h.rotation.x = Math.PI / 2), (h.position.y = 0.3), t.add(h));
      break;
    }
    case "piano": {
      const u = L(a, 0.15, 0.1);
      (N(t, i, o, s * 0.55, 0, 0, -l + s * 0.275, u),
        N(t, i, 0.14, s, 0, 0.62, 0, u),
        N(t, i - 0.1, 0.02, s * 0.3, 0, 0.76, l - s * 0.17, L("#f6f6f2", 0.3)),
        N(t, i - 0.1, 0.025, s * 0.14, 0, 0.765, l - s * 0.26, L("#111", 0.3)),
        N(t, 0.05, 0.62, s * 0.45, -r + 0.025, 0, l - s * 0.22, u),
        N(t, 0.05, 0.62, s * 0.45, r - 0.025, 0, l - s * 0.22, u));
      break;
    }
    case "acWall": {
      const u = L(a, 0.35);
      (N(t, i, o, s, 0, 0, 0, u),
        N(t, i - 0.04, 0.03, 0.01, 0, 0.05, l, L("#2b2e33", 0.5), !1));
      for (let h = 0; h < 3; h++)
        N(
          t,
          i - 0.1,
          0.004,
          0.01,
          0,
          o - 0.06 - h * 0.03,
          l,
          L("#d8dbde", 0.5),
          !1,
        );
      N(
        t,
        0.06,
        0.015,
        0.005,
        r - 0.12,
        o * 0.5,
        l + 0.002,
        L("#5ad1ff", 0.3, 0, {
          emissive: "#3bc3ff",
          emissiveIntensity: 0.6,
        }),
        !1,
      );
      break;
    }
    case "acFloor": {
      const u = L(a, 0.35);
      (N(t, i, o, s, 0, 0, 0, u),
        N(t, i - 0.08, 0.5, 0.01, 0, o - 0.65, l, L("#2b2e33", 0.5), !1));
      for (let h = 0; h < 8; h++)
        N(
          t,
          i - 0.1,
          0.005,
          0.012,
          0,
          o - 0.63 + h * 0.06,
          l + 0.004,
          L("#d8dbde", 0.5),
          !1,
        );
      N(
        t,
        0.14,
        0.06,
        0.005,
        0,
        o * 0.48,
        l + 0.002,
        L("#111", 0.2, 0, {
          emissive: "#3bc3ff",
          emissiveIntensity: 0.5,
        }),
        !1,
      );
      break;
    }
    case "waterHeater": {
      const u = Math.min(s, o) / 2,
        h = ue(t, u, u, i, 0, 0, 0, L(a, 0.3, 0.2), 32);
      ((h.rotation.z = Math.PI / 2), h.position.set(0, o / 2, 0));
      for (const p of [-1, 1]) {
        const d = ue(
          t,
          u * 0.98,
          u * 0.98,
          0.02,
          0,
          0,
          0,
          L("#c9ced4", 0.3, 0.5),
          32,
        );
        ((d.rotation.z = Math.PI / 2),
          d.position.set(p * (r + 0.005), o / 2, 0));
      }
      (N(
        t,
        0.12,
        0.05,
        0.01,
        0,
        o / 2 - 0.04,
        u,
        L("#1b2230", 0.2, 0, {
          emissive: "#ff9b4a",
          emissiveIntensity: 0.5,
        }),
        !1,
      ),
        ue(t, 0.012, 0.012, 0.25, -0.08, -0.25, -l + 0.1, L("#e03131", 0.4)),
        ue(t, 0.012, 0.012, 0.25, 0.08, -0.25, -l + 0.1, L("#1c7ed6", 0.4)));
      break;
    }
    case "gasHeater":
      (N(t, i, o, s, 0, 0, 0, L(a, 0.3, 0.2)),
        N(
          t,
          i * 0.55,
          0.08,
          0.005,
          0,
          o * 0.62,
          l,
          L("#1b2230", 0.2, 0, {
            emissive: "#3bc3ff",
            emissiveIntensity: 0.4,
          }),
          !1,
        ),
        ue(t, 0.04, 0.04, 0.5, 0, o, -l + 0.06, L("#c9ced4", 0.3, 0.6)));
      break;
    case "waterDispenser":
      (N(t, i, o - 0.3, s, 0, 0, 0, L(a, 0.4)),
        N(t, i * 0.6, 0.15, 0.01, 0, o * 0.45, l, L("#2b2e33", 0.4), !1),
        ue(
          t,
          i * 0.4,
          i * 0.4,
          0.36,
          0,
          o - 0.32,
          0,
          L("#a8d8f0", 0.05, 0, {
            transparent: !0,
            opacity: 0.55,
            depthWrite: !1,
          }),
        ));
      break;
    case "purifier":
    case "airPurifier":
      N(t, i, o, s, 0, 0, 0, L(a, 0.4));
      for (let u = 0; u < 6; u++)
        N(
          t,
          i - 0.08,
          0.006,
          0.005,
          0,
          o * 0.3 + u * 0.05,
          l,
          L("#c3c7cc", 0.5),
          !1,
        );
      break;
    case "dishwasher":
    case "microwave":
      (N(t, i, o, s, 0, 0, 0, L(a, 0.3, 0.5)),
        N(
          t,
          i - 0.02,
          n.type === "microwave" ? o - 0.04 : 0.06,
          0.01,
          n.type === "microwave" ? -0.06 : 0,
          n.type === "microwave" ? 0.02 : o - 0.08,
          l,
          L("#1b1d21", 0.1, 0.3),
          !1,
        ),
        N(
          t,
          n.type === "microwave" ? 0.02 : i * 0.6,
          n.type === "microwave" ? o * 0.6 : 0.02,
          0.03,
          n.type === "microwave" ? r - 0.05 : 0,
          n.type === "microwave" ? o * 0.2 : o - 0.15,
          l + 0.01,
          L("#9aa1a8", 0.3, 0.8),
          !1,
        ));
      break;
    case "tallOven": {
      const u = L(a, 0.5);
      N(t, i, o, s, 0, 0, 0, u);
      for (const [h, p] of [
        [0.85, 0.45],
        [1.36, 0.42],
      ])
        (N(t, i - 0.06, p, 0.01, 0, h, l, L("#1b1d21", 0.1, 0.3), !1),
          N(
            t,
            i - 0.16,
            0.015,
            0.02,
            0,
            h + p - 0.05,
            l + 0.01,
            L("#9aa1a8", 0.3, 0.8),
            !1,
          ));
      N(t, 0.005, o, 0.005, 0, 0, l, "#a8a196", !1);
      break;
    }
    case "hood": {
      const u = L(a, 0.25, 0.8);
      (N(t, i, 0.08, s, 0, 0, 0, u),
        N(t, i * 0.9, 0.2, s * 0.8, 0, 0.08, -l + s * 0.4, u),
        N(
          t,
          i * 0.32,
          Math.max(0.2, o - 0.28),
          s * 0.5,
          0,
          0.28,
          -l + s * 0.25,
          u,
        ),
        N(t, i * 0.5, 0.02, 0.005, 0, 0.03, l, L("#2b2e33", 0.3), !1));
      break;
    }
    case "dryer": {
      N(t, i, o, s, 0, 0, 0, L(a, 0.35));
      const u = ue(t, 0.21, 0.21, 0.03, 0, o * 0.45, l, L("#2f3438", 0.1, 0.5));
      ((u.rotation.x = Math.PI / 2),
        (u.position.y = o * 0.45),
        N(t, i - 0.06, 0.1, 0.01, 0, o - 0.14, l, "#dadde0", !1));
      break;
    }
    case "wallTV": {
      N(t, i, o, Math.min(s, 0.04), 0, 0, -l + 0.02, L("#111316", 0.25, 0.2));
      const u = !!j0.get(n.id),
        h = N(t, i - 0.02, o - 0.02, 0.002, 0, 0.01, -l + 0.041, E7(u), !1);
      ((h.userData.interactive = "tv"), k7(t, h, u));
      break;
    }
    case "robotVac":
      (N(t, i, o, s * 0.35, 0, 0, -l + s * 0.175, L(a, 0.4)),
        ue(t, i * 0.44, i * 0.44, 0.09, 0, 0, l - i * 0.44, L("#3b3f46", 0.3)),
        ue(t, 0.05, 0.05, 0.02, 0, 0.09, l - i * 0.44, L("#9aa1a8", 0.3, 0.8)));
      break;
    case "treadmill": {
      const u = L(a, 0.5);
      (N(t, i, 0.18, s, 0, 0, 0, u),
        N(t, i - 0.12, 0.01, s - 0.4, 0, 0.18, 0.1, L("#1b1d21", 0.9)));
      for (const h of [-1, 1])
        N(t, 0.05, 1.1, 0.06, h * (r - 0.05), 0.18, -l + 0.2, u);
      (N(t, i, 0.08, 0.3, 0, o - 0.08, -l + 0.2, L("#3b3f46", 0.4)),
        N(
          t,
          0.3,
          0.12,
          0.02,
          0,
          o - 0.1,
          -l + 0.36,
          L("#111", 0.2, 0, {
            emissive: "#3bc3ff",
            emissiveIntensity: 0.4,
          }),
          !1,
        ));
      break;
    }
    case "floorLamp":
    case "deskLamp": {
      const u = !!j0.get(n.id),
        h = n.type === "floorLamp",
        p = Math.min(i, s) / 2;
      C7(
        t,
        [
          [0, 0],
          [p * 0.7, 0],
          [p * 0.72, 0.01],
          [p * 0.68, 0.025],
          [p * 0.3, 0.035],
          [0.014, 0.045],
          [0.012, o * 0.8],
          [0, o * 0.8],
        ],
        0,
        0,
        0,
        L("#2b2e33", 0.35, 0.7),
      );
      const d = ue(
        t,
        p * (h ? 0.55 : 0.5),
        p * (h ? 0.8 : 0.75),
        o * (h ? 0.2 : 0.32),
        0,
        o * (h ? 0.78 : 0.62),
        0,
        L(a, 0.9, 0, {
          emissive: "#ffd59a",
          emissiveIntensity: u ? 1.6 : 0,
          side: e0,
        }),
      );
      ((d.castShadow = !1),
        (d.userData.interactive = "lamp"),
        _9(t, d, T9(t, u, o * (h ? 0.85 : 0.7), h ? 4.5 : 2.2), u));
      break;
    }
    case "curtain": {
      const u = n.key === "sheer",
        h = L(
          a,
          0.95,
          0,
          u
            ? {
                transparent: !0,
                opacity: 0.55,
                depthWrite: !1,
                side: e0,
              }
            : {
                side: e0,
              },
        );
      N(
        t,
        i + 0.1,
        0.03,
        0.03,
        0,
        o - 0.03,
        -l + 0.02,
        L("#9aa1a8", 0.3, 0.7),
        !1,
      );
      const p = Math.max(3, Math.round(r / 0.07)),
        d = Math.hypot(r / p, 0.06),
        y = Math.min(r, Math.max(0.18, i * 0.14)),
        g = {
          kind: "curtain",
          halves: [
            {
              edge: -r,
              dir: 1,
            },
            {
              edge: r,
              dir: -1,
            },
          ].map((v) => ({
            ...v,
            pleats: Array.from(
              {
                length: p,
              },
              () => {
                const w = N(t, d + 0.004, o - 0.08, 0.012, 0, 0.02, 0, h, !u);
                return ((w.userData.interactive = "curtain"), w);
              },
            ),
          })),
          hw: r,
          bw: y,
          L0: d,
          s: Ui(el(n.id)),
        };
      ((t.userData.anim = g), Gd(g));
      break;
    }
    case "showerScreen":
      (N(t, i, o, 0.01, 0, 0.02, 0, Es(), !1),
        N(t, i, 0.03, 0.03, 0, o - 0.01, 0, L("#b9bec6", 0.3, 0.8)),
        N(t, i, 0.02, s, 0, 0, 0, L("#d9dde0", 0.5)),
        N(t, 0.03, o, 0.03, -r + 0.015, 0, 0, L("#b9bec6", 0.3, 0.8)));
      break;
    case "showerSet": {
      const u = Math.min(0.26, i * 0.3),
        h = L("#c7ccd2", 0.25, 0.85),
        p = L(a, 0.5);
      (N(t, i - u, o, s, -u / 2, 0, 0, p),
        N(t, u, o * 0.35, s, r - u / 2, 0, 0, p),
        N(t, u, o * 0.15, s, r - u / 2, o * 0.85, 0, p),
        N(
          t,
          u - 0.03,
          o * 0.5,
          s * 0.6,
          r - u / 2,
          o * 0.35,
          -l + s * 0.3,
          L("#9a9790", 0.7),
        ),
        N(
          t,
          i - u - 0.1,
          0.2,
          0.008,
          -u / 2,
          o - 0.32,
          l + 0.004,
          L("#b9bec5", 0.25, 0.8),
          !1,
        ));
      for (let g = 0; g < 3; g++) {
        const v = ue(
          t,
          0.028,
          0.028,
          0.04,
          -r + ((i - u) * (g + 1)) / 4,
          o - 0.24,
          l + 0.02,
          h,
          20,
        );
        v.rotation.x = Math.PI / 2;
      }
      const d = -r + (i - u) / 2,
        y = 2.15;
      N(t, 0.024, y - o, 0.024, d, o, -l + 0.03, h);
      const m = ue(t, 0.012, 0.012, 0.3, d, y - 0.15, -l + 0.18, h, 12);
      ((m.rotation.x = Math.PI / 2),
        ue(t, 0.13, 0.13, 0.012, d, y - 0.02, -l + 0.3, h, 32));
      break;
    }
    case "towelWarmer": {
      const u = L(a, 0.25, 0.9);
      (ue(t, 0.015, 0.015, o, -r + 0.02, 0, 0, u, 10),
        ue(t, 0.015, 0.015, o, r - 0.02, 0, 0, u, 10));
      for (let h = 0.06; h < o; h += 0.1) {
        const p = ue(t, 0.01, 0.01, i - 0.04, 0, 0, 0, u, 8);
        ((p.rotation.z = Math.PI / 2), p.position.set(0, h, 0));
      }
      break;
    }
    case "mirrorCabinet":
      (N(t, i, o, s, 0, 0, 0, L(a, 0.5)),
        N(
          t,
          i / 2 - 0.006,
          o - 0.02,
          0.005,
          -i / 4,
          0.01,
          l,
          L("#dfe9ef", 0.02, 0.95),
          !1,
        ),
        N(
          t,
          i / 2 - 0.006,
          o - 0.02,
          0.005,
          i / 4,
          0.01,
          l,
          L("#dfe9ef", 0.02, 0.95),
          !1,
        ));
      break;
    case "bathHeater": {
      (N(t, i, 0.02, s, 0, o - 0.02, 0, L(a, 0.4), !1),
        N(t, i * 0.9, 0.01, s * 0.9, 0, o - 0.03, 0, L("#e3e4e6", 0.6), !1),
        ue(
          t,
          i * 0.18,
          i * 0.18,
          0.012,
          0,
          o - 0.045,
          0,
          L("#ffffff", 0.3, 0, {
            emissive: "#fff4dc",
            emissiveIntensity: 0.6,
          }),
          20,
        ));
      for (let u = -2; u <= 2; u++)
        N(
          t,
          i * 0.7,
          0.004,
          0.006,
          0,
          o - 0.036,
          u * s * 0.16,
          L("#b8bcc2", 0.5),
          !1,
        );
      break;
    }
    case "clothesRack": {
      const u = L(a, 0.3, 0.8);
      N(t, i * 0.3, 0.06, 0.12, 0, o - 0.06, 0, L("#e9ebee", 0.5));
      for (const h of [-l + 0.05, 0, l - 0.05]) {
        const p = ue(t, 0.012, 0.012, i, 0, 0, 0, u, 8);
        ((p.rotation.z = Math.PI / 2), p.position.set(0, 0.05, h));
      }
      for (const h of [-1, 1])
        ue(t, 0.003, 0.003, o - 0.1, h * i * 0.3, 0.05, 0, L("#555", 0.5), 4);
      break;
    }
    case "laundrySink":
      (N(t, i, 0.7, s, 0, 0.08, 0, L(a, 0.5)),
        N(t, i + 0.01, 0.1, s + 0.01, 0, 0.78, 0, L("#f7f7f5", 0.2)),
        N(t, i - 0.12, 0.02, s - 0.16, 0, 0.86, 0.02, L("#e3e6e8", 0.3)),
        ue(t, 0.015, 0.015, 0.28, 0, 0.88, -l + 0.06, L("#c7ccd2", 0.2, 0.9)),
        N(t, 0.3, 0.02, 0.5, r - 0.2, 0.8, 0, "#cdd1d4", !1));
      break;
    case "roundBed": {
      const u = Math.min(i, s) / 2;
      (ue(t, u, u, 0.3, 0, 0.08, 0, L(we(a, -0.15), 0.9), 40),
        ue(t, u - 0.04, u - 0.04, 0.2, 0, 0.38, 0, L("#f7f5f1", 0.95), 40));
      const h = ue(
        t,
        u + 0.05,
        u + 0.05,
        Math.max(0.6, o - 0.3),
        0,
        0.1,
        0,
        L(we(a, -0.25), 0.9),
        40,
        !0,
      );
      ((h.scale.z = 0.35),
        (h.position.z = -u * 0.62),
        (ue(
          t,
          u * 0.8,
          u * 0.8,
          0.06,
          0,
          0.58,
          u * 0.15,
          L(a, 0.95),
          40,
        ).scale.z = 0.75));
      for (const p of [-1, 1])
        N(t, 0.55, 0.13, 0.3, p * 0.32, 0.58, -u * 0.55, L("#ffffff", 0.95));
      break;
    }
    case "chest": {
      (N(t, i, o - 0.08, s, 0, 0.08, 0, L(a, 0.5)),
        f(0.08, 0.05, 0.015, "#6b5442"));
      const u = Math.max(3, Math.round((o - 0.1) / 0.2));
      for (let h = 0; h < u; h++) {
        const p = 0.1 + ((o - 0.14) * h) / u;
        (N(
          t,
          i - 0.03,
          (o - 0.14) / u - 0.008,
          0.01,
          0,
          p,
          l,
          L(we(a, 0.04), 0.45),
          !1,
        ),
          N(
            t,
            i * 0.3,
            0.012,
            0.02,
            0,
            p + ((o - 0.14) / u) * 0.55,
            l + 0.01,
            L("#9aa1a8", 0.3, 0.8),
            !1,
          ));
      }
      break;
    }
    case "coatRack": {
      const u = L(a, 0.5);
      ue(t, 0.025, 0.025, o, 0, 0, 0, u, 10);
      for (let h = 0; h < 3; h++) {
        const p = (h * Math.PI * 2) / 3,
          d = N(
            t,
            0.4,
            0.025,
            0.025,
            Math.cos(p) * 0.17,
            0.02,
            Math.sin(p) * 0.17,
            u,
          );
        d.rotation.y = -p;
      }
      for (let h = 0; h < 4; h++) {
        const p = (h * Math.PI) / 2;
        N(
          t,
          0.2,
          0.02,
          0.02,
          Math.cos(p) * 0.09,
          o - 0.12,
          Math.sin(p) * 0.09,
          u,
        ).rotation.set(0, -p, 0.5);
      }
      ha(t, 0.035, 0, o, 0, u);
      break;
    }
    case "stool":
      ue(t, i / 2, i / 2, 0.06, 0, o - 0.06, 0, L(a, 0.9), 24);
      for (let u = 0; u < 3; u++) {
        const h = u * 2.09;
        ue(
          t,
          0.015,
          0.02,
          o - 0.06,
          Math.cos(h) * i * 0.3,
          0,
          Math.sin(h) * i * 0.3,
          L("#8a6a4d", 0.6),
          8,
        ).rotation.set(Math.sin(h) * 0.12, 0, -Math.cos(h) * 0.12);
      }
      break;
    case "bayCushion":
      N(t, i, o, s, 0, 0, 0, L(a, 1));
      for (let u = 0; u < 3; u++)
        N(
          t,
          0.45,
          0.14,
          0.14,
          -r + 0.35 + u * 0.5,
          o,
          -l + 0.12,
          L(we(a, u % 2 ? -0.12 : 0.06), 1),
        );
      break;
    case "lDesk": {
      const u = L(a, 0.5),
        h = Math.min(0.6, i * 0.4);
      (N(t, i, 0.035, 0.6, 0, o - 0.035, -l + 0.3, u),
        N(
          t,
          h,
          0.035,
          s - 0.6,
          r - h / 2,
          o - 0.035,
          -l + 0.6 + (s - 0.6) / 2,
          u,
        ),
        N(t, 0.03, o - 0.035, 0.6, -r + 0.015, 0, -l + 0.3, u),
        N(t, h, o - 0.035, 0.03, r - h / 2, 0, l - 0.015, u),
        N(
          t,
          0.4,
          o - 0.035,
          0.55,
          r - h / 2,
          0,
          -l + 0.3,
          L(we(a, -0.08), 0.5),
        ),
        N(
          t,
          0.56,
          0.33,
          0.02,
          -r + 0.5,
          o + 0.12,
          -l + 0.08,
          L("#15171a", 0.3),
        ),
        N(t, 0.06, 0.12, 0.02, -r + 0.5, o, -l + 0.08, "#2a2c30"));
      break;
    }
    case "uSofa": {
      const u = L(we(a, -0.08), 0.95),
        h = L(a, 0.95),
        p = Math.min(0.95, s * 0.48);
      (f(0.1, 0.08, 0.02, "#3a2e25"),
        N(t, i, 0.3, p, 0, 0.1, -l + p / 2, u),
        N(t, i, o - 0.1, 0.22, 0, 0.1, -l + 0.11, u));
      for (const m of [-1, 1])
        (N(t, p, 0.3, s - p, m * (r - p / 2), 0.1, -l + p + (s - p) / 2, u),
          N(t, 0.2, o - 0.1, s, m * (r - 0.1), 0.1, 0, u),
          N(
            t,
            p - 0.24,
            0.14,
            s - p - 0.02,
            m * (r - p / 2 + 0.02),
            0.4,
            -l + p + (s - p) / 2,
            h,
          ));
      const d = 4,
        y = (i - 0.4) / d;
      for (let m = 0; m < d; m++)
        (N(
          t,
          y - 0.02,
          0.14,
          p - 0.26,
          -r + 0.2 + y * (m + 0.5),
          0.4,
          -l + 0.22 + (p - 0.22) / 2,
          h,
        ),
          N(
            t,
            y - 0.03,
            Math.max(0.2, o - 0.6),
            0.14,
            -r + 0.2 + y * (m + 0.5),
            0.54,
            -l + 0.29,
            h,
          ));
      break;
    }
    case "curvedSofa":
    case "bendSofa":
      MD(t, n);
      break;
    case "chaise": {
      const u = L(we(a, -0.08), 0.95),
        h = L(a, 0.95);
      (f(0.1, 0.08, 0.02, "#3a2e25"),
        N(t, i, 0.3, s, 0, 0.1, 0, u),
        N(t, i - 0.1, 0.12, s - 0.1, 0, 0.4, 0, h));
      const p = N(t, 0.5, 0.45, s, -r + 0.25, 0.4, 0, u);
      ((p.rotation.z = 0.5),
        (p.position.x = -r + 0.3),
        N(t, 0.5, 0.16, s * 0.6, -r + 0.45, 0.55, 0, h));
      break;
    }
    case "beanbag": {
      const u = ha(t, Math.min(i, s) / 2, 0, o * 0.45, 0, L(a, 1));
      ((u.scale.y = (o / Math.min(i, s)) * 0.95),
        ha(
          t,
          Math.min(i, s) * 0.32,
          0,
          o * 0.7,
          -s * 0.18,
          L(we(a, -0.06), 1),
        ).scale.set(1.1, 0.7, 0.8));
      break;
    }
    case "ottoman":
      (ue(t, i / 2, (i / 2) * 0.92, o, 0, 0, 0, L(a, 1), 32),
        ue(
          t,
          (i / 2) * 0.96,
          (i / 2) * 0.96,
          0.02,
          0,
          o,
          0,
          L(we(a, 0.08), 1),
          32,
        ));
      break;
    case "roundTable": {
      const u = Math.min(i, s) / 2,
        h = o < 0.5;
      (ue(t, u, u, 0.04, 0, o - 0.04, 0, L(a, 0.4), 48),
        h
          ? ue(
              t,
              u * 0.85,
              u * 0.85,
              o - 0.04,
              0,
              0,
              0,
              L(we(a, -0.2), 0.5),
              32,
            )
          : (ue(t, 0.05, 0.07, o - 0.04, 0, 0, 0, L(we(a, -0.3), 0.4), 16),
            ue(t, u * 0.35, u * 0.4, 0.03, 0, 0, 0, L(we(a, -0.3), 0.4), 32),
            ue(t, u * 0.38, u * 0.38, 0.015, 0, o, 0, L("#d9d4cc", 0.3), 32)));
      break;
    }
    case "ovalTable": {
      const u = s / 2,
        h = i / s,
        p = o < 0.5;
      if (((ue(t, u, u, 0.04, 0, o - 0.04, 0, L(a, 0.4), 48).scale.x = h), p))
        ue(
          t,
          u * 0.85,
          u * 0.85,
          o - 0.04,
          0,
          0,
          0,
          L(we(a, -0.2), 0.5),
          40,
        ).scale.x = h;
      else
        for (const d of [-1, 1]) {
          const y = d * (i / 2 - u * 0.9) * 0.7;
          (ue(t, 0.06, 0.08, o - 0.04, y, 0, 0, L(we(a, -0.3), 0.4), 16),
            ue(t, u * 0.35, u * 0.4, 0.03, y, 0, 0, L(we(a, -0.3), 0.4), 32));
        }
      break;
    }
    case "booth": {
      const u = L(a, 0.9),
        h = L(we(a, -0.2), 0.8);
      (N(t, i, 0.42, s, 0, 0, 0, h),
        N(t, i - 0.04, 0.1, s - 0.14, 0, 0.42, 0.05, u),
        N(t, i, o - 0.45, 0.16, 0, 0.45, -l + 0.08, u));
      const p = Math.max(2, Math.round(i / 0.6));
      for (let d = 1; d < p; d++)
        N(
          t,
          0.006,
          o - 0.5,
          0.01,
          -r + (i * d) / p,
          0.5,
          -l + 0.165,
          "#6d6359",
          !1,
        );
      break;
    }
    case "wineCabinet":
    case "displayCabinet": {
      const u = L(a, 0.5),
        h = L("#c9dbe6", 0.05, 0.1, {
          transparent: !0,
          opacity: 0.3,
          depthWrite: !1,
        });
      (N(t, i, o, 0.02, 0, 0, -l + 0.01, u),
        N(t, 0.03, o, s, -r + 0.015, 0, 0, u),
        N(t, 0.03, o, s, r - 0.015, 0, 0, u),
        N(t, i, 0.08, s, 0, 0, 0, u),
        N(t, i, 0.04, s, 0, o - 0.04, 0, u));
      const p = Math.max(4, Math.round(o / 0.3));
      for (let d = 1; d < p; d++) {
        const y = 0.08 + ((o - 0.12) * d) / p;
        if (
          (N(
            t,
            i - 0.06,
            0.015,
            s - 0.04,
            0,
            y,
            0,
            n.type === "displayCabinet" ? h : u,
          ),
          n.type === "wineCabinet")
        )
          for (let m = -r + 0.09; m < r - 0.05; m += 0.1) {
            const g = ue(
              t,
              0.035,
              0.035,
              s * 0.8,
              m,
              0,
              0,
              L(
                ["#3d1f1a", "#2c3b29", "#5a1f24"][Math.round((m + d) * 7) % 3],
                0.2,
              ),
              10,
            );
            ((g.rotation.x = Math.PI / 2), g.position.set(m, y + 0.05, 0));
          }
        else if (d % 2)
          for (let m = -r + 0.15; m < r - 0.1; m += 0.28)
            ue(
              t,
              0.05,
              0.06,
              0.14 + (d % 3) * 0.04,
              m,
              y + 0.015,
              0,
              L(
                ["#c8b8a0", "#7f9aa8", "#d9c6a8", "#6f8a6a"][
                  (d + Math.round(m * 10)) % 4
                ],
                0.4,
              ),
              14,
            );
      }
      (N(t, i / 2 - 0.01, o - 0.14, 0.012, -i / 4, 0.1, l - 0.006, h, !1),
        N(t, i / 2 - 0.01, o - 0.14, 0.012, i / 4, 0.1, l - 0.006, h, !1),
        N(
          t,
          i - 0.06,
          0.02,
          0.02,
          0,
          o - 0.07,
          l - 0.03,
          L("#fff4dc", 0.3, 0, {
            emissive: "#ffd9a0",
            emissiveIntensity: 0.8,
          }),
          !1,
        ));
      break;
    }
    case "consoleTable":
      (N(t, i, 0.035, s, 0, o - 0.035, 0, L(a, 0.4)),
        N(t, i - 0.1, 0.02, s - 0.06, 0, 0.15, 0, L(a, 0.5)),
        f(o - 0.035, 0.04, 0.015, "#2b2e33"),
        ue(t, 0.07, 0.09, 0.3, -r + 0.25, o, 0, L("#d9cdb8", 0.4), 16),
        ha(t, 0.1, -r + 0.25, o + 0.4, 0, L("#7aa36a", 0.9)));
      break;
    case "rockingChair": {
      const u = L(a, 0.5);
      for (const p of [-1, 1]) {
        const d = new Me(new Zs(s * 0.7, 0.02, 6, 24, 1.1), u);
        (d.rotation.set(0, Math.PI / 2, 0),
          (d.rotation.z = Math.PI + 0.55 - 0.55),
          d.position.set(p * (r - 0.06), s * 0.72, 0),
          (d.rotation.x = 0),
          d.rotateX(Math.PI / 2 + Math.PI - 0.55),
          t.add(d),
          N(t, 0.04, 0.45, 0.04, p * (r - 0.06), 0.1, 0.15, u),
          N(t, 0.04, 0.5, 0.04, p * (r - 0.06), 0.1, -0.2, u));
      }
      N(t, i - 0.1, 0.06, s * 0.5, 0, 0.45, 0.02, L(we(a, 0.2), 0.9));
      const h = N(t, i - 0.1, 0.6, 0.06, 0, 0.5, -0.25, L(we(a, 0.2), 0.9));
      h.rotation.x = -0.25;
      break;
    }
    case "hangingChair": {
      const u = L(a, 0.6),
        h = (Math.min(i, s) / 2) * 0.8;
      (ue(t, h * 0.9, h * 0.9, 0.03, 0, 0, 0, L("#3a3f47", 0.4, 0.5), 24),
        ue(t, 0.02, 0.02, o, -h * 0.6, 0, 0, L("#3a3f47", 0.4, 0.5), 8),
        N(
          t,
          h * 0.7,
          0.03,
          0.03,
          -h * 0.25,
          o - 0.02,
          0,
          L("#3a3f47", 0.4, 0.5),
        ),
        ha(
          t,
          h * 0.55,
          0,
          o * 0.5,
          0,
          L(a, 0.7, 0, {
            side: e0,
          }),
        ).scale.set(1, 1.3, 1),
        ha(t, h * 0.42, 0, o * 0.42, 0.08, L("#f2ede4", 1)).scale.set(
          1,
          0.8,
          1,
        ),
        ue(t, 0.008, 0.008, o * 0.25, 0, o * 0.75, 0, u, 6));
      break;
    }
    case "fireplace": {
      const u = L(a, 0.7);
      (N(t, i, o, s, 0, 0, 0, u),
        N(t, i + 0.08, 0.06, s + 0.06, 0, o - 0.06, 0, L(we(a, -0.06), 0.5)),
        N(t, i * 0.6, o * 0.45, 0.02, 0, o * 0.15, l, L("#141414", 0.6), !1),
        N(
          t,
          i * 0.5,
          o * 0.1,
          0.01,
          0,
          o * 0.17,
          l + 0.005,
          L("#ff9a3c", 0.5, 0, {
            emissive: "#ff7a1a",
            emissiveIntensity: 1.6,
          }),
          !1,
        ));
      break;
    }
    case "fishTank": {
      N(t, i, 0.75, s, 0, 0, 0, L(a, 0.4));
      const u = L("#9fd3e6", 0.05, 0, {
        transparent: !0,
        opacity: 0.45,
        depthWrite: !1,
      });
      (N(t, i - 0.02, o - 0.78, s - 0.02, 0, 0.76, 0, u, !1),
        N(t, i - 0.04, 0.04, s - 0.04, 0, 0.77, 0, L("#d9c9a3", 0.9)),
        N(t, i, 0.04, s, 0, o - 0.04, 0, L(a, 0.4)));
      for (let h = 0; h < 4; h++)
        ue(
          t,
          0.01,
          0.015,
          0.2 + h * 0.05,
          -r + 0.2 + h * 0.25,
          0.81,
          0,
          L("#4f8f4a", 0.8),
          6,
        );
      break;
    }
    case "projScreen":
      (N(t, i + 0.08, 0.08, 0.1, 0, o - 0.08, 0, L("#2b2e33", 0.4)),
        N(t, i, o - 0.08, 0.005, 0, 0, 0, L(a, 0.9)),
        N(t, i, 0.03, 0.015, 0, 0, 0, L("#2b2e33", 0.4)));
      break;
    case "speaker":
      N(t, i, o, s, 0, 0, 0, L(a, 0.5));
      for (const [u, h] of [
        [o * 0.78, i * 0.32],
        [o * 0.45, i * 0.38],
        [o * 0.2, i * 0.38],
      ]) {
        const p = ue(t, h, h, 0.01, 0, 0, l, L("#111", 0.8), 20);
        ((p.rotation.x = Math.PI / 2), p.position.set(0, u, l));
      }
      break;
    case "screenDivider": {
      const u = Math.max(3, Math.round(i / 0.45)),
        h = i / u;
      for (let p = 0; p < u; p++) {
        const d = N(
          t,
          h - 0.01,
          o,
          0.025,
          -r + h * (p + 0.5),
          0,
          p % 2 ? 0.04 : -0.04,
          L(p % 2 ? a : we(a, 0.08), 0.6),
        );
        d.rotation.y = (p % 2 ? 1 : -1) * 0.25;
      }
      break;
    }
    case "hangingPlant":
      OD(t, n, i, o, s, a);
      break;
    case "vase": {
      const u = Math.min(i, s) / 2;
      (ue(t, u * 0.5, u * 0.75, o * 0.35, 0, 0, 0, L(a, 0.4)),
        ue(t, u * 0.2, u * 0.5, o * 0.3, 0, o * 0.35, 0, L(a, 0.4)));
      for (let h = 0; h < 5; h++) {
        const p = h * 1.25;
        (ue(
          t,
          0.006,
          0.006,
          o * 0.5,
          Math.cos(p) * 0.03,
          o * 0.6,
          Math.sin(p) * 0.03,
          L("#6b5a3a", 0.8),
          4,
        ).rotation.set(Math.sin(p) * 0.25, 0, Math.cos(p) * 0.25),
          ha(
            t,
            0.04,
            Math.cos(p) * 0.12,
            o * 1.05,
            Math.sin(p) * 0.12,
            L("#d6c3a0", 1),
          ));
      }
      break;
    }
    case "wallPanel": {
      const u = String(Yt(n, "style", "slat")),
        h = L(we(a, -0.12), 0.7);
      if (u === "slat") {
        N(
          t,
          i,
          o,
          Math.min(0.018, s * 0.3),
          0,
          0,
          -l + Math.min(0.009, s * 0.15),
          h,
        );
        const p = 0.04,
          d = 0.03,
          y = Math.max(1, Math.floor((i + d) / (p + d))),
          m = -(y * (p + d) - d) / 2 + p / 2;
        for (let g = 0; g < y; g++)
          N(t, p, o, s * 0.7, m + g * (p + d), 0, l - s * 0.35, L(a, 0.6));
      } else if (u === "soft") {
        N(t, i, o, 0.02, 0, 0, -l + 0.01, h);
        const p = Math.max(1, Math.round(i / 0.5)),
          d = Math.max(1, Math.round(Math.min(o, 1.4) / 0.5)),
          y = i / p,
          m = Math.min(o, 1.4) / d,
          g = Math.max(0, o - 1.4) * 0.35;
        for (let v = 0; v < p; v++)
          for (let w = 0; w < d; w++) {
            const x = N(
              t,
              y - 0.012,
              m - 0.012,
              s - 0.02,
              -r + y * (v + 0.5),
              g + m * w + 0.006,
              0.01,
              L(a, 0.95),
            );
            x.castShadow = !1;
          }
      } else {
        N(t, i, o, s, 0, 0, 0, L(a, 0.55));
        const p = Math.max(1, Math.round(i / 1.2));
        for (let d = 1; d < p; d++)
          N(t, 0.004, o, 0.002, -r + (i * d) / p, 0, l + 0.001, h, !1);
      }
      break;
    }
    case "wallArt": {
      const u = i > 1.2 ? 3 : 1,
        h = (i - (u - 1) * 0.06) / u,
        p = [a, we(a, 0.3), "#e7dccb"];
      for (let d = 0; d < u; d++) {
        const y = -r + h / 2 + d * (h + 0.06);
        (N(t, h, o, s * 0.6, y, 0, 0, L("#2b2e33", 0.5)),
          N(
            t,
            h - 0.06,
            o - 0.06,
            0.005,
            y,
            0.03,
            s * 0.3,
            L("#f4efe6", 0.9),
            !1,
          ),
          N(
            t,
            h * 0.6,
            o * 0.5,
            0.006,
            y,
            o * 0.25,
            s * 0.3 + 0.003,
            L(p[d % 3], 0.9),
            !1,
          ));
      }
      break;
    }
    case "clock": {
      const u = Math.min(i, o) / 2,
        h = ue(t, u, u, s, 0, 0, 0, L(a, 0.4), 32);
      ((h.rotation.x = Math.PI / 2), h.position.set(0, u, 0));
      const p = ue(t, u * 0.9, u * 0.9, 0.005, 0, 0, 0, L("#f7f5f0", 0.6), 32);
      ((p.rotation.x = Math.PI / 2),
        p.position.set(0, u, s / 2 + 0.003),
        N(t, 0.012, u * 0.6, 0.004, 0, u, s / 2 + 0.007, "#111", !1));
      const d = N(t, 0.01, u * 0.8, 0.004, 0, u, s / 2 + 0.009, "#111", !1);
      ((d.rotation.z = -1.1),
        d.position.set(
          Math.sin(1.1) * u * 0.4,
          u + Math.cos(1.1) * u * 0.4 - u * 0.4,
          s / 2 + 0.009,
        ));
      break;
    }
    case "rugRound": {
      const u = Math.min(i, s) / 2;
      ((ue(t, u, u, o, 0, 0, 0, L(a, 1), 48).castShadow = !1),
        (ue(
          t,
          u * 0.82,
          u * 0.82,
          0.002,
          0,
          o,
          0,
          L(we(a, -0.08), 1),
          48,
        ).castShadow = !1));
      break;
    }
    case "fan": {
      const u = Math.min(i, s) / 2;
      (ue(t, u * 0.8, u * 0.9, 0.04, 0, 0, 0, L(a, 0.4), 24),
        ue(t, 0.015, 0.015, o * 0.75, 0, 0.04, 0, L(a, 0.4), 8));
      const h = ue(
        t,
        u * 0.85,
        u * 0.85,
        0.1,
        0,
        0,
        0,
        L(a, 0.4, 0, {
          transparent: !0,
          opacity: 0.85,
        }),
        24,
      );
      ((h.rotation.x = Math.PI / 2), h.position.set(0, o * 0.82, 0.02));
      break;
    }
    case "radiator": {
      const u = Math.max(4, Math.round(i / 0.08));
      for (let h = 0; h < u; h++)
        N(
          t,
          i / u - 0.012,
          o,
          s,
          -r + (i / u) * (h + 0.5),
          0,
          0,
          L(a, 0.35, 0.3),
        );
      break;
    }
    case "freezer":
      (N(t, i, o, s, 0, 0, 0, L(a, 0.3, 0.2)),
        N(t, i - 0.02, 0.03, s - 0.02, 0, o, 0, L(we(a, -0.06), 0.3)),
        N(
          t,
          i * 0.3,
          0.03,
          0.03,
          0,
          o * 0.85,
          l + 0.01,
          L("#9aa1a8", 0.3, 0.8),
        ));
      break;
    case "bin":
      (ue(
        t,
        Math.min(i, s) / 2,
        (Math.min(i, s) / 2) * 0.9,
        o,
        0,
        0,
        0,
        L(a, 0.3, 0.7),
        20,
      ),
        ue(
          t,
          Math.min(i, s) / 2 + 0.005,
          Math.min(i, s) / 2 + 0.005,
          0.03,
          0,
          o,
          0,
          L(we(a, -0.2), 0.3, 0.7),
          20,
        ));
      break;
    case "squat": {
      N(t, i, 0.02, s, 0, 0, 0, L("#e9ecee", 0.4));
      const u = ue(t, i * 0.38, i * 0.3, 0.03, 0, 0.02, 0.05, L(a, 0.2), 24);
      u.scale.z = s / i;
      break;
    }
    case "pedestalSink":
      ue(t, 0.08, 0.12, 0.78, 0, 0, -l + 0.14, L(a, 0.2), 16);
      {
        const u = ue(t, i / 2, i * 0.35, 0.14, 0, 0.74, 0, L(a, 0.2), 28);
        u.scale.z = s / i;
      }
      ue(t, 0.012, 0.012, 0.18, 0, 0.88, -l + 0.05, L("#c7ccd2", 0.2, 0.9));
      break;
    case "freeTub": {
      const u = ue(t, s / 2, (s / 2) * 0.9, o, 0, 0, 0, L(a, 0.15), 36);
      u.scale.x = i / s;
      const h = ue(
        t,
        s / 2 - 0.05,
        s / 2 - 0.05,
        0.01,
        0,
        o - 0.1,
        0,
        L("#bfe0ee", 0.05, 0, {
          transparent: !0,
          opacity: 0.85,
        }),
        36,
      );
      ((h.scale.x = (i / s) * 0.96),
        ue(t, 0.015, 0.015, 0.9, r + 0.1, 0, 0, L("#c7ccd2", 0.2, 0.9)));
      break;
    }
    case "shelfRack": {
      const u = L(a, 0.3, 0.8);
      for (const h of [-1, 1])
        for (const p of [-1, 1])
          ue(t, 0.01, 0.01, o, h * (r - 0.01), 0, p * (l - 0.01), u, 6);
      for (let h = 0; h < 4; h++)
        N(t, i, 0.01, s, 0, 0.2 + (h * (o - 0.25)) / 3, 0, u);
      for (let h = 0; h < 3; h++)
        N(
          t,
          0.12,
          0.2,
          0.1,
          -r + 0.12 + h * 0.18,
          0.21 + ((h % 2) * (o - 0.25)) / 3,
          0,
          L(["#e6dccb", "#9fb4c2", "#d9b98e"][h], 0.8),
        );
      break;
    }
    case "car": {
      const u = L(a, 0.25, 0.55),
        h = L("#1f2730", 0.1, 0.3),
        p = L("#1b1d21", 0.85),
        d = L("#c7ccd2", 0.25, 0.8),
        y = Math.max(0.5, o * 0.42),
        m = o - y - 0.14;
      (N(t, i, y, s - 0.1, 0, 0.2, 0, u),
        N(t, i - 0.06, 0.06, s * 0.32, 0, 0.2 + y, s * 0.3, u),
        N(t, i - 0.14, m, s * 0.5, 0, 0.2 + y, -s * 0.06, h),
        N(t, i - 0.2, 0.05, s * 0.44, 0, 0.2 + y + m, -s * 0.07, u));
      for (const g of [-1, 1])
        for (const v of [-1, 1]) {
          const x = new Me(new Hn(0.34, 0.34, 0.24, 24), p);
          ((x.rotation.z = Math.PI / 2),
            x.position.set(g * (r - 0.14), 0.34, v * (l - 0.85)),
            (x.castShadow = !0),
            t.add(x));
          const b = new Me(new Hn(0.34 * 0.6, 0.34 * 0.6, 0.25, 18), d);
          ((b.rotation.z = Math.PI / 2), b.position.copy(x.position), t.add(b));
        }
      for (const g of [-1, 1])
        (N(
          t,
          0.32,
          0.09,
          0.03,
          g * (r - 0.3),
          0.2 + y - 0.2,
          l - 0.05,
          L("#fff", 0.2, 0, {
            emissive: "#fff6dc",
            emissiveIntensity: 0.6,
          }),
          !1,
        ),
          N(
            t,
            0.3,
            0.08,
            0.03,
            g * (r - 0.3),
            0.2 + y - 0.18,
            -l + 0.05,
            L("#a01818", 0.3, 0, {
              emissive: "#ff2a2a",
              emissiveIntensity: 0.4,
            }),
            !1,
          ));
      break;
    }
    case "evCharger": {
      const u = L(a, 0.35);
      (N(t, i, o, s, 0, 0, 0, u),
        N(
          t,
          i * 0.6,
          0.05,
          0.01,
          0,
          o * 0.62,
          l,
          L("#111", 0.2, 0, {
            emissive: "#3bd97a",
            emissiveIntensity: 0.8,
          }),
          !1,
        ));
      const h = new Me(new Zs(0.12, 0.015, 8, 24), L("#1b1d21", 0.6));
      (h.position.set(0, -0.15, l + 0.03), t.add(h));
      break;
    }
    case "carport": {
      const u = L(a, 0.4, 0.6),
        h = L("#dfe9ef", 0.2, 0, {
          transparent: !0,
          opacity: 0.55,
          depthWrite: !1,
          side: e0,
        }),
        p = r - 0.1,
        d = l - 0.2;
      for (const m of [-1, 1])
        for (const g of [-1, 1]) N(t, 0.1, o - 0.1, 0.1, m * p, 0, g * d, u);
      if (i > 4.5)
        for (const m of [-1, 1]) N(t, 0.1, o - 0.1, 0.1, 0, 0, m * d, u);
      for (const m of [-1, 1]) N(t, 0.1, 0.14, s, m * p, o - 0.2, 0, u);
      for (let m = -l; m <= l + 0.01; m += s / 4)
        N(
          t,
          i,
          0.08,
          0.06,
          0,
          o - 0.1,
          Math.max(-l + 0.03, Math.min(l - 0.03, m)),
          u,
        );
      const y = new Me(new ot(i + 0.1, 0.015, s + 0.1), h);
      (y.position.set(0, o - 0.01, 0), (y.rotation.x = 0.035), t.add(y));
      break;
    }
    case "garageShelf": {
      const u = L(a, 0.4, 0.6),
        h = 4;
      for (const d of [-1, 1])
        for (const y of [-1, 1])
          N(t, 0.04, o, 0.04, d * (r - 0.02), 0, y * (l - 0.02), u);
      const p = ["#c9b28c", "#8fa58a", "#b8c3cf", "#d8c7ae"];
      for (let d = 0; d < h; d++) {
        const y = 0.15 + (d * (o - 0.25)) / (h - 1);
        if ((N(t, i, 0.03, s, 0, y, 0, u), d < h - 1))
          for (let m = -r + 0.25, g = 0; m < r - 0.2; m += 0.5, g++)
            N(
              t,
              0.4,
              0.3,
              s * 0.8,
              m + 0.05,
              y + 0.03,
              0,
              L(p[(g + d) % 4], 0.9),
            );
      }
      break;
    }
    case "workbench": {
      const u = L(a, 0.7),
        h = L("#3b3f46", 0.4, 0.6);
      N(t, i, 0.05, s, 0, 0.85, 0, u);
      for (const p of [-1, 1])
        for (const d of [-1, 1])
          N(t, 0.05, 0.85, 0.05, p * (r - 0.05), 0, d * (l - 0.05), h);
      (N(t, i - 0.1, 0.03, s - 0.1, 0, 0.2, 0, u),
        N(t, i, o - 0.95, 0.02, 0, 0.95, -l + 0.01, L("#d9cdb8", 0.9)));
      for (let p = 0; p < 6; p++)
        N(
          t,
          0.05,
          0.2 + (p % 3) * 0.06,
          0.03,
          -r + 0.3 + (p * (i - 0.6)) / 5,
          1.25 + (p % 2) * 0.25,
          -l + 0.04,
          L(["#c8442b", "#3b3f46", "#e8a700"][p % 3], 0.4, 0.4),
        );
      break;
    }
    case "bicycle": {
      const u = L(a, 0.3, 0.5),
        h = L("#1b1d21", 0.8),
        p = 0.33;
      for (const x of [-1, 1]) {
        const b = new Me(new Zs(p, 0.025, 8, 28), h);
        ((b.rotation.y = Math.PI / 2),
          b.position.set(0, p, x * (l - p - 0.03)),
          (b.castShadow = !0),
          t.add(b));
      }
      const d = (x, b, M = 0.018) => {
          const T = x.distanceTo(b),
            k = new Me(new Hn(M, M, T, 8), u);
          (k.position.copy(x).add(b).multiplyScalar(0.5),
            k.lookAt(b),
            k.rotateX(Math.PI / 2),
            t.add(k));
        },
        y = new H(0, p, -l + p + 0.03),
        m = new H(0, p, l - p - 0.03),
        g = new H(0, 0.85, -0.15),
        v = new H(0, 0.95, l - 0.45),
        w = new H(0, 0.32, 0);
      (d(y, g),
        d(g, v),
        d(g, w),
        d(w, v),
        d(w, y),
        d(v, m),
        N(t, 0.14, 0.04, 0.25, 0, 0.86, -0.17, L("#1b1d21", 0.7)),
        N(t, 0.5, 0.025, 0.025, 0, 0.97, l - 0.45, u));
      break;
    }
    case "pool": {
      const u = L("#e6e1d6", 0.8),
        h = L(a, 0.05, 0.1, {
          transparent: !0,
          opacity: 0.82,
        }),
        p = 0.3;
      (N(t, i, o, p, 0, 0, -l + p / 2, u),
        N(t, i, o, p, 0, 0, l - p / 2, u),
        N(t, p, o, s - p * 2, -r + p / 2, 0, 0, u),
        N(t, p, o, s - p * 2, r - p / 2, 0, 0, u),
        N(t, i - p * 2, 0.01, s - p * 2, 0, 0, 0, L("#2e7fa3", 0.6), !1));
      const d = new Me(new ot(i - p * 2, 0.01, s - p * 2), h);
      (d.position.set(0, o * 0.6, 0), t.add(d));
      for (let y = 0; y < 3; y++)
        N(
          t,
          0.5,
          0.04,
          0.04,
          -r + p + 0.4,
          o - 0.02,
          -l + p + 0.15 + y * 0.25,
          L("#c7ccd2", 0.2, 0.8),
          !1,
        );
      break;
    }
    case "lawn":
      N(t, i, Math.max(0.01, o), s, 0, 0, 0, L(a, 1), !1);
      break;
    case "stepStones": {
      const u = L(a, 0.9),
        h = Math.max(2, Math.round(s / 0.6));
      for (let p = 0; p < h; p++)
        N(
          t,
          i * (0.8 + (p % 2) * 0.1),
          o,
          (s / h) * 0.7,
          (p % 2 ? 0.05 : -0.05) * i,
          0,
          -l + (s / h) * (p + 0.5),
          u,
        );
      break;
    }
    case "tree": {
      const u = L("#6b5442", 0.9),
        h = Math.min(i, s) / 2;
      ue(t, 0.09, 0.14, o * 0.45, 0, 0, 0, u, 10);
      const p = [a, we(a, 0.12), we(a, -0.12)];
      for (let d = 0; d < 5; d++) {
        const y = d * 1.256,
          m = h * (d ? 0.55 : 0.75),
          g = new Me(new Ru(m, 1), L(p[d % 3], 0.95));
        (g.position.set(
          d ? Math.cos(y) * h * 0.4 : 0,
          o * (d ? 0.62 : 0.72),
          d ? Math.sin(y) * h * 0.4 : 0,
        ),
          (g.castShadow = !0),
          (g.receiveShadow = !0),
          t.add(g));
      }
      break;
    }
    case "shrub": {
      const u = new Me(new Ru(Math.min(i, s) / 2, 1), L(a, 0.95));
      ((u.scale.y = o / Math.min(i, s)),
        (u.position.y = o / 2),
        (u.castShadow = !0),
        t.add(u));
      break;
    }
    case "gazebo": {
      const u = L(a, 0.7),
        h = L("#4a4f57", 0.8),
        p = r - 0.12,
        d = l - 0.12;
      N(t, i, 0.12, s, 0, 0, 0, L("#cfc8bb", 0.9));
      for (const m of [-1, 1])
        for (const g of [-1, 1])
          ue(t, 0.07, 0.07, o * 0.72, m * p, 0.12, g * d, u, 12);
      for (const m of [-1, 1]) N(t, 0.1, 0.14, s - 0.2, m * p, o * 0.72, 0, u);
      for (const m of [-1, 1]) N(t, i - 0.2, 0.14, 0.1, 0, o * 0.72, m * d, u);
      const y = new Me(new Cc(Math.hypot(r, l) + 0.15, o * 0.28, 4, 1), h);
      ((y.rotation.y = Math.PI / 4),
        (y.position.y = o * 0.72 + 0.14 + o * 0.14),
        (y.castShadow = !0),
        t.add(y));
      for (const m of [-1, 1])
        N(t, i - 0.5, 0.05, 0.4, 0, 0.45, m * (l - 0.45), u);
      break;
    }
    case "parasol": {
      const u = L("#e9e4dc", 0.6);
      (ue(t, 0.45, 0.45, 0.03, 0, 0.72, 0, u, 24),
        ue(t, 0.03, 0.03, 0.72, 0, 0, 0, L("#2b2e33", 0.4), 8));
      for (let p = 0; p < 4; p++) {
        const d = (p * Math.PI) / 2 + 0.3;
        N(
          t,
          0.45,
          0.45,
          0.45,
          Math.cos(d) * 0.85,
          0,
          Math.sin(d) * 0.85,
          L("#d6cfc2", 0.8),
        );
      }
      ue(t, 0.025, 0.025, o - 0.2, 0, 0, 0, L("#cfc9be", 0.6), 8);
      const h = ue(
        t,
        0.05,
        Math.min(i, s) / 2,
        0.35,
        0,
        o - 0.45,
        0,
        L(a, 0.9, 0, {
          side: e0,
        }),
        8,
        !0,
      );
      h.castShadow = !0;
      break;
    }
    case "sunLounger": {
      const u = L(a, 0.8),
        h = L("#8a6a4d", 0.7);
      N(t, i, 0.08, s * 0.65, 0, 0.28, l - s * 0.325, u);
      const p = N(t, i, 0.08, s * 0.38, 0, 0.3, -l + s * 0.2, u);
      ((p.rotation.x = -0.6), (p.position.y = 0.5));
      for (const d of [-1, 1])
        N(t, 0.05, 0.28, s * 0.95, d * (r - 0.03), 0, 0, h);
      break;
    }
    case "swing": {
      const u = L(a, 0.7),
        h = L("#cfc2a8", 0.9);
      for (const p of [-1, 1])
        for (const d of [-1, 1]) {
          const y = N(
            t,
            0.08,
            o,
            0.08,
            p * (r - 0.1),
            0,
            d * (l - 0.15) * 0.5,
            u,
          );
          ((y.rotation.x = d * 0.25), (y.position.z = d * (l - 0.15) * 0.3));
        }
      N(t, i, 0.1, 0.1, 0, o - 0.05, 0, u);
      for (const p of [-1, 1])
        N(t, 0.02, o - 0.55, 0.02, p * 0.45, 0.5, 0, h, !1);
      (N(t, 1.1, 0.05, 0.45, 0, 0.45, 0, u),
        N(t, 1.1, 0.45, 0.05, 0, 0.5, -0.22, u));
      break;
    }
    case "bbq": {
      const u = L(a, 0.3, 0.7),
        h = L("#e6e1d6", 0.7);
      (N(t, i, o - 0.05, s, 0, 0, 0, L("#b9b2a6", 0.8)),
        N(t, i + 0.04, 0.05, s + 0.04, 0, o - 0.05, 0, h),
        N(t, i * 0.4, 0.03, s * 0.7, -i * 0.15, o, 0, L("#1b1d21", 0.6, 0.4)),
        N(t, i * 0.4, 0.25, 0.04, -i * 0.15, o, -l + 0.1, u),
        N(
          t,
          i * 0.25,
          0.02,
          s * 0.55,
          i * 0.28,
          o - 0.01,
          0,
          L("#c7ccd2", 0.2, 0.8),
        ));
      break;
    }
    case "waterFeature": {
      const u = L(a, 0.9),
        h = L("#7fc4de", 0.05, 0.1, {
          transparent: !0,
          opacity: 0.75,
        });
      (N(t, i, o, 0.25, 0, 0, -l + 0.125, u),
        N(t, i, 0.35, s - 0.25, 0, 0, 0.125, u),
        N(t, i - 0.1, 0.01, s - 0.35, 0, 0.33, 0.125, h, !1),
        N(t, i * 0.6, o - 0.4, 0.01, 0, 0.38, -l + 0.255, h, !1));
      break;
    }
    case "fence": {
      const u = L(a, 0.8),
        h = Math.max(3, Math.round(i / 0.14));
      for (const p of [0.15, o - 0.2]) N(t, i, 0.06, s * 0.6, 0, p, 0, u);
      for (let p = 0; p < h; p++)
        N(t, (i / h) * 0.65, o, s, -r + (i / h) * (p + 0.5), 0, 0, u);
      break;
    }
    case "gate": {
      const u = L(a, 0.4, 0.6),
        h = Math.max(6, Math.round(i / 0.12));
      for (const p of [-1, 1])
        N(t, 0.2, o + 0.3, 0.2, p * (r - 0.1), 0, 0, L("#cfc8bb", 0.8));
      for (const p of [0.12, o - 0.1, o * 0.5])
        N(t, i - 0.4, 0.05, 0.05, 0, p, 0, u);
      for (let p = 0; p < h; p++)
        N(
          t,
          0.025,
          o - 0.1,
          0.025,
          -r + 0.2 + ((i - 0.4) / h) * (p + 0.5),
          0.05,
          0,
          u,
        );
      break;
    }
    case "lawnLamp": {
      const u = !!j0.get(n.id),
        h = Math.min(i, s) / 2;
      (ue(t, h * 0.7, h * 0.8, 0.05, 0, 0, 0, L(a, 0.4, 0.5)),
        ue(t, 0.03, 0.03, o * 0.7, 0, 0.05, 0, L(a, 0.4, 0.5), 10));
      const p = ue(
        t,
        h * 0.6,
        h * 0.6,
        o * 0.22,
        0,
        o * 0.72,
        0,
        L("#f6efe0", 0.8, 0, {
          emissive: "#ffd59a",
          emissiveIntensity: u ? 1.6 : 0,
          side: e0,
        }),
      );
      ((p.castShadow = !1),
        (p.userData.interactive = "lamp"),
        ue(t, h * 0.75, h * 0.75, 0.03, 0, o - 0.03, 0, L(a, 0.4, 0.5)),
        _9(t, p, T9(t, u, o * 0.8, 3.5), u));
      break;
    }
    case "billiards": {
      const u = L(a === "#2f6b45" ? "#5a3b26" : we(a, -0.4), 0.5),
        h = L(a, 1);
      (N(t, i, 0.2, s, 0, o - 0.2, 0, u),
        N(t, i - 0.24, 0.01, s - 0.24, 0, o, 0, h, !1));
      for (const p of [-1, 1])
        for (const d of [-1, 1])
          N(t, 0.14, o - 0.2, 0.14, p * (r - 0.2), 0, d * (l - 0.3), u);
      for (const p of [-1, 1])
        for (const d of [-1, 0, 1]) {
          const y = ue(
            t,
            0.05,
            0.05,
            0.02,
            p * (r - 0.12),
            o - 0.005,
            d * (l - 0.12),
            L("#111", 0.9),
            12,
          );
          y.castShadow = !1;
        }
      break;
    }
    case "mahjong": {
      const u = L(a, 0.5);
      (N(t, i, 0.12, s, 0, o - 0.12, 0, u),
        N(t, i - 0.16, 0.01, s - 0.16, 0, o, 0, L("#2f6b45", 1), !1),
        N(t, i * 0.5, o - 0.12, s * 0.5, 0, 0, 0, u));
      for (let h = 0; h < 4; h++) {
        const p = (h * Math.PI) / 2,
          d = new ht();
        (d.position.set(Math.sin(p) * (r + 0.3), 0, Math.cos(p) * (l + 0.3)),
          (d.rotation.y = p + Math.PI),
          t.add(d),
          N(d, 0.45, 0.45, 0.45, 0, 0, 0, L("#5d636e", 0.8)),
          N(d, 0.45, 0.45, 0.06, 0, 0.45, -0.2, L("#5d636e", 0.8)));
      }
      break;
    }
    case "teaTable": {
      const u = L(a, 0.5);
      (N(t, i, 0.08, s, 0, o - 0.08, 0, u),
        N(t, i - 0.1, o - 0.08, s * 0.5, 0, 0, -s * 0.2, u),
        N(t, i * 0.3, 0.03, s * 0.5, -i * 0.2, o, 0, L("#2b2e33", 0.5)),
        ue(t, 0.07, 0.08, 0.12, i * 0.25, o, 0, L("#c7ccd2", 0.2, 0.8), 16));
      for (let h = 0; h < 3; h++)
        ue(
          t,
          0.025,
          0.02,
          0.04,
          i * 0.02 + h * 0.08,
          o,
          0.1,
          L("#f6f6f2", 0.3),
          10,
        );
      for (const h of [-1, 0, 1])
        N(t, 0.45, 0.45, 0.45, h * i * 0.32, 0, l + 0.35, L(we(a, 0.15), 0.7));
      break;
    }
    case "theaterSofa": {
      const u = L(a, 0.9),
        h = 3,
        p = i / h;
      for (let d = 0; d < h; d++) {
        const y = -r + p * (d + 0.5);
        (N(t, p - 0.16, 0.45, s - 0.25, y, 0, 0.05, u),
          N(t, p - 0.16, o - 0.2, 0.25, y, 0.2, -l + 0.125, u),
          N(t, p - 0.2, 0.15, 0.55, y, 0.25, l + 0.2, L(we(a, 0.1), 0.9)));
      }
      for (let d = 0; d <= h; d++)
        N(
          t,
          0.14,
          0.65,
          s - 0.1,
          -r + p * d + (d === 0 ? 0.07 : d === h ? -0.07 : 0),
          0,
          0,
          L(we(a, -0.15), 0.9),
        );
      break;
    }
    case "grandPiano": {
      const u = L(a, 0.12, 0.1),
        h = new Is(),
        p = i,
        d = s;
      (h.moveTo(-p / 2, -d / 2),
        h.lineTo(p / 2, -d / 2),
        h.lineTo(p / 2, d * 0.05),
        h.bezierCurveTo(p / 2, d * 0.35, p * 0.1, d * 0.2, 0, d / 2),
        h.bezierCurveTo(-p * 0.3, d * 0.55, -p / 2, d * 0.4, -p / 2, d * 0.2),
        h.closePath());
      const y = new to(h, {
        depth: 0.3,
        bevelEnabled: !1,
      });
      (y.rotateX(Math.PI / 2), y.translate(0, o - 0.05, 0));
      const m = new Me(y, u);
      ((m.castShadow = !0), t.add(m));
      for (const [v, w] of [
        [-r + 0.15, -l + 0.15],
        [r - 0.15, -l + 0.15],
        [0, l - 0.3],
      ])
        ue(t, 0.05, 0.04, o - 0.35, v, 0, w, u, 10);
      (N(t, i - 0.1, 0.03, 0.2, 0, o - 0.37, -l - 0.05, L("#f6f6f2", 0.3)),
        N(t, i - 0.1, 0.02, 0.1, 0, o - 0.345, -l - 0.1, L("#111", 0.3)));
      const g = new Me(new Nd(h), u);
      ((g.rotation.x = -Math.PI / 2 - 0.45),
        g.position.set(0, o + 0.02, -l * 0.2),
        t.add(g));
      break;
    }
    case "barCounter": {
      const u = L(a, 0.4),
        h = L("#e8e3da", 0.25);
      (N(t, i, o - 0.04, s, 0, 0, 0, u),
        N(t, i + 0.05, 0.04, s + 0.3, 0, o - 0.04, 0.15, h),
        N(t, 0.45, 0.01, 0.35, i * 0.2, o, 0, L("#c7ccd2", 0.2, 0.8), !1),
        ue(
          t,
          0.012,
          0.012,
          0.25,
          i * 0.2,
          o,
          -0.12,
          L("#c7ccd2", 0.2, 0.8),
          8,
        ));
      for (let p = 0; p < 3; p++) {
        const d = -r + 0.45 + (p * (i - 0.9)) / 2;
        (ue(t, 0.19, 0.19, 0.05, d, 0.72, l + 0.5, L("#3b3f46", 0.6), 18),
          ue(t, 0.03, 0.03, 0.72, d, 0, l + 0.5, L("#9aa1a8", 0.3, 0.8), 8));
      }
      break;
    }
    case "sauna": {
      const u = L(a, 0.8),
        h = Es();
      (N(t, i, o, 0.05, 0, 0, -l + 0.025, u),
        N(t, 0.05, o, s - 0.1, -r + 0.025, 0, 0, u),
        N(t, 0.05, o, s - 0.1, r - 0.025, 0, 0, u),
        N(t, i, 0.05, s, 0, o - 0.05, 0, u),
        N(t, i * 0.55, o - 0.1, 0.02, -i * 0.2, 0, l - 0.01, h, !1),
        N(t, i * 0.45, o - 0.1, 0.05, i * 0.27, 0, l - 0.025, u));
      for (const [p, d] of [
        [0.45, -l + 0.3],
        [0.9, -l + 0.55],
      ])
        N(t, i - 0.1, 0.05, 0.4, 0, p, d, L(we(a, 0.1), 0.8));
      N(t, 0.4, 0.45, 0.3, r - 0.3, 0, l - 0.35, L("#3b3f46", 0.5, 0.3));
      break;
    }
    case "chandelier": {
      const u = L("#c9a35a", 0.25, 0.9),
        h = L("#f4f7fb", 0.05, 0, {
          transparent: !0,
          opacity: 0.75,
          emissive: "#fff4dc",
          emissiveIntensity: 0.35,
        });
      ue(t, 0.02, 0.02, o * 0.35, 0, o * 0.65, 0, u, 8);
      for (let p = 0; p < 3; p++) {
        const d = (Math.min(i, s) / 2) * (1 - p * 0.25),
          y = o * (0.45 - p * 0.17),
          m = new Me(new Zs(d, 0.015, 8, 40), u);
        ((m.rotation.x = Math.PI / 2), (m.position.y = y), t.add(m));
        const g = Math.round(d * 30);
        for (let v = 0; v < g; v++) {
          const w = (v / g) * Math.PI * 2,
            x = new Me(new lp(0.035), h);
          (x.position.set(Math.cos(w) * d, y - 0.08, Math.sin(w) * d),
            (x.scale.y = 2.2),
            t.add(x));
        }
      }
      break;
    }
    case "riser": {
      const u = Math.min(i, s) / 2;
      ue(t, u, u, o, 0, 0, 0, L(a, 0.45, 0.1), 20);
      for (let h = 0.5; h < o; h += 1)
        ue(t, u * 1.12, u * 1.12, 0.03, 0, h, 0, L("#7d848c", 0.5), 20);
      break;
    }
    case "acOutdoor": {
      N(t, i, o, s, 0, 0, 0, L(a, 0.45));
      const u = ue(
        t,
        Math.min(o, i) * 0.36,
        Math.min(o, i) * 0.36,
        0.01,
        0,
        0,
        0,
        L("#3a3f47", 0.6),
        28,
      );
      ((u.rotation.x = Math.PI / 2),
        u.position.set(-i * 0.12, o / 2, l + 0.006));
      for (let h = 0; h < 6; h++)
        N(
          t,
          i * 0.3,
          0.01,
          0.01,
          i * 0.28,
          o * (0.15 + h * 0.13),
          l + 0.006,
          L("#9aa1a8", 0.5),
          !1,
        );
      break;
    }
    case "louver": {
      const u = L(a, 0.45, 0.3),
        h = Math.max(3, Math.round(o / 0.08));
      for (let p = 0; p < h; p++) {
        const d = N(t, i - 0.06, 0.012, s * 1.6, 0, (p * o) / h, 0, u);
        d.rotation.x = 0.6;
      }
      for (const p of [-1, 1]) N(t, 0.03, o, s, p * (r - 0.015), 0, 0, u);
      break;
    }
    case "meterBox":
      (N(t, i, o, s, 0, 0, 0, L(a, 0.4, 0.3)),
        N(
          t,
          i * 0.4,
          o * 0.2,
          0.005,
          -i * 0.15,
          o * 0.65,
          l + 0.003,
          L("#2b2e33", 0.2),
          !1,
        ),
        N(
          t,
          0.02,
          0.06,
          0.01,
          r - 0.05,
          o * 0.5,
          l + 0.006,
          L("#555", 0.3),
          !1,
        ));
      break;
    case "cornerShelf": {
      const u = String(Yt(n, "corner", "left")) !== "right",
        h = Math.max(2, Math.round(+Yt(n, "shelves", 5))),
        p = L(a, 0.5),
        d = u
          ? [
              [-r, -l],
              [r, -l],
              [-r, l],
            ]
          : [
              [-r, -l],
              [r, -l],
              [r, l],
            ],
        y = new Is(d.map(([m, g]) => new pe(m, -g)));
      for (let m = 0; m <= h; m++) {
        const g = new to(y, {
          depth: 0.02,
          bevelEnabled: !1,
        });
        g.rotateX(-Math.PI / 2);
        const v = new Me(g, p);
        ((v.position.y = Math.min(o - 0.02, (m * o) / h)),
          (v.castShadow = v.receiveShadow = !0),
          t.add(v));
      }
      (N(t, i, o, 0.018, 0, 0, -l + 0.009, p),
        N(t, 0.018, o, s - 0.02, u ? -r + 0.009 : r - 0.009, 0, 0.01, p));
      break;
    }
    case "modularSofa": {
      const u = Math.max(1, Math.round(+Yt(n, "n", 3))),
        h = i / u,
        p = L(a, 0.95),
        d = Math.min(0.44, o * 0.58);
      for (let y = 0; y < u; y++) {
        const m = -r + h * (y + 0.5);
        (N(t, h - 0.01, d, s, m, 0, 0, p),
          N(t, h - 0.02, o - d, s * 0.24, m, d, -l + s * 0.12, p));
      }
      Yt(n, "ottoman", !1) &&
        N(t, h - 0.02, d, h * 0.7, 0, 0, l + 0.12 + h * 0.35, p);
      break;
    }
    case "bayDeck":
      (N(t, i, o - 0.02, s, 0, 0, 0, L(a, 0.35)),
        N(t, i, 0.02, s + 0.02, 0, o - 0.02, 0.01, L("#f4f1ec", 0.25)));
      break;
    case "plushToy": {
      const u = L(a, 1),
        h = Math.min(i, s) / 2,
        p = new Me(new ds(h * 0.85, 18, 14), u);
      (p.position.set(0, h * 0.85, 0), t.add(p));
      const d = new Me(new ds(h * 0.6, 18, 14), u);
      (d.position.set(0, h * 2.1, 0), t.add(d));
      for (const y of [-1, 1]) {
        const m = new Me(new ds(h * 0.22, 10, 8), u);
        (m.position.set(y * h * 0.45, h * 2.6, 0), t.add(m));
      }
      break;
    }
    case "tableVase": {
      const u = Math.min(i, s) / 2;
      (ue(t, u * 0.55, u * 0.8, o * 0.75, 0, 0, 0, L(a, 0.2), 20),
        ue(t, u * 0.3, u * 0.55, o * 0.1, 0, o * 0.75, 0, L(a, 0.2), 20));
      for (let h = 0; h < 3; h++)
        ue(
          t,
          0.004,
          0.004,
          o * 0.5,
          (h - 1) * 0.02,
          o * 0.8,
          0,
          L("#5f7f4f", 0.8),
          6,
        );
      break;
    }
    case "bookSet": {
      const u = Math.max(3, Math.round(i / 0.04));
      for (let h = 0; h < u; h++)
        N(
          t,
          i / u - 0.003,
          o * (0.75 + ((h * 37) % 5) * 0.05),
          s,
          -r + ((h + 0.5) * i) / u,
          0,
          0,
          L(h % 3 ? a : we(a, 0.3), 0.8),
        );
      break;
    }
    case "boiler": {
      (N(t, i, o, s, 0, 0, 0, L(a, 0.35)),
        N(
          t,
          i * 0.55,
          0.08,
          0.01,
          0,
          o * 0.62,
          l,
          L("#111", 0.2, 0, {
            emissive: "#3bc3ff",
            emissiveIntensity: 0.5,
          }),
          !1,
        ));
      for (let u = 0; u < 4; u++)
        ue(
          t,
          0.012,
          0.012,
          0.25,
          -i * 0.3 + u * i * 0.2,
          -0.25,
          0,
          L(u === 0 ? "#e8a700" : u % 2 ? "#e03131" : "#3b82f6", 0.3, 0.7),
          8,
        );
      break;
    }
    case "manifold": {
      const u = L(a, 0.25, 0.9);
      for (const p of [o * 0.25, o * 0.7]) {
        const d = ue(t, 0.025, 0.025, i, 0, 0, 0, u, 10);
        ((d.rotation.z = Math.PI / 2), d.position.set(0, p, 0));
      }
      const h = Math.max(3, Math.round(i / 0.1));
      for (let p = 0; p < h; p++) {
        const d = -r + 0.08 + ((i - 0.16) * p) / (h - 1);
        (ue(
          t,
          0.01,
          0.01,
          o * 0.2,
          d,
          0,
          0,
          L(p % 2 ? "#e03131" : "#3b82f6", 0.4),
          6,
        ),
          ue(t, 0.018, 0.018, 0.05, d, o * 0.82, 0, L("#e03131", 0.5), 8));
      }
      break;
    }
    case "waterSoftener": {
      const u = Math.min(i, s) / 2;
      (ue(t, u * 0.55, u * 0.55, o, -i * 0.15, 0, 0, L("#2f6fed", 0.4), 20),
        N(t, i * 0.55, o * 0.7, s * 0.8, i * 0.2, 0, 0, L(a, 0.4)),
        ue(t, u * 0.5, u * 0.5, 0.12, -i * 0.15, o, 0, L("#3b3f46", 0.4), 18));
      break;
    }
    case "outdoorSet": {
      (ue(t, 0.4, 0.4, 0.03, 0, 0.72, 0, L(a, 0.5), 24),
        ue(t, 0.03, 0.03, 0.72, 0, 0, 0, L("#2b2e33", 0.4), 8));
      for (const p of [0, Math.PI]) {
        const d = new ht();
        (d.position.set(Math.cos(p) * 0.7, 0, Math.sin(p) * 0.7),
          (d.rotation.y = -p - Math.PI / 2),
          t.add(d),
          N(d, 0.5, 0.04, 0.5, 0, 0.42, 0, L(a, 0.6)),
          N(d, 0.5, 0.45, 0.04, 0, 0.46, -0.23, L(a, 0.6)));
        for (const y of [-1, 1])
          for (const m of [-1, 1])
            ue(
              d,
              0.012,
              0.012,
              0.42,
              y * 0.22,
              0,
              m * 0.22,
              L("#2b2e33", 0.4),
              6,
            );
      }
      ue(t, 0.025, 0.025, 1.6, 0, 0.72, 0, L("#cfc9be", 0.6), 8);
      const h = ue(
        t,
        0.05,
        1.1,
        0.3,
        0,
        2.1,
        0,
        L("#efe8dc", 0.9, 0, {
          side: e0,
        }),
        24,
        !0,
      );
      h.castShadow = !0;
      break;
    }
    case "plantShelf": {
      const u = L(a, 0.6);
      for (let h = 0; h < 3; h++) {
        const p = 0.3 + h * 0.4;
        N(t, i - h * 0.2, 0.03, s * 0.7, 0, p, (h - 1) * 0.05, u);
        for (let d = -r + 0.15 + h * 0.1; d < r - 0.1 - h * 0.1; d += 0.3) {
          const y = new ht();
          (y.position.set(d, p + 0.03, 0),
            t.add(y),
            L7(
              y,
              {
                ...n,
                key: "smallPlant",
                x: n.x + d * 1e3,
                y: n.y + h * 37,
              },
              0.24,
              0.3,
              0.24,
              h % 2 ? "#6f9a5f" : "#4f7f45",
            ));
        }
      }
      for (const h of [-1, 1]) N(t, 0.03, o, s * 0.7, h * (r - 0.015), 0, 0, u);
      break;
    }
    case "bike": {
      const u = L(a, 0.4, 0.3);
      (N(t, 0.5, 0.05, 0.1, 0, 0, l - 0.08, u),
        N(t, 0.5, 0.05, 0.1, 0, 0, -l + 0.08, u));
      const h = N(t, 0.06, 0.06, s * 0.8, 0, 0.35, 0, u);
      h.rotation.x = 0.35;
      const p = ue(t, 0.22, 0.22, 0.05, 0, 0, 0, L("#555", 0.3, 0.8), 24);
      ((p.rotation.z = Math.PI / 2),
        p.position.set(0, 0.3, l - 0.25),
        N(t, 0.25, 0.05, 0.3, 0, 0.95, -l + 0.3, L("#1b1d21", 0.8)),
        N(t, 0.45, 0.03, 0.05, 0, 1.15, l - 0.2, u),
        N(t, 0.05, 0.5, 0.05, 0, 0.65, l - 0.2, u));
      break;
    }
    case "yogaMat":
      N(t, i, 0.006, s, 0, 0, 0, L(a, 1), !1);
      {
        const u = ue(t, 0.05, 0.05, i, 0, 0, 0, L(a, 1), 12);
        ((u.rotation.z = Math.PI / 2), u.position.set(0, 0.05, -l));
      }
      break;
    case "catTree": {
      const u = L(a, 0.9),
        h = L("#c9b28c", 1);
      (N(t, i, 0.04, s, 0, 0, 0, u),
        ue(t, 0.05, 0.05, o, -i * 0.2, 0, -s * 0.2, h, 10),
        ue(t, 0.05, 0.05, o * 0.65, i * 0.22, 0, s * 0.2, h, 10),
        N(t, 0.45, 0.04, 0.4, -i * 0.15, o * 0.45, -s * 0.1, u),
        N(t, 0.4, 0.04, 0.35, i * 0.15, o * 0.65, s * 0.15, u),
        N(t, 0.45, 0.25, 0.35, -i * 0.2, o - 0.25, -s * 0.2, u));
      break;
    }
    case "petBed": {
      const u = Math.min(i, s) / 2,
        h = ue(t, u, u, o, 0, 0, 0, L(a, 1), 28);
      h.scale.x = i / s;
      const p = ue(
        t,
        u * 0.75,
        u * 0.75,
        0.02,
        0,
        o * 0.5,
        0,
        L(we(a, 0.3), 1),
        28,
      );
      p.scale.x = i / s;
      break;
    }
    case "cabinet":
      n.cab ? TD(t, n) : N(t, i, o, s, 0, 0, 0, L(a));
      break;
    case "counter":
    case "lCounter":
    case "uCounter":
      SD(t, n);
      break;
    case "vanity":
      AD(t, n);
      break;
    case "shower":
      ED(t, n);
      break;
    case "kitchenIsland":
      kD(t, n);
      break;
    case "model": {
      const u = n.modelId ? DC(n.modelId) : null,
        h = n.modelId ? fv(n.modelId) : void 0;
      u && h
        ? (u.scale.set(n.w / h.w, n.h / h.h, n.d / h.d), t.add(u))
        : N(
            t,
            i,
            o,
            s,
            0,
            0,
            0,
            L("#cfd4da", 0.8, 0, {
              transparent: !0,
              opacity: 0.5,
            }),
            !1,
          );
      break;
    }
    case "elevator": {
      const u = L("#c9ced4", 0.25, 0.85),
        h = L("#2b2e33", 0.5, 0.4),
        p = Math.min(i - 0.04, 0.9),
        d = 2.1,
        y = l - 0.02;
      for (const m of [-1, 1])
        N(t, 0.06, d + 0.08, 0.1, m * (p / 2 + 0.03), 0, y, u);
      N(t, p + 0.18, 0.08, 0.1, 0, d, y, u);
      for (const m of [-1, 1]) {
        const g = N(t, p / 2, d, 0.03, (m * p) / 4, 0, y + 0.02, u);
        ((g.userData.elevDoor = m),
          (g.userData.baseX = (m * p) / 4),
          (g.userData.slide = p / 2 - 0.02));
      }
      (N(t, 0.2, 0.06, 0.01, 0, d + 0.14, y + 0.05, h),
        N(t, 0.08, 0.16, 0.015, p / 2 + 0.17, 1.05, y + 0.06, u),
        (ue(
          t,
          0.018,
          0.018,
          0.01,
          p / 2 + 0.17,
          1.13,
          y + 0.07,
          L("#ffd27a", 0.3, 0, {
            emissive: "#ffb340",
            emissiveIntensity: 0.8,
          }),
          12,
        ).rotation.x = Math.PI / 2));
      break;
    }
    case "stairU":
    case "stairRun":
    case "stairDogleg": {
      if (n.type === "stairDogleg") {
        const v = bv(n);
        ue(
          t,
          Math.max(0.04, (v.gap / 2e3) * 0.6),
          Math.max(0.04, (v.gap / 2e3) * 0.6),
          o + 0.9,
          v.pv.x / 1e3,
          0,
          v.pv.y / 1e3,
          L("#3a3f47", 0.4, 0.6),
          16,
        );
      }
      const { steps: u, landings: h } = qa(n),
        p = L(a, 0.55),
        d = L("#ece9e3", 0.8),
        y = L("#3a3f47", 0.4, 0.6),
        m = L("#cfe2ee", 0.05, 0.1, {
          transparent: !0,
          opacity: 0.25,
          depthWrite: !1,
          side: e0,
        });
      for (const v of u) {
        const w = Math.min(0.24, v.top / 1e3);
        if (v.poly) {
          const x = new Is(v.poly.map((T) => new pe(T.x / 1e3, T.y / 1e3))),
            b = new to(x, {
              depth: w,
              bevelEnabled: !1,
            });
          b.rotateX(Math.PI / 2);
          const M = new Me(b, p);
          ((M.position.y = v.top / 1e3),
            (M.castShadow = M.receiveShadow = !0),
            t.add(M));
          continue;
        }
        (N(
          t,
          (v.x1 - v.x0) / 1e3,
          w,
          (v.y1 - v.y0) / 1e3,
          (v.x0 + v.x1) / 2e3,
          v.top / 1e3 - w,
          (v.y0 + v.y1) / 2e3,
          p,
        ),
          N(
            t,
            (v.x1 - v.x0) / 1e3 - 0.002,
            0.012,
            0.012,
            (v.x0 + v.x1) / 2e3,
            v.top / 1e3 - 0.012,
            v.y1 / 1e3 - 0.006,
            d,
            !1,
          ));
      }
      for (const v of h) {
        const w = Math.min(0.18, Math.max(0.02, v.top / 1e3));
        N(
          t,
          (v.x1 - v.x0) / 1e3,
          w,
          (v.y1 - v.y0) / 1e3,
          (v.x0 + v.x1) / 2e3,
          v.top / 1e3 - w,
          (v.y0 + v.y1) / 2e3,
          p,
        );
      }
      const g = [...qa(n).rails, ...(e ? Sp(n, e) : [])];
      for (const v of g)
        for (let w = 0; w + 1 < v.length; w++) {
          const x = v[w],
            b = v[w + 1],
            M = x.x / 1e3,
            T = x.y / 1e3,
            k = b.x / 1e3,
            S = b.y / 1e3,
            E = x.z / 1e3,
            _ = b.z / 1e3,
            A = Math.hypot(k - M, S - T, _ - E);
          if (A < 0.05) continue;
          const P = new Me(new Hn(0.022, 0.022, A, 10), y);
          ((P.castShadow = !0),
            P.position.set((M + k) / 2, (E + _) / 2 + 0.9, (T + S) / 2),
            P.lookAt(k, _ + 0.9, S),
            P.rotateX(Math.PI / 2),
            t.add(P));
          const D = new Bt();
          (D.setAttribute(
            "position",
            new vt(
              [
                M,
                E + 0.05,
                T,
                k,
                _ + 0.05,
                S,
                k,
                _ + 0.86,
                S,
                M,
                E + 0.05,
                T,
                k,
                _ + 0.86,
                S,
                M,
                E + 0.86,
                T,
              ],
              3,
            ),
          ),
            D.computeVertexNormals(),
            t.add(new Me(D, m)));
          const O = Math.max(1, Math.round(Math.hypot(k - M, S - T) / 1.1));
          for (let I = 0; I <= O; I++) {
            const B = I / O;
            ue(
              t,
              0.015,
              0.015,
              0.9,
              M + (k - M) * B,
              E + (_ - E) * B,
              T + (S - T) * B,
              y,
              8,
            );
          }
        }
      break;
    }
    default:
      N(t, i, o, s, 0, 0, 0, L(a));
  }
  return (D7(t), t.traverse((u) => (u.userData.fid = n.id)), t);
}
export function D7(n, e = 0.003) {
  const t = [];
  for (const o of n.children) {
    const a = o;
    !a.isMesh ||
      !a.userData.bx ||
      a.rotation.x ||
      a.rotation.y ||
      a.rotation.z ||
      (a.updateMatrix(),
      a.geometry.computeBoundingBox(),
      t.push({
        m: a,
        b: a.geometry.boundingBox.clone().applyMatrix4(a.matrix),
      }));
  }
  const i = ["x", "y", "z"],
    s = 2e-4;
  for (let o = 0; o < t.length; o++)
    for (let a = o + 1; a < t.length; a++) {
      const r = t[o],
        l = t[a];
      for (let c = 0; c < 3; c++)
        for (const f of ["min", "max"]) {
          const u = r.b[f][i[c]],
            h = l.b[f][i[c]];
          if (Math.abs(u - h) > s) continue;
          const p = [0, 1, 2].filter((x) => x !== c),
            d = p.map(
              (x) =>
                Math.min(r.b.max[i[x]], l.b.max[i[x]]) -
                Math.max(r.b.min[i[x]], l.b.min[i[x]]),
            );
          if (d[0] <= s || d[1] <= s) continue;
          const y = (x) =>
              p.reduce((b, M) => b * (x.b.max[i[M]] - x.b.min[i[M]]), 1),
            m = y(r) <= y(l) ? r : l,
            g = m.b.max[i[c]] - m.b.min[i[c]];
          if (g <= e * 2) continue;
          const v = (g - e) / g,
            w = f === "max" ? -1 : 1;
          ((m.m.scale[i[c]] *= v),
            (m.m.position[i[c]] += (w * e) / 2),
            (m.b[f][i[c]] += w * e));
        }
    }
}
export let M1 = null;
export function ID() {
  if (M1) return M1;
  const n = document.createElement("canvas");
  ((n.width = 64), (n.height = 128));
  const e = n.getContext("2d"),
    t = e.createLinearGradient(0, 0, 64, 0);
  (t.addColorStop(0, "#cfcfcf"),
    t.addColorStop(0.5, "#ffffff"),
    t.addColorStop(1, "#cfcfcf"),
    (e.fillStyle = t),
    e.fillRect(0, 0, 64, 128),
    (e.strokeStyle = "rgba(255,255,255,.95)"),
    (e.lineWidth = 2.5),
    e.beginPath(),
    e.moveTo(32, 128),
    e.lineTo(32, 4),
    e.stroke(),
    (e.strokeStyle = "rgba(150,150,150,.55)"),
    (e.lineWidth = 1.2));
  for (let i = 112; i > 12; i -= 14)
    (e.beginPath(),
      e.moveTo(32, i),
      e.quadraticCurveTo(46, i - 10, 62, i - 22),
      e.moveTo(32, i),
      e.quadraticCurveTo(18, i - 10, 2, i - 22),
      e.stroke());
  return ((M1 = new gs(n)), (M1.colorSpace = Et), M1);
}
export const A9 = new Map();
export function ND(n) {
  if (A9.has(n)) return A9.get(n);
  const e = n === "broad" ? 0.42 : n === "round" ? 0.5 : 0.16,
    t = new Is();
  (t.moveTo(0, 0),
    t.bezierCurveTo(e * 0.9, 0.12, e, 0.55, 0, 1),
    t.bezierCurveTo(-e, 0.55, -e * 0.9, 0.12, 0, 0));
  const i = new Nd(t, 8),
    s = i.getAttribute("position"),
    o = i.getAttribute("uv");
  for (let a = 0; a < s.count; a++) {
    const r = s.getX(a),
      l = s.getY(a);
    (o.setXY(a, r / (2 * e) + 0.5, l),
      s.setZ(a, -l * l * 0.28 - Math.abs(r) * 0.25));
  }
  return (i.computeVertexNormals(), (i.userData.shared = !0), A9.set(n, i), i);
}
export function Fv(n) {
  return L(n, 0.7, 0, {
    map: ID(),
    side: e0,
  });
}
export function nh(n, e, t, i, s, o, a, r, l, c = 0) {
  const f = new Me(ND(e), t);
  return (
    f.scale.setScalar(a),
    f.position.set(i, s, o),
    (f.rotation.order = "YXZ"),
    f.rotation.set(-Math.PI / 2 + l, r, c),
    (f.castShadow = !0),
    (f.receiveShadow = !0),
    n.add(f),
    f
  );
}
export function ih(n, e, t, i = "#d8d2c7") {
  (ue(n, e, e * 0.78, t, 0, 0, 0, L(i, 0.55), 24),
    ue(n, e * 1.04, e * 1.04, 0.02, 0, t - 0.02, 0, L(we(i, -0.06), 0.5), 24),
    ue(n, e * 0.92, e * 0.92, 0.01, 0, t - 0.03, 0, L("#4a3a2c", 1), 20));
}
export function L7(n, e, t, i, s, o) {
  const a = Math.min(t, s) / 2,
    r = on(Math.round(e.x * 7 + e.y * 3) + 11),
    c = [o, we(o, 0.12), we(o, -0.1)].map(Fv);
  if (e.key === "smallPlant" || i < 0.7) {
    const h = Math.min(0.22, i * 0.4);
    ih(n, a * 0.8, h, "#e8e2d8");
    for (let p = 0; p < 3; p++)
      for (let d = 0; d < 7 + p * 2; d++) {
        const y = (d / (7 + p * 2)) * Math.PI * 2 + p * 0.4,
          m = (i - h) * (0.75 - p * 0.18);
        nh(n, "round", c[p % 3], 0, h, 0, m, y, 0.35 + p * 0.35);
      }
    return;
  }
  if (e.key === "bigPlant" || t >= 0.7) {
    const h = i * 0.2;
    ih(n, a * 0.55, h, "#3f3a35");
    for (let p = 0; p < 11; p++) {
      const d = (p / 11) * Math.PI * 2 + r() * 0.4,
        y = a * (0.35 + r() * 0.45),
        m = h + (i - h) * (0.45 + r() * 0.5),
        g = Math.cos(d) * y,
        v = Math.sin(d) * y,
        w = new Me(new Hn(0.008, 0.012, 1, 6), L(we(o, -0.25), 0.8)),
        x = g,
        b = v,
        M = m - h,
        T = Math.hypot(x, M, b);
      ((w.scale.y = T),
        w.position.set(x / 2, h + M / 2, b / 2),
        w.quaternion.setFromUnitVectors(
          new H(0, 1, 0),
          new H(x, M, b).normalize(),
        ),
        n.add(w),
        nh(
          n,
          "broad",
          c[p % 3],
          g,
          m,
          v,
          a * (0.85 + r() * 0.4),
          -d + Math.PI / 2,
          0.25 + r() * 0.5,
          (r() - 0.5) * 0.5,
        ));
    }
    return;
  }
  const f = i * 0.22;
  (ih(n, a * 0.6, f),
    ue(n, 0.012, 0.02, i * 0.55, 0, f, 0, L("#6b5240", 0.8), 8));
  const u = Math.round(14 + i * 10);
  for (let h = 0; h < u; h++) {
    const p = h / u,
      d = f + (i - f) * (0.35 + p * 0.62),
      y = h * 2.4,
      m = a * (0.15 + (1 - p) * 0.55) * (0.7 + r() * 0.5);
    nh(
      n,
      "broad",
      c[h % 3],
      Math.cos(y) * m * 0.4,
      d,
      Math.sin(y) * m * 0.4,
      a * (0.55 + r() * 0.3),
      -y + Math.PI / 2,
      0.35 + p * 0.7 + r() * 0.2,
      (r() - 0.5) * 0.6,
    );
  }
}
export function OD(n, e, t, i, s, o) {
  const a = Math.min(t, s) / 2,
    r = on(Math.round(e.x + e.y) + 5),
    l = [o, we(o, 0.15), we(o, -0.1)].map(Fv);
  ue(n, 0.003, 0.003, i * 0.45, 0, i * 0.55, 0, L("#555", 0.5), 4);
  const c = i * 0.35,
    f = new ht();
  ((f.position.y = c), n.add(f), ih(f, a * 0.45, a * 0.5, "#e8e2d8"));
  for (let u = 0; u < 8; u++) {
    const h = (u / 8) * Math.PI * 2 + r() * 0.3,
      p = i * (0.55 + r() * 0.4);
    for (let d = 0; d < 9; d++) {
      const y = d / 9,
        m = a * (0.45 + y * 0.25),
        g = c + a * 0.5 - y * p;
      nh(
        n,
        "long",
        l[(u + d) % 3],
        Math.cos(h) * m,
        g,
        Math.sin(h) * m,
        0.09 + r() * 0.04,
        -h + Math.PI / 2 + (r() - 0.5),
        -0.6 - r() * 0.5,
        r() - 0.5,
      );
    }
  }
}
