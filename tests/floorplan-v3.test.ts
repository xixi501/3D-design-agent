import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  compileFloorplan,
  validateFloorplan,
} from "../packages/scene-core/src/floorplan.js";
import { scoreFloorplanRecognition } from "../packages/scene-core/src/floorplan-metrics.js";

test("V3 category contract accepts canonical codes and preserves old drafts", () => {
  const legacy = JSON.parse(
    fs.readFileSync("fixtures/s2c-synthetic.floorplan.json", "utf8"),
  );
  validateFloorplan(legacy);

  const v3 = structuredClone(legacy);
  v3.recognitionVersion = 3;
  for (const symbol of v3.symbols) {
    const code =
      symbol.id === "sofa1"
        ? "sofa"
        : symbol.id === "coffee1"
          ? "coffeeTable"
          : symbol.id === "chair1"
            ? "armchair"
            : "floorLamp";
    symbol.categoryCode = code;
    symbol.category = code;
    symbol.sourceLabel = symbol.category;
  }
  assert.doesNotThrow(() => validateFloorplan(v3));

  const missing = structuredClone(v3);
  delete missing.symbols[0].categoryCode;
  assert.throws(() => validateFloorplan(missing), /V3 家具符号/);

  const invalid = structuredClone(v3);
  invalid.symbols[0].categoryCode = "三人沙发（靠北）";
  assert.throws(() => validateFloorplan(invalid), /未知家具类别代码/);

  const coded = structuredClone(v3);
  coded.uncertainties = [
    {
      id: "entry-door",
      message: "门型待确认",
      blocking: true,
      code: "OPENING_TYPE",
      objectIds: ["op_3"],
      evidenceRefs: ["analysis"],
    },
  ];
  assert.doesNotThrow(() => validateFloorplan(coded));
  const badCode = structuredClone(coded);
  (badCode.uncertainties[0] as any).code = "DOOR_MAGIC";
  assert.throws(() => validateFloorplan(badCode), /不确定项类型/);
});

test("V3 scoring keeps categoryCode separate from sourceLabel", () => {
  const data = JSON.parse(
    fs.readFileSync("fixtures/s2c-v2-synthetic.floorplan.json", "utf8"),
  );
  data.recognitionVersion = 3;
  for (const symbol of data.symbols) {
    symbol.sourceLabel = symbol.category;
    symbol.categoryCode =
      symbol.id === "sofa1"
        ? "sofa"
        : symbol.id === "coffee1"
          ? "coffeeTable"
          : symbol.id === "chair1"
            ? "armchair"
            : "floorLamp";
    symbol.category = symbol.categoryCode;
  }
  assert.doesNotThrow(() =>
    compileFloorplan(data, "v3-category", {
      draftId: "d",
      draftRevision: 1,
      draftHash: "a".repeat(64),
    }),
  );
});

test("V3.5 activity groups survive compile and use s2c-5 scoring", () => {
  const data = JSON.parse(
    fs.readFileSync("fixtures/s2c-v2-synthetic.floorplan.json", "utf8"),
  );
  data.recognitionVersion = 3;
  for (const symbol of data.symbols) {
    symbol.sourceLabel = symbol.category;
    symbol.categoryCode =
      symbol.id === "sofa1"
        ? "sofa"
        : symbol.id === "coffee1"
          ? "coffeeTable"
          : symbol.id === "chair1"
            ? "armchair"
            : "floorLamp";
    symbol.category = symbol.categoryCode;
    symbol.objectCandidateId = `fo_${symbol.id}`;
  }
  data.activityGroups = data.symbols.map((symbol: any, index: number) => ({
    id: `ag_${index}`,
    type: symbol.categoryCode === "sofa" ? "direct_occupancy" : "standalone",
    primarySymbolId: symbol.id,
    memberSymbolIds: [symbol.id],
    roles: { [symbol.id]: "primary" },
    evidenceRefs: ["fixture"],
  }));
  for (const group of data.activityGroups)
    data.symbols.find(
      (symbol: any) => symbol.id === group.primarySymbolId,
    ).activityGroupIds = [group.id];
  assert.doesNotThrow(() => validateFloorplan(data));
  const compiled = compileFloorplan(data, "v3-5-group", {
    draftId: "d",
    draftRevision: 1,
    draftHash: "a".repeat(64),
  });
  assert.equal(compiled.state.plan.source.activityGroups.length, 4);
  const scored = scoreFloorplanRecognition(data, data);
  assert.equal(scored.thresholdVersion, "s2c-5");
  assert.equal(scored.activityGroups.applicable, true);
  assert.equal(scored.activityGroups.passed, true);

  const invalid = structuredClone(data);
  invalid.activityGroups[0].roles = {};
  assert.throws(() => validateFloorplan(invalid), /活动组角色/);
});
