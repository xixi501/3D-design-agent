import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const scene = (process.env.ACTISCAPE_URL || "http://127.0.0.1:3001").replace(
  /\/$/,
  "",
);
const invoke =
  process.env.AGENTARTS_INVOKE_URL || "http://127.0.0.1:3080/invocations";
const out = path.resolve("test-results/platform-probe");
fs.mkdirSync(out, { recursive: true });
async function api(url, body) {
  const r = await fetch(
    scene + "/api" + url,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  if (!r.ok) throw Error(`Scene HTTP ${r.status}`);
  return r.json();
}
const fixture = await api("/examples/living-dining");
fixture.name = "AgentArts 联通验证 · 独立测试项目";
const project = await api("/projects", { document: fixture });
const object = project.plan.furniture.find((f) => f.key === "armchair");
const payload = {
  requestId: crypto.randomUUID(),
  projectId: project.id,
  objectId: object.id,
  baseRevision: project.revision,
  originalX: object.x,
  targetX: object.x + 100,
};
fs.writeFileSync(
  path.join(out, "input.json"),
  JSON.stringify(payload, null, 2),
);
if (process.argv.includes("--prepare-only")) {
  console.log(
    "Prepared disposable project and test-results/platform-probe/input.json",
  );
  process.exit(0);
}
async function call() {
  const response = await fetch(invoke, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.AGENTARTS_BEARER_TOKEN
        ? { Authorization: `Bearer ${process.env.AGENTARTS_BEARER_TOKEN}` }
        : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) throw Error(`Runtime HTTP ${response.status}`);
  let value = await response.json();
  for (let i = 0; i < 4 && !value?.passed; i++) {
    const next =
      value?.result ?? value?.output ?? value?.response ?? value?.data;
    if (next === undefined) break;
    value = typeof next === "string" ? JSON.parse(next) : next;
  }
  assert.equal(value.passed, true);
  return value;
}
const first = await call(),
  after = await api(`/projects/${project.id}`);
assert.equal(after.revision, 2);
assert.deepEqual(after.plan, project.plan);
const second = await call(),
  replayed = await api(`/projects/${project.id}`);
assert.equal(second.replayed, true);
assert.equal(replayed.revision, 2);
const report = {
  passed: true,
  executionLocation: process.env.AGENTARTS_EXECUTION_LOCATION || "local-sdk",
  cloudDeploymentVerified: false,
  invokeUrl: invoke,
  projectId: project.id,
  first,
  second,
  restored: true,
  duplicateDidNotMutate: true,
};
fs.writeFileSync(
  path.join(out, "report.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  "PASS local AgentArts SDK + LangGraph / real model tool / read-move-read-undo / repeat deduplication; cloud remains unverified",
);
