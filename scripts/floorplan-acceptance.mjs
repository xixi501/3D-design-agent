/** Actual browser/WebGL + Node/SQLite + LangGraph; model responses are explicitly controlled. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { geometryProof } from "./floorplan-geometry.mjs";
import { createApp } from "../apps/service/src/app.ts";
import { launch } from "../reference/upstream/scripts/browser.mjs";
const v3 = process.argv.includes("--v3");
const v2 = process.argv.includes("--v2") || v3;
const out = path.resolve(
    v3
      ? "test-results/floorplan-v3-tools"
      : v2
        ? "test-results/floorplan-v2-tools"
        : "test-results/floorplan-tools",
  ),
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "s2c-browser-"));
fs.mkdirSync(out, { recursive: true });
const base = "http://127.0.0.1:3125",
  agentPort = 3126;
process.env.ACTISCAPE_AGENT_URL = `http://127.0.0.1:${agentPort}`;
let service, agent, browser, page;
const errors = [],
  steps = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function api(route, body) {
  const response = await fetch(
    base + "/api" + route,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const value = await response.json();
  if (!response.ok) throw Error(JSON.stringify(value));
  return value;
}
async function start(dataDir) {
  service = await createApp({
    dataDir,
    staticDir: path.resolve("dist/editor"),
    logger: false,
  });
  await service.app.listen({ port: 3125, host: "127.0.0.1" });
  agent = spawn(
    path.resolve(".venv/bin/python"),
    ["scripts/floorplan-controlled-agent.py"],
    {
      env: {
        ...process.env,
        ACTISCAPE_DATA_DIR: dataDir,
        ACTISCAPE_AGENT_DATA_DIR: path.join(dataDir, "agent"),
        ACTISCAPE_SCENE_URL: base,
        AGENT_PORT: String(agentPort),
        ACTISCAPE_TEST_WORKFLOW: v3 ? "3" : v2 ? "2" : "1",
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  agent.stderr.on("data", (c) =>
    fs.appendFileSync(path.join(out, "agent.log"), c),
  );
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/api/agent/health")).ok) return;
    } catch {}
    await delay(100);
  }
  throw Error("Controlled agent did not start");
}
async function stop() {
  if (agent && agent.exitCode === null) {
    const exited = once(agent, "exit");
    agent.kill("SIGTERM");
    await exited;
  }
  if (service) {
    await service.app.close();
    service = undefined;
  }
}
async function button(text, root = "") {
  const handle = await page.waitForFunction(
    (text, root) =>
      [...document.querySelectorAll((root ? root + " " : "") + "button")].find(
        (e) => e.textContent === text,
      ),
    { timeout: 30000 },
    text,
    root,
  );
  await handle.asElement().click();
}
async function fill(selector, value) {
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type(selector, String(value));
}
async function waitTask(id, statuses) {
  for (let i = 0; i < 900; i++) {
    const t = await api("/agent/tasks/" + id);
    if (statuses.includes(t.status)) return t;
    if (["failed", "cancelled", "conflict"].includes(t.status))
      throw Error(JSON.stringify(t));
    await delay(200);
  }
  throw Error("Task timed out");
}
async function drawPoint(x, y) {
  return page.$eval(
    "[data-testid=floorplan-canvas]",
    (canvas, { x, y }) => {
      const r = canvas.getBoundingClientRect(),
        s = Math.min((r.width - 40) / 1000, (r.height - 40) / 800);
      return {
        x: r.left + (r.width - 1000 * s) / 2 + x * s,
        y: r.top + (r.height - 800 * s) / 2 + y * s,
      };
    },
    { x, y },
  );
}
try {
  await start(directory);
  browser = await launch({
    gpu: false,
    viewport: { width: 1500, height: 1000 },
  });
  page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const p = await api("/projects", {}),
    root = "/projects/" + p.id;
  await page.goto(base + "/?project=" + p.id, { waitUntil: "load" });
  await page.waitForSelector("#new-project");
  await page.click("[data-panel=chat]");
  await page.waitForFunction(
    () =>
      document.querySelector(".chat-connection")?.textContent ===
      "设计助手已连接",
  );
  const created = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      /\/api\/agent\/conversations\/[^/]+\/tasks$/.test(
        new URL(r.url()).pathname,
      ),
  );
  const file = await page.$(".chat-panel input[type=file]");
  await file.uploadFile(path.resolve("fixtures/s2c-synthetic.png"));
  const task = await (await created).json();
  let waiting = await waitTask(task.id, ["waiting_input"]);
  assert.equal(waiting.mode, "reconstruct_floorplan");
  assert.equal((await api(root)).revision, 0);
  assert.equal((await api(root + "/history")).entries.length, 0);
  steps.push("upload produces draft, no formal write");
  await page.waitForSelector('[data-testid="floorplan-tool-evidence"]');
  await page.click('[data-testid="floorplan-tool-evidence"] summary');
  await page.waitForFunction(() => {
    const images = [
      ...document.querySelectorAll(
        '[data-testid="floorplan-tool-evidence"] img',
      ),
    ];
    return (
      images.length >= 2 &&
      images.every((img) => img.complete && img.naturalWidth > 0)
    );
  });
  await page.screenshot({
    path: path.join(out, "measurement-evidence.png"),
    fullPage: true,
  });
  steps.push("role-scoped original measurement evidence visible in browser");
  await page.waitForSelector("[data-testid=review-floorplan]");
  await page.locator("[data-testid=review-floorplan]").click();
  await page.waitForSelector(
    '.floorplan-controls input[aria-label="户型名称"]',
  );
  await button("适应原图", ".floorplan-dialog");
  if (!v2) {
    await button("在图上选两点标定", ".floorplan-dialog");
    const a = await drawPoint(50, 50),
      b = await drawPoint(950, 50);
    await page.mouse.click(a.x, a.y);
    await page.mouse.click(b.x, b.y);
    await fill(
      '.floorplan-controls input[aria-label="标定实际距离毫米"]',
      9000,
    );
    await page.select(".floorplan-controls select:first-of-type", "centerline");
    const scaled = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().endsWith("/commands"),
    );
    await button("保存比例尺", ".floorplan-dialog");
    assert.equal((await scaled).status(), 200);
    await page.waitForFunction(
      () =>
        !document.querySelector("[data-testid=confirm-floorplan]")?.disabled,
    );
    await page.select(".floorplan-controls > select:nth-of-type(2)", "symbols");
    await page.select(".floorplan-controls > select:nth-of-type(3)", "chair1");
    const from = await drawPoint(520, 180),
      to = await drawPoint(510, 180),
      dragged = page.waitForResponse(
        (r) => r.request().method() === "POST" && r.url().endsWith("/commands"),
      );
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    assert.equal((await dragged).status(), 200);
    await page.waitForFunction(
      () =>
        !document.querySelector("[data-testid=confirm-floorplan]")?.disabled,
    );
    const draft = await api(
      root + "/floorplan-drafts/" + waiting.generation.draftId,
    );
    assert.equal(draft.corrections, 1);
    assert.ok(
      Math.abs(draft.data.symbols.find((s) => s.id === "chair1").x - 510) < 1,
    );
    await page.screenshot({ path: path.join(out, "draft-overlay.png") });
    await button("关闭", ".floorplan-dialog");
    await page.reload({ waitUntil: "load" });
    await page.click("[data-panel=chat]");
    await page.waitForSelector("[data-testid=review-floorplan]");
    await page.locator("[data-testid=review-floorplan]").click();
    await page.waitForFunction(
      () =>
        !document.querySelector("[data-testid=confirm-floorplan]")?.disabled,
    );
    assert.equal((await api(root)).revision, 0);
    steps.push("calibration, actual pointer drag, draft reopen");
  } else {
    const draft = await api(
      root + "/floorplan-drafts/" + waiting.generation.draftId,
    );
    assert.equal(draft.data.measurementVersion, 2);
    if (v3) {
      assert.equal(draft.data.recognitionVersion, 3);
      assert.equal(
        waiting.generation?.structureSkeleton?.structureSkeletonVersion,
        3,
      );
      assert.ok(
        waiting.generation?.upstreamTools?.some(
          (entry) =>
            entry.tool === "furniture_contours" &&
            entry.record?.adapterVersion === "hpd-adapter-5",
        ),
        "V3 browser acceptance must use deterministic furniture contours",
      );
      assert.ok(
        draft.data.symbols.every(
          (symbol) => symbol.categoryCode && symbol.sourceLabel,
        ),
      );
      assert.equal(
        task.generation?.workflowVersion,
        3,
        "V3 browser acceptance must run workflowVersion=3",
      );
    }
    assert.equal(draft.corrections, 0);
    assert.ok(
      draft.sourceReview,
      `Missing source review: ${JSON.stringify(waiting)}`,
    );
    assert.equal(draft.sourceReview.hash, draft.hash);
    assert.ok(draft.sourceReview.review.passed);
    const preview = await api(
      root + "/floorplan-drafts/" + draft.id + "/preview",
      {},
    );
    assert.equal(preview.measurement.dimensions.length, 4);
    assert.ok(
      preview.measurement.dimensions.every((d) => Math.abs(d.residualMm) <= 1),
    );
    const rechecked = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url().endsWith(`/api/agent/tasks/${task.id}/recheck-floorplan`) &&
        r.status() === 200,
    );
    await page.click("[data-testid=recheck-floorplan]");
    await rechecked;
    await page.waitForFunction(() =>
      document
        .querySelector(".floorplan-controls")
        ?.textContent?.includes("当前草稿审核通过"),
    );
    const recheckedTask = await api(`/agent/tasks/${task.id}`);
    assert.ok(recheckedTask.generation.manualRechecks.length >= 1);
    await page.screenshot({ path: path.join(out, "draft-overlay.png") });
    await button("关闭", ".floorplan-dialog");
    await page.reload({ waitUntil: "load" });
    await page.click("[data-panel=chat]");
    await page.waitForSelector("[data-testid=review-floorplan]");
    await page.locator("[data-testid=review-floorplan]").click();
    await page.waitForFunction(
      () =>
        !document.querySelector("[data-testid=confirm-floorplan]")?.disabled,
    );
    steps.push(
      `${v3 ? "v3 two-pass recognition" : "v2 feature constraints"}, zero user corrections, current source review, diagnostic evidence and reopen`,
    );
  }
  await page.click("[data-testid=confirm-floorplan]");
  const complete = await waitTask(task.id, ["completed"]);
  const saved = await api(root);
  assert.equal(saved.revision, 1);
  assert.equal(saved.plan.furniture.length, 4);
  assert.equal(saved.plan.rooms.length, 3);
  assert.equal((await api(root + "/history")).entries.length, 1);
  const frozenCandidate = await api(
    `${root}/candidates/${complete.result.candidateId}`,
  );
  const geometry = await geometryProof(base, p.id, frozenCandidate);
  assert.equal(geometry.passed, true, JSON.stringify(geometry));
  const trace = await api("/agent/tasks/" + task.id + "/trace"),
    roles = new Set(
      trace.filter((e) => e.kind === "agent_start").map((e) => e.data.role),
    );
  assert.deepEqual([...roles].sort(), ["assets", "check", "design", "main"]);
  assert.equal(complete.result.skillsUsed[0].id, "floorplan-reconstruction");
  await page.waitForFunction(
    () => document.querySelector("#source-image")?.hidden === false,
  );
  await page.click("#source-image");
  await page.screenshot({ path: path.join(out, "source-in-editor.png") });
  const evidence = complete.result.evidence;
  for (const e of evidence) {
    const bytes = Buffer.from(await (await fetch(base + e.url)).arrayBuffer());
    assert.equal(createHash("sha256").update(bytes).digest("hex"), e.sha256);
    fs.writeFileSync(path.join(out, e.view + ".png"), bytes);
  }
  await page.click("#undo");
  for (let i = 0; i < 100 && (await api(root)).revision !== 2; i++)
    await delay(100);
  assert.equal((await api(root)).plan.walls.length, 0);
  await page.waitForFunction(
    () => document.querySelector("#redo")?.disabled === false,
  );
  await page.click("#redo");
  for (let i = 0; i < 100 && (await api(root)).revision !== 3; i++)
    await delay(100);
  assert.deepEqual((await api(root)).plan, saved.plan);
  steps.push("four roles, real WebGL evidence, one atomic commit, undo/redo");
  await stop();
  const backup = path.join(out, "restored-data");
  fs.rmSync(backup, { recursive: true, force: true });
  fs.cpSync(directory, backup, { recursive: true });
  await start(backup);
  await page.goto(base + "/?project=" + p.id, { waitUntil: "load" });
  await page.waitForFunction(
    () =>
      document.querySelector("#save-state")?.textContent === "已保存到项目服务",
  );
  assert.deepEqual((await api(root)).plan, saved.plan);
  assert.equal((await api("/agent/tasks/" + task.id)).status, "completed");
  assert.equal((await api(root + "/history")).cursor, 1);
  const exported = await api(root + "/export"),
    source = exported.sourceImageManifest[0];
  const original = Buffer.from(
    await (
      await fetch(
        base + `/api/floorplan-images/${source.id}/file?variant=original`,
      )
    ).arrayBuffer(),
  );
  assert.equal(
    createHash("sha256").update(original).digest("hex"),
    source.sha256,
  );
  const undone = await api(root + "/undo", {
    operationId: "restored-undo",
    baseRevision: 3,
  });
  assert.equal(undone.project.plan.walls.length, 0);
  const redone = await api(root + "/redo", {
    operationId: "restored-redo",
    baseRevision: 4,
  });
  assert.deepEqual(redone.project.plan, saved.plan);
  steps.push(
    "stopped full backup and independent restore preserve original, draft, task and history",
  );
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(
      {
        passed: true,
        controlledModels: true,
        realImageAcceptance: false,
        source: "synthetic fixture only",
        steps,
        task: complete,
        trace,
        geometry,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: true,
      controlledModels: true,
      realImageAcceptance: false,
      steps,
      output: out,
    }),
  );
} finally {
  if (browser) await browser.close();
  await stop();
  fs.rmSync(directory, { recursive: true, force: true });
}
