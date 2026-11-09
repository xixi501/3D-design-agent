import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  compileFloorplan,
  validateFloorplan,
} from "../packages/scene-core/src/floorplan.js";

const root = "fixtures/full-home-candidates";
const references = [
  {
    id: "2bhk-bungalow",
    rooms: 9,
    symbols: 21,
    walls: 16,
    openings: 15,
  },
  {
    id: "oak-ridge-c",
    rooms: 10,
    symbols: 15,
    walls: 18,
    openings: 14,
  },
];

function hash(file: string) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

for (const expected of references) {
  test(`${expected.id} is a hash-bound compilable full-home development reference`, () => {
    const referenceFile = path.join(
      root,
      `${expected.id}.evaluation-only.json`,
    );
    const manifestFile = path.join(
      root,
      `${expected.id}.evaluation-manifest.json`,
    );
    const reference = JSON.parse(fs.readFileSync(referenceFile, "utf8"));
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));

    assert.equal(manifest.status, "development-reference-reviewed");
    assert.equal(manifest.referenceSha256, hash(referenceFile));
    assert.equal(manifest.sourceImageSha256, reference.image.sha256);
    assert.equal(
      hash(path.join(root, manifest.overlayReview.file)),
      manifest.overlayReview.sha256,
    );
    assert.equal(
      hash(path.join(root, `${expected.id}.jpg`)),
      reference.image.sha256,
    );
    assert.equal(
      validateFloorplan(reference).targetRoomIds.length,
      expected.rooms,
    );
    assert.equal(reference.walls.length, expected.walls);
    assert.equal(reference.openings.length, expected.openings);
    assert.equal(reference.rooms.length, expected.rooms);
    assert.equal(reference.symbols.length, expected.symbols);
    assert.deepEqual(
      reference.targetRoomIds.slice().sort(),
      reference.rooms.map((room: any) => room.id).sort(),
    );

    const compiled = compileFloorplan(reference, `test-${expected.id}`);
    assert.equal(compiled.rooms.length, expected.rooms);
    assert.equal(compiled.symbols.length, expected.symbols);
    assert.equal(compiled.scale.mmPerPixel > 0, true);
  });
}
