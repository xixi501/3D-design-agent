import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { launch } from "../reference/upstream/scripts/browser.mjs";

const root = process.cwd();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actiscape-repair-ui-"));
const servicePort = 3120;
const agentPort = 3118;
const captured = [];
let conversation = null;

const fakeAgent = http.createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const url = new URL(req.url, "http://agent");
  const send = (status, value) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(value));
  };
  if (url.pathname === "/health")
    return send(200, { ok: true, modelConfigured: true, visionAvailable: false });
  if (url.pathname === "/conversations" && req.method === "GET")
    return send(200, [{ id: "repair-ui-conversation", projectId: url.searchParams.get("projectId") }]);
  if (url.pathname === "/conversations" && req.method === "POST") {
    conversation = JSON.parse(body || "{}");
    return send(201, { id: "repair-ui-conversation", projectId: conversation.projectId });
  }
  if (/^\/conversations\/[^/]+\/tasks$/.test(url.pathname) && req.method === "GET")
    return send(200, []);
  if (/^\/conversations\/[^/]+\/tasks$/.test(url.pathname) && req.method === "POST") {
    const taskBody = JSON.parse(body || "{}");
    captured.push(taskBody);
    return send(202, {
      id: "repair-ui-task",
      projectId: taskBody.projectId,
      status: "queued",
      input: taskBody.input,
      selectedIds: taskBody.selectedIds,
      allowedRoomIds: taskBody.allowedRoomIds,
      mode: taskBody.mode,
      phaseLabel: "验收任务",
      result: {},
    });
  }
  if (/^\/tasks\/[^/]+\/events$/.test(url.pathname)) {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    res.write(": ok\n\n");
    return;
  }
  send(404, { detail: "not found" });
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
const base = `http://127.0.0.1:${servicePort}`;

async function waitHealth() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error("repair UI service did not start");
}
async function api(route, init) {
  const response = await fetch(base + "/api" + route, init);
  const value = await response.json();
  if (!response.ok) throw Error(JSON.stringify(value));
  return value;
}
async function importCase(file) {
  const document = JSON.parse(
    fs.readFileSync(path.join(root, "fixtures/repair-cases", file), "utf8"),
  );
  return api("/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ document }),
  });
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

let browser;
try {
  await waitHealth();
  browser = await launch({ gpu: false, viewport: { width: 1440, height: 1000 } });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => void dialog.accept());

  // Structural fixture: diagnosis is visible, but AI repair is not offered.
  const structural = await importCase("structural.plan.json");
  await page.goto(`${base}/?project=${structural.id}&debug`, { waitUntil: "load" });
  await ready(page);
  await page.click('[data-panel="checks"]');
  await page.waitForFunction(() => document.querySelectorAll(".issue").length > 0);
  assert.equal(await page.$$eval(".issue.structural", (els) => els.length), 1);
  assert.equal(await page.$("#repair-scene"), null);
  assert.ok(await page.$("#go-structure"));
  assert.equal(captured.length, 0);

  // Openable fixture: the room repair request must carry only room targets.
  captured.length = 0;
  const openable = await importCase("openable.plan.json");
  await page.goto(`${base}/?project=${openable.id}&debug`, { waitUntil: "load" });
  await ready(page);
  await page.waitForSelector('[data-repair-room="openable-room"]');
  await page.$eval('[data-repair-room="openable-room"]', (element) => element.click());
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(captured.length, 1, JSON.stringify(captured));
  const task = captured[0];
  assert.equal(task.mode, "repair_layout");
  assert.deepEqual(task.allowedRoomIds, ["openable-room"]);
  assert.deepEqual(
    [...task.selectedIds].sort(),
    ["openable-bed", "openable-wardrobe"],
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      structuralProject: structural.id,
      openableProject: openable.id,
      captured: task,
      out: "test-results/repair-ui",
    }),
  );
} finally {
  if (browser) await browser.close();
  service.kill("SIGTERM");
  fakeAgent.close();
  const report = path.resolve("test-results/repair-ui");
  fs.mkdirSync(report, { recursive: true });
  fs.writeFileSync(
    path.join(report, "report.json"),
    JSON.stringify({ captured, serviceLog }, null, 2),
  );
  fs.rmSync(directory, { recursive: true, force: true });
}
