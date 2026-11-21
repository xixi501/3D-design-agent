import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createApp } from "../apps/service/src/app.js";

test("cloud task lifecycle persists waiting_input and routes poll, resume, and cancel to AgentArts", async () => {
  const received: any[] = [];
  const cloudServer = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    received.push({
      session: req.headers["x-hw-agentarts-session-id"],
      body,
    });
    res.writeHead(200, { "content-type": "application/json" });
    if (body.action === "run_task") {
      res.end(
        JSON.stringify({
          status: "waiting_input",
          taskId: "cloud-task-001",
          mode: "edit",
          result: { status: "waiting_input", message: "请先选择哪张椅子" },
        }),
      );
      return;
    }
    if (body.action === "resume_task") {
      res.end(
        JSON.stringify({
          status: "completed",
          taskId: body.taskId,
          mode: "edit",
          result: { status: "completed", message: "已完成移动" },
        }),
      );
      return;
    }
    if (body.action === "cancel_task") {
      res.end(JSON.stringify({ status: "cancelled", taskId: body.taskId }));
      return;
    }
    res.end(JSON.stringify({ status: "ok" }));
  });
  await new Promise<void>((resolve) => cloudServer.listen(0, "127.0.0.1", resolve));
  const cloudPort = (cloudServer.address() as any).port;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "actiscape-cloud-lifecycle-"));
  const oldUrl = process.env.AGENTARTS_INVOCATIONS_URL;
  process.env.AGENTARTS_INVOCATIONS_URL = `http://127.0.0.1:${cloudPort}/invocations`;

  const { app } = await createApp({ dataDir: tmp, logger: false });
  try {
    const created = await app.inject({
      method: "POST",
      url: "/api/agent/conversations/conv_alpha/tasks",
      payload: {
        projectId: "proj-test-1",
        requestId: "req-1",
        input: "把椅子往右移",
      },
    });
    assert.equal(created.statusCode, 201);
    const task = created.json();
    assert.equal(task.id, "cloud-task-001");
    assert.equal(task.status, "waiting_input");

    // Polling GET /api/agent/tasks/:id resolves from CloudTaskStore without hitting local 3132
    const polled = await app.inject({
      method: "GET",
      url: "/api/agent/tasks/cloud-task-001",
    });
    assert.equal(polled.statusCode, 200);
    assert.equal(polled.json().status, "waiting_input");

    // Resume forwards to AgentArts with the same sessionId
    const resumed = await app.inject({
      method: "POST",
      url: "/api/agent/tasks/cloud-task-001/resume",
      payload: { requestId: "req-resume-1", input: "左边那把餐椅" },
    });
    assert.equal(resumed.statusCode, 200);
    assert.equal(resumed.json().status, "completed");
    assert.equal(received[1].body.action, "resume_task");
    assert.equal(received[1].session, "conv_alpha");

    // Cancel transitions task cleanly
    const cancelled = await app.inject({
      method: "POST",
      url: "/api/agent/tasks/cloud-task-001/cancel",
      payload: {},
    });
    assert.equal(cancelled.statusCode, 200);
    assert.equal(cancelled.json().status, "cancelled");
    assert.equal(received[2].body.action, "cancel_task");
  } finally {
    if (oldUrl === undefined) delete process.env.AGENTARTS_INVOCATIONS_URL;
    else process.env.AGENTARTS_INVOCATIONS_URL = oldUrl;
    await app.close();
    await new Promise<void>((resolve) => cloudServer.close(() => resolve()));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
