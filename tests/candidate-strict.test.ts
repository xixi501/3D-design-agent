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
  validateScope,
} from "../packages/scene-core/src/candidate.js";

function room(): Plan {
  const plan = blankPlan();
  plan.name = "strict repair";
  plan.nodes = [
    { id: "n0", x: 0, y: 0 },
    { id: "n1", x: 8000, y: 0 },
    { id: "n2", x: 8000, y: 8000 },
    { id: "n3", x: 0, y: 8000 },
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
      x: 4000,
      y: 4000,
      name: "主卧",
      mat: "oak",
      ceil: { type: "none", drop: 0, edgeW: 400, cove: false },
    },
  ];
  return plan;
}
const state = (plan: Plan): SceneState => ({ plan, roomLabelArchive: [] });

function blockingLayout() {
  const plan = room();
  const wardrobe = createFurniture("wardrobe", 2000, 1000, { rot: 0 });
  const bed = createFurniture("bed18", 2000, 2000, { rot: 0 });
  plan.furniture = [wardrobe, bed];
  return { plan, wardrobe, bed };
}
const scope = (plan: Plan, bedId: string, checkProfile: "legacy" | "strict-repair") =>
  validateScope(
    {
      targetIds: [bedId],
      allowDeleteIds: [],
      allowAddKeys: [],
      requirements: [],
      checkProfile,
    },
    plan,
  );

test("strict repair rejects a candidate that leaves a target error", () => {
  const { plan, bed } = blockingLayout();
  const s = scope(plan, bed.id, "strict-repair");
  const after = applyCommands(state(plan), [
    { type: "update", collection: "furniture", id: bed.id, patch: { x: 2000, y: 2500 } },
  ]);
  const report = checkCandidate(state(plan), after, s);
  assert.equal(report.passed, false);
  assert.equal(report.targetIssuesBefore > 0, true);
  assert.equal(report.targetIssuesAfter > 0, true);
  assert.ok(report.issues.some((issue) => issue.blocking));
});

test("strict repair passes only when target issues disappear", () => {
  const { plan, bed } = blockingLayout();
  const s = scope(plan, bed.id, "strict-repair");
  const after = applyCommands(state(plan), [
    { type: "update", collection: "furniture", id: bed.id, patch: { x: 6000, y: 6000 } },
  ]);
  const report = checkCandidate(state(plan), after, s);
  assert.equal(report.targetIssuesAfter, 0);
  assert.equal(report.passed, true, JSON.stringify(report.issues));
});

test("strict repair rejects an empty target set", () => {
  const { plan } = blockingLayout();
  const s = validateScope(
    {
      targetIds: [],
      allowDeleteIds: [],
      allowAddKeys: [],
      requirements: [],
      checkProfile: "strict-repair",
    },
    plan,
  );
  const report = checkCandidate(state(plan), state(plan), s);
  assert.equal(report.passed, false);
  assert.ok(report.issues.some((issue) => issue.code === "STRICT_SCOPE_EMPTY"));
});

test("legacy scopes retain baseline-difference semantics", () => {
  const { plan, bed } = blockingLayout();
  const s = scope(plan, bed.id, "legacy");
  const after = applyCommands(state(plan), [
    { type: "update", collection: "furniture", id: bed.id, patch: { x: 2000, y: 2500 } },
  ]);
  const report = checkCandidate(state(plan), after, s);
  assert.equal(report.passed, true, JSON.stringify(report.issues));
});

test("OPENABLE metric is a deficit, so moving a blocker away improves it", () => {
  const { plan, bed } = blockingLayout();
  const before = checkScene(plan).issues.find(
    (issue) => issue.code === "OPENABLE_FRONT_BLOCKED",
  );
  assert.ok(before);
  const after = applyCommands(state(plan), [
    { type: "update", collection: "furniture", id: bed.id, patch: { x: 2000, y: 2500 } },
  ]);
  const next = checkScene(after.plan).issues.find(
    (issue) => issue.code === "OPENABLE_FRONT_BLOCKED",
  );
  assert.ok(next);
  assert.ok((before.metric ?? 0) > 0);
  assert.ok((next.metric ?? 0) < (before.metric ?? 0));
});
