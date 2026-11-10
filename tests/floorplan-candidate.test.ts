import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createApp } from "../apps/service/src/app.js";
import { canonical } from "../apps/service/src/store.js";

const image = fs.readFileSync("fixtures/s2c-synthetic.png");
const imageBase64 = image.toString("base64");
const baseUrl = (server: any) => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  return `http://127.0.0.1:${address.port}`;
};
const sha = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");

test("gateway floorplan-candidate returns a sealed ArtifactEnvelopeV1", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "actiscape-candidate-"));
  const service = await createApp({ dataDir, logger: false });
  await service.app.listen({ port: 0, host: "127.0.0.1" });
  try {
    const response = await fetch(`${baseUrl(service.app.server)}/api/tools/floorplan-candidate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imageBase64,
        adapterVersion: "hpd-adapter-6-1",
        scope: {
          roomSelection: "all_visible",
          functionalAreas: [],
          excludeFunctionalAreas: [],
        },
      }),
    });
    assert.equal(response.status, 200);
    const envelope: any = await response.json();
    assert.equal(envelope.schemaVersion, "actiscape.artifact-envelope.v1");
    assert.equal(envelope.kind, "floorplan-vision");
    assert.equal(envelope.providerId, "hpd-adapter-6-1");
    assert.equal(envelope.inputSha256, createHash("sha256").update(image).digest("hex"));
    assert.equal(envelope.artifactSha256, sha(envelope.artifact));
    assert.equal(envelope.scopeHash, sha(envelope.artifact.scope));
    assert.ok(envelope.artifact.candidates.walls.length > 0);
    assert.equal(envelope.artifact.audit.modelCalls, 0);
    assert.equal(envelope.artifact.audit.referenceAccess, "denied-and-audited");
    assert.equal(envelope.artifact.candidates.rooms.length, 0);
    assert.equal((service.store.db.prepare("SELECT COUNT(*) AS n FROM projects").get() as any).n, 0);
  } finally {
    await service.app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("gateway floorplan-candidate rejects path traversal and malformed images", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "actiscape-candidate-bad-"));
  const service = await createApp({ dataDir, logger: false });
  await service.app.listen({ port: 0, host: "127.0.0.1" });
  try {
    const base = baseUrl(service.app.server);
    const traversal = await fetch(`${base}/api/tools/floorplan-candidate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imagePath: "../../etc/passwd" }),
    });
    assert.equal(traversal.status, 422);
    const malformed = await fetch(`${base}/api/tools/floorplan-candidate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageBase64: Buffer.from("not-an-image").toString("base64") }),
    });
    assert.equal(malformed.status, 422);
  } finally {
    await service.app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
