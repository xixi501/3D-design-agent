# Two real floorplan inputs — pending

The user currently selected one real "92" floorplan for a feasibility pilot; the earlier image was superseded and is not a second acceptance case. Originals, task traces and drafts stay in the local data/test-results directories. The two-case acceptance manifest and frozen references remain pending. Do not substitute the synthetic tool fixture or duplicate the active image for this gate.

Correction: the user rejected the manually built "92" layout as structurally different. Its fidelity claim has been withdrawn; rendering/storage success does not count as recognition. The current internal tool probe uses one frozen published FloorPlan Creator image (`one-bedroom-system-probe.json`), without manual geometry or reference data in the Agent input. Its before/after runs all failed; this is not the formal two-image acceptance set. See `docs/S2C_UPSTREAM_TOOLS.md` for the six preserved runs and limitations.

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
