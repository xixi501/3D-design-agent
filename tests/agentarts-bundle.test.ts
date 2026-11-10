import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

test("prepare-agentarts-bundle creates a self-contained ARM64 deploy package", () => {
  execFileSync(process.execPath, ["scripts/prepare-agentarts-bundle.mjs"], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
  const bundle = path.resolve("dist/agentarts-bundle");
  for (const file of [
    "app.py",
    "agent.py",
    "task_runtime.py",
    "actiscape_agent",
    "requirements.txt",
    "Dockerfile",
    ".dockerignore",
    ".agentarts_config.yaml.example",
    "DEPLOY_RUNBOOK.md",
    "BUNDLE_MANIFEST.json",
  ]) {
    assert.ok(fs.existsSync(path.join(bundle, file)), file);
  }
  const requirements = fs.readFileSync(path.join(bundle, "requirements.txt"), "utf8");
  assert.ok(requirements.includes("agentarts-sdk=="));
  assert.ok(!/^-e /m.test(requirements));
  assert.ok(
    !requirements
      .split(/\r?\n/)
      .some((line) => line.trim().startsWith("apps/agent")),
  );
  const dockerfile = fs.readFileSync(path.join(bundle, "Dockerfile"), "utf8");
  assert.match(dockerfile, /FROM python:3\.13-slim/);
  assert.match(dockerfile, /AGENT_RUN_PORT=8080/);
  assert.match(dockerfile, /CMD \["python", "app\.py"\]/);
  const manifests = fs
    .readdirSync(path.join(bundle, "actiscape_agent/skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) =>
      fs.existsSync(
        path.join(bundle, "actiscape_agent/skills", entry.name, "manifest.json"),
      ),
    );
  assert.equal(manifests.length, 33);
  const app = fs.readFileSync(path.join(bundle, "app.py"), "utf8");
  assert.match(app, /from agent import app, handler/);
  assert.match(app, /AGENT_RUN_PORT/);
});
