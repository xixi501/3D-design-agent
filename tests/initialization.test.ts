import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  blankPlan,
  detectRooms,
  applyCommands,
} from "../packages/scene-core/src/index.js";
import {
  compileRectangular,
  millimetres,
} from "../packages/scene-core/src/rectangular.js";
import { createApp } from "../apps/service/src/app.js";
import { ProjectStore } from "../apps/service/src/store.js";
import { CandidateStore } from "../apps/service/src/candidates.js";
const brief = JSON.parse(
  fs.readFileSync("fixtures/s2b-reading-lounge.brief.json", "utf8"),
);
const scope = {
  targetIds: [],
  allowDeleteIds: [],
  allowAddKeys: ["armchair", "coffeeTable", "bookshelf", "floorLamp"],
  requirements: [
    { key: "armchair", count: 2, scope: "project" },
    ...["coffeeTable", "bookshelf", "floorLamp"].map((key) => ({
      key,
      count: 1,
      scope: "project",
    })),
  ],
};
const edits = [
  { type: "create", key: "armchair", values: { x: 1200, y: 800 } },
  { type: "create", key: "armchair", values: { x: 3000, y: 800 } },
  { type: "create", key: "coffeeTable", values: { x: 2100, y: 2000 } },
  { type: "create", key: "bookshelf", values: { x: 300, y: 2000, rot: 270 } },
  { type: "create", key: "floorLamp", values: { x: 3800, y: 1400 } },
];
test("rectangular compiler preserves net dimensions, units, stable references and rejects ambiguous/invalid openings", () => {
  const a = compileRectangular(brief, "task-one"),
    b = compileRectangular(brief, "task-one");
  assert.deepEqual(a, b);
  assert.deepEqual(
    a.state,
    applyCommands({ plan: blankPlan(), roomLabelArchive: [] }, a.commands),
  );
  assert.equal(millimetres({ value: 3.6, unit: "m" }, "depth"), 3600);
  assert.equal(a.dimensions.depth, 3600);
  const r = detectRooms(a.state.plan).regions;
  assert.equal(r.length, 1);
  assert.equal(r[0].area, 18);
  assert.deepEqual(r[0].rects, [{ x: 0, y: 0, w: 5000, h: 3600 }]);
  assert.equal(a.state.plan.nodes.length, 4);
  assert.equal(a.state.plan.openings.length, 2);
  assert.throws(
    () => compileRectangular({ ...brief, windows: undefined }, "task"),
    /明确窗/,
  );
  assert.throws(
    () =>
      compileRectangular(
        { ...brief, doors: [{ side: "south", position: "offset" }] },
        "task",
      ),
    /需要距离/,
  );
  assert.throws(
    () =>
      compileRectangular(
        {
          ...brief,
          doors: [
            {
              side: "south",
              position: "offset",
              offset: { value: 4900, unit: "mm" },
            },
          ],
        },
        "task",
      ),
    /越界/,
  );
  assert.throws(
    () =>
      compileRectangular(
        {
          ...brief,
          windows: [
            {
              side: "south",
              position: "offset",
              offset: { value: 3500, unit: "mm" },
            },
          ],
        },
        "task",
      ),
    /重叠/,
  );
  assert.throws(
    () =>
      compileRectangular(
        { ...brief, width: { value: NaN, unit: "m" } },
        "task",
      ),
    /有限数值/,
  );
});
test("initialization previews and candidates leave projects unchanged; enforce quantities, doorway and empty-project scope", async () => {
  const s = await createApp({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "init-")),
    logger: false,
  });
  try {
    const p = s.store.create(blankPlan());
    const preview = await s.app.inject({
      method: "POST",
      url: `/api/projects/${p.id}/initialization-preview`,
      payload: { taskId: "task-one", baseRevision: 0, brief },
    });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.deepEqual(s.store.get(p.id), p);
    const body: any = {
      kind: "initialize",
      requestId: "draft",
      taskId: "task-one",
      baseRevision: 0,
      brief,
      scope,
      edits,
    };
    const c = s.candidates.create(p.id, body);
    assert.equal(c.checks.passed, true, JSON.stringify(c.checks));
    assert.equal(c.structure.walls.added.length, 4);
    assert.deepEqual(c.state.plan.nodes, preview.json().state.plan.nodes);
    assert.deepEqual(c, s.candidates.create(p.id, body));
    assert.deepEqual(s.store.get(p.id), p);
    const blocked = s.candidates.create(p.id, {
      ...body,
      requestId: "blocked",
      edits: [
        ...edits.slice(0, -1),
        { type: "create", key: "floorLamp", values: { x: 3900, y: 3300 } },
      ],
    });
    assert.ok(
      blocked.checks.issues.some(
        (i: any) => i.code === "DOORWAY_BLOCKED" && i.blocking,
      ),
    );
    const missing = s.candidates.create(p.id, {
      ...body,
      requestId: "missing",
      edits: edits.slice(0, -1),
    });
    assert.ok(
      missing.checks.issues.some(
        (i: any) => i.code === "QUANTITY_REQUIREMENT" && i.blocking,
      ),
    );
    assert.throws(
      () =>
        s.candidates.create(p.id, {
          ...body,
          requestId: "forbidden-edit",
          kind: "edit",
        }),
      /不能改变房间/,
    );
    const existing = s.store.create(
      JSON.parse(fs.readFileSync("fixtures/living-dining.plan.json", "utf8")),
    );
    assert.throws(
      () =>
        s.candidates.create(existing.id, { ...body, requestId: "nonempty" }),
      /空白项目/,
    );
    s.store.mutate(p.id, "commands", {
      operationId: "manual",
      baseRevision: 0,
      commands: [{ type: "project", patch: { name: "manual" } }],
    });
    assert.throws(
      () =>
        s.candidates.commit(p.id, c.id, {
          operationId: c.operationId,
          baseRevision: 0,
          candidateHash: c.hash,
        }),
      /过期/,
    );
  } finally {
    await s.app.close();
  }
});
test("initialization commits are one durable transaction and migrate without changing old candidate hashes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "init-recovery-"));
  let store = new ProjectStore(dir),
    candidates = new CandidateStore(store);
  try {
    const p = store.create(blankPlan()),
      c = candidates.create(p.id, {
        kind: "initialize",
        requestId: "draft",
        taskId: "task",
        baseRevision: 0,
        brief,
        scope: scope as any,
        edits: edits as any,
      });
    const png = fs.readFileSync("docs/evidence/visual/editor-fixed.png"),
      evidence = candidates.saveEvidence(p.id, c.id, [
        { view: "top", data: png },
        { view: "oblique", data: png },
      ]);
    candidates.review(p.id, c.id, {
      source: "operator",
      passed: true,
      summary: "controlled transport fixture",
      issues: [],
      objectIds: c.state.plan.walls.map((w: any) => w.id),
      evidenceHashes: evidence.map((e) => e.sha256),
    });
    const body = {
      operationId: c.operationId,
      baseRevision: 0,
      candidateHash: c.hash,
    };
    const first = candidates.commit(p.id, c.id, body);
    assert.equal(first.project.revision, 1);
    assert.equal(first.project.history.undo, 1);
    store.db.pragma("user_version = 1");
    store.close();
    store = new ProjectStore(dir);
    candidates = new CandidateStore(store);
    assert.equal(candidates.get(p.id, c.id).hash, c.hash);
    assert.equal(candidates.commit(p.id, c.id, body).replayed, true);
    const undo = store.mutate(p.id, "undo", {
      operationId: "undo",
      baseRevision: 1,
    }).project;
    assert.deepEqual(undo.plan, p.plan);
    const redo = store.mutate(p.id, "redo", {
      operationId: "redo",
      baseRevision: 2,
    }).project;
    assert.deepEqual(redo.plan, first.project.plan);
    assert.equal(candidates.commit(p.id, c.id, body).replayed, true);
    assert.equal(store.get(p.id).revision, 3);
  } finally {
    store.close();
  }
});
