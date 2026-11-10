import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../apps/service/src/app.js";

const baseUrl = (server: any) => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  return `http://127.0.0.1:${address.port}`;
};

test("ACTISCAPE_TOOL_TOKEN protects /api/* but keeps health and local mode open", async () => {
  const previous = process.env.ACTISCAPE_TOOL_TOKEN;
  delete process.env.ACTISCAPE_TOOL_TOKEN;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "actiscape-auth-"));
  const service = await createApp({ dataDir, logger: false });
  await service.app.listen({ port: 0, host: "127.0.0.1" });
  try {
    const base = baseUrl(service.app.server);
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    assert.equal((await fetch(`${base}/api/projects`)).status, 200);

    process.env.ACTISCAPE_TOOL_TOKEN = "test-token";
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    assert.equal((await fetch(`${base}/api/projects`)).status, 401);
    assert.equal(
      (
        await fetch(`${base}/api/projects`, {
          headers: { authorization: "Bearer wrong" },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(`${base}/api/projects`, {
          headers: { authorization: "Bearer test-token" },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(`${base}/api/projects`, {
          headers: { "x-actiscape-token": "test-token" },
        })
      ).status,
      200,
    );
    const query = await fetch(`${base}/api/projects?token=test-token`);
    assert.equal(query.status, 200);
    assert.match(query.headers.get("set-cookie") || "", /actiscape_token=test-token/);
    assert.equal(
      (
        await fetch(`${base}/api/projects`, {
          headers: { cookie: "actiscape_token=test-token" },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(`${base}/api/projects?token=wrong`)
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(`${base}/api/projects`, {
          headers: { cookie: "actiscape_token=wrong" },
        })
      ).status,
      401,
    );
  } finally {
    if (previous === undefined) delete process.env.ACTISCAPE_TOOL_TOKEN;
    else process.env.ACTISCAPE_TOOL_TOKEN = previous;
    await service.app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
