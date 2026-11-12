import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProjectStore } from "../apps/service/src/store.js";
import { CandidateStore } from "../apps/service/src/candidates.js";
import { EditAuthorizations } from "../apps/service/src/edit-authorizations.js";
const fixture = JSON.parse(
  fs.readFileSync("fixtures/living-dining.plan.json", "utf8"),
);
function setup() {
  const store = new ProjectStore(
    fs.mkdtempSync(path.join(os.tmpdir(), "phase1-auth-")),
  );
  const p = store.create(fixture),
    candidates = new CandidateStore(store);
  const chair = p.plan.furniture.find((f) => f.key === "armchair")!;
  const scope = {
    targetIds: [chair.id],
    allowDeleteIds: [],
    allowAddKeys: [],
    fieldMask: { [chair.id]: ["x", "rot"] },
    requirements: [],
  };
  const authorization = {
    taskId: "t",
    baseRevision: 0,
    version: 1,
    scope,
    requestText: "把单人沙发左移200毫米并顺时针旋转90度",
    operations: [
      {
        target_id: chair.id,
        action: "update" as const,
        deltas: { x: -200, rot: 90 },
        source_quote: "左移200毫米并顺时针旋转90度",
      },
    ],
  };
  return { store, p, candidates, chair, scope, authorization };
}
test("independent precise authorization enforces exact results, one commit, undo/redo and stale versions", () => {
  const { store, p, candidates, chair, scope, authorization } = setup();
  try {
    const auth = candidates.authorize(p.id, authorization);
    const request = {
      taskId: "t",
      baseRevision: 0,
      scope,
      authorizationVersion: auth.version,
      authorizationScopeHash: auth.scopeHash,
    };
    assert.throws(
      () =>
        candidates.create(p.id, {
          taskId: "t",
          baseRevision: 0,
          scope,
          requestId: "bypass",
          edits: [
            { type: "update", id: chair.id, values: { x: chair.x - 200 } },
          ],
        }),
      /必须引用独立授权/,
    );
    const bad = candidates.create(p.id, {
      ...request,
      requestId: "bad",
      edits: [
        {
          type: "update",
          id: chair.id,
          values: { x: chair.x - 100, rot: (chair.rot + 90) % 360 },
        },
      ],
    });
    assert.equal(bad.checks.passed, false);
    assert.ok(
      bad.checks.issues.some(
        (issue: any) => issue.code === "EXACT_RESULT_MISMATCH",
      ),
    );
    const c = candidates.create(p.id, {
      ...request,
      requestId: "good",
      edits: [
        {
          type: "update",
          id: chair.id,
          values: { x: chair.x - 200, rot: (chair.rot + 90) % 360 },
        },
      ],
    });
    assert.equal(c.verification, "deterministic");
    assert.equal(c.checks.passed, true, JSON.stringify(c.checks));
    candidates.review(p.id, c.id, {
      passed: true,
      source: "deterministic",
      summary: "精确字段及几何检查",
      objectIds: [],
      evidenceHashes: [],
      issues: [],
    });
    const commit = {
      operationId: c.operationId,
      baseRevision: 0,
      candidateHash: c.hash,
    };
    const saved = candidates.commit(p.id, c.id, commit).project;
    assert.equal(saved.revision, 1);
    assert.equal(candidates.commit(p.id, c.id, commit).replayed, true);
    assert.deepEqual(
      saved.plan.furniture.filter((f: any) => f.id !== chair.id),
      p.plan.furniture.filter((f) => f.id !== chair.id),
    );
    assert.deepEqual(
      store.mutate(p.id, "undo", { operationId: "undo", baseRevision: 1 })
        .project.plan,
      p.plan,
    );
    assert.deepEqual(
      store.mutate(p.id, "redo", { operationId: "redo", baseRevision: 2 })
        .project.plan,
      saved.plan,
    );
  } finally {
    store.close();
  }
});
test("supplements invalidate old candidates before a replacement candidate exists", () => {
  const { store, p, candidates, chair, scope, authorization } = setup();
  try {
    const auth = candidates.authorize(p.id, authorization);
    const c = candidates.create(p.id, {
      requestId: "old",
      taskId: "t",
      baseRevision: 0,
      scope,
      authorizationVersion: 1,
      authorizationScopeHash: auth.scopeHash,
      edits: [
        {
          type: "update",
          id: chair.id,
          values: { x: chair.x - 200, rot: (chair.rot + 90) % 360 },
        },
      ],
    });
    candidates.review(p.id, c.id, {
      passed: true,
      source: "deterministic",
      summary: "ok",
      objectIds: [],
      evidenceHashes: [],
      issues: [],
    });
    new EditAuthorizations(store).invalidate(p.id, "t", 2);
    assert.throws(
      () =>
        candidates.commit(p.id, c.id, {
          operationId: c.operationId,
          baseRevision: 0,
          candidateHash: c.hash,
        }),
      /已失效/,
    );
    assert.throws(() => candidates.authorize(p.id, authorization), /已过期/);
    const updated = candidates.authorize(p.id, {
      ...authorization,
      version: 2,
    });
    assert.equal(updated.version, 2);
    assert.equal(store.get(p.id).revision, 0);
    assert.equal(candidates.get(p.id, c.id).hash, c.hash);
  } finally {
    store.close();
  }
});
test("authorization checks quotes, target fields, read-only references and immutable versions", () => {
  const { store, p, candidates, chair, authorization } = setup();
  try {
    assert.throws(
      () =>
        candidates.authorize(p.id, {
          ...authorization,
          referenceIds: [chair.id],
        }),
      /只读参考/,
    );
    assert.throws(
      () =>
        candidates.authorize(p.id, {
          ...authorization,
          operations: [
            { ...authorization.operations[0], source_quote: "invented" },
          ],
        }),
      /原文依据/,
    );
    assert.throws(
      () =>
        candidates.authorize(p.id, {
          ...authorization,
          operations: [
            { ...authorization.operations[0], values: { color: "#123456" } },
          ],
        }),
      /字段与用户授权/,
    );
    candidates.authorize(p.id, authorization);
    assert.throws(
      () =>
        candidates.authorize(p.id, {
          ...authorization,
          requestText: "different",
        }),
      /原文依据|不可改写/,
    );
  } finally {
    store.close();
  }
});
test("a verification flag cannot exempt ordinary layout candidates from visual review", () => {
  const { store, p, candidates, chair, scope } = setup();
  try {
    const auth = candidates.authorize(p.id, {
      taskId: "layout",
      baseRevision: 0,
      version: 1,
      scope,
      requestText: "调整阅读椅的位置和朝向",
    });
    const c = candidates.create(p.id, {
      requestId: "layout",
      taskId: "layout",
      baseRevision: 0,
      scope,
      authorizationVersion: 1,
      authorizationScopeHash: auth.scopeHash,
      verification: "deterministic",
      edits: [{ type: "update", id: chair.id, values: { x: chair.x - 100 } }],
    });
    assert.equal(c.verification, "screenshots");
    assert.throws(
      () =>
        candidates.review(p.id, c.id, {
          passed: true,
          source: "deterministic",
          summary: "bypass",
          objectIds: [],
          evidenceHashes: [],
          issues: [],
        }),
      /截图/,
    );
  } finally {
    store.close();
  }
});
test("asset replacements stay in the frozen pool and preserve the addition quota", () => {
  const { store, p, candidates } = setup();
  try {
    const scope = {
      targetIds: [],
      allowDeleteIds: [],
      allowAddKeys: ["floorLamp", "plant"],
      assetPool: ["floorLamp", "plant"],
      additionRules: [{ keys: ["floorLamp", "plant"], count: 1 }],
      requirements: [],
    };
    const auth = candidates.authorize(p.id, {
      taskId: "add",
      baseRevision: 0,
      version: 1,
      scope,
      requestText: "新增一件阅读角装饰家具",
    });
    const request = {
      taskId: "add",
      baseRevision: 0,
      scope,
      authorizationVersion: 1,
      authorizationScopeHash: auth.scopeHash,
    };
    const c = candidates.create(p.id, {
      ...request,
      requestId: "substitute",
      edits: [{ type: "create", key: "plant", values: { x: 5700, y: 4300 } }],
    });
    assert.equal(
      c.checks.issues.some((i: any) => i.code === "QUANTITY_REQUIREMENT"),
      false,
    );
    const excess = candidates.create(p.id, {
      ...request,
      requestId: "excess",
      edits: [
        { type: "create", key: "plant", values: { x: 5700, y: 4300 } },
        { type: "create", key: "plant", values: { x: 5800, y: 4300 } },
      ],
    });
    assert.ok(
      excess.checks.issues.some(
        (i: any) => i.code === "QUANTITY_REQUIREMENT" && i.blocking,
      ),
    );
    assert.throws(
      () =>
        candidates.create(p.id, {
          ...request,
          requestId: "expand",
          scope: { ...scope, allowAddKeys: ["sofa"] },
          edits: [
            { type: "create", key: "sofa", values: { x: 5700, y: 4300 } },
          ],
        }),
      /授权|替换池/,
    );
  } finally {
    store.close();
  }
});

test("layout targets remain inside the independently authorized local boundary", () => {
  const { store, p, candidates, chair, scope } = setup();
  try {
    const bounded = {
      ...scope,
      targetBounds: {
        x0: chair.x - 500,
        y0: chair.y - 500,
        x1: chair.x + 500,
        y1: chair.y + 500,
      },
    };
    const auth = candidates.authorize(p.id, {
      taskId: "bounded",
      version: 1,
      baseRevision: 0,
      scope: bounded,
      requestText: "调整阅读角",
    });
    const candidate = candidates.create(p.id, {
      taskId: "bounded",
      requestId: "outside",
      baseRevision: 0,
      scope: bounded,
      authorizationVersion: 1,
      authorizationScopeHash: auth.scopeHash,
      edits: [{ type: "update", id: chair.id, values: { x: chair.x - 1500 } }],
    });
    assert.ok(
      candidate.checks.issues.some(
        (i: any) => i.code === "OUTSIDE_EDIT_REGION" && i.blocking,
      ),
    );
    assert.equal(store.get(p.id).revision, 0);
  } finally {
    store.close();
  }
});

test("layout candidates cannot add unrequested grouping metadata", () => {
  const { store, p, candidates, chair, scope } = setup();
  try {
    const request = {
      taskId: "metadata",
      version: 1,
      baseRevision: 0,
      scope,
      requestText: "调整阅读角的位置",
    };
    assert.throws(
      () =>
        candidates.authorize(p.id, {
          ...request,
          scope: { ...scope, allowActivityGroups: true },
        }),
      /缺少用户明确授权/,
    );
    const auth = candidates.authorize(p.id, request);
    assert.throws(
      () =>
        candidates.create(p.id, {
          taskId: "metadata",
          requestId: "unsolicited-group",
          baseRevision: 0,
          scope,
          authorizationVersion: 1,
          authorizationScopeHash: auth.scopeHash,
          edits: [
            { type: "update", id: chair.id, values: { x: chair.x - 100 } },
          ],
          activityGroups: [{ name: "阅读组", memberIds: [chair.id] }],
        }),
      /未授权的活动组/,
    );
    assert.deepEqual(store.get(p.id).plan, p.plan);
    assert.equal(store.get(p.id).revision, 0);
  } finally {
    store.close();
  }
});

test("authorization and operation identity survive service storage restart", () => {
  const { store, p, candidates, chair, scope, authorization } = setup();
  const directory = store.directory;
  const auth = candidates.authorize(p.id, authorization);
  const c = candidates.create(p.id, {
    taskId: "t",
    requestId: "restart",
    baseRevision: 0,
    scope,
    authorizationVersion: 1,
    authorizationScopeHash: auth.scopeHash,
    edits: [
      {
        type: "update",
        id: chair.id,
        values: { x: chair.x - 200, rot: (chair.rot + 90) % 360 },
      },
    ],
  });
  candidates.review(p.id, c.id, {
    passed: true,
    source: "deterministic",
    summary: "ok",
    objectIds: [],
    evidenceHashes: [],
    issues: [],
  });
  store.close();
  const reopened = new ProjectStore(directory),
    recovered = new CandidateStore(reopened);
  try {
    assert.equal(recovered.get(p.id, c.id).hash, c.hash);
    const request = {
      operationId: c.operationId,
      baseRevision: 0,
      candidateHash: c.hash,
    };
    assert.equal(recovered.commit(p.id, c.id, request).project.revision, 1);
    assert.equal(recovered.commit(p.id, c.id, request).replayed, true);
    assert.equal(reopened.get(p.id).revision, 1);
    assert.deepEqual(
      reopened.mutate(p.id, "undo", {
        operationId: "undo-reopened",
        baseRevision: 1,
      }).project.plan,
      p.plan,
    );
  } finally {
    reopened.close();
  }
});

test("new authorizations require explicit field masks and addition quotas", () => {
  const { store, p, candidates, scope, authorization } = setup();
  try {
    assert.throws(
      () =>
        candidates.authorize(p.id, {
          ...authorization,
          operations: [],
          scope: { ...scope, fieldMask: undefined },
        }),
      /明确的字段授权/,
    );
    assert.throws(
      () =>
        candidates.authorize(p.id, {
          ...authorization,
          operations: [],
          scope: {
            targetIds: [],
            allowDeleteIds: [],
            allowAddKeys: ["floorLamp"],
            requirements: [],
          },
        }),
      /候选池和数量/,
    );
    assert.equal(store.get(p.id).revision, 0);
  } finally {
    store.close();
  }
});
