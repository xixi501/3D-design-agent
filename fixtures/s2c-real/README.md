# Two real floorplan inputs

The first acceptance image is the published one-bedroom plan. The second is the original 736×673 “92” raster. The developer-built “92” scene from 2026-11-06 was rejected and is not used as a reference. A new independent source-pixel reference was frozen on 2026-11-08 in `ninety-two.evaluation-only.json`; V3-6 corrected it by source evidence to six rooms, eleven openings and eleven target furniture symbols. Fixed entry cabinets are excluded under the approved target-room rule. Do not substitute the synthetic tool fixture, the rejected manual scene, or duplicate either source image.

The first image passed its formal 2/2 gate at business commit `30b1f06`. The second image’s first real attempt at `de61350` failed in the fixed candidate layer and the second attempt was cancelled under the stop-on-failure rule. A later V3-6 attempt, task `50e643f4-2f6d-4ff1-80f4-d15252cb2467`, recognized walls, openings and furniture at 1.0 precision/recall but stopped on a fixed-code open-room label merge bug. The next attempt, task `40980242-1762-41de-813d-ac7da3d1f285`, compiled and scored successfully with zero corrections but stopped because the final review mixed source and scene IDs and falsely claimed opening overflow. Both exact failures are frozen in `ninety-two.v36-room-merge-replay.json` and `ninety-two.v36-review-identity-replay.json`, and are replayed by `npm run test:floorplan:v36-replay`. The second image is currently 0/2. See `docs/S2C_SECOND_IMAGE.md`. A formal two-case matrix manifest remains pending because the second image has not passed.

Create an operator-owned manifest outside Git, with exactly two cases:

```json
{
  "cases": [
    {
      "name": "case-a",
      "image": "/absolute/path/to/a.png",
      "reference": "/absolute/path/to/a.reference.json"
    },
    {
      "name": "case-b",
      "image": "/absolute/path/to/b.jpg",
      "reference": "/absolute/path/to/b.reference.json"
    }
  ]
}
```

Each reference is manually checked `FloorplanData` in EXIF-oriented original pixels, including reliable dimension anchors, all structural rooms/openings, target room IDs and visible target furniture. Use the same coordinate convention as the API; set `image` to the uploaded identity when preparing the reference. Before starting any model tasks, every target reference symbol must have `catalogKey`, or a case-level `allowedCatalogueKeys` map from reference symbol ID to acceptable real catalogue keys. This checks actual instantiated furniture, rather than merely trusting labels in the draft; allow equivalent catalogue appearances where appropriate. Both complete references are validated before starting the batch.

An optional manifest `aliases` map freezes equivalent category/room labels before running. Reference hashes are frozen in the batch index, and reference contents are never sent to recognition tools or model prompts.

1. Run `npm run test:floorplan:live -- --manifest /absolute/path/manifest.json --stage start`. This creates two attempts per actual image and pauses for operator confirmation. Open each printed workbench URL, inspect and correct the draft, then confirm. Recognition failures stay in the batch.
2. Run `npm run test:floorplan:live -- --stage collect --index /absolute/path/run-index.json`. This compares first recognition and confirmed results separately, checks correction limits, real four-role provenance, source/check evidence and atomic commit. Pending tasks yield exit 2; failed gates yield exit 1.
3. Keep every batch. Do not loosen thresholds or silently overwrite an earlier failed batch. The full S2 report additionally needs rectangular text and local-edit regression plus persistence/browser checks.

## Frozen single-image development reference

`one-bedroom.evaluation-only.json` was frozen independently before business changes (commit `0316519`). Its SHA is in `one-bedroom.evaluation-manifest.json`; category aliases are normalized before the new batch. The live probe reads it only for scoring; never pass its contents to Agent inputs, tools or the production service. It contains approximate source-pixel observations, not a replacement scene. Single-image object correction limit is zero. This one-case development reference does not complete the formal two-case manifest or establish catalogue instance mapping. Business `71226cf` two real runs failed; see `docs/S2C_SINGLE_IMAGE.md`.
