import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  importDocument,
  applyCommands,
  catalog,
  createFurniture,
  clone,
  wallGeometry,
  detectRooms,
  blankPlan,
  freeShapes,
  checkScene,
} from "../packages/scene-core/src/index.js";
const fixture = JSON.parse(
  fs.readFileSync("fixtures/living-dining.plan.json", "utf8"),
);
test("full legacy snapshot preserves identities, recipes and materials with no browser globals", () => {
  const state = importDocument(fixture);
  assert.deepEqual(state.plan, fixture);
  assert.equal(detectRooms(state.plan).regions.length, 1);
  assert.equal(wallGeometry(state.plan).active.length, 4);
});
test("catalogue is byte-data equivalent to executed upstream and every recipe creates independently", () => {
  assert.deepEqual(
    catalog,
    JSON.parse(fs.readFileSync("fixtures/catalog.json", "utf8")),
  );
  assert.equal(Object.keys(freeShapes).length, 17);
  for (const key of Object.keys(catalog)) {
    const a = createFurniture(key),
      b = createFurniture(key);
    assert.notEqual(a.id, b.id);
    if (a.cab) {
      a.cab.cols[0] = "changed";
      assert.notEqual(b.cab!.cols[0], "changed");
    }
  }
});
test("failed command batches do not mutate the source; copies have independent nested recipes", () => {
  const state = importDocument(fixture),
    before = clone(state),
    cab = state.plan.furniture.find((f) => f.cab)!;
  assert.throws(() =>
    applyCommands(state, [
      {
        type: "update",
        collection: "furniture",
        id: cab.id,
        patch: { w: 2400 },
      },
      { type: "delete", collection: "furniture", id: "missing" },
    ]),
  );
  assert.deepEqual(state, before);
  const next = applyCommands(state, [
    { type: "duplicate", collection: "furniture", id: cab.id },
  ]);
  next.plan.furniture.at(-1)!.cab!.cols[0] = "open";
  assert.deepEqual(state, before);
});
test("HouseSpec converts, unsupported floors and invalid geometry explicitly fail", () => {
  const spec = JSON.parse(
    fs.readFileSync("fixtures/living-dining.spec.json", "utf8"),
  );
  const p = importDocument(spec).plan;
  assert.equal(p.furniture.length, 12);
  assert.equal(p.walls.length, 4);
  const normalizeIdentities = (plan: any) => {
    const ids = new Map<string, string>();
    for (const key of [
      "nodes",
      "walls",
      "openings",
      "furniture",
      "structs",
      "beams",
      "rooms",
      "measures",
      "elec",
      "voids",
      "comments",
    ])
      for (const [index, object] of (plan[key] || []).entries())
        ids.set(object.id, `${key}-${index}`);
    const visit = (value: any): any =>
      typeof value === "string"
        ? ids.get(value) || value
        : Array.isArray(value)
          ? value.map(visit)
          : value && typeof value === "object"
            ? Object.fromEntries(
                Object.entries(value).map(([key, item]) => [key, visit(item)]),
              )
            : value;
    return visit(plan);
  };
  assert.deepEqual(normalizeIdentities(p), normalizeIdentities(fixture));
  assert.throws(
    () => importDocument({ version: 3, floors: [{ plan: fixture }] }),
    /单层/,
  );
  const invalid = clone(fixture);
  invalid.walls[0].a = "missing";
  assert.throws(() => importDocument(invalid), /端点/);
  const dup = clone(fixture);
  dup.furniture[1].id = dup.furniture[0].id;
  assert.throws(() => importDocument(dup), /重复/);
});
test("room recovery archive survives removed walls and restores original label ID", () => {
  const state = importDocument(fixture),
    id = state.plan.rooms[0].id,
    wall = state.plan.walls[0].id;
  const removed = applyCommands(state, [
    {
      type: "update",
      collection: "walls",
      id: wall,
      patch: { status: "removed" },
    },
  ]);
  assert.equal(removed.roomLabelArchive[0].id, id);
  const restored = applyCommands(clone(removed), [
    {
      type: "update",
      collection: "walls",
      id: wall,
      patch: { status: "existing" },
    },
  ]);
  assert.equal(restored.plan.rooms[0].id, id);
});
test("scene checks identify intersecting footprints and wall penetration with object evidence", () => {
  const p = importDocument(fixture).plan;
  p.furniture = [
    createFurniture("freeBox", 2000, 2000),
    createFurniture("freeBox", 2100, 2050),
    createFurniture("freeBox", 0, 3000),
  ];
  const result = checkScene(p);
  assert.ok(
    result.issues.some(
      (i) =>
        i.code === "POSSIBLE_OVERLAP" &&
        i.objectIds.includes(p.furniture[0].id) &&
        i.objectIds.includes(p.furniture[1].id),
    ),
  );
  assert.ok(
    result.issues.some(
      (i) =>
        i.code === "FURNITURE_IN_WALL" &&
        i.objectIds.includes(p.furniture[2].id),
    ),
  );
  assert.ok(result.coverage.length);
  assert.ok(result.limitations.length);
});
