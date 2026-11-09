import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  readJson,
  relativePath,
  sha256,
  writeSealedJson,
} from "./artifact-seal.js";

const root = process.cwd();
const images = ["2bhk-bungalow", "oak-ridge-c"];
const outputRoot = path.join(root, "test-results/floorplan-quality");
const captureScript = path.join(
  root,
  "scripts/quality/run-floorplan-candidate.ts",
);
const scoreScript = path.join(
  root,
  "scripts/quality/score-floorplan-candidates.ts",
);

function runTsx(script: string, arguments_: string[]) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", script, ...arguments_],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 300_000,
      maxBuffer: 128 * 1024 * 1024,
      env: process.env,
    },
  );
  if (result.status !== 0)
    throw new Error(
      `${path.basename(script)} 失败：${result.stderr || result.stdout}`,
    );
  return result.stdout.trim();
}

const imagesReport = [];
for (const id of images) {
  const image = path.join(root, "fixtures/full-home-candidates", `${id}.jpg`);
  const output = path.join(outputRoot, id);
  runTsx(captureScript, ["--image", image, "--id", id, "--output", output]);
  runTsx(scoreScript, [
    "--capture",
    path.join(output, "capture.json"),
    "--output",
    path.join(output, "score.json"),
  ]);
  const captureFile = path.join(output, "capture.json");
  const scoreFile = path.join(output, "score.json");
  const score = readJson<Record<string, any>>(scoreFile);
  imagesReport.push({
    id,
    captureFile: relativePath(root, captureFile),
    captureSha256: sha256(fs.readFileSync(captureFile)),
    scoreFile: relativePath(root, scoreFile),
    scoreSha256: sha256(fs.readFileSync(scoreFile)),
    methodologyPassed: score.methodologyPassed,
    candidatePoolPassed: score.candidatePool.passed,
    walls: score.walls,
    openings: {
      candidateCount: score.openings.candidateCount,
      referenceCount: score.openings.referenceCount,
      precision: score.openings.precision,
      recall: score.openings.recall,
      duplicateRate: score.openings.duplicateRate,
      ambiguousReferenceRate: score.openings.ambiguousReferenceRate,
    },
    blockingReasons: score.blockingReasons,
  });
}

const methodologyPassed = imagesReport.every(
  (image) => image.methodologyPassed,
);
const report = {
  schemaVersion: "actiscape.floorplan-quality-batch.v1",
  generatedAt: new Date().toISOString(),
  purpose:
    "Production-like zero-model candidate-pool baseline with reference isolation",
  evaluationKind: "oracle-free-candidate-capture",
  status: methodologyPassed ? "baseline-blocked" : "invalid",
  passed: false,
  methodologyPassed,
  nextBatchAllowed: methodologyPassed,
  modelCalls: 0,
  referenceUsage:
    "Candidate capture received only image bytes, scope and adapter version. Scoring ran in a separate process after the candidate hash was sealed.",
  candidatePoolGate: {
    wallWallCoverageRecall: 0.95,
    openingOneToOneRecall: 0.95,
    roomRegionCoverageRecall: 0.95,
    status: "not-met",
  },
  images: imagesReport,
  notMeasured: [
    "room candidates derived from candidate walls",
    "furniture candidates scanned without reference room masks",
    "final candidate selection quality",
    "category, ownership, activity groups and final scene geometry",
  ],
  decision: methodologyPassed
    ? "The quality plane is trustworthy. Continue with the V4 single-authority switch; do not use these baseline scores for provider selection."
    : "Stop all provider and V4 work until reference isolation is restored.",
};
const reportFile = path.join(outputRoot, "batch-report.json");
const reportSha256 = writeSealedJson(reportFile, report);
console.log(
  JSON.stringify(
    {
      status: report.status,
      methodologyPassed,
      nextBatchAllowed: report.nextBatchAllowed,
      images: imagesReport.map((image) => ({
        id: image.id,
        methodologyPassed: image.methodologyPassed,
        walls: {
          recall: image.walls.coverageRecall,
          precision: image.walls.precision,
          candidateCount: image.walls.candidateCount,
        },
        openings: image.openings,
      })),
      reportFile: path.relative(root, reportFile),
      reportSha256,
    },
    null,
    2,
  ),
);
if (!methodologyPassed) process.exitCode = 1;
