/**
 * Deprecated oracle-assisted V4 stage diagnostic.
 *
 * Reference rooms, anchors and room masks enter candidate construction. This
 * script is retained only to reproduce historical failure evidence. Use
 * `scripts/quality/run-floorplan-quality-batch.ts` for production-like replay.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  floorplanScale,
  type FloorplanData,
} from "../packages/scene-core/src/floorplan.ts";
import { scoreFloorplanRecognition } from "../packages/scene-core/src/floorplan-metrics.ts";

const root = process.cwd();
const python = path.join(root, ".venv/bin/python");
const tool = path.join(
  root,
  "apps/agent/actiscape_agent/floorplan_upstream.py",
);
const fixtureRoot = path.join(root, "fixtures/full-home-candidates");
const outputRoot = path.join(root, "test-results/full-home-v4-replay");
const diagnose = process.argv.includes("--diagnose");
if (!process.argv.includes("--oracle-diagnostic")) {
  console.error(
    "This replay is oracle-assisted. Pass --oracle-diagnostic for historical reproduction only.",
  );
  process.exit(2);
}
fs.mkdirSync(outputRoot, { recursive: true });

const candidates = ["2bhk-bungalow", "oak-ridge-c"];
const report = {
  schemaVersion: "actiscape.full-home-v4-replay.v1",
  generatedAt: new Date().toISOString(),
  modelCalls: 0,
  adapterVersion: "hpd-adapter-6-1",
  candidatePolicyVersion: "geometry-only",
  assessmentType: "oracle-assisted-diagnostic",
  productionLike: false,
  authoritativeForProviderSelection: false,
  referenceUsage:
    "Deprecated: reference anchors, rooms and targetRoomIds entered candidate construction",
  oracleInputs: [
    "reference.anchors",
    "reference.rooms",
    "reference.targetRoomIds",
    "reference passed to contours as spec",
  ],
  controlled: true,
  passed: false,
  images: [],
  notMeasured: [
    "room label semantics from the structure model",
    "furniture category classification",
    "rotation correctness without a category hypothesis",
    "activity-group completeness",
  ],
};

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function runTool(imageFile, mode, parameters) {
  const payload = {
    mode,
    adapterVersion: "hpd-adapter-6-1",
    parameters,
    image: fs.readFileSync(imageFile).toString("base64"),
  };
  const result = spawnSync(python, [tool], {
    cwd: root,
    input: JSON.stringify(payload),
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    timeout: 240000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const value = JSON.parse(result.stdout);
  assert.ok(!value.error, JSON.stringify(value));
  return value;
}

function saveToolFiles(imageId, record) {
  const directory = path.join(outputRoot, imageId);
  fs.mkdirSync(directory, { recursive: true });
  const files = {};
  for (const [name, artifact] of Object.entries(record.files || {})) {
    const file = path.join(directory, name);
    fs.writeFileSync(file, Buffer.from(artifact.data, "base64"));
    files[name] = {
      path: path.relative(root, file),
      sha256: sha256(file),
    };
  }
  return { directory, files };
}

function candidateStructure(record, reference) {
  const walls = record.result.candidateWalls.map((wall) => ({
    id: wall.candidateWallId,
    a:
      wall.orient === "h"
        ? { x: wall.s0, y: wall.line }
        : { x: wall.line, y: wall.s0 },
    b:
      wall.orient === "h"
        ? { x: wall.s1, y: wall.line }
        : { x: wall.line, y: wall.s1 },
    thicknessPx: wall.t,
  }));
  const byId = new Map(
    record.result.candidateWalls.map((wall) => [wall.candidateWallId, wall]),
  );
  const openings = [];
  const unownedOpenings = [];
  for (const opening of record.result.openingCandidates || []) {
    const wall = byId.get(opening.candidateWallId);
    if (!wall) {
      unownedOpenings.push(opening.candidateId);
      continue;
    }
    openings.push({
      id: opening.candidateId,
      wallId: wall.candidateWallId,
      type: opening.typeHint,
      offset: opening.center - wall.s0,
      width: opening.width,
    });
  }
  return {
    recognitionVersion: 4,
    candidatePolicyVersion: "geometry-only",
    image: reference.image,
    name: `Zero-model structure candidate: ${reference.name}`,
    anchors: reference.anchors,
    walls,
    openings,
    rooms: reference.rooms,
    symbols: [],
    targetRoomIds: reference.targetRoomIds,
    uncertainties: [],
    unownedOpenings,
  };
}

function symbolBox(symbol) {
  let width = symbol.w;
  let depth = symbol.d;
  if (Math.abs(symbol.rot || 0) % 180 === 90) [width, depth] = [depth, width];
  return {
    x: symbol.x - width / 2,
    y: symbol.y - depth / 2,
    w: width,
    d: depth,
  };
}

function objectBox(object) {
  return {
    x: object.bbox[0],
    y: object.bbox[1],
    w: object.bbox[2],
    d: object.bbox[3],
  };
}

function centre(object) {
  return {
    x: object.bbox[0] + object.bbox[2] / 2,
    y: object.bbox[1] + object.bbox[3] / 2,
  };
}

function geometryMatch(reference, objects) {
  const scale = floorplanScale(reference);
  const references = reference.symbols.filter(
    (symbol) =>
      reference.targetRoomIds.includes(symbol.roomId) &&
      symbol.included !== false,
  );
  const usableObjects = objects.filter((object) => object.selectable !== false);
  const edges = [];
  for (const [referenceIndex, symbol] of references.entries()) {
    const target = symbolBox(symbol);
    for (const [objectIndex, object] of usableObjects.entries()) {
      if (!(object.roomIds || []).includes(symbol.roomId)) continue;
      const box = objectBox(object);
      const point = centre(object);
      const centreError =
        Math.hypot(point.x - symbol.x, point.y - symbol.y) * scale;
      const widthTolerance = Math.max(100, target.w * scale * 0.15);
      const depthTolerance = Math.max(100, target.d * scale * 0.15);
      const widthError = Math.abs(box.w - target.w) * scale;
      const depthError = Math.abs(box.d - target.d) * scale;
      if (
        centreError <= 150 &&
        widthError <= widthTolerance &&
        depthError <= depthTolerance
      )
        edges.push({
          referenceIndex,
          objectIndex,
          cost:
            centreError / 150 +
            widthError / widthTolerance +
            depthError / depthTolerance,
          centreError,
          widthError,
          depthError,
        });
    }
  }
  edges.sort((a, b) => a.cost - b.cost);
  const usedReference = new Set();
  const usedObject = new Set();
  const matches = [];
  for (const edge of edges) {
    if (
      usedReference.has(edge.referenceIndex) ||
      usedObject.has(edge.objectIndex)
    )
      continue;
    usedReference.add(edge.referenceIndex);
    usedObject.add(edge.objectIndex);
    matches.push({
      ...edge,
      referenceId: references[edge.referenceIndex].id,
      referenceCategory: references[edge.referenceIndex].category,
      objectCandidateId: usableObjects[edge.objectIndex].objectCandidateId,
      roomId: references[edge.referenceIndex].roomId,
    });
  }
  const missing = references
    .filter((_, index) => !usedReference.has(index))
    .map((symbol) => ({
      id: symbol.id,
      category: symbol.category,
      roomId: symbol.roomId,
      x: symbol.x,
      y: symbol.y,
      w: symbol.w,
      d: symbol.d,
      rot: symbol.rot,
    }));
  const extras = usableObjects
    .filter((_, index) => !usedObject.has(index))
    .map((object) => ({
      objectCandidateId: object.objectCandidateId,
      bbox: object.bbox,
      roomIds: object.roomIds || [],
    }));
  const precision = usableObjects.length
    ? matches.length / usableObjects.length
    : 0;
  const recall = references.length ? matches.length / references.length : 1;
  return {
    passed: precision >= 0.9 && recall >= 0.9,
    scaleMmPerPixel: scale,
    referenceCount: references.length,
    candidateCount: usableObjects.length,
    matchedCount: matches.length,
    precision,
    recall,
    missing,
    extras: extras.slice(0, 100),
    extraCandidateCount: extras.length,
    extrasTruncated: extras.length > 100,
    matches,
    centreErrorMmMax: Math.max(0, ...matches.map((match) => match.centreError)),
    widthErrorMmMax: Math.max(0, ...matches.map((match) => match.widthError)),
    depthErrorMmMax: Math.max(0, ...matches.map((match) => match.depthError)),
    limitations: [
      "Category is taken from the evaluation reference only to match geometry; no classification score is produced.",
      "Rotation is not scored because the geometry-only candidate has no category-specific orientation.",
      "Every selectable object counts toward precision, so over-generated text and nested linework are penalised.",
    ],
  };
}

for (const id of candidates) {
  const imageFile = path.join(fixtureRoot, `${id}.jpg`);
  const referenceFile = path.join(fixtureRoot, `${id}.evaluation-only.json`);
  const manifestFile = path.join(fixtureRoot, `${id}.evaluation-manifest.json`);
  const reference = JSON.parse(
    fs.readFileSync(referenceFile, "utf8"),
  ) as FloorplanData;
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  assert.equal(sha256(imageFile), reference.image.sha256);
  assert.equal(sha256(referenceFile), manifest.referenceSha256);

  const analysis = runTool(imageFile, "analyze", {});
  const structure = candidateStructure(analysis, reference);
  const score = scoreFloorplanRecognition(
    structure,
    reference,
    manifest.aliases || {},
  );
  const contours = runTool(imageFile, "contours", {
    spec: reference,
    policyVersion: "geometry-only",
  });
  const objects = contours.objectCandidates || [];
  const furniture = geometryMatch(reference, objects);
  const files = saveToolFiles(id, analysis);
  const objectFiles = saveToolFiles(`${id}-objects`, contours);

  const imageReport = {
    id,
    sourceImageSha256: reference.image.sha256,
    referenceSha256: manifest.referenceSha256,
    walls: {
      measured: true,
      passed: score.walls.recall >= 0.9,
      poolPrecision: score.walls.precision,
      coverageRecall: score.walls.recall,
      selectionNotMeasured: true,
      candidateCount: structure.walls.length,
      referenceCount: reference.walls.length,
    },
    openings: {
      measured: true,
      passed: score.openings.recall >= 0.9,
      poolPrecision: score.openings.precision,
      coverageRecall: score.openings.recall,
      selectionNotMeasured: true,
      candidateCount: structure.openings.length,
      referenceCount: reference.openings.length,
      unownedCandidateIds: structure.unownedOpenings,
    },
    rooms: {
      measured: false,
      referenceCount: reference.rooms.length,
      reason:
        "Fixed image analysis does not produce model room-label semantics",
    },
    furnitureGeometry: furniture,
    classification: {
      measured: false,
      reason: "No vision or language model was called in this replay",
    },
    activityGroups: {
      measured: false,
      candidateCount: contours.activityGroupCandidates?.length || 0,
      reason:
        "Geometry-only replay has no category hypothesis or model group decision",
    },
    rawEvidence: {
      contourCandidates: contours.contourCandidates?.length || 0,
      selectableObjects: objects.length,
      suppressedObjectCandidates: contours.suppressedObjectCandidateCount || 0,
      analysisFiles: files.files,
      objectFiles: objectFiles.files,
    },
  };
  imageReport.measuredPassed =
    imageReport.walls.passed && imageReport.openings.passed && furniture.passed;
  imageReport.blockingReasons = [
    ...(imageReport.walls.passed ? [] : ["WALL_THRESHOLD"]),
    ...(imageReport.openings.passed ? [] : ["OPENING_THRESHOLD"]),
    ...(furniture.passed ? [] : ["FURNITURE_GEOMETRY_THRESHOLD"]),
    "ROOM_SEMANTICS_NOT_MEASURED",
    "FURNITURE_CLASSIFICATION_NOT_MEASURED",
  ];
  report.images.push(imageReport);
  const artifact = path.join(outputRoot, `${id}-report.json`);
  fs.writeFileSync(artifact, JSON.stringify(imageReport, null, 2));
  report.images.at(-1).reportFile = path.relative(root, artifact);
  report.images.at(-1).reportSha256 = sha256(artifact);
}

report.passed = report.images.every(
  (image) => image.blockingReasons.length === 0,
);
const reportFile = path.join(outputRoot, "report.json");
fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      passed: report.passed,
      modelCalls: report.modelCalls,
      controlled: report.controlled,
      images: report.images.map((image) => ({
        id: image.id,
        walls: image.walls,
        openings: image.openings,
        furnitureGeometry: {
          passed: image.furnitureGeometry.passed,
          referenceCount: image.furnitureGeometry.referenceCount,
          candidateCount: image.furnitureGeometry.candidateCount,
          matchedCount: image.furnitureGeometry.matchedCount,
          precision: image.furnitureGeometry.precision,
          recall: image.furnitureGeometry.recall,
          extraCandidateCount: image.furnitureGeometry.extraCandidateCount,
        },
        blockingReasons: image.blockingReasons,
        reportFile: image.reportFile,
      })),
      reportFile: path.relative(root, reportFile),
      reportSha256: sha256(reportFile),
    },
    null,
    2,
  ),
);
if (!report.passed && !diagnose) process.exitCode = 1;
