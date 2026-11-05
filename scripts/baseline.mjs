import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import {
  launch,
  gpuInfo,
  setDownloadDir,
} from "../reference/upstream/scripts/browser.mjs";
const out = path.resolve("test-results/baseline");
fs.mkdirSync(out, { recursive: true });
const browser = await launch({
  gpu: false,
  viewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const results = [];
async function step(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, status: "passed", detail });
    console.log("PASS", name);
  } catch (e) {
    results.push({ name, status: "failed", error: String(e.stack || e) });
    console.log("FAIL", name, String(e));
  }
}
try {
  const gpu = await gpuInfo(page);
  console.log("Renderer", gpu.renderer);
  await setDownloadDir(browser, page, out);
  await page.goto(
    pathToFileURL(path.resolve("reference/runtime/living-dining.html")).href +
      "?debug",
    { waitUntil: "load" },
  );
  await page.waitForFunction(() => window.__designer, { timeout: 60000 });
  if (fs.existsSync("fixtures/living-dining.plan.json"))
    await page.evaluate(
      (p) => __designer.replacePlan(p),
      JSON.parse(fs.readFileSync("fixtures/living-dining.plan.json", "utf8")),
    );
  await step("load structured single-floor scene", async () => {
    const p = await page.evaluate(() => structuredClone(__designer.app.plan));
    assert.equal(p.furniture.length, 12);
    assert.equal(p.walls.length, 4);
    assert.equal(p.openings.length, 2);
    if (!fs.existsSync("fixtures/living-dining.plan.json"))
      fs.writeFileSync(
        "fixtures/living-dining.plan.json",
        JSON.stringify(p, null, 2) + "\n",
      );
    const catalog = await page.evaluate(() => __designer.CAT);
    fs.writeFileSync(
      "fixtures/catalog.json",
      JSON.stringify(catalog, null, 2) + "\n",
    );
    await page.screenshot({ path: path.join(out, "01-plan.png") });
    return {
      furniture: p.furniture.length,
      catalog: Object.keys(catalog).length,
    };
  });
  await step("real pointer selection, drag, rotate and undo", async () => {
    const f = await page.evaluate(() =>
      __designer.app.plan.furniture.find((f) => f.key === "armchair"),
    );
    const at = await page.evaluate((f) => {
      const v = __designer.view,
        r = document.querySelector("#c2d").getBoundingClientRect();
      return { x: r.x + f.x * v.s + v.ox, y: r.y + f.y * v.s + v.oy };
    }, f);
    await page.mouse.click(at.x, at.y);
    assert.equal(await page.evaluate(() => __designer.app.sel.id), f.id);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x - 30, at.y - 10, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.press("KeyR");
    const after = await page.evaluate(
      (id) => __designer.app.plan.furniture.find((f) => f.id === id),
      f.id,
    );
    assert.notEqual(after.rot, f.rot);
    assert.notEqual(after.x, f.x);
    await page.click("#undoBtn");
    await page.click("#undoBtn");
    const restored = await page.evaluate(
      (id) => __designer.app.plan.furniture.find((f) => f.id === id),
      f.id,
    );
    assert.deepEqual(restored, f);
  });
  await step(
    "cabinet and free shape parameters survive undo and redo",
    async () => {
      const value = await page.evaluate(() => {
        const D = __designer,
          p = D.app.plan,
          c = p.furniture.find((f) => f.cab),
          free = p.furniture.find((f) => f.type === "free");
        if (!c || !free)
          throw Error("Fixture must contain cabinet and free shape");
        const before = JSON.stringify(p);
        c.cab.cols = ["open", "drawer", "door"];
        free.opt = {
          ...free.opt,
          shape: "extrude",
          outline: "-400,-250|400,-250|300,250|-400,250",
        };
        D.commit();
        const changed = JSON.stringify(p);
        D.undo();
        const undo = JSON.stringify(D.app.plan);
        document.querySelector("#redoBtn").click();
        return { before, changed, undo, redo: JSON.stringify(D.app.plan) };
      });
      assert.equal(value.before, value.undo);
      assert.equal(value.changed, value.redo);
    },
  );
  await step("3D scene and real geometry", async () => {
    await page.evaluate(async () => {
      await __designer.setView("3d");
    });
    await page.waitForFunction(
      () =>
        __designer.S3.sceneRefs().furnMap.size ===
        __designer.app.plan.furniture.length,
      { timeout: 60000 },
    );
    const count = await page.evaluate(() => {
      const bad = [];
      for (const f of __designer.app.plan.furniture) {
        const entry = __designer.S3.sceneRefs().furnMap.get(f.id);
        let n = 0;
        entry?.g.traverse((o) => {
          if (o.isMesh) n++;
        });
        if (!n) bad.push(f.key);
      }
      return bad;
    });
    assert.deepEqual(count, []);
    await page.screenshot({ path: path.join(out, "02-three.png") });
  });
  await step("save and reload complete scene equality", async () => {
    const before = await page.evaluate(() =>
      JSON.stringify(__designer.app.plan),
    );
    await page.click("#saveBtn");
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => window.__designer, { timeout: 60000 });
    const after = await page.evaluate(() =>
      JSON.stringify(__designer.app.plan),
    );
    assert.equal(after, before);
  });
  await step(
    "runtime catalogue and all 17 free-shape families are present",
    async () => {
      const r = await page.evaluate(() => {
        const values = Object.values(__designer.CAT);
        return {
          count: values.length,
          shapes: [
            ...new Set(
              values.filter((f) => f.type === "free").map((f) => f.opt.shape),
            ),
          ].sort(),
        };
      });
      assert.equal(r.shapes.length, 17);
      return r;
    },
  );
  await step("no uncaught page errors", async () =>
    assert.deepEqual(errors, []),
  );
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(
      {
        upstream: "b94183f9ce2215db9a178da89a90d2ecefb18497",
        browser: await browser.version(),
        gpu,
        results,
        errors,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
}
if (results.some((r) => r.status === "failed")) process.exitCode = 1;
