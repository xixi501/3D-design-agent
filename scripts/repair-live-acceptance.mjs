import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const base = (process.env.ACTISCAPE_URL || "http://127.0.0.1:3001").replace(
  /\/$/,
  "",
);
const out = path.resolve(
  process.env.ACTISCAPE_ACCEPTANCE_OUT ||
    `test-results/repair-acceptance/${new Date().toISOString().replace(/[:.]/g, "-")}`,
);
fs.mkdirSync(out, { recursive: true });
const repeats = Math.max(
  1,
  Number(process.env.ACTISCAPE_REPAIR_REPEATS || 2),
);
const onlyCase = process.env.ACTISCAPE_REPAIR_CASE || "";
const terminal = new Set([
  "completed",
  "failed",
  "cancelled",
  "conflict",
  "waiting_input",
]);
const cases = [
  {
    name: "openable",
    file: "openable.plan.json",
    roomId: "openable-room",
    expectedBaseline: "OPENABLE_FRONT_BLOCKED",
  },
  {
    name: "wall",
    file: "wall.plan.json",
    roomId: "wall-room",
    expectedBaseline: "FURNITURE_IN_WALL",
  },
  {
    name: "circulation",
    file: "circulation.plan.json",
    roomId: "circulation-room",
    expectedBaseline: "CIR-02",
  },
].filter((item) => !onlyCase || item.name === onlyCase);

async function request(route, init, retry = true) {
  const url = base + "/api" + route;
  try {
    const response = await fetch(url, init);
    const value = await response.json().catch(() => ({}));
    if (response.status === 502 || response.status === 503) {
      if (retry) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return request(route, init, false);
      }
      throw Error(`HTTP ${response.status}: ${JSON.stringify(value)}`);
    }
    if (!response.ok) throw Error(`HTTP ${response.status}: ${JSON.stringify(value)}`);
    return value;
  } catch (error) {
    if (retry && !/^HTTP /.test(String(error.message))) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return request(route, init, false);
    }
    throw error;
  }
}
const api = (route, body) =>
  request(
    route,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
async function wait(task) {
  const deadline = Date.now() + 720000;
  while (!terminal.has(task.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    task = await api(`/agent/tasks/${task.id}`);
  }
  return task;
}
function targetIds(before, furniture) {
  const ids = new Set(furniture.map((item) => item.id));
  return [
    ...new Set(
      before.issues
        .filter((issue) => issue.level === "error")
        .flatMap((issue) => issue.objectIds || []),
    ),
  ].filter((id) => ids.has(id));
}
function changedFurniture(before, after) {
  const old = new Map(before.plan.furniture.map((item) => [item.id, item]));
  const current = new Map(after.plan.furniture.map((item) => [item.id, item]));
  return {
    added: [...current.keys()].filter((id) => !old.has(id)),
    deleted: [...old.keys()].filter((id) => !current.has(id)),
    updated: [...current.keys()].filter(
      (id) =>
        old.has(id) && JSON.stringify(old.get(id)) !== JSON.stringify(current.get(id)),
    ),
  };
}
const results = [];
let failed = false;
for (const item of cases) {
  for (let repeat = 1; repeat <= repeats; repeat++) {
    const record = {
      name: item.name,
      repeat,
      liveModel: true,
      status: "running",
      projectId: null,
      taskId: null,
    };
    try {
      const document = JSON.parse(
        fs.readFileSync(path.join("fixtures/repair-cases", item.file), "utf8"),
      );
      document.name = `Stage-2 repair acceptance · ${item.name} · ${repeat}`;
      const before = await api("/projects", { document });
      record.projectId = before.id;
      const conversation = await api("/agent/conversations", {
        projectId: before.id,
      });
      const beforeChecks = await api(`/projects/${before.id}/checks`);
      assert.ok(
        beforeChecks.issues.some((issue) => issue.code === item.expectedBaseline),
        `missing baseline ${item.expectedBaseline}`,
      );
      const errors = beforeChecks.issues.filter(
        (issue) => issue.level === "error" && issue.fixableByFurniture !== false,
      );
      assert.ok(errors.length, "no fixable baseline error");
      const selectedIds = targetIds(beforeChecks, before.plan.furniture);
      assert.ok(selectedIds.length, "no furniture target");
      const messages = [...new Set(errors.map((issue) => issue.message))];
      const brief = `请作为布局修复 Agent，只修复以下可移动家具问题，目标问题必须真正消失：
${messages.map((message) => `- ${message}`).join("\n")}

要求：
1. 只修改授权 target 家具，不移动墙体、门窗，不新增或删除家具；
2. 保留无关家具和风格；
3. 生成候选后必须通过严格检查，否则明确说明原因；
4. 不要用几毫米的微移规避问题。`;
      const started = await api(
        `/agent/conversations/${conversation.id}/tasks`,
        {
          requestId: crypto.randomUUID(),
          input: brief,
          selectedIds,
          allowedRoomIds: [item.roomId],
          mode: "repair_layout",
        },
      );
      record.taskId = started.id;
      const task = await wait(started);
      record.task = {
        id: task.id,
        status: task.status,
        modelCalls: task.modelCalls,
        elapsedSeconds: task.elapsedSeconds,
        error: task.error,
      };
      assert.equal(task.status, "completed", task.error || JSON.stringify(task.result));
      const after = await api(`/projects/${before.id}`);
      const afterChecks = await api(`/projects/${before.id}/checks`);
      const selected = new Set(selectedIds);
      const diff = changedFurniture(before, after);
      assert.equal(after.revision, before.revision + 1);
      assert.deepEqual(diff.added, []);
      assert.deepEqual(diff.deleted, []);
      assert.ok(
        diff.updated.every((id) => selected.has(id)),
        `changed outside targets: ${diff.updated.join(",")}`,
      );
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
      const targetAfter = afterChecks.issues.filter(
        (issue) =>
          issue.level === "error" &&
          issue.objectIds.some((id) => selected.has(id)),
      );
      assert.deepEqual(targetAfter, [], JSON.stringify(targetAfter));
      const otherAfter = afterChecks.issues.filter(
        (issue) =>
          issue.level === "error" &&
          !issue.objectIds.some((id) => selected.has(id)),
      );
      assert.deepEqual(otherAfter, [], JSON.stringify(otherAfter));
      assert.equal(task.result?.checks?.targetIssuesAfter, 0);
      assert.equal(task.result?.checks?.remainingIssues, 0);
      record.status = "passed";
      record.selectedIds = selectedIds;
      record.beforeChecks = beforeChecks;
      record.afterChecks = afterChecks;
      record.changed = diff;
      console.log(
        `PASS ${item.name} repeat ${repeat} (${task.modelCalls} model requests)`,
      );
    } catch (error) {
      failed = true;
      record.status = "failed";
      record.error = String(error.stack || error);
      console.log(`FAIL ${item.name} repeat ${repeat}: ${error.message}`);
    }
    results.push(record);
    fs.writeFileSync(
      path.join(out, `${item.name}-${repeat}.json`),
      JSON.stringify(record, null, 2),
    );
  }
}
fs.writeFileSync(
  path.join(out, "report.json"),
  JSON.stringify(
    {
      liveModel: true,
      provider: "DeepSeek",
      base,
      repeats,
      cases: cases.map((item) => item.name),
      results,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ passed: !failed, out, results: results.map((r) => ({ name: r.name, repeat: r.repeat, status: r.status, error: r.error })) }));
if (failed) process.exitCode = 1;
