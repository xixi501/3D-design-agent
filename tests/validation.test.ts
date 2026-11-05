import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  applyCommands,
  importDocument,
  validatePlan,
  blankPlan,
  catalog,
  createFurniture,
  SceneError,
} from "../packages/scene-core/src/index.js";

const fixture = JSON.parse(
  fs.readFileSync("fixtures/living-dining.plan.json", "utf8"),
);
test("renderer input validation rejects malformed optional fields and endpoints atomically with paths", () => {
  const state = importDocument(fixture),
    before = structuredClone(state);
  const patches: any[] = [
    {
      type: "update",
      collection: "walls",
      id: fixture.walls[0].id,
      patch: { h: "bad" },
    },
    {
      type: "add",
      collection: "beams",
      object: { id: "beam", w: 200, h: 400 },
    },
    {
      type: "add",
      collection: "measures",
      object: { id: "measure", a: "missing", b: { x: 100, y: 100 } },
    },
    {
      type: "update",
      collection: "rooms",
      id: fixture.rooms[0].id,
      patch: { ceil: { drop: "bad" } },
    },
    {
      type: "update",
      collection: "furniture",
      id: fixture.furniture[0].id,
      patch: { opt: [] },
    },
    {
      type: "update",
      collection: "furniture",
      id: fixture.furniture.at(-1).id,
      patch: { opt: { outline: "0,0|bad,4|1,1" } },
    },
  ];
  for (const command of patches) {
    assert.throws(
      () => applyCommands(state, [command]),
      (error: unknown) =>
        error instanceof SceneError &&
        typeof (error.details as any)?.field === "string",
    );
    assert.deepEqual(state, before);
  }
  const valid = applyCommands(state, [
    {
      type: "add",
      collection: "beams",
      object: {
        id: "beam",
        a: fixture.nodes[0].id,
        b: { x: 1000, y: 1000 },
        w: 250,
        depth: 300,
      },
    },
  ]);
  assert.equal(valid.plan.beams.length, 1);
});
test("all upstream defaults and fixed modelling gallery remain valid with extension fields preserved", () => {
  const plan = blankPlan();
  plan.furniture = Object.keys(catalog).map((key) => createFurniture(key));
  validatePlan(plan);
  const gallery = JSON.parse(
    fs.readFileSync("fixtures/modeling-gallery.plan.json", "utf8"),
  );
  gallery.furniture[0].integrationMetadata = { source: "legacy", version: 1 };
  assert.deepEqual(importDocument(gallery).plan, gallery);
});
