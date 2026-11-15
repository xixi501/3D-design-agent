import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const base = (process.env.ACTISCAPE_URL || "http://127.0.0.1:3131").replace(
  /\/$/,
  "",
);
const out = path.resolve("test-results/generation");
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
  );
  const v = await r.json();
  if (!r.ok) throw Error(JSON.stringify(v));
  return v;
}
const mode = process.argv.includes("--living")
  ? "living-dining"
  : "reading-lounge";
const input =
  mode === "living-dining"
    ? "请从空白生成一个矩形客餐厅，室内横向净宽6000毫米、纵向净深4000毫米。入口在南墙，门洞左边距西侧内墙400毫米；窗在北墙居中。需要三人沙发、茶几、电视柜、餐桌各一个，餐椅四把、落地灯一盏。使用简约中性配色，家具采用目录默认尺寸，门窗宽高和层高使用系统默认值。"
    : "请从空白生成一个矩形阅读会客间，室内横向净宽5000毫米、纵向净深3600毫米。入口在南墙，门洞左边距西侧内墙3500毫米；窗在东墙居中。需要两把单人沙发、一张茶几、一个书柜、一盏落地灯。使用简约中性配色，家具采用目录默认尺寸，门窗宽高和层高使用系统默认值。";
const before = await api("/projects", {}),
  conversation = await api("/agent/conversations", { projectId: before.id });
let task = await api(`/agent/conversations/${conversation.id}/tasks`, {
  requestId: crypto.randomUUID(),
  mode: "generate_rectangular",
  input,
  selectedIds: [],
});
let seq = 0;
while (["queued", "running", "committing"].includes(task.status)) {
  for (const e of await api(`/agent/tasks/${task.id}/trace?after=${seq}`)) {
    seq = e.seq;
    if (
      [
        "phase",
        "repair",
        "brief",
        "agent_start",
        "agent_end",
        "status",
      ].includes(e.kind)
    )
      console.log(
        e.kind,
        e.kind === "phase"
          ? e.data.phase
          : e.kind === "agent_start"
            ? e.data.role
            : e.kind === "status"
              ? e.data.message
              : "",
      );
  }
  await new Promise((r) => setTimeout(r, 800));
  task = await api(`/agent/tasks/${task.id}`);
}
const after = await api(`/projects/${before.id}`),
  trace = await api(`/agent/tasks/${task.id}/trace`);
fs.writeFileSync(
  path.join(out, mode + ".json"),
  JSON.stringify(
    {
      liveModel: true,
      provider: "DeepSeek official",
      input,
      before,
      task,
      after,
      trace,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      status: task.status,
      error: task.error,
      result: task.result,
      projectUrl: base + "/?project=" + before.id,
      modelCalls: task.modelCalls,
    },
    null,
    2,
  ),
);
assert.equal(task.status, "completed", JSON.stringify(task.result));
assert.equal(after.history.undo, 1);
assert.equal(after.plan.walls.length, 4);
assert.equal(after.plan.openings.length, 2);
assert.equal(after.plan.furniture.length, mode === "living-dining" ? 9 : 5);
assert.ok(task.result.skillsUsed?.[0]?.contentHash);
