import fs from "node:fs";
import {
  createFurniture,
  blankPlan,
  catalog,
  importDocument,
} from "../packages/scene-core/src/index.js";
const plan = blankPlan();
plan.name = "演境 · 家具与建模展台";
plan.phase = "original";
plan.nodes = [
  { id: "gallery-n0", x: 0, y: 0 },
  { id: "gallery-n1", x: 18000, y: 0 },
  { id: "gallery-n2", x: 18000, y: 19000 },
  { id: "gallery-n3", x: 0, y: 19000 },
];
plan.walls = plan.nodes.map((n, i) => ({
  id: `gallery-w${i}`,
  a: n.id,
  b: plan.nodes[(i + 1) % 4].id,
  t: 120,
  bearing: false,
  status: "existing",
}));
plan.rooms = [
  { id: "gallery-room", x: 9000, y: 9500, name: "家具与建模展台", mat: "tile" },
];
const keys = Object.values(catalog)
  .filter((f) => f.type === "free")
  .map((f) => f.key)
  .concat(["cabTall", "cabWardrobe", "lCounter", "uCounter", "sofa", "bed18"]);
for (const [i, key] of keys.entries())
  if (catalog[key]) {
    const f = createFurniture(
      key,
      1500 + (i % 6) * 2900,
      1600 + Math.floor(i / 6) * 3000,
    );
    f.id = `gallery-${key}`;
    plan.furniture.push(f);
  }
fs.writeFileSync(
  "fixtures/modeling-gallery.plan.json",
  JSON.stringify(importDocument(plan).plan, null, 2) + "\n",
);
const glb = JSON.parse(
  fs.readFileSync("fixtures/living-dining.plan.json", "utf8"),
);
glb.name = "演境 · 贴图 GLB 展台";
glb.furniture.push({
  id: "fixture-vase-instance",
  key: "model:fixture-vase",
  type: "model",
  name: "带贴图花瓶",
  modelId: "fixture-vase",
  x: 2200,
  y: 2200,
  z: 420,
  rot: 15,
  w: 320,
  d: 320,
  h: 400,
  color: "#ffffff",
});
fs.writeFileSync(
  "fixtures/glb-display.plan.json",
  JSON.stringify(glb, null, 2) + "\n",
);
