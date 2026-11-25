import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../apps/service/src/app.js";
import { createFurniture } from "../packages/scene-core/src/index.js";

test("visitor workspace isolation protects private scenes, blocks public writes, and supports one-click fork", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "actiscape-ws-"));
  const { app } = await createApp({ dataDir: dir, logger: false });
  try {
    // 1. Create a public showcase project (no workspace header = internal/admin/public)
    const pubRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { document: { version: 2, name: "公共演示实验室", height: 3000, phase: "original", nodes: [], walls: [], openings: [], furniture: [], structs: [], beams: [], rooms: [], measures: [], elec: [], prices: {}, voids: [], comments: [] } },
    });
    assert.equal(pubRes.statusCode, 201);
    const pubProj = pubRes.json();
    // Public project viewed by Alice carries isPublic=true
    const pubByAlice = (await app.inject({ method: "GET", url: `/api/projects/${pubProj.id}`, headers: { "x-actiscape-workspace": "ws-alice001" } })).json();
    assert.equal(pubByAlice.isPublic, true);

    const hAlice = { "x-actiscape-workspace": "ws-alice001" };
    const hBob = { "x-actiscape-workspace": "ws-bob00002" };

    // 2. Alice creates a private project
    const aliceCreate = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: hAlice,
      payload: { document: { version: 2, name: "Alice的私密方案", height: 2800, phase: "original", nodes: [], walls: [], openings: [], furniture: [], structs: [], beams: [], rooms: [], measures: [], elec: [], prices: {}, voids: [], comments: [] } },
    });
    assert.equal(aliceCreate.statusCode, 201);
    const aliceProj = aliceCreate.json();
    assert.equal(aliceProj.ownerId, "ws-alice001");
    assert.equal(aliceProj.isPublic, false);

    // 3. Alice sees her own project + public showcase; Bob sees ONLY public showcase (NOT Alice's!)
    const aliceList = (await app.inject({ method: "GET", url: "/api/projects", headers: hAlice })).json();
    const bobList = (await app.inject({ method: "GET", url: "/api/projects", headers: hBob })).json();
    assert.equal(aliceList.some((p: any) => p.id === aliceProj.id), true);
    assert.equal(aliceList.some((p: any) => p.id === pubProj.id), true);
    assert.equal(bobList.some((p: any) => p.id === aliceProj.id), false);
    assert.equal(bobList.some((p: any) => p.id === pubProj.id), true);

    // 4. Bob cannot read or edit Alice's private project (403 WORKSPACE_FORBIDDEN)
    const bobReadAlice = await app.inject({ method: "GET", url: `/api/projects/${aliceProj.id}`, headers: hBob });
    assert.equal(bobReadAlice.statusCode, 403);
    assert.equal(bobReadAlice.json().error, "WORKSPACE_FORBIDDEN");

    const bobEditAlice = await app.inject({
      method: "POST",
      url: `/api/projects/${aliceProj.id}/commands`,
      headers: hBob,
      payload: { operationId: "op-bob-1", baseRevision: 0, commands: [] },
    });
    assert.equal(bobEditAlice.statusCode, 403);
    assert.equal(bobEditAlice.json().error, "WORKSPACE_FORBIDDEN");

    // 5. Alice cannot mutate the public project directly (403 PUBLIC_READONLY)
    const aliceMutatePub = await app.inject({
      method: "POST",
      url: `/api/projects/${pubProj.id}/commands`,
      headers: hAlice,
      payload: { operationId: "op-alice-pub", baseRevision: 0, commands: [] },
    });
    assert.equal(aliceMutatePub.statusCode, 403);
    assert.equal(aliceMutatePub.json().error, "PUBLIC_READONLY");

    // 6. Alice forks the public project into her own private editable copy
    const forkRes = await app.inject({
      method: "POST",
      url: `/api/projects/${pubProj.id}/fork`,
      headers: hAlice,
      payload: {},
    });
    assert.equal(forkRes.statusCode, 201);
    const forked = forkRes.json();
    assert.notEqual(forked.id, pubProj.id);
    assert.equal(forked.ownerId, "ws-alice001");
    assert.equal(forked.isPublic, false);
    assert.match(forked.plan.name, /我的副本/);

    // Alice can mutate her forked copy, while Bob is forbidden from reading it
    const aliceMutateFork = await app.inject({
      method: "POST",
      url: `/api/projects/${forked.id}/commands`,
      headers: hAlice,
      payload: { operationId: "op-alice-fork", baseRevision: 0, commands: [{ type: "add", collection: "furniture", object: createFurniture("stool", 1500, 1500) }] },
    });
    assert.equal(aliceMutateFork.statusCode, 200);
    const bobReadFork = await app.inject({ method: "GET", url: `/api/projects/${forked.id}`, headers: hBob });
    assert.equal(bobReadFork.statusCode, 403);

    // 7. Internal/admin call without workspace header still sees all projects
    const adminList = (await app.inject({ method: "GET", url: "/api/projects" })).json();
    assert.equal(adminList.length, 3);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
