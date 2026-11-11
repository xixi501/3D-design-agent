import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  checkScene,
  importDocument,
} from "../packages/scene-core/src/index.js";

const root = "fixtures/repair-cases";

function load(file: string) {
  return importDocument(
    JSON.parse(fs.readFileSync(path.join(root, file), "utf8")),
  ).plan;
}

test("openable repair fixture contains a fixable target error", () => {
  const plan = load("openable.plan.json");
  const issues = checkScene(plan).issues;
  const target = issues.find(
    (issue) => issue.code === "OPENABLE_FRONT_BLOCKED",
  );
  assert.ok(target, JSON.stringify(issues));
  assert.equal(target.fixableByFurniture, true);
  assert.ok(target.objectIds.includes("openable-wardrobe"));
  assert.ok(target.objectIds.includes("openable-bed"));
  assert.equal(
    issues.some((issue) => issue.fixableByFurniture === false),
    false,
    JSON.stringify(issues),
  );
});

test("wall repair fixture contains a fixable target error", () => {
  const plan = load("wall.plan.json");
  const issues = checkScene(plan).issues;
  const target = issues.find((issue) => issue.code === "FURNITURE_IN_WALL");
  assert.ok(target, JSON.stringify(issues));
  assert.equal(target.fixableByFurniture, true);
  assert.ok(target.objectIds.includes("wall-box"));
  assert.equal(
    issues.some((issue) => issue.fixableByFurniture === false),
    false,
    JSON.stringify(issues),
  );
});

test("circulation repair fixture contains a fixable CIR-02 target", () => {
  const plan = load("circulation.plan.json");
  const issues = checkScene(plan).issues;
  const target = issues.find((issue) => issue.code === "CIR-02");
  assert.ok(target, JSON.stringify(issues));
  assert.equal(target.fixableByFurniture, true);
  assert.ok(target.objectIds.includes("circulation-sofa"));
  assert.equal(
    issues.some((issue) => issue.fixableByFurniture === false),
    false,
    JSON.stringify(issues),
  );
});

test("structural fixture is explicitly not furniture-fixable", () => {
  const plan = load("structural.plan.json");
  const issues = checkScene(plan).issues;
  const target = issues.find(
    (issue) => issue.code === "STRUCT_DOOR_CLEAR_WIDTH",
  );
  assert.ok(target, JSON.stringify(issues));
  assert.equal(target.category, "structure");
  assert.equal(target.fixableByFurniture, false);
  assert.equal(target.owner, "structure");
  assert.equal(plan.furniture.length, 0);
});
