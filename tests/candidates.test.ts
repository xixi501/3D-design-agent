import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../apps/service/src/app.js";
import { CandidateStore } from "../apps/service/src/candidates.js";
import { ProjectStore } from "../apps/service/src/store.js";

const fixture = JSON.parse(
  fs.readFileSync("fixtures/living-dining.plan.json", "utf8"),
);
const chair = fixture.furniture.find((f: any) => f.key === "armchair");
const scope = {
  targetIds: [chair.id],
  allowDeleteIds: [],
  allowAddKeys: ["floorLamp"],
  requirements: [{ key: "floorLamp", count: 2, scope: "project" as const }],
  additionBounds: { x0: 5000, y0: 3500, x1: 8500, y1: 5500 },
};
const edits: any[] = [
  { type: "update", id: chair.id, values: { x: 6600 } },
  { type: "create", key: "floorLamp", values: { x: 5700, y: 4300 } },
];
test("scoped candidates freeze IDs, preserve projects/history, check boundaries and deduplicate creation", async () => {
  const server = await createApp({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "candidate-")),
    logger: false,
  });
  try {
    const p = server.store.create(fixture),
      request = {
        requestId: "draft-1",
        taskId: "task",
        baseRevision: 0,
        scope,
        edits,
      };
    const c = server.candidates.create(p.id, request);
    assert.equal(c.checks.passed, true, JSON.stringify(c.checks));
    assert.equal(c.diff.added.length, 1);
    assert.deepEqual(server.store.get(p.id), p);
    assert.deepEqual(server.candidates.create(p.id, request), c);
    assert.throws(
      () => server.candidates.create(p.id, { ...request, edits: [edits[1]] }),
      /相同候选/,
    );
    assert.throws(
      () =>
        server.candidates.create(p.id, {
          ...request,
          requestId: "bad-scope",
          edits: [
            {
              type: "update",
              id: fixture.furniture[0].id,
              values: { x: 4000 },
            },
          ],
        }),
      /授权范围/,
    );
    assert.throws(
      () =>
        server.candidates.create(p.id, {
          ...request,
          requestId: "recipe",
          edits: [
            {
              type: "update",
              id: chair.id,
              values: { opt: { style: "other" } },
            } as any,
          ],
        }),
      /范围外字段/,
    );
    const missing = server.candidates.create(p.id, {
      ...request,
      requestId: "quantity",
      edits: [edits[0]],
    });
    assert.ok(
      missing.checks.issues.some(
        (i: any) => i.code === "QUANTITY_REQUIREMENT" && i.blocking,
      ),
    );
    const outside = server.candidates.create(p.id, {
      ...request,
      requestId: "outside",
      scope: { ...scope, requirements: [] },
      edits: [{ type: "update", id: chair.id, values: { x: 50000, y: 50000 } }],
    });
    assert.ok(
      outside.checks.issues.some(
        (i: any) => i.code === "OUTSIDE_ROOM" && i.blocking,
      ),
    );
    const tall = server.candidates.create(p.id, {
      ...request,
      requestId: "height",
      scope: { ...scope, requirements: [] },
      edits: [{ type: "update", id: chair.id, values: { z: 2500 } }],
    });
    assert.ok(
      tall.checks.issues.some(
        (i: any) => i.code === "INVALID_ELEVATION" && i.blocking,
      ),
    );
    assert.throws(
      () =>
        server.candidates.commit(p.id, c.id, {
          operationId: c.operationId,
          baseRevision: 0,
          candidateHash: c.hash,
        }),
      /截图/,
    );
    const invalid = await server.app.inject({
      method: "POST",
      url: `/api/projects/${p.id}/commands`,
      payload: {
        operationId: "invalid-wall",
        baseRevision: 0,
        commands: [
          {
            type: "update",
            collection: "walls",
            id: p.plan.walls[0].id,
            patch: { h: "invalid" },
          },
        ],
      },
    });
    assert.equal(invalid.statusCode, 400);
    assert.ok(invalid.json().details.field.includes(".h"));
    assert.deepEqual(server.store.get(p.id), p);
  } finally {
    await server.app.close();
  }
});
test("candidate commits require matching evidence/review, are atomic, replay-safe and survive restart", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-commit-"));
  let store = new ProjectStore(directory),
    candidates = new CandidateStore(store);
  try {
    const p = store.create(fixture),
      c = candidates.create(p.id, {
        requestId: "one",
        taskId: "task",
        baseRevision: 0,
        scope,
        edits,
      });
    // Controlled evidence fixture tests the persistence boundary; real screenshots have a separate browser acceptance.
    const image = fs.readFileSync("docs/evidence/visual/editor-fixed.png");
    const evidence = candidates.saveEvidence(p.id, c.id, [
      { view: "top", data: image },
      { view: "oblique", data: image },
    ]);
    const body = {
      operationId: c.operationId,
      baseRevision: 0,
      candidateHash: c.hash,
    };
    assert.throws(() => candidates.commit(p.id, c.id, body), /检查尚未通过/);
    candidates.review(p.id, c.id, {
      passed: true,
      source: "operator",
      summary: "controlled test",
      objectIds: c.diff.added,
      evidenceHashes: evidence.map((e) => e.sha256),
      issues: [],
    });
    store.db.exec(
      "CREATE TRIGGER fail_candidate BEFORE UPDATE ON projects BEGIN SELECT RAISE(ABORT,'write failure'); END",
    );
    assert.throws(() => candidates.commit(p.id, c.id, body));
    assert.equal(store.get(p.id).revision, 0);
    assert.equal(candidates.get(p.id, c.id).committed, null);
    store.db.exec("DROP TRIGGER fail_candidate");
    const first = candidates.commit(p.id, c.id, body);
    assert.equal(first.project.revision, 1);
    assert.ok(
      first.project.plan.furniture.some((f: any) => f.id === c.diff.added[0]),
    );
    store.close();
    store = new ProjectStore(directory);
    candidates = new CandidateStore(store);
    const second = candidates.commit(p.id, c.id, body);
    assert.equal(second.replayed, true);
    assert.equal(store.get(p.id).revision, 1);
    assert.deepEqual(first.project, second.project);
    const undone = store.mutate(p.id, "undo", {
      operationId: "undo",
      baseRevision: 1,
    }).project;
    assert.deepEqual(undone.plan, p.plan);
    const replay = candidates.commit(p.id, c.id, body);
    assert.equal(replay.replayed, true);
    assert.equal(store.get(p.id).revision, 2);
    assert.throws(
      () =>
        candidates.commit(p.id, c.id, { ...body, candidateHash: "different" }),
      /同一个固定候选/,
    );
  } finally {
    store.close();
  }
});
