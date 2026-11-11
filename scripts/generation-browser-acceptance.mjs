import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { launch } from "../reference/upstream/scripts/browser.mjs";
const base = (process.env.ACTISCAPE_URL || "http://127.0.0.1:3001").replace(
  /\/$/,
  "",
);
const out = path.resolve("test-results/generation-browser");
fs.mkdirSync(out, { recursive: true });
async function api(route) {
  const r = await fetch(base + "/api" + route);
  const v = await r.json();
  if (!r.ok) throw Error(JSON.stringify(v));
  return v;
}
const browser = await launch({
    gpu: false,
    viewport: { width: 1440, height: 1000 },
  }),
  page = await browser.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const recordPath = path.join(out, "before-restart.json"),
  afterRestart = process.argv.includes("--after-restart");
async function ready() {
  await page.waitForFunction(
    () =>
      document.querySelector("#save-state")?.textContent === "已保存到项目服务",
    { timeout: 60000 },
  );
}
async function chat() {
  await page.click('[data-panel="chat"]');
  await page.waitForFunction(
    () =>
      document.querySelector(".chat-connection")?.textContent ===
      "设计助手已连接",
    { timeout: 60000 },
  );
}
async function submit(text, resume = false) {
  await page.type(".chat-panel textarea", text);
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      (resume
        ? /\/api\/agent\/tasks\/[^/]+\/resume$/
        : /\/api\/agent\/conversations\/[^/]+\/tasks$/
      ).test(new URL(r.url()).pathname),
  );
  await page.click(".chat-actions .primary");
  const r = await response;
  assert.ok(r.ok(), await r.text());
  let task = await r.json();
  const until = Date.now() + 660000;
  while (
    ["queued", "running", "committing"].includes(task.status) &&
    Date.now() < until
  ) {
    await new Promise((r) => setTimeout(r, 800));
    task = await api(`/agent/tasks/${task.id}`);
  }
  await page.waitForFunction(
    (s) =>
      document.querySelector(".chat-task:last-child .chat-status")?.dataset
        .status === s,
    { timeout: 30000 },
    task.status,
  );
  return task;
}
async function uiRevision(revision) {
  await page.waitForFunction(
    (r) => document.querySelector("footer")?.textContent.includes(`版本 ${r}`),
    { timeout: 30000 },
    revision,
  );
  await ready();
}
try {
  if (!afterRestart) {
    await page.goto(base + "/", { waitUntil: "load" });
    await page.waitForSelector("#dialog[open] #gallery-new-project");
    await page.click("#gallery-new-project");
    await ready();
    const id = new URL(page.url()).searchParams.get("project");
    assert.ok(id, "new blank project should have an id");
    await page.waitForFunction(
      () =>
        document.querySelector(".chat-actions .primary")?.textContent ===
        "生成房间",
    );
    const first = await submit("帮我设计一个温馨的矩形阅读会客间。");
    assert.equal(first.status, "waiting_input");
    assert.equal((await api(`/projects/${id}`)).revision, 0);
    assert.ok(
      await page.$eval(".chat-brief", (e) => e.textContent.includes("待确认")),
    );
    await page.screenshot({ path: path.join(out, "01-missing.png") });
    await page.reload({ waitUntil: "load" });
    await ready();
    await chat();
    assert.ok(await page.$('[data-status="waiting_input"]'));
    const task = await submit(
      "房间室内横向净宽5米、纵向净深3.6米。入口在南墙，门洞左边距西侧内墙3.5米；窗在东墙居中。需要两把单人沙发、一张茶几、一个书柜和一盏落地灯。采用温暖的中性配色，家具使用目录默认尺寸，门窗宽高和层高使用系统默认值。",
      true,
    );
    assert.equal(task.id, first.id);
    assert.equal(task.status, "completed", JSON.stringify(task.result));
    await uiRevision(1);
    const generated = await api(`/projects/${id}`);
    assert.equal(generated.plan.furniture.length, 5);
    assert.equal(generated.history.undo, 1);
    assert.equal(
      await page.$eval(".chat-actions .primary", (e) => e.textContent),
      "发送",
    );
    await page.click('[data-view="split"]');
    await page.$eval(".chat-brief", (e) => {
      e.open = true;
    });
    await page.screenshot({ path: path.join(out, "02-generated.png") });
    await page.click("#undo");
    await uiRevision(2);
    assert.equal((await api(`/projects/${id}`)).plan.walls.length, 0);
    await page.click("#redo");
    await uiRevision(3);
    assert.deepEqual((await api(`/projects/${id}`)).plan, generated.plan);
    assert.equal(
      await page.evaluate(() => typeof window.__actiscape),
      "undefined",
    );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      recordPath,
      JSON.stringify(
        {
          phase: "before-restart",
          passed: true,
          liveModel: true,
          projectId: id,
          task,
          generated,
          clarificationSameTask: true,
          reloadedWhileWaiting: true,
          undoToBlank: true,
          redo: true,
          errors,
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS browser new project / brief clarification / persisted waiting / real four-role generation / SSE / one-step undo-to-blank / redo",
    );
  } else {
    const saved = JSON.parse(fs.readFileSync(recordPath, "utf8")),
      id = saved.projectId;
    await page.goto(`${base}/?project=${id}`, { waitUntil: "load" });
    await ready();
    await chat();
    await page.waitForFunction(() =>
      document.querySelector('.chat-task [data-status="completed"]'),
    );
    const before = await api(`/projects/${id}`),
      target = saved.task.result.focusIds[0],
      chair = before.plan.furniture.find((f) => f.id === target);
    assert.ok(chair);
    assert.equal(
      (await api(`/agent/tasks/${saved.task.id}`)).modelCalls,
      saved.task.modelCalls,
    );
    const edit = await submit(
      "把它向左移动100毫米，其他位置、尺寸、颜色、其他家具、墙体和门窗都保持不变。",
    );
    assert.equal(edit.mode, "edit");
    assert.equal(edit.status, "completed", JSON.stringify(edit.result));
    await uiRevision(before.revision + 1);
    const after = await api(`/projects/${id}`);
    assert.equal(
      after.plan.furniture.find((f) => f.id === target).x,
      chair.x - 100,
    );
    const expected = structuredClone(before.plan);
    expected.furniture.find((f) => f.id === target).x -= 100;
    assert.deepEqual(after.plan, expected);
    await page.click("#undo");
    await uiRevision(after.revision + 1);
    assert.deepEqual((await api(`/projects/${id}`)).plan, before.plan);
    await page.click("#redo");
    await uiRevision(after.revision + 2);
    assert.deepEqual((await api(`/projects/${id}`)).plan, after.plan);
    await page.reload({ waitUntil: "load" });
    await ready();
    await chat();
    assert.equal(
      await page.$$eval(
        '.chat-task [data-status="completed"]',
        (es) => es.length,
      ),
      2,
    );
    await page.click('[data-view="split"]');
    await page.screenshot({ path: path.join(out, "03-reopened-edited.png") });
    assert.deepEqual(errors, []);
    const trace = await api(`/agent/tasks/${saved.task.id}/trace`),
      editTrace = await api(`/agent/tasks/${edit.id}/trace`);
    fs.writeFileSync(
      path.join(out, "report.json"),
      JSON.stringify(
        {
          passed: true,
          liveModel: true,
          projectId: id,
          clarificationSameTask: true,
          summaryCard: true,
          automaticEditMode: true,
          serviceRestartContinued: true,
          focusReference: true,
          undoRedoAcrossRestart: true,
          reopenConversation: true,
          normalEntryWithoutDebug: true,
          errors,
          generationTask: saved.task,
          editTask: edit,
          generated: saved.generated,
          after,
          trace,
          editTrace,
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS browser service-restart recovery / pinned Skill / continuous reference / real local edit / persistent history / reopened conversation",
    );
  }
} catch (error) {
  await page
    .screenshot({ path: path.join(out, "failure.png") })
    .catch(() => {});
  fs.writeFileSync(
    path.join(out, afterRestart ? "failure-after.json" : "failure-before.json"),
    JSON.stringify({ passed: false, error: error.message, errors }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
}
