import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  compileFloorplan,
  validateFloorplan,
} from "../packages/scene-core/src/floorplan.js";

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
