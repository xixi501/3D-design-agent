#!/usr/bin/env node
/**
 * Live AgentArts runtime verification: ping -> create scene -> action run_task ->
 * duplicate requestId idempotency -> optional platform-probe model tool loop.
 *
 * Required:
 *   AGENTARTS_RUNTIME_URL   e.g. http://127.0.0.1:8080 or a cloud Runtime URL
 *   ACTISCAPE_SCENE_URL     e.g. http://127.0.0.1:3001 or protected HTTPS gateway
 *
 * Optional:
 *   ACTISCAPE_TOOL_TOKEN    Bearer/x-actiscape-token for the scene gateway
 *   --with-probe            force platform-probe (also auto when a model key exists)
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { compileRectangular } from "../packages/scene-core/src/rectangular.js";
import { createFurniture } from "../packages/scene-core/src/index.js";

const root = path.resolve(import.meta.dirname, "..");
const reportFile = path.join(root, "test-results/agentarts-live-verification.json");
const runtimeBase = (process.env.AGENTARTS_RUNTIME_URL || "http://127.0.0.1:8080").replace(
  /\/$/,
  "",
);
const invokeUrl = runtimeBase.endsWith("/invocations")
  ? runtimeBase
  : `${runtimeBase}/invocations`;
const pingUrl = runtimeBase.replace(/\/invocations$/, "") + "/ping";
const sceneBase = (process.env.ACTISCAPE_SCENE_URL || "http://127.0.0.1:3001").replace(
  /\/$/,
  "",
);
const token = process.env.ACTISCAPE_TOOL_TOKEN || "";
const modelKey = process.env.MODEL_API_KEY || process.env.DEEPSEEK_API_KEY || "";
const withProbe =
  process.argv.includes("--with-probe") || Boolean(modelKey);
const report = {
  schemaVersion: "actiscape.agentarts-live-verification.v1",
  startedAt: new Date().toISOString(),
  runtimeUrl: runtimeBase,
  sceneUrl: sceneBase,
  tokenConfigured: Boolean(token),
  modelKeyConfigured: Boolean(modelKey),
  steps: {},
  passed: false,
};

function headers(extra = {}) {
  return {
    "content-type": "application/json",
    ...(token
      ? { authorization: `Bearer ${token}`, "x-actiscape-token": token }
      : {}),
    ...extra,
  };
}

async function request(url, options = {}, timeout = 120_000) {
  const started = performance.now();
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeout),
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return {
    status: response.status,
    ok: response.ok,
    headers: Object.fromEntries(response.headers.entries()),
    body,
    ms: Math.round(performance.now() - started),
  };
}

async function scene(method, route, body) {
  return request(
    `${sceneBase}/api${route}`,
    {
      method,
      headers: headers(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    120_000,
  );
}

function unwrap(value) {
  let current = value;
  for (let i = 0; i < 5; i++) {
    const next =
      current?.result ?? current?.output ?? current?.response ?? current?.data;
    if (next === undefined || next === current) break;
    current = next;
  }
  return current;
}

async function invoke(payload) {
  const response = await request(
    invokeUrl,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload),
    },
    180_000,
  );
  return { ...response, result: unwrap(response.body) };
}

function save() {
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n");
}

async function main() {
  // 1. ping
  const ping = await request(pingUrl, { headers: headers() }, 30_000);
  report.steps.ping = ping;
  if (!ping.ok) throw new Error(`/ping failed: HTTP ${ping.status}`);

  // 2. deterministic test project: one openable wardrobe + one coffee table.
  const compiled = compileRectangular(
    {
      roomType: "master_bedroom",
      roomName: "AgentArts 云端验收测试主卧",
      width: { value: 4000, unit: "mm" },
      depth: { value: 4000, unit: "mm" },
      doors: [
        {
          side: "south",
          position: "offset",
          offset: { value: 500, unit: "mm" },
        },
      ],
      windows: [],
    },
    "agentarts-live",
  );
  const plan = compiled.state.plan;
  const wardrobe = createFurniture("wardrobe", 2000, 400, { rot: 0 });
  const table = createFurniture("coffeeTable", 2000, 2200, { rot: 0 });
  plan.furniture = [wardrobe, table];
  delete plan.source;
  const created = await scene("POST", "/projects", { document: plan });
  report.steps.createProject = created;
  if (!created.ok) throw new Error(`create project failed: HTTP ${created.status}`);
  const project = created.body;
  const initialRevision = project.revision;

  const requestId = `agentarts-live-${Date.now()}`;
  const payload = {
    action: "run_task",
    projectId: project.id,
    requestId,
    mode: "interactive_action",
    input: "打开衣柜门",
    selectedIds: [wardrobe.id],
  };

  // 3. real runtime action task
  const first = await invoke(payload);
  report.steps.action = first;
  const firstResult = first.result;
  if (first.status !== 200 || firstResult?.status !== "completed")
    throw new Error(
      `run_task not completed: HTTP ${first.status} ${JSON.stringify(firstResult)}`,
    );
  const afterFirst = await scene("GET", `/projects/${project.id}`);
  report.steps.afterAction = afterFirst;
  const firstProject = afterFirst.body;
  if (firstProject.revision !== initialRevision + 1)
    throw new Error(
      `revision did not increment: ${initialRevision} -> ${firstProject.revision}`,
    );
  if (!firstProject.plan.furniture.find((f) => f.id === wardrobe.id)?.opt?.open)
    throw new Error("wardrobe was not opened");

  // 4. duplicate requestId must not create a second revision
  const second = await invoke(payload);
  report.steps.duplicate = second;
  const afterSecond = await scene("GET", `/projects/${project.id}`);
  report.steps.afterDuplicate = afterSecond;
  if (afterSecond.body.revision !== firstProject.revision)
    throw new Error(
      `duplicate changed revision: ${firstProject.revision} -> ${afterSecond.body.revision}`,
    );
  if (unwrap(second.body)?.taskId !== firstResult.taskId)
    throw new Error("duplicate did not return the same taskId");

  // 5. optional real model/tool probe
  if (withProbe) {
    if (!modelKey) {
      report.steps.probe = {
        skipped: true,
        reason: "--with-probe requested but no MODEL_API_KEY/DEEPSEEK_API_KEY",
      };
    } else {
      const probe = spawnSync(process.execPath, ["scripts/platform-probe.mjs"], {
        cwd: root,
        env: {
          ...process.env,
          ACTISCAPE_URL: sceneBase,
          AGENTARTS_INVOKE_URL: invokeUrl,
          ...(token ? { AGENTARTS_BEARER_TOKEN: token } : {}),
          AGENTARTS_EXECUTION_LOCATION: "live-verification",
        },
        encoding: "utf8",
        timeout: 180_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      const probeReport = path.join(root, "test-results/platform-probe/report.json");
      report.steps.probe = {
        exitCode: probe.status,
        stdout: probe.stdout?.slice(-4000),
        stderr: probe.stderr?.slice(-4000),
        report: fs.existsSync(probeReport)
          ? JSON.parse(fs.readFileSync(probeReport, "utf8"))
          : null,
      };
      if (probe.status !== 0)
        throw new Error(`platform-probe failed: exit ${probe.status}`);
    }
  } else {
    report.steps.probe = {
      skipped: true,
      reason: "no model key; pass --with-probe to force",
    };
  }

  report.projectId = project.id;
  report.wardrobeId = wardrobe.id;
  report.initialRevision = initialRevision;
  report.finalRevision = afterSecond.body.revision;
  report.taskId = firstResult.taskId;
  report.passed = true;
  console.log(
    JSON.stringify(
      {
        passed: true,
        runtime: runtimeBase,
        scene: sceneBase,
        projectId: project.id,
        initialRevision,
        finalRevision: afterSecond.body.revision,
        taskId: firstResult.taskId,
        probe: report.steps.probe?.skipped ? "skipped" : "passed",
        report: path.relative(root, reportFile),
      },
      null,
      2,
    ),
  );
}

try {
  await main();
  report.finishedAt = new Date().toISOString();
  save();
} catch (error) {
  report.error = error?.stack || String(error);
  report.finishedAt = new Date().toISOString();
  save();
  console.error(`AgentArts live verification failed: ${error?.message || error}`);
  console.error(`report: ${path.relative(root, reportFile)}`);
  process.exit(1);
}
