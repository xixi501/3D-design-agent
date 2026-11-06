import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../apps/service/src/app.js";
import { blankPlan, clone } from "../packages/scene-core/src/index.js";

test("original image tools expose measured evidence without changing project/draft/history, persist and verify files", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "floorplan-tools-"));
  let running = await createApp({ dataDir: dir, logger: false });
  try {
    const project = running.store.create(blankPlan());
    const image = await running.floorplans.upload(
      fs.readFileSync("fixtures/s2c-synthetic.png"),
      "synthetic.png",
    );
    const root = `/api/floorplan-images/${image.id}/tools`;
    const call = (url: string, payload: any) =>
      running.app.inject({ method: "POST", url, payload });
    const analyzed = await call(root + "/analyze", {});
    assert.equal(analyzed.statusCode, 200, analyzed.body.slice(0, 1000));
    const analysis = analyzed.json();
    assert.equal(analysis.commit, "b94183f9ce2215db9a178da89a90d2ecefb18497");
    assert.ok(analysis.result.segments_px.length >= 4);
    assert.deepEqual(analysis.result.size, [1000, 800]);
    assert.equal(analysis.files.length, 2);
    assert.ok(analysis.files.every((f: any) => !Object.hasOwn(f, "data")));
    assert.deepEqual((await call(root + "/analyze", {})).json(), analysis);
    const fit = await call(root + "/fit", {
      walls: [{ id: "top", kind: "H", c: 50, p0: 60, p1: 250 }],
    });
    assert.equal(fit.statusCode, 200, fit.body);
    assert.ok(Math.abs(fit.json().result[0].center - 50) <= 1);
    assert.ok(Math.abs(fit.json().result[0].thick_px - 21) <= 1);
    assert.ok(fit.json().result[0].n >= 50);
    const chain = await call(root + "/axis", {
      ticks: [50, 350, 950],
      distances: [3000, 6000],
      samples: [650],
      basis: "centerline",
      evidence: "synthetic controlled dimensions",
    });
    assert.equal(chain.json().result.averageMmPerPixel, 10);
    assert.equal(chain.json().result.samples[0].chainMillimetres, 6000);
    assert.equal(chain.json().result.inconsistent, false);
    const badChain = await call(root + "/axis", {
      ticks: [50, 350, 950],
      distances: [3000, 300],
      basis: "centerline",
      evidence: "deliberately inconsistent",
    });
    assert.equal(badChain.json().result.inconsistent, true);
    for (const [tool, payload] of [
      ["fit", { walls: [{ kind: "V", c: -1, p0: 0, p1: 20 }] }],
      [
        "axis",
        {
          ticks: [50, 20],
          distances: [3000],
          basis: "centerline",
          evidence: "invalid",
        },
      ],
      ["analyze", { script: "/bin/sh" }],
      ["analyze", { outlined: true }],
    ] as const)
      assert.equal((await call(root + "/" + tool, payload)).statusCode, 422);
    assert.equal((await call(root + "/evidence", {})).statusCode, 400);
    const data = JSON.parse(
      fs.readFileSync("fixtures/s2c-synthetic.floorplan.json", "utf8"),
    );
    data.image = Object.fromEntries(
      ["id", "sha256", "width", "height"].map((k) => [k, (image as any)[k]]),
    );
    const preflightUrl = `/api/projects/${project.id}/floorplan-preflight`;
    assert.equal(
      (await call(preflightUrl, { imageId: image.id, data })).json().checks
        .passed,
      true,
    );
    assert.equal(running.floorplans.list(project.id).length, 0);
    const invalid = clone(data);
    invalid.walls[0].a.x += 25;
    const invalidResult = (
      await call(preflightUrl, { imageId: image.id, data: invalid })
    ).json();
    assert.equal(invalidResult.checks.passed, false);
    assert.equal(invalidResult.checks.issues[0].field, "walls");
    const draft = running.floorplans.create(project.id, {
      requestId: "tools-draft",
      imageId: image.id,
      baseRevision: 0,
      data,
    });
    const auditUrl = `/api/projects/${project.id}/floorplan-drafts/${draft.id}/source-audit`;
    const auditResponse = await call(auditUrl, {});
    assert.equal(
      auditResponse.statusCode,
      200,
      auditResponse.body.slice(0, 1000),
    );
    const audit = auditResponse.json();
    assert.equal(audit.draftHash, draft.hash);
    assert.ok(audit.files.some((f: any) => f.name === "furn_all.png"));
    assert.ok(
      audit.result.issues.every((i: any) => typeof i.objectId === "string"),
    );
    assert.deepEqual(running.floorplans.get(project.id, draft.id), draft);
    assert.deepEqual(running.store.get(project.id), project);
    assert.deepEqual(running.store.history(project.id).entries, []);
    const firstFile = analysis.files[0];
    assert.equal(
      (await running.app.inject({ url: "/api" + firstFile.path })).statusCode,
      200,
    );
    await running.app.close();
    running = await createApp({ dataDir: dir, logger: false });
    assert.deepEqual((await call(root + "/analyze", {})).json(), analysis);
    assert.deepEqual((await call(auditUrl, {})).json(), audit);
    const file = path.join(
      dir,
      "floorplan-images",
      image.id,
      "tools",
      analysis.id,
      firstFile.name,
    );
    fs.writeFileSync(file, "corrupted");
    assert.equal(
      (await running.app.inject({ url: "/api" + firstFile.path })).json().error,
      "SOURCE_IMAGE_INVALID",
    );
    assert.equal(
      (await call(root + "/analyze", {})).json().error,
      "SOURCE_IMAGE_INVALID",
    );
    assert.deepEqual(running.store.get(project.id), project);
  } finally {
    await running.app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
