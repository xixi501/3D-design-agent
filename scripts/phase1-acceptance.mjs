import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const base = (process.env.ACTISCAPE_URL || "http://127.0.0.1:3111").replace(
  /\/$/,
  "",
);
const out = path.resolve(
  process.env.ACTISCAPE_ACCEPTANCE_OUT || "test-results/phase1-live",
);
fs.mkdirSync(out, { recursive: true });
export const cases = [
  {
    name: "move",
    input: "把单人沙发向左移动200毫米",
    fields: ["x"],
    expected: { x: -200 },
    relative: true,
  },
  {
    name: "rotate",
    input: "把单人沙发顺时针旋转90度",
    fields: ["rot"],
    expected: { rot: 90 },
    relative: true,
  },
  {
    name: "dimensions",
    input: "把单人沙发宽度设为900毫米",
    fields: ["w"],
    expected: { w: 900 },
  },
  {
    name: "color",
    input: "把单人沙发颜色改为#7a5038",
    fields: ["color"],
    expected: { color: "#7a5038" },
  },
  {
    name: "add",
    input:
      "在阅读角单人沙发旁边再加一盏落地灯。所有已有家具、墙体和门窗保持不变。",
    visual: true,
  },
  { name: "delete", input: "删除选中的落地灯" },
  {
    name: "reference-clarification",
    input: "把单人沙发向左移动200毫米",
    followup: "再把它向右移动100毫米",
    ambiguous: "把餐椅向左移动100毫米",
    supplement: "就是我现在选中的这把餐椅。",
  },
  {
    name: "local-layout",
    input:
      "只调整阅读角的单人沙发和落地灯的位置与朝向，让阅读椅旁的照明更方便，并留出通道。其它家具、尺寸、颜色、墙体和门窗保持不变。",
    visual: true,
  },
];
const manifest = {
  codeVersion: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  cases,
  repeats: 2,
};
manifest.caseHash = crypto
  .createHash("sha256")
  .update(JSON.stringify(cases))
  .digest("hex");
const frozen = path.join(out, "manifest.json");
if (fs.existsSync(frozen))
  assert.equal(
    JSON.parse(fs.readFileSync(frozen)).caseHash,
    manifest.caseHash,
    "冻结案例发生变化，请保留旧批次并新建证据目录",
  );
else fs.writeFileSync(frozen, JSON.stringify(manifest, null, 2));
async function api(route, body) {
  const response = await fetch(
    base + "/api" + route,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const value = await response.json();
  assert.ok(response.ok, JSON.stringify(value));
  return value;
}
async function wait(task) {
  const deadline = Date.now() + 650000;
  while (
    !["completed", "waiting_input", "failed", "conflict", "cancelled"].includes(
      task.status,
    )
  ) {
    assert.ok(Date.now() < deadline, "任务等待超时");
    await new Promise((r) => setTimeout(r, 500));
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
function protectedPlan(before, after, masks, deleted = [], added = []) {
  const expected = structuredClone(before);
  expected.furniture = expected.furniture.filter(
    (f) => !deleted.includes(f.id),
  );
  const normalized = structuredClone(after);
  normalized.furniture = normalized.furniture.filter(
    (f) => !added.includes(f.id),
  );
  for (const f of normalized.furniture)
    for (const key of masks[f.id] || [])
      f[key] = before.furniture.find((o) => o.id === f.id)[key];
  assert.deepEqual(
    normalized,
    expected,
    "出现未授权对象、字段或场景元数据变化",
  );
}
const selectedCases = process.env.ACTISCAPE_ACCEPTANCE_CASES?.split(",");
let failures = 0;
for (let repeat = 1; repeat <= 2; repeat++)
  for (const c of cases.filter(
    (c) => !selectedCases || selectedCases.includes(c.name),
  )) {
    const record = {
      name: c.name,
      repeat,
      codeVersion: manifest.codeVersion,
      caseHash: manifest.caseHash,
      status: "running",
      tasks: [],
    };
    const file = path.join(out, `${c.name}-${repeat}.json`);
    assert.ok(!fs.existsSync(file), "证据文件已存在；请新建目录保留原运行结果");
    try {
      const fixture = await api("/examples/living-dining");
      fixture.name = `阶段1 · ${c.name} · ${repeat}`;
      const before = await api("/projects", { document: fixture });
      record.before = before;
      const conversation = await api("/agent/conversations", {
        projectId: before.id,
      });
      const chair = before.plan.furniture.find((f) => f.key === "armchair"),
        lamp = before.plan.furniture.find((f) => f.key === "floorLamp"),
        dining = before.plan.furniture.find((f) => f.key === "chair");
      let task = await submit(
        conversation,
        c.input,
        c.name === "delete" ? [lamp.id] : [],
      );
      record.tasks.push(task);
      assert.equal(
        task.status,
        "completed",
        JSON.stringify(task.result || task.error),
      );
      const masks = {},
        deleted = [],
        added = [];
      let revisions = 1;
      if (c.fields) {
        masks[chair.id] = c.fields;
        const saved = await api(`/projects/${before.id}`);
        for (const [key, value] of Object.entries(c.expected)) {
          let expected = c.relative ? chair[key] + value : value;
          if (key === "rot") expected = ((expected % 360) + 360) % 360;
          assert.equal(
            saved.plan.furniture.find((f) => f.id === chair.id)[key],
            expected,
          );
        }
      } else if (c.name === "delete") deleted.push(lamp.id);
      else if (c.name === "reference-clarification") {
        task = await submit(conversation, c.followup);
        record.tasks.push(task);
        assert.equal(task.status, "completed", JSON.stringify(task.result));
        task = await submit(conversation, c.ambiguous);
        record.tasks.push(task);
        assert.equal(task.status, "waiting_input", JSON.stringify(task.result));
        assert.equal((await api(`/projects/${before.id}`)).revision, 2);
        task = await wait(
          await api(`/agent/tasks/${task.id}/resume`, {
            requestId: crypto.randomUUID(),
            input: c.supplement,
            selectedIds: [dining.id],
          }),
        );
        record.tasks.push(task);
        assert.equal(
          task.status,
          "completed",
          JSON.stringify(task.result || task.error),
        );
        revisions = 3;
        masks[chair.id] = ["x"];
        masks[dining.id] = ["x"];
        const plan = (await api(`/projects/${before.id}`)).plan;
        assert.equal(
          plan.furniture.find((f) => f.id === chair.id).x,
          chair.x - 100,
        );
        assert.equal(
          plan.furniture.find((f) => f.id === dining.id).x,
          dining.x - 100,
        );
      } else if (c.name === "local-layout") {
        masks[chair.id] = ["x", "y", "rot"];
        masks[lamp.id] = ["x", "y", "rot"];
      }
      const after = await api(`/projects/${before.id}`);
      record.after = after;
      assert.equal(after.revision, revisions);
      if (c.name === "add") {
        added.push(
          ...after.plan.furniture
            .filter((f) => !before.plan.furniture.some((o) => o.id === f.id))
            .map((f) => f.id),
        );
        assert.equal(added.length, 1);
        assert.equal(
          after.plan.furniture.find((f) => f.id === added[0]).key,
          "floorLamp",
        );
      }
      protectedPlan(before.plan, after.plan, masks, deleted, added);
      assert.deepEqual(after.roomLabelArchive, before.roomLabelArchive);
      record.traces = [];
      for (const id of new Set(record.tasks.map((t) => t.id))) {
        const events = await api(`/agent/tasks/${id}/trace`);
        record.traces.push({ taskId: id, events });
        const final = await api(`/agent/tasks/${id}`);
        assert.ok(final.result.metrics, "缺少阶段耗时与调用统计");
        if (c.visual) {
          assert.equal(final.result.verification.visualReviewed, true);
          assert.ok(final.result.metrics.renderCount >= 2);
        } else if (c.name !== "reference-clarification") {
          assert.equal(final.modelCalls, 0);
          assert.equal(final.result.metrics.renderCount, 0);
          assert.equal(
            events.filter((e) => e.kind === "agent_start").length,
            0,
          );
        }
      }
      const undo = (
        await api(`/projects/${before.id}/undo`, {
          operationId: crypto.randomUUID(),
          baseRevision: after.revision,
        })
      ).project;
      assert.equal(undo.revision, after.revision + 1);
      if (revisions === 1) assert.deepEqual(undo.plan, before.plan);
      const redo = (
        await api(`/projects/${before.id}/redo`, {
          operationId: crypto.randomUUID(),
          baseRevision: undo.revision,
        })
      ).project;
      assert.equal(redo.revision, undo.revision + 1);
      assert.deepEqual(redo.plan, after.plan);
      record.status = "passed";
      console.log(
        `PASS ${c.name} ${repeat}: ${task.modelCalls} calls, ${task.result.metrics.renderCount} renders, ${task.result.metrics.elapsedSeconds}s`,
      );
    } catch (error) {
      failures++;
      record.status = "failed";
      record.error = String(error.stack || error);
      console.error(`FAIL ${c.name} ${repeat}: ${error.message}`);
      if (record.before)
        record.after = await api(`/projects/${record.before.id}`).catch(
          () => null,
        );
      record.traces = await Promise.all(
        [...new Set(record.tasks.map((t) => t.id))].map(async (id) => ({
          taskId: id,
          events: await api(`/agent/tasks/${id}/trace`),
        })),
      );
    }
    fs.writeFileSync(file, JSON.stringify(record, null, 2));
  }
process.exitCode = failures ? 1 : 0;
