import fs from "node:fs";
import path from "node:path";
import {
  candidateRate,
  exactDuplicateRate,
  maximumCardinalityMinimumCostMatching,
  pixelWallCoverage,
  type MatchEdge,
  type PixelAxisSegment,
} from "../../packages/scene-core/src/floorplan-quality.js";
import {
  validateFloorplanVisionArtifact,
  type FloorplanVisionArtifact,
  type PixelOpeningCandidate,
} from "../../packages/scene-core/src/vision-artifact.js";
import {
  floorplanScale,
  validateFloorplan,
  type FloorplanData,
} from "../../packages/scene-core/src/floorplan.js";
import {
  parseArgs,
  readJson,
  relativePath,
  sha256,
  writeSealedJson,
} from "./artifact-seal.js";

const root = process.cwd();
const CANDIDATE_COVERAGE_GATE = 0.95;
const PIXEL_TOLERANCE_MM = 100;

interface CaptureRecord {
  schemaVersion: string;
  status: string;
  image: {
    id: string;
    file: string;
    sha256: string;
    width: number;
    height: number;
  };
  artifact: {
    file: string;
    sha256: string;
    schemaVersion: string;
  };
  isolation: {
    mode: string;
    candidateReferenceRootAccess: string;
    referenceProbe: { result: string };
    audit: { attemptCount?: number };
  };
  modelCalls: number;
}

interface ReferenceOpeningGeometry extends PixelAxisSegment {
  id: string;
  type: "door" | "window";
  centre: number;
  width: number;
}

function referenceWalls(reference: FloorplanData): PixelAxisSegment[] {
  return reference.walls.map((wall) => {
    const vertical = Math.abs(wall.a.x - wall.b.x) <= 1;
    return {
      orientation: vertical ? "v" : "h",
      line: vertical ? wall.a.x : wall.a.y,
      start: vertical
        ? Math.min(wall.a.y, wall.b.y)
        : Math.min(wall.a.x, wall.b.x),
      end: vertical
        ? Math.max(wall.a.y, wall.b.y)
        : Math.max(wall.a.x, wall.b.x),
    };
  });
}

function referenceOpenings(
  reference: FloorplanData,
): ReferenceOpeningGeometry[] {
  const walls = new Map(reference.walls.map((wall) => [wall.id, wall]));
  return reference.openings.map((opening) => {
    const wall = walls.get(opening.wallId);
    if (!wall) throw new Error(`参考门窗 ${opening.id} 引用了未知墙`);
    const vertical = Math.abs(wall.a.x - wall.b.x) <= 1;
    const start = vertical
      ? Math.min(wall.a.y, wall.b.y)
      : Math.min(wall.a.x, wall.b.x);
    const end = vertical
      ? Math.max(wall.a.y, wall.b.y)
      : Math.max(wall.a.x, wall.b.x);
    const centre = start + opening.offset;
    return {
      id: opening.id,
      orientation: vertical ? "v" : "h",
      line: vertical ? wall.a.x : wall.a.y,
      start: centre - opening.width / 2,
      end: centre + opening.width / 2,
      centre,
      width: opening.width,
      type: opening.type === "window" ? "window" : "door",
    };
  });
}

function openingMatches(
  actual: PixelOpeningCandidate[],
  reference: ReferenceOpeningGeometry[],
  centreTolerance: number,
  widthTolerance: number,
) {
  const edges: MatchEdge[] = [];
  for (let actualIndex = 0; actualIndex < actual.length; actualIndex += 1) {
    const candidate = actual[actualIndex];
    const candidateCentre = (candidate.start + candidate.end) / 2;
    const candidateWidth = candidate.end - candidate.start;
    for (
      let referenceIndex = 0;
      referenceIndex < reference.length;
      referenceIndex += 1
    ) {
      const expected = reference[referenceIndex];
      if (
        candidate.orientation !== expected.orientation ||
        Math.abs(candidate.line - expected.line) > centreTolerance
      )
        continue;
      const centreError = Math.abs(candidateCentre - expected.centre);
      const widthError = Math.abs(candidateWidth - expected.width);
      if (centreError > centreTolerance || widthError > widthTolerance)
        continue;
      edges.push({
        actual: actualIndex,
        reference: referenceIndex,
        cost: centreError / centreTolerance + widthError / widthTolerance,
      });
    }
  }
  const matching = maximumCardinalityMinimumCostMatching(
    actual.length,
    reference.length,
    edges,
  );
  const matchedReference = new Set(
    matching.matches.map((match) => match.reference),
  );
  const matchedActual = new Set(matching.matches.map((match) => match.actual));
  const typeMatches = matching.matches.filter((match) => {
    const type = actual[match.actual].typeHint;
    return type === "unknown" || type === reference[match.reference].type;
  }).length;
  return {
    matching,
    precision: actual.length ? matching.matches.length / actual.length : 0,
    recall: reference.length ? matching.matches.length / reference.length : 1,
    typeAccuracy: matching.matches.length
      ? typeMatches / matching.matches.length
      : 0,
    ambiguousReferenceRate: reference.length
      ? matching.ambiguousReferenceCount / reference.length
      : 0,
    duplicateRate: exactDuplicateRate(actual),
    candidateCountRatio: candidateRate(actual.length, reference.length),
    missingReferenceIds: reference
      .filter((_, index) => !matchedReference.has(index))
      .map((item) => item.id),
    unmatchedCandidateIds: actual
      .filter((_, index) => !matchedActual.has(index))
      .map((item) => item.id),
    matches: matching.matches.map((match) => ({
      candidateId: actual[match.actual].id,
      referenceId: reference[match.reference].id,
      cost: match.cost,
    })),
  };
}

function main() {
  const args = parseArgs();
  const captureFile = path.resolve(args.required("capture"));
  const outputFile = path.resolve(
    args.get("output") || path.join(path.dirname(captureFile), "score.json"),
  );
  const capture = readJson<CaptureRecord>(captureFile);
  const directory = path.dirname(captureFile);
  const artifactFile = path.resolve(directory, capture.artifact.file);
  const artifactBytes = fs.readFileSync(artifactFile);
  const artifactSha256 = sha256(artifactBytes);
  const artifact = validateFloorplanVisionArtifact(
    JSON.parse(artifactBytes.toString("utf8")),
  ) as FloorplanVisionArtifact;

  const referenceFile = path.resolve(
    args.get("reference") ||
      path.join(
        root,
        "fixtures/full-home-candidates",
        `${capture.image.id}.evaluation-only.json`,
      ),
  );
  const manifestFile = path.resolve(
    args.get("manifest") ||
      path.join(
        root,
        "fixtures/full-home-candidates",
        `${capture.image.id}.evaluation-manifest.json`,
      ),
  );
  // This process is deliberately separate from capture. The reference is not
  // loaded until the candidate artifact has been read and hash-checked above.
  const referenceBytes = fs.readFileSync(referenceFile);
  const referenceSha256 = sha256(referenceBytes);
  const manifest = readJson<Record<string, any>>(manifestFile);
  const reference = validateFloorplan(
    JSON.parse(referenceBytes.toString("utf8")),
  );

  const sourceCopy = path.resolve(directory, capture.image.file);
  const sourceSha256 = sha256(fs.readFileSync(sourceCopy));
  const expectedWalls = referenceWalls(reference);
  const expectedOpenings = referenceOpenings(reference);
  const millimetresPerPixel = floorplanScale(reference);
  const pixelTolerance = PIXEL_TOLERANCE_MM / millimetresPerPixel;
  const wallCoverage = pixelWallCoverage(
    artifact.candidates.walls,
    expectedWalls,
    pixelTolerance,
    pixelTolerance,
  );
  const openingScore = openingMatches(
    artifact.candidates.openings,
    expectedOpenings,
    pixelTolerance,
    pixelTolerance,
  );
  const expectedRoomCount = reference.rooms.length;
  const expectedSymbolCount = reference.symbols.filter(
    (symbol) =>
      reference.targetRoomIds.includes(symbol.roomId) &&
      symbol.included !== false,
  ).length;

  const methodologyChecks = [
    {
      id: "ARTIFACT_HASH",
      passed: artifactSha256 === capture.artifact.sha256,
      expected: capture.artifact.sha256,
      actual: artifactSha256,
    },
    {
      id: "ARTIFACT_SCHEMA",
      passed:
        artifact.schemaVersion === capture.artifact.schemaVersion &&
        artifact.input.imageSha256 === capture.image.sha256,
    },
    {
      id: "SOURCE_HASH",
      passed:
        sourceSha256 === capture.image.sha256 &&
        artifact.input.imageSha256 === capture.image.sha256,
    },
    {
      id: "REFERENCE_HASH",
      passed:
        referenceSha256 === manifest.referenceSha256 &&
        reference.image.sha256 === capture.image.sha256,
    },
    {
      id: "REFERENCE_ACCESS_DENIED",
      passed:
        capture.isolation.candidateReferenceRootAccess === "denied" &&
        capture.isolation.referenceProbe.result === "denied" &&
        artifact.audit.referenceAccess === "denied-and-audited",
    },
    {
      id: "REFERENCE_AUDIT_CLEAN",
      passed: (capture.isolation.audit.attemptCount || 0) === 0,
    },
    {
      id: "REFERENCE_SCORED_AFTER_SEAL",
      passed: true,
    },
    {
      id: "NO_MODEL_CALLS",
      passed: capture.modelCalls === 0 && artifact.audit.modelCalls === 0,
    },
  ];
  const methodologyPassed = methodologyChecks.every((check) => check.passed);
  const wallsCandidatePassed = wallCoverage.recall >= CANDIDATE_COVERAGE_GATE;
  const openingsCandidatePassed =
    openingScore.recall >= CANDIDATE_COVERAGE_GATE;
  const candidatePoolPassed = wallsCandidatePassed && openingsCandidatePassed;

  const report = {
    schemaVersion: "actiscape.floorplan-quality-score.v1",
    generatedAt: new Date().toISOString(),
    evaluationKind: "production-like-zero-model-candidate-pool",
    imageId: capture.image.id,
    status: methodologyPassed ? "baseline-blocked" : "invalid",
    passed: false,
    methodologyPassed,
    decision: methodologyPassed
      ? "architecture-may-continue; do-not-use-candidate-score-for-model-selection"
      : "stop-quality-pipeline",
    modelCalls: 0,
    referenceUsage:
      "Loaded only by the scoring process after the candidate artifact was sealed and hash-checked",
    thresholds: {
      candidateCoverageRecall: CANDIDATE_COVERAGE_GATE,
      finalSelectionQuality: "not-measured",
    },
    source: {
      candidateSha256: artifactSha256,
      imageSha256: sourceSha256,
      referenceSha256,
      referenceFile: relativePath(root, referenceFile),
      manifestFile: relativePath(root, manifestFile),
    },
    methodologyChecks,
    walls: {
      measured: true,
      candidateCount: artifact.candidates.walls.length,
      referenceCount: expectedWalls.length,
      candidateCountRatio: candidateRate(
        artifact.candidates.walls.length,
        expectedWalls.length,
      ),
      millimetresPerPixel,
      lineTolerancePx: pixelTolerance,
      extentTolerancePx: pixelTolerance,
      precision: wallCoverage.precision,
      coverageRecall: wallCoverage.recall,
      duplicateRate: exactDuplicateRate(artifact.candidates.walls),
      candidateCoveragePassed: wallsCandidatePassed,
    },
    openings: {
      measured: true,
      ...openingScore,
      candidateCount: artifact.candidates.openings.length,
      referenceCount: expectedOpenings.length,
      candidateCoveragePassed: openingsCandidatePassed,
    },
    rooms: {
      measured: false,
      referenceCount: expectedRoomCount,
      candidateCount: artifact.candidates.rooms.length,
      reason: "本批 HPD 未声明从自身墙图推导封闭房间的能力；不得读取参考房间",
    },
    furnitureGeometry: {
      measured: false,
      referenceCount: expectedSymbolCount,
      candidateCount: artifact.candidates.symbols.length,
      reason: "本批不执行盲家具轮廓提取；不得以参考房间掩膜代替候选",
    },
    selection: {
      measured: false,
      reason: "未调用模型或选择器，不能计算最终 precision/recall",
    },
    candidatePool: {
      passed:
        candidatePoolPassed &&
        artifact.capabilities.rooms &&
        artifact.capabilities.symbols,
      wallsCoveragePassed: wallsCandidatePassed,
      openingsCoveragePassed: openingsCandidatePassed,
      roomsCoverageMeasured: artifact.capabilities.rooms,
      furnitureCoverageMeasured: artifact.capabilities.symbols,
    },
    blockingReasons: [
      ...(methodologyPassed ? [] : ["QUALITY_METHODOLOGY_INVALID"]),
      ...(wallsCandidatePassed ? [] : ["WALL_CANDIDATE_COVERAGE_BELOW_GATE"]),
      ...(openingsCandidatePassed
        ? []
        : ["OPENING_CANDIDATE_COVERAGE_BELOW_GATE"]),
      "ROOM_CANDIDATES_NOT_MEASURED",
      "FURNITURE_CANDIDATES_NOT_MEASURED",
      "FINAL_SELECTION_NOT_MEASURED",
    ],
    notClaimed: [
      "真实模型识别率",
      "房间或家具候选召回",
      "最终选择质量",
      "自动零人工校正通过",
    ],
  };
  const reportSha256 = writeSealedJson(outputFile, report);
  console.log(
    JSON.stringify(
      {
        status: report.status,
        imageId: report.imageId,
        methodologyPassed,
        walls: report.walls,
        openings: {
          candidateCount: report.openings.candidateCount,
          referenceCount: report.openings.referenceCount,
          precision: report.openings.precision,
          recall: report.openings.recall,
          duplicateRate: report.openings.duplicateRate,
          ambiguousReferenceRate: report.openings.ambiguousReferenceRate,
        },
        candidatePool: report.candidatePool,
        blockingReasons: report.blockingReasons,
        reportFile: path.relative(root, outputFile),
        reportSha256,
      },
      null,
      2,
    ),
  );
  if (!methodologyPassed) process.exitCode = 1;
}

main();
