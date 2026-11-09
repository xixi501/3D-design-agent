import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../apps/service/src/app.js";
import { blankPlan, clone } from "../packages/scene-core/src/index.js";

test("V4 floorplan drafts persist only through the single SceneDraft authority", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "scene-floorplan-"));
  let service = await createApp({ dataDir: directory, logger: false });
  try {
    const count = (table: string) =>
      (
        service.store.db
          .prepare(`SELECT count(*) AS count FROM ${table}`)
          .get() as { count: number }
      ).count;
    const project = service.store.create(blankPlan());
    const image = await service.floorplans.upload(
      fs.readFileSync("fixtures/s2c-synthetic.png"),
      "synthetic.png",
    );
    const data = JSON.parse(
      fs.readFileSync("fixtures/s2c-v2-synthetic.floorplan.json", "utf8"),
    );
    data.image = Object.fromEntries(
      ["id", "sha256", "width", "height"].map((key) => [
        key,
        (image as any)[key],
      ]),
    );
    data.recognitionVersion = 4;
    data.candidatePolicyVersion = "geometry-only";
    const categoryCodes: Record<string, string> = {
      sofa1: "sofa",
      coffee1: "coffeeTable",
      chair1: "armchair",
      lamp1: "floorLamp",
    };
    for (const symbol of data.symbols) {
      symbol.categoryCode = categoryCodes[symbol.id] || "other";
      symbol.sourceLabel = symbol.category;
      symbol.category = symbol.categoryCode;
    }
    service.floorplans.evidenceVerifier = undefined;
    const root = `/api/projects/${project.id}/floorplan-drafts`;
    const created = await service.app.inject({
      method: "POST",
      url: root,
      payload: {
        requestId: "v4-create",
        imageId: image.id,
        baseRevision: project.revision,
        taskId: "task-v4",
        taskInput: "复现整层住宅",
        budgetLedger: {
          modelCalls: 2,
          activeSeconds: 5,
          repairRounds: 0,
          adapterCalls: 1,
          assetJobs: 0,
        },
        data,
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const draft = created.json();
    assert.equal(count("floorplan_drafts"), 0);
    assert.equal(count("scene_program_drafts"), 1);

    const scene = await service.app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/scene-drafts/${draft.id}`,
    });
    assert.equal(scene.statusCode, 200, scene.body);
    assert.equal(scene.json().schemaVersion, "actiscape.scene-draft.v2");
    assert.equal(scene.json().recognition.kind, "floorplan");
    assert.equal(scene.json().recognition.proposal.image.sha256, image.sha256);
    assert.equal(
      scene.json().program.levels[0].walls.length,
      data.walls.length,
    );
    assert.equal(scene.json().budgetLedger.modelCalls, 2);

    const preview = await service.app.inject({
      method: "POST",
      url: `${root}/${draft.id}/preview`,
      payload: { taskId: "task-v4" },
    });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal(preview.json().checks.passed, true, preview.body);

    const command = {
      requestId: "v4-command",
      draftRevision: draft.revision,
      commands: [
        {
          type: "upsert",
          collection: "uncertainties",
          object: {
            id: "manual-check",
            message: "operator review note",
            blocking: false,
          },
        },
      ],
    };
    const patched = await service.app.inject({
      method: "POST",
      url: `${root}/${draft.id}/commands`,
      payload: command,
    });
    assert.equal(patched.statusCode, 200, patched.body);
    assert.equal(patched.json().revision, 1);
    const replayed = await service.app.inject({
      method: "POST",
      url: `${root}/${draft.id}/commands`,
      payload: command,
    });
    assert.equal(replayed.statusCode, 200, replayed.body);
    assert.equal(replayed.json().hash, patched.json().hash);
    assert.equal(count("scene_program_draft_revisions"), 2);

    const reviewed = await service.app.inject({
      method: "POST",
      url: `${root}/${draft.id}/review`,
      payload: {
        requestId: "v4-review",
        draftRevision: patched.json().revision,
        draftHash: patched.json().hash,
        evidenceRefs: [`image:${image.sha256}`],
        review: {
          passed: true,
          summary: "source review passed",
          issues: [],
        },
      },
    });
    assert.equal(reviewed.statusCode, 200, reviewed.body);
    assert.equal(reviewed.json().revision, patched.json().revision);
    assert.equal(reviewed.json().hash, patched.json().hash);
    assert.equal(reviewed.json().sourceReview.hash, patched.json().hash);

    const confirmed = await service.app.inject({
      method: "POST",
      url: `${root}/${draft.id}/confirm`,
      payload: {
        requestId: "v4-confirm",
        draftRevision: reviewed.json().revision,
        draftHash: reviewed.json().hash,
      },
    });
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    assert.equal(confirmed.json().confirmed.hash, reviewed.json().hash);
    assert.equal(confirmed.json().confirmed.revision, reviewed.json().revision);
    const confirmedScene = await service.app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/scene-drafts/${draft.id}`,
    });
    assert.equal(
      confirmedScene.json().recognition.confirmed.hash,
      confirmed.json().hash,
    );
    assert.equal(count("scene_program_draft_revisions"), 2);
    assert.equal(
      service.floorplans.confirmed(project.id, {
        draftId: draft.id,
        draftRevision: confirmed.json().revision,
        draftHash: confirmed.json().hash,
      }).confirmed.hash,
      confirmed.json().hash,
    );
    const candidate = await service.app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/candidates`,
      payload: {
        requestId: "v4-candidate",
        taskId: "task-v4",
        baseRevision: project.revision,
        kind: "initialize_floorplan",
        floorplan: {
          draftId: draft.id,
          draftRevision: confirmed.json().revision,
          draftHash: confirmed.json().hash,
        },
        matches: [
          { symbolId: "sofa1", key: "sofa" },
          { symbolId: "coffee1", key: "coffeeTable" },
          { symbolId: "chair1", key: "armchair" },
          { symbolId: "lamp1", key: "floorLamp" },
        ],
        summary: "V4 single-authority candidate",
      },
    });
    assert.equal(candidate.statusCode, 201, candidate.body);

    const invalidated = await service.app.inject({
      method: "POST",
      url: `${root}/${draft.id}/commands`,
      payload: {
        requestId: "v4-invalidate",
        draftRevision: confirmed.json().revision,
        commands: [
          {
            type: "patch",
            collection: "uncertainties",
            id: "manual-check",
            patch: { message: "operator changed the source note" },
          },
        ],
      },
    });
    assert.equal(invalidated.statusCode, 200, invalidated.body);
    assert.equal(invalidated.json().confirmed, null);
    assert.equal(invalidated.json().sourceReview, null);

    const invalidProgram = await service.app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scene-drafts/${draft.id}/patches`,
      payload: {
        requestId: "wrong-program",
        draftRevision: invalidated.json().revision,
        commands: [
          {
            op: "replaceProgram",
            program: {
              ...scene.json().program,
              levels: [
                {
                  ...scene.json().program.levels[0],
                  walls: scene
                    .json()
                    .program.levels[0].walls.map((wall: any) => ({
                      ...wall,
                      thickness: wall.thickness + 1,
                    })),
                },
              ],
            },
          },
        ],
      },
    });
    assert.equal(invalidProgram.statusCode, 422, invalidProgram.body);
    assert.match(invalidProgram.json().message, /识别提案/);
    service.store.close();
    service = await createApp({ dataDir: directory, logger: false });
    const reopened = await service.app.inject({
      method: "GET",
      url: `${root}/${draft.id}`,
    });
    assert.equal(reopened.statusCode, 200, reopened.body);
    assert.equal(reopened.json().confirmed, null);
    assert.equal(reopened.json().sourceReview, null);
    const reopenedScene = await service.app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/scene-drafts/${draft.id}`,
    });
    assert.equal(reopenedScene.json().recognition.confirmed, null);
  } finally {
    service.store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("legacy floorplan records remain on the V1-V3 storage path", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-floorplan-"));
  const service = await createApp({ dataDir: directory, logger: false });
  try {
    const count = (table: string) =>
      (
        service.store.db
          .prepare(`SELECT count(*) AS count FROM ${table}`)
          .get() as { count: number }
      ).count;
    const project = service.store.create(blankPlan());
    const image = await service.floorplans.upload(
      fs.readFileSync("fixtures/s2c-synthetic.png"),
      "synthetic.png",
    );
    const data = clone(
      JSON.parse(
        fs.readFileSync("fixtures/s2c-synthetic.floorplan.json", "utf8"),
      ),
    );
    data.image = Object.fromEntries(
      ["id", "sha256", "width", "height"].map((key) => [
        key,
        (image as any)[key],
      ]),
    );
    const draft = service.floorplans.create(project.id, {
      requestId: "legacy-create",
      imageId: image.id,
      baseRevision: project.revision,
      data,
    });
    assert.equal(count("floorplan_drafts"), 1);
    assert.equal(count("scene_program_drafts"), 0);
    assert.equal(service.floorplans.get(project.id, draft.id).id, draft.id);
  } finally {
    service.store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
