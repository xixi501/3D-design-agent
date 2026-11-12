import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { launch } from "../reference/upstream/scripts/browser.mjs";

const base = process.env.ACTISCAPE_URL || "http://127.0.0.1:3111";
const out = path.resolve(
  process.env.ACTISCAPE_BROWSER_OUT || "test-results/phase1-browser",
);
fs.mkdirSync(out, { recursive: true });
const report = {
  codeVersion: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  steps: [],
  errors: [],
};
async function api(route, body) {
  const r = await fetch(
    base + "/api" + route,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const result = await r.json();
  assert.ok(r.ok, JSON.stringify(result));
  return result;
}
const project = await api("/projects", {
  document: await api("/examples/living-dining"),
});
report.projectId = project.id;
const browser = await launch({
  gpu: false,
  viewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => report.errors.push(e.message));
const current = () => page.evaluate(() => __actiscape.project);
async function ready() {
  await page.waitForFunction(
    () =>
      window.__actiscape?.project &&
      !__actiscape.busy &&
      document.querySelector("#save-state").textContent === "已保存到项目服务",
    { timeout: 60000 },
  );
}
async function changed(revision) {
  await page.waitForFunction(
    (r) => __actiscape.project.revision > r && !__actiscape.busy,
    { timeout: 60000 },
    revision,
  );
  return current();
}
async function clickMutation(selector) {
  const p = await current();
  await page.click(selector);
  return changed(p.revision);
}
async function select(id, collection = "furniture") {
  await page.evaluate(
    (id, collection) => __actiscape.select({ collection, id }),
    id,
    collection,
  );
}
async function send(text) {
  await page.type(".chat-panel textarea", text);
  await page.click(".chat-actions .primary");
}
async function completed() {
  await page.waitForFunction(
    () =>
      document.querySelector(".chat-task:last-child .chat-status")?.dataset
        .status === "completed",
    { timeout: 650000 },
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
    throw error;
  }
}
try {
  await page.goto(`${base}/?project=${project.id}&debug`, {
    waitUntil: "load",
  });
  await ready();
  await page.click('[data-panel="chat"]');
  await page.waitForFunction(
    () =>
      document.querySelector(".chat-connection")?.textContent ===
      "设计助手已连接",
  );
  const chair = project.plan.furniture.find((f) => f.key === "armchair");
  let saved;
  await step(
    "pointer selection, compound edit, refresh reconnect and one undo transaction",
    async () => {
      const at = await page.evaluate(
        (f) => __actiscape.planView.screen(f),
        chair,
      );
      await page.mouse.click(at.x, at.y);
      await page.waitForFunction(() =>
        document
          .querySelector(".chat-context")
          .textContent.includes("单人沙发"),
      );
      await send(
        "把它向左移动100毫米，并顺时针旋转90度，宽度设为900毫米，颜色改为#123456",
      );
      await page.waitForFunction(
        () => document.querySelectorAll(".chat-task").length === 1,
      );
      // Drop the event stream and reconnect to the persisted task after refresh.
      await page.setOfflineMode(true);
      await page.setOfflineMode(false);
      await page.reload({ waitUntil: "load" });
      await ready();
      await page.click('[data-panel="chat"]');
      await completed();
      await page.waitForFunction(() => __actiscape.project.revision === 1);
      saved = await current();
      const f = saved.plan.furniture.find((f) => f.id === chair.id);
      assert.deepEqual(
        { x: f.x, rot: f.rot, w: f.w, color: f.color },
        {
          x: chair.x - 100,
          rot: (chair.rot + 90) % 360,
          w: 900,
          color: "#123456",
        },
      );
      const expected = structuredClone(project.plan);
      Object.assign(
        expected.furniture.find((f) => f.id === chair.id),
        { x: f.x, rot: f.rot, w: f.w, color: f.color },
      );
      assert.deepEqual(saved.plan, expected);
      const conversations = await api(
        `/agent/conversations?projectId=${project.id}`,
      );
      const tasks = await api(
        `/agent/conversations/${conversations[0].id}/tasks`,
      );
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0].modelCalls, 0);
      assert.equal(tasks[0].result.metrics.renderCount, 0);
      report.compoundTask = tasks[0];
      assert.deepEqual((await clickMutation("#undo")).plan, project.plan);
      assert.deepEqual((await clickMutation("#redo")).plan, saved.plan);
    },
  );
  await step(
    "idempotent exact request displays no change without another revision",
    async () => {
      const before = await current();
      await select(chair.id);
      await send("把单人沙发宽度设为900毫米");
      await page.waitForFunction(
        () => document.querySelectorAll(".chat-task").length === 2,
      );
      await completed();
      assert.equal((await current()).revision, before.revision);
      assert.ok(
        await page.$eval(".chat-task:last-child", (el) =>
          el.textContent.includes("无需修改"),
        ),
      );
    },
  );
  await step(
    "manual cabinet and lamp switches save, reopen and undo/redo",
    async () => {
      await page.click('[data-panel="checks"]');
      const before = await current(),
        cab = before.plan.furniture.find((f) => f.key === "cabTall"),
        lamp = before.plan.furniture.find((f) => f.key === "floorLamp");
      await select(cab.id);
      const opened = await clickMutation("#selection-toggle");
      assert.equal(
        opened.plan.furniture.find((f) => f.id === cab.id).opt.open,
        true,
      );
      const undo = await clickMutation("#undo");
      assert.deepEqual(undo.plan, before.plan);
      assert.deepEqual((await clickMutation("#redo")).plan, opened.plan);
      await page.reload({ waitUntil: "load" });
      await ready();
      assert.deepEqual((await current()).plan, opened.plan);
      await select(cab.id);
      assert.equal(
        await page.$eval("#selection-toggle", (el) => el.textContent),
        "关闭柜门",
      );
      const closed = await clickMutation("#selection-toggle");
      assert.equal(
        closed.plan.furniture.find((f) => f.id === cab.id).opt.open,
        false,
      );
      await select(lamp.id);
      const off = await clickMutation("#selection-toggle");
      assert.equal(
        off.plan.furniture.find((f) => f.id === lamp.id).opt.on,
        false,
      );
      assert.deepEqual((await clickMutation("#undo")).plan, closed.plan);
      assert.deepEqual((await clickMutation("#redo")).plan, off.plan);
      await select(lamp.id);
      assert.equal(
        (await clickMutation("#selection-toggle")).plan.furniture.find(
          (f) => f.id === lamp.id,
        ).opt.on,
        true,
      );
    },
  );
  await step(
    "manual door state persists and has reversible history",
    async () => {
      const before = await current(),
        door = before.plan.openings.find((o) => o.type === "door");
      await select(door.id, "openings");
      await page.$eval('[data-field="open"]', (el) => {
        el.checked = true;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
      const opened = await changed(before.revision);
      assert.equal(
        opened.plan.openings.find((o) => o.id === door.id).open,
        true,
      );
      assert.deepEqual((await clickMutation("#undo")).plan, before.plan);
      assert.deepEqual((await clickMutation("#redo")).plan, opened.plan);
      await page.reload({ waitUntil: "load" });
      await ready();
      assert.deepEqual((await current()).plan, opened.plan);
      await select(door.id, "openings");
      assert.equal(
        await page.$eval('[data-field="open"]', (el) => el.checked),
        true,
      );
      await page.$eval('[data-field="open"]', (el) => {
        el.checked = false;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
      assert.equal(
        (await changed(opened.revision)).plan.openings.find(
          (o) => o.id === door.id,
        ).open,
        false,
      );
    },
  );
  await step(
    "existing GLB instance exact edit preserves asset and all unrelated fields",
    async () => {
      const beforeImport = await current();
      await (
        await page.$("#glb-file")
      ).uploadFile(path.resolve("fixtures/textured-vase.glb"));
      const before = await changed(beforeImport.revision);
      const model = before.plan.furniture.find((f) => f.type === "model");
      assert.ok(model);
      await select(model.id);
      await page.click('[data-panel="chat"]');
      await send("把它向左移动100毫米，并顺时针旋转90度");
      await page.waitForFunction(
        () => document.querySelectorAll(".chat-task").length >= 3,
      );
      await completed();
      const after = await changed(before.revision);
      const expected = structuredClone(before.plan);
      Object.assign(
        expected.furniture.find((f) => f.id === model.id),
        { x: model.x - 100, rot: (model.rot + 90) % 360 },
      );
      assert.deepEqual(after.plan, expected);
      assert.deepEqual(after.assets, before.assets);
      assert.equal(after.revision, before.revision + 1);
      assert.deepEqual((await clickMutation("#undo")).plan, before.plan);
      assert.deepEqual((await clickMutation("#redo")).plan, after.plan);
    },
  );
  await page.screenshot({ path: path.join(out, "completed.png") });
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.failure = error.stack;
  process.exitCode = 1;
  await page.screenshot({ path: path.join(out, "failed.png") }).catch(() => {});
} finally {
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
