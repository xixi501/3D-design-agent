import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  exactDuplicateRate,
  maximumCardinalityMinimumCostMatching,
  pixelWallCoverage,
} from "../packages/scene-core/src/floorplan-quality.js";
import { sha256 } from "../scripts/quality/artifact-seal.js";

test("historical V4 replay is hash-bound as an oracle-assisted diagnostic", () => {
  const evidence = JSON.parse(
    fs.readFileSync(
      "docs/evidence/full-home-v4-replay-oracle-assisted-20261109.json",
      "utf8",
    ),
  );
  const historical = fs.readFileSync(`docs/evidence/${evidence.evidenceFile}`);
  assert.equal(evidence.classification, "oracle-assisted-diagnostic");
  assert.equal(evidence.authoritativeForBackendSelection, false);
  assert.equal(evidence.evidenceSha256, sha256(historical));
});

test("maximum matching does not lose a valid solution to greedy ordering", () => {
  const result = maximumCardinalityMinimumCostMatching(2, 2, [
    { actual: 0, reference: 0, cost: 1 },
    { actual: 0, reference: 1, cost: 2 },
    { actual: 1, reference: 0, cost: 1.1 },
  ]);
  assert.equal(result.matches.length, 2);
  assert.deepEqual(
    result.matches.map((match) => [match.actual, match.reference]),
    [
      [0, 1],
      [1, 0],
    ],
  );
});

test("maximum matching minimizes cost after maximizing cardinality", () => {
  const result = maximumCardinalityMinimumCostMatching(2, 2, [
    { actual: 0, reference: 0, cost: 1 },
    { actual: 0, reference: 1, cost: 3 },
    { actual: 1, reference: 0, cost: 0.5 },
    { actual: 1, reference: 1, cost: 4 },
  ]);
  assert.equal(result.matches.length, 2);
  assert.equal(
    result.matches.reduce((sum, match) => sum + match.cost, 0),
    3.5,
  );
});

test("one merged candidate can match only one reference instance", () => {
  const result = maximumCardinalityMinimumCostMatching(1, 2, [
    { actual: 0, reference: 0, cost: 0.1 },
    { actual: 0, reference: 1, cost: 0.2 },
  ]);
  assert.equal(result.matches.length, 1);
  assert.equal(result.unmatchedReferenceCount, 1);
  assert.equal(result.ambiguousReferenceCount, 0);
  assert.equal(result.ambiguousActualCount, 1);
});

test("duplicate wall candidates do not increase reference coverage", () => {
  const reference = [
    { orientation: "h" as const, line: 10, start: 0, end: 100 },
  ];
  const single = pixelWallCoverage(
    [{ orientation: "h", line: 10, start: 0, end: 100 }],
    reference,
  );
  const duplicated = pixelWallCoverage(
    [
      { orientation: "h", line: 10, start: 0, end: 100 },
      { orientation: "h", line: 10, start: 0, end: 100 },
    ],
    reference,
  );
  assert.equal(single.recall, 1);
  assert.equal(duplicated.recall, 1);
  assert.equal(
    exactDuplicateRate([
      { orientation: "h", line: 10, start: 0, end: 100 },
      { orientation: "h", line: 10, start: 0.5, end: 100.5 },
    ]),
    0.5,
  );
});

test(
  "unprivileged candidate user cannot descend into locked evidence",
  {
    skip:
      process.getuid?.() !== 0 || !fs.existsSync("/usr/bin/setpriv")
        ? "需要 root 和 setpriv"
        : false,
  },
  () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actiscape-quality-test-"),
    );
    const evidence = path.join(directory, "evidence");
    fs.mkdirSync(evidence);
    const answer = path.join(evidence, "answer.evaluation-only.json");
    fs.writeFileSync(answer, "{}");
    fs.chmodSync(evidence, 0o700);
    try {
      const result = spawnSync(
        "/usr/bin/setpriv",
        [
          "--no-new-privs",
          "--reuid=65534",
          "--regid=65534",
          "--clear-groups",
          "/bin/sh",
          "-c",
          `test ! -r '${answer}'`,
        ],
        { encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr || result.stdout);
    } finally {
      fs.chmodSync(evidence, 0o755);
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
);
