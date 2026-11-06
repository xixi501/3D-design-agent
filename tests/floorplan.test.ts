import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  blankPlan,
  clone,
  applyCommands,
  detectRooms,
  createFurniture,
} from "../packages/scene-core/src/index.js";
import {
  compileFloorplan,
  materializeFloorplan,
  checkFloorplanInitialization,
  type FloorplanData,
} from "../packages/scene-core/src/floorplan.js";
import { checkCandidate } from "../packages/scene-core/src/candidate.js";
import { ProjectStore } from "../apps/service/src/store.js";
import { CandidateStore } from "../apps/service/src/candidates.js";
const data: FloorplanData = JSON.parse(
  fs.readFileSync("fixtures/s2c-synthetic.floorplan.json", "utf8"),
);
const binding = {
  draftId: "draft-one",
  draftRevision: 0,
  draftHash: "1".repeat(64),
};
const matches = [
  { symbolId: "sofa1", key: "sofa" },
  { symbolId: "coffee1", key: "coffeeTable" },
  { symbolId: "chair1", key: "armchair" },
  { symbolId: "lamp1", key: "floorLamp" },
];
const empty = () => ({ plan: blankPlan(), roomLabelArchive: [] });
test("floorplan compiler preserves multiple regions, shared walls, scale and deterministic identities", () => {
  const a = compileFloorplan(data, "fixed", binding),
    b = compileFloorplan(clone(data), "fixed", binding);
  assert.deepEqual(a, b);
  assert.deepEqual(a.state, applyCommands(empty(), a.commands));
  assert.equal(a.rooms.length, 3);
  assert.equal(a.scale.mmPerPixel, 10);
  assert.equal(a.state.plan.rooms.length, 3);
  assert.equal(a.state.plan.walls.length, 10);
  assert.equal(a.targetRoomIds[0], "fixed:r:living");
  const duplicated = clone(data);
  duplicated.walls.push({ ...duplicated.walls[4], id: "shared_duplicate" });
  assert.equal(
    compileFloorplan(duplicated, "fixed", binding).state.plan.walls.length,
    a.state.plan.walls.length,
  );
  const initialized = materializeFloorplan(data, "fixed", binding, matches);
  assert.equal(initialized.state.plan.furniture[0].w, 2200);
  assert.equal(initialized.state.plan.furniture[0].id, "fixed:f:sofa1");
  assert.equal(
    checkFloorplanInitialization(
      empty(),
      initialized.state,
      data,
      "fixed",
      binding,
      matches,
    ).passed,
    true,
  );
  const changed = clone(initialized.state);
  changed.plan.furniture[0].x += 100;
  assert.equal(
    checkFloorplanInitialization(
      empty(),
      changed,
      data,
      "fixed",
      binding,
      matches,
    ).passed,
    false,
  );
});
test("floorplan compiler retains L-shaped geometry and rejects scale, topology, opening and identity failures", () => {
  const l = clone(data);
  l.walls = [
    l.walls[0],
    { id: "e1", a: { x: 950, y: 50 }, b: { x: 950, y: 400 } },
    { id: "s1", a: { x: 950, y: 400 }, b: { x: 650, y: 400 } },
    { id: "e2", a: { x: 650, y: 400 }, b: { x: 650, y: 750 } },
    { id: "s2", a: { x: 650, y: 750 }, b: { x: 50, y: 750 } },
    l.walls[3],
  ];
  l.openings = l.openings.filter((o) => o.type === "window");
  l.rooms = [l.rooms[0]];
  assert.ok(
    detectRooms(compileFloorplan(l, "lshape").state.plan).regions[0].rects
      .length > 1,
  );
  for (const mutate of [
    (v: FloorplanData) => {
      v.anchors = [];
    },
    (v: FloorplanData) => {
      v.anchors.push({ ...v.anchors[0], distance: { value: 8, unit: "m" } });
    },
    (v: FloorplanData) => {
      v.walls[0].b.y += 10;
    },
    (v: FloorplanData) => {
      v.walls.pop();
    },
    (v: FloorplanData) => {
      v.openings[0].offset = 9999;
    },
    (v: FloorplanData) => {
      v.openings[0].wallId = "absent";
    },
    (v: FloorplanData) => {
      v.rooms[0].at = { x: 1, y: 1 };
    },
    (v: FloorplanData) => {
      v.symbols[0].id = v.walls[0].id;
    },
  ]) {
    const v = clone(data);
    mutate(v);
    assert.throws(() => compileFloorplan(v, "bad"));
  }
  assert.throws(() =>
    materializeFloorplan(data, "fixed", binding, matches.slice(1)),
  );
  const missing = clone(data);
  missing.uncertainties = [
    { id: "unknown1", message: "尚未确认入口", blocking: true },
  ];
  const result = materializeFloorplan(missing, "fixed", binding, matches);
  assert.equal(
    checkFloorplanInitialization(
      empty(),
      result.state,
      missing,
      "fixed",
      binding,
      matches,
    ).passed,
    false,
  );
});
test("room-scoped checks reject furniture in a different valid room", () => {
  const shell = compileFloorplan(data, "rooms"),
    f = createFurniture("floorLamp", 7500, 1800);
  const after = applyCommands(shell.state, [
    { type: "add", collection: "furniture", object: f },
  ]);
  const broad = {
    targetIds: [],
    allowDeleteIds: [],
    allowAddKeys: ["floorLamp"],
    requirements: [],
  };
  assert.equal(checkCandidate(shell.state, after, broad).passed, true);
  assert.equal(
    checkCandidate(shell.state, after, {
      ...broad,
      allowedRoomIds: shell.targetRoomIds,
    }).passed,
    false,
  );
});
test("ordered migration preserves existing project, history and candidate requests", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "floorplan-migrate-"));
  let store = new ProjectStore(dir);
  try {
    const p = store.create(blankPlan());
    const c = new CandidateStore(store);
    store.db.pragma("user_version=2");
    store.close();
    store = new ProjectStore(dir);
    assert.equal(store.db.pragma("user_version", { simple: true }), 3);
    assert.equal(store.get(p.id).revision, 0);
    assert.equal(new CandidateStore(store).list(p.id).length, 0);
    assert.deepEqual(store.history(p.id).entries, []);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("durable floorplan upload, draft correction, exact confirmation and one-transaction initialization", async () => {
  const { createApp } = await import("../apps/service/src/app.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "floorplan-api-"));
  let running = await createApp({ dataDir: dir, logger: false });
  try {
    const { store, floorplans, candidates } = running,
      p = store.create(blankPlan());
    const img = await floorplans.upload(
      fs.readFileSync("fixtures/s2c-synthetic.png"),
      "synthetic.png",
    );
    assert.equal(img.width, 1000);
    assert.equal(img.height, 800);
    assert.equal(img.status, "ready");
    await assert.rejects(
      () => floorplans.upload(Buffer.from("not png"), "bad.png"),
      (e: any) => e.code === "INVALID_IMAGE",
    );
    const d = clone(data);
    d.image = {
      id: img.id,
      sha256: img.sha256,
      width: img.width,
      height: img.height,
    };
    const request = {
      requestId: "draft-create",
      imageId: img.id,
      baseRevision: 0,
      data: d,
    };
    const draft = floorplans.create(p.id, request);
    assert.deepEqual(floorplans.create(p.id, request), draft);
    assert.equal(store.get(p.id).revision, 0);
    assert.equal(store.history(p.id).entries.length, 0);
    assert.equal(floorplans.preview(p.id, draft.id).checks.passed, true);
    const confirm = {
      requestId: "confirm-1",
      draftRevision: 0,
      draftHash: draft.hash,
    };
    floorplans.confirm(p.id, draft.id, confirm);
    let frozen = { draftId: draft.id, draftRevision: 0, draftHash: draft.hash };
    const c = candidates.create(p.id, {
      requestId: "floorplan-candidate",
      taskId: "reconstruct",
      baseRevision: 0,
      kind: "initialize_floorplan",
      floorplan: frozen,
      matches,
    });
    assert.equal(c.checks.passed, true);
    assert.equal(c.state.plan.furniture.length, 4);
    assert.equal(store.get(p.id).revision, 0);
    const corrected = floorplans.commands(p.id, draft.id, {
      requestId: "correction",
      draftRevision: 0,
      commands: [{ type: "defaults", values: { height: 3000 } }],
    });
    assert.equal(corrected.confirmed, null);
    assert.throws(
      () => floorplans.confirmed(p.id, frozen),
      (e: any) => e.code === "DRAFT_CONFLICT",
    );
    floorplans.confirm(p.id, draft.id, {
      requestId: "confirm-2",
      draftRevision: 1,
      draftHash: corrected.hash,
    });
    frozen = { draftId: draft.id, draftRevision: 1, draftHash: corrected.hash };
    const ready = candidates.create(p.id, {
      requestId: "candidate-2",
      taskId: "reconstruct",
      baseRevision: 0,
      kind: "initialize_floorplan",
      floorplan: frozen,
      matches,
    });
    const png = Buffer.alloc(110, 0);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    const evidence = candidates.saveEvidence(p.id, ready.id, [
      { view: "top", data: png },
      { view: "oblique", data: png },
    ]);
    candidates.review(p.id, ready.id, {
      source: "operator",
      passed: true,
      summary: "Controlled evidence: transaction test only",
      objectIds: [],
      issues: [],
      evidenceHashes: evidence.map((e) => e.sha256),
    });
    const payload = {
      operationId: ready.operationId,
      baseRevision: 0,
      candidateHash: ready.hash,
    };
    const saved = candidates.commit(p.id, ready.id, payload);
    assert.equal(saved.project.revision, 1);
    assert.equal(candidates.commit(p.id, ready.id, payload).replayed, true);
    assert.equal(store.history(p.id).entries.length, 1);
    await running.app.close();
    running = await createApp({ dataDir: dir, logger: false });
    assert.equal(
      running.floorplans.get(p.id, draft.id).confirmed.hash,
      corrected.hash,
    );
    assert.equal(running.floorplans.verifyImage(img.id).sha256, img.sha256);
    const undo = running.store.mutate(p.id, "undo", {
      operationId: "undo",
      baseRevision: 1,
    });
    assert.equal(undo.project.plan.walls.length, 0);
    assert.equal(undo.project.plan.source, undefined);
    const redo = running.store.mutate(p.id, "redo", {
      operationId: "redo",
      baseRevision: 2,
    });
    assert.deepEqual(redo.project.plan, saved.project.plan);
    assert.equal(
      running.candidates.commit(p.id, ready.id, payload).replayed,
      true,
    );
    assert.throws(
      () =>
        running.floorplans.create(p.id, {
          ...request,
          requestId: "not-empty",
          baseRevision: 3,
        }),
      (e: any) => e.code === "PROJECT_NOT_EMPTY",
    );
  } finally {
    await running.app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("floorplan source images, overlays, crops, export/import and stale confirmations fail explicitly", async () => {
  const { createApp } = await import("../apps/service/src/app.js"),
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "floorplan-source-"));
  const { app, store, floorplans } = await createApp({
    dataDir: dir,
    logger: false,
  });
  try {
    const img = await floorplans.upload(
        fs.readFileSync("fixtures/s2c-synthetic.png"),
        "source.png",
      ),
      p = store.create(blankPlan()),
      d = clone(data);
    d.image = {
      id: img.id,
      sha256: img.sha256,
      width: img.width,
      height: img.height,
    };
    const draft = floorplans.create(p.id, {
      requestId: "create",
      imageId: img.id,
      baseRevision: 0,
      data: d,
    });
    const crop = await floorplans.crop(img.id, [100, 100, 500, 400]);
    assert.equal(
      fs
        .readFileSync(floorplans.cropFile(img.id, crop.id))
        .subarray(1, 4)
        .toString(),
      "PNG",
    );
    const overlay = await floorplans.overlay(p.id, draft.id);
    assert.equal(overlay.draftHash, draft.hash);
    assert.ok(fs.statSync(overlay.file).size > 1000);
    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${p.id}/floorplan-drafts/${draft.id}/overlay`,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["x-draft-hash"], draft.hash);
    const b = { requestId: "yes", draftRevision: 0, draftHash: draft.hash };
    floorplans.confirm(p.id, draft.id, b);
    const changed = floorplans.commands(p.id, draft.id, {
      requestId: "touch",
      draftRevision: 0,
      commands: [
        {
          type: "upsert",
          collection: "symbols",
          object: { ...d.symbols[0], x: d.symbols[0].x + 10 },
        },
      ],
    });
    assert.equal(changed.corrections, 1);
    assert.equal(changed.confirmed, null);
    assert.throws(
      () => floorplans.confirm(p.id, draft.id, { ...b, requestId: "stale" }),
      (e: any) => e.code === "DRAFT_CONFLICT",
    );
    const project = materializeFloorplan(
      d,
      "source",
      { draftId: draft.id, draftRevision: 0, draftHash: draft.hash },
      matches,
    );
    const imported = store.create({ formatVersion: 1, ...project.state });
    assert.equal(imported.plan.source.imageId, img.id);
    const exported = await app.inject({
      method: "GET",
      url: `/api/projects/${imported.id}/export`,
    });
    assert.equal(exported.json().sourceImageManifest[0].sha256, img.sha256);
    fs.unlinkSync(floorplans.file(img.id, "original").file);
    assert.throws(
      () => store.create(exported.json()),
      (e: any) => e.code === "MISSING_SOURCE_IMAGES",
    );
    assert.throws(
      () =>
        floorplans.confirmed(p.id, {
          draftId: draft.id,
          draftRevision: changed.revision,
          draftHash: changed.hash,
        }),
      (e: any) => e.code === "DRAFT_CONFLICT",
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("floorplan scoring separates first recognition, human corrections, topology and final fidelity", async () => {
  const { scoreFloorplan } =
    await import("../packages/scene-core/src/floorplan-metrics.js");
  assert.equal(scoreFloorplan(data, data, data, 0).passed, true);
  const omitted = clone(data);
  omitted.symbols.pop();
  assert.equal(scoreFloorplan(omitted, data, data, 1).rawPassed, false);
  assert.equal(scoreFloorplan(data, data, data, 6).passed, false);
  const moved = clone(data);
  moved.symbols[0].x += 30;
  assert.equal(scoreFloorplan(data, moved, data, 1).finalPassed, false);
  const renamed = clone(data);
  renamed.rooms[1].name = "错误房间";
  assert.equal(
    scoreFloorplan(data, renamed, data, 1).confirmed.structure.passed,
    false,
  );
  const badTarget = clone(data);
  badTarget.targetRoomIds = ["bedroom"];
  assert.equal(scoreFloorplan(data, badTarget, data, 1).passed, false);
});
test("malformed draft batches and catalogue matches reject atomically with explicit errors", async () => {
  const { validateFloorplan } =
    await import("../packages/scene-core/src/floorplan.js");
  const malformed = clone(data);
  (malformed.walls as any)[0] = null;
  assert.throws(
    () => validateFloorplan(malformed),
    (e: any) => e.code === "INVALID_FLOORPLAN",
  );
  assert.throws(
    () =>
      materializeFloorplan(data, "malformed", binding, [
        null,
        ...matches.slice(1),
      ] as any),
    (e: any) => e.code === "INVALID_FLOORPLAN",
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "floorplan-fields-")),
    store = new ProjectStore(dir),
    candidates = new CandidateStore(store),
    floorplans = candidates.floorplans;
  try {
    const bytes = fs.readFileSync("fixtures/s2c-synthetic.png"),
      img = await floorplans.upload(bytes, "guard.png"),
      d = clone(data);
    d.image = {
      id: img.id,
      sha256: img.sha256,
      width: img.width,
      height: img.height,
    };
    const p = store.create(blankPlan()),
      draft = floorplans.create(p.id, {
        requestId: "guard",
        imageId: img.id,
        baseRevision: 0,
        data: d,
      });
    floorplans.confirm(p.id, draft.id, {
      requestId: "confirm",
      draftRevision: 0,
      draftHash: draft.hash,
    });
    const before = floorplans.get(p.id, draft.id);
    for (const bad of [
      null,
      { type: "defaults", values: [] },
      { type: "targets", roomIds: d.targetRoomIds, project: "escape" },
    ]) {
      assert.throws(
        () =>
          floorplans.commands(p.id, draft.id, {
            requestId: crypto.randomUUID(),
            draftRevision: 0,
            commands: [{ type: "defaults", values: { height: 3100 } }, bad],
          }),
        (e: any) => e.code === "INVALID_REQUEST",
      );
      assert.deepEqual(floorplans.get(p.id, draft.id), before);
      assert.equal(store.get(p.id).revision, 0);
    }
    assert.throws(
      () =>
        candidates.create(p.id, {
          requestId: "bad-scope",
          taskId: "guard",
          baseRevision: 0,
          kind: "initialize_floorplan",
          floorplan: {
            draftId: draft.id,
            draftRevision: 0,
            draftHash: draft.hash,
          },
          matches,
          scope: {
            targetIds: [],
            allowDeleteIds: [],
            allowAddKeys: [],
            requirements: [],
          },
        }),
      (e: any) => e.code === "INVALID_REQUEST",
    );
    const file = floorplans.file(img.id).file;
    assert.ok(img.normalizedSha256);
    fs.writeFileSync(file, "damaged");
    assert.throws(
      () => floorplans.verifyImage(img.id),
      (e: any) => e.code === "SOURCE_IMAGE_INVALID",
    );
    const repaired = await floorplans.upload(bytes, "repaired.png");
    assert.equal(repaired.id, img.id);
    assert.equal(
      floorplans.verifyImage(img.id).normalizedSha256,
      img.normalizedSha256,
    );
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
