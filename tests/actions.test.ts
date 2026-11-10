import test from "node:test";
import assert from "node:assert/strict";
import {
  allDoorCabinetCommands,
  blankPlan,
  checkScene,
  createFurniture,
  openEnvelope,
  resolveSurfacePlacement,
  surfaceElevation,
  type Plan,
} from "../packages/scene-core/src/index.js";

function room(name = "主卧"): Plan {
  const plan = blankPlan();
  plan.name = name;
  plan.nodes = [
    { id: "n0", x: 0, y: 0 },
    { id: "n1", x: 4000, y: 0 },
    { id: "n2", x: 4000, y: 4000 },
    { id: "n3", x: 0, y: 4000 },
  ];
  plan.walls = [
    { id: "north", a: "n0", b: "n1", t: 200, status: "existing" },
    { id: "east", a: "n1", b: "n2", t: 200, status: "existing" },
    { id: "south", a: "n2", b: "n3", t: 200, status: "existing" },
    { id: "west", a: "n3", b: "n0", t: 200, status: "existing" },
  ];
  plan.rooms = [
    {
      id: "room",
      x: 2000,
      y: 2000,
      name,
      mat: "oak",
      ceil: { type: "none", drop: 0, edgeW: 400, cove: false },
    },
  ];
  return plan;
}

const codes = (plan: Plan) => checkScene(plan).issues.map((i) => i.code);

test("openable envelope reports a bed blocking the wardrobe doors", () => {
  const plan = room();
  const wardrobe = createFurniture("wardrobe", 2000, 400, { rot: 0 });
  const bed = createFurniture("bed18", 2000, 1200, { rot: 0 });
  plan.furniture = [wardrobe, bed];
  const issues = checkScene(plan).issues.filter(
    (i) => i.code === "OPENABLE_FRONT_BLOCKED",
  );
  assert.equal(issues.length, 1);
  assert.deepEqual(issues[0].objectIds.sort(), [wardrobe.id, bed.id].sort());
  assert.ok((issues[0].metric ?? 0) < 600);
});

test("openable envelope passes when the required depth is clear", () => {
  const plan = room();
  const wardrobe = createFurniture("wardrobe", 2000, 400, { rot: 0 });
  const bed = createFurniture("bed18", 2000, 2500, { rot: 0 });
  plan.furniture = [wardrobe, bed];
  assert.equal(
    codes(plan).includes("OPENABLE_FRONT_BLOCKED"),
    false,
    JSON.stringify(checkScene(plan).issues),
  );
});

test("a wardrobe facing a wall is rejected instead of reporting a false pass", () => {
  const plan = room();
  plan.furniture = [createFurniture("wardrobe", 2000, 400, { rot: 180 })];
  assert.ok(codes(plan).includes("OPENABLE_FRONT_BLOCKED"));
  const envelope = openEnvelope(plan.furniture[0]);
  assert.ok(envelope);
  assert.equal(envelope.spec.clearance, 600);
});

test("door swing overlapping a cabinet envelope reports DOOR_CABINET_CONFLICT", () => {
  const plan = room();
  plan.openings = [
    {
      id: "door",
      wall: "south",
      type: "door",
      pos: 2000,
      width: 900,
      sill: 0,
      head: 2100,
      hinge: 0,
    },
  ];
  plan.furniture = [
    createFurniture("shoeCabinet", 2000, 3600, { rot: 180 }),
  ];
  const result = checkScene(plan);
  assert.ok(
    result.issues.some((i) => i.code === "DOOR_CABINET_CONFLICT"),
    JSON.stringify(result.issues),
  );
});

test("surface snap sets z to host top and checks overhang and sibling collision", () => {
  const plan = room("客餐厅");
  const table = createFurniture("coffeeTable", 2000, 2000, { rot: 0 });
  const plant = createFurniture("plant", 2000, 2000, {
    placement: "surface",
  });
  plan.furniture = [table, plant];
  resolveSurfacePlacement(plan, plant);
  assert.equal(plant.parentObjectId, table.id);
  assert.equal(plant.z, table.h);
  assert.equal(surfaceElevation(plan, plant), table.h);
  assert.equal(
    codes(plan).filter((code) => code.startsWith("SURFACE_")).length,
    0,
    JSON.stringify(checkScene(plan).issues),
  );

  plant.x = 2550;
  assert.ok(codes(plan).includes("SURFACE_ITEM_OVERHANG"));

  plant.x = table.x;
  const second = createFurniture("plant", table.x + 100, table.y, {
    placement: "surface",
  });
  plan.furniture.push(second);
  resolveSurfacePlacement(plan, second);
  assert.ok(codes(plan).includes("SURFACE_ITEM_COLLISION"));
});

test("one-click action commands cover doors and openable cabinets", () => {
  const plan = room();
  plan.openings = [
    {
      id: "door",
      wall: "south",
      type: "door",
      pos: 2000,
      width: 900,
      sill: 0,
      head: 2100,
      hinge: 0,
    },
  ];
  plan.furniture = [
    createFurniture("wardrobe", 2000, 400, { rot: 0 }),
    createFurniture("desk", 3000, 3000, { rot: 0 }),
    createFurniture("sofa", 1000, 3000, { rot: 0 }),
  ];
  const opened = allDoorCabinetCommands(plan, "open");
  assert.equal(opened.mode, "open");
  assert.equal(opened.commands.length, 3);
  assert.ok(
    opened.commands.every(
      (command) => command.type === "update" && (command as any).patch,
    ),
  );
});
