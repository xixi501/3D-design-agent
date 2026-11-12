import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { blankPlan } from "../packages/scene-core/src/index.js";
import { createApp } from "../apps/service/src/app.js";

const brief = JSON.parse(
  fs.readFileSync("fixtures/s2b-reading-lounge.brief.json", "utf8"),
);
const scope = {
  targetIds: [],
  allowDeleteIds: [],
  allowAddKeys: ["armchair", "coffeeTable", "bookshelf", "floorLamp"],
  requirements: [
    { key: "armchair", count: 2, scope: "project" },
    { key: "coffeeTable", count: 1, scope: "project" },
    { key: "bookshelf", count: 1, scope: "project" },
    { key: "floorLamp", count: 1, scope: "project" },
  ],
  assetPool: ["armchair", "coffeeTable", "bookshelf", "floorLamp"],
  additionRules: [
    { keys: ["armchair"], count: 2 },
    { keys: ["coffeeTable"], count: 1 },
    { keys: ["bookshelf"], count: 1 },
    { keys: ["floorLamp"], count: 1 },
  ],
};
const edits = [
  { type: "create", key: "armchair", values: { x: 1200, y: 800 } },
  { type: "create", key: "armchair", values: { x: 3000, y: 800 } },
  { type: "create", key: "coffeeTable", values: { x: 2100, y: 2000 } },
  { type: "create", key: "bookshelf", values: { x: 300, y: 2000, rot: 270 } },
  { type: "create", key: "floorLamp", values: { x: 3800, y: 1400 } },
];
const png = fs.readFileSync("docs/evidence/visual/editor-fixed.png");

async function setup() {
  const s = await createApp({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "generation-auth-")),
    logger: false,
  });
  const project = s.store.create(blankPlan());
  const post = async (url: string, payload: any) => {
    const r = await s.app.inject({ method: "POST", url, payload });
    return { status: r.statusCode, body: r.json() };
  };
  const authorize = (body: any) =>
    post(`/api/projects/${project.id}/edit-authorizations`, {
      taskId: "generation-task",
      baseRevision: 0,
      version: 1,
      requestText: "生成一个矩形阅读会客间，按用户清单布置家具。",
      kind: "initialize",
      brief,
      scope,
      ...body,
    });
  const candidate = (body: any = {}) =>
    post(`/api/projects/${project.id}/candidates`, {
      kind: "initialize",
      requestId: "generation-candidate",
      taskId: "generation-task",
      baseRevision: 0,
      brief,
      scope,
      edits,
      ...body,
    });
  return { s, project, post, authorize, candidate };
}

test("generation initialization authorization binds brief, counts, asset pool and screenshot review", async () => {
  const { s, project, authorize, candidate } = await setup();
  try {
    const auth = await authorize({});
    assert.equal(auth.status, 201, JSON.stringify(auth.body));
    assert.equal(auth.body.verification, "screenshots");

    const omitted = await candidate({ requestId: "omitted" });
    assert.equal(omitted.status, 409);
    assert.match(omitted.body.message, /必须引用独立授权/);

    const created = await candidate({
      authorizationVersion: auth.body.version,
      authorizationScopeHash: auth.body.scopeHash,
      verification: "deterministic",
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.checks.passed, true, JSON.stringify(created.body.checks));
    assert.equal(created.body.verification, "screenshots");
    assert.equal(created.body.authorizationVersion, 1);
    assert.equal(created.body.authorizationScopeHash, auth.body.scopeHash);
    assert.deepEqual(s.store.get(project.id), project);

    const changedBrief = await candidate({
      requestId: "changed-brief",
      authorizationVersion: auth.body.version,
      authorizationScopeHash: auth.body.scopeHash,
      brief: { ...brief, name: "另一个冻结结构" },
    });
    assert.equal(changedBrief.status, 409);
    assert.match(changedBrief.body.message, /冻结结构|授权/);

    const overreach = await candidate({
      requestId: "overreach",
      authorizationVersion: auth.body.version,
      authorizationScopeHash: auth.body.scopeHash,
      scope: {
        ...scope,
        requirements: scope.requirements.map((rule) =>
          rule.key === "armchair" ? { ...rule, count: 1 } : rule,
        ),
      },
    });
    assert.equal(overreach.status, 409);
    assert.match(overreach.body.message, /授权/);

    const missingCount = await candidate({
      requestId: "missing-count",
      authorizationVersion: auth.body.version,
      authorizationScopeHash: auth.body.scopeHash,
      edits: edits.slice(0, -1),
    });
    assert.equal(missingCount.status, 201);
    assert.equal(missingCount.body.checks.passed, false);
    assert.ok(
      missingCount.body.checks.issues.some(
        (i: any) => i.code === "QUANTITY_REQUIREMENT" && i.blocking,
      ),
    );

    const evidence = s.candidates.saveEvidence(project.id, created.body.id, [
      { view: "top", data: png },
      { view: "oblique", data: png },
    ]);
    const review = (source: string) =>
      s.app.inject({
        method: "POST",
        url: `/api/projects/${project.id}/candidates/${created.body.id}/review`,
        payload: {
          passed: true,
          source,
          summary: "验收截图已核对",
          objectIds: created.body.state.plan.walls.map((w: any) => w.id),
          issues: [],
          evidenceHashes: evidence.map((e) => e.sha256),
        },
      });
    assert.equal((await review("deterministic")).statusCode, 400);
    assert.equal((await review("operator")).statusCode, 200);

    const body = {
      operationId: created.body.operationId,
      baseRevision: 0,
      candidateHash: created.body.hash,
    };
    const commit = await s.app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/candidates/${created.body.id}/commit`,
      payload: body,
    });
    assert.equal(commit.statusCode, 200, commit.body);
    assert.equal(commit.json().project.revision, 1);
    assert.deepEqual(s.store.get(project.id).plan, created.body.state.plan);
    const replayed = await s.app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/candidates/${created.body.id}/commit`,
      payload: body,
    });
    assert.equal(replayed.json().replayed, true);
    assert.equal(s.store.get(project.id).revision, 1);
  } finally {
    await s.app.close();
  }
});

test("a new requirement version invalidates uncommitted old initialization candidates", async () => {
  const { s, project, authorize, candidate } = await setup();
  try {
    const auth = await authorize({});
    const first = await candidate({
      requestId: "first",
      authorizationVersion: auth.body.version,
      authorizationScopeHash: auth.body.scopeHash,
    });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const second = await candidate({
      requestId: "second",
      authorizationVersion: auth.body.version,
      authorizationScopeHash: auth.body.scopeHash,
    });
    assert.equal(second.status, 201);

    const brief2 = {
      ...brief,
      depth: { value: 4000, unit: "mm" },
    };
    const auth2 = await authorize({
      version: 2,
      brief: brief2,
      requestText: "把净深改为 4000 毫米并继续生成。",
    });
    assert.equal(auth2.status, 201, JSON.stringify(auth2.body));
    assert.notEqual(auth2.body.scopeHash, auth.body.scopeHash);

    const stale = await s.app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/candidates/${first.body.id}/checks`,
    });
    assert.equal(stale.statusCode, 409);
    const fresh = await candidate({
      requestId: "fresh",
      brief: brief2,
      authorizationVersion: auth2.body.version,
      authorizationScopeHash: auth2.body.scopeHash,
    });
    assert.equal(fresh.status, 201, JSON.stringify(fresh.body));
    assert.equal(fresh.body.checks.passed, true);

    const oldCommit = await s.app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/candidates/${second.body.id}/commit`,
      payload: {
        operationId: second.body.operationId,
        baseRevision: 0,
        candidateHash: second.body.hash,
      },
    });
    // Commit requires evidence first; the stale authorization still fails closed.
    assert.notEqual(oldCommit.statusCode, 200);
    assert.deepEqual(s.store.get(project.id), project);
  } finally {
    await s.app.close();
  }
});

test("initialization and edit authorization kinds cannot be mixed", async () => {
  const { s, project, post, authorize, candidate } = await setup();
  try {
    const auth = await authorize({});
    const asEdit = await post(`/api/projects/${project.id}/candidates`, {
      requestId: "as-edit",
      taskId: "generation-task",
      baseRevision: 0,
      scope: {
        targetIds: [],
        allowDeleteIds: [],
        allowAddKeys: [],
        requirements: [],
      },
      edits: [],
      authorizationVersion: auth.body.version,
      authorizationScopeHash: auth.body.scopeHash,
    });
    assert.notEqual(asEdit.status, 200);
    assert.deepEqual(s.store.get(project.id), project);
  } finally {
    await s.app.close();
  }
});
