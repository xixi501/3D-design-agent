/** Consolidated no-model replay of captured V3-5 acceptance gates. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { catalogueMappingProof } from "../packages/scene-core/src/floorplan-metrics.ts";
import { blankPlan } from "../packages/scene-core/src/index.ts";
import { geometryProofFromPlan } from "./floorplan-geometry.mjs";

const root = path.resolve(import.meta.dirname, "..");
const fixture = JSON.parse(
  fs.readFileSync(path.join(root, "fixtures/s2c-v3-5-replay.json"), "utf8"),
);
const catalogue = JSON.parse(
  fs.readFileSync(path.join(root, "fixtures/catalog.json"), "utf8"),
);
const reference = JSON.parse(
  fs.readFileSync(
    path.join(root, "fixtures/s2c-real/one-bedroom.evaluation-only.json"),
    "utf8",
  ),
);
const evaluation = JSON.parse(
  fs.readFileSync(
    path.join(root, "fixtures/s2c-real/one-bedroom.v2-evaluation.json"),
    "utf8",
  ),
);
const scoring = JSON.parse(
  fs.readFileSync(
    path.join(
      root,
      "docs/evidence/s2c-v3-5-vision/live-r8-20261108-scoring.json",
    ),
    "utf8",
  ),
);
const r8Evidence = JSON.parse(
  fs.readFileSync(
    path.join(root, "docs/evidence/s2c-v3-5-live-r8-20261108.json"),
    "utf8",
  ),
);
const r9Evidence = JSON.parse(
  fs.readFileSync(
    path.join(root, "docs/evidence/s2c-v3-5-live-r9-20261108.json"),
    "utf8",
  ),
);

const python = spawnSync(
  path.join(root, ".venv/bin/python"),
  [path.join(root, "scripts/floorplan-v35-replay.py")],
  {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: path.join(root, "apps/agent") },
  },
);
if (python.status !== 0) {
  process.stderr.write(python.stdout || "");
  process.stderr.write(python.stderr || "");
  process.exit(python.status || 1);
}
const pythonReplay = JSON.parse(python.stdout.trim().split("\n").at(-1));
assert.equal(pythonReplay.passed, true);
assert.equal(pythonReplay.assetKeys[2], "sofa");
assert.equal(pythonReplay.assetKeys[4], "cabTall");
for (const name of ["r9", "r10"]) {
  assert.equal(pythonReplay.reviews[name].passed, true);
  assert.equal(pythonReplay.reviews[name].blockingIssues, 0);
}
assert.ok(pythonReplay.activityRepairs.length > 0);

const choices = new Map(
  Object.entries(pythonReplay.assetKeys).map(([index, key]) => [
    Number(index),
    key,
  ]),
);
const symbolKeys = new Map();
fixture.r8.symbolGroups.forEach((symbolIds, index) => {
  for (const symbolId of symbolIds)
    symbolKeys.set(symbolId, choices.get(index));
});

const plan = blankPlan();
plan.name = "V3-5 captured acceptance replay";
plan.source = {
  kind: "floorplan-replay",
  imageId: reference.image.id,
  imageHash: reference.image.sha256,
  imageWidth: reference.image.width,
  imageHeight: reference.image.height,
  symbolObjects: {},
};
plan.furniture = fixture.r8.compiledSymbols.map((symbol) => {
  const key = symbolKeys.get(symbol.id);
  const recipe = catalogue[key];
  assert.ok(recipe, `Missing catalogue recipe ${key}`);
  plan.source.symbolObjects[symbol.id] = symbol.objectId;
  return {
    ...recipe,
    id: symbol.objectId,
    key,
    x: symbol.x,
    y: symbol.y,
    w: symbol.w,
    d: symbol.d,
    h: fixture.r8.heightBySymbol[symbol.id],
    rot: symbol.rot,
    color: recipe.color,
  };
});

const layout = scoring.scoring.confirmed.layout;
const mapping = catalogueMappingProof(
  plan,
  reference,
  layout,
  evaluation.allowedCatalogueKeys,
);
assert.equal(mapping.passed, true);
assert.equal(mapping.coverageComplete, true);

const base = (
  process.env.ACTISCAPE_SCENE_URL || "http://127.0.0.1:3001"
).replace(/\/$/, "");
const geometry = await geometryProofFromPlan(base, plan);
assert.equal(geometry.passed, true);

assert.equal(r8Evidence.task.status, "completed");
assert.equal(r8Evidence.task.formalProjectRevision, 4);
assert.equal(r8Evidence.completedWorkflow.scoringPassed, true);
assert.equal(r8Evidence.completedWorkflow.confirmationSimulated, true);
assert.equal(r8Evidence.completedWorkflow.singleTransactionCommitted, true);
assert.equal(r8Evidence.completedWorkflow.undoToBlank, true);
assert.equal(r8Evidence.completedWorkflow.redoSucceeded, true);
assert.equal(r8Evidence.completedWorkflow.localConversationEditCompleted, true);
assert.equal(r9Evidence.finalScoring.passed, true);

console.log(
  JSON.stringify(
    {
      passed: true,
      modelCalls: 0,
      assetChoices: Object.fromEntries(choices),
      catalogueProof: mapping.passed,
      geometryProof: geometry.passed,
      r8Workflow: r8Evidence.completedWorkflow,
      reviews: pythonReplay.reviews,
      activityRepairs: pythonReplay.activityRepairs,
    },
    null,
    2,
  ),
);
