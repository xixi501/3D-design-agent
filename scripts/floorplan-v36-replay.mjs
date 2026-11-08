import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { compileFloorplan } from "../packages/scene-core/src/floorplan.ts";
import {
  scoreFloorplan,
  scoreFloorplanRecognition,
} from "../packages/scene-core/src/floorplan-metrics.ts";

const root = process.cwd();
const python = path.join(root, ".venv/bin/python");
const tool = path.join(
  root,
  "apps/agent/actiscape_agent/floorplan_upstream.py",
);

function toolRequest(imageFile, mode, parameters) {
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
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const value = JSON.parse(result.stdout);
  assert.ok(!value.error, JSON.stringify(value));
  return value;
}

function analyze(imageFile) {
  return toolRequest(imageFile, "analyze", {});
}

function requireHash(file) {
  return spawnSync("sha256sum", [file], { encoding: "utf8" })
    .stdout.trim()
    .split(/\s+/)[0];
}

function candidateDraft(record, reference) {
  const result = record.result;
  assert.equal(result.structureSkeletonVersion, 4);
  const walls = result.candidateWalls.map((wall) => ({
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
    result.candidateWalls.map((wall) => [wall.candidateWallId, wall]),
  );
  const openings = result.openingCandidates.map((opening) => {
    const wall = byId.get(opening.candidateWallId);
    assert.ok(wall, `Unknown opening wall ${opening.candidateWallId}`);
    return {
      id: opening.candidateId,
      wallId: wall.candidateWallId,
      type: opening.typeHint,
      offset: opening.center - wall.s0,
      width: opening.width,
    };
  });
  const dimension = result.dimensionCandidates[0];
  assert.ok(dimension, "V3-6 must emit at least one external dimension line");
  if (!result.candidateSummary.fallback) {
    assert.equal(dimension.unitHint, "mm");
  }
  const anchors = [
    {
      a: dimension.a || reference.anchors[0].a,
      b: dimension.b || reference.anchors[0].b,
      distance: {
        value: reference.anchors[0].distance.value,
        unit: reference.anchors[0].distance.unit,
      },
      basis: dimension.suggestedBasis,
      evidence: "V3-6 offline external dimension candidate",
    },
  ];
  return {
    recognitionVersion: 3,
    image: reference.image,
    name: "V3-6 evaluation-only candidate replay",
    height: 2800,
    wallThickness: 200,
    anchors,
    walls,
    openings,
    rooms: reference.rooms,
    symbols: [
      {
        id: "replay-target",
        roomId: reference.targetRoomIds[0],
        category: "sofa",
        categoryCode: "sofa",
        sourceLabel: "离线编译占位，不参与几何评分",
        x: reference.rooms.find(
          (room) => room.id === reference.targetRoomIds[0],
        ).at.x,
        y: reference.rooms.find(
          (room) => room.id === reference.targetRoomIds[0],
        ).at.y,
        w: 10,
        d: 10,
        rot: 0,
      },
    ],
    targetRoomIds: reference.targetRoomIds,
    uncertainties: [],
  };
}

const oneBedroomImage = path.join(
  root,
  "data/floorplan-images/fp-7ffeba5739402634c8744d723125c134e722d794f55ebd5140246b76681841aa/original",
);
const ninetyTwoImage = path.join(
  root,
  "data/floorplan-images/fp-d824f172b4d05e64863ca853033311558412979a0ed6e6cb3bbae44fa246d5c7/original",
);
assert.ok(fs.existsSync(oneBedroomImage), "First frozen image is unavailable");
assert.ok(fs.existsSync(ninetyTwoImage), "Second frozen image is unavailable");

const oneReference = JSON.parse(
  fs.readFileSync(
    path.join(root, "fixtures/s2c-real/one-bedroom.evaluation-only.json"),
    "utf8",
  ),
);
assert.equal(
  requireHash(oneBedroomImage),
  oneReference.image.sha256,
  "First frozen image hash changed",
);
const oneRecord = analyze(oneBedroomImage);
assert.equal(
  oneRecord.result.candidateSummary.fallback,
  "legacy-v3",
  "Simple rectangular plans should use the bounded legacy fallback",
);
const oneDraft = candidateDraft(oneRecord, {
  ...oneReference,
  anchors: [
    {
      ...oneReference.anchors[0],
      distance: oneReference.anchors[0].distance,
    },
  ],
});
const oneCompiled = compileFloorplan(oneDraft, "v36-one-replay");
assert.equal(oneCompiled.rooms.length, 3);

const secondReference = JSON.parse(
  fs.readFileSync(
    path.join(root, "fixtures/s2c-real/ninety-two.evaluation-only.json"),
    "utf8",
  ),
);
const secondManifest = JSON.parse(
  fs.readFileSync(
    path.join(root, "fixtures/s2c-real/ninety-two.evaluation-manifest.json"),
    "utf8",
  ),
);
assert.equal(
  requireHash(ninetyTwoImage),
  secondManifest.sourceImageSha256,
  "Second frozen image hash changed",
);
assert.equal(
  requireHash(
    path.join(root, "fixtures/s2c-real/ninety-two.evaluation-only.json"),
  ),
  secondManifest.referenceSha256,
);
const secondRecord = analyze(ninetyTwoImage);
assert.equal(
  secondRecord.result.candidateSummary.fallback,
  undefined,
  "Complex plan must not use the rectangular fallback",
);
assert.ok(secondRecord.result.candidateWalls.length >= 15);
assert.ok(secondRecord.result.openingCandidates.length >= 10);
assert.ok(secondRecord.result.dimensionCandidates.length >= 1);
const secondDraft = candidateDraft(secondRecord, secondReference);
const secondCompiled = compileFloorplan(secondDraft, "v36-second-replay");
assert.deepEqual(
  secondCompiled.rooms.map((room) => room.name).sort(),
  secondReference.rooms.map((room) => room.name).sort(),
);
const score = scoreFloorplanRecognition(
  secondDraft,
  secondReference,
  secondManifest.aliases,
);
assert.ok(score.walls.precision >= 0.9, JSON.stringify(score.walls));
assert.ok(score.walls.recall >= 0.9, JSON.stringify(score.walls));
assert.ok(score.openings.precision >= 0.9, JSON.stringify(score.openings));
assert.ok(score.openings.recall >= 0.9, JSON.stringify(score.openings));

const capturedFixture = JSON.parse(
  fs.readFileSync(
    path.join(root, "fixtures/s2c-real/ninety-two.v36-room-merge-replay.json"),
    "utf8",
  ),
);
assert.equal(
  capturedFixture.sourceImageSha256,
  secondManifest.sourceImageSha256,
  "Captured failure source image changed",
);
assert.equal(
  capturedFixture.draft.image.sha256,
  secondManifest.sourceImageSha256,
  "Captured draft is bound to a different image",
);
const pythonReplay = spawnSync(
  python,
  [path.join(root, "scripts/floorplan-v36-captured-replay.py")],
  {
    cwd: root,
    encoding: "utf8",
  },
);
if (pythonReplay.status !== 0) {
  process.stderr.write(pythonReplay.stdout || "");
  process.stderr.write(pythonReplay.stderr || "");
  process.exit(pythonReplay.status || 1);
}
const capturedConsolidation = JSON.parse(
  pythonReplay.stdout.trim().split("\n").at(-1),
);
assert.equal(capturedConsolidation.passed, true);
const capturedDraft = structuredClone(capturedFixture.draft);
capturedDraft.rooms = capturedConsolidation.rooms;
capturedDraft.targetRoomIds = capturedConsolidation.targetRoomIds;
const capturedCompiled = compileFloorplan(
  capturedDraft,
  "v36-captured-room-merge",
);
assert.equal(
  capturedCompiled.state.plan.walls.length,
  capturedFixture.expected.compiledWalls,
);
assert.equal(
  capturedCompiled.state.plan.openings.length,
  capturedFixture.expected.compiledOpenings,
);
assert.deepEqual(
  capturedCompiled.rooms
    .map((room) => ({
      id: room.id.split(":").at(-1),
      name: room.name,
    }))
    .sort((left, right) => left.id.localeCompare(right.id)),
  [...capturedFixture.expected.rooms].sort((left, right) =>
    left.id.localeCompare(right.id),
  ),
);
assert.equal(capturedCompiled.symbols.length, capturedFixture.expected.symbols);
const capturedRecognition = {
  ...capturedFixture.recognition,
  image: secondReference.image,
};
const capturedScore = scoreFloorplan(
  capturedRecognition,
  capturedDraft,
  secondReference,
  0,
  secondManifest.aliases,
);
assert.equal(capturedScore.passed, true, JSON.stringify(capturedScore));
assert.equal(capturedScore.rawPassed, true);
assert.equal(capturedScore.finalPassed, true);
assert.equal(capturedScore.confirmed.structure.passed, true);
assert.equal(capturedScore.confirmed.dimensionsPassed, true);
assert.equal(
  capturedScore.raw.walls.precision,
  capturedFixture.expected.rawWallPrecision,
);
assert.equal(
  capturedScore.raw.walls.recall,
  capturedFixture.expected.rawWallRecall,
);
assert.equal(
  capturedScore.raw.openings.precision,
  capturedFixture.expected.rawOpeningPrecision,
);
assert.equal(
  capturedScore.raw.openings.recall,
  capturedFixture.expected.rawOpeningRecall,
);
assert.equal(
  capturedScore.raw.furniture.precision,
  capturedFixture.expected.rawFurniturePrecision,
);
assert.equal(
  capturedScore.raw.furniture.recall,
  capturedFixture.expected.rawFurnitureRecall,
);

const furnitureCandidates = toolRequest(ninetyTwoImage, "contours", {
  spec: secondDraft,
});
const selectableObjects = furnitureCandidates.objectCandidates.filter(
  (objectCandidate) => objectCandidate.selectable,
);
assert.equal(selectableObjects.length, 11);
assert.equal(furnitureCandidates.activityGroupCandidates.length, 1);
assert.equal(
  furnitureCandidates.activityGroupCandidates[0].satelliteObjectCandidateIds
    .length,
  4,
);
assert.ok(
  selectableObjects.some(
    (objectCandidate) =>
      objectCandidate.categoryHints.includes("diningTable") &&
      objectCandidate.bbox[2] >= 70 &&
      objectCandidate.bbox[3] >= 40,
  ),
);
assert.ok(
  selectableObjects.some(
    (objectCandidate) =>
      objectCandidate.categoryHints.includes("tvCabinet") &&
      Math.min(objectCandidate.bbox[2], objectCandidate.bbox[3]) <= 26,
  ),
);

const objectEdges = secondReference.symbols.flatMap((symbol, symbolIndex) =>
  selectableObjects.map((objectCandidate, objectIndex) => ({
    symbolIndex,
    objectIndex,
    distance: Math.hypot(
      objectCandidate.center.x - symbol.x,
      objectCandidate.center.y - symbol.y,
    ),
  })),
);
const usedSymbols = new Set();
const usedObjects = new Set();
const objectMatches = [];
for (const edge of objectEdges.sort(
  (left, right) => left.distance - right.distance,
)) {
  if (usedSymbols.has(edge.symbolIndex) || usedObjects.has(edge.objectIndex))
    continue;
  usedSymbols.add(edge.symbolIndex);
  usedObjects.add(edge.objectIndex);
  objectMatches.push(edge);
}
assert.equal(objectMatches.length, secondReference.symbols.length);
for (const match of objectMatches) {
  const symbol = secondReference.symbols[match.symbolIndex];
  const objectCandidate = selectableObjects[match.objectIndex];
  const quarterTurn = [90, 270].includes(((symbol.rot % 360) + 360) % 360);
  let width = objectCandidate.bbox[2];
  let depth = objectCandidate.bbox[3];
  if (quarterTurn) [width, depth] = [depth, width];
  if (symbol.categoryCode === "chair") {
    width = depth = Math.max(width, depth, 18);
  }
  assert.ok(match.distance <= 150 / 17.7656);
  assert.ok(
    Math.abs(width - symbol.w) <= Math.max(100 / 17.7656, symbol.w * 0.15),
  );
  assert.ok(
    Math.abs(depth - symbol.d) <= Math.max(100 / 17.7656, symbol.d * 0.15),
  );
}

const output = {
  passed: true,
  modelCalls: 0,
  adapterVersion: "hpd-adapter-6-1",
  structureSkeletonVersion: 4,
  oneBedroom: {
    fallback: oneRecord.result.candidateSummary.fallback,
    walls: oneRecord.result.candidateWalls.length,
    openings: oneRecord.result.openingCandidates.length,
    dimensions: oneRecord.result.dimensionCandidates.length,
    compiledRooms: oneCompiled.rooms.length,
  },
  ninetyTwo: {
    walls: secondRecord.result.candidateWalls.length,
    openings: secondRecord.result.openingCandidates.length,
    dimensions: secondRecord.result.dimensionCandidates.length,
    compiledWalls: secondCompiled.state.plan.walls.length,
    compiledOpenings: secondCompiled.state.plan.openings.length,
    compiledRooms: secondCompiled.rooms.map((room) => room.name),
    wallPrecision: score.walls.precision,
    wallRecall: score.walls.recall,
    openingPrecision: score.openings.precision,
    openingRecall: score.openings.recall,
    furnitureObjectCandidates: furnitureCandidates.objectCandidates.length,
    furnitureSelectableObjects: selectableObjects.length,
    activityGroupCandidates: furnitureCandidates.activityGroupCandidates.length,
    activityGroupSatellites:
      furnitureCandidates.activityGroupCandidates[0].satelliteObjectCandidateIds
        .length,
    furnitureReferenceMatches: objectMatches.length,
  },
  capturedRoomMergeReplay: {
    taskId: capturedFixture.capturedTaskId,
    capturedRooms: capturedFixture.draft.rooms.length,
    consolidatedRooms: capturedConsolidation.rooms.length,
    compiledWalls: capturedCompiled.state.plan.walls.length,
    compiledOpenings: capturedCompiled.state.plan.openings.length,
    symbols: capturedCompiled.symbols.length,
    scoringPassed: capturedScore.passed,
  },
  note: "Offline candidate replay only; furniture classification, model passes and the real 2-of-2 gate are not claimed.",
};

console.log(JSON.stringify(output, null, 2));
