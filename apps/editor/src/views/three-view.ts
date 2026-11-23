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
  openableSpec,
  checkScene,
  toggleActionCommand,
  type Plan,
  type Furniture,
  type Command,
} from "../../../../packages/scene-core/src/index.js";
import { Ov, Ba, j0, Cp } from "../modeling/furniture-3d.js";
import { ensureAssets } from "../modeling/asset-cache.js";
import { ensureHeroAssets, heroAssetFor } from "../modeling/hero-assets.js";
import { applySurfaceRecipe } from "../modeling/surface-materials.js";
import { WebGLPathTracer } from "three-gpu-pathtracer";
import { Ko, zd, Qu, Lu, Ps, ei, Hd, qC } from "../modeling/surfaces.js";
import { Gr } from "../../../../packages/scene-core/src/inherited/footprints.js";
import type { EditBase } from "../api.js";
import { displayRoomName } from "../ui/labels.js";
import { RealismPipeline, createWindowLight } from "./realism.js";
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
  private interactionLayer = new THREE.Group();
  private roomLabels: THREE.Sprite[] = [];
  private walkHighlight?: THREE.BoxHelper;
  private interactionTimer = 0;
  private lastInteraction = "";
  private textures = new Map<string, THREE.Texture>();
  private transientMaterials: THREE.Material[] = [];
  private transientTextures: THREE.Texture[] = [];
  private realism?: RealismPipeline;
  private softwareRendering = false;
  private walkCeiling = new THREE.Group();
  photoTracer?: WebGLPathTracer;
  private photoReady = false;
  private photoMatrix = new THREE.Matrix4();
  private photoEnvironmentTarget?: THREE.WebGLRenderTarget;
  private drag?: {
    f: Furniture;
    base: EditBase;
    start: THREE.Vector3;
    plane: THREE.Plane;
    next: { x: number; y: number };
    startClient: { x: number; y: number };
    moved: boolean;
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
    public onWalkChange?: (on: boolean) => void,
    public onInteractionChange?: (info?: { label: string }) => void,
    public onInteractionNotice?: (text: string) => void,
    options: { realism?: boolean } = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
    });
    const gl = this.renderer.getContext();
    const rendererInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const rendererName = String(
      rendererInfo
        ? gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
    );
    const software = /swiftshader|llvmpipe|softpipe|software/i.test(rendererName);
    const params = new URLSearchParams(location.search);
    const forceRealism = params.has("realism") || params.has("pathtrace");
    const useRealism = options.realism && (!software || forceRealism);
    this.softwareRendering = software && !useRealism;
    this.renderer.setPixelRatio(
      software ? 1 : Math.min(devicePixelRatio, useRealism ? 1.5 : 2),
    );
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = useRealism ? 1.05 : 1.25;
    host.append(this.renderer.domElement);
    this.renderer.domElement.dataset.testid = "three-canvas";
    this.scene.background = new THREE.Color(
      useRealism ? "#d9d5ce" : "#e9e3d8",
    );
    this.scene.add(
      new THREE.HemisphereLight(
        "#fff8ef",
        "#7d8790",
        useRealism ? 0.85 : 2.4,
      ),
    );
    const sun = new THREE.DirectionalLight(
      "#fff4e0",
      useRealism ? 2.2 : 2.8,
    );
    sun.position.set(8, 14, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(
      software ? 1024 : useRealism ? 4096 : 2048,
      software ? 1024 : useRealism ? 4096 : 2048,
    );
    Object.assign(sun.shadow.camera, {
      left: -20,
      right: 20,
      top: 20,
      bottom: -20,
      near: 0.1,
      far: 60,
    });
    sun.shadow.bias = useRealism ? -0.0001 : -0.0003;
    sun.shadow.normalBias = useRealism ? 0.02 : 0;
    this.scene.add(sun, this.root);
    this.envelopeLayer.name = "open-envelopes";
    this.scene.add(this.envelopeLayer);
    this.interactionLayer.name = "walk-interactions";
    this.interactionLayer.visible = false;
    this.scene.add(this.interactionLayer);
    this.camera.position.set(13, 12, 15);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(4.5, 0, 3);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    if (useRealism) {
      this.realism = new RealismPipeline(this.renderer, this.scene, this.camera);
    }
    if (params.has("pathtrace")) {
      const compatibleScene = THREE.Scene.prototype as any;
      compatibleScene.backgroundRotation ??= new THREE.Euler();
      compatibleScene.environmentRotation ??= new THREE.Euler();
      this.photoTracer = new WebGLPathTracer(this.renderer);
      this.photoTracer.bounces = 5;
      this.photoTracer.transmissiveBounces = 3;
      this.photoTracer.renderScale = 0.5;
      this.photoTracer.minSamples = 1;
      this.photoTracer.dynamicLowRes = false;
      const background = this.scene.userData.realismBackground as THREE.Texture | undefined;
      if (background) this.scene.environment = background;
    }
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
          startClient: { x: e.clientX, y: e.clientY },
          moved: false,
        };
        this.controls.enabled = false;
        canvas.setPointerCapture(e.pointerId);
      },
      true,
    );
    canvas.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      if (!this.drag.moved) {
        if (
          Math.hypot(
            e.clientX - this.drag.startClient.x,
            e.clientY - this.drag.startClient.y,
          ) < 3
        )
          return;
        this.drag.moved = true;
      }
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
      const { f, next, base, moved } = this.drag;
      this.drag = undefined;
      this.controls.enabled = !this.walking;
      if (moved && Math.hypot(next.x - f.x, next.y - f.y) > 1)
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
        if (
          !this.toggleInteractive(
            this.lastSelected.id,
            this.lastSelected.collection,
          )
        )
          this.report("该对象没有可开启的柜门/抽屉；请先选中电视柜等可开启家具");
      } else {
        this.report("请先点击选中电视柜、柜门或抽屉，再按 E");
      }
    });
    this.renderer.setAnimationLoop(() => {
      const dt = Math.min(this.clock.getDelta(), 0.05);
      if (this.walking) {
        this.walk(dt);
        this.interactionTimer += dt;
        if (this.interactionTimer >= 0.16) {
          this.interactionTimer = 0;
          this.checkWalkInteraction();
        }
      } else this.controls.update();
      if (this.host.clientWidth) {
        const stylized = ["diorama", "colorplan"].includes(this.plan?.look?.style);
        if (!stylized && this.photoTracer && this.photoReady) {
          if (!this.photoMatrix.equals(this.camera.matrixWorld)) {
            this.photoMatrix.copy(this.camera.matrixWorld);
            this.photoTracer.updateCamera();
          }
          this.photoTracer.renderSample();
        } else if (!stylized && this.realism) this.realism.render();
        else this.renderer.render(this.scene, this.camera);
      }
    });
  }
  resize() {
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.realism?.setSize(w, h);
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
  private applyFallbackMaterials(root: THREE.Object3D) {
    const replacements = new Map<string, THREE.Material>();
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const replace = (original: THREE.Material) => {
        if (!(original instanceof THREE.MeshStandardMaterial)) return original;
        if (replacements.has(original.uuid)) return replacements.get(original.uuid)!;
        const material = new THREE.MeshLambertMaterial({
          color: original.color,
          map: original.map,
          transparent: original.transparent,
          opacity: original.opacity,
          side: original.side,
          alphaTest: original.alphaTest,
          emissive: original.emissive,
          emissiveIntensity: original.emissiveIntensity,
          depthWrite: original.depthWrite,
        });
        replacements.set(original.uuid, material);
        this.transientMaterials.push(material);
        return material;
      };
      object.material = Array.isArray(object.material)
        ? object.material.map(replace)
        : replace(object.material);
    });
  }

  material(
    options: THREE.MeshStandardMaterialParameters,
    detail?: "floor" | "wall",
  ) {
    if (this.realism && detail) {
      const prefix = detail === "floor" ? "wood_floor" : "painted_plaster_wall";
      options.normalMap = this.imageTexture(`${prefix}_nor_gl_1k.jpg`);
      options.roughnessMap = this.imageTexture(`${prefix}_rough_1k.jpg`);
      options.normalScale = new THREE.Vector2(
        detail === "floor" ? 0.45 : 0.18,
        detail === "floor" ? 0.45 : 0.18,
      );
      options.roughness = 1;
    }
    const m = new THREE.MeshStandardMaterial(options);
    this.transientMaterials.push(m);
    return m;
  }
  imageTexture(file: string, color = false) {
    const cache = `image:${file}`;
    if (!this.textures.has(cache)) {
      const texture = new THREE.TextureLoader().load(`/textures/${file}`);
      if (color) texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = Math.min(
        8,
        this.renderer.capabilities.getMaxAnisotropy(),
      );
      this.textures.set(cache, texture);
    }
    return this.textures.get(cache)!;
  }
  texture(key: string, wall = false) {
    const cache = (wall ? "wall:" : "floor:") + key;
    if (!this.textures.has(cache)) {
      const photographic =
        this.realism && !wall && ["oak", "wood", "walnut"].includes(key);
      const texture = photographic
        ? this.imageTexture("wood_floor_diff_1k.jpg", true)
        : new THREE.CanvasTexture(wall ? Lu(key) : zd(key));
      if (photographic) {
        this.textures.set(cache, texture);
        return texture;
      }
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
    await Promise.all([
      ensureAssets([
        ...new Set(
          plan.furniture.filter((f) => f.modelId).map((f) => f.modelId!),
        ),
      ]),
      ensureHeroAssets(plan.furniture.map((f) => f.key)),
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
    this.roomLabels = [];
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
      const mat = this.material({ map, roughness: recipe.rough }, "floor");
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
      if (plan.rooms.length > 1 && label) {
        const title = displayRoomName(
          plan.rooms.find((r) => r.id === label.id) || label,
        );
        const area = Math.round((room.bb.w * room.bb.h) / 100000) / 10;
        const sprite = this.roomSprite(`${title}  ${area}㎡`);
        sprite.position.set(
          (room.bb.x + room.bb.w / 2) / 1000,
          1.9,
          (room.bb.y + room.bb.h / 2) / 1000,
        );
        this.root.add(sprite);
        this.roomLabels.push(sprite);
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
      }, "wall");
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
          glass = this.realism
            ? new THREE.MeshPhysicalMaterial({
                color: "#ffffff",
                transparent: false,
                opacity: 1,
                roughness: 0.03,
                transmission: 0.92,
                thickness: 0.008,
                ior: 1.45,
                depthWrite: false,
                side: THREE.DoubleSide,
              })
            : new THREE.MeshStandardMaterial({
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
        if (this.realism && /window|Window|glass|bay/i.test(o.type)) {
          const side = roomOnSide(1) ? 1 : -1;
          const light = createWindowLight(span, top - bottom);
          light.position.set(o.pos / 1000, (bottom + top) / 2, side * 0.12);
          light.rotation.y = side > 0 ? Math.PI : 0;
          opening.add(light);
        }
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
        }, "wall");
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
    if (this.realism) {
      this.walkCeiling.clear();
      const material = this.material({ color: "#eeeae2", roughness: 0.92 });
      for (const room of rooms.regions) {
        for (const rect of room.rects) {
          const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(rect.w / 1000, rect.h / 1000),
            material,
          );
          mesh.rotation.x = Math.PI / 2;
          mesh.position.set(
            (rect.x + rect.w / 2) / 1000,
            plan.height / 1000 - 0.02,
            (rect.y + rect.h / 2) / 1000,
          );
          mesh.receiveShadow = true;
          this.walkCeiling.add(mesh);
        }
      }
      this.walkCeiling.visible = this.walking;
      this.root.add(this.walkCeiling);
    }
    const stylized = ["diorama", "colorplan"].includes(plan.look?.style);
    Ba.on = !stylized || plan.look?.round !== false;
    Ba.max = stylized ? 0.03 : 0.012;
    Ba.k = stylized ? 0.3 : 0.18;
    for (const f of plan.furniture) {
      j0.set(f.id, f.opt?.on !== false);
      Cp.set(f.id, f.opt?.on === false ? 0 : 1);
      const group = ((!stylized && heroAssetFor(f, (material) => this.transientMaterials.push(material))) || Ov(f, plan)) as THREE.Group;
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
        if (
          this.realism &&
          !group.userData.heroAsset &&
          f.type !== "model" &&
          o instanceof THREE.Mesh
        ) {
          for (const m of Array.isArray(o.material)
            ? o.material
            : [o.material]) {
            if (m instanceof THREE.MeshStandardMaterial) {
              applySurfaceRecipe(f, m, (file) => this.imageTexture(file));
            }
          }
        }
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
      if (f.opt?.open) this.openFrontPanels(group, f);
    }
    this.drawActionEnvelopes(plan);
    this.rebuildInteractionMarkers(plan);
    if (this.softwareRendering) this.applyFallbackMaterials(this.root);
    this.realism?.setRoomBounds(geo.bounds);
    this.realism?.tuneMaterials(this.root);
    if (this.photoTracer) {
      this.photoReady = false;
      if (this.scene.userData.realismBackground) {
        this.scene.environment = this.scene.userData.realismBackground;
      } else if (!this.photoEnvironmentTarget) {
        const generator = new THREE.PMREMGenerator(this.renderer);
        this.photoEnvironmentTarget = generator.fromEquirectangular(
          this.scene.background as THREE.Texture,
        );
        this.scene.environment = this.photoEnvironmentTarget.texture;
        generator.dispose();
      }
      try {
        this.photoTracer.setScene(this.scene, this.camera);
        this.photoReady = true;
        this.photoMatrix.copy(this.camera.matrixWorld);
      } catch (error) {
        console.error("Path tracing initialization failed", (error as Error).stack);
        this.photoTracer = undefined;
        this.report("路径追踪初始化失败，已回退实时渲染");
      }
    }
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
  private roomSprite(text: string) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fffdf8e8";
    ctx.beginPath();
    ctx.roundRect(4, 18, 504, 92, 22);
    ctx.fill();
    ctx.strokeStyle = "#b8613c55";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#1e2724";
    ctx.font = '600 32px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 256, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.transientTextures.push(texture);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    sprite.scale.set(2.0, 0.5, 1);
    sprite.renderOrder = 20;
    return sprite;
  }
  private openFrontPanels(group: THREE.Group, f: Furniture) {
    const spec = openableSpec(f);
    if (!spec) return;
    const w = f.w / 1000,
      h = f.h / 1000,
      d = f.d / 1000;
    const material = this.material({ color: f.color || "#eee9df", roughness: 0.8 });
    if (spec.mode === "drawer") {
      const drawer = new THREE.Group();
      const travel = Math.min(0.35, d * 0.6);
      drawer.position.set(0, h * 0.28, d / 2 + travel / 2);
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.86, h * 0.28, d * 0.58),
        material,
      );
      box.castShadow = true;
      box.userData.fid = f.id;
      box.userData.collection = "furniture";
      drawer.add(box);
      group.add(drawer);
      return;
    }
    const count = w > 1.35 ? 2 : 1;
    const panelW = (w / count) * 0.92,
      panelH = h * 0.86;
    for (let i = 0; i < count; i++) {
      const left = i === 0;
      const pivot = new THREE.Group();
      pivot.position.set(
        left ? -w / 2 : w / 2,
        panelH / 2 + 0.02,
        d / 2 + 0.012,
      );
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(panelW, panelH, 0.018),
        material,
      );
      panel.position.x = (left ? 1 : -1) * panelW / 2;
      panel.castShadow = true;
      panel.userData.fid = f.id;
      panel.userData.collection = "furniture";
      pivot.add(panel);
      if (spec.mode === "slide") {
        pivot.position.x += (left ? -1 : 1) * w * 0.32;
      } else {
        pivot.rotation.y = (left ? 1 : -1) * (Math.PI * 0.44);
      }
      group.add(pivot);
    }
  }
  private markerSprite() {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 96;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, 96, 96);
    ctx.fillStyle = "#b8613c";
    ctx.beginPath();
    ctx.arc(48, 48, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fffdf8";
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = "#fffdf8";
    ctx.font = '700 42px "Avenir Next",sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("E", 48, 51);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.transientTextures.push(texture);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    sprite.scale.set(0.2, 0.2, 1);
    sprite.renderOrder = 30;
    return sprite;
  }
  private rebuildInteractionMarkers(plan: Plan) {
    this.interactionLayer.clear();
    for (const f of plan.furniture) {
      if (!toggleActionCommand(plan, "furniture", f.id)) continue;
      const marker = this.markerSprite();
      marker.position.set(f.x / 1000, (f.z || 0) / 1000 + f.h / 1000 + 0.3, f.y / 1000);
      this.interactionLayer.add(marker);
    }
    // Doors/windows are togglable too; place their E marker on the wall line.
    const geo = wallGeometry(plan);
    for (const opening of plan.openings) {
      if (!toggleActionCommand(plan, "openings", opening.id)) continue;
      const wall = geo.active.find(
        (g) =>
          g.w.id === opening.wall ||
          g.ops.some((o: any) => o.o.id === opening.id),
      );
      if (!wall) continue;
      const marker = this.markerSprite();
      marker.position.set(
        (wall.a.x + wall.u.x * opening.pos) / 1000,
        opening.sill > 0 ? 1.75 : 1.55,
        (wall.a.y + wall.u.y * opening.pos) / 1000,
      );
      this.interactionLayer.add(marker);
    }
  }
  private walkObjectAtCenter() {
    if (!this.plan) return undefined;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const hit = ray
      .intersectObjects(this.root.children, true)
      .find(
        (h) =>
          h.distance <= 2.5 &&
          (h.object.userData.fid ||
            h.object.userData.objectId ||
            h.object.userData.wallId),
      );
    if (!hit) return undefined;
    const collection = (hit.object.userData.collection ||
      (hit.object.userData.fid ? "furniture" : "openings")) as
      | "openings"
      | "furniture";
    const id =
      hit.object.userData.fid ||
      hit.object.userData.objectId ||
      hit.object.userData.wallId;
    if (!toggleActionCommand(this.plan, collection, id)) return undefined;
    let label = "交互";
    if (collection === "furniture") {
      const f = this.plan.furniture.find((item) => item.id === id);
      if (!f) return undefined;
      const open = !!f.opt?.open;
      label = `${f.name} · ${open ? "关闭" : "打开"}`;
    } else {
      const opening = this.plan.openings.find((item) => item.id === id);
      if (!opening) return undefined;
      label = `${opening.type === "door" ? "门" : "窗"} · ${opening.open ? "关闭" : "打开"}`;
    }
    return { hit, label };
  }
  private checkWalkInteraction() {
    for (const marker of this.interactionLayer.children)
      marker.visible =
        marker.position.distanceTo(this.camera.position) < 7;
    const found = this.walkObjectAtCenter();
    if (!found) {
      this.clearWalkInteraction();
      return;
    }
    if (found.label !== this.lastInteraction) {
      this.lastInteraction = found.label;
      this.onInteractionChange?.({ label: found.label });
    }
    if (!this.walkHighlight) {
      this.walkHighlight = new THREE.BoxHelper(found.hit.object, 0xb8613c);
      this.walkHighlight.material.depthTest = false;
      this.walkHighlight.renderOrder = 40;
      this.scene.add(this.walkHighlight);
    }
  }
  walkTo(x: number, y: number) {
    if (!this.walking) return;
    this.camera.position.set(x / 1000, 1.65, y / 1000);
    this.checkWalkInteraction();
  }
  private clearWalkInteraction() {
    if (this.walkHighlight) {
      this.scene.remove(this.walkHighlight);
      this.walkHighlight.geometry.dispose();
      (this.walkHighlight.material as THREE.Material).dispose();
      this.walkHighlight = undefined;
    }
    if (this.lastInteraction) {
      this.lastInteraction = "";
      this.onInteractionChange?.(undefined);
    }
  }
  focusRoom(room: { x: number; y: number }) {
    const x = room.x / 1000,
      z = room.y / 1000;
    this.camera.position.set(x + 3.6, 3.2, z + 4.2);
    this.controls.target.set(x, 0.8, z);
    this.controls.update();
  }
  focusFurniture(id: string) {
    const f = this.plan?.furniture.find((item) => item.id === id);
    const group = this.furniture.get(id);
    if (!f || !group) return;
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.z, 1.2);
    // Stand in front of the object (rot 0 faces south) instead of possibly
    // ending up behind its back panel or inside a wall.
    const radians = (f.rot * Math.PI) / 180;
    const front = new THREE.Vector3(Math.sin(radians), 0, Math.cos(radians));
    this.camera.position
      .copy(center)
      .add(front.multiplyScalar(Math.max(2.2, r * 1.4)))
      .add(new THREE.Vector3(0, Math.max(1.5, r * 0.9), 0));
    this.controls.target.copy(center).add(new THREE.Vector3(0, 0.25, 0));
    this.controls.update();
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
    if (this.walking) {
      const entity =
        collection === "furniture"
          ? this.plan.furniture.find((f) => f.id === id)
          : this.plan.openings.find((o) => o.id === id);
      if (entity) {
        const before =
          collection === "furniture"
            ? Boolean((entity as Furniture).opt?.open)
            : Boolean((entity as any).open);
        this.onInteractionNotice?.(
          `${entity.name || (collection === "openings" ? "门" : "家具")}已${before ? "关闭" : "打开"}`,
        );
      }
    }
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
    this.interactionLayer.visible = on;
    for (const label of this.roomLabels) label.visible = !on;
    // Layout clearance envelopes are an editing aid, not part of the room.
    // Showing them in walkthrough makes an open cabinet look like a green mat.
    this.envelopeLayer.visible = !on;
    this.walkCeiling.visible = on;
    this.clearWalkInteraction();
    if (on) {
      this.orbitSave = {
        position: this.camera.position.clone(),
        target: this.controls.target.clone(),
      };
      this.camera.fov = 55;
      this.camera.updateProjectionMatrix();
      const room = this.plan?.rooms[0];
      const origin = { x: room?.x || 0, y: room?.y || 0 };
      this.camera.position.set(origin.x / 1000, 1.65, origin.y / 1000);
      const anchor = this.plan?.furniture.find((f) =>
        ["sofa", "bed", "diningTable", "desk"].includes(f.type),
      ) || this.plan?.furniture[0];
      this.yaw = anchor
        ? Math.atan2(-(anchor.x - origin.x), -(anchor.y - origin.y))
        : 0;
      this.pitch = -0.08;
      this.report("漫游中：WASD 移动，左右方向键转向，拖动视图环顾，Esc 退出");
    } else if (this.orbitSave) {
      this.camera.fov = 45;
      this.camera.updateProjectionMatrix();
      this.camera.position.copy(this.orbitSave.position);
      this.controls.target.copy(this.orbitSave.target);
      this.controls.update();
      this.report("已退出漫游");
    }
    this.host.classList.toggle("walking", on);
    this.onWalkChange?.(on);
    if (!on) this.clearWalkInteraction();
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
