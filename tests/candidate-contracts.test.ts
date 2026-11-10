import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCommands,
  blankPlan,
  checkScene,
  createFurniture,
  type Plan,
  type SceneState,
} from "../packages/scene-core/src/index.js";
import {
  checkCandidate,
  materializeEdits,
  validateScope,
} from "../packages/scene-core/src/candidate.js";

function room(): Plan {
  const plan = blankPlan();
  plan.name = "主卧";
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
  plan.rooms = [
    {
      id: "room",
      x: 2000,
      y: 2000,
      name: "主卧",
      mat: "oak",
      ceil: { type: "none", drop: 0, edgeW: 400, cove: false },
    },
  ];
  return plan;
}
const state = (plan: Plan): SceneState => ({ plan, roomLabelArchive: [] });
const baseScope = {
  targetIds: [],
  allowDeleteIds: [],
  allowAddKeys: [],
  requirements: [],
};

test("action candidates toggle a door without weakening the check gate", () => {
  const plan = room();
  const scope = validateScope({ ...baseScope, actionIds: ["door"] }, plan);
  const commands = materializeEdits(state(plan), scope, [
    { type: "action", collection: "openings", id: "door", action: "toggle_open" },
  ]);
  const after = applyCommands(state(plan), commands);
  assert.equal(after.plan.openings[0].open, true);
  const report = checkCandidate(state(plan), after, scope);
  assert.equal(report.passed, true, JSON.stringify(report.issues));
});

test("an action candidate is blocked when the wardrobe envelope is occupied", () => {
  const plan = room();
  const wardrobe = createFurniture("wardrobe", 2000, 400, { rot: 0 });
  const bed = createFurniture("bed18", 2000, 1200, { rot: 0 });
  plan.furniture = [wardrobe, bed];
  const scope = validateScope(
    { ...baseScope, actionIds: [wardrobe.id] },
    plan,
  );
  const commands = materializeEdits(state(plan), scope, [
    {
      type: "action",
      collection: "furniture",
      id: wardrobe.id,
      action: "toggle_open",
    },
  ]);
  const after = applyCommands(state(plan), commands);
  const report = checkCandidate(state(plan), after, scope);
  assert.equal(report.passed, false);
  assert.ok(
    report.issues.some(
      (issue) => issue.code === "OPENABLE_FRONT_BLOCKED" && issue.blocking,
    ),
    JSON.stringify(report.issues),
  );
});

test("placeAsset creates a model at the host top and checks overhang", () => {
  const plan = room();
  const table = createFurniture("coffeeTable", 2000, 2000, { rot: 0 });
  plan.furniture = [table];
  const asset = {
    assetId: "asset-demo",
    name: "照片花瓶",
    w: 224,
    d: 224,
    h: 280,
  };
  const scope = validateScope({ ...baseScope, allowedAssets: [asset] }, plan);
  const commands = materializeEdits(state(plan), scope, [
    {
      type: "placeAsset",
      assetId: asset.assetId,
      values: {
        x: 2000,
        y: 2000,
        placement: "surface",
        parentObjectId: table.id,
      },
    },
  ]);
  const after = applyCommands(state(plan), commands);
  const model = after.plan.furniture.find((f) => f.type === "model")!;
  assert.equal(model.parentObjectId, table.id);
  assert.equal(model.z, table.h);
  assert.equal(model.modelId, asset.assetId);
  const report = checkCandidate(state(plan), after, scope);
  assert.equal(report.passed, true, JSON.stringify(report.issues));

  const over = materializeEdits(state(plan), scope, [
    {
      type: "placeAsset",
      assetId: asset.assetId,
      values: {
        x: 2600,
        y: 2000,
        placement: "surface",
        parentObjectId: table.id,
      },
    },
  ]);
  const overAfter = applyCommands(state(plan), over);
  const overReport = checkCandidate(state(plan), overAfter, scope);
  assert.equal(overReport.passed, false);
  assert.ok(
    overReport.issues.some((issue) => issue.code === "SURFACE_ITEM_OVERHANG"),
    JSON.stringify(overReport.issues),
  );
});
