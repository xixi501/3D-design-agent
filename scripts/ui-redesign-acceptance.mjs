import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { launch } from "../reference/upstream/scripts/browser.mjs";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actiscape-ui-"));
const port = 3119;
const server = spawn(
  process.execPath,
  ["--import", "tsx", "apps/service/src/main.ts"],
  {
    env: { ...process.env, PORT: String(port), ACTISCAPE_DATA_DIR: directory },
    stdio: ["ignore", "ignore", "pipe"],
  },
);
process.on("exit", () => server.kill("SIGTERM"));
async function ready() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error("UI acceptance service did not start");
}
await ready();
const base = (process.env.ACTISCAPE_URL || `http://127.0.0.1:${port}`).replace(/\/$/, "");
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

  await page.click(".more-actions summary");
  await page.click("#open-structure");
  assert.equal(
    await page.$eval('[data-tool="wall"]', (el) => el.offsetParent !== null),
    true,
  );
  await page.screenshot({ path: path.join(out, "desktop-precision.png") });

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
  server.kill("SIGTERM");
}
