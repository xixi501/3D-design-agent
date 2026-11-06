/** Actual DeepSeek local edits on a synthetic image-derived scene; never real-image accuracy acceptance. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { materializeFloorplan } from "../packages/scene-core/src/floorplan.ts";
const base = (process.env.ACTISCAPE_URL || "http://127.0.0.1:3131").replace(
    /\/$/,
    "",
  ),
  out = path.resolve(
    "test-results/floorplan-real-edit",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
fs.mkdirSync(out, { recursive: true });
async function api(route, body) {
  const r = await fetch(
      base + "/api" + route,
      body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
    ),
    v = await r.json();
  if (!r.ok) throw Error(JSON.stringify(v));
  return v;
}
async function wait(task) {
  const deadline = Date.now() + 720000;
  while (
    ["queued", "running", "committing"].includes(task.status) &&
    Date.now() < deadline
  ) {
    await new Promise((r) => setTimeout(r, 600));
    task = await api("/agent/tasks/" + task.id);
  }
  return task;
}
const proof = JSON.parse(
    fs.readFileSync("test-results/floorplan-tools/report.json"),
  ),
  d = proof.task.generation.floorplan,
  compiled = materializeFloorplan(
    d.data,
    proof.task.id,
    { draftId: d.id, draftRevision: d.revision, draftHash: d.hash },
    proof.task.generation.matches,
  );
const form = new FormData();
form.append(
  "file",
  new Blob([fs.readFileSync("fixtures/s2c-synthetic.png")]),
  "synthetic-only.png",
);
const uploaded = await fetch(base + "/api/floorplan-images", {
  method: "POST",
  body: form,
});
assert.equal(uploaded.status, 201);
const p = await api("/projects", {
    document: { formatVersion: 1, ...compiled.state },
  }),
  conversation = await api("/agent/conversations", { projectId: p.id }),
  chair = p.plan.furniture.find((f) => f.key === "armchair"),
  results = [];
try {
  for (const [index, input, selectedIds] of [
    [
      1,
      "把这把单人沙发向左移动100毫米，其余对象和墙体门窗保持不变。",
      [chair.id],
    ],
    [2, "把它的颜色改成#2d6655，位置和其他参数保持不变。", []],
  ]) {
    let task = await api(`/agent/conversations/${conversation.id}/tasks`, {
      requestId: crypto.randomUUID(),
      input,
      selectedIds,
    });
    task = await wait(task);
    results.push({ task, trace: await api(`/agent/tasks/${task.id}/trace`) });
    assert.equal(task.status, "completed", JSON.stringify(task));
    const current = await api("/projects/" + p.id),
      changed = current.plan.furniture.find((f) => f.id === chair.id);
    assert.ok(Math.abs(changed.x - (chair.x - 100)) < 0.001);
    if (index === 2) assert.equal(changed.color.toLowerCase(), "#2d6655");
    for (const key of Object.keys(p.plan).filter((k) => k !== "furniture"))
      assert.deepEqual(current.plan[key], p.plan[key], `protected ${key}`);
    for (const f of p.plan.furniture.filter((f) => f.id !== chair.id))
      assert.deepEqual(
        current.plan.furniture.find((a) => a.id === f.id),
        f,
      );
    for (const e of task.result.evidence) {
      const bytes = Buffer.from(
        await (await fetch(base + e.url)).arrayBuffer(),
      );
      fs.writeFileSync(path.join(out, `${index}-${e.view}.png`), bytes);
    }
  }
  const root = "/projects/" + p.id;
  let latest = await api(root);
  assert.equal(latest.history.undo, 2);
  for (let i = 0; i < 2; i++)
    latest = (
      await api(root + "/undo", {
        operationId: "proof-undo-" + i,
        baseRevision: latest.revision,
      })
    ).project;
  assert.deepEqual(latest.plan, p.plan);
  for (let i = 0; i < 2; i++)
    latest = (
      await api(root + "/redo", {
        operationId: "proof-redo-" + i,
        baseRevision: latest.revision,
      })
    ).project;
  const final = await api(root);
  assert.equal(final.history.undo, 2);
  assert.equal(final.plan.source.imageHash, p.plan.source.imageHash);
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(
      {
        passed: true,
        realModelsForLocalEdits: true,
        initializationControlled: true,
        realImageAcceptance: false,
        projectId: p.id,
        results,
        source: p.plan.source,
        finalRevision: final.revision,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: true,
      realModelsForLocalEdits: true,
      initializationControlled: true,
      realImageAcceptance: false,
      output: out,
    }),
  );
} catch (error) {
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify({ passed: false, error: error.message, results }, null, 2),
  );
  throw error;
}
