import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { launch } from "../reference/upstream/scripts/browser.mjs";
const base = (process.env.ACTISCAPE_URL || "http://127.0.0.1:3131").replace(
  /\/$/,
  "",
);
const out = path.resolve("test-results/agent-browser");
fs.mkdirSync(out, { recursive: true });
const demo = JSON.parse(
    fs.readFileSync("test-results/agent/demo.json", "utf8"),
  ),
  projectId = demo.task.projectId;
const browser = await launch({
    gpu: false,
    viewport: { width: 1440, height: 1000 },
  }),
  page = await browser.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(`${base}/?project=${projectId}&debug`, { waitUntil: "load" });
  await page.waitForFunction(
    () => window.__actiscape?.project && !__actiscape.busy,
    { timeout: 60000 },
  );
  await page.click('[data-panel="chat"]');
  await page.waitForFunction(
    () =>
      document.querySelector(".chat-connection")?.textContent ===
      "设计助手已连接",
    { timeout: 60000 },
  );
  assert.ok(await page.$('[data-status="completed"]'));
  const before = await page.evaluate(() => __actiscape.project),
    chair = before.plan.furniture.find((f) => f.key === "armchair");
  const at = await page.evaluate((f) => __actiscape.planView.screen(f), chair);
  await page.mouse.click(at.x, at.y);
  await page.waitForFunction(() =>
    document.querySelector(".chat-context").textContent.includes("单人沙发"),
  );
  await page.type(
    ".chat-panel textarea",
    "把这把单人沙发向右移动100毫米，其他参数和所有其他对象保持不变。",
  );
  await page.click(".chat-actions .primary");
  await page.waitForFunction(
    () => document.querySelectorAll(".chat-task").length >= 2,
  );
  await page.waitForFunction(
    () =>
      document.querySelector(".chat-task:last-child .chat-status")?.dataset
        .status === "completed",
    { timeout: 660000 },
  );
  await page.waitForFunction(
    (rev) => __actiscape.project.revision > rev,
    {},
    before.revision,
  );
  const after = await page.evaluate(() => __actiscape.project);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(
    after.plan.furniture.find((f) => f.id === chair.id).x,
    chair.x + 100,
  );
  assert.deepEqual(
    after.plan.furniture.filter((f) => f.id !== chair.id),
    before.plan.furniture.filter((f) => f.id !== chair.id),
  );
  await page.click("#undo");
  await page.waitForFunction(
    (rev) => __actiscape.project.revision > rev && !__actiscape.busy,
    {},
    after.revision,
  );
  assert.equal(
    await page.evaluate(
      (id) => __actiscape.project.plan.furniture.find((f) => f.id === id).x,
      chair.id,
    ),
    chair.x,
  );
  const undoneRevision = await page.evaluate(
    () => __actiscape.project.revision,
  );
  await page.click("#redo");
  await page.waitForFunction(
    (rev) => __actiscape.project.revision > rev && !__actiscape.busy,
    {},
    undoneRevision,
  );
  await page.goto(`${base}/?project=${projectId}`, { waitUntil: "load" });
  await page.waitForFunction(
    () =>
      document.querySelector("#save-state")?.textContent === "已保存到项目服务",
    { timeout: 60000 },
  );
  assert.equal(
    await page.evaluate(() => typeof window.__actiscape),
    "undefined",
  );
  await page.click('[data-panel="chat"]');
  await page.waitForFunction(
    () => document.querySelectorAll(".chat-task").length >= 2,
    { timeout: 60000 },
  );
  assert.equal(
    await page.$$eval(
      '.chat-task [data-status="completed"]',
      (es) => es.length,
    ),
    2,
  );
  await page.click('[data-view="split"]');
  await page.$eval(".chat-messages", (el) => (el.scrollTop = el.scrollHeight));
  await page.screenshot({ path: path.join(out, "workbench.png") });
  assert.deepEqual(errors, []);
  const report = {
    passed: true,
    liveModel: true,
    projectId,
    uiSelectedTarget: chair.id,
    beforeRevision: before.revision,
    afterRevision: after.revision,
    undoRedo: true,
    reopenConversation: true,
    normalEntryWithoutDebug: true,
    errors,
  };
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    "PASS real browser chat / actual pointer selection / DeepSeek edit / SSE / undo-redo / reopened conversation / no debug dependency",
  );
} finally {
  await browser.close();
}
