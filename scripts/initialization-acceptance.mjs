import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createApp } from "../apps/service/src/app.ts";
const out = path.resolve("test-results/initialization");
fs.mkdirSync(out, { recursive: true });
const { app } = await createApp({
  dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "rectangular-proof-")),
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
  const p = await api("/projects", {}),
    root = `/projects/${p.id}`,
    brief = JSON.parse(
      fs.readFileSync("fixtures/s2b-reading-lounge.brief.json", "utf8"),
    ),
    preview = await api(root + "/initialization-preview", {
      taskId: "operator-initialization",
      baseRevision: 0,
      brief,
    });
  assert.deepEqual(await api(root), p);
  const edits = [
    { type: "create", key: "armchair", values: { x: 1200, y: 800 } },
    { type: "create", key: "armchair", values: { x: 3000, y: 800 } },
    { type: "create", key: "coffeeTable", values: { x: 2100, y: 2000 } },
    { type: "create", key: "bookshelf", values: { x: 300, y: 2000, rot: 270 } },
    { type: "create", key: "floorLamp", values: { x: 3800, y: 1400 } },
  ];
  const c = await api(root + "/candidates", {
    kind: "initialize",
    requestId: "initialization",
    taskId: "operator-initialization",
    baseRevision: 0,
    brief,
    summary: "矩形阅读会客间初始化工具验收",
    scope: {
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
    },
    edits,
  });
  assert.equal(c.checks.passed, true, JSON.stringify(c.checks));
  assert.deepEqual(c.state.plan.nodes, preview.state.plan.nodes);
  const evidence = await api(`${root}/candidates/${c.id}/render`, {});
  for (const e of evidence) {
    const bytes = Buffer.from(
      await (
        await fetch(`${base}/api${root}/candidates/${c.id}/evidence/${e.view}`)
      ).arrayBuffer(),
    );
    assert.equal(createHash("sha256").update(bytes).digest("hex"), e.sha256);
    fs.writeFileSync(path.join(out, e.view + ".png"), bytes);
  }
  assert.deepEqual(await api(root), p);
  await api(`${root}/candidates/${c.id}/review`, {
    source: "operator",
    passed: true,
    summary: "真实结构预览、WebGL 和原子保存验证",
    objectIds: c.state.plan.walls.map((w) => w.id),
    issues: [],
    evidenceHashes: evidence.map((e) => e.sha256),
  });
  const request = {
      operationId: c.operationId,
      baseRevision: 0,
      candidateHash: c.hash,
    },
    saved = await api(`${root}/candidates/${c.id}/commit`, request);
  assert.equal(saved.project.history.undo, 1);
  assert.deepEqual(saved.project.plan, c.state.plan);
  assert.equal(
    (await api(`${root}/candidates/${c.id}/commit`, request)).replayed,
    true,
  );
  const undo = (
    await api(root + "/undo", { operationId: "undo", baseRevision: 1 })
  ).project;
  assert.deepEqual(undo.plan, p.plan);
  const redo = (
    await api(root + "/redo", { operationId: "redo", baseRevision: 2 })
  ).project;
  assert.deepEqual(redo.plan, c.state.plan);
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(
      {
        passed: true,
        liveModel: false,
        reviewSource: "operator",
        netDimensions: c.generation.dimensions,
        previewChangedProject: false,
        stableStructureIds: true,
        oneTransaction: true,
        undoToBlank: true,
        redo: true,
        projectId: p.id,
        candidateId: c.id,
        checks: c.checks,
        evidence,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS real rectangular preview / two WebGL images / stable IDs / one transaction / undo to blank / redo",
  );
} finally {
  await app.close();
}
