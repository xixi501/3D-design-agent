import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { launch } from "../reference/upstream/scripts/browser.mjs";
const base = (process.env.ACTISCAPE_URL || "http://127.0.0.1:3001").replace(
  /\/$/,
  "",
);
const out = path.resolve("test-results/agent-browser-retry");
fs.mkdirSync(out, { recursive: true });
const demo = JSON.parse(
    fs.readFileSync("test-results/agent/demo.json", "utf8"),
  ),
  id = demo.task.projectId;
const browser = await launch({
    gpu: false,
    viewport: { width: 1440, height: 1000 },
  }),
  page = await browser.newPage();
let lost = false,
  accepted,
  requests = [];
try {
  await page.goto(`${base}/?project=${id}&debug`, { waitUntil: "load" });
  await page.waitForFunction(
    () => window.__actiscape?.project && !__actiscape.busy,
    { timeout: 60000 },
  );
  await page.click('[data-panel="chat"]');
  await page.waitForFunction(
    () =>
      document.querySelector(".chat-connection")?.textContent ===
      "设计助手已连接",
  );
  const before = await page.evaluate(() => __actiscape.project),
    chair = before.plan.furniture.find((f) => f.key === "armchair");
  const count = await page.$$eval(".chat-task", (els) => els.length),
    at = await page.evaluate((f) => __actiscape.planView.screen(f), chair);
  await page.mouse.click(at.x, at.y);
  await page.setRequestInterception(true);
  page.on("request", async (request) => {
    if (
      request.method() === "POST" &&
      /\/api\/agent\/conversations\/[^/]+\/tasks$/.test(request.url())
    ) {
      const body = request.postData();
      requests.push(JSON.parse(body));
      if (!lost) {
        lost = true;
        const response = await fetch(request.url(), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        });
        accepted = await response.json();
        await request.abort("failed");
        return;
      }
    }
    await request.continue();
  });
  await page.type(
    ".chat-panel textarea",
    "把这把单人沙发向右移动100毫米，其它参数和其它对象保持不变。",
  );
  await page.click(".chat-actions .primary");
  await page.waitForFunction(
    (n) => document.querySelectorAll(".chat-task").length === n + 1,
    { timeout: 60000 },
    count,
  );
  await page.waitForFunction(
    () =>
      document.querySelector(".chat-task:last-child .chat-status")?.dataset
        .status === "completed",
    { timeout: 660000 },
  );
  await page.waitForFunction(
    (rev) => __actiscape.project.revision === rev + 1,
    {},
    before.revision,
  );
  assert.equal(
    await page.$eval(".chat-panel textarea", (el) => el.value.length > 0),
    true,
  );
  await page.click(".chat-actions .primary");
  await page.waitForFunction(
    () => document.querySelector(".chat-panel textarea").value === "",
  );
  const after = await page.evaluate(() => __actiscape.project);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(
    after.plan.furniture.find((f) => f.id === chair.id).x,
    chair.x + 100,
  );
  assert.equal(requests.length, 2);
  assert.equal(requests[0].requestId, requests[1].requestId);
  assert.equal(await page.$$eval(".chat-task", (els) => els.length), count + 1);
  const task = await (
    await fetch(`${base}/api/agent/tasks/${accepted.id}`)
  ).json();
  assert.equal(task.status, "completed");
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(
      {
        passed: true,
        liveModel: true,
        projectId: id,
        taskId: task.id,
        networkResponseLostAfterAcceptance: true,
        retriedSameRequestId: true,
        oneBusinessCommit: true,
        conversationContinuedAfterServiceRestart:
          process.env.ACTISCAPE_RESTART_VERIFIED === "1",
        modelCalls: task.modelCalls,
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: path.join(out, "recovered.png") });
  console.log(
    "PASS real browser lost-response recovery, same request identity, one task/commit, persistent conversation",
  );
} finally {
  await browser.close();
}
