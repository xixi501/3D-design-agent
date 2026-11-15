import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const base = (process.env.ACTISCAPE_URL || "http://127.0.0.1:3131").replace(
  /\/$/,
  "",
);
const out = path.resolve("test-results/agent-glb");
fs.mkdirSync(out, { recursive: true });
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
const form = new FormData();
form.append(
  "file",
  new Blob([fs.readFileSync("fixtures/textured-vase.glb")], {
    type: "model/gltf-binary",
  }),
  "textured-vase.glb",
);
const asset = await (
  await fetch(base + "/api/assets", { method: "POST", body: form })
).json();
assert.ok(asset.id);
const plan = await api("/examples/living-dining"),
  objectId = crypto.randomUUID();
plan.name = "S2-A GLB 对话验收";
plan.furniture.push({
  id: objectId,
  key: "model:" + asset.id,
  type: "model",
  modelId: asset.id,
  name: "我上传的花瓶",
  w: asset.w,
  d: asset.d,
  h: asset.h,
  x: 2200,
  y: 2400,
  z: 400,
  rot: 0,
  color: "#d9d4cc",
});
const before = await api("/projects", { document: plan }),
  conversation = await api("/agent/conversations", { projectId: before.id });
let task = await api(`/agent/conversations/${conversation.id}/tasks`, {
  requestId: crypto.randomUUID(),
  input:
    "把选中的这个花瓶向右移动100毫米，颜色叠加改为#ff0000。离地、尺寸和其他对象保持不变。",
  selectedIds: [objectId],
});
const deadline = Date.now() + 660000;
while (
  ["queued", "running", "committing"].includes(task.status) &&
  Date.now() < deadline
) {
  await new Promise((r) => setTimeout(r, 1000));
  task = await api(`/agent/tasks/${task.id}`);
}
const after = await api(`/projects/${before.id}`),
  trace = await api(`/agent/tasks/${task.id}/trace`);
fs.writeFileSync(
  path.join(out, "result.json"),
  JSON.stringify({ liveModel: true, task, trace, before, after }, null, 2),
);
assert.equal(task.status, "completed", task.error);
const model = after.plan.furniture.find((f) => f.id === objectId);
assert.equal(model.x, 2300);
assert.equal(model.z, 400);
assert.equal(model.modelId, asset.id);
assert.equal(model.opt.tint, "#ff0000");
assert.deepEqual(
  after.plan.furniture.filter((f) => f.id !== objectId),
  before.plan.furniture.filter((f) => f.id !== objectId),
);
const undone = (
  await api(`/projects/${before.id}/undo`, {
    operationId: crypto.randomUUID(),
    baseRevision: after.revision,
  })
).project;
assert.deepEqual(undone.plan, before.plan);
const redo = (
  await api(`/projects/${before.id}/redo`, {
    operationId: crypto.randomUUID(),
    baseRevision: undone.revision,
  })
).project;
assert.deepEqual(redo.plan, after.plan);
fs.writeFileSync(
  path.join(out, "report.json"),
  JSON.stringify(
    {
      passed: true,
      liveModel: true,
      taskId: task.id,
      projectId: before.id,
      assetId: asset.id,
      transform: true,
      tint: true,
      undoRedo: true,
    },
    null,
    2,
  ),
);
console.log(
  "PASS real GLB dialogue transform/tint, original recipe/assets/other objects protected, undo and redo",
);
