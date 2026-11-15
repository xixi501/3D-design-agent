import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { launch } from "../reference/upstream/scripts/browser.mjs";

const base = (process.env.ACTISCAPE_URL || "http://127.0.0.1:3131").replace(/\/$/, "");
const out = path.resolve(process.env.ACTISCAPE_BROWSER_OUT || "test-results/generation-browser");
fs.mkdirSync(out, { recursive: true });
const afterRestart = process.argv.includes("--after-restart");
const statePath = path.join(out, "state.json");
const report = {
  codeVersion: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  phase: afterRestart ? "after-restart" : "before-restart",
  liveModel: true,
  steps: [],
  errors: [],
};
async function api(route, body) {
  const r = await fetch(base + "/api" + route, body === undefined ? undefined : {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await r.json();
  assert.ok(r.ok, JSON.stringify(result));
  return result;
}
async function waitTask(id, timeout = 720000) {
  let task = await api(`/agent/tasks/${id}`);
  const until = Date.now() + timeout;
  while (["queued", "running", "committing"].includes(task.status) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 800));
    task = await api(`/agent/tasks/${id}`);
  }
  return task;
}
const browser = await launch({ gpu: false, viewport: { width: 1440, height: 1000 } });
const page = await browser.newPage();
page.on("pageerror", (e) => report.errors.push(e.message));
const FULL_MASTER =
  "生成一个矩形主卧，室内横向净宽3600毫米、纵向净深4200毫米。入口在南墙居中；窗在东墙居中。1.8m 双人床一张、床头柜两个、衣柜一个。简约中性配色，家具采用目录默认尺寸，门窗宽高和层高使用系统默认值。";
async function ready() {
  await page.waitForFunction(
    () =>
      document.querySelector("#save-state")?.textContent === "已保存到项目服务" &&
      (!window.__actiscape || !window.__actiscape.busy),
    { timeout: 90000 },
  );
}
async function chat() {
  await page.click('[data-panel="chat"]');
  await page.waitForFunction(
    () => document.querySelector(".chat-connection")?.textContent === "设计助手已连接",
    { timeout: 90000 },
  );
}
async function uiRevision(revision) {
  await page.waitForFunction(
    (r) => document.querySelector("footer")?.textContent.includes(`版本 ${r}`),
    { timeout: 90000 },
    revision,
  );
  await ready();
}
async function newProject() {
  await page.goto(base + "/", { waitUntil: "load" });
  await page.waitForSelector("#open-project");
  if (!(await page.$("#dialog[open]"))) await page.click("#open-project");
  await page.waitForSelector("#dialog[open] #gallery-new-project");
  await page.click("#gallery-new-project");
  await ready();
  await chat();
  const id = new URL(page.url()).searchParams.get("project");
  assert.ok(id);
  return id;
}
async function startTask(text, resume = false) {
  await page.type(".chat-panel textarea", text);
  const response = page.waitForResponse((r) =>
    r.request().method() === "POST" &&
    (resume
      ? /\/api\/agent\/tasks\/[^/]+\/resume$/.test(new URL(r.url()).pathname)
      : /\/api\/agent\/conversations\/[^/]+\/tasks$/.test(new URL(r.url()).pathname)),
  );
  await page.click(".chat-actions .primary");
  const r = await response;
  assert.ok(r.ok(), await r.text());
  return r.json();
}
async function submit(text, resume = false) {
  const task = await startTask(text, resume);
  const result = await waitTask(task.id);
  await page.waitForFunction(
    (id, status) => document.querySelector(`.chat-task[data-task="${id}"] .chat-status`)?.dataset.status === status,
    { timeout: 90000 },
    result.id,
    result.status,
  );
  return result;
}
async function taskCount(projectId) {
  const conversations = await api(`/agent/conversations?projectId=${projectId}`);
  assert.equal(conversations.length, 1);
  return api(`/agent/conversations/${conversations[0].id}/tasks`);
}
async function openProject(id, debug = false) {
  await page.goto(`${base}/?project=${id}${debug ? "&debug" : ""}`, { waitUntil: "load" });
  await ready();
  await chat();
}
async function selectObject(id) {
  await page.evaluate((id) => __actiscape.select({ collection: "furniture", id }), id);
  await page.waitForFunction(
    () => document.querySelector(".chat-context")?.textContent.includes("当前选择"),
    { timeout: 30000 },
  );
}
async function step(name, fn) {
  try {
    await fn();
    report.steps.push({ name, status: "passed" });
    console.log("PASS", name);
  } catch (error) {
    report.steps.push({ name, status: "failed", error: error.stack });
    console.error("FAIL", name, error.message);
    await page.screenshot({ path: path.join(out, `failure-${report.steps.length}.png`) }).catch(() => {});
    throw error;
  }
}
try {
  if (!afterRestart) {
    let generatedProject, generatedTask, generatedPlan;
    await step("disconnect during generation, refresh and recover the same task", async () => {
      generatedProject = await newProject();
      const started = await startTask(FULL_MASTER);
      let running = await api(`/agent/tasks/${started.id}`);
      const until = Date.now() + 120000;
      while (!["running", "committing"].includes(running.status) && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 500));
        running = await api(`/agent/tasks/${started.id}`);
      }
      assert.ok(["running", "committing"].includes(running.status), JSON.stringify(running));
      // Drop the browser connection while the server keeps working.
      await page.reload({ waitUntil: "load" });
      await ready();
      await chat();
      const completed = await waitTask(started.id);
      assert.equal(completed.status, "completed", JSON.stringify(completed.result));
      await page.waitForFunction(
        (id) => document.querySelector(`.chat-task[data-task="${id}"] .chat-status`)?.dataset.status === "completed",
        { timeout: 90000 },
        started.id,
      );
      await uiRevision(1);
      const project = await api(`/projects/${generatedProject}`);
      assert.equal(project.revision, 1);
      assert.equal(project.history.undo, 1);
      assert.equal(project.plan.furniture.length, 4);
      const tasks = await taskCount(generatedProject);
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0].id, started.id);
      generatedTask = completed;
      generatedPlan = project.plan;
      await page.screenshot({ path: path.join(out, "01-recovered-generation.png") });
    });

    let clarifyProject, generatedClarifyPlan;
    await step("new blank, missing information, refresh, supplement same task, summary and undo/redo", async () => {
      clarifyProject = await newProject();
      const waiting = await submit("帮我设计一个温馨的矩形主卧。");
      assert.equal(waiting.status, "waiting_input", JSON.stringify(waiting.result));
      assert.equal((await api(`/projects/${clarifyProject}`)).revision, 0);
      assert.ok(await page.$eval(".chat-brief", (e) => /待确认|补充/.test(e.textContent)));
      await page.screenshot({ path: path.join(out, "02-missing-information.png") });
      await page.reload({ waitUntil: "load" });
      await ready();
      await chat();
      await page.waitForFunction(
        (id) => document.querySelector(`.chat-task[data-task="${id}"] .chat-status`)?.dataset.status === "waiting_input",
        { timeout: 90000 },
        waiting.id,
      );
      const resumed = await submit(FULL_MASTER, true);
      assert.equal(resumed.id, waiting.id);
      assert.equal(resumed.status, "completed", JSON.stringify(resumed.result));
      await uiRevision(1);
      generatedClarifyPlan = (await api(`/projects/${clarifyProject}`)).plan;
      assert.equal(generatedClarifyPlan.furniture.length, 4);
      assert.ok((await page.$eval(".chat-brief", (e) => e.textContent)).length > 10);
      await page.screenshot({ path: path.join(out, "03-generated-with-summary.png") });
      await page.click("#undo");
      await uiRevision(2);
      assert.equal((await api(`/projects/${clarifyProject}`)).plan.walls.length, 0);
      await page.click("#redo");
      await uiRevision(3);
      assert.deepEqual((await api(`/projects/${clarifyProject}`)).plan, generatedClarifyPlan);
      await page.screenshot({ path: path.join(out, "04-undo-redo.png") });
    });

    let exactBefore, exactAfter, exactTarget, exactExpected;
    await step("generated master, pointer selection and compound exact edit preserve every other field", async () => {
      await openProject(generatedProject, true);
      const before = await api(`/projects/${generatedProject}`);
      exactBefore = before;
      const stands = before.plan.furniture.filter((f) => f.type === "nightstand");
      assert.ok(stands.length >= 1);
      exactTarget = stands.slice().sort((a, b) => a.x - b.x)[0];
      const text =
        "把它高度设为550毫米，颜色改为#7a5038，其他家具、墙体和门窗保持不变。";
      const at = await page.evaluate((f) => __actiscape.planView.screen(f), exactTarget);
      await page.mouse.click(at.x, at.y);
      await page.waitForFunction(
        (name) => document.querySelector(".chat-context")?.textContent.includes(name),
        { timeout: 30000 },
        exactTarget.name.split("（")[0].split("(")[0],
      );
      const edit = await submit(text);
      assert.equal(edit.status, "completed", JSON.stringify(edit.result));
      assert.equal(edit.mode, "edit");
      await uiRevision(before.revision + 1);
      const after = await api(`/projects/${generatedProject}`);
      const expected = structuredClone(before.plan);
      const target = expected.furniture.find((f) => f.id === exactTarget.id);
      target.h = 550;
      target.color = "#7a5038";
      assert.deepEqual(after.plan, expected);
      exactAfter = after;
      exactExpected = expected;
      assert.equal(after.plan.walls.length, 4);
      assert.equal(after.plan.openings.length, 2);
      const tasks = await taskCount(generatedProject);
      assert.equal(tasks.length, 2);
      assert.ok(tasks.every((t) => t.status === "completed"));
      await page.screenshot({ path: path.join(out, "05-compound-exact-edit.png") });
      await page.click("#undo");
      await uiRevision(after.revision + 1);
      assert.deepEqual((await api(`/projects/${generatedProject}`)).plan, before.plan);
      await page.click("#redo");
      await uiRevision(after.revision + 2);
      assert.deepEqual((await api(`/projects/${generatedProject}`)).plan, after.plan);
    });
    fs.writeFileSync(statePath, JSON.stringify({
      generatedProject,
      generatedTaskId: generatedTask.id,
      generatedPlan,
      clarifyProject,
      generatedClarifyPlan,
      exactBefore,
      exactAfter,
      exactTargetId: exactTarget.id,
      exactTarget,
      exactExpected,
      finalRevision: (await api(`/projects/${generatedProject}`)).revision,
      finalPlan: (await api(`/projects/${generatedProject}`)).plan,
      steps: report.steps,
      errors: report.errors,
    }, null, 2));
    report.passed = true;
    console.log("PASS browser disconnect/recovery, clarification, generated summary, undo/redo, compound exact edit");
  } else {
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    await step("full service restart keeps project, conversation and history", async () => {
      await openProject(state.generatedProject);
      const project = await api(`/projects/${state.generatedProject}`);
      assert.equal(project.revision, state.finalRevision);
      assert.deepEqual(project.plan, state.finalPlan);
      const tasks = await taskCount(state.generatedProject);
      assert.equal(tasks.length, 2);
      assert.ok(tasks.every((t) => t.status === "completed"));
      assert.ok(await page.$$('.chat-task [data-status="completed"]'));
      await page.screenshot({ path: path.join(out, "06-after-restart.png") });
    });
    await step("reopened conversation continues editing without regenerating", async () => {
      const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
      const before = await api(`/projects/${state.generatedProject}`);
      const target = before.plan.furniture.find((f) => f.id === state.exactTargetId);
      assert.ok(target);
      await openProject(state.generatedProject, true);
      await selectObject(target.id);
      const edit = await submit("把它向左移动50毫米，其他家具、墙体和门窗保持不变。");
      assert.equal(edit.status, "completed", JSON.stringify(edit.result));
      await uiRevision(before.revision + 1);
      const after = await api(`/projects/${state.generatedProject}`);
      assert.equal(after.plan.furniture.find((f) => f.id === target.id).x, target.x - 50);
      const expected = structuredClone(before.plan);
      expected.furniture.find((f) => f.id === target.id).x -= 50;
      assert.deepEqual(after.plan, expected);
      const tasks = await taskCount(state.generatedProject);
      assert.equal(tasks.length, 3);
      await page.click("#undo");
      await uiRevision(after.revision + 1);
      assert.deepEqual((await api(`/projects/${state.generatedProject}`)).plan, before.plan);
      await page.click("#redo");
      await uiRevision(after.revision + 2);
      assert.deepEqual((await api(`/projects/${state.generatedProject}`)).plan, after.plan);
      await page.screenshot({ path: path.join(out, "07-continued-after-restart.png") });
    });
    await step("clarification project and history reopen after restart", async () => {
      const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
      await openProject(state.clarifyProject);
      const project = await api(`/projects/${state.clarifyProject}`);
      assert.equal(project.revision, 3);
      assert.deepEqual(project.plan, state.generatedClarifyPlan);
      const tasks = await taskCount(state.clarifyProject);
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0].status, "completed");
      assert.ok(tasks[0].input.includes("用户补充"));
      await page.screenshot({ path: path.join(out, "08-clarification-after-restart.png") });
    });
    report.passed = true;
    console.log("PASS full restart, reopening, history and continued editing");
  }
  report.steps = report.steps;
  fs.writeFileSync(path.join(out, afterRestart ? "report-after-restart.json" : "report-before-restart.json"), JSON.stringify(report, null, 2));
  assert.deepEqual(report.errors, []);
} catch (error) {
  fs.writeFileSync(path.join(out, afterRestart ? "failure-after-restart.json" : "failure-before-restart.json"), JSON.stringify({ ...report, error: error.stack }, null, 2));
  throw error;
} finally {
  await browser.close();
}

function footprint(f) {
  const radians = (f.rot * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians)), sin = Math.abs(Math.sin(radians));
  const w = f.w * cos + f.d * sin, d = f.w * sin + f.d * cos;
  return { x0: f.x - w / 2, x1: f.x + w / 2, y0: f.y - d / 2, y1: f.y + d / 2 };
}
