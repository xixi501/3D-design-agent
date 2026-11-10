import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  compileFloorplan,
  imageCategoryCodes,
  imageFunctionalAreas,
  resolveTargetRoomIds,
  validateFloorplan,
  type FloorplanData,
} from "../packages/scene-core/src/floorplan.js";
import { floorplanToSceneProgram } from "../packages/scene-core/src/floorplan-scene-draft.js";
import { sceneRoomScope } from "../packages/scene-core/src/scene-contracts.js";
import { sceneRoomKind } from "../packages/scene-core/src/room-kinds.js";

function allHouseDraft(): FloorplanData {
  const data = JSON.parse(
    fs.readFileSync("fixtures/s2c-synthetic.floorplan.json", "utf8"),
  ) as FloorplanData;
  data.recognitionVersion = 4;
  data.candidatePolicyVersion = "geometry-only";
  data.targetRoomIds = ["living", "bedroom", "kitchen"];
  data.rooms = [
    {
      id: "living",
      name: "客餐厅",
      roomType: "living_dining",
      functionalArea: "living",
      at: { x: 350, y: 550 },
    },
    {
      id: "bedroom",
      name: "主卧",
      roomType: "master_bedroom",
      functionalArea: "bedroom",
      at: { x: 800, y: 250 },
    },
    {
      id: "kitchen",
      name: "厨房",
      roomType: "kitchen",
      functionalArea: "kitchen",
      at: { x: 800, y: 550 },
    },
  ];
  return data;
}

function symbols(count: number): any[] {
  const codes = imageCategoryCodes.filter((code) => code !== "other");
  return Array.from({ length: count }, (_, index) => {
    const code = codes[index % codes.length];
    return {
      id: `object_${index}`,
      roomId: "living",
      category: code,
      categoryCode: code,
      sourceLabel: `原图对象 ${index + 1}`,
      functionalArea: "living",
      x: 350,
      y: 550,
      w: 1,
      d: 1,
      rot: 0,
      included: true,
    };
  });
}

test("V4 whole-home contract accepts residential areas and catalog categories", () => {
  for (const area of [
    "bedroom",
    "bathroom",
    "entry",
    "balcony",
    "storage",
    "circulation",
    "study",
    "utility",
    "multipurpose",
  ])
    assert.ok((imageFunctionalAreas as readonly string[]).includes(area));

  const registry = JSON.parse(
    fs.readFileSync(
      "apps/agent/actiscape_agent/scene-registry.v1.json",
      "utf8",
    ),
  );
  for (const category of registry.categories.filter(
    (item: any) => item.catalogKeys.length > 0,
  ))
    assert.ok(
      (imageCategoryCodes as readonly string[]).includes(category.id),
      `scene registry category ${category.id} is missing from floorplan contract`,
    );
});

test("V4 compiles all target rooms and accepts the 300-object capacity", () => {
  const data = allHouseDraft();
  data.symbols = symbols(300);
  assert.doesNotThrow(() => validateFloorplan(data));
  const compiled = compileFloorplan(data, "v4-capacity", {
    draftId: "draft-v4",
    draftRevision: 3,
    draftHash: "a".repeat(64),
  });
  assert.equal(compiled.symbols.length, 300);
  assert.deepEqual(compiled.targetRoomIds, [
    "v4-capacity:r:living",
    "v4-capacity:r:bedroom",
    "v4-capacity:r:kitchen",
  ]);
  assert.equal(compiled.state.plan.source.recognitionVersion, 4);
  assert.equal(
    compiled.state.plan.source.candidatePolicyVersion,
    "geometry-only",
  );
});

test("V4 rejects the 301st object and legacy semantic policy", () => {
  const tooMany = allHouseDraft();
  tooMany.symbols = symbols(301);
  assert.throws(() => validateFloorplan(tooMany), /数量无效/);

  const legacyPolicy = allHouseDraft();
  legacyPolicy.symbols = symbols(1);
  legacyPolicy.candidatePolicyVersion = "legacy-room-semantics";
  assert.throws(() => validateFloorplan(legacyPolicy), /geometry-only/);
});

test("V3 drafts remain valid without V4 policy fields", () => {
  const data = JSON.parse(
    fs.readFileSync("fixtures/s2c-synthetic.floorplan.json", "utf8"),
  );
  data.recognitionVersion = 3;
  for (const symbol of data.symbols) {
    symbol.categoryCode =
      symbol.id === "sofa1"
        ? "sofa"
        : symbol.id === "coffee1"
          ? "coffeeTable"
          : symbol.id === "chair1"
            ? "armchair"
            : "floorLamp";
    symbol.category = symbol.categoryCode;
    symbol.sourceLabel = symbol.category;
  }
  assert.doesNotThrow(() => validateFloorplan(data));
});

test("V4 empty target list defaults to every recognised whole-home room", () => {
  const data = allHouseDraft();
  data.targetRoomIds = [];
  data.symbols = symbols(3);
  assert.deepEqual(resolveTargetRoomIds(data), [
    "living",
    "bedroom",
    "kitchen",
  ]);
  const compiled = compileFloorplan(data, "v4-whole-home");
  assert.deepEqual(compiled.targetRoomIds, [
    "v4-whole-home:r:living",
    "v4-whole-home:r:bedroom",
    "v4-whole-home:r:kitchen",
  ]);
  const program = floorplanToSceneProgram(data, "plan-whole-home");
  assert.deepEqual(
    program.levels[0].roomSeeds
      .filter((room) => room.included)
      .map((room) => room.id),
    ["living", "bedroom", "kitchen"],
  );
  assert.deepEqual(sceneRoomScope(program).kinds, [
    "living_dining",
    "bedroom",
    "kitchen",
  ]);
  assert.equal(sceneRoomScope(program).wholeHome, true);
});

test("whole-home spatial kinds cover bedrooms, service rooms and circulation", () => {
  assert.equal(sceneRoomKind("master_bedroom", "bedroom"), "bedroom");
  assert.equal(sceneRoomKind("guest_bedroom", "bedroom"), "bedroom");
  assert.equal(sceneRoomKind("study", "study"), "study");
  assert.equal(sceneRoomKind("kitchen", "kitchen"), "kitchen");
  assert.equal(sceneRoomKind("bathroom", "bathroom"), "bathroom");
  assert.equal(sceneRoomKind("entry", "entry"), "entry");
  assert.equal(sceneRoomKind("circulation", "circulation"), "circulation");
  assert.equal(sceneRoomKind(undefined, "circulation"), "circulation");
  assert.equal(sceneRoomKind("unknown_type", "bedroom"), "bedroom");
  assert.equal(sceneRoomKind("unknown_type", "unknown_area"), "other");
});
