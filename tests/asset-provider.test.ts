import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import { createApp } from "../apps/service/src/app.js";

const image = fs.readFileSync("fixtures/s2c-synthetic.png");
const imageSha = createHash("sha256").update(image).digest("hex");
const baseUrl = (server: any) => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  return `http://127.0.0.1:${address.port}`;
};
async function start(options: any = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "actiscape-asset-provider-"));
  const service = await createApp({ dataDir, logger: false, ...options });
  await service.app.listen({ port: 0, host: "127.0.0.1" });
  return { ...service, dataDir, base: baseUrl(service.app.server) };
}
async function upload(base: string, name = "我的花瓶") {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(image)], { type: "image/png" }), "vase.png");
  form.append("name", name);
  return fetch(`${base}/api/assets/generate-from-image`, { method: "POST", body: form });
}

test("demo fallback returns the fixed vase and calibrates without GPU", async () => {
  const service = await start();
  try {
    const response = await upload(service.base);
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.job.status, "succeeded");
    assert.equal(result.job.provider, "demo");
    assert.equal(result.asset.provider, "demo");
    assert.equal(result.asset.isRealGeneration, false);
    assert.ok(Math.abs(result.asset.h - 400) < 0.01);

    const calibrated = await fetch(
      `${service.base}/api/assets/${result.asset.id}/calibrate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetHeightMm: 280 }),
      },
    );
    assert.equal(calibrated.status, 200);
    const asset = (await calibrated.json()).asset;
    assert.ok(Math.abs(asset.h - 280) < 0.01);
    assert.ok(Math.abs(asset.w - 224) < 0.01);
    assert.equal(asset.scaleCalibrated, true);
    assert.equal(asset.scaleSource, "user_confirmed");
    assert.equal(service.store.asset(asset.id).h, 280);
  } finally {
    await service.app.close();
    fs.rmSync(service.dataDir, { recursive: true, force: true });
  }
});

test("real-cache first returns a verified V100 artifact in one second", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "actiscape-asset-cache-"));
  const cacheDir = path.join(dataDir, "real-generated-assets");
  const caseDir = path.join(cacheDir, imageSha);
  fs.mkdirSync(caseDir, { recursive: true });
  fs.writeFileSync(path.join(caseDir, "input.png"), image);
  fs.copyFileSync("fixtures/textured-vase.glb", path.join(caseDir, "asset.glb"));
  fs.writeFileSync(
    path.join(caseDir, "metadata.json"),
    JSON.stringify({
      input_sha256: imageSha,
      name: "V100 真实花瓶",
      category: "vase",
      is_real_generation: true,
      size_mm: { w: 280, d: 280, h: 280 },
      scale_calibrated: true,
      scale_source: "category_prior",
    }),
  );
  const service = await start({ dataDir, asset: { cacheDir } });
  try {
    const response = await upload(service.base);
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.job.provider, "real-cache");
    assert.equal(result.job.cached, true);
    assert.equal(result.asset.provider, "real-cache");
    assert.equal(result.asset.isRealGeneration, true);
    assert.ok(Math.abs(result.asset.h - 280) < 0.01);
    assert.equal(result.asset.name, "我的花瓶");
  } finally {
    await service.app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("remote GPU async job downloads, caches and replays from cache", async () => {
  let polls = 0;
  const glb = fs.readFileSync("fixtures/textured-vase.glb");
  const remote = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/v1/jobs") {
      req.resume();
      res.writeHead(202, { "content-type": "application/json" });
      res.end(JSON.stringify({ job: { id: "remote-1", status: "queued" } }));
      return;
    }
    if (req.method === "GET" && req.url === "/api/v1/jobs/remote-1") {
      polls++;
      res.writeHead(200, { "content-type": "application/json" });
      if (polls < 2) {
        res.end(JSON.stringify({ job: { id: "remote-1", status: "running" } }));
      } else {
        res.end(
          JSON.stringify({
            job: {
              id: "remote-1",
              status: "succeeded",
              result: {
                asset_id: "remote-asset",
                model_url: "/model.glb",
                spatial: { size_mm: { w: 250, d: 250, h: 250 } },
              },
            },
          }),
        );
      }
      return;
    }
    if (req.method === "GET" && req.url === "/model.glb") {
      res.writeHead(200, { "content-type": "model/gltf-binary" });
      res.end(glb);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => remote.listen(0, "127.0.0.1", resolve));
  const address = remote.address();
  if (!address || typeof address === "string") throw new Error("no remote port");
  const remoteUrl = `http://127.0.0.1:${address.port}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "actiscape-asset-remote-"));
  const service = await start({
    dataDir,
    asset: { serviceUrl: remoteUrl, cacheDir: path.join(dataDir, "real-generated-assets") },
  });
  try {
    const submitted = await upload(service.base);
    assert.equal(submitted.status, 202);
    const queued = await submitted.json();
    assert.equal(queued.job.provider, "remote-gpu");
    assert.ok(queued.pollUrl);
    const first = await (
      await fetch(`${service.base}${queued.pollUrl}`)
    ).json();
    assert.equal(first.job.status, "running");
    const second = await (
      await fetch(`${service.base}${queued.pollUrl}`)
    ).json();
    assert.equal(second.job.status, "succeeded", JSON.stringify(second.job));
    assert.equal(second.job.provider, "remote-gpu");
    assert.equal(second.asset.provider, "remote-gpu");
    assert.equal(second.asset.isRealGeneration, true);
    assert.ok(Math.abs(second.asset.h - 250) < 0.01);
    const cacheCase = path.join(dataDir, "real-generated-assets", imageSha);
    assert.ok(fs.existsSync(path.join(cacheCase, "asset.glb")));

    const replay = await upload(service.base);
    const cached = await replay.json();
    assert.equal(cached.job.provider, "real-cache");
    assert.equal(cached.job.cached, true);
    assert.ok(Math.abs(cached.asset.h - 250) < 0.01);
  } finally {
    await service.app.close();
    remote.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("unreachable remote GPU falls back to the demo asset with an explicit reason", async () => {
  const service = await start({
    asset: { serviceUrl: "http://127.0.0.1:9" },
  });
  try {
    const response = await upload(service.base);
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.job.provider, "demo");
    assert.equal(result.job.fallback, true);
    assert.ok(result.job.remoteError);
    assert.equal(result.asset.provider, "demo");
    assert.equal(result.asset.isRealGeneration, false);
  } finally {
    await service.app.close();
    fs.rmSync(service.dataDir, { recursive: true, force: true });
  }
});
