import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { launch } from "../reference/upstream/scripts/browser.mjs";

const root = process.cwd();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actiscape-pc-flow-"));
const downloads = path.join(directory, "downloads");
fs.mkdirSync(downloads, { recursive: true });
const servicePort = 3124;
const agentPort = 3116;
const base = `http://127.0.0.1:${servicePort}`;
const captured = [];
const report = { passed: false, steps: [], errors: [] };
fs.mkdirSync(path.resolve("test-results/pc-flow"), { recursive: true });

const send = (res, status, value) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
};
const fakeAgent = http.createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const url = new URL(req.url, "http://agent");
  if (url.pathname === "/health")
    return send(res, 200, {
      ok: true,
      modelConfigured: true,
      visionAvailable: false,
    });
  if (url.pathname === "/conversations" && req.method === "GET")
    return send(res, 200, []);
  if (url.pathname === "/conversations" && req.method === "POST")
    return send(res, 201, { id: "pc-flow-conversation" });
  if (/^\/conversations\/[^/]+\/tasks$/.test(url.pathname) && req.method === "GET")
    return send(res, 200, []);
  if (/^\/conversations\/[^/]+\/tasks$/.test(url.pathname) && req.method === "POST") {
    const task = JSON.parse(body || "{}");
    captured.push(task);
    return send(res, 202, {
      id: "pc-flow-task",
      projectId: task.projectId,
      status: "queued",
      input: task.input,
      selectedIds: task.selectedIds,
      allowedRoomIds: task.allowedRoomIds,
      mode: task.mode,
      phaseLabel: "验收任务",
      result: {},
    });
  }
  if (/^\/tasks\/[^/]+\/events$/.test(url.pathname)) {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    });
    res.write(": ok\n\n");
    return;
  }
  send(res, 404, { detail: "not found" });
});
await new Promise((resolve) => fakeAgent.listen(agentPort, "127.0.0.1", resolve));

const service = spawn(
  process.execPath,
  ["--import", "tsx", "apps/service/src/main.ts"],
  {
    env: {
      ...process.env,
      PORT: String(servicePort),
      ACTISCAPE_DATA_DIR: directory,
      ACTISCAPE_AGENT_URL: `http://127.0.0.1:${agentPort}`,
    },
    stdio: ["ignore", "ignore", "pipe"],
  },
);
const serviceLog = [];
service.stderr.on("data", (chunk) => serviceLog.push(String(chunk)));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitHealth() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) return;
    } catch {}
    await delay(100);
  }
  throw Error("PC flow service did not start");
}
async function api(route, body) {
  const response = await fetch(base + "/api" + route, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw Error(JSON.stringify(value));
  return value;
}
async function importFixture(file) {
  const document = JSON.parse(
    fs.readFileSync(path.join(root, "fixtures/repair-cases", file), "utf8"),
  );
  return api("/projects", { document });
}
async function ready(page) {
  await page.waitForFunction(
    () =>
      window.__actiscape?.project &&
      !__actiscape.busy &&
      document.querySelector("#save-state")?.textContent === "已保存到项目服务",
    { timeout: 60000 },
  );
}
function step(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then((detail) => {
      report.steps.push({ name, status: "passed", detail });
      console.log("PASS", name);
    })
    .catch((error) => {
      report.steps.push({ name, status: "failed", error: String(error.stack || error) });
      throw error;
    });
}

let browser;
try {
  await waitHealth();
  browser = await launch({ gpu: false, viewport: { width: 1440, height: 1000 } });
  const page = await browser.newPage();
  page.on("pageerror", (error) => report.errors.push(error.message));
  const projectPosts = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/projects"
    )
      projectPosts.push(request.url());
  });

  await step("first visit opens welcome gallery without creating a project", async () => {
    await page.goto(base + "/?debug", { waitUntil: "load" });
    await page.waitForSelector("#dialog[open] [data-example='living-dining']");
    assert.equal(projectPosts.length, 0);
    await page.screenshot({ path: path.join(root, "test-results/pc-flow/welcome.png") });
    await page.click("#close-dialog");
    await page.waitForFunction(
      () => !document.querySelector("#empty-state")?.classList.contains("is-hidden"),
    );
    assert.equal(
      await page.$eval("#save-state", (element) => element.textContent),
      "请选择或新建空间",
    );
    const hasProject = await page.evaluate(() =>
      Boolean(window.__actiscape && window.__actiscape.project),
    );
    assert.equal(hasProject, false);
    await page.screenshot({ path: path.join(root, "test-results/pc-flow/welcome-closed.png") });
    await page.click("#open-project");
    await page.waitForSelector("#dialog[open] [data-example='living-dining']");
    assert.equal(projectPosts.length, 0);
    await page.click("[data-example='living-dining']");
    await ready(page);
    assert.equal(projectPosts.length, 1);
    return { projectPosts: projectPosts.length };
  });

  await step("PNG export downloads a real image file", async () => {
    const client = await page.createCDPSession();
    await client.send("Page.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: downloads,
    });
    await page.click(".export-actions summary");
    await page.waitForSelector("#export-image");
    await page.click("#export-image");
    let file;
    for (let i = 0; i < 100; i++) {
      const found = fs.readdirSync(downloads).filter((name) => name.endsWith(".png"));
      if (found.length) {
        file = path.join(downloads, found[0]);
        if (fs.statSync(file).size > 1000) break;
      }
      await delay(100);
    }
    assert.ok(file && fs.existsSync(file), "PNG download did not complete");
    const bytes = fs.readFileSync(file);
    assert.ok(bytes.length > 1000);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    return { file, bytes: bytes.length };
  });

  await step("PDF export opens a printable page", async () => {
    const popupPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("PDF popup did not open")),
        10000,
      );
      browser.once("targetcreated", async (target) => {
        if (target.type() !== "page") return;
        clearTimeout(timer);
        resolve(await target.page());
      });
    });
    if (!(await page.$eval(".export-actions", (element) => element.open)))
      await page.click(".export-actions summary");
    await page.click("#export-pdf");
    const popup = await popupPromise;
    await popup.waitForFunction(
      () => document.body?.innerText.includes("演境"),
      { timeout: 10000 },
    );
    const text = await popup.$eval("body", (element) => element.innerText);
    assert.match(text, /演境/);
    assert.match(text, /版本 \d+/);
    const title = await popup.title();
    await popup.close();
    return { title };
  });

  await step("repair cancel and Escape send no Agent task", async () => {
    captured.length = 0;
    const project = await importFixture("openable.plan.json");
    await page.goto(`${base}/?project=${project.id}&debug`, { waitUntil: "load" });
    await ready(page);
    await page.waitForSelector('[data-repair-room="openable-room"]');
    await page.$eval('[data-repair-room="openable-room"]', (element) => element.click());
    await page.waitForSelector("#repair-confirm[open]");
    assert.equal(captured.length, 0);
    await page.click("#repair-confirm-cancel");
    await page.waitForFunction(() => !document.querySelector("#repair-confirm").open);
    await delay(500);
    assert.equal(captured.length, 0);
    await page.$eval('[data-repair-room="openable-room"]', (element) => element.click());
    await page.waitForSelector("#repair-confirm[open]");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("#repair-confirm").open);
    await delay(500);
    assert.equal(captured.length, 0);
    return { captured: captured.length };
  });

  assert.deepEqual(report.errors, []);
  report.passed = true;
  fs.mkdirSync(path.resolve("test-results/pc-flow"), { recursive: true });
  fs.writeFileSync(
    path.resolve("test-results/pc-flow/report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify({ passed: true, out: "test-results/pc-flow" }));
} catch (error) {
  report.errors.push(String(error.stack || error));
  fs.mkdirSync(path.resolve("test-results/pc-flow"), { recursive: true });
  fs.writeFileSync(
    path.resolve("test-results/pc-flow/report.json"),
    JSON.stringify(report, null, 2),
  );
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  service.kill("SIGTERM");
  fakeAgent.close();
  fs.writeFileSync(
    path.resolve("test-results/pc-flow/service.log"),
    serviceLog.join(""),
  );
  fs.rmSync(directory, { recursive: true, force: true });
}
