/** Derived from ZWD11/house-plan-designer@b94183f9 (MIT, Copyright 2026 ZWD11).
 * Scope-aware extraction: scripts/extract-upstream.mjs. See reference/upstream/LICENSE.
 * Three.js core is an npm dependency; inherited modelling helpers retain their original behaviour. */
import { Q0, Ut } from "./catalog.js";
export const qe = Math.PI / 180;
export const xe = (n, e) => Math.hypot(n.x - e.x, n.y - e.y);
export function F0(n, e, t) {
  const i = t.x - e.x,
    s = t.y - e.y,
    o = Math.hypot(i, s) || 1,
    a = i / o,
    r = s / o,
    l = (n.x - e.x) * a + (n.y - e.y) * r,
    c = Math.abs((n.x - e.x) * -r + (n.y - e.y) * a);
  return {
    t: l / o,
    along: l,
    d: c,
    len: o,
    foot: {
      x: e.x + a * l,
      y: e.y + r * l,
    },
  };
}
export function Ls(n, e) {
  let t = !1;
  for (let i = 0, s = e.length - 1; i < e.length; s = i++) {
    const o = e[i],
      a = e[s];
    o.y > n.y != a.y > n.y &&
      n.x < ((a.x - o.x) * (n.y - o.y)) / (a.y - o.y) + o.x &&
      (t = !t);
  }
  return t;
}
export const o1 = (n) => n.status !== "removed";
export function Te(n, e, t = 0) {
  return {
    x: n.a.x + n.u.x * e + n.n.x * t,
    y: n.a.y + n.u.y * e + n.n.y * t,
  };
}
export function Wc(n) {
  const e = new Map(n.nodes.map((b) => [b.id, b])),
    t = new Map(),
    i = [],
    s = new Map();
  for (const b of n.openings) {
    const M = s.get(b.wall) || [];
    (M.push(b), s.set(b.wall, M));
  }
  const o = new Map(),
    a = new Map(),
    r = new Map();
  for (const b of n.walls) {
    const M = e.get(b.a),
      T = e.get(b.b);
    if (!M || !T) continue;
    const k = Math.hypot(T.x - M.x, T.y - M.y);
    if (k < 1) continue;
    const S = {
      x: (T.x - M.x) / k,
      y: (T.y - M.y) / k,
    };
    r.set(b, {
      u: S,
      n: {
        x: -S.y,
        y: S.x,
      },
    });
  }
  for (const b of n.walls) {
    if (!o1(b)) continue;
    for (const S of [b.a, b.b]) {
      const E = o.get(S) || [];
      (E.push(b.t / 2), o.set(S, E));
    }
    const M = r.get(b);
    if (!M) continue;
    const { u: T, n: k } = M;
    for (const [S, E] of [
      [b.a, T],
      [
        b.b,
        {
          x: -T.x,
          y: -T.y,
        },
      ],
    ]) {
      const _ = a.get(S) || [];
      (_.push({
        w: b,
        d: E,
        ht: b.t / 2,
        n: k,
        off: 0,
      }),
        a.set(S, _));
    }
  }
  const l = new Map();
  for (const [b, M] of r) {
    if (!o1(b)) continue;
    const T = [];
    for (const [k, S] of [
      [b.a, M.u],
      [
        b.b,
        {
          x: -M.u.x,
          y: -M.u.y,
        },
      ],
    ])
      for (const E of a.get(k) || [])
        E.w !== b && S.x * E.d.x + S.y * E.d.y < -0.999 && T.push(E);
    T.length && l.set(b, T);
  }
  const c = new Map(),
    f = (b) => c.get(b) || 0;
  for (let b = 0; b < 12; b++) {
    let M = !1;
    for (const [T, k] of l) {
      const S = r.get(T),
        E = (P) => (P.n.x * S.n.x + P.n.y * S.n.y >= 0 ? 1 : -1),
        _ = k.filter((P) => P.w.t > T.t).sort((P, D) => D.w.t - P.w.t)[0];
      let A = 0;
      if (T.align && _) {
        const P = E(_) * f(_.w),
          D = T.t / 2;
        A = T.align > 0 ? P + _.ht - D : P - _.ht + D;
      } else
        for (const P of k)
          if (P.w.t === T.t && f(P.w)) {
            A = E(P) * f(P.w);
            break;
          }
      Math.abs(A - f(T)) > 0.01 && (c.set(T, A), (M = !0));
    }
    if (!M) break;
  }
  for (const b of a.values()) for (const M of b) M.off = f(M.w);
  const u = (b, M, T) => {
      const k = b.x * M.n.x + b.y * M.n.y >= 0 ? 1 : -1;
      return {
        far: Math.max(0, (M.ht - M.off * k) / T),
        near: Math.max(0, (M.ht + M.off * k) / T),
      };
    },
    h = (b, M, T, k) => {
      let S = 0,
        E = 0;
      for (const _ of a.get(M) || []) {
        if (_.w === b) continue;
        E++;
        const A = T.x * _.d.x + T.y * _.d.y,
          P = Math.sqrt(Math.max(0, 1 - A * A));
        P < 0.05 || (S = Math.max(S, Math.min(u(T, _, P).far, k * 4 + _.ht)));
      }
      return {
        e: S,
        free: E === 0,
      };
    },
    p = (b) => {
      const M = e.get(b.a),
        T = e.get(b.b);
      return (
        b.t * 1e7 +
        (M && T ? Math.hypot(T.x - M.x, T.y - M.y) : 0) +
        (b.id < "m" ? 0.1 : 0)
      );
    },
    d = (b, M, T, k) => {
      const S = a.get(M) || [];
      if (S.length < 2) return 0;
      const E = (I) => I.reduce((B, z) => (p(z.w) > p(B.w) ? z : B)),
        _ = (I) =>
          S.filter((B) => B === I || B.d.x * I.d.x + B.d.y * I.d.y < -0.999);
      let A = E(S),
        P = _(A);
      if (
        P.length > 1 &&
        P.some((I) => Math.abs(I.ht - A.ht) > 0.5 || I.off || A.off)
      ) {
        const I = S.filter((B) => !P.includes(B));
        I.length && ((A = E(I)), (P = _(A)));
      }
      const D = (I) => {
        const B = T.x * I.d.x + T.y * I.d.y;
        return Math.sqrt(Math.max(0, 1 - B * B));
      };
      if (P.some((I) => I.w === b)) {
        if (P.length > 1) return 0.6;
        let I = 0;
        for (const B of S) {
          if (B.w === b) continue;
          const z = D(B);
          z >= 0.05 &&
            (I = Math.max(I, Math.min(u(T, B, z).far, k * 4 + B.ht)));
        }
        return I;
      }
      let O = 0;
      for (const I of P) {
        const B = D(I);
        B >= 0.05 && (O = Math.max(O, Math.min(u(T, I, B).near, k * 4 + I.ht)));
      }
      return O ? -O + 0.5 : 0;
    };
  for (const b of n.walls) {
    const M = e.get(b.a),
      T = e.get(b.b);
    if (!M || !T) continue;
    const k = T.x - M.x,
      S = T.y - M.y,
      E = Math.hypot(k, S);
    if (E < 1) continue;
    const _ = {
        x: k / E,
        y: S / E,
      },
      A = {
        x: -_.y,
        y: _.x,
      },
      P = b.t / 2,
      D = (s.get(b.id) || [])
        .map((U) => ({
          o: U,
          s0: U.pos - U.width / 2,
          s1: U.pos + U.width / 2,
        }))
        .sort((U, q) => U.s0 - q.s0),
      O = o1(b),
      I = O
        ? h(b, b.a, _, P)
        : {
            e: P,
            free: !1,
          },
      B = O
        ? h(
            b,
            b.b,
            {
              x: -_.x,
              y: -_.y,
            },
            P,
          )
        : {
            e: P,
            free: !1,
          },
      z = [];
    let V = -I.e;
    for (const U of D)
      (U.s0 > V + 1 &&
        z.push({
          s0: V,
          s1: U.s0,
        }),
        (V = Math.max(V, U.s1)));
    E + B.e > V + 1 &&
      z.push({
        s0: V,
        s1: E + B.e,
      });
    const W = (U) => {
        const q = [...(o.get(U) || [])];
        if (o1(b)) {
          const Q = q.indexOf(P);
          Q >= 0 && q.splice(Q, 1);
        }
        return q.length ? Math.max(...q) : 0;
      },
      K = f(b),
      C = K
        ? {
            x: M.x + A.x * K,
            y: M.y + A.y * K,
          }
        : M,
      F = K
        ? {
            x: T.x + A.x * K,
            y: T.y + A.y * K,
          }
        : T,
      G = {
        w: b,
        a: C,
        b: F,
        off: K,
        len: E,
        u: _,
        n: A,
        ht: P,
        ops: D,
        solids: z,
        endA: W(b.a),
        endB: W(b.b),
        extA: I.e,
        extB: B.e,
        freeA: I.free,
        freeB: B.free,
        e3A: O ? d(b, b.a, _, P) : P,
        e3B: O
          ? d(
              b,
              b.b,
              {
                x: -_.x,
                y: -_.y,
              },
              P,
            )
          : P,
      };
    (t.set(b.id, G), i.push(G));
  }
  const y = i.filter((b) => o1(b.w)),
    m = tM(y);
  let g = 1 / 0,
    v = 1 / 0,
    w = -1 / 0,
    x = -1 / 0;
  for (const b of y)
    for (const [M, T] of [
      [Te(b, -b.extA), 0],
      [Te(b, b.len + b.extB), 0],
    ]) {
      const k = Math.abs(b.n.x) * b.ht + T,
        S = Math.abs(b.n.y) * b.ht + T;
      ((g = Math.min(g, M.x - k)),
        (v = Math.min(v, M.y - S)),
        (w = Math.max(w, M.x + k)),
        (x = Math.max(x, M.y + S)));
    }
  return (
    isFinite(g) || ((g = 0), (v = 0), (w = 1e4), (x = 8e3)),
    {
      nodes: e,
      walls: t,
      all: i,
      active: y,
      bounds: {
        x: g,
        y: v,
        w: w - g,
        h: x - v,
        x1: w,
        y1: x,
      },
      miters: m,
    }
  );
}
export function tM(n) {
  const e = new Map();
  for (const o of n)
    for (const a of ["a", "b"]) {
      const r = a === "a" ? o.w.a : o.w.b,
        l = e.get(r) || [];
      (l.push({
        g: o,
        end: a,
      }),
        e.set(r, l));
    }
  const t = [],
    i = (o, a) => o.x * a.y - o.y * a.x,
    s = (o, a, r, l) => {
      const c = i(a, l);
      return Math.abs(c) < 1e-9
        ? null
        : i(
            {
              x: r.x - o.x,
              y: r.y - o.y,
            },
            l,
          ) / c;
    };
  for (const o of e.values()) {
    if (o.length !== 2) continue;
    const [a, r] = o.map(({ g: S, end: E }) => {
        const _ = E === "a" ? S.a : Te(S, S.len),
          A =
            E === "a"
              ? S.u
              : {
                  x: -S.u.x,
                  y: -S.u.y,
                };
        return {
          g: S,
          end: E,
          base: _,
          d: A,
        };
      }),
      l = a.d.x * r.d.x + a.d.y * r.d.y;
    if (Math.abs(l) < 0.035 || Math.abs(l) > 0.995) continue;
    const c = (S, E) => {
        const _ = S.g.n.x * E.d.x + S.g.n.y * E.d.y > 0 ? 1 : -1;
        return {
          inn: {
            x: S.base.x + S.g.n.x * S.g.ht * _,
            y: S.base.y + S.g.n.y * S.g.ht * _,
          },
          out: {
            x: S.base.x - S.g.n.x * S.g.ht * _,
            y: S.base.y - S.g.n.y * S.g.ht * _,
          },
        };
      },
      f = c(a, r),
      u = c(r, a),
      h = s(f.inn, a.d, u.inn, r.d),
      p = s(u.inn, r.d, f.inn, a.d),
      d = s(f.out, a.d, u.out, r.d),
      y = s(u.out, r.d, f.out, a.d);
    if (h === null || p === null || d === null || y === null) continue;
    const m = Math.max(h, d),
      g = Math.max(p, y),
      v = (S, E) => E > -S.g.ht * 6 && E < S.g.len * 0.45;
    if (!v(a, m) || !v(r, g)) continue;
    const w = {
        x: f.inn.x + a.d.x * h,
        y: f.inn.y + a.d.y * h,
      },
      x = {
        x: f.out.x + a.d.x * d,
        y: f.out.y + a.d.y * d,
      },
      b = {
        x: f.out.x + a.d.x * m,
        y: f.out.y + a.d.y * m,
      },
      M = {
        x: u.out.x + r.d.x * g,
        y: u.out.y + r.d.y * g,
      },
      T = {
        x: f.inn.x + a.d.x * m,
        y: f.inn.y + a.d.y * m,
      },
      k = {
        x: u.inn.x + r.d.x * g,
        y: u.inn.y + r.d.y * g,
      };
    for (const [S, E] of [
      [a, m],
      [r, g],
    ])
      S.end === "a" ? (S.g.mA = E) : (S.g.mB = S.g.len - E);
    t.push({
      poly: [T, b, x, M, k, w],
      edges: [
        [b, x],
        [x, M],
        [T, w],
        [w, k],
      ],
      gs: [a.g, r.g],
    });
  }
  return t;
}
export function q1(n, e, t, i = 0) {
  const s = n.ht + i;
  return [Te(n, e, -s), Te(n, t, -s), Te(n, t, s), Te(n, e, s)];
}
export const Gt = 20;
export function D4(n, e) {
  const t = e.bounds,
    i = 600,
    s = Math.floor((t.x - i) / Gt) * Gt,
    o = Math.floor((t.y - i) / Gt) * Gt,
    a = Math.ceil((t.w + i * 2) / Gt) + 2,
    r = Math.ceil((t.h + i * 2) / Gt) + 2,
    l = new Int32Array(a * r),
    c = (x, b, M, T, k, S, E) => {
      const _ = -T,
        A = M,
        P = [
          [k, -E],
          [S, -E],
          [S, E],
          [k, E],
        ].map(([z, V]) => ({
          x: x + M * z + _ * V,
          y: b + T * z + A * V,
        })),
        D = Math.max(
          0,
          Math.floor((Math.min(...P.map((z) => z.x)) - s) / Gt) - 1,
        ),
        O = Math.min(
          a - 1,
          Math.ceil((Math.max(...P.map((z) => z.x)) - s) / Gt) + 1,
        ),
        I = Math.max(
          0,
          Math.floor((Math.min(...P.map((z) => z.y)) - o) / Gt) - 1,
        ),
        B = Math.min(
          r - 1,
          Math.ceil((Math.max(...P.map((z) => z.y)) - o) / Gt) + 1,
        );
      for (let z = I; z <= B; z++)
        for (let V = D; V <= O; V++) {
          const W = s + (V + 0.5) * Gt - x,
            K = o + (z + 0.5) * Gt - b,
            C = W * M + K * T,
            F = W * _ + K * A;
          C >= k - 1 &&
            C <= S + 1 &&
            Math.abs(F) <= E + 1 &&
            (l[z * a + V] = -1);
        }
    };
  for (const x of e.active)
    c(
      x.a.x,
      x.a.y,
      x.u.x,
      x.u.y,
      x.mA ?? -x.extA,
      x.mB ?? x.len + x.extB,
      x.ht,
    );
  for (const x of e.miters || []) {
    const b = x.poly.map((_) => _.x),
      M = x.poly.map((_) => _.y),
      T = Math.max(0, Math.floor((Math.min(...b) - s) / Gt) - 1),
      k = Math.min(a - 1, Math.ceil((Math.max(...b) - s) / Gt) + 1),
      S = Math.max(0, Math.floor((Math.min(...M) - o) / Gt) - 1),
      E = Math.min(r - 1, Math.ceil((Math.max(...M) - o) / Gt) + 1);
    for (let _ = S; _ <= E; _++)
      for (let A = T; A <= k; A++)
        Ls(
          {
            x: s + (A + 0.5) * Gt,
            y: o + (_ + 0.5) * Gt,
          },
          x.poly,
        ) && (l[_ * a + A] = -1);
  }
  for (const x of n.structs) {
    if (!Q0[x.kind].solid) continue;
    const b = x.rot * qe;
    c(x.x, x.y, Math.cos(b), Math.sin(b), -x.w / 2, x.w / 2, x.d / 2);
  }
  const f = new Int32Array(a * r);
  let u = 0;
  const h = (x) => {
    l[x] === 0 && ((l[x] = -2), (f[u++] = x));
  };
  for (let x = 0; x < a; x++) (h(x), h((r - 1) * a + x));
  for (let x = 0; x < r; x++) (h(x * a), h(x * a + a - 1));
  for (; u;) {
    const x = f[--u],
      b = x % a;
    (b > 0 && h(x - 1),
      b < a - 1 && h(x + 1),
      x >= a && h(x - a),
      x < a * (r - 1) && h(x + a));
  }
  const p = [];
  for (let x = 0; x < l.length; x++) {
    if (l[x] !== 0) continue;
    const b = p.length + 1;
    let M = 0;
    for (u = 0, l[x] = b, f[u++] = x; u;) {
      const T = f[--u],
        k = T % a;
      M++;
      const S = [k > 0 ? T - 1 : -1, k < a - 1 ? T + 1 : -1, T - a, T + a];
      for (const E of S)
        E >= 0 && E < l.length && l[E] === 0 && ((l[E] = b), (f[u++] = E));
    }
    p.push({
      idx: b,
      count: M,
      area: (M * Gt * Gt) / 1e6,
      rects: [],
      bb: {
        x: 0,
        y: 0,
        w: 0,
        h: 0,
      },
      interior: {
        x: 0,
        y: 0,
      },
      labels: [],
      key: null,
    });
  }
  let d = new Map();
  const y = p.map(() => []);
  for (let x = 0; x < r; x++) {
    const b = new Map();
    let M = 0;
    for (; M < a;) {
      const T = l[x * a + M];
      if (T > 0) {
        let k = M;
        for (; k + 1 < a && l[x * a + k + 1] === T;) k++;
        const S = T + ":" + M + ":" + k;
        let E = d.get(S);
        (E
          ? (E.j1 = x + 1)
          : ((E = {
              i0: M,
              i1: k + 1,
              j0: x,
              j1: x + 1,
            }),
            y[T - 1].push(E)),
          b.set(S, E),
          (M = k + 1));
      } else M++;
    }
    d = b;
  }
  const m = [],
    g = [];
  for (const x of e.active) {
    const b = Te(x, x.mA ?? -x.extA),
      M = Te(x, x.mB ?? x.len + x.extB);
    if (Math.abs(x.u.x) < 1e-6) {
      const T = Math.min(b.y, M.y),
        k = Math.max(b.y, M.y);
      (m.push(
        {
          v: x.a.x - x.ht,
          lo: T,
          hi: k,
        },
        {
          v: x.a.x + x.ht,
          lo: T,
          hi: k,
        },
      ),
        g.push(
          {
            v: b.y,
            lo: x.a.x - x.ht,
            hi: x.a.x + x.ht,
          },
          {
            v: M.y,
            lo: x.a.x - x.ht,
            hi: x.a.x + x.ht,
          },
        ));
    } else if (Math.abs(x.u.y) < 1e-6) {
      const T = Math.min(b.x, M.x),
        k = Math.max(b.x, M.x);
      (g.push(
        {
          v: x.a.y - x.ht,
          lo: T,
          hi: k,
        },
        {
          v: x.a.y + x.ht,
          lo: T,
          hi: k,
        },
      ),
        m.push(
          {
            v: b.x,
            lo: x.a.y - x.ht,
            hi: x.a.y + x.ht,
          },
          {
            v: M.x,
            lo: x.a.y - x.ht,
            hi: x.a.y + x.ht,
          },
        ));
    }
  }
  for (const x of n.structs) {
    if (!Q0[x.kind].solid || x.rot % 90) continue;
    const [b, M] = x.rot % 180 ? [x.d / 2, x.w / 2] : [x.w / 2, x.d / 2];
    (m.push(
      {
        v: x.x - b,
        lo: x.y - M,
        hi: x.y + M,
      },
      {
        v: x.x + b,
        lo: x.y - M,
        hi: x.y + M,
      },
    ),
      g.push(
        {
          v: x.y - M,
          lo: x.x - b,
          hi: x.x + b,
        },
        {
          v: x.y + M,
          lo: x.x - b,
          hi: x.x + b,
        },
      ));
  }
  const v = (x, b, M, T) => {
    let k = x,
      S = Gt + 1,
      E = x,
      _ = Gt + 1;
    for (const A of b) {
      const P = Math.abs(A.v - x);
      if (P > Gt) continue;
      const D = Math.min(A.hi, T) - Math.max(A.lo, M);
      D >= Gt
        ? P < S && ((S = P), (k = A.v))
        : D >= -Gt && P < _ && ((_ = P), (E = A.v));
    }
    return S <= Gt ? k : E;
  };
  p.forEach((x, b) => {
    ((x.rects = y[b]
      .map((A) => {
        const P = s + A.i0 * Gt,
          D = s + A.i1 * Gt,
          O = o + A.j0 * Gt,
          I = o + A.j1 * Gt,
          B = v(P, m, O, I),
          z = v(D, m, O, I),
          V = v(O, g, P, D),
          W = v(I, g, P, D);
        return {
          x: B,
          y: V,
          w: z - B,
          h: W - V,
        };
      })
      .filter((A) => A.w > 0.5 && A.h > 0.5)),
      x.rects.length ||
        (x.rects = y[b].map((A) => ({
          x: s + A.i0 * Gt,
          y: o + A.j0 * Gt,
          w: (A.i1 - A.i0) * Gt,
          h: (A.j1 - A.j0) * Gt,
        }))),
      (x.area = x.rects.reduce((A, P) => A + P.w * P.h, 0) / 1e6));
    let M = 1 / 0,
      T = 1 / 0,
      k = -1 / 0,
      S = -1 / 0,
      E = x.rects[0],
      _ = 0;
    for (const A of x.rects) {
      ((M = Math.min(M, A.x)),
        (T = Math.min(T, A.y)),
        (k = Math.max(k, A.x + A.w)),
        (S = Math.max(S, A.y + A.h)));
      const P = Math.min(A.w, A.h) * Math.max(A.w, A.h) ** 0.3;
      P > _ && ((_ = P), (E = A));
    }
    ((x.bb = {
      x: M,
      y: T,
      w: k - M,
      h: S - T,
    }),
      (x.interior = {
        x: E.x + E.w / 2,
        y: E.y + E.h / 2,
      }));
  });
  const w = {
    regions: p,
    grid: l,
    cols: a,
    rows: r,
    x0: s,
    y0: o,
    c: Gt,
  };
  return (My(n, w), w);
}
export function Xe(n, e) {
  const t = Math.floor((e.x - n.x0) / n.c),
    i = Math.floor((e.y - n.y0) / n.c);
  if (t < 0 || i < 0 || t >= n.cols || i >= n.rows) return null;
  const s = n.grid[i * n.cols + t];
  return s > 0 ? n.regions[s - 1] : null;
}
export function My(n, e) {
  e.regions.forEach((t) => {
    ((t.labels = []), (t.key = null));
  });
  for (const t of n.rooms) {
    const i = Xe(e, t);
    i && i.labels.push(t);
  }
  e.regions.forEach((t) => {
    var i;
    return (t.key = ((i = t.labels[0]) == null ? void 0 : i.id) ?? null);
  });
}
export const X0 = 0.6;
export const Sy = 0.1;
export const Va = (n) => n.area >= X0 || (n.labels.length > 0 && n.area >= Sy);
export function nM(n, e, roomLabelArchive = []) {
  let t = !1;
  const i = n.rooms.filter((s) => {
    const o = Xe(e, s);
    return !o || o.area < Sy;
  });
  for (const s of e.regions) {
    if (s.area < X0 || s.labels.length) continue;
    let o = null,
      a = 4e3;
    for (const l of i) {
      const c = Math.hypot(l.x - s.interior.x, l.y - s.interior.y);
      c < a && ((a = c), (o = l));
    }
    const r = o
      ? []
      : roomLabelArchive.filter(
          (l) => Xe(e, l) === s && !n.rooms.some((c) => c.id === l.id),
        );
    if (r.length)
      for (const l of r)
        (roomLabelArchive.splice(roomLabelArchive.indexOf(l), 1),
          n.rooms.push(l));
    else if (o)
      ((o.x = Math.round(s.interior.x)),
        (o.y = Math.round(s.interior.y)),
        i.splice(i.indexOf(o), 1));
    else {
      const l = n.rooms.length + 1;
      n.rooms.push({
        id: Ut(),
        x: Math.round(s.interior.x),
        y: Math.round(s.interior.y),
        name: "房间" + l,
        mat: "oak",
      });
    }
    t = !0;
  }
  return (
    i.length &&
      (roomLabelArchive.push(
        ...i.map((s) => ({
          ...s,
        })),
      ),
      roomLabelArchive.splice(0, Math.max(0, roomLabelArchive.length - 60)),
      (n.rooms = n.rooms.filter((s) => !i.includes(s))),
      (t = !0)),
    t && My(n, e),
    t
  );
}
export function Vt(n) {
  return n.labels.length ? n.labels.map((e) => e.name).join(" + ") : "未命名";
}
export function ms(n) {
  var e;
  return ((e = n.labels[0]) == null ? void 0 : e.mat) ?? "oak";
}
export const yd = 2;
export const _0 = (n, e) => n.nodes.find((t) => t.id === e);
export const Wr = (n, e) => n.walls.filter((t) => t.a === e || t.b === e);
export const X8 = (n, e) => (n.a === e ? n.b : n.a);
export function F4(n, e, t = yd) {
  let i,
    s = t;
  for (const o of n.nodes) {
    const a = xe(o, e);
    a <= s && ((s = a), (i = o));
  }
  return i;
}
export const Vr = (n) => Math.round(n * 2) / 2;
export function Hy(n, e) {
  const t = {
    id: Ut(),
    x: Vr(e.x),
    y: Vr(e.y),
  };
  return (n.nodes.push(t), t);
}
export function bd(n, e, t) {
  const i = _0(n, e.a),
    s = _0(n, e.b),
    o = F0(t, i, s),
    a = F4(n, o.foot) || Hy(n, o.foot),
    r = xe(i, a),
    l = {
      ...e,
      id: Ut(),
      a: a.id,
      b: e.b,
    };
  ((e.b = a.id), n.walls.push(l));
  for (const c of n.openings)
    c.wall === e.id && c.pos > r && ((c.wall = l.id), (c.pos -= r));
  return a;
}
export function K8(n, e, t, i) {
  const s = _0(n, t.a),
    o = _0(n, t.b),
    a = _0(n, i.a),
    r = _0(n, i.b),
    l = xe(s, o),
    c = {
      x: (o.x - s.x) / l,
      y: (o.y - s.y) / l,
    },
    f = {
      x: s.x + c.x * e.pos,
      y: s.y + c.y * e.pos,
    },
    u = {
      x: r.x - a.x,
      y: r.y - a.y,
    },
    h = c.x * u.x + c.y * u.y < 0;
  ((e.wall = i.id),
    (e.pos = F0(f, a, r).along),
    h && ((e.side = -e.side), (e.hinge = 1 - e.hinge)));
}
export function Vy(n) {
  let e = !0;
  for (; e;) {
    e = !1;
    for (const t of [...n.nodes]) {
      const i = Wr(n, t.id);
      if (!i.length) {
        ((n.nodes = n.nodes.filter((w) => w !== t)), (e = !0));
        continue;
      }
      if (i.length !== 2) continue;
      const [s, o] = i;
      if (s.t !== o.t || s.bearing !== o.bearing || s.status !== o.status)
        continue;
      const a = _0(n, X8(s, t.id)),
        r = _0(n, X8(o, t.id)),
        l = {
          x: a.x - t.x,
          y: a.y - t.y,
        },
        c = {
          x: r.x - t.x,
          y: r.y - t.y,
        },
        f = Math.hypot(l.x, l.y),
        u = Math.hypot(c.x, c.y),
        h = (l.x * c.y - l.y * c.x) / (f * u),
        p = (l.x * c.x + l.y * c.y) / (f * u);
      if (Math.abs(h) > 0.002 || p > 0) continue;
      const d = (s.align || 0) * (s.a === a.id ? 1 : -1),
        y = (o.align || 0) * (o.a === t.id ? 1 : -1);
      if (d !== y) continue;
      const m = {
        ...s,
        a: a.id,
        b: r.id,
      };
      d ? (m.align = d) : delete m.align;
      const g = {
          ...s,
        },
        v = {
          ...o,
        };
      ((n.walls = n.walls.filter((w) => w !== s && w !== o)), n.walls.push(m));
      for (const w of n.openings)
        w.wall === g.id ? K8(n, w, g, m) : w.wall === v.id && K8(n, w, v, m);
      ((n.nodes = n.nodes.filter((w) => w !== t)), (e = !0));
      break;
    }
  }
  Gy(n);
}
export function Gy(n) {
  const e = [];
  for (const t of n.openings) {
    const i = n.walls.find((a) => a.id === t.wall);
    if (!i) continue;
    const s = xe(_0(n, i.a), _0(n, i.b)),
      o = 30;
    t.width > s - 2 * o ||
      ((t.pos = Math.min(
        Math.max(t.pos, t.width / 2 + o),
        s - t.width / 2 - o,
      )),
      e.push(t));
  }
  n.openings = e;
}
export function Vc(n) {
  for (let i = 0; i < n.nodes.length; i++)
    for (let s = n.nodes.length - 1; s > i; s--) {
      const o = n.nodes[i],
        a = n.nodes[s];
      if (xe(o, a) < 1) {
        for (const r of n.walls)
          (r.a === a.id && (r.a = o.id), r.b === a.id && (r.b = o.id));
        n.nodes.splice(s, 1);
      }
    }
  let e = !0;
  for (; e;) {
    e = !1;
    for (const i of n.nodes) {
      for (const s of n.walls) {
        if (s.a === i.id || s.b === i.id) continue;
        const o = F0(i, _0(n, s.a), _0(n, s.b));
        if (o.d < 1 && o.along > 1 && o.along < o.len - 1) {
          (bd(n, s, i), (e = !0));
          break;
        }
      }
      if (e) break;
    }
  }
  const t = new Set();
  ((n.walls = n.walls.filter((i) => {
    if (i.a === i.b) return !1;
    const s = [i.a, i.b].sort().join("|");
    return t.has(s) ? !1 : (t.add(s), !0);
  })),
    Vy(n));
}
