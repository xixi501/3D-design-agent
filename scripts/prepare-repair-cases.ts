import fs from "node:fs";
import path from "node:path";
import {
  blankPlan,
  checkScene,
  createFurniture,
  importDocument,
  type Plan,
} from "../packages/scene-core/src/index.js";

const output = path.resolve("fixtures/repair-cases");

function room(
  name: string,
  width: number,
  height: number,
  doorWidth: number,
): Plan {
  const plan = blankPlan();
  plan.name = name;
  plan.height = 2800;
  plan.phase = "renovate";
  plan.nodes = [
    { id: `${name}-n0`, x: 0, y: 0 },
    { id: `${name}-n1`, x: width, y: 0 },
    { id: `${name}-n2`, x: width, y: height },
    { id: `${name}-n3`, x: 0, y: height },
  ];
  plan.walls = [
    { id: `${name}-north`, a: `${name}-n0`, b: `${name}-n1`, t: 200, status: "existing" },
    { id: `${name}-east`, a: `${name}-n1`, b: `${name}-n2`, t: 200, status: "existing" },
    { id: `${name}-south`, a: `${name}-n2`, b: `${name}-n3`, t: 200, status: "existing" },
    { id: `${name}-west`, a: `${name}-n3`, b: `${name}-n0`, t: 200, status: "existing" },
  ];
  plan.openings = [
    {
      id: `${name}-door`,
      wall: `${name}-south`,
      type: "door",
      pos: width / 2,
      width: doorWidth,
      sill: 0,
      head: 2100,
      hinge: 0,
    },
  ];
  plan.rooms = [
    {
      id: `${name}-room`,
      x: width / 2,
      y: height / 2,
      name,
      mat: "oak",
      ceil: { type: "none", drop: 0, edgeW: 400, cove: false },
    },
  ];
  return plan;
}

function add(
  plan: Plan,
  id: string,
  key: string,
  x: number,
  y: number,
  rot = 0,
) {
  const furniture = createFurniture(key, x, y, { rot });
  furniture.id = id;
  plan.furniture.push(furniture);
  return furniture;
}

const cases: Record<string, { plan: Plan; expected: string[]; furnitureIds: string[] }> = {};

{
  const plan = room("openable", 6000, 5000, 900);
  add(plan, "openable-wardrobe", "wardrobe", 2000, 800);
  add(plan, "openable-bed", "bed18", 2000, 1600);
  cases["openable.plan.json"] = {
    plan,
    expected: ["OPENABLE_FRONT_BLOCKED"],
    furnitureIds: ["openable-wardrobe", "openable-bed"],
  };
}
{
  const plan = room("wall", 4000, 4000, 900);
  add(plan, "wall-box", "freeBox", 100, 2000);
  cases["wall.plan.json"] = {
    plan,
    expected: ["FURNITURE_IN_WALL"],
    furnitureIds: ["wall-box"],
  };
}
{
  const plan = room("circulation", 3000, 3000, 900);
  add(plan, "circulation-sofa", "sofa", 1500, 1500);
  cases["circulation.plan.json"] = {
    plan,
    expected: ["CIR-02"],
    furnitureIds: ["circulation-sofa"],
  };
}
{
  const plan = room("structural", 4000, 4000, 650);
  cases["structural.plan.json"] = {
    plan,
    expected: ["STRUCT_DOOR_CLEAR_WIDTH"],
    furnitureIds: [],
  };
}

for (const [file, { plan, expected, furnitureIds }] of Object.entries(cases)) {
  const state = importDocument(plan);
  const issues = checkScene(state.plan).issues;
  const codes = new Set(issues.map((issue) => issue.code));
  for (const code of expected)
    if (!codes.has(code))
      throw new Error(`${file}: missing expected issue ${code}`);
  if (file === "structural.plan.json") {
    const structural = issues.find(
      (issue) => issue.code === "STRUCT_DOOR_CLEAR_WIDTH",
    );
    if (!structural || structural.fixableByFurniture !== false)
      throw new Error(`${file}: structural issue must not be furniture-fixable`);
    if (state.plan.furniture.length)
      throw new Error(`${file}: structural case must not include furniture`);
  } else {
    const errors = issues.filter((issue) => issue.level === "error");
    if (!errors.every((issue) => expected.includes(issue.code)))
      throw new Error(
        `${file}: unexpected error codes ${JSON.stringify(
          errors.map((issue) => issue.code),
        )}`,
      );
    for (const id of furnitureIds)
      if (!state.plan.furniture.some((furniture) => furniture.id === id))
        throw new Error(`${file}: missing furniture ${id}`);
  }
  fs.writeFileSync(
    path.join(output, file),
    JSON.stringify(state.plan, null, 2) + "\n",
  );
  console.log(`${file}: ${issues.length} issues (${[...codes].join(", ")})`);
}
