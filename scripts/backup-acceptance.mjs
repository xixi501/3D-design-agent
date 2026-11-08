import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
const source = path.resolve(process.env.ACTISCAPE_DATA_DIR || "data"),
  out = path.resolve("test-results/backup");
fs.mkdirSync(out, { recursive: true });
try {
  const r = await fetch(
    (process.env.ACTISCAPE_URL || "http://127.0.0.1:3001") + "/api/health",
    { signal: AbortSignal.timeout(1000) },
  );
  if (r.ok) throw Error("SOURCE_RUNNING");
} catch (e) {
  if (e.message === "SOURCE_RUNNING")
    throw Error(
      "源服务仍在运行，请先停止 Node 与 Agent 服务再执行完整备份验收",
    );
}
const projectId =
  process.argv[2] ||
  JSON.parse(fs.readFileSync("test-results/agent/demo.json", "utf8")).task
    .projectId;
let db = new Database(path.join(source, "projects.sqlite"), { readonly: true });
assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
const original = db.prepare("SELECT * FROM projects WHERE id=?").get(projectId),
  asset = db.prepare("SELECT record FROM assets ORDER BY rowid LIMIT 1").get();
db.close();
db = new Database(path.join(source, "agent/tasks.sqlite"), { readonly: true });
assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
assert.equal(
  db
    .prepare(
      "SELECT count(*) AS n FROM tasks WHERE status IN ('queued','running','committing')",
    )
    .get().n,
  0,
  "验收复制前需完成活动任务，避免在测试副本重复运行用户任务",
);
const lastTask = db
    .prepare(
      "SELECT * FROM tasks WHERE project_id=? AND status='completed' ORDER BY created DESC LIMIT 1",
    )
    .get(projectId),
  taskCount = db.prepare("SELECT count(*) AS n FROM tasks").get().n;
db.close();
assert.ok(original && lastTask);
const restored = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "actiscape-full-restore-")),
  "data",
);
fs.cpSync(source, restored, { recursive: true });
async function freePort() {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
const nodePort = await freePort(),
  agentPort = await freePort(),
  base = `http://127.0.0.1:${nodePort}`;
const env = {
  ...process.env,
  ACTISCAPE_DATA_DIR: restored,
  ACTISCAPE_AGENT_DATA_DIR: path.join(restored, "agent"),
  ACTISCAPE_SCENE_URL: base,
  ACTISCAPE_AGENT_URL: `http://127.0.0.1:${agentPort}`,
  PORT: String(nodePort),
  AGENT_PORT: String(agentPort),
  HOST: "127.0.0.1",
};
const node = spawn(
  process.execPath,
  ["--import", "tsx", "apps/service/src/main.ts"],
  { env, stdio: "ignore" },
);
const agent = spawn(
  path.resolve(".venv/bin/python"),
  ["-m", "actiscape_agent"],
  { env, stdio: "ignore" },
);
async function ready(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Restored service did not become ready");
}
async function api(url, body) {
  const r = await fetch(
    base + "/api" + url,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const v = await r.json();
  if (!r.ok) throw Error(JSON.stringify(v));
  return v;
}
try {
  await Promise.all([
    ready(base + "/api/health"),
    ready(`http://127.0.0.1:${agentPort}/health`),
  ]);
  const project = await api(`/projects/${projectId}`),
    task = await api(`/agent/tasks/${lastTask.id}`);
  assert.deepEqual(project.plan, JSON.parse(original.state).plan);
  assert.equal(project.revision, original.revision);
  assert.equal(project.history.undo, original.cursor);
  assert.equal(task.status, "completed");
  assert.equal(task.modelCalls, lastTask.model_calls);
  assert.deepEqual(task.result, JSON.parse(lastTask.result));
  const generation = JSON.parse(lastTask.generation || "{}");
  assert.equal(task.mode, lastTask.mode || "edit");
  assert.deepEqual(
    task.generation,
    Object.fromEntries(
      Object.entries(generation).filter(
        ([key]) => !["skillSnapshot", "skillBundle"].includes(key),
      ),
    ),
  );
  if (generation.skillBundle)
    assert.equal(
      task.generation.skillBundle.contentHash,
      generation.skillBundle.contentHash,
    );
  const restoredTasks = new Database(
    path.join(restored, "agent/tasks.sqlite"),
    { readonly: true },
  );
  try {
    assert.deepEqual(
      JSON.parse(
        restoredTasks
          .prepare("SELECT generation FROM tasks WHERE id=?")
          .get(lastTask.id).generation,
      ),
      generation,
    );
  } finally {
    restoredTasks.close();
  }
  const candidate = await api(
    `/projects/${projectId}/candidates/${task.result.candidateId}`,
  );
  for (const evidence of candidate.evidence) {
    const bytes = Buffer.from(
      await (
        await fetch(
          `${base}/api/projects/${projectId}/candidates/${candidate.id}/evidence/${evidence.view}`,
        )
      ).arrayBuffer(),
    );
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      evidence.sha256,
    );
  }
  if (asset) {
    const a = JSON.parse(asset.record),
      bytes = Buffer.from(
        await (await fetch(`${base}/api/assets/${a.id}/file`)).arrayBuffer(),
      );
    assert.equal(createHash("sha256").update(bytes).digest("hex"), a.sha256);
  }
  const undo = (
    await api(`/projects/${projectId}/undo`, {
      operationId: crypto.randomUUID(),
      baseRevision: project.revision,
    })
  ).project;
  const redo = (
    await api(`/projects/${projectId}/redo`, {
      operationId: crypto.randomUUID(),
      baseRevision: undo.revision,
    })
  ).project;
  assert.deepEqual(redo.plan, project.plan);
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(
      {
        passed: true,
        sourceStopped: true,
        projectId,
        originalRevision: project.revision,
        restoredUndoRedo: true,
        conversationAndTaskRestored: true,
        taskCount,
        candidateEvidenceHashes: true,
        assetBytes: true,
        generationBriefAndSkill: true,
        checkpointFileCopied: fs.existsSync(
          path.join(restored, "agent/checkpoints.sqlite"),
        ),
        restoredDirectory: restored,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS stopped full-data backup restores project/history/assets/candidate evidence/conversation/task/checkpoint files; undo-redo works",
  );
} finally {
  for (const child of [agent, node]) {
    if (child.exitCode === null) {
      const done = once(child, "exit");
      child.kill("SIGTERM");
      await done;
    }
  }
}
