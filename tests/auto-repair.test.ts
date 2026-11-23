import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  autoRepairScene,
  blankPlan,
  checkScene,
  createFurniture,
  importDocument,
  resolveSurfacePlacement,
} from "../packages/scene-core/src/index.js";
import { buildTemplatePlan } from "../apps/service/src/showcase-templates.js";
import { createApp } from "../apps/service/src/app.js";

test("autoRepairScene solves openable, wall, and circulation fixtures cleanly without touching structural fixtures", () => {
  for (const file of ["openable.plan.json", "wall.plan.json", "circulation.plan.json"]) {
    const plan = importDocument(
      JSON.parse(fs.readFileSync(path.join("fixtures/repair-cases", file), "utf8")),
    ).plan;
    const res = autoRepairScene(plan);
    assert.ok(res.fixableBefore >= 1, `${file} should have fixable issues`);
    assert.equal(res.fixableAfter, 0, `${file} should reach 0 fixable issues: ${JSON.stringify(res.remainingIssues)}`);
    assert.ok(res.commands.length >= 1);
  }
  const structural = importDocument(
    JSON.parse(fs.readFileSync("fixtures/repair-cases/structural.plan.json", "utf8")),
  ).plan;
  const sRes = autoRepairScene(structural);
  assert.equal(sRes.fixableBefore, 0);
  assert.equal(sRes.commands.length, 0);
});

test("autoRepairScene resolves seismic-bedroom-hazard (all 5 hazards) in < 3s", () => {
  const plan = buildTemplatePlan("seismic-bedroom-hazard", "fixtures").plan;
  const res = autoRepairScene(plan, { includeSafety: true });
  assert.equal(res.fixableBefore, 5);
  assert.equal(res.fixableAfter, 0, JSON.stringify(res.remainingIssues));
  assert.ok(res.elapsedMs < 3000, `Expected <3000ms, got ${res.elapsedMs}ms`);
  assert.ok(res.changes.some((c) => c.wallAnchored === true));
});

test("autoRepairScene resolves tabletop overhang and sibling collisions", () => {
  const plan = blankPlan();
  plan.name = "surface-repair";
  plan.nodes = [
    { id: "n0", x: 0, y: 0 },
    { id: "n1", x: 4000, y: 0 },
    { id: "n2", x: 4000, y: 4000 },
    { id: "n3", x: 0, y: 4000 },
  ];
  plan.walls = [
    { id: "w0", a: "n0", b: "n1", t: 200, status: "existing" },
    { id: "w1", a: "n1", b: "n2", t: 200, status: "existing" },
    { id: "w2", a: "n2", b: "n3", t: 200, status: "existing" },
    { id: "w3", a: "n3", b: "n0", t: 200, status: "existing" },
  ];
  plan.rooms = [
    { id: "r0", x: 2000, y: 2000, name: "客厅", mat: "oak", ceil: { type: "none", drop: 0, edgeW: 300, cove: false } },
  ];
  const table = createFurniture("coffeeTable", 2000, 2000, { rot: 0 });
  const plant1 = createFurniture("plant", 2000, 2000, { placement: "surface" });
  const plant2 = createFurniture("plant", 2600, 2000, { placement: "surface", parentObjectId: table.id });
  plan.furniture = [table, plant1, plant2];
  resolveSurfacePlacement(plan, plant1);
  plant2.z = table.h;

  const before = checkScene(plan).issues.filter((i) => i.code.startsWith("SURFACE_"));
  assert.ok(before.length >= 1);
  const res = autoRepairScene(plan);
  assert.equal(res.fixableAfter, 0, JSON.stringify(res.remainingIssues));
  assert.ok(res.commands.length >= 1);
});

test("HTTP POST /api/projects/:id/auto-repair resolves cabinet-on-bed overlap atomically and supports undo", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "actiscape-autorepair-"));
  const { app } = await createApp({ dataDir: dir, logger: false });
  try {
    const createRes = await app.inject({ method: "POST", url: "/api/projects", payload: {} });
    assert.equal(createRes.statusCode, 201);
    const proj = createRes.json();

    const tplRes = await app.inject({
      method: "POST",
      url: `/api/projects/${proj.id}/apply-template`,
      payload: { templateId: "modern-3bhk-fullhome" },
    });
    assert.equal(tplRes.statusCode, 200);
    const loaded = tplRes.json().project;
    const bed = loaded.plan.furniture.find((f: any) => f.type === "bed");
    const cab = loaded.plan.furniture.find((f: any) => f.type === "wardrobe" || f.type === "cabinet");
    assert.ok(bed && cab);

    const moveRes = await app.inject({
      method: "POST",
      url: `/api/projects/${proj.id}/commands`,
      payload: {
        operationId: "drag-overlap-1",
        baseRevision: loaded.revision,
        summary: "故意重叠",
        commands: [{ type: "update", collection: "furniture", id: cab.id, patch: { x: bed.x, y: bed.y } }],
      },
    });
    assert.equal(moveRes.statusCode, 200);
    const overlapped = moveRes.json().project ?? moveRes.json();

    const repairRes = await app.inject({
      method: "POST",
      url: `/api/projects/${proj.id}/auto-repair`,
      payload: {
        baseRevision: overlapped.revision,
        preferredMoveIds: [cab.id],
      },
    });
    assert.equal(repairRes.statusCode, 200);
    const body = repairRes.json();
    assert.equal(body.applied, true);
    assert.ok(body.fixableBefore >= 1);
    assert.equal(body.fixableAfter, 0, JSON.stringify(body.remainingIssues));
    assert.equal(body.project.revision, overlapped.revision + 1);

    const undoRes = await app.inject({
      method: "POST",
      url: `/api/projects/${proj.id}/undo`,
      payload: { operationId: "undo-repair-1", baseRevision: body.project.revision },
    });
    assert.equal(undoRes.statusCode, 200);
    const undone = undoRes.json().project ?? undoRes.json();
    const cabAfterUndo = undone.plan.furniture.find((f: any) => f.id === cab.id);
    assert.equal(cabAfterUndo.x, bed.x);
    assert.equal(cabAfterUndo.y, bed.y);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
