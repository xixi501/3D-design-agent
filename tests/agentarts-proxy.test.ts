import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createApp } from "../apps/service/src/app.js";

function baseUrl(server: any) {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  return `http://127.0.0.1:${address.port}`;
}

async function fakeAgentArts(handler: (body: any) => any) {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      const value = handler(body);
      const payload = Buffer.from(JSON.stringify(value));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(payload);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

test("AGENTARTS_INVOCATIONS_URL creates a synchronous cloud task and strips projectId locally", async () => {
  const seen: any[] = [];
  const cloud = await fakeAgentArts((body) => {
    seen.push(body);
    return {
      status: "completed",
      taskId: "cloud-task-1",
      result: { status: "completed", policy: { route: "interactive_action" } },
    };
  });
  const previous = process.env.AGENTARTS_INVOCATIONS_URL;
  process.env.AGENTARTS_INVOCATIONS_URL = `${baseUrl(cloud)}/invocations`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "actiscape-agentarts-"));
  const service = await createApp({ dataDir, logger: false });
  await service.app.listen({ port: 0, host: "127.0.0.1" });
  try {
    const base = baseUrl(service.app.server);
    const status = await (await fetch(`${base}/api/agentarts/status`)).json();
    assert.equal(status.configured, true);
    const response = await fetch(`${base}/api/agent/conversations/c1/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project-1",
        requestId: "request-1",
        mode: "interactive_action",
        input: "打开衣柜门",
        selectedIds: ["w1"],
      }),
    });
    assert.equal(response.status, 201);
    const task: any = await response.json();
    assert.equal(task.status, "completed");
    assert.equal(task.cloud, true);
    assert.equal(task.id, "cloud-task-1");
    assert.equal(task.projectId, "project-1");
    assert.equal(seen.length, 1);
    assert.equal(seen[0].action, "run_task");
    assert.equal(seen[0].projectId, "project-1");
    assert.equal(seen[0].mode, "interactive_action");
  } finally {
    await service.app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.AGENTARTS_INVOCATIONS_URL;
    else process.env.AGENTARTS_INVOCATIONS_URL = previous;
    await new Promise<void>((resolve) => cloud.close(() => resolve()));
  }
});
