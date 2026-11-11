import fs from "node:fs";
import {
  blankPlan,
  checkScene,
  createFurniture,
  importDocument,
} from "../packages/scene-core/src/index.js";

const plan = blankPlan();
plan.name = "演境 · 全屋样板间";
plan.height = 2800;
plan.phase = "renovate";
plan.nodes = [
  { id: "showcase-n0", x: 0, y: 0 },
  { id: "showcase-n1", x: 6000, y: 0 },
  { id: "showcase-n2", x: 12000, y: 0 },
  { id: "showcase-n3", x: 0, y: 4500 },
  { id: "showcase-n4", x: 6000, y: 4500 },
  { id: "showcase-n5", x: 12000, y: 4500 },
  { id: "showcase-n6", x: 0, y: 9000 },
  { id: "showcase-n7", x: 6000, y: 9000 },
  { id: "showcase-n8", x: 12000, y: 9000 },
];
plan.walls = [
  { id: "showcase-north", a: "showcase-n0", b: "showcase-n2", t: 200, status: "existing" },
  { id: "showcase-east", a: "showcase-n2", b: "showcase-n8", t: 200, status: "existing" },
  { id: "showcase-south", a: "showcase-n8", b: "showcase-n6", t: 200, status: "existing" },
  { id: "showcase-west", a: "showcase-n6", b: "showcase-n0", t: 200, status: "existing" },
  { id: "showcase-mid-v", a: "showcase-n1", b: "showcase-n7", t: 200, status: "existing" },
  { id: "showcase-mid-h", a: "showcase-n3", b: "showcase-n5", t: 200, status: "existing" },
];
plan.openings = [
  { id: "showcase-living-kitchen", wall: "showcase-mid-h", type: "door", pos: 2000, width: 900, sill: 0, head: 2100, hinge: 0 },
  { id: "showcase-master-bath", wall: "showcase-mid-h", type: "door", pos: 9000, width: 900, sill: 0, head: 2100, hinge: 0 },
  { id: "showcase-living-master", wall: "showcase-mid-v", type: "door", pos: 2200, width: 900, sill: 0, head: 2100, hinge: 0 },
  { id: "showcase-kitchen-bath", wall: "showcase-mid-v", type: "door", pos: 6800, width: 900, sill: 0, head: 2100, hinge: 0 },
];
plan.rooms = [
  { id: "showcase-living", x: 3000, y: 2200, name: "客餐厅", roomType: "living_dining", mat: "oak", ceil: { type: "none", drop: 0, edgeW: 400, cove: false } },
  { id: "showcase-master", x: 9000, y: 2200, name: "主卧", roomType: "master_bedroom", mat: "oak", ceil: { type: "none", drop: 0, edgeW: 400, cove: false } },
  { id: "showcase-kitchen", x: 3000, y: 6800, name: "厨房", roomType: "kitchen", mat: "tile", ceil: { type: "none", drop: 0, edgeW: 400, cove: false } },
  { id: "showcase-bath", x: 9000, y: 6800, name: "卫生间", roomType: "bathroom", mat: "tile", ceil: { type: "none", drop: 0, edgeW: 400, cove: false } },
];
let sequence = 0;
const add = (key: string, x: number, y: number, rot = 0, overrides: Record<string, any> = {}) => {
  const furniture = createFurniture(key, x, y, { rot, ...overrides });
  furniture.id = `showcase-${String(++sequence).padStart(2, "0")}-${key}`;
  plan.furniture.push(furniture);
};
add("sofa", 2000, 1900);
add("coffeeTable", 2000, 2900);
add("rug", 2000, 2500, 0, { w: 2400, d: 1800 });
add("diningTable", 4500, 1000);
add("chair", 3800, 1000);
add("chair", 5200, 1000, 180);
add("bed18", 9500, 1700);
add("nightstand", 8200, 900);
add("nightstand", 10800, 900);
add("counter", 4500, 8200);
add("stool", 3500, 7400);
add("toilet", 10800, 8200);
add("vanity", 7200, 8200);
add("plant", 11000, 5000);

const state = importDocument(plan);
const issues = checkScene(state.plan).issues;
if (issues.length)
  throw new Error(
    `showcase must be clean: ${issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`,
  );
fs.writeFileSync(
  "fixtures/full-home-showcase.plan.json",
  JSON.stringify(state.plan, null, 2) + "\n",
);
console.log(
  `full-home showcase: ${state.plan.rooms.length} rooms, ${state.plan.furniture.length} objects, 0 issues`,
);
