import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { launch, gpuInfo } from "../reference/upstream/scripts/browser.mjs";
const out = path.resolve("test-results/browser");
fs.mkdirSync(out, { recursive: true });
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actiscape-browser-")),
  base = "http://127.0.0.1:3117";
let server, browser;
const results = [],
  errors = [];
let gpu;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function start() {
  server = spawn(
    process.execPath,
    ["--import", "tsx", "apps/service/src/main.ts"],
    {
      env: { ...process.env, PORT: "3117", ACTISCAPE_DATA_DIR: directory },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout.on("data", () => {});
  server.stderr.on("data", (chunk) =>
    fs.appendFileSync(path.join(out, "service-errors.log"), chunk),
  );
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) return;
    } catch {}
    await delay(100);
  }
  throw Error("Service did not start");
}
async function stop() {
  if (server && server.exitCode === null) {
    const done = once(server, "exit");
    server.kill("SIGTERM");
    await done;
  }
}
async function json(url, body) {
  const r = await fetch(
    base + "/api" + url,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await r.json();
  if (!r.ok) throw Error(JSON.stringify(data));
  return data;
}
async function step(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, status: "passed", detail });
    console.log("PASS", name);
  } catch (e) {
    results.push({ name, status: "failed", error: e.stack });
    console.log("FAIL", name, e.message);
  }
}
try {
  await start();
  browser = await launch({
    gpu: false,
    viewport: { width: 1440, height: 900 },
  });
  let page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  gpu = await gpuInfo(page);
  const ready = async (p = page) => {
    await p.waitForFunction(
      () =>
        window.__actiscape?.project &&
        !__actiscape.busy &&
        document.querySelector("#save-state").textContent ===
          "已保存到项目服务",
      { timeout: 60000 },
    );
  };
  const current = () => page.evaluate(() => __actiscape.project);
  const change = async (selector, value) => {
    const rev = (await current()).revision;
    await page.$eval(
      selector,
      (el, value) => {
        if (el.type === "checkbox") el.checked = Boolean(value);
        else el.value = String(value);
        el.dispatchEvent(new Event("change", { bubbles: true }));
      },
      value,
    );
    await page.waitForFunction(
      (rev) => __actiscape.project.revision > rev && !__actiscape.busy,
      {},
      rev,
    );
    await ready();
  };
  const clickMutation = async (selector) => {
    const rev = (await current()).revision;
    await page.click(selector);
    await page.waitForFunction(
      (rev) => __actiscape.project.revision > rev && !__actiscape.busy,
      {},
      rev,
    );
    await ready();
  };
  await page.goto(base + "/?debug", { waitUntil: "load" });
  await ready();
  await step(
    "complete legacy snapshot loads with stable identity and data",
    async () => {
      const p = await current();
      assert.deepEqual(
        p.plan,
        JSON.parse(fs.readFileSync("fixtures/living-dining.plan.json")),
      );
      assert.equal(
        await page.evaluate(() => __actiscape.three.furniture.size),
        12,
      );
      await page.screenshot({ path: path.join(out, "01-plan.png") });
    },
  );
  await step(
    "real pointer select and drag, keyboard rotate, copy and independent cabinet editing",
    async () => {
      const p = await current(),
        f = p.plan.furniture.find((f) => f.key === "armchair"),
        at = await page.evaluate((f) => __actiscape.planView.screen(f), f);
      await page.mouse.click(at.x, at.y);
      assert.equal(
        await page.evaluate(() => __actiscape.planView.selection.id),
        f.id,
      );
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      await page.mouse.move(at.x - 40, at.y - 15, { steps: 5 });
      await page.mouse.up();
      await page.waitForFunction(
        (r) => __actiscape.project.revision > r && !__actiscape.busy,
        {},
        p.revision,
      );
      assert.notEqual(
        (await current()).plan.furniture.find((o) => o.id === f.id).x,
        f.x,
      );
      const rev = (await current()).revision;
      await page.keyboard.press("KeyR");
      await page.waitForFunction(
        (r) => __actiscape.project.revision > r && !__actiscape.busy,
        {},
        rev,
      );
      assert.equal(
        (await current()).plan.furniture.find((o) => o.id === f.id).rot,
        (f.rot + 90) % 360,
      );
      await clickMutation("#undo");
      await clickMutation("#undo");
      assert.deepEqual(
        (await current()).plan.furniture.find((o) => o.id === f.id),
        f,
      );
      const cab = (await current()).plan.furniture.find((f) => f.cab);
      await page.evaluate(
        (id) => __actiscape.select({ collection: "furniture", id }),
        cab.id,
      );
      await change('[data-field="col:0"]', "drawer");
      await clickMutation('[data-action="duplicate"]');
      const copy = (await current()).plan.furniture.at(-1);
      await page.evaluate(
        (id) => __actiscape.select({ collection: "furniture", id }),
        copy.id,
      );
      await change('[data-field="col:0"]', "hang");
      assert.equal(
        (await current()).plan.furniture.find((f) => f.id === cab.id).cab
          .cols[0],
        "drawer",
      );
    },
  );
  await step(
    "a drag keeps its starting revision when a tool changes the scene mid-gesture",
    async () => {
      const p = await current(),
        f = p.plan.furniture.find((f) => f.key === "armchair"),
        at = await page.evaluate((f) => __actiscape.planView.screen(f), f);
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      const remote = (
        await json(`/projects/${p.id}/commands`, {
          operationId: crypto.randomUUID(),
          baseRevision: p.revision,
          summary: "拖动期间的外部修改",
          commands: [
            {
              type: "update",
              collection: "furniture",
              id: f.id,
              patch: { x: f.x + 120, rot: f.rot + 15 },
            },
          ],
        })
      ).project;
      await page.waitForFunction(
        (rev) => __actiscape.project.revision === rev,
        {},
        remote.revision,
      );
      await page.mouse.move(at.x + 30, at.y + 15, { steps: 4 });
      await page.mouse.up();
      await page.waitForFunction(
        () =>
          !__actiscape.busy &&
          document.querySelector("#save-state").textContent === "操作未完成",
      );
      assert.equal((await current()).revision, remote.revision);
      assert.deepEqual(
        (await current()).plan.furniture.find((o) => o.id === f.id),
        remote.plan.furniture.find((o) => o.id === f.id),
      );
    },
  );
  await step(
    "free form UI, parameter editing, outline vertex drag and array",
    async () => {
      const f = (await current()).plan.furniture.find((f) => f.type === "free");
      await page.evaluate(
        (id) => __actiscape.select({ collection: "furniture", id }),
        f.id,
      );
      await change('[data-field="opt.shape"]', "extrude");
      await change('[data-field="h"]', 650);
      await change('[data-field="opt.mat"]', "glass");
      assert.equal(
        await page.$eval('[data-field="opt.op"]', (el) => Number(el.value)),
        0.3,
      );
      const opacities = await page.evaluate((id) => {
        const values = [];
        __actiscape.three.furniture.get(id).traverse((o) => {
          if (o.isMesh)
            for (const material of Array.isArray(o.material)
              ? o.material
              : [o.material])
              values.push(material.opacity);
        });
        return values;
      }, f.id);
      assert.ok(opacities.length > 0);
      assert.ok(opacities.every((value) => value === 0.3));
      const p = await current(),
        free = p.plan.furniture.find((o) => o.id === f.id),
        at = await page.evaluate(
          (f) =>
            __actiscape.planView.screen({ x: f.x - f.w / 2, y: f.y - f.d / 2 }),
          free,
        );
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      await page.mouse.move(at.x - 15, at.y - 10, { steps: 4 });
      await page.mouse.up();
      await page.waitForFunction(
        (r) => __actiscape.project.revision > r && !__actiscape.busy,
        {},
        p.revision,
      );
      assert.ok(
        (await current()).plan.furniture.find((o) => o.id === f.id).opt.outline,
      );
      await page.evaluate(
        (id) => __actiscape.select({ collection: "furniture", id }),
        f.id,
      );
      await clickMutation("#make-array");
      assert.equal(
        (await current()).plan.furniture.filter((o) => o.type === "free")
          .length,
        3,
      );
    },
  );
  await step(
    "kitchen shape, per-run wall cabinets, room surfaces and custom tiles use real controls",
    async () => {
      await page.type("#catalog-search", "uCounter");
      await clickMutation('[data-key="uCounter"]');
      await change('[data-field="kit.shape"]', "L");
      await change('[data-field="kit.sink.bowls"]', 2);
      await change('[data-field="wallLeg:1"]', false);
      const kitchen = (await current()).plan.furniture.at(-1);
      assert.equal(kitchen.kit.shape, "L");
      assert.equal(kitchen.kit.sink.bowls, 2);
      assert.deepEqual(kitchen.kit.wallLegs, [0]);
      const room = (await current()).plan.rooms[0];
      await page.evaluate(
        (id) => __actiscape.select({ collection: "rooms", id }),
        room.id,
      );
      await change('[data-field="mat"]', "marble");
      await change('[data-field="wallMat"]', "latexSage");
      await change('[data-field="customTile"]', true);
      await change('[data-field="tile.pattern"]', "checker");
      await change('[data-field="tile.w"]', 800);
      await change('[data-field="ceil.type"]', "edge");
      await change('[data-field="ceil.drop"]', 200);
      assert.equal((await current()).plan.rooms[0].tile.pattern, "checker");
    },
  );
  await step(
    "wall drawing, opening placement and structural updates commit atomically",
    async () => {
      await page.click('[data-tool="wall"]');
      const points = await page.evaluate(() =>
        [
          { x: 5200, y: 800 },
          { x: 5200, y: 4000 },
        ].map((p) => __actiscape.planView.screen(p)),
      );
      const rev = (await current()).revision;
      await page.mouse.click(points[0].x, points[0].y);
      await page.mouse.click(points[1].x, points[1].y);
      await page.waitForFunction(
        (r) => __actiscape.project.revision > r && !__actiscape.busy,
        {},
        rev,
      );
      assert.equal((await current()).plan.walls.length, 5);
      await page.click('[data-tool="opening:door"]');
      const at = await page.evaluate(() =>
          __actiscape.planView.screen({ x: 5200, y: 2500 }),
        ),
        r = (await current()).revision;
      await page.mouse.click(at.x, at.y);
      await page.waitForFunction(
        (r) => __actiscape.project.revision > r && !__actiscape.busy,
        {},
        r,
      );
      assert.equal((await current()).plan.openings.length, 3);
      await page.click('[data-tool="select"]');
    },
  );
  await step(
    "upload textured GLB using file input; transform, save and fresh browser context restore",
    async () => {
      const input = await page.$("#glb-file");
      const rev = (await current()).revision;
      await input.uploadFile(path.resolve("fixtures/textured-vase.glb"));
      await page.waitForFunction(
        (r) => __actiscape.project.revision > r && !__actiscape.busy,
        {},
        rev,
      );
      await ready();
      await change('[data-field="rot"]', 35);
      await change('[data-field="z"]', 700);
      await change('[data-field="w"]', 500);
      const p = await current(),
        f = p.plan.furniture.find((f) => f.type === "model");
      assert.ok(f);
      const meshes = await page.evaluate((id) => {
        let meshes = 0,
          textures = 0,
          mapped = 0;
        __actiscape.three.furniture.get(id).traverse((o) => {
          if (o.isMesh) {
            meshes++;
            if (o.material.map) textures++;
            if (o.userData.fid === id && o.userData.collection === "furniture")
              mapped++;
          }
        });
        return { meshes, textures, mapped };
      }, f.id);
      assert.ok(meshes.textures > 0);
      assert.equal(meshes.mapped, meshes.meshes);
      const context = await browser.createBrowserContext(),
        fresh = await context.newPage();
      await fresh.goto(base + "/?debug&project=" + p.id, { waitUntil: "load" });
      await ready(fresh);
      assert.deepEqual(
        await fresh.evaluate(() => __actiscape.project.plan),
        p.plan,
      );
      assert.ok(
        await fresh.evaluate((id) => {
          let textures = 0;
          __actiscape.three.furniture.get(id).traverse((o) => {
            if (o.isMesh && o.material.map) textures++;
          });
          return textures;
        }, f.id),
      );
      await context.close();
    },
  );
  await step(
    "external API edits are reflected through SSE and browser reload preserves undo/redo",
    async () => {
      const p = await current(),
        f = p.plan.furniture.find((f) => f.type === "model");
      await json(`/projects/${p.id}/commands`, {
        operationId: crypto.randomUUID(),
        baseRevision: p.revision,
        summary: "工具移动花瓶",
        commands: [
          {
            type: "update",
            collection: "furniture",
            id: f.id,
            patch: { x: f.x + 100 },
          },
        ],
      });
      await page.waitForFunction(
        (r) => __actiscape.project.revision > r,
        {},
        p.revision,
      );
      await ready();
      assert.equal(
        (await current()).plan.furniture.find((o) => o.id === f.id).x,
        f.x + 100,
      );
      await page.reload({ waitUntil: "load" });
      await ready();
      await clickMutation("#undo");
      assert.equal(
        (await current()).plan.furniture.find((o) => o.id === f.id).x,
        f.x,
      );
      await clickMutation("#redo");
      assert.equal(
        (await current()).plan.furniture.find((o) => o.id === f.id).x,
        f.x + 100,
      );
    },
  );
  await step(
    "two browser pages compete without silently overwriting and converge through SSE",
    async () => {
      const p = await current(),
        context = await browser.createBrowserContext(),
        other = await context.newPage();
      try {
        await other.evaluateOnNewDocument(
          (id) => localStorage.setItem("actiscape-project", id),
          p.id,
        );
        await other.goto(base + "/?debug", { waitUntil: "load" });
        await ready(other);
        const request = async (target, name) =>
          target.evaluate(
            async ({ id, revision, name }) => {
              const response = await fetch(`/api/projects/${id}/commands`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  operationId: crypto.randomUUID(),
                  baseRevision: revision,
                  summary: "两个页面竞争",
                  commands: [{ type: "project", patch: { name } }],
                }),
              });
              return response.status;
            },
            { id: p.id, revision: p.revision, name },
          );
        const status = await Promise.all([
          request(page, "page one"),
          request(other, "page two"),
        ]);
        assert.deepEqual(status.sort(), [200, 409]);
        for (const target of [page, other])
          await target.waitForFunction(
            (r) => __actiscape.project.revision === r + 1,
            {},
            p.revision,
          );
        assert.deepEqual(
          await other.evaluate(() => __actiscape.project.plan),
          (await current()).plan,
        );
      } finally {
        await context.close();
      }
    },
  );
  await step("service restart retains history and assets", async () => {
    const before = await current();
    await stop();
    await start();
    await page.reload({ waitUntil: "load" });
    await ready();
    assert.deepEqual((await current()).plan, before.plan);
    assert.deepEqual((await current()).history, before.history);
    await clickMutation("#undo");
    await clickMutation("#redo");
    assert.deepEqual((await current()).plan, before.plan);
  });
  await step(
    "split and 3D views, selection mapping, walkthrough movement, turn and exit",
    async () => {
      await page.click('[data-view="split"]');
      await delay(500);
      await page.screenshot({ path: path.join(out, "02-split.png") });
      await page.click('[data-view="3d"]');
      await delay(300);
      await page.screenshot({ path: path.join(out, "03-three.png") });
      await page.click("#walk");
      assert.equal(await page.evaluate(() => __actiscape.three.walking), true);
      const before = await page.evaluate(() =>
        __actiscape.three.camera.position.toArray(),
      );
      await page.keyboard.down("KeyW");
      await delay(400);
      await page.keyboard.up("KeyW");
      const after = await page.evaluate(() =>
        __actiscape.three.camera.position.toArray(),
      );
      assert.notDeepEqual(after, before);
      const yaw = await page.evaluate(() => __actiscape.three.yaw);
      await page.keyboard.down("ArrowLeft");
      await page.waitForFunction(
        (yaw) => __actiscape.three.yaw !== yaw,
        {},
        yaw,
      );
      await page.keyboard.up("ArrowLeft");
      await page.keyboard.press("Escape");
      assert.equal(await page.evaluate(() => __actiscape.three.walking), false);
    },
  );
  await step(
    "3D pointer selects the visible object and commits one drag transaction",
    async () => {
      const p = await current(),
        f = p.plan.furniture.find((f) => f.key === "sofa");
      const at = await page.evaluate((id) => {
        const D = __actiscape,
          T = D.THREE,
          view = D.three,
          box = new T.Box3().setFromObject(view.furniture.get(id)),
          center = box.getCenter(new T.Vector3());
        view.camera.position.set(center.x, 14, center.z + 0.01);
        view.controls.target.copy(center);
        view.controls.update();
        view.camera.updateMatrixWorld();
        const v = center.clone().project(view.camera),
          r = view.renderer.domElement.getBoundingClientRect();
        return {
          x: r.left + ((v.x + 1) * r.width) / 2,
          y: r.top + ((1 - v.y) * r.height) / 2,
        };
      }, f.id);
      await page.mouse.click(at.x, at.y);
      assert.equal(
        await page.evaluate(() => __actiscape.planView.selection.id),
        f.id,
      );
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      await page.mouse.move(at.x + 35, at.y + 18, { steps: 5 });
      await page.mouse.up();
      await page.waitForFunction(
        (r) => __actiscape.project.revision > r && !__actiscape.busy,
        {},
        p.revision,
      );
      const after = await current();
      assert.equal(after.revision, p.revision + 1);
      assert.notEqual(after.plan.furniture.find((o) => o.id === f.id).x, f.x);
      assert.deepEqual(
        after.plan.furniture.filter((o) => o.id !== f.id),
        p.plan.furniture.filter((o) => o.id !== f.id),
      );
      await clickMutation("#undo");
    },
  );
  await step(
    "all 266 catalogue items generate finite geometry and render in real WebGL and Canvas2D",
    async () => {
      const keys = await page.evaluate(() => Object.keys(__actiscape.catalog)),
        all = [];
      for (let offset = 0; offset < keys.length; offset += 12) {
        const batch = await page.evaluate(
          ({ keys, base }) => {
            const D = __actiscape,
              T = D.THREE,
              out = [],
              canvas = document.createElement("canvas");
            canvas.width = 200;
            canvas.height = 200;
            const ctx = canvas.getContext("2d");
            const items = keys.map((key, i) =>
              D.createFurniture(
                key,
                1000 + (i % 4) * 2000,
                1000 + Math.floor(i / 4) * 2000,
              ),
            );
            for (const [index, key] of keys.entries()) {
              const f = items[index],
                g = D.buildFurniture(f, { ...base, furniture: items }),
                box = new T.Box3().setFromObject(g, true);
              let meshes = 0,
                vertices = 0;
              g.traverse((o) => {
                if (o.isMesh) {
                  meshes++;
                  vertices += o.geometry.attributes.position.count;
                }
              });
              const dimensions = box.getSize(new T.Vector3()).toArray();
              if (
                !meshes ||
                !vertices ||
                dimensions.some((v) => !Number.isFinite(v) || v <= 0)
              )
                throw Error(key + " invalid geometry");
              const scene = new T.Scene();
              scene.add(new T.HemisphereLight(0xffffff, 0xaaaaaa, 3), g);
              const camera = new T.PerspectiveCamera(45, 1, 0.001, 100),
                center = box.getCenter(new T.Vector3()),
                size = Math.max(...dimensions);
              camera.position
                .copy(center)
                .add(new T.Vector3(size * 1.7, size * 1.4, size * 1.7));
              camera.lookAt(center);
              D.three.renderer.render(scene, camera);
              if (
                D.three.renderer.getContext().isContextLost() ||
                D.three.renderer.info.render.calls < 1
              )
                throw Error(key + " did not complete a WebGL draw");
              ctx.setTransform(1, 0, 0, 1, 100, 100);
              const scale = 160 / Math.max(f.w, f.d);
              ctx.scale(scale, scale);
              D.drawFurniture(ctx, f, 1 / scale);
              out.push({ key, meshes, vertices, bounds: dimensions });
            }
            return out;
          },
          {
            keys: keys.slice(offset, offset + 12),
            base: JSON.parse(
              fs.readFileSync("fixtures/living-dining.plan.json", "utf8"),
            ),
          },
        );
        all.push(...batch);
      }
      fs.writeFileSync(
        path.join(out, "catalog-geometry.json"),
        JSON.stringify(all, null, 2),
      );
      assert.equal(all.length, 266);
      return { count: all.length };
    },
  );
  await step(
    "missing GLB mapping and unsupported multi-floor imports have explicit outcomes",
    async () => {
      await (
        await page.$("#json-file")
      ).uploadFile(path.resolve("fixtures/glb-display.plan.json"));
      await page.waitForSelector('[data-missing="0"]');
      await (
        await page.$('[data-missing="0"]')
      ).uploadFile(path.resolve("fixtures/textured-vase.glb"));
      await page.click("#confirm-mapping");
      await page.waitForFunction(() => !document.querySelector("#dialog").open);
      await ready();
      const p = await current();
      assert.equal(
        p.plan.furniture.find((f) => f.id === "fixture-vase-instance").type,
        "model",
      );
      assert.equal(p.assets.length, 1);
      const rawColors = () =>
        page.evaluate(() => {
          const colors = [];
          __actiscape.three.furniture
            .get("fixture-vase-instance")
            .traverse((o) => {
              if (o.isMesh && o.material.map)
                colors.push(o.material.color.getHexString());
            });
          return colors;
        });
      assert.equal(
        p.plan.furniture.find((f) => f.id === "fixture-vase-instance").color,
        "#d9d4cc",
      );
      assert.deepEqual(await rawColors(), ["ffffff"]);
      await page.evaluate(() =>
        __actiscape.select({
          collection: "furniture",
          id: "fixture-vase-instance",
        }),
      );
      await change('[data-field="color"]', "#ff0000");
      assert.deepEqual(await rawColors(), ["ff0000"]);
      await clickMutation("#undo");
      assert.deepEqual(await rawColors(), ["ffffff"]);
      const unsupported = path.join(out, "unsupported-multifloor.json");
      fs.writeFileSync(
        unsupported,
        JSON.stringify({
          version: 3,
          floors: [{ plan: p.plan }, { plan: p.plan }],
        }),
      );
      await (await page.$("#json-file")).uploadFile(unsupported);
      await page.waitForFunction(
        () =>
          document.querySelector("#save-state").textContent === "操作未完成",
      );
      assert.equal((await current()).id, p.id);
      assert.match(await page.$eval("#message", (e) => e.textContent), /单层/);
    },
  );
  await step(
    "failed network save keeps the last committed scene and shows no success",
    async () => {
      const p = await current(),
        f = p.plan.furniture.find((f) => f.key === "sofa");
      await page.evaluate(
        (id) => __actiscape.select({ collection: "furniture", id }),
        f.id,
      );
      await page.setRequestInterception(true);
      const handler = (request) => {
        if (request.method() === "POST" && request.url().endsWith("/commands"))
          void request.abort("failed");
        else void request.continue();
      };
      page.on("request", handler);
      await page.$eval('[data-field="w"]', (el) => {
        el.value = "3000";
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.waitForFunction(
        () =>
          !__actiscape.busy &&
          document.querySelector("#save-state").textContent === "操作未完成",
      );
      assert.deepEqual((await current()).plan, p.plan);
      assert.equal((await json("/projects/" + p.id)).revision, p.revision);
      page.off("request", handler);
      await page.setRequestInterception(false);
    },
  );
  await step("no uncaught browser errors", () => assert.deepEqual(errors, []));
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(
      { browser: await browser.version(), gpu, results, errors },
      null,
      2,
    ),
  );
} finally {
  if (browser) await browser.close();
  await stop();
  fs.rmSync(directory, { recursive: true, force: true });
}
if (results.some((r) => r.status === "failed")) process.exitCode = 1;
