import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../apps/service/src/app.js";
import { ProjectStore } from "../apps/service/src/store.js";
import { inspectGlb } from "../apps/service/src/assets.js";
import { blankPlan, newId } from "../packages/scene-core/src/index.js";
const fixture = JSON.parse(
  fs.readFileSync("fixtures/living-dining.plan.json", "utf8"),
);
function editGlbDocument(bytes: Buffer, edit: (document: any) => void) {
  const length = bytes.readUInt32LE(12),
    document = JSON.parse(
      bytes
        .subarray(20, 20 + length)
        .toString("utf8")
        .trim(),
    );
  edit(document);
  let text = Buffer.from(JSON.stringify(document));
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const chunk = Buffer.alloc(8);
  chunk.writeUInt32LE(text.length, 0);
  chunk.writeUInt32LE(0x4e4f534a, 4);
  const result = Buffer.concat([
    bytes.subarray(0, 12),
    chunk,
    text,
    bytes.subarray(20 + length),
  ]);
  result.writeUInt32LE(result.length, 8);
  return result;
}
test("HTTP transactions, duplicate requests, concurrency, branches and durable restart", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "actiscape-test-"));
  let server = await createApp({ dataDir: dir, logger: false });
  const req = (method: any, url: string, payload?: any) =>
    server.app.inject({ method, url, payload });
  try {
    const metadata = (await req("GET", "/api/catalog")).json();
    assert.equal(Object.keys(metadata.items).length, 266);
    assert.equal(metadata.freeMaterials.glass.op, 0.3);
    assert.ok(metadata.styleTypes.includes("armchair"));
    assert.ok(!metadata.styleTypes.includes("free"));
    assert.equal(typeof metadata.openingTypes.door.width, "number");
    const created = (
        await req("POST", "/api/projects", { document: fixture })
      ).json(),
      url = `/api/projects/${created.id}`,
      id = created.plan.furniture[0].id;
    const mutation = {
      operationId: "op-1",
      baseRevision: 0,
      commands: [
        { type: "update", collection: "furniture", id, patch: { x: 3333 } },
      ],
    };
    const first = await req("POST", `${url}/commands`, mutation);
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().project.revision, 1);
    assert.equal(
      (
        await req("POST", `${url}/commands`, {
          operationId: "missing-patch",
          baseRevision: 1,
          commands: [{ type: "update", collection: "furniture", id }],
        })
      ).statusCode,
      400,
    );
    const duplicate = (await req("POST", `${url}/commands`, mutation)).json();
    assert.equal(duplicate.replayed, true);
    assert.deepEqual(duplicate.project, first.json().project);
    assert.equal(
      (
        await req("POST", `${url}/commands`, {
          ...mutation,
          summary: "different",
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await req("POST", `${url}/commands`, {
          ...mutation,
          operationId: "stale",
        })
      ).json().details.currentRevision,
      1,
    );
    const bad = await req("POST", `${url}/commands`, {
      operationId: "bad",
      baseRevision: 1,
      commands: [
        { type: "update", collection: "furniture", id, patch: { x: 9999 } },
        { type: "delete", collection: "furniture", id: "missing" },
      ],
    });
    assert.equal(bad.statusCode, 404);
    assert.equal((await req("GET", url)).json().plan.furniture[0].x, 3333);
    server.store.db.exec(
      "CREATE TRIGGER fail_write BEFORE UPDATE ON projects BEGIN SELECT RAISE(ABORT, 'simulated disk write failure'); END",
    );
    const failedWrite = await req("POST", `${url}/commands`, {
      operationId: "write-failure",
      baseRevision: 1,
      commands: [{ type: "project", patch: { name: "must not commit" } }],
    });
    assert.equal(failedWrite.statusCode, 500);
    assert.equal((await req("GET", url)).json().revision, 1);
    assert.equal(
      (
        server.store.db
          .prepare("SELECT COUNT(*) AS n FROM operations WHERE id=?")
          .get("write-failure") as any
      )?.n,
      0,
    );
    server.store.db.exec("DROP TRIGGER fail_write");
    const race = await Promise.all(
      [2, 3].map((i) =>
        req("POST", `${url}/commands`, {
          operationId: `race-${i}`,
          baseRevision: 1,
          commands: [
            {
              type: "update",
              collection: "furniture",
              id,
              patch: { y: 2222 + i },
            },
          ],
        }),
      ),
    );
    assert.deepEqual(race.map((r) => r.statusCode).sort(), [200, 409]);
    await req("POST", `${url}/undo`, {
      operationId: "undo-1",
      baseRevision: 2,
    });
    await server.app.close();
    server = await createApp({ dataDir: dir, logger: false });
    const reopened = (await req("GET", url)).json();
    assert.equal(reopened.revision, 3);
    assert.equal(reopened.history.redo, 1);
    assert.equal(
      (
        await req("POST", `${url}/redo`, {
          operationId: "redo-1",
          baseRevision: 3,
        })
      ).json().project.revision,
      4,
    );
    await req("POST", `${url}/undo`, {
      operationId: "undo-2",
      baseRevision: 4,
    });
    await req("POST", `${url}/commands`, {
      operationId: "branch",
      baseRevision: 5,
      commands: [{ type: "project", patch: { name: "branch" } }],
    });
    assert.equal(
      (
        await req("POST", `${url}/redo`, {
          operationId: "redo-2",
          baseRevision: 6,
        })
      ).json().error,
      "NO_REDO",
    );
    const history = (await req("GET", `${url}/history`)).json();
    assert.equal(history.entries.length, 2);
    assert.equal(history.operations.length, 6);
    assert.equal((await req("GET", "/api/health")).json().ok, true);
    assert.ok(
      (await req("GET", "/api/openapi.json")).json().paths[
        "/api/projects/{id}/commands"
      ],
    );
  } finally {
    await server.app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("200 edit limit preserves cursor and operation audit", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "actiscape-history-")),
    store = new ProjectStore(dir);
  try {
    let project = store.create(blankPlan());
    for (let i = 0; i < 205; i++)
      project = store.mutate(project.id, "commands", {
        operationId: `e${i}`,
        baseRevision: project.revision,
        commands: [{ type: "project", patch: { name: `name ${i}` } }],
      }).project;
    assert.equal(project.history.undo, 200);
    assert.equal(store.history(project.id).operations.length, 205);
    for (let i = 0; i < 200; i++)
      project = store.mutate(project.id, "undo", {
        operationId: `u${i}`,
        baseRevision: project.revision,
      }).project;
    assert.equal(project.plan.name, "name 4");
    assert.equal(project.revision, 405);
    assert.throws(
      () =>
        store.mutate(project.id, "undo", {
          operationId: "overflow",
          baseRevision: 405,
        }),
      /撤销/,
    );
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("textured GLB is content-addressed, survives restart; missing assets and malformed uploads reject", async () => {
  const bytes = fs.readFileSync("fixtures/textured-vase.glb"),
    record = inspectGlb(bytes, "vase.glb");
  assert.ok(Math.abs(record.h - 400) < 0.01);
  assert.ok(Math.abs(record.w - 320) < 0.01);
  assert.throws(() => inspectGlb(Buffer.from("bad"), "bad.glb"), /完整/);
  assert.throws(
    () =>
      inspectGlb(
        editGlbDocument(bytes, (d) => {
          d.images[0].bufferView = 999;
        }),
        "missing-image.glb",
      ),
    /贴图缺少/,
  );
  assert.throws(
    () =>
      inspectGlb(
        editGlbDocument(bytes, (d) => {
          d.extensionsUsed = ["KHR_draco_mesh_compression"];
        }),
        "compressed.glb",
      ),
    /压缩/,
  );
  assert.throws(
    () =>
      inspectGlb(
        editGlbDocument(bytes, (d) => {
          d.buffers[0].uri = "external.bin";
        }),
        "external.glb",
      ),
    /嵌入/,
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "actiscape-assets-"));
  let store = new ProjectStore(dir);
  try {
    const glb = JSON.parse(
      fs.readFileSync("fixtures/glb-display.plan.json", "utf8"),
    );
    assert.throws(() => store.create(glb), /缺失/);
    store.saveAsset(record, bytes);
    const project = store.create(glb, { "fixture-vase": record.id });
    store.close();
    store = new ProjectStore(dir);
    assert.equal(store.get(project.id).assets[0], record.id);
    assert.deepEqual(fs.readFileSync(store.assetPath(record.id)), bytes);
    store.mutate(project.id, "commands", {
      operationId: newId(),
      baseRevision: 0,
      commands: [
        {
          type: "delete",
          collection: "furniture",
          id: "fixture-vase-instance",
        },
      ],
    });
    assert.deepEqual(fs.readFileSync(store.assetPath(record.id)), bytes);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("stopped data-directory backup restores the same scene, history cursor and asset bytes", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actiscape-backup-")),
    source = path.join(directory, "source"),
    backup = path.join(directory, "backup");
  let store = new ProjectStore(source);
  try {
    const bytes = fs.readFileSync("fixtures/textured-vase.glb"),
      asset = inspectGlb(bytes, "vase.glb");
    store.saveAsset(asset, bytes);
    let p = store.create(
      JSON.parse(fs.readFileSync("fixtures/glb-display.plan.json", "utf8")),
      { "fixture-vase": asset.id },
    );
    p = store.mutate(p.id, "commands", {
      operationId: "backup-edit",
      baseRevision: 0,
      commands: [{ type: "project", patch: { name: "before backup" } }],
    }).project;
    p = store.mutate(p.id, "undo", {
      operationId: "backup-undo",
      baseRevision: 1,
    }).project;
    store.close();
    fs.cpSync(source, backup, { recursive: true });
    store = new ProjectStore(backup);
    assert.deepEqual(store.get(p.id), p);
    assert.equal(store.get(p.id).history.redo, 1);
    assert.deepEqual(fs.readFileSync(store.assetPath(asset.id)), bytes);
    assert.equal(
      store.mutate(p.id, "redo", {
        operationId: "restored-redo",
        baseRevision: 2,
      }).project.plan.name,
      "before backup",
    );
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
