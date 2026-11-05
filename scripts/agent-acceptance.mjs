import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const base = (process.env.ACTISCAPE_URL || "http://127.0.0.1:3001").replace(
  /\/$/,
  "",
);
const out = path.resolve("test-results/agent-acceptance");
fs.mkdirSync(out, { recursive: true });
const terminal = new Set([
  "completed",
  "failed",
  "cancelled",
  "conflict",
  "waiting_input",
]);
const results = [];
async function api(url, body) {
  const response = await fetch(
    base + "/api" + url,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const value = await response.json();
  if (!response.ok) throw Error(JSON.stringify(value));
  return value;
}
async function wait(task) {
  const deadline = Date.now() + 720000;
  while (!terminal.has(task.status) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    task = await api(`/agent/tasks/${task.id}`);
  }
  return task;
}
async function submit(conversation, input, selectedIds = []) {
  return wait(
    await api(`/agent/conversations/${conversation.id}/tasks`, {
      requestId: crypto.randomUUID(),
      input,
      selectedIds,
    }),
  );
}
const cases = [
  "reading-corner",
  "add-floor-lamp",
  "size-color",
  "delete",
  "multi-turn-reference",
  "clarification",
];
for (let repeat = 1; repeat <= 2; repeat++)
  for (const name of cases) {
    const record = {
      name,
      repeat,
      liveModel: true,
      provider: "DeepSeek official",
      status: "running",
      tasks: [],
    };
    try {
      const fixture = await api("/examples/living-dining");
      fixture.name = `S2-A 验收 · ${name} · ${repeat}`;
      const before = await api("/projects", { document: fixture }),
        conversation = await api("/agent/conversations", {
          projectId: before.id,
        });
      const armchair = before.plan.furniture.find((f) => f.key === "armchair"),
        lamp = before.plan.furniture.find((f) => f.key === "floorLamp"),
        dining = before.plan.furniture.find((f) => f.key === "chair");
      record.projectId = before.id;
      record.conversationId = conversation.id;
      let task,
        expectedChanged = [];
      if (name === "reading-corner") {
        task = await submit(
          conversation,
          "把阅读角的单人沙发向左移动200毫米，其他参数、其它家具、墙体和门窗保持不变。",
        );
        expectedChanged = [armchair.id];
      } else if (name === "add-floor-lamp") {
        task = await submit(
          conversation,
          "在阅读角单人沙发旁边再加一盏落地灯。所有已有家具、墙体和门窗保持不变。",
        );
      } else if (name === "size-color") {
        task = await submit(
          conversation,
          "把这把单人沙发的宽度改为900毫米，颜色改为#7a5038。其余位置、旋转、深度、高度和所有其他对象保持不变。",
          [armchair.id],
        );
        expectedChanged = [armchair.id];
      } else if (name === "delete") {
        task = await submit(
          conversation,
          "删除选中的这盏落地灯，其它所有对象保持不变。",
          [lamp.id],
        );
        expectedChanged = [lamp.id];
      } else if (name === "multi-turn-reference") {
        task = await submit(
          conversation,
          "把这把单人沙发向左移动200毫米，其它对象和其它参数保持不变。",
          [armchair.id],
        );
        record.tasks.push(task);
        assert.equal(task.status, "completed", task.error);
        task = await submit(conversation, "再把它向右移动100毫米，其它不变。");
        expectedChanged = [armchair.id];
      } else {
        task = await submit(
          conversation,
          "帮我把餐椅向左移动100毫米，其他对象保持不变。",
        );
        record.tasks.push(task);
        assert.equal(task.status, "waiting_input", JSON.stringify(task.result));
        assert.equal((await api(`/projects/${before.id}`)).revision, 0);
        task = await wait(
          await api(`/agent/tasks/${task.id}/resume`, {
            requestId: crypto.randomUUID(),
            input: "就是我现在选中的这把餐椅。",
            selectedIds: [dining.id],
          }),
        );
        expectedChanged = [dining.id];
      }
      record.tasks.push(task);
      record.after = await api(`/projects/${before.id}`);
      record.traces = [];
      for (const id of new Set(record.tasks.map((t) => t.id)))
        record.traces.push({
          taskId: id,
          events: await api(`/agent/tasks/${id}/trace`),
        });
      assert.equal(
        task.status,
        "completed",
        task.error || JSON.stringify(task.result),
      );
      const after = record.after;
      for (const key of [
        "nodes",
        "walls",
        "openings",
        "rooms",
        "structs",
        "beams",
        "measures",
      ])
        assert.deepEqual(after.plan[key], before.plan[key]);
      assert.deepEqual(
        after.plan.furniture.filter(
          (f) =>
            before.plan.furniture.some((o) => o.id === f.id) &&
            !expectedChanged.includes(f.id),
        ),
        before.plan.furniture.filter((f) => !expectedChanged.includes(f.id)),
      );
      if (name === "reading-corner")
        assert.equal(
          after.plan.furniture.find((f) => f.id === armchair.id).x,
          armchair.x - 200,
        );
      if (name === "add-floor-lamp") {
        assert.equal(
          after.plan.furniture.filter((f) => f.type === "floorLamp").length,
          2,
        );
        const roles = new Set(
          record.traces.flatMap((t) =>
            t.events
              .filter((e) => e.kind === "agent_start")
              .map((e) => e.data.role),
          ),
        );
        assert.deepEqual([...roles].sort(), [
          "assets",
          "check",
          "design",
          "main",
        ]);
      }
      if (name === "size-color") {
        const f = after.plan.furniture.find((f) => f.id === armchair.id);
        assert.equal(f.w, 900);
        assert.equal(f.color.toLowerCase(), "#7a5038");
        assert.equal(f.x, armchair.x);
        assert.equal(f.rot, armchair.rot);
      }
      if (name === "delete")
        assert.ok(!after.plan.furniture.some((f) => f.id === lamp.id));
      if (name === "multi-turn-reference") {
        assert.equal(after.revision, 2);
        assert.equal(
          after.plan.furniture.find((f) => f.id === armchair.id).x,
          armchair.x - 100,
        );
      }
      if (name === "clarification")
        assert.equal(
          after.plan.furniture.find((f) => f.id === dining.id).x,
          dining.x - 100,
        );
      const undo = (
        await api(`/projects/${before.id}/undo`, {
          operationId: crypto.randomUUID(),
          baseRevision: after.revision,
        })
      ).project;
      const redo = (
        await api(`/projects/${before.id}/redo`, {
          operationId: crypto.randomUUID(),
          baseRevision: undo.revision,
        })
      ).project;
      assert.deepEqual(redo.plan, after.plan);
      record.status = "passed";
      record.modelCalls = record.tasks.at(-1).modelCalls;
      console.log(
        `PASS ${name} repeat ${repeat} (${record.tasks.at(-1).modelCalls} model requests in last task)`,
      );
    } catch (error) {
      record.status = "failed";
      record.error = error.message;
      console.log(`FAIL ${name} repeat ${repeat}: ${error.message}`);
    }
    fs.writeFileSync(
      path.join(out, `${repeat}-${name}.json`),
      JSON.stringify(record, null, 2),
    );
    results.push({
      name,
      repeat,
      status: record.status,
      error: record.error,
      projectId: record.projectId,
    });
    fs.writeFileSync(
      path.join(out, "report.json"),
      JSON.stringify(
        {
          liveModel: true,
          provider: "DeepSeek official",
          model: "deepseek-flash",
          results,
        },
        null,
        2,
      ),
    );
  }
if (results.some((r) => r.status !== "passed")) process.exitCode = 1;
