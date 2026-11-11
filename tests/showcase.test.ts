import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { checkScene, importDocument } from "../packages/scene-core/src/index.js";

test("the gallery full-home showcase has four rooms and zero check errors", () => {
  const document = JSON.parse(
    fs.readFileSync("fixtures/full-home-showcase.plan.json", "utf8"),
  );
  const state = importDocument(document);
  assert.equal(state.plan.rooms.length, 4);
  assert.equal(state.plan.furniture.length, 14);
  const errors = checkScene(state.plan).issues.filter(
    (issue) => issue.level === "error",
  );
  assert.deepEqual(errors, []);
});
