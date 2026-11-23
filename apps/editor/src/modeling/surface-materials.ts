import * as THREE from "three";
import type { Furniture } from "../../../../packages/scene-core/src/index.js";

type SurfaceFamily =
  | "wood"
  | "metal"
  | "stone"
  | "glass"
  | "fabric"
  | "leather"
  | "ceramic"
  | "plastic"
  | "foliage"
  | "paint";

type Recipe = {
  roughness: number;
  metalness: number;
  normal?: string;
  rough?: string;
  normalScale?: number;
  env: number;
};

const RECIPES: Record<SurfaceFamily, Recipe> = {
  wood: { roughness: 0.72, metalness: 0, normal: "wood_floor_nor_gl_1k.jpg", rough: "wood_floor_rough_1k.jpg", normalScale: 0.25, env: 0.55 },
  metal: { roughness: 0.32, metalness: 0.85, normal: "metal_plate_nor_gl_1k.jpg", rough: "metal_plate_rough_1k.jpg", normalScale: 0.12, env: 0.85 },
  stone: { roughness: 0.42, metalness: 0, normal: "marble_01_nor_gl_1k.jpg", rough: "marble_01_rough_1k.jpg", normalScale: 0.18, env: 0.65 },
  glass: { roughness: 0.08, metalness: 0, env: 1 },
  fabric: { roughness: 0.94, metalness: 0, normal: "fabric_pattern_07_nor_gl_1k.jpg", rough: "fabric_pattern_07_rough_1k.jpg", normalScale: 0.2, env: 0.45 },
  leather: { roughness: 0.58, metalness: 0, normal: "leather_red_02_nor_gl_1k.jpg", rough: "leather_red_02_rough_1k.jpg", normalScale: 0.3, env: 0.6 },
  ceramic: { roughness: 0.22, metalness: 0, env: 0.75 },
  plastic: { roughness: 0.48, metalness: 0, env: 0.55 },
  foliage: { roughness: 0.76, metalness: 0, env: 0.45 },
  paint: { roughness: 0.84, metalness: 0, env: 0.5 },
};

const has = (value: string, words: string[]) => words.some((word) => value.includes(word));

export function surfaceFamily(furniture: Furniture, material: THREE.MeshStandardMaterial): SurfaceFamily {
  if (material.transparent || (material as THREE.MeshPhysicalMaterial).transmission > 0) return "glass";
  const option = String(furniture.opt?.mat || "").toLowerCase();
  if (has(option, ["metal", "chrome", "gold", "steel", "brass"])) return "metal";
  if (material.metalness >= 0.45) return "metal";
  if (has(option, ["marble", "stone", "granite", "terrazzo"])) return "stone";
  if (has(option, ["leather"])) return "leather";
  if (has(option, ["fabric", "linen", "velvet", "cloth"])) return "fabric";
  if (has(option, ["wood", "oak", "walnut", "ash", "pine"])) return "wood";
  if (has(option, ["glass", "crystal"])) return "glass";
  if (has(option, ["ceramic", "porcelain"])) return "ceramic";
  if (has(option, ["plastic", "acrylic"])) return "plastic";
  if (has(option, ["leaf", "plant", "foliage"])) return "foliage";

  if (["plant", "hangingPlant"].includes(furniture.type)) return "foliage";
  if (["sofa", "armchair", "bed", "officeChair", "rockingChair"].includes(furniture.type)) return "fabric";
  if (["vase", "sink", "toilet", "basin", "tableVase"].includes(furniture.type)) return "ceramic";
  if (has(furniture.type, ["Table", "Desk", "Cabinet", "Shelf", "chair", "Chest", "bookshelf"])) return "wood";
  if (["tv", "television", "computer", "monitor", "screen", "appliance"].some((word) => furniture.type.toLowerCase().includes(word))) return "plastic";
  return "paint";
}

export function applySurfaceRecipe(
  furniture: Furniture,
  material: THREE.MeshStandardMaterial,
  texture: (file: string) => THREE.Texture,
) {
  const family = surfaceFamily(furniture, material);
  const recipe = RECIPES[family];
  material.roughness = recipe.rough ? 1 : recipe.roughness;
  material.metalness = recipe.metalness;
  material.envMapIntensity = recipe.env;
  if (recipe.normal) {
    material.normalMap = texture(recipe.normal);
    material.normalScale.set(recipe.normalScale!, recipe.normalScale!);
  }
  if (recipe.rough) material.roughnessMap = texture(recipe.rough);
  material.userData.surfaceFamily = family;
}
