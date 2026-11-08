import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../apps/service/src/app.js";
import { blankPlan, clone } from "../packages/scene-core/src/index.js";

test("v2 diagnostics, candidate binding, patch evidence ledger and review invalidation are durable and atomic", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "floorplan-v2-"));
  let service = await createApp({ dataDir: directory, logger: false });
  try {
    const project = service.store.create(blankPlan());
    const image = await service.floorplans.upload(
      fs.readFileSync("fixtures/s2c-synthetic.png"),
      "synthetic.png",
    );
    const call = (url: string, payload: any) =>
      service.app.inject({ method: "POST", url, payload });
    const tools = `/api/floorplan-images/${image.id}/tools`,
      root = `/api/projects/${project.id}/floorplan-drafts`;
    const analysis = (await call(tools + "/analyze", {})).json();
    const bound = await call(tools + "/fit-bound", {
      walls: [{ id: "north", analysisId: analysis.id, index: 0 }],
    });
    assert.equal(bound.statusCode, 200, bound.body);
    assert.ok(bound.json().result[0].n > 0);
    assert.ok(bound.json().files.length);
    assert.equal(
      (
        await call(tools + "/fit-bound", {
          walls: [{ id: "bad", analysisId: analysis.id, index: 99999 }],
        })
      ).statusCode,
      422,
    );
    const data = JSON.parse(
      fs.readFileSync("fixtures/s2c-v2-synthetic.floorplan.json", "utf8"),
    );
    data.image = Object.fromEntries(
      ["id", "sha256", "width", "height"].map((k) => [k, (image as any)[k]]),
    );
    data.features = [];
    data.dimensions = [];
    let draft = service.floorplans.create(project.id, {
      requestId: "create",
      baseRevision: 0,
      imageId: image.id,
      data,
    });
    const url = root + "/" + draft.id;
    const diagnostic = (await call(url + "/diagnostics", {})).json();
    assert.equal(diagnostic.coverage, "raster-only");
    assert.equal(diagnostic.checks.passed, false);
    assert.equal(diagnostic.draftHash, draft.hash);
    const imageRef = "image:" + image.sha256;
    const update = (record: any, id: string, object: string, x: number) => ({
      requestId: id,
      draftRevision: record.revision,
      draftHash: record.hash,
      commands: [
        { type: "patch", collection: "symbols", id: object, patch: { x } },
      ],
      changeReasons: [
        {
          collection: "symbols",
          id: object,
          reason: "controlled image observation",
          evidenceRefs: [imageRef],
        },
      ],
      evidenceRefs: [imageRef],
    });
    const first = update(draft, "first", "chair1", 510);
    const result = await call(url + "/measurement-updates", first);
    assert.equal(result.statusCode, 200, result.body);
    draft = result.json();
    assert.equal(draft.corrections, 0);
    assert.equal(draft.changeLedger.length, 1);
    const second = update(draft, "second", "sofa1", 251);
    draft = (await call(url + "/measurement-updates", second)).json();
    assert.equal(draft.changeLedger.length, 2);
    assert.equal(
      (await call(url + "/measurement-updates", first)).json().hash,
      result.json().hash,
    );
    assert.equal(service.floorplans.get(project.id, draft.id).hash, draft.hash);
    const noReason = {
      ...update(draft, "no-reason", "chair1", 505),
      changeReasons: [],
    };
    assert.equal(
      (await call(url + "/measurement-updates", noReason)).statusCode,
      422,
    );
    assert.equal(service.floorplans.get(project.id, draft.id).hash, draft.hash);
    const staleReview = await call(url + "/review", {
      requestId: "stale",
      draftRevision: draft.revision,
      draftHash: draft.hash,
      evidenceRefs: [diagnostic.id],
      review: { passed: true, summary: "controlled", issues: [] },
    });
    assert.equal(staleReview.statusCode, 409);
    const current = (await call(url + "/diagnostics", {})).json();
    const review = {
      requestId: "current",
      draftRevision: draft.revision,
      draftHash: draft.hash,
      evidenceRefs: [current.id],
      review: { passed: true, summary: "controlled source-only", issues: [] },
    };
    assert.equal((await call(url + "/review", review)).statusCode, 200);
    const advisory = await call(url + "/review", {
      ...review,
      requestId: "current-with-advisory",
      review: {
        passed: true,
        summary: "deterministic checks passed with one model advisory",
        issues: [
          {
            code: "OTHER",
            source: "model",
            severity: "advisory",
            object_ids: ["chair1"],
            description: "non-blocking visual observation",
            evidenceRefs: [current.id],
          },
        ],
      },
    });
    assert.equal(advisory.statusCode, 200, advisory.body);
    assert.equal(
      advisory.json().sourceReview.review.issues[0].severity,
      "advisory",
    );
    assert.equal(
      (
        await call(url + "/confirm", {
          requestId: "confirm",
          draftRevision: draft.revision,
          draftHash: draft.hash,
        })
      ).statusCode,
      422,
      "Source review must not waive dimension compilation",
    );
    assert.deepEqual(service.store.get(project.id), project);
    await service.app.close();
    service = await createApp({ dataDir: directory, logger: false });
    assert.equal(
      service.floorplans.get(project.id, draft.id).changeLedger.length,
      2,
    );
    assert.equal((await call(url + "/diagnostics", {})).json().id, current.id);
  } finally {
    await service.app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
