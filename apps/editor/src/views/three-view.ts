import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  wallGeometry,
  detectRooms,
  footprint,
  pointInPolygon,
  projectToWall,
  catalog,
  furnitureElevation,
  openEnvelope,
  checkScene,
  toggleActionCommand,
  type Plan,
  type Furniture,
  type Command,
} from "../../../../packages/scene-core/src/index.js";
import { Ov, Ba, j0, Cp } from "../modeling/furniture-3d.js";
import { ensureAssets } from "../modeling/asset-cache.js";
import { Ko, zd, Qu, Lu, Ps, ei, Hd, qC } from "../modeling/surfaces.js";
import { Gr } from "../../../../packages/scene-core/src/inherited/footprints.js";
import type { EditBase } from "../api.js";
export const floorColors: Record<string, string> = {
  oak: "#c7ab82",
  walnut: "#826145",
  wood: "#bd9b71",
  tile: "#ddd9ce",
  marble: "#e8e5df",
  concrete: "#acb1b2",
  carpet: "#a0aaa5",
  stone: "#b9b3a9",
  terrazzo: "#c9c7c0",
  white: "#eeeeea",
};
export const wallColors: Record<string, string> = {
  latexWhite: "#f3f0e9",
  latexWarm: "#e9dfcb",
  latexGray: "#bfc3c4",
  wood: "#ba956b",
  marble: "#e2ded3",
  tile: "#e4e2dc",
  concrete: "#b4b7b4",
};
const color = (
  name: string,
  colors: Record<string, string>,
  fallback: string,
) => (name?.startsWith("#") ? name : colors[name] || fallback);
export class ThreeView {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, 1, 0.03, 500);
  controls: OrbitControls;
  root = new THREE.Group();
  furniture = new Map<string, THREE.Group>();
  plan?: Plan;
  base?: EditBase;
  selected?: THREE.BoxHelper;
  walking = false;
  keys = new Set<string>();
  yaw = 0;
  pitch = 0;
  generation = 0;
  lastSelected?: { id: string; collection: "openings" | "furniture" };
  private highlightedId?: string;
  private envelopeLayer = new THREE.Group();
  private clock = new THREE.Clock();
  private lastClick?: { t: number; x: number; y: number };
  private walkDown?: { x: number; y: number };
  private orbitSave?: { position: THREE.Vector3; target: THREE.Vector3 };
  private textures = new Map<string, THREE.Texture>();
  private transientMaterials: THREE.Material[] = [];
  private transientTextures: THREE.Texture[] = [];
  private drag?: {
    f: Furniture;
    base: EditBase;
    start: THREE.Vector3;
    plane: THREE.Plane;
    next: { x: number; y: number };
  };
  constructor(
    public host: HTMLElement,
    public select: (id: string, collection?: string) => void,
    public report: (s: string) => void,
    public commit: (
      commands: Command[],
      summary: string,
      base?: EditBase,
    ) => Promise<void>,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    host.append(this.renderer.domElement);
    this.renderer.domElement.dataset.testid = "three-canvas";
    this.scene.background = new THREE.Color("#eef1f4");
    this.scene.add(new THREE.HemisphereLight("#fff8ef", "#b2bcc7", 2.4));
    const sun = new THREE.DirectionalLight("#fff4e0", 2.8);
    sun.position.set(8, 14, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -20,
      right: 20,
      top: 20,
      bottom: -20,
      near: 0.1,
      far: 60,
    });
    sun.shadow.bias = -0.0003;
    this.scene.add(sun, this.root);
    this.envelopeLayer.name = "open-envelopes";
    this.scene.add(this.envelopeLayer);
    this.camera.position.set(13, 12, 15);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(4.5, 0, 3);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    new ResizeObserver(() => this.resize()).observe(host);
    const canvas = this.renderer.domElement;
    canvas.addEventListener(
      "pointerdown",
      (e) => {
        if (this.walking || e.button !== 0 || !this.plan) return;
        const ray = this.rayAt(e),
          hit = ray
            .intersectObjects(this.root.children, true)
            .find(
              (h) =>
                h.object.userData.fid ||
                h.object.userData.wallId ||
                h.object.userData.objectId,
            ),
          f = this.plan.furniture.find(
            (f) => f.id === hit?.object.userData.fid,
          );
        if (!f || !this.base) return;
        const plane = new THREE.Plane(
            new THREE.Vector3(0, 1, 0),
            -(f.z || 0) / 1000,
          ),
          start = ray.ray.intersectPlane(plane, new THREE.Vector3());
        if (!start) return;
        this.select(f.id);
        this.drag = {
          f,
          start,
          plane,
          base: this.base,
          next: { x: f.x, y: f.y },
        };
        this.controls.enabled = false;
        canvas.setPointerCapture(e.pointerId);
      },
      true,
    );
    canvas.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      const point = this.rayAt(e).ray.intersectPlane(
        this.drag.plane,
        new THREE.Vector3(),
      );
      if (!point) return;
      const { f, start } = this.drag;
      const snap = (n: number) => (e.altKey ? n : Math.round(n / 50) * 50);
      this.drag.next = {
        x: snap(f.x + (point.x - start.x) * 1000),
        y: snap(f.y + (point.z - start.z) * 1000),
      };
      this.preview({ ...f, ...this.drag.next });
    });
    canvas.addEventListener("pointerup", () => {
      if (!this.drag) return;
      const { f, next, base } = this.drag;
      this.drag = undefined;
      this.controls.enabled = !this.walking;
      if (Math.hypot(next.x - f.x, next.y - f.y) > 1)
        void this.commit(
          [{ type: "update", collection: "furniture", id: f.id, patch: next }],
          "三维拖动对象",
          base,
        );
    });
    canvas.addEventListener("pointercancel", () => {
      if (this.drag) this.preview(this.drag.f);
      this.drag = undefined;
      this.controls.enabled = !this.walking;
    });
    canvas.addEventListener("pointerdown", (e) => {
      if (this.walking) this.walkDown = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener("pointerup", () => (this.walkDown = undefined));
    canvas.addEventListener("pointermove", (e) => {
      if (this.walking && this.walkDown) {
        this.yaw -= (e.clientX - this.walkDown.x) * 0.004;
        this.pitch = Math.max(
          -1.3,
          Math.min(1.3, this.pitch - (e.clientY - this.walkDown.y) * 0.004),
        );
        this.walkDown = { x: e.clientX, y: e.clientY };
      }
    });
    canvas.addEventListener("click", (e) => {
      if (this.walking) return;
      // Browsers do not always synthesize dblclick after pointer capture, so
      // detect a second click within 350 ms ourselves as well.
      const now = performance.now();
      if (
        this.lastClick &&
        now - this.lastClick.t < 350 &&
        Math.hypot(e.clientX - this.lastClick.x, e.clientY - this.lastClick.y) <
          12
      ) {
        this.lastClick = undefined;
        if (this.toggleAt(e)) return;
      }
      this.lastClick = { t: now, x: e.clientX, y: e.clientY };
      const hit = this.rayAt(e)
        .intersectObjects(this.root.children, true)
        .find(
          (h) =>
            h.object.userData.fid ||
            h.object.userData.objectId ||
            h.object.userData.wallId,
        );
      if (hit) {
        const collection = (hit.object.userData.collection ||
          (hit.object.userData.wallId ? "walls" : "furniture")) as
          | "openings"
          | "furniture";
        const id =
          hit.object.userData.fid ||
          hit.object.userData.objectId ||
          hit.object.userData.wallId;
        this.lastSelected = { id, collection };
        this.select(id, collection);
      }
    });
    canvas.addEventListener("dblclick", (e) => {
      if (this.walking) return;
      if (this.toggleAt(e)) e.preventDefault();
    });
    window.addEventListener("keydown", (e) => {
      if (
        !this.walking ||
        /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName)
      )
        return;
      this.keys.add(e.code);
      if (e.code === "Escape") this.setWalking(false);
      if (
        [
          "KeyW",
          "KeyA",
          "KeyS",
          "KeyD",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
        ].includes(e.code)
      )
        e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
    window.addEventListener("keydown", (e) => {
      if (
        e.code !== "KeyE" ||
        /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName)
      )
        return;
      if (this.walking) {
        e.preventDefault();
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
        const hit = ray
          .intersectObjects(this.root.children, true)
          .find(
            (h) =>
              h.distance <= 2.5 &&
              (h.object.userData.fid || h.object.userData.objectId),
          );
        if (hit) {
          const collection = (hit.object.userData.collection ||
            (hit.object.userData.fid ? "furniture" : "openings")) as
            | "openings"
            | "furniture";
          this.toggleInteractive(
            hit.object.userData.fid || hit.object.userData.objectId,
            collection,
          );
        }
      } else if (this.lastSelected) {
        e.preventDefault();
        this.toggleInteractive(
          this.lastSelected.id,
          this.lastSelected.collection,
        );
      }
    });
    this.renderer.setAnimationLoop(() => {
      const dt = Math.min(this.clock.getDelta(), 0.05);
      if (this.walking) this.walk(dt);
      else this.controls.update();
      if (this.host.clientWidth) this.renderer.render(this.scene, this.camera);
    });
  }
  resize() {
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
  box(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
    root: THREE.Object3D = this.root,
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  }
  material(options: THREE.MeshStandardMaterialParameters) {
    const m = new THREE.MeshStandardMaterial(options);
    this.transientMaterials.push(m);
    return m;
  }
  texture(key: string, wall = false) {
    const cache = (wall ? "wall:" : "floor:") + key;
    if (!this.textures.has(cache)) {
      const texture = new THREE.CanvasTexture(wall ? Lu(key) : zd(key));
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 4;
      this.textures.set(cache, texture);
    }
    return this.textures.get(cache)!;
  }
  mapFloor(mesh: THREE.Mesh, tile: number) {
    const p = mesh.geometry.getAttribute("position"),
      uv = mesh.geometry.getAttribute("uv");
    for (let i = 0; i < p.count; i++)
      uv.setXY(
        i,
        (p.getX(i) + mesh.position.x) / tile,
        (p.getZ(i) + mesh.position.z) / tile,
      );
    uv.needsUpdate = true;
  }
  async rebuild(plan: Plan, base: EditBase) {
    const generation = ++this.generation;
    await ensureAssets([
      ...new Set(
        plan.furniture.filter((f) => f.modelId).map((f) => f.modelId!),
      ),
    ]);
    if (generation !== this.generation) return;
    this.plan = plan;
    this.base = base;
    this.clearSelection();
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh && !o.geometry.userData.shared)
        o.geometry.dispose();
    });
    this.transientMaterials.forEach((m) => m.dispose());
    this.transientMaterials = [];
    this.transientTextures.forEach((t) => t.dispose());
    this.transientTextures = [];
    this.root.clear();
    this.furniture.clear();
    const geo = wallGeometry(plan),
      rooms = detectRooms(plan, geo);
    for (const room of rooms.regions) {
      const label = room.labels[0],
        key = (Ko as any)[label?.mat] ? label.mat : "oak",
        recipe = (Ko as any)[key];
      let map = this.texture(key);
      if (label?.tile) {
        map = new THREE.CanvasTexture(qC(room, Gr(label.tile)));
        map.colorSpace = THREE.SRGBColorSpace;
        map.anisotropy = 4;
        this.transientTextures.push(map);
      }
      const mat = this.material({ map, roughness: recipe.rough });
      for (const rect of room.rects) {
        const mesh = this.box(
          rect.w / 1000,
          0.025,
          rect.h / 1000,
          (rect.x + rect.w / 2) / 1000,
          -0.025,
          (rect.y + rect.h / 2) / 1000,
          mat,
        );
        if (label?.tile) {
          const p = mesh.geometry.getAttribute("position"),
            uv = mesh.geometry.getAttribute("uv");
          for (let i = 0; i < p.count; i++)
            uv.setXY(
              i,
              ((p.getX(i) + mesh.position.x) * 1000 - room.bb.x) / room.bb.w,
              1 -
                ((p.getZ(i) + mesh.position.z) * 1000 - room.bb.y) / room.bb.h,
            );
          uv.needsUpdate = true;
        } else this.mapFloor(mesh, recipe.tile / 1000);
      }
      const ceiling = ei(label);
      if (ceiling.type !== "none") {
        const cm = this.material({ color: "#f4f1eb", side: THREE.FrontSide });
        const plane = (
          w: number,
          d: number,
          x: number,
          z: number,
          angle = 0,
        ) => {
          const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), cm);
          mesh.rotation.set(Math.PI / 2, 0, 0);
          const group = new THREE.Group();
          group.userData.evidenceCeiling = true;
          group.add(mesh);
          group.position.set(x, (plan.height - ceiling.drop) / 1000, z);
          group.rotation.y = angle;
          this.root.add(group);
          return group;
        };
        if (ceiling.type === "flat")
          for (const rect of room.rects)
            plane(
              rect.w / 1000,
              rect.h / 1000,
              (rect.x + rect.w / 2) / 1000,
              (rect.y + rect.h / 2) / 1000,
            );
        else
          for (const g of geo.active)
            for (const side of [-1, 1]) {
              const p = {
                x: (g.a.x + g.b.x) / 2 + g.n.x * side * (g.ht + 30),
                y: (g.a.y + g.b.y) / 2 + g.n.y * side * (g.ht + 30),
              };
              if (
                !room.rects.some(
                  (r: any) =>
                    p.x >= r.x &&
                    p.x <= r.x + r.w &&
                    p.y >= r.y &&
                    p.y <= r.y + r.h,
                )
              )
                continue;
              const width = ceiling.edgeW || 400,
                x = (g.a.x + g.b.x) / 2 + g.n.x * side * (g.ht + width / 2),
                y = (g.a.y + g.b.y) / 2 + g.n.y * side * (g.ht + width / 2),
                group = plane(
                  g.len / 1000,
                  width / 1000,
                  x / 1000,
                  y / 1000,
                  -Math.atan2(g.u.y, g.u.x),
                );
              if (ceiling.cove) {
                const light = this.material({
                  color: "#fff1c9",
                  emissive: "#ffbd69",
                  emissiveIntensity: 2,
                });
                this.box(
                  g.len / 1000,
                  0.015,
                  0.015,
                  0,
                  -0.01,
                  (side * width) / 2000,
                  light,
                  group,
                );
              }
            }
      }
    }
    if (!rooms.regions.length)
      this.box(
        30,
        0.02,
        30,
        0,
        -0.03,
        0,
        new THREE.MeshStandardMaterial({ color: "#dce1e3" }),
      );
    for (const g of geo.active) {
      const w = g.w,
        group = new THREE.Group();
      group.position.set(g.a.x / 1000, 0, g.a.y / 1000);
      group.rotation.y = -Math.atan2(g.u.y, g.u.x);
      this.root.add(group);
      const roomOnSide = (side: number) => {
        const x = (g.a.x + g.b.x) / 2 + g.n.x * side * (g.ht + 30),
          y = (g.a.y + g.b.y) / 2 + g.n.y * side * (g.ht + 30);
        return rooms.regions.find((r: any) =>
          r.rects.some(
            (p: any) =>
              x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h,
          ),
        )?.labels[0];
      };
      const wallKey = Ps(roomOnSide(1) || roomOnSide(-1)),
        finish = (Qu as any)[wallKey];
      const mat = this.material({
        color: w.color || finish.color,
        roughness: 0.9,
        ...(finish.tex ? { map: this.texture(finish.tex, true) } : {}),
      });
      const height = (w.h || plan.height) / 1000,
        thickness = w.t / 1000,
        holes = plan.openings
          .filter((o) => o.wall === w.id)
          .sort((a, b) => a.pos - b.pos);
      let from = -g.extA;
      const panel = (a: number, b: number, bottom: number, top: number) => {
        if (b - a > 0.1 && top - bottom > 0.1) {
          const mesh = this.box(
            (b - a) / 1000,
            (top - bottom) / 1000,
            thickness,
            (a + b) / 2000,
            bottom / 1000,
            0,
            mat,
            group,
          );
          mesh.userData.wallId = w.id;
        }
      };
      for (const o of holes) {
        const lo = o.pos - o.width / 2,
          hi = o.pos + o.width / 2;
        panel(from, lo, 0, height * 1000);
        panel(lo, hi, 0, o.sill);
        panel(lo, hi, o.head, height * 1000);
        from = hi;
        const trim = new THREE.MeshStandardMaterial({
            color: "#697986",
            roughness: 0.5,
          }),
          glass = new THREE.MeshStandardMaterial({
            color: "#b6daea",
            transparent: true,
            opacity: 0.26,
            roughness: 0.1,
            side: THREE.DoubleSide,
          });
        const bottom = o.sill / 1000,
          top = o.head / 1000,
          span = o.width / 1000,
          opening = new THREE.Group();
        group.add(opening);
        this.box(
          span,
          0.035,
          0.055,
          o.pos / 1000,
          top - 0.035,
          0,
          trim,
          opening,
        );
        for (const x of [lo / 1000, hi / 1000])
          this.box(0.035, top - bottom, 0.055, x, bottom, 0, trim, opening);
        if (o.sill > 0 || /window|Window|glass|bay/i.test(o.type)) {
          this.box(span, 0.035, 0.055, o.pos / 1000, bottom, 0, trim, opening);
          this.box(
            span,
            top - bottom,
            0.018,
            o.pos / 1000,
            bottom,
            0,
            glass,
            opening,
          );
        }
        const leaf = this.material({
          color: o.color || "#bca180",
          roughness: 0.65,
        });
        if (["door", "double", "unequal"].includes(o.type)) {
          const widths =
            o.type === "double"
              ? [span / 2, span / 2]
              : o.type === "unequal"
                ? [span * 0.7, span * 0.3]
                : [span];
          let edge = lo / 1000;
          widths.forEach((width, index) => {
            const right = widths.length === 2 ? index === 1 : !!o.hinge,
              pivot = new THREE.Group();
            pivot.position.set(right ? edge + width : edge, 0, 0);
            pivot.rotation.y = o.open
              ? ((right ? 1 : -1) * (o.side || 1) * Math.PI) / 2
              : 0;
            opening.add(pivot);
            const x = ((right ? -1 : 1) * width) / 2;
            this.box(
              Math.max(0.01, width - 0.025),
              top - bottom - 0.025,
              0.04,
              x,
              bottom + 0.01,
              0,
              leaf,
              pivot,
            );
            this.box(
              0.025,
              0.13,
              0.035,
              (right ? -1 : 1) * (width - 0.09),
              bottom + 1,
              0.04,
              trim,
              pivot,
            );
            edge += width;
          });
        } else if (["sliding", "pocket", "folding"].includes(o.type)) {
          const count = o.type === "pocket" ? 1 : o.type === "folding" ? 4 : 2,
            width = span / count;
          for (let i = 0; i < count; i++) {
            const x =
              lo / 1000 +
              width * (i + 0.5) +
              (o.open
                ? o.type === "pocket"
                  ? o.hinge
                    ? -span
                    : span
                  : o.type === "sliding"
                    ? i === 0
                      ? width
                      : 0
                    : -i * width * 0.8
                : 0);
            const mesh = this.box(
              width - 0.015,
              top - bottom - 0.03,
              0.035,
              x,
              bottom + 0.01,
              (i % 2) * 0.045,
              o.type === "sliding" ? glass : leaf,
              opening,
            );
            if (o.type === "folding" && o.open)
              mesh.rotation.y = (i % 2 ? 1 : -1) * 1.3;
          }
        } else if (o.type === "garage") {
          const shutter = new THREE.Group();
          shutter.position.set(o.pos / 1000, top, 0);
          shutter.rotation.x = o.open ? (-(o.side || 1) * Math.PI) / 2 : 0;
          opening.add(shutter);
          const h = top - bottom;
          for (let y = 0; y < h; y += 0.14)
            this.box(span, 0.125, 0.04, 0, -h + y, 0, trim, shutter);
        }
        opening.traverse((mesh) =>
          Object.assign(mesh.userData, {
            objectId: o.id,
            collection: "openings",
          }),
        );
      }
      panel(from, g.len + g.extB, 0, height * 1000);
      for (const side of [-1, 1]) {
        const label = roomOnSide(side);
        if (!label) continue;
        const finish = (Qu as any)[Ps(label)];
        const surface = this.material({
          color: w.color || finish.color,
          roughness: 0.9,
          ...(finish.tex ? { map: this.texture(finish.tex, true) } : {}),
        });
        const surfacePanel = (
          a: number,
          b: number,
          bottom: number,
          top: number,
        ) => {
          if (b <= a || top <= bottom) return;
          const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry((b - a) / 1000, (top - bottom) / 1000),
            surface,
          );
          mesh.position.set(
            (a + b) / 2000,
            (top + bottom) / 2000,
            side * (g.ht / 1000 + 0.001),
          );
          if (side < 0) mesh.rotation.y = Math.PI;
          group.add(mesh);
          mesh.userData.wallId = w.id;
        };
        let position = -g.extA;
        for (const o of holes) {
          const lo = o.pos - o.width / 2,
            hi = o.pos + o.width / 2;
          surfacePanel(position, lo, 0, height * 1000);
          surfacePanel(lo, hi, 0, o.sill);
          surfacePanel(lo, hi, o.head, height * 1000);
          position = hi;
        }
        surfacePanel(position, g.len + g.extB, 0, height * 1000);
        const skirting = Hd(label);
        if (skirting !== "none") {
          const sk = this.material({
              color: skirting === "metal" ? "#6c7175" : "#ad8862",
              roughness: 0.6,
            }),
            skh = skirting === "metal" ? 0.04 : 0.08;
          let start = 0;
          for (const o of [
            ...holes.filter((o) => o.sill === 0),
            { pos: g.len, width: 0 },
          ]) {
            const end = o.pos - o.width / 2;
            if (end > start)
              this.box(
                (end - start) / 1000,
                skh,
                0.015,
                (start + end) / 2000,
                0,
                side * (g.ht / 1000 + 0.008),
                sk,
                group,
              );
            start = o.pos + o.width / 2;
          }
        }
      }
    }
    for (const f of plan.structs) {
      const mat = this.material({ color: f.color || "#c4c5c0" });
      const mesh = this.box(
        f.w / 1000,
        (f.h || plan.height) / 1000,
        f.d / 1000,
        f.x / 1000,
        (f.z || 0) / 1000,
        f.y / 1000,
        mat,
      );
      mesh.rotation.y = (-(f.rot || 0) * Math.PI) / 180;
      Object.assign(mesh.userData, { objectId: f.id, collection: "structs" });
    }
    for (const b of plan.beams) {
      const a = plan.nodes.find((n) => n.id === b.a) || b.a,
        c = plan.nodes.find((n) => n.id === b.b) || b.b;
      if (a?.x !== undefined && c?.x !== undefined) {
        const length = Math.hypot(c.x - a.x, c.y - a.y),
          depth = b.depth || b.h || 400;
        const m = this.box(
          length / 1000,
          depth / 1000,
          (b.w || b.t || 250) / 1000,
          (a.x + c.x) / 2000,
          (b.z ?? plan.height - depth) / 1000,
          (a.y + c.y) / 2000,
          this.material({ color: "#dedbd2" }),
        );
        m.rotation.y = -Math.atan2(c.y - a.y, c.x - a.x);
      }
    }
    const stylized = ["diorama", "colorplan"].includes(plan.look?.style);
    Ba.on = !stylized || plan.look?.round !== false;
    Ba.max = stylized ? 0.03 : 0.012;
    Ba.k = stylized ? 0.3 : 0.18;
    for (const f of plan.furniture) {
      j0.set(f.id, f.opt?.on !== false);
      Cp.set(f.id, f.opt?.on === false ? 0 : 1);
      const group = Ov(f, plan) as THREE.Group;
      const label = rooms.regions.find((r: any) =>
          r.rects.some(
            (p: any) =>
              f.x >= p.x && f.x <= p.x + p.w && f.y >= p.y && f.y <= p.y + p.h,
          ),
        )?.labels[0],
        ceiling = ei(label);
      group.position.set(
        f.x / 1000,
        furnitureElevation(f, plan, rooms.regions) / 1000,
        f.y / 1000,
      );
      group.rotation.y = (-f.rot * Math.PI) / 180;
      group.traverse((o) => {
        o.userData.fid = f.id;
        o.userData.collection = "furniture";
        if (f.type === "model" && o instanceof THREE.Mesh) {
          for (const m of Array.isArray(o.material)
            ? o.material
            : [o.material]) {
            if ("color" in m)
              m.color.multiply(new THREE.Color(f.opt?.tint || "#ffffff"));
            this.transientMaterials.push(m);
          }
        }
      });
      this.root.add(group);
      this.furniture.set(f.id, group);
    }
    this.drawActionEnvelopes(plan);
    this.resize();
  }

  private drawActionEnvelopes(plan: Plan) {
    for (const child of [...this.envelopeLayer.children]) {
      this.envelopeLayer.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        const material = child.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material.dispose();
      }
    }
    const blocked = new Set(
      checkScene(plan)
        .issues.filter((issue) =>
          ["OPENABLE_FRONT_BLOCKED", "DOOR_CABINET_CONFLICT"].includes(
            issue.code,
          ),
        )
        .flatMap((issue) => issue.objectIds),
    );
    for (const f of plan.furniture) {
      if (f.opt?.open !== true && f.id !== this.highlightedId) continue;
      const envelope = openEnvelope(f);
      if (!envelope) continue;
      const shape = new THREE.Shape();
      envelope.polygon.forEach((point, index) => {
        if (index === 0) shape.moveTo(point.x / 1000, -point.y / 1000);
        else shape.lineTo(point.x / 1000, -point.y / 1000);
      });
      shape.closePath();
      const geometry = new THREE.ShapeGeometry(shape);
      geometry.rotateX(-Math.PI / 2);
      const warn = blocked.has(f.id);
      const color = warn ? "#d97945" : "#2c9a8e";
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: warn ? 0.22 : 0.14,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      mesh.position.y = 0.005;
      mesh.renderOrder = 1;
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: warn ? 0.95 : 0.75,
          depthWrite: false,
        }),
      );
      edges.position.y = 0.006;
      this.envelopeLayer.add(mesh, edges);
    }
  }
  frame() {
    if (!this.plan) return;
    const b = new THREE.Box3().setFromObject(this.root),
      size = b.getSize(new THREE.Vector3()),
      center = b.getCenter(new THREE.Vector3());
    const r = Math.max(size.x, size.z, 4) * Math.max(1, 1 / this.camera.aspect);
    this.camera.position
      .copy(center)
      .add(new THREE.Vector3(r * 0.9, r * 0.95, r * 0.9));
    this.controls.target.copy(center);
    this.controls.update();
  }
  highlight(id?: string) {
    this.clearSelection();
    this.highlightedId = id;
    if (id && this.furniture.has(id)) {
      this.selected = new THREE.BoxHelper(this.furniture.get(id)!, 0x17888b);
      this.scene.add(this.selected);
    }
    if (this.plan) this.drawActionEnvelopes(this.plan);
  }
  clearSelection() {
    this.highlightedId = undefined;
    if (this.selected) {
      this.scene.remove(this.selected);
      this.selected.geometry.dispose();
      (this.selected.material as THREE.Material).dispose();
      this.selected = undefined;
    }
  }
  rayAt(e: { clientX: number; clientY: number }) {
    const r = this.renderer.domElement.getBoundingClientRect(),
      ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        (-(e.clientY - r.top) / r.height) * 2 + 1,
      ),
      this.camera,
    );
    return ray;
  }
  toggleAt(e: { clientX: number; clientY: number }) {
    const hit = this.rayAt(e)
      .intersectObjects(this.root.children, true)
      .find(
        (h) =>
          h.object.userData.objectId ||
          h.object.userData.fid ||
          h.object.userData.wallId,
      );
    if (!hit) return false;
    const collection = (
      hit.object.userData.collection ||
      (hit.object.userData.fid ? "furniture" : "openings")
    ) as "openings" | "furniture";
    const id = hit.object.userData.fid || hit.object.userData.objectId;
    return this.toggleInteractive(id, collection);
  }
  toggleInteractive(
    id: string,
    collection: "openings" | "furniture",
  ): boolean {
    if (!this.plan) return false;
    const command = toggleActionCommand(this.plan, collection, id);
    if (!command) return false;
    void this.commit(
      [command],
      collection === "openings" ? "开关门扇" : "开关柜门/抽屉/电器",
    );
    return true;
  }
  preview(f: Furniture) {
    const g = this.furniture.get(f.id);
    if (g) {
      g.position.x = f.x / 1000;
      g.position.z = f.y / 1000;
      g.rotation.y = (-f.rot * Math.PI) / 180;
      this.selected?.update();
    }
  }
  setWalking(on: boolean) {
    if (on === this.walking) return;
    this.walking = on;
    this.controls.enabled = !on;
    this.keys.clear();
    if (on) {
      this.orbitSave = {
        position: this.camera.position.clone(),
        target: this.controls.target.clone(),
      };
      const room = this.plan?.rooms[0];
      this.camera.position.set(
        (room?.x || 0) / 1000,
        1.65,
        (room?.y || 0) / 1000,
      );
      this.yaw = Math.PI;
      this.pitch = 0;
      this.report("漫游中：WASD 移动，左右方向键转向，拖动视图环顾，Esc 退出");
    } else if (this.orbitSave) {
      this.camera.position.copy(this.orbitSave.position);
      this.controls.target.copy(this.orbitSave.target);
      this.controls.update();
      this.report("已退出漫游");
    }
    this.host.classList.toggle("walking", on);
  }
  walk(dt: number) {
    const turn =
      (Number(this.keys.has("ArrowLeft")) -
        Number(this.keys.has("ArrowRight"))) *
      dt *
      1.5;
    this.yaw += turn;
    const forward =
        Number(this.keys.has("KeyW") || this.keys.has("ArrowUp")) -
        Number(this.keys.has("KeyS") || this.keys.has("ArrowDown")),
      side = Number(this.keys.has("KeyD")) - Number(this.keys.has("KeyA"));
    const next = this.camera.position.clone();
    next.x +=
      (side * Math.cos(this.yaw) - forward * Math.sin(this.yaw)) * dt * 1.7;
    next.z +=
      (-side * Math.sin(this.yaw) - forward * Math.cos(this.yaw)) * dt * 1.7;
    const p = { x: next.x * 1000, y: next.z * 1000 };
    let blocked = false,
      floor = 0;
    if (this.plan) {
      const geo = wallGeometry(this.plan);
      for (const g of geo.active) {
        const hit = projectToWall(p, g.a, g.b);
        if (
          hit.t >= 0 &&
          hit.t <= 1 &&
          hit.d < g.ht + 160 &&
          !this.plan.openings.some(
            (o) =>
              o.wall === g.w.id &&
              o.sill === 0 &&
              (o.type === "hole" || o.open) &&
              Math.abs(hit.along - o.pos) < o.width / 2 - 160,
          )
        )
          blocked = true;
      }
      for (const f of this.plan.furniture)
        if (f.opt?.floor && pointInPolygon(p, footprint(f)))
          floor = Math.max(floor, (f.z || 0) + f.h);
    }
    if (!blocked) {
      this.camera.position.x = next.x;
      this.camera.position.z = next.z;
      this.camera.position.y = 1.65 + floor / 1000;
    }
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
