import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const base = (process.env.ACTISCAPE_URL || "http://127.0.0.1:3001").replace(
  /\/$/,
  "",
);
const out = path.resolve(
  "test-results/generation-acceptance",
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
  );
  const v = await r.json();
  if (!r.ok) throw Error(JSON.stringify(v));
  return v;
}
async function wait(task) {
  const until = Date.now() + 720000;
  while (
    ["queued", "running", "committing"].includes(task.status) &&
    Date.now() < until
  ) {
    await new Promise((r) => setTimeout(r, 800));
    task = await api(`/agent/tasks/${task.id}`);
  }
  return task;
}
const definitions = [
  {
    name: "living-dining",
    width: 6000,
    depth: 4000,
    counts: {
      sofa: 1,
      coffeeTable: 1,
      tvCabinet: 1,
      diningTable: 1,
      chair: 4,
      floorLamp: 1,
    },
    input:
      "生成一个矩形客餐厅，室内横向净宽6米、纵向净深4米。入口在南墙，门洞左边距西侧内墙400毫米；窗在北墙居中。三人沙发、茶几、电视柜、餐桌各一个，餐椅四把、落地灯一盏。简约中性配色，家具采用目录默认尺寸，门窗宽高和层高使用系统默认值。",
  },
  {
    name: "reading-lounge",
    width: 5000,
    depth: 3600,
    counts: { armchair: 2, coffeeTable: 1, bookshelf: 1, floorLamp: 1 },
    input:
      "生成一个矩形阅读会客间，室内横向净宽500厘米、纵向净深360厘米。入口在南墙，门洞左边距西侧内墙350厘米；窗在东墙居中。单人沙发两把、茶几一张、书柜一个、落地灯一盏。简约中性配色，家具采用目录默认尺寸，门窗宽高和层高使用系统默认值。",
  },
];
const results = [];
for (let repeat = 1; repeat <= 2; repeat++)
  for (const def of definitions) {
    const record = {
      name: def.name,
      repeat,
      liveModel: true,
      provider: "DeepSeek official",
      input: def.input,
      status: "running",
    };
    try {
      const before = await api("/projects", {}),
        conversation = await api("/agent/conversations", {
          projectId: before.id,
        });
      record.before = before;
      record.conversationId = conversation.id;
      const body = {
        requestId: crypto.randomUUID(),
        mode: "generate_rectangular",
        input: def.input,
        selectedIds: [],
      };
      const accepted = await api(
        `/agent/conversations/${conversation.id}/tasks`,
        body,
      );
      assert.equal(
        (await api(`/agent/conversations/${conversation.id}/tasks`, body)).id,
        accepted.id,
      );
      const task = await wait(accepted);
      record.task = task;
      record.after = await api(`/projects/${before.id}`);
      record.trace = await api(`/agent/tasks/${task.id}/trace`);
      assert.equal(task.status, "completed", JSON.stringify(task.result));
      const after = record.after;
      assert.equal(after.revision, 1);
      assert.equal(after.history.undo, 1);
      assert.equal(after.plan.walls.length, 4);
      assert.equal(after.plan.rooms.length, 1);
      assert.equal(after.plan.openings.length, 2);
      assert.equal(task.result.generation.dimensions.width, def.width);
      assert.equal(task.result.generation.dimensions.depth, def.depth);
      assert.deepEqual(
        Object.fromEntries(
          Object.keys(def.counts).map((k) => [
            k,
            after.plan.furniture.filter((f) => f.type === k).length,
          ]),
        ),
        def.counts,
      );
      assert.equal(
        after.plan.furniture.length,
        Object.values(def.counts).reduce((a, b) => a + b, 0),
      );
      const catalogue = (await api("/catalog")).items;
      for (const f of after.plan.furniture)
        for (const key of ["w", "d", "h"])
          assert.equal(f[key], catalogue[f.key][key]);
      assert.ok(task.result.skillsUsed[0].contentHash);
      assert.ok(record.trace.some((e) => e.kind === "skill_loaded"));
      assert.deepEqual(
        [
          ...new Set(
            record.trace
              .filter((e) => e.kind === "agent_start")
              .map((e) => e.data.role),
          ),
        ].sort(),
        ["assets", "check", "design", "main"],
      );
      for (const name of [
        "search_catalogue_batch",
        "precheck_initialization",
        "candidate_checks",
      ])
        assert.ok(
          record.trace.some(
            (e) => e.kind === "tool_start" && e.data.tool === name,
          ),
          name,
        );
      const c = await api(
        `/projects/${before.id}/candidates/${task.result.candidateId}`,
      );
      assert.deepEqual(c.state.plan, after.plan);
      const request = {
        operationId: c.operationId,
        baseRevision: c.baseRevision,
        candidateHash: c.hash,
      };
      assert.equal(
        (await api(`/projects/${before.id}/candidates/${c.id}/commit`, request))
          .replayed,
        true,
      );
      assert.equal((await api(`/projects/${before.id}`)).revision, 1);
      const undone = (
        await api(`/projects/${before.id}/undo`, {
          operationId: crypto.randomUUID(),
          baseRevision: 1,
        })
      ).project;
      assert.deepEqual(undone.plan, before.plan);
      const redone = (
        await api(`/projects/${before.id}/redo`, {
          operationId: crypto.randomUUID(),
          baseRevision: 2,
        })
      ).project;
      assert.deepEqual(redone.plan, after.plan);
      record.status = "passed";
      console.log(
        `PASS ${def.name} repeat ${repeat}: ${task.modelCalls} model requests, ${task.result.repairs} repairs`,
      );
    } catch (error) {
      record.status = "failed";
      record.error = error.message;
      console.log(`FAIL ${def.name} repeat ${repeat}: ${error.message}`);
    }
    fs.writeFileSync(
      path.join(out, `${repeat}-${def.name}.json`),
      JSON.stringify(record, null, 2),
    );
    results.push({
      name: def.name,
      repeat,
      status: record.status,
      error: record.error,
      projectId: record.before?.id,
      taskId: record.task?.id,
      modelCalls: record.task?.modelCalls,
      repairs: record.task?.result?.repairs,
    });
    const report = {
      provider: "DeepSeek official",
      model: "deepseek-flash",
      liveModel: true,
      directory: out,
      results,
    };
    fs.writeFileSync(
      path.join(out, "report.json"),
      JSON.stringify(report, null, 2),
    );
    fs.writeFileSync(
      "test-results/generation-acceptance/latest.json",
      JSON.stringify(report, null, 2),
    );
  }
assert.ok(
  results.every((r) => r.status === "passed"),
  "See all retained generation case results",
);
