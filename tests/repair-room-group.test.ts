import test from "node:test";
import assert from "node:assert/strict";
import {
  autoRepairScene,
  createFurniture,
  type SceneState,
} from "../packages/scene-core/src/index.js";
import {
  checkCandidate,
  type EditScope,
} from "../packages/scene-core/src/candidate.js";
import { compileSafeHouseSpec } from "../apps/service/src/showcase-templates.js";

function twoRoomApartment(): SceneState {
  const plan = compileSafeHouseSpec({
    name: "两房餐卧回归测试",
    height: 2800,
    phase: "renovate",
    autoElec: false,
    walls: [
      { a: [0, 0], b: [8000, 0], t: 200, bearing: true, openings: [{ type: "window", from: 1500, to: 3000, sill: 850, head: 2400 }] },
      { a: [8000, 0], b: [8000, 5000], t: 200, bearing: true, openings: [] },
      { a: [8000, 5000], b: [0, 5000], t: 200, bearing: true, openings: [{ type: "door", from: 6000, to: 6900, into: [2000, 2500] }] },
      { a: [0, 5000], b: [0, 0], t: 200, bearing: true, openings: [] },
      { a: [4600, 0], b: [4600, 5000], t: 160, bearing: false, openings: [{ type: "sliding", from: 2000, to: 2900 }] },
    ],
    rooms: [
      { at: [2300, 2500], name: "客餐厅", mat: "oak", wallMat: "latexWhite", ceil: { type: "none" } },
      { at: [6300, 2500], name: "主卧", mat: "oak", wallMat: "latexWhite", ceil: { type: "none" } },
    ],
    furniture: [
      { key: "diningTable", at: [2200, 2200], rot: 0 },
      { key: "chair", at: [1850, 1500], rot: 0 },
      { key: "chair", at: [2550, 1500], rot: 0 },
      { key: "chair", at: [1850, 2900], rot: 180 },
      { key: "chair", at: [2550, 2900], rot: 180 },
      { key: "bed18", at: [6600, 1400], rot: 0 },
    ],
  });
  return { plan, roomLabelArchive: [] };
}

test("strict-repair rejects dining chair drifting into bedroom (CROSS_ROOM_DRIFT)", () => {
  const before = twoRoomApartment();
  const chair = before.plan.furniture.find((f) => f.key === "chair")!;
  const after: SceneState = structuredClone(before);
  const moved = after.plan.furniture.find((f) => f.id === chair.id)!;
  moved.x = 5500;
  moved.y = 3600;

  const scope: EditScope = {
    targetIds: [chair.id],
    allowDeleteIds: [],
    allowAddKeys: [],
    fieldMask: { [chair.id]: ["x", "y", "rot"] },
    requirements: [],
    checkProfile: "strict-repair",
  };
  const report = checkCandidate(before, after, scope);
  assert.equal(report.passed, false);
  assert.ok(
    report.issues.some((i) => i.code === "CROSS_ROOM_DRIFT" && i.blocking),
    JSON.stringify(report.issues),
  );
});

test("strict-repair rejects moving dining table away from its chair cluster (DINING_GROUP_BROKEN)", () => {
  const before = twoRoomApartment();
  const table = before.plan.furniture.find((f) => f.key === "diningTable")!;
  const after: SceneState = structuredClone(before);
  const moved = after.plan.furniture.find((f) => f.id === table.id)!;
  moved.x = 1200;
  moved.y = 4200;

  const scope: EditScope = {
    targetIds: [table.id],
    allowDeleteIds: [],
    allowAddKeys: [],
    fieldMask: { [table.id]: ["x", "y", "rot"] },
    requirements: [],
    checkProfile: "strict-repair",
  };
  const report = checkCandidate(before, after, scope);
  assert.equal(report.passed, false);
  assert.ok(
    report.issues.some((i) => i.code === "DINING_GROUP_BROKEN" && i.blocking),
    JSON.stringify(report.issues),
  );
});

test("autoRepairScene keeps crowded dining chairs inside dining room and never moves them into bedroom", () => {
  const state = twoRoomApartment();
  for (let i = 0; i < 4; i++) {
    const extra = createFurniture("chair", 2200 + i * 30, 2200 + i * 20);
    state.plan.furniture.push(extra);
  }
  const res = autoRepairScene(state.plan, { maxIterations: 30, timeBudgetMs: 4000 });
  const chairs = res.plan.furniture.filter((f) => f.key === "chair");
  assert.equal(chairs.length, 8);
  for (const ch of chairs) {
    assert.ok(
      ch.x < 4600,
      `Dining chair ${ch.id} drifted into bedroom at x=${ch.x}, y=${ch.y}`,
    );
  }
});
