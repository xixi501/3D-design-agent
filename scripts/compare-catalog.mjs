import fs from "node:fs";
import assert from "node:assert/strict";
const original = JSON.parse(
    fs.readFileSync("test-results/baseline/catalog-geometry.json"),
  ),
  current = JSON.parse(
    fs.readFileSync("test-results/browser/catalog-geometry.json"),
  );
assert.equal(original.length, 266);
assert.equal(current.length, 266);
const results = original.map((a) => {
  const b = current.find((b) => b.key === a.key);
  assert.ok(b, a.key);
  const maximumDifferenceMm =
    Math.max(...a.bounds.map((v, i) => Math.abs(v - b.bounds[i]))) * 1000;
  assert.equal(b.meshes, a.meshes, a.key + " mesh count");
  assert.equal(b.vertices, a.vertices, a.key + " vertex count");
  assert.ok(maximumDifferenceMm < 0.01, a.key + " dimensions");
  return { key: a.key, status: "passed", maximumDifferenceMm };
});
fs.mkdirSync("test-results/parity", { recursive: true });
fs.writeFileSync(
  "test-results/parity/catalog-report.json",
  JSON.stringify(
    {
      count: 266,
      toleranceMm: 0.01,
      note: "Original hidden smart-home airflow helper meshes are excluded from visible body measurements.",
      results,
    },
    null,
    2,
  ),
);
console.log(
  "PASS 266 catalogue bodies: mesh counts, vertex counts and precise bounds match original",
);
