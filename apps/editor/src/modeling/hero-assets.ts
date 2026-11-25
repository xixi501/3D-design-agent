import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import {
  catalog,
  furnitureStyles,
  isKitchen,
  type Furniture,
} from "../../../../packages/scene-core/src/index.js";

type MaterialRole = "primary" | "frame" | "accent" | "fixed";
type HeroManifestEntry = {
  id: string;
  source: string;
  license: string;
  file: string;
  bytes: number;
  catalogKeys: string[];
  materialRoles?: Partial<Record<MaterialRole, string[]>>;
  styles?: string[];
  excludeStyles?: string[];
  yawOffsetDeg?: number;
  interactive?: {
    kind: "lamp" | "screen";
    emissiveMaterials: string[];
    lightOffsetNormalized: [number, number, number];
    color: string;
    intensity: number;
    distance: number;
  };
};

const prototypes = new Map<string, THREE.Group>();
const pending = new Map<string, Promise<void>>();
const tintTextures = new Map<string, THREE.Texture>();
let manifest: HeroManifestEntry[] | undefined;
let manifestTask: Promise<HeroManifestEntry[]> | undefined;

async function loadManifest() {
  if (manifest) return manifest;
  if (!manifestTask) {
    manifestTask = fetch("/hero-assets/manifest.json")
      .then((response) => {
        if (!response.ok) throw new Error("英雄资产清单不可用");
        return response.json();
      })
      .then((data) => {
        manifest = data.assets;
        return manifest!;
      })
      .finally(() => (manifestTask = undefined));
  }
  return manifestTask;
}

async function loadHero(entry: HeroManifestEntry) {
  if (prototypes.has(entry.id)) return;
  if (pending.has(entry.id)) return pending.get(entry.id)!;
  const task = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(entry.file).then((gltf) => {
    const content = gltf.scene;
    const bounds = new THREE.Box3().setFromObject(content);
    const size = bounds.getSize(new THREE.Vector3());
    if (![size.x, size.y, size.z].every((value) => value > 0))
      throw new Error(`英雄资产 ${entry.id} 尺寸无效`);
    const center = bounds.getCenter(new THREE.Vector3());
    content.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
    content.userData.heroSize = [size.x, size.y, size.z];
    content.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = object.receiveShadow = true;
      object.geometry.userData.shared = true;
    });
    const root = new THREE.Group();
    root.add(content);
    prototypes.set(entry.id, root);
  });
  pending.set(entry.id, task);
  try {
    await task;
  } finally {
    pending.delete(entry.id);
  }
}

export async function ensureHeroAssets(keys: string[]) {
  const entries = (await loadManifest()).filter((entry) =>
    entry.catalogKeys.some((key) => keys.includes(key)),
  );
  const missing = entries.filter((entry) => !prototypes.has(entry.id));
  await Promise.all(entries.map(loadHero));
  return missing.length > 0;
}

function protectedFurniture(furniture: Furniture) {
  const dynamic = new Set([
    "free",
    "vanity",
    "shower",
    "kitchenIsland",
    "bendSofa",
    "curvedSofa",
    "roundTable",
    "roundCoffee",
    "ovalCoffee",
    "curveTrainingTable",
    "lDesk",
    "cornerSofa",
  ]);
  const options = furniture as any;
  return (
    furniture.cab ||
    furniture.type === "model" ||
    isKitchen(furniture) ||
    dynamic.has(furniture.type) ||
    options.steps !== undefined ||
    options.winders !== undefined ||
    options.shelves !== undefined
  );
}

function entryFor(furniture: Furniture) {
  const style = furniture.opt?.style;
  const styled = manifest?.find(
    (item) =>
      item.catalogKeys.includes(furniture.key) &&
      style &&
      item.styles?.includes(style),
  );
  const entry = styled || manifest?.find((item) => item.catalogKeys.includes(furniture.key));
  if (entry && style && entry.excludeStyles?.includes(style)) return undefined;
  return entry;
}

function materialRole(entry: HeroManifestEntry, material: THREE.Material): MaterialRole {
  for (const role of ["frame", "accent", "fixed"] as const) {
    if (entry.materialRoles?.[role]?.includes(material.name)) return role;
  }
  return "primary";
}

function tintTexture(entry: HeroManifestEntry, material: THREE.MeshStandardMaterial) {
  const key = `${entry.id}:${material.uuid}`;
  const cached = tintTextures.get(key);
  if (cached) return cached;
  const source = material.map;
  if (!source?.image) return source;
  const image = source.image as CanvasImageSource & { width: number; height: number };
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(512, image.width);
  canvas.height = Math.min(512, image.height);
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  let luminance = 0;
  let count = 0;
  for (let index = 0; index < pixels.data.length; index += 4) {
    if (pixels.data[index + 3] < 32) continue;
    luminance +=
      pixels.data[index] * 0.2126 +
      pixels.data[index + 1] * 0.7152 +
      pixels.data[index + 2] * 0.0722;
    count++;
  }
  const average = count ? luminance / count / 255 : 0.5;
  const gain = Math.max(0.45, Math.min(2.5, 0.85 / Math.max(average, 0.05)));
  for (let index = 0; index < pixels.data.length; index += 4) {
    pixels.data[index] = Math.min(255, pixels.data[index] * gain);
    pixels.data[index + 1] = Math.min(255, pixels.data[index + 1] * gain);
    pixels.data[index + 2] = Math.min(255, pixels.data[index + 2] * gain);
  }
  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = source.wrapS;
  texture.wrapT = source.wrapT;
  texture.repeat.copy(source.repeat);
  texture.offset.copy(source.offset);
  texture.anisotropy = source.anisotropy;
  tintTextures.set(key, texture);
  return texture;
}

function styleColor(furniture: Furniture, role: MaterialRole) {
  const style = furniture.opt?.style as keyof typeof furnitureStyles | undefined;
  const palette = style ? furnitureStyles[style] : undefined;
  if (palette) {
    if (role === "accent") return palette.metal;
    if (role === "frame") return palette.wood;
    if (["sofa", "armchair", "bed", "chair"].includes(furniture.type)) {
      return furniture.type === "bed" ? palette.fabric2 : palette.fabric;
    }
    return palette.wood;
  }
  const original = catalog[furniture.key]?.color?.toLowerCase();
  const current = furniture.color?.toLowerCase();
  return current && current !== original ? furniture.color : undefined;
}

export function heroAssetFor(
  furniture: Furniture,
  trackMaterial: (material: THREE.Material) => void = () => {},
) {
  if (protectedFurniture(furniture)) return null;
  const entry = entryFor(furniture);
  if (!entry) return null;
  const prototype = prototypes.get(entry.id);
  if (!prototype) return null;
  const source = prototype.children[0];
  const [x, y, z] = source.userData.heroSize as [number, number, number];
  const content = source.clone(true);
  content.scale.set(
    furniture.w / 1000 / x,
    furniture.h / 1000 / y,
    furniture.d / 1000 / z,
  );
  content.rotation.y = THREE.MathUtils.degToRad(entry.yawOffsetDeg || 0);
  const root = new THREE.Group();
  root.add(content);
  root.userData.heroAsset = entry.id;

  const isOn = furniture.opt?.on !== false;
  content.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const originals = Array.isArray(object.material) ? object.material : [object.material];
    const materials = originals.map((original) => {
      if (!(original instanceof THREE.MeshStandardMaterial)) return original;
      const role = materialRole(entry, original);
      const target = role === "fixed" ? undefined : styleColor(furniture, role);
      const interactive = entry.interactive && role !== "fixed";
      if (!target && !interactive) return original;
      const material = original.clone();
      trackMaterial(material);
      if (target && ((original.metalness < 0.45 || original.metalnessMap) || role === "accent")) {
        if (original.map) material.map = tintTexture(entry, original);
        material.color.set(target);
      }
      if (furniture.opt?.style === "cream") material.roughness = 0.9;
      if (furniture.opt?.style === "luxury") material.roughness = Math.min(material.roughness, 0.55);
      if (role === "accent") {
        material.metalness = 0.85;
        material.roughness = furniture.opt?.style === "luxury" ? 0.28 : 0.42;
      }
      if (interactive) {
        const names = entry.interactive!.emissiveMaterials;
        const emissive = names.length
          ? names.includes(original.name)
          : /bulb|shade|lamp|light|screen/i.test(original.name);
        if (emissive) {
          material.emissive.set(isOn ? entry.interactive!.color : "#000000");
          material.emissiveIntensity = isOn ? 2.2 : 0;
        }
      }
      return material;
    });
    object.material = Array.isArray(object.material) ? materials : materials[0];
  });

  if (entry.interactive) {
    const [ox, oy, oz] = entry.interactive.lightOffsetNormalized;
    const light = new THREE.PointLight(
      entry.interactive.color,
      isOn ? entry.interactive.intensity : 0,
      entry.interactive.distance,
      2,
    );
    light.position.set(ox * furniture.w / 1000, oy * furniture.h / 1000, oz * furniture.d / 1000);
    light.castShadow = false;
    root.add(light);
    root.userData.interactive = entry.interactive.kind;
  }
  return root;
}
