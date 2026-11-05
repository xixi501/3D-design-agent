import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import {
  launch,
  setDownloadDir,
} from "../reference/upstream/scripts/browser.mjs";
const out = path.resolve("test-results/baseline");
fs.mkdirSync(out, { recursive: true });
const browser = await launch({
    gpu: false,
    viewport: { width: 1440, height: 900 },
  }),
  page = await browser.newPage(),
  results = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.stack || e.message));
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
const base = JSON.parse(
  fs.readFileSync("fixtures/living-dining.plan.json", "utf8"),
);
try {
  await setDownloadDir(browser, page, out);
  await page.goto(
    pathToFileURL(path.resolve("reference/runtime/living-dining.html")).href +
      "?debug",
    { waitUntil: "load" },
  );
  await page.waitForFunction(() => window.__designer);
  await page.evaluate((p) => __designer.replacePlan(p), base);
  await page.evaluate(() => __designer.setView("3d"));
  await step(
    "entire original catalogue generates real geometry and finite bounds",
    async () => {
      const keys = await page.evaluate(() => Object.keys(__designer.CAT)),
        all = [];
      for (let offset = 0; offset < keys.length; offset += 12) {
        const batch = keys.slice(offset, offset + 12);
        await page.evaluate(
          ({ keys, base }) => {
            const p = structuredClone(base);
            p.furniture = keys.map((key, i) =>
              __designer.makeFurn(
                key,
                1000 + (i % 4) * 2000,
                1000 + Math.floor(i / 4) * 2000,
              ),
            );
            __designer.replacePlan(p);
          },
          { keys: batch, base },
        );
        await page.waitForFunction(
          () => {
            const D = __designer,
              map = D.S3.sceneRefs().furnMap;
            return D.app.plan.furniture.every((f) => map.has(f.id));
          },
          { timeout: 60000 },
        );
        const records = await page.evaluate(() =>
          __designer.app.plan.furniture.map((f) => {
            const g = __designer.S3.sceneRefs().furnMap.get(f.id).g;
            g.updateWorldMatrix(true, true);
            const inverse = g.matrixWorld.clone().invert(),
              min = [Infinity, Infinity, Infinity],
              max = [-Infinity, -Infinity, -Infinity];
            let meshes = 0,
              vertices = 0;
            g.traverse((o) => {
              if (!o.isMesh) return;
              for (
                let ancestor = o;
                ancestor && ancestor !== g;
                ancestor = ancestor.parent
              )
                if (ancestor.visible === false) return;
              meshes++;
              const p = o.geometry.attributes.position;
              vertices += p.count;
              const matrix = inverse.clone().multiply(o.matrixWorld);
              for (let i = 0; i < p.count; i++) {
                const v = g.position
                  .clone()
                  .set(p.getX(i), p.getY(i), p.getZ(i))
                  .applyMatrix4(matrix);
                [v.x, v.y, v.z].forEach((x, j) => {
                  min[j] = Math.min(min[j], x);
                  max[j] = Math.max(max[j], x);
                });
              }
            });
            return {
              key: f.key,
              meshes,
              vertices,
              bounds: max.map((x, i) => x - min[i]),
            };
          }),
        );
        for (const r of records) {
          assert.ok(r.meshes > 0, r.key);
          assert.ok(
            r.bounds.every((v) => Number.isFinite(v) && v > 0),
            r.key,
          );
        }
        all.push(...records);
      }
      assert.equal(all.length, 266);
      fs.writeFileSync(
        path.join(out, "catalog-geometry.json"),
        JSON.stringify(all, null, 2),
      );
      return { count: all.length, freeShapeFamilies: 17 };
    },
  );
  await step(
    "all 17 free forms and customized cabinets render from fixed gallery",
    async () => {
      const gallery = JSON.parse(
        fs.readFileSync("fixtures/modeling-gallery.plan.json", "utf8"),
      );
      await page.evaluate((p) => __designer.replacePlan(p), gallery);
      await page.waitForFunction(
        () =>
          __designer.S3.sceneRefs().furnMap.size ===
          __designer.app.plan.furniture.length,
        { timeout: 60000 },
      );
      assert.equal(
        await page.evaluate(
          () =>
            new Set(
              __designer.app.plan.furniture
                .filter((f) => f.type === "free")
                .map((f) => f.opt.shape),
            ).size,
        ),
        17,
      );
      await page.screenshot({
        path: path.join(out, "03-modeling-gallery.png"),
      });
    },
  );
  await step(
    "original cabinet columns and free-form parameters edited through actual UI",
    async () => {
      await page.evaluate((p) => __designer.replacePlan(p), base);
      await page.evaluate(() => {
        const f = __designer.app.plan.furniture.find((f) => f.cab);
        __designer.select("furn", f.id);
      });
      await page.waitForSelector("#mc0");
      await page.select("#mc0", "drawer");
      assert.equal(
        await page.evaluate(
          () => __designer.app.plan.furniture.find((f) => f.cab).cab.cols[0],
        ),
        "drawer",
      );
      await page.evaluate(() =>
        __designer.select(
          "furn",
          __designer.app.plan.furniture.find((f) => f.type === "free").id,
        ),
      );
      await page.select("#frShape", "arcWall");
      await page.waitForSelector("#frArc");
      await page.$eval("#frArc", (el) => {
        el.value = "135";
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
      assert.equal(
        await page.evaluate(
          () =>
            __designer.app.plan.furniture.find((f) => f.type === "free").opt
              .arc,
        ),
        135,
      );
    },
  );
  await step(
    "original structural properties and opening types edited through actual controls",
    async () => {
      await page.evaluate(() => {
        const D = __designer;
        D.app.plan.phase = "original";
        D.commit();
        D.select("wall", D.app.plan.walls[0].id);
      });
      await page.waitForSelector("#wT");
      await page.$eval("#wT", (input) => {
        input.value = "220";
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      assert.equal(
        await page.evaluate(() => __designer.app.plan.walls[0].t),
        220,
      );
      await page.evaluate(() =>
        __designer.select("opening", __designer.app.plan.openings[0].id),
      );
      await page.select("#oType", "slideWindow");
      assert.equal(
        await page.evaluate(() => __designer.app.plan.openings[0].type),
        "slideWindow",
      );
      await page.evaluate(() =>
        __designer.select("node", __designer.app.plan.nodes[0].id),
      );
      await page.$eval('input[data-k="x"]', (input) => {
        input.value = "-100";
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      assert.equal(
        await page.evaluate(() => __designer.app.plan.nodes[0].x),
        -100,
      );
      return { wallThickness: 220, openingType: "slideWindow", nodeX: -100 };
    },
  );
  await step(
    "original textured GLB import and local save/reload retain model and material",
    async () => {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find(
          (b) => b.textContent.trim() === "家具",
        );
        if (b) b.click();
      });
      await page.waitForSelector("#glbFile");
      await (
        await page.$("#glbFile")
      ).uploadFile(path.resolve("fixtures/textured-vase.glb"));
      await page.waitForFunction(
        () => Object.values(__designer.CAT).some((f) => f.type === "model"),
        { timeout: 60000 },
      );
      await page.evaluate(() => {
        const key = Object.keys(__designer.CAT).find(
          (k) => __designer.CAT[k].type === "model",
        );
        __designer.app.plan.furniture.push(
          __designer.makeFurn(key, 2200, 2200, 35, { z: 700 }),
        );
        __designer.commit();
      });
      await page.waitForFunction(
        () => {
          const f = __designer.app.plan.furniture.find(
              (f) => f.type === "model",
            ),
            g = __designer.S3.sceneRefs().furnMap.get(f?.id)?.g;
          let n = 0;
          g?.traverse((o) => {
            if (o.isMesh && o.material.map) n++;
          });
          return n > 0;
        },
        { timeout: 60000 },
      );
      const p = await page.evaluate(() => structuredClone(__designer.app.plan));
      fs.writeFileSync(
        path.join(out, "original-glb-project.json"),
        JSON.stringify(p, null, 2),
      );
      await page.screenshot({ path: path.join(out, "04-textured-glb.png") });
      await page.click("#saveBtn");
      await page.reload({ waitUntil: "load" });
      await page.waitForFunction(() => window.__designer);
      assert.deepEqual(await page.evaluate(() => __designer.app.plan), p);
      await page.evaluate(() => __designer.setView("3d"));
      await page.waitForFunction(
        () => {
          const f = __designer.app.plan.furniture.find(
              (f) => f.type === "model",
            ),
            g = __designer.S3.sceneRefs().furnMap.get(f?.id)?.g;
          let n = 0;
          g?.traverse((o) => {
            if (o.isMesh && o.material.map) n++;
          });
          return n > 0;
        },
        { timeout: 60000 },
      );
      return { modelBytesInProjectJson: false, modelStore: "IndexedDB" };
    },
  );
  await step(
    "original undo history does not survive page reload (documented original limitation)",
    async () => {
      assert.equal(await page.evaluate(() => __designer.undo()), false);
      return {
        classification: "original-defect",
        newRequirement: "persistent history",
      };
    },
  );
  await step("no uncaught original errors in executed coverage", () =>
    assert.deepEqual(errors, []),
  );
} finally {
  fs.writeFileSync(
    path.join(out, "extended-report.json"),
    JSON.stringify({ results, errors }, null, 2),
  );
  await browser.close();
}
if (results.some((r) => r.status === "failed")) process.exitCode = 1;
