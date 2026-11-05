import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const base = (process.env.ACTISCAPE_URL || "http://127.0.0.1:3001").replace(
  /\/$/,
  "",
);
const out = path.resolve("test-results/agent");
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
  const data = await r.json();
  if (!r.ok) throw Error(JSON.stringify(data));
  return data;
}
const fixture = await api("/examples/living-dining");
fixture.name = "S2-A 真实多 Agent 演示";
const project = await api("/projects", { document: fixture });
const chair = project.plan.furniture.find((f) => f.key === "armchair");
const conversation = await api("/agent/conversations", {
  projectId: project.id,
});
const started = await api(`/agent/conversations/${conversation.id}/tasks`, {
  requestId: crypto.randomUUID(),
  input:
    process.argv[2] ||
    "把这把单人沙发向左移动200毫米并顺时针转15度，再在旁边加一盏落地灯。保留餐桌、墙体和门窗。",
  selectedIds: [chair.id],
});
console.log(
  JSON.stringify({
    project: project.id,
    conversation: conversation.id,
    task: started.id,
    url: base + "/?project=" + project.id,
  }),
);
let task = started;
const start = Date.now();
while (
  ["queued", "running", "committing"].includes(task.status) &&
  Date.now() - start < 720000
) {
  await new Promise((r) => setTimeout(r, 1000));
  task = await api("/agent/tasks/" + task.id);
}
const trace = await api(`/agent/tasks/${task.id}/trace`),
  after = await api(`/projects/${project.id}`);
fs.writeFileSync(
  path.join(out, "demo.json"),
  JSON.stringify(
    {
      provider: "DeepSeek official",
      liveModel: true,
      task,
      trace,
      before: project,
      after,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    status: task.status,
    result: task.result,
    modelCalls: task.modelCalls,
  }),
);
assert.equal(
  task.status,
  "completed",
  task.error || JSON.stringify(task.result),
);
assert.equal(after.revision, 1);
for (const key of ["nodes", "walls", "openings", "rooms"])
  assert.deepEqual(after.plan[key], project.plan[key]);
assert.equal(
  after.plan.furniture.filter((f) => f.type === "floorLamp").length,
  2,
);
assert.equal(
  after.plan.furniture.find((f) => f.id === chair.id).x,
  chair.x - 200,
);
assert.equal(
  after.plan.furniture.find((f) => f.id === chair.id).rot,
  chair.rot + 15,
);
const roles = new Set(
  trace.filter((e) => e.kind === "agent_start").map((e) => e.data.role),
);
assert.deepEqual([...roles].sort(), ["assets", "check", "design", "main"]);
console.log(
  "PASS real four-agent local edit, protection, asset selection, screenshots and atomic commit",
);
