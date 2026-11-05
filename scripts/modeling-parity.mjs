import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createApp } from "../apps/service/src/app.ts";
import {
  catalog,
  createFurniture,
  freeShapes,
  clone,
} from "../packages/scene-core/src/index.ts";
import { launch } from "../reference/upstream/scripts/browser.mjs";
const out = path.resolve("test-results/parity");
fs.mkdirSync(out, { recursive: true });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "actiscape-parity-"));
const { app } = await createApp({
  dataDir: dir,
  staticDir: path.resolve("dist/editor"),
  logger: false,
});
await app.listen({ port: 0, host: "127.0.0.1" });
const address = app.server.address();
const browser = await launch({
    gpu: false,
    viewport: { width: 1280, height: 800 },
  }),
  original = await browser.newPage(),
  editor = await browser.newPage(),
  results = [];
const base = JSON.parse(
  fs.readFileSync("fixtures/living-dining.plan.json", "utf8"),
);
const cases = Object.keys(freeShapes).map((shape) => {
  const key = Object.values(catalog).find(
    (f) => f.type === "free" && f.opt.shape === shape,
  ).key;
  return {
    name: `free-${shape}`,
    key,
    overrides: {
      w: 1000,
      d: 800,
      h: 1100,
      opt: {
        shape,
        mat: "wood",
        rx: 12,
        ry: -8,
        r: 20,
        t: 80,
        arc: 135,
        n: 7,
        sw: 35,
        preset: "vase",
        outline: "-500,-400|500,-400|500,0|0,0|0,400|-500,400",
      },
    },
  };
});
cases.push(
  {
    name: "cabinet-all-columns",
    key: "cabTall",
    overrides: {
      w: 4000,
      d: 600,
      h: 2400,
      cab: {
        kind: "tall",
        door: "swing",
        handle: "knob",
        cols: [
          "door",
          "drawer",
          "open",
          "hang",
          "hangOpen",
          "glass",
          "niche",
          "mixed",
        ],
        top: 400,
        plinth: 100,
      },
    },
  },
  {
    name: "cabinet-L-sliding",
    key: "cabTall",
    overrides: {
      w: 3000,
      d: 2200,
      h: 2400,
      cab: {
        kind: "tall",
        door: "sliding",
        handle: "hidden",
        shape: "L",
        corner: "right",
        depth: 600,
        cols: ["hang", "glass", "drawer"],
        cols2: ["open", "niche"],
        ws: [800, 900, 700],
        top: 350,
        plinth: 80,
      },
    },
  },
);
for (const shape of ["I", "L", "U"])
  cases.push({
    name: `kitchen-${shape}`,
    key: "lCounter",
    overrides: {
      w: 4200,
      d: shape === "I" ? 650 : 2400,
      h: 950,
      kit: {
        shape,
        corner: "right",
        depth: 650,
        thick: 60,
        top: "#778899",
        sink: { leg: shape === "I" ? 0 : 1, at: 1300, w: 900, bowls: 2 },
        hob: { leg: 0, at: 2800, w: 800, burners: 4 },
        wall: true,
        wallLegs: shape === "U" ? [0, 2] : [0],
        wallH: 650,
        wallD: 400,
        wallZ: 1700,
        tall: "end",
        tallW: 600,
        tallH: 2300,
      },
    },
  });
cases.push(
  {
    name: "vanity-hanging-double",
    key: Object.keys(catalog).find((k) => catalog[k].type === "vanity"),
    overrides: { w: 1600, opt: { basins: 2, hang: true, mirror: false } },
  },
  {
    name: "shower-arc",
    key: Object.keys(catalog).find((k) => catalog[k].type === "shower"),
    overrides: { opt: { shape: "arc" } },
  },
);
const metrics = () => {
  const D = window.__designer,
    g = D.S3.sceneRefs().furnMap.get(D.app.plan.furniture[0].id).g;
  g.updateWorldMatrix(true, true);
  const inv = g.matrixWorld.clone().invert(),
    min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  let meshes = 0,
    vertices = 0;
  g.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    const a = o.geometry.attributes.position,
      matrix = inv.clone().multiply(o.matrixWorld);
    vertices += a.count;
    for (let i = 0; i < a.count; i++) {
      const v = g.position
        .clone()
        .set(a.getX(i), a.getY(i), a.getZ(i))
        .applyMatrix4(matrix);
      [v.x, v.y, v.z].forEach((x, j) => {
        min[j] = Math.min(min[j], x);
        max[j] = Math.max(max[j], x);
      });
    }
  });
  return { meshes, vertices, bounds: max.map((x, i) => x - min[i]) };
};
try {
  await original.goto(
    pathToFileURL(path.resolve("reference/runtime/living-dining.html")).href +
      "?debug",
    { waitUntil: "load" },
  );
  await original.waitForFunction(() => window.__designer);
  await original.evaluate(() => __designer.setView("3d"));
  await editor.goto(`http://127.0.0.1:${address.port}/?debug`, {
    waitUntil: "load",
  });
  await editor.waitForFunction(
    () =>
      window.__actiscape?.project &&
      document.querySelector("#save-state").textContent === "已保存到项目服务",
  );
  for (const c of cases) {
    try {
      const f = createFurniture(c.key, 2000, 3000, c.overrides);
      f.id = "parity-" + c.name;
      const plan = { ...clone(base), furniture: [f] };
      await original.evaluate((p) => __designer.replacePlan(p), plan);
      await original.waitForFunction(
        (id) => __designer.S3.sceneRefs().furnMap.has(id),
        {},
        f.id,
      );
      const expected = await original.evaluate(metrics),
        actual = await editor.evaluate(
          ({ f, plan }) => {
            const D = __actiscape,
              T = D.THREE,
              g = D.buildFurniture(f, plan),
              box = new T.Box3().setFromObject(g, true);
            let meshes = 0,
              vertices = 0;
            g.traverse((o) => {
              if (o.isMesh) {
                meshes++;
                vertices += o.geometry.attributes.position.count;
              }
            });
            return {
              meshes,
              vertices,
              bounds: box.getSize(new T.Vector3()).toArray(),
            };
          },
          { f, plan },
        );
      assert.equal(actual.meshes, expected.meshes);
      assert.equal(actual.vertices, expected.vertices);
      const delta = Math.max(
        ...expected.bounds.map((v, i) => Math.abs(v - actual.bounds[i])),
      );
      assert.ok(delta < 0.00001, `${c.name} bounds differ ${delta * 1000} mm`);
      results.push({
        name: c.name,
        status: "passed",
        maximumDifferenceMm: delta * 1000,
        expected,
        actual,
      });
      console.log("PASS", c.name);
    } catch (e) {
      results.push({ name: c.name, status: "failed", error: e.stack });
      console.log("FAIL", c.name, e.message);
    }
  }
} finally {
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify({ cases: cases.length, results }, null, 2),
  );
  await browser.close();
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
if (results.some((r) => r.status === "failed")) process.exitCode = 1;
