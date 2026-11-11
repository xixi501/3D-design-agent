import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { launch } from "../reference/upstream/scripts/browser.mjs";

const base = (process.env.ACTISCAPE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const out = path.resolve("test-results/ui-redesign");
fs.mkdirSync(out, { recursive: true });

const response = await fetch(`${base}/api/projects`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
});
const text = await response.text();
assert.ok(response.ok, text);
const project = JSON.parse(text);
const browser = await launch({ gpu: false, viewport: { width: 1440, height: 1000 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(`${base}/?project=${project.id}&debug`, { waitUntil: "load" });
  await page.waitForFunction(
    () =>
      window.__actiscape &&
      document.querySelector("#save-state")?.textContent === "已保存到项目服务",
    { timeout: 60000 },
  );
  assert.equal(await page.$eval("#agent-rail", (el) => el.offsetWidth > 250), true);
  assert.equal(
    await page.$eval("#empty-state", (el) => !el.classList.contains("is-hidden")),
    true,
  );
  assert.equal(
    await page.$eval("#empty-state h1", (el) => el.textContent.includes("AI")),
    true,
  );
  assert.equal(await page.$$eval(".chat-style", (els) => els.length), 3);
  assert.equal(
    await page.$$eval(".chat-style", (els) => els.every((el) => el.offsetParent)),
    true,
  );
  await page.screenshot({ path: path.join(out, "desktop-empty.png") });

  await page.click("#open-project");
  await page.waitForFunction(() => document.querySelectorAll(".project-card").length > 0);
  assert.equal(
    await page.$eval("body", (el) => el.innerText.includes("Evaluation only")),
    false,
  );
  assert.equal(
    await page.$eval("body", (el) => el.innerText.includes("全屋 · 2BHK 样板间")),
    true,
  );
  await page.screenshot({ path: path.join(out, "project-gallery.png") });
  await page.click("#close-dialog");
  for (const id of ["#export-image", "#export-pdf"]) {
    assert.equal(
      await page.$eval(id, (el) => el instanceof HTMLButtonElement),
      true,
    );
  }

  await page.click("#open-catalog");
  await page.waitForFunction(() => !document.querySelector("#catalog-drawer").hidden);
  await page.screenshot({ path: path.join(out, "desktop-catalog.png") });
  await page.click("#close-catalog");

  await page.click("#mode-precision");
  await page.click("#structural-toggle");
  assert.equal(
    await page.$eval('[data-tool="wall"]', (el) => el.offsetParent !== null),
    true,
  );
  await page.screenshot({ path: path.join(out, "desktop-precision.png") });
  await page.click("#mode-ai");

  await page.setViewport({ width: 390, height: 844 });
  await new Promise((resolve) => setTimeout(resolve, 400));
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - innerWidth,
  );
  assert.ok(overflow <= 1, `mobile overflow ${overflow}px`);
  await page.screenshot({ path: path.join(out, "mobile.png") });
  await page.click("#mobile-agent");
  await page.waitForFunction(() =>
    document.querySelector("#agent-rail").classList.contains("mobile-open"),
  );
  await page.screenshot({ path: path.join(out, "mobile-agent.png") });
  await page.click("#context-toggle");
  await page.waitForFunction(() =>
    document.querySelector("#context-panel").classList.contains("open"),
  );
  await page.screenshot({ path: path.join(out, "mobile-context.png") });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, projectId: project.id, overflow, out }));
} finally {
  await browser.close();
}
