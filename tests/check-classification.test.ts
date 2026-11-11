import test from "node:test";
import assert from "node:assert/strict";
import {
  blankPlan,
  checkScene,
  createFurniture,
  type Plan,
} from "../packages/scene-core/src/index.js";

function room(width: number, height: number, doorWidth = 900): Plan {
  const plan = blankPlan();
  plan.name = "classification";
  plan.nodes = [
    { id: "n0", x: 0, y: 0 },
    { id: "n1", x: width, y: 0 },
    { id: "n2", x: width, y: height },
    { id: "n3", x: 0, y: height },
  ];
  plan.walls = [
    { id: "north", a: "n0", b: "n1", t: 100, status: "existing" },
    { id: "east", a: "n1", b: "n2", t: 100, status: "existing" },
    { id: "south", a: "n2", b: "n3", t: 100, status: "existing" },
    { id: "west", a: "n3", b: "n0", t: 100, status: "existing" },
  ];
  plan.openings = [
    {
      id: "door",
      wall: "south",
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
      id: "room",
      x: width / 2,
      y: height / 2,
      name: "房间",
      mat: "oak",
      ceil: { type: "none", drop: 0, edgeW: 400, cove: false },
    },
  ];
  return plan;
}

test("a room that cannot contain 700x700 mm passage is structural", () => {
  const issues = checkScene(room(600, 600)).issues;
  const structural = issues.find((issue) => issue.code === "STRUCT_ROOM_PASSAGE");
  assert.ok(structural, JSON.stringify(issues));
  assert.equal(structural.category, "structure");
  assert.equal(structural.fixableByFurniture, false);
  assert.equal(structural.roomId, "room");
});

test("a door narrower than 700 mm is structural and blocks furniture repair", () => {
  const issues = checkScene(room(4000, 4000, 650)).issues;
  const structural = issues.find(
    (issue) => issue.code === "STRUCT_DOOR_CLEAR_WIDTH",
  );
  assert.ok(structural, JSON.stringify(issues));
  assert.equal(structural.category, "structure");
  assert.equal(structural.fixableByFurniture, false);
  assert.deepEqual(structural.objectIds, ["door"]);
});

test("an empty narrow-but-passable room does not report CIR-02", () => {
  const issues = checkScene(room(1300, 1100)).issues;
  assert.equal(
    issues.some((issue) => issue.code === "CIR-02"),
    false,
    JSON.stringify(issues),
  );
});

test("CIR-02 is furniture-fixable and contains only its room blocker", () => {
  const plan = room(2000, 3000);
  const wardrobe = createFurniture("wardrobe", 1000, 1500, { rot: 0 });
  plan.furniture = [wardrobe];
  const issues = checkScene(plan).issues;
  const circulation = issues.find((issue) => issue.code === "CIR-02");
  assert.ok(circulation, JSON.stringify(issues));
  assert.equal(circulation.category, "furniture");
  assert.equal(circulation.fixableByFurniture, true);
  assert.ok(circulation.objectIds.includes(wardrobe.id));
  assert.ok(circulation.objectIds.includes("door"));
  assert.equal(circulation.objectIds.length, 2);
});
