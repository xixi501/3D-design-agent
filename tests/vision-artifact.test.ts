import test from "node:test";
import assert from "node:assert/strict";
import {
  FLOORPLAN_VISION_ARTIFACT_SCHEMA,
  validateFloorplanVisionArtifact,
  type FloorplanVisionArtifact,
} from "../packages/scene-core/src/vision-artifact.js";
import { canonicalJson, sha256 } from "../scripts/quality/artifact-seal.js";

function artifact(): FloorplanVisionArtifact {
  return {
    schemaVersion: FLOORPLAN_VISION_ARTIFACT_SCHEMA,
    artifactId: "provider:test",
    provider: {
      id: "provider",
      version: "1.0.0",
      repository: "local/test",
      commit: "abc123",
      license: "MIT",
    },
    input: {
      imageSha256: "a".repeat(64),
      width: 1000,
      height: 800,
      coordinateSpace: "exif-oriented-original-pixels",
    },
    scope: {
      roomSelection: "all_visible",
      functionalAreas: [],
      excludeFunctionalAreas: [],
    },
    capabilities: {
      walls: true,
      openings: true,
      dimensions: true,
      rooms: false,
      symbols: false,
    },
    candidates: {
      walls: [
        {
          id: "cw_1",
          orientation: "h",
          line: 120,
          start: 20,
          end: 500,
          thickness: 8,
          evidenceRefs: ["provider:wall:1"],
        },
      ],
      openings: [
        {
          id: "op_1",
          wallCandidateId: "cw_1",
          orientation: "h",
          line: 120,
          start: 180,
          end: 240,
          typeHint: "door",
          evidenceRefs: ["provider:opening:1"],
        },
      ],
      dimensions: [],
      rooms: [],
      symbols: [],
    },
    evidenceFiles: [
      {
        id: "candidates.png",
        kind: "overlay",
        path: "artifacts/candidates.png",
        sha256: "b".repeat(64),
        mediaType: "image/png",
      },
    ],
    limitations: ["仅结构候选"],
    audit: {
      modelCalls: 0,
      referenceAccess: "denied-and-audited",
      candidateInputs: ["image.bytes", "scope", "adapterVersion"],
    },
  };
}

test("vision artifact v1 validates the strict pixel-space contract", () => {
  const parsed = validateFloorplanVisionArtifact(artifact());
  assert.equal(parsed.candidates.walls[0].id, "cw_1");
  assert.equal(parsed.candidates.openings[0].wallCandidateId, "cw_1");
  assert.equal(canonicalJson(parsed), canonicalJson(artifact()));
});

test("vision artifact rejects undeclared candidate capabilities", () => {
  const value = artifact();
  value.candidates.rooms.push({
    id: "room_1",
    bbox: [10, 10, 100, 100],
    evidenceRefs: ["provider:room:1"],
  });
  assert.throws(
    () => validateFloorplanVisionArtifact(value),
    /未声明 rooms 能力/,
  );
});

test("vision artifact seal hash changes with candidate content", () => {
  const first = artifact();
  const second = artifact();
  second.candidates.walls[0].end = 501;
  assert.notEqual(sha256(canonicalJson(first)), sha256(canonicalJson(second)));
});
