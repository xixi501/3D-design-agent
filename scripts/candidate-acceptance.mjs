import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createApp } from "../apps/service/src/app.ts";
const out = path.resolve("test-results/candidates");
fs.mkdirSync(out, { recursive: true });
const { app, store } = await createApp({
  dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "candidate-browser-")),
  staticDir: path.resolve("dist/editor"),
  logger: false,
});
await app.listen({ host: "127.0.0.1", port: 0 });
const base = `http://127.0.0.1:${app.server.address().port}`;
async function api(url, body) {
  const r = await fetch(
    base + "/api" + url,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const value = await r.json();
  if (!r.ok) throw Error(JSON.stringify(value));
  return value;
}
try {
  const fixture = JSON.parse(
      fs.readFileSync("fixtures/living-dining.plan.json", "utf8"),
    ),
    p = await api("/projects", { document: fixture }),
    chair = p.plan.furniture.find((f) => f.key === "armchair");
  const root = `/projects/${p.id}`;
  const c = await api(root + "/candidates", {
    requestId: "real-render",
    taskId: "operator-demo",
    baseRevision: 0,
    scope: {
      targetIds: [chair.id],
      allowDeleteIds: [],
      allowAddKeys: ["floorLamp"],
      requirements: [{ key: "floorLamp", count: 2, scope: "project" }],
    },
    edits: [
      { type: "update", id: chair.id, values: { x: 6600 } },
      { type: "create", key: "floorLamp", values: { x: 5700, y: 4300 } },
    ],
    summary: "候选工具演示：阅读角",
  });
  assert.equal(c.checks.passed, true);
  assert.deepEqual(await api(root), p);
  const evidence = await api(`${root}/candidates/${c.id}/render`, {});
  assert.equal(evidence.length, 2);
  for (const item of evidence) {
    const bytes = Buffer.from(
      await (
        await fetch(
          `${base}/api${root}/candidates/${c.id}/evidence/${item.view}`,
        )
      ).arrayBuffer(),
    );
    assert.equal(createHash("sha256").update(bytes).digest("hex"), item.sha256);
    assert.equal(bytes.readUInt32BE(16), 960);
    assert.equal(bytes.readUInt32BE(20), 720);
    fs.writeFileSync(path.join(out, item.view + ".png"), bytes);
  }
  assert.deepEqual(await api(root), p);
  await api(`${root}/candidates/${c.id}/review`, {
    source: "operator",
    passed: true,
    summary: "真实工具与渲染验证",
    objectIds: [chair.id, ...c.diff.added],
    evidenceHashes: evidence.map((e) => e.sha256),
    issues: [],
  });
  const request = {
    operationId: c.operationId,
    baseRevision: c.baseRevision,
    candidateHash: c.hash,
  };
  const committed = await api(`${root}/candidates/${c.id}/commit`, request);
  assert.equal(committed.project.revision, 1);
  assert.equal(committed.project.history.undo, 1);
  assert.ok(
    committed.project.plan.furniture.some((f) => f.id === c.diff.added[0]),
  );
  assert.equal(
    (await api(`${root}/candidates/${c.id}/commit`, request)).replayed,
    true,
  );
  const undone = (
    await api(root + "/undo", {
      operationId: "undo-candidate",
      baseRevision: 1,
    })
  ).project;
  assert.deepEqual(undone.plan, p.plan);
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(
      {
        passed: true,
        reviewSource: "operator",
        liveModel: false,
        project: p.id,
        candidate: c.id,
        checks: c.checks,
        evidence,
        committedRevision: 1,
        restoredRevision: 2,
        stableObjectIds: c.diff.added,
        renderingChangedProject: false,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS real candidate HTTP / two WebGL captures / stable IDs / commit / idempotence / undo",
  );
} finally {
  await app.close();
}
