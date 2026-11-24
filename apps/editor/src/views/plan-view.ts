import {
  wallGeometry,
  detectRooms,
  projectToWall,
  footprint,
  pointInPolygon,
  freeFootprint,
  newId,
  openingTypes,
  clone,
  type Plan,
  type Command,
  type Collection,
  type Furniture,
} from "../../../../packages/scene-core/src/index.js";
import { Fh } from "../modeling/furniture-2d.js";
import { floorColors } from "./three-view.js";
import { Mv, Sv } from "../modeling/surfaces.js";
import { Gr } from "../../../../packages/scene-core/src/inherited/footprints.js";
import type { EditBase } from "../api.js";
import { displayRoomName } from "../ui/labels.js";
export interface Selection {
  collection: Collection;
  id: string;
}
export class PlanView {
  canvas = document.createElement("canvas");
  ctx: CanvasRenderingContext2D;
  plan?: Plan;
  base?: EditBase;
  selection?: Selection;
  scale = 0.07;
  ox = 70;
  oy = 60;
  tool = "select";
  sourceImageVisible = false;
  private sourceImage?: HTMLImageElement;
  private sourceImageId?: string;
  private sourceData?: any;
  setSourceImage(source?: any) {
    this.sourceData = source;
    if (!source || source.kind !== "floorplan") {
      this.sourceImage = undefined;
      this.sourceImageId = undefined;
      this.draw();
      return;
    }
    if (this.sourceImageId !== source.imageId) {
      this.sourceImageId = source.imageId;
      const img = new Image();
      this.sourceImage = img;
      img.onload = () => {
        if (this.sourceImage === img) this.draw();
      };
      img.onerror = () => {
        if (this.sourceImage === img)
          this.report("原图加载失败，请检查来源文件是否完整");
      };
      img.src = `/api/floorplan-images/${source.imageId}/file`;
    }
    this.draw();
  }
  pending?: { x: number; y: number };
  vertex = -1;
  drag?: {
    at: { x: number; y: number };
    original: Plan;
    base: EditBase;
    preview?: Plan;
    selection?: Selection;
    pan?: { x: number; y: number };
    vertex?: number;
  };
  constructor(
    public host: HTMLElement,
    public select: (s?: Selection) => void,
    public commit: (
      c: Command[],
      summary: string,
      base?: EditBase,
    ) => Promise<void>,
    public preview: (f: Furniture) => void,
    public report: (s: string) => void,
  ) {
    this.canvas.dataset.testid = "plan-canvas";
    host.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    new ResizeObserver(() => this.resize()).observe(host);
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const p = this.point(e),
          s = Math.max(
            0.008,
            Math.min(0.7, this.scale * Math.exp(-e.deltaY * 0.001)),
          );
        this.ox += (this.scale - s) * p.x;
        this.oy += (this.scale - s) * p.y;
        this.scale = s;
        this.draw();
      },
      { passive: false },
    );
    this.canvas.addEventListener("pointerdown", (e) => this.down(e));
    this.canvas.addEventListener("pointermove", (e) => this.move(e));
    this.canvas.addEventListener("pointerup", (e) => this.up(e));
    this.canvas.addEventListener("pointercancel", () => {
      if (this.drag) {
        this.plan = this.drag.original;
        this.base = this.drag.base;
        this.drag = undefined;
        this.draw();
      }
    });
    this.canvas.addEventListener("dblclick", (e) =>
      this.insertVertex(this.point(e)),
    );
  }
  resize() {
    const r = this.host.getBoundingClientRect();
    if (!r.width) return;
    const d = devicePixelRatio;
    this.canvas.width = r.width * d;
    this.canvas.height = r.height * d;
    this.canvas.style.width = r.width + "px";
    this.canvas.style.height = r.height + "px";
    this.draw();
  }
  load(plan: Plan, base: EditBase) {
    this.plan = clone(plan);
    this.base = base;
    this.draw();
  }
  fullWorldBounds() {
    if (!this.plan) return { x: 0, y: 0, w: 1000, h: 1000 };
    const b = wallGeometry(this.plan).bounds;
    let x0 = b.x;
    let y0 = b.y;
    let x1 = b.x + b.w;
    let y1 = b.y + b.h;
    for (const n of this.plan.nodes || []) {
      x0 = Math.min(x0, n.x);
      y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x);
      y1 = Math.max(y1, n.y);
    }
    for (const f of this.plan.furniture || []) {
      for (const p of footprint(f)) {
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
    }
    const pad = 550;
    return {
      x: x0 - pad,
      y: y0 - pad,
      w: Math.max(1000, x1 - x0 + pad * 2),
      h: Math.max(1000, y1 - y0 + pad * 2),
    };
  }
  frame() {
    if (!this.plan) return;
    const b = this.fullWorldBounds(),
      w = this.host.clientWidth,
      h = this.host.clientHeight;
    if (w <= 90 || h <= 90) return;
    this.scale = Math.min(
      (w - 60) / Math.max(b.w, 1000),
      (h - 60) / Math.max(b.h, 1000),
    );
    this.ox = (w - b.w * this.scale) / 2 - b.x * this.scale;
    this.oy = (h - b.h * this.scale) / 2 - b.y * this.scale;
    this.draw();
  }
  exportFullCanvas(maxSide = 2200): HTMLCanvasElement | undefined {
    if (!this.plan) return undefined;
    const b = this.fullWorldBounds();
    const aspect = b.w / Math.max(1, b.h);
    const padPx = 80;
    let outW: number;
    let outH: number;
    if (aspect >= 1) {
      outW = Math.max(1400, maxSide);
      outH = Math.max(960, Math.round((outW - padPx * 2) / aspect + padPx * 2));
    } else {
      outH = Math.max(1400, maxSide);
      outW = Math.max(960, Math.round((outH - padPx * 2) * aspect + padPx * 2));
    }
    const offscreen = document.createElement("canvas");
    offscreen.width = outW;
    offscreen.height = outH;
    const offCtx = offscreen.getContext("2d");
    if (!offCtx) return undefined;

    const prevCanvas = this.canvas;
    const prevCtx = this.ctx;
    const prevScale = this.scale;
    const prevOx = this.ox;
    const prevOy = this.oy;
    const prevSelection = this.selection;
    const prevVertex = this.vertex;
    try {
      this.canvas = offscreen;
      this.ctx = offCtx;
      this.selection = undefined;
      this.vertex = -1;
      this.scale = Math.min(
        (outW - padPx * 2) / Math.max(b.w, 1000),
        (outH - padPx * 2) / Math.max(b.h, 1000),
      );
      this.ox = (outW - b.w * this.scale) / 2 - b.x * this.scale;
      this.oy = (outH - b.h * this.scale) / 2 - b.y * this.scale;
      this.draw(1);
    } finally {
      this.canvas = prevCanvas;
      this.ctx = prevCtx;
      this.scale = prevScale;
      this.ox = prevOx;
      this.oy = prevOy;
      this.selection = prevSelection;
      this.vertex = prevVertex;
      this.draw();
    }
    return offscreen;
  }
  centerOn(x: number, y: number, zoom = this.scale) {
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    if (w <= 0 || h <= 0) return;
    this.scale = Math.max(0.001, zoom);
    this.ox = w / 2 - x * this.scale;
    this.oy = h / 2 - y * this.scale;
    this.draw();
  }
  screen(p: { x: number; y: number }) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: r.left + this.ox + p.x * this.scale,
      y: r.top + this.oy + p.y * this.scale,
    };
  }
  point(e: { clientX: number; clientY: number }) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left - this.ox) / this.scale,
      y: (e.clientY - r.top - this.oy) / this.scale,
    };
  }
  setTool(tool: string) {
    this.tool = tool;
    this.pending = undefined;
    this.canvas.style.cursor = tool === "select" ? "default" : "crosshair";
    this.report(
      tool === "wall"
        ? "点击起点和终点绘制墙，靠近现有节点自动吸附"
        : tool === "select"
          ? "选择并拖动对象；R 旋转；Delete 删除"
          : "在平面上点击放置",
    );
    this.draw();
  }
  selectedFurniture() {
    return this.selection?.collection === "furniture"
      ? this.plan?.furniture.find((f) => f.id === this.selection?.id)
      : undefined;
  }
  hit(p: { x: number; y: number }): Selection | undefined {
    const plan = this.plan!;
    const node = plan.nodes.find(
      (n) => Math.hypot(n.x - p.x, n.y - p.y) < 7 / this.scale,
    );
    if (node) return { collection: "nodes", id: node.id };
    for (const f of [...plan.furniture].reverse())
      if (pointInPolygon(p, footprint(f)))
        return { collection: "furniture", id: f.id };
    for (const f of [...plan.structs].reverse())
      if (Math.abs(f.x - p.x) < f.w / 2 && Math.abs(f.y - p.y) < f.d / 2)
        return { collection: "structs", id: f.id };
    for (const g of wallGeometry(plan).active) {
      const t = projectToWall(p, g.a, g.b);
      if (t.t >= 0 && t.t <= 1 && t.d < Math.max(g.ht, 8 / this.scale)) {
        const o = plan.openings.find(
          (o) => o.wall === g.w.id && Math.abs(t.along - o.pos) < o.width / 2,
        );
        return o
          ? { collection: "openings", id: o.id }
          : { collection: "walls", id: g.w.id };
      }
    }
    for (const collection of ["beams", "measures"] as const)
      for (const m of plan[collection]) {
        const a = plan.nodes.find((n) => n.id === m.a) || m.a,
          b = plan.nodes.find((n) => n.id === m.b) || m.b;
        if (a?.x !== undefined && b?.x !== undefined) {
          const hit = projectToWall(p, a, b);
          if (hit.t >= 0 && hit.t <= 1 && hit.d < 8 / this.scale)
            return { collection, id: m.id };
        }
      }
    const room = plan.rooms.find((r) => Math.hypot(r.x - p.x, r.y - p.y) < 400);
    if (room) return { collection: "rooms", id: room.id };
  }
  snap(p: { x: number; y: number }, shift = false) {
    if (shift) return p;
    const node = this.plan?.nodes.find(
      (n) => Math.hypot(n.x - p.x, n.y - p.y) < 12 / this.scale,
    );
    return node
      ? { x: node.x, y: node.y }
      : { x: Math.round(p.x / 50) * 50, y: Math.round(p.y / 50) * 50 };
  }
  down(e: PointerEvent) {
    if (!this.plan || !this.base) return;
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.point(e);
    if (e.button === 1 || e.button === 2) {
      this.drag = {
        at: p,
        original: clone(this.plan),
        base: this.base,
        pan: { x: e.clientX, y: e.clientY },
      };
      return;
    }
    if (
      this.tool === "wall" ||
      this.tool === "beam" ||
      this.tool === "measure"
    ) {
      const at = this.snap(p, e.shiftKey);
      if (!this.pending) {
        this.pending = at;
        this.draw();
        return;
      }
      const start = this.pending;
      this.pending = undefined;
      if (Math.hypot(at.x - start.x, at.y - start.y) < 100) return;
      if (this.tool !== "wall") {
        void this.commit(
          [
            {
              type: "add",
              collection: this.tool === "beam" ? "beams" : "measures",
              object: { id: newId(), a: start, b: at, w: 250, h: 400 },
            },
          ],
          this.tool === "beam" ? "添加梁" : "添加尺寸",
          this.base,
        );
        return;
      }
      const commands: Command[] = [];
      const node = (point: { x: number; y: number }) => {
        const existing = this.plan!.nodes.find(
          (n) => Math.hypot(n.x - point.x, n.y - point.y) < 1,
        );
        if (existing) return existing.id;
        const id = newId();
        commands.push({
          type: "add",
          collection: "nodes",
          object: { id, ...point },
        });
        return id;
      };
      const a = node(start),
        b = node(at);
      commands.push({
        type: "add",
        collection: "walls",
        object: { id: newId(), a, b, t: 120, bearing: false, status: "new" },
      });
      void this.commit(commands, "绘制墙体", this.base);
      return;
    }
    if (this.tool.startsWith("opening:")) {
      const type = this.tool.slice(8),
        def = (openingTypes as any)[type],
        geos = wallGeometry(this.plan).active;
      const nearest = geos
        .map((g) => ({ g, t: projectToWall(p, g.a, g.b) }))
        .filter((o) => o.t.t >= 0 && o.t.t <= 1)
        .sort((a, b) => a.t.d - b.t.d)[0];
      if (!nearest || nearest.t.d > 400) {
        this.report("请在墙体上放置门窗");
        return;
      }
      const width = Math.min(def.width, nearest.g.len - 20),
        pos = Math.max(
          width / 2,
          Math.min(
            nearest.g.len - width / 2,
            Math.round(nearest.t.along / 50) * 50,
          ),
        );
      void this.commit(
        [
          {
            type: "add",
            collection: "openings",
            object: {
              id: newId(),
              wall: nearest.g.w.id,
              type,
              width,
              pos,
              sill: def.sill,
              head: Math.min(def.head, this.plan.height),
              hinge: 0,
              side: 1,
            },
          },
        ],
        "添加门窗",
        this.base,
      );
      return;
    }
    if (this.tool.startsWith("struct:")) {
      const kind = this.tool.slice(7);
      void this.commit(
        [
          {
            type: "add",
            collection: "structs",
            object: {
              id: newId(),
              kind,
              ...this.snap(p),
              w: 400,
              d: 400,
              h: this.plan.height,
              rot: 0,
            },
          },
        ],
        "添加结构构件",
        this.base,
      );
      return;
    }
    if (this.tool === "room") {
      void this.commit(
        [
          {
            type: "add",
            collection: "rooms",
            object: { id: newId(), ...this.snap(p), name: "房间", mat: "oak" },
          },
        ],
        "添加房间标签",
        this.base,
      );
      return;
    }
    const f = this.selectedFurniture();
    this.vertex = -1;
    if (f?.type === "free" && f.opt?.shape === "extrude") {
      const points = footprint(f),
        index = points.findIndex(
          (v) => Math.hypot(v.x - p.x, v.y - p.y) < 10 / this.scale,
        );
      if (index >= 0) {
        this.vertex = index;
        this.drag = {
          at: p,
          original: clone(this.plan),
          base: this.base,
          selection: this.selection,
          vertex: index,
        };
        this.draw();
        return;
      }
    }
    this.selection = this.hit(p);
    this.select(this.selection);
    this.drag = {
      at: p,
      original: clone(this.plan),
      base: this.base,
      selection: this.selection,
    };
    this.draw();
  }
  move(e: PointerEvent) {
    if (!this.drag || !this.plan) return;
    if (this.drag.pan) {
      this.ox += e.clientX - this.drag.pan.x;
      this.oy += e.clientY - this.drag.pan.y;
      this.drag.pan = { x: e.clientX, y: e.clientY };
      this.draw();
      return;
    }
    const s = this.drag.selection;
    if (!s) return;
    const p = this.point(e),
      dx = p.x - this.drag.at.x,
      dy = p.y - this.drag.at.y;
    this.plan = clone(this.drag.original);
    const original = this.drag.original[s.collection].find(
        (o) => o.id === s.id,
      )!,
      object = this.plan[s.collection].find((o) => o.id === s.id)!;
    if (this.drag.vertex !== undefined) {
      const f = object as Furniture,
        points = freeFootprint(f) as number[][],
        a = (-f.rot * Math.PI) / 180;
      const x = p.x - f.x,
        y = p.y - f.y;
      points[this.drag.vertex] = [
        x * Math.cos(a) - y * Math.sin(a),
        x * Math.sin(a) + y * Math.cos(a),
      ];
      this.setOutline(f, points);
    } else if (s.collection === "walls") {
      for (const id of [object.a, object.b]) {
        const n = this.plan.nodes.find((n) => n.id === id)!,
          old = this.drag.original.nodes.find((n) => n.id === id)!;
        Object.assign(
          n,
          this.snap({ x: old.x + dx, y: old.y + dy }, e.shiftKey),
        );
      }
    } else if (s.collection === "openings") {
      const w = wallGeometry(this.plan).walls.get(object.wall)!;
      object.pos = Math.max(
        object.width / 2,
        Math.min(
          w.len - object.width / 2,
          original.pos + dx * w.u.x + dy * w.u.y,
        ),
      );
    } else if (object.x !== undefined) {
      Object.assign(
        object,
        this.snap({ x: original.x + dx, y: original.y + dy }, e.shiftKey),
      );
    }
    if (s.collection === "furniture") this.preview(object as Furniture);
    this.base = this.drag.base;
    this.drag.preview = this.plan;
    this.draw();
  }
  async up(_e: PointerEvent) {
    const drag = this.drag;
    this.drag = undefined;
    if (!drag || drag.pan || !drag.selection || !drag.preview) return;
    const commands: Command[] = [];
    for (const collection of [
      "nodes",
      "furniture",
      "walls",
      "openings",
      "structs",
      "rooms",
    ] as Collection[])
      for (const object of drag.preview[collection]) {
        const previous = drag.original[collection].find(
          (o) => o.id === object.id,
        );
        if (previous && JSON.stringify(previous) !== JSON.stringify(object)) {
          const { id, ...patch } = object;
          commands.push({ type: "update", collection, id, patch });
        }
      }
    if (commands.length)
      await this.commit(
        commands,
        drag.vertex !== undefined ? "编辑自由轮廓" : "拖动对象",
        drag.base,
      );
  }
  setOutline(f: Furniture, points: number[][]) {
    const xs = points.map((p) => p[0]),
      ys = points.map((p) => p[1]),
      cx = (Math.min(...xs) + Math.max(...xs)) / 2,
      cy = (Math.min(...ys) + Math.max(...ys)) / 2,
      a = (f.rot * Math.PI) / 180;
    f.x += cx * Math.cos(a) - cy * Math.sin(a);
    f.y += cx * Math.sin(a) + cy * Math.cos(a);
    f.w = Math.max(1, Math.max(...xs) - Math.min(...xs));
    f.d = Math.max(1, Math.max(...ys) - Math.min(...ys));
    f.opt = {
      ...f.opt,
      outline: points
        .map(([x, y]) => `${Math.round(x - cx)},${Math.round(y - cy)}`)
        .join("|"),
    };
  }
  async insertVertex(p: { x: number; y: number }) {
    const f = this.selectedFurniture();
    if (!f || f.type !== "free" || f.opt?.shape !== "extrude") return;
    const points = footprint(f);
    let edge = -1,
      best = 14 / this.scale;
    for (let i = 0; i < points.length; i++) {
      const hit = projectToWall(p, points[i], points[(i + 1) % points.length]);
      if (hit.t >= 0 && hit.t <= 1 && hit.d < best) {
        edge = i;
        best = hit.d;
      }
    }
    if (edge < 0) return;
    const local = freeFootprint(f) as number[][],
      a = (-f.rot * Math.PI) / 180,
      x = p.x - f.x,
      y = p.y - f.y;
    local.splice(edge + 1, 0, [
      x * Math.cos(a) - y * Math.sin(a),
      x * Math.sin(a) + y * Math.cos(a),
    ]);
    const copy = clone(f);
    this.setOutline(copy, local);
    const { id, ...patch } = copy;
    await this.commit(
      [{ type: "update", collection: "furniture", id, patch }],
      "添加轮廓顶点",
      this.base,
    );
  }
  async deleteVertex() {
    const f = this.selectedFurniture();
    if (this.vertex < 0 || !f) return false;
    const points = freeFootprint(f) as number[][];
    if (points.length <= 3) {
      this.report("轮廓至少保留三个顶点");
      return true;
    }
    points.splice(this.vertex, 1);
    const copy = clone(f);
    this.setOutline(copy, points);
    this.vertex = -1;
    const { id, ...patch } = copy;
    await this.commit(
      [{ type: "update", collection: "furniture", id, patch }],
      "删除轮廓顶点",
      this.base,
    );
    return true;
  }
  draw(dprOverride?: number) {
    const c = this.ctx,
      dpr = dprOverride ?? devicePixelRatio;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
    c.fillStyle = "#f7f3eb";
    c.fillRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
    if (!this.plan) return;
    c.translate(this.ox, this.oy);
    c.scale(this.scale, this.scale);
    const unit = 1 / this.scale,
      plan = this.plan,
      geo = wallGeometry(plan),
      rooms = detectRooms(plan, geo);
    c.strokeStyle = "#e5ded2";
    c.lineWidth = unit * 0.5;
    const step = this.scale < 0.04 ? 1000 : 500;
    for (
      let x = Math.floor(-this.ox / this.scale / step) * step;
      x < (this.canvas.width / dpr - this.ox) / this.scale;
      x += step
    ) {
      c.beginPath();
      c.moveTo(x, -this.oy / this.scale);
      c.lineTo(x, (this.canvas.height / dpr - this.oy) / this.scale);
      c.stroke();
    }
    for (
      let y = Math.floor(-this.oy / this.scale / step) * step;
      y < (this.canvas.height / dpr - this.oy) / this.scale;
      y += step
    ) {
      c.beginPath();
      c.moveTo(-this.ox / this.scale, y);
      c.lineTo((this.canvas.width / dpr - this.ox) / this.scale, y);
      c.stroke();
    }
    for (const room of rooms.regions) {
      c.fillStyle = Mv(c, room.labels[0]?.mat || "oak");
      c.globalAlpha = 0.65;
      if (room.labels[0]?.tile) Sv(c, room, Gr(room.labels[0].tile), unit);
      else for (const r of room.rects) c.fillRect(r.x, r.y, r.w, r.h);
      c.globalAlpha = 1;
    }
    if (
      this.sourceImageVisible &&
      this.sourceData &&
      this.sourceImage?.complete &&
      this.sourceImage.naturalWidth
    ) {
      const source = this.sourceData;
      c.save();
      c.globalAlpha = 0.45;
      c.drawImage(
        this.sourceImage,
        -source.origin.x * source.mmPerPixel,
        -source.origin.y * source.mmPerPixel,
        source.imageWidth * source.mmPerPixel,
        source.imageHeight * source.mmPerPixel,
      );
      c.restore();
    }
    for (const g of geo.active) {
      c.save();
      c.translate(g.a.x, g.a.y);
      c.rotate(Math.atan2(g.u.y, g.u.x));
      c.fillStyle = this.selection?.id === g.w.id ? "#16868a" : "#4b5563";
      for (const s of g.solids) c.fillRect(s.s0, -g.ht, s.s1 - s.s0, g.ht * 2);
      c.strokeStyle = "#93b4c4";
      c.lineWidth = unit * 1.5;
      for (const op of g.ops) {
        c.strokeStyle = this.selection?.id === op.o.id ? "#16868a" : "#7a9bb3";
        c.strokeRect(op.s0, -g.ht, op.s1 - op.s0, 2 * g.ht);
        if (op.o.sill === 0) {
          c.beginPath();
          c.arc(op.s0, 0, op.o.width, 0, Math.PI / 2);
          c.moveTo(op.s0, 0);
          c.lineTo(op.s0, op.o.width);
          c.stroke();
        }
      }
      c.fillStyle = "#6d7684";
      c.font = `${11 * unit}px sans-serif`;
      c.textAlign = "center";
      c.fillText(`${Math.round(g.len)}`, g.len / 2, -g.ht - 10 * unit);
      c.restore();
    }
    for (const f of plan.structs) {
      c.save();
      c.translate(f.x, f.y);
      c.rotate(((f.rot || 0) * Math.PI) / 180);
      c.fillStyle = "#a4acb2";
      c.fillRect(-f.w / 2, -f.d / 2, f.w, f.d);
      c.restore();
    }
    for (const f of plan.furniture) {
      c.save();
      c.translate(f.x, f.y);
      c.rotate((f.rot * Math.PI) / 180);
      Fh(c, f, unit);
      c.restore();
    }
    for (const m of [...plan.beams, ...plan.measures]) {
      const a = plan.nodes.find((n) => n.id === m.a) || m.a,
        b = plan.nodes.find((n) => n.id === m.b) || m.b;
      if (a?.x !== undefined && b?.x !== undefined) {
        c.strokeStyle = "#978873";
        c.lineWidth = 2 * unit;
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.stroke();
        c.fillStyle = "#68675d";
        c.font = `${11 * unit}px sans-serif`;
        c.fillText(
          `${Math.round(Math.hypot(b.x - a.x, b.y - a.y))} mm`,
          (a.x + b.x) / 2,
          (a.y + b.y) / 2,
        );
      }
    }
    c.textAlign = "center";
    c.font = `${13 * unit}px sans-serif`;
    for (const r of plan.rooms) {
      c.fillStyle = "#677a83";
      c.fillText(displayRoomName(r), r.x, r.y);
    }
    const f = this.selectedFurniture();
    if (f) {
      const poly = footprint(f);
      c.strokeStyle = "#008a8b";
      c.lineWidth = 2 * unit;
      c.beginPath();
      poly.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
      c.closePath();
      c.stroke();
      if (f.type === "free" && f.opt?.shape === "extrude")
        poly.forEach((p, i) => {
          c.fillStyle = i === this.vertex ? "#f1a739" : "#008a8b";
          c.fillRect(p.x - 4 * unit, p.y - 4 * unit, 8 * unit, 8 * unit);
        });
    }
    for (const n of plan.nodes) {
      c.fillStyle = this.selection?.id === n.id ? "#008a8b" : "#f7f8fa";
      c.strokeStyle = "#586776";
      c.lineWidth = unit;
      c.beginPath();
      c.arc(n.x, n.y, 3 * unit, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
    if (this.pending) {
      c.fillStyle = "#e9a33f";
      c.beginPath();
      c.arc(this.pending.x, this.pending.y, 5 * unit, 0, Math.PI * 2);
      c.fill();
    }
  }
}
