import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  compileFloorplan,
  type FloorplanData,
} from "../packages/scene-core/src/floorplan.js";
import { solveMeasurement } from "../packages/scene-core/src/floorplan-measurement.js";
import { clone } from "../packages/scene-core/src/index.js";
export function measuredFixture(): FloorplanData {
  const data: FloorplanData = JSON.parse(
    fs.readFileSync("fixtures/s2c-synthetic.floorplan.json", "utf8"),
  );
  data.measurementVersion = 2;
  data.features = [];
  data.dimensions = [];
  data.anchors = [];
  for (const [id, wall, axis, side] of [
    ["wl", "west", "x", "min"],
    ["wr", "west", "x", "max"],
    ["el", "east", "x", "min"],
    ["er", "east", "x", "max"],
    ["nt", "north", "y", "min"],
    ["nb", "north", "y", "max"],
    ["st", "south", "y", "min"],
    ["sb", "south", "y", "max"],
  ] as const)
    data.features.push({
      id,
      objectId: wall,
      axis,
      side,
      kind: "wall_face",
      evidenceRefs: ["image:" + data.image.sha256],
    });
  for (const [id, from, to, length, basis] of [
    ["outer-x", "wl", "er", 9200, "exterior"],
    ["inner-x", "wr", "el", 8800, "interior"],
    ["outer-y", "nt", "sb", 7200, "exterior"],
    ["inner-y", "nb", "st", 6800, "interior"],
  ] as const) {
    const idx = data.anchors.length;
    const coords: Record<string, number> = {
      wl: 40,
      wr: 60,
      el: 940,
      er: 960,
      nt: 40,
      nb: 60,
      st: 740,
      sb: 760,
    };
    const axis = id.endsWith("x") ? "x" : "y";
    data.anchors.push({
      a: {
        x: axis === "x" ? coords[from] : 50,
        y: axis === "y" ? coords[from] : 50,
      },
      b: {
        x: axis === "x" ? coords[to] : 50,
        y: axis === "y" ? coords[to] : 50,
      },
      distance: { value: length, unit: "mm" },
      basis,
      evidence: "controlled labelled dimension",
    });
    data.dimensions.push({
      id,
      anchorIndex: idx,
      from,
      to,
      distance: { value: length, unit: "mm" },
      basis,
      evidenceRefs: ["image:" + data.image.sha256],
    });
  }
  return data;
}
test("label constraints survive raster noise without changing observed furniture or IDs", () => {
  const data = measuredFixture();
  for (const w of data.walls)
    for (const p of [w.a, w.b]) if (p.x === 950) p.x++;
  const before = clone(data),
    solved = solveMeasurement(data),
    a = compileFloorplan(data, "test"),
    b = compileFloorplan(data, "test");
  assert.deepEqual(data, before);
  assert.equal(solved.report.dimensions.length, 4);
  assert.ok(
    solved.report.dimensions.every((d) => Math.abs(d.residualMm) < 1e-6),
  );
  assert.equal(a.rooms.length, 3);
  assert.equal(a.symbols[0].x, 2000);
  assert.deepEqual(a.state, b.state);
  assert.ok(a.state.plan.walls.every((w) => !w.id.includes(",")));
  const changed = clone(data);
  changed.dimensions![0].distance.value += 1;
  changed.anchors[0].distance.value += 1;
  assert.deepEqual(
    compileFloorplan(changed, "test").state.plan.walls.map((w) => w.id),
    a.state.plan.walls.map((w) => w.id),
  );
});
test("contradictory, misbound and excessive adjustments are rejected explicitly", () => {
  let d = measuredFixture();
  d.dimensions!.push({
    ...d.dimensions![0],
    id: "conflict",
    distance: { value: 9300, unit: "mm" },
  });
  assert.throws(() => solveMeasurement(d), /矛盾/);
  d = measuredFixture();
  d.features![0].axis = "y";
  assert.throws(() => solveMeasurement(d), /法向/);
  d = measuredFixture();
  d.dimensions![0].distance.value = 15000;
  d.anchors[0].distance.value = 15000;
  d.dimensions![1].distance.value = 14600;
  d.anchors[1].distance.value = 14600;
  d.anchors[0].b.x = 1540;
  d.anchors[1].b.x = 1520;
  assert.throws(() => solveMeasurement(d), /偏离/);
  d = measuredFixture();
  d.anchors.push({ ...d.anchors[0], distance: { value: 4500, unit: "mm" } });
  d.dimensions!.push({
    ...d.dimensions![0],
    id: "bad-scale",
    anchorIndex: 4,
    distance: { value: 4500, unit: "mm" },
  });
  assert.throws(() => solveMeasurement(d), /3%/);
});

test("v2 scoring measures resolved feature distances rather than exact reference pixel lengths", async () => {
  const { scoreFloorplan } =
    await import("../packages/scene-core/src/floorplan-metrics.js");
  const reference = measuredFixture(),
    data = clone(reference);
  for (const w of data.walls)
    for (const p of [w.a, w.b]) if (p.x === 950) p.x++;
  const score = scoreFloorplan(data, data, reference, 0);
  assert.equal(score.confirmed.dimensionsPassed, true);
  assert.equal(score.thresholdVersion, "s2c-2");
  assert.equal(score.passed, true);
});

test("open-kitchen observations can be explicitly excluded without entering target furniture", () => {
  const data = measuredFixture();
  data.symbols.push({
    ...data.symbols[0],
    id: "kitchen-only",
    category: "厨房操作台",
    functionalArea: "kitchen",
    included: false,
    exclusionReason: "source request retains kitchen structure only",
    evidenceRefs: ["image:" + data.image.sha256],
  });
  assert.equal(compileFloorplan(data, "functional-area").symbols.length, 4);
});
