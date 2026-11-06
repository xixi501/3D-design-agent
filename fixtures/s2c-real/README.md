# Two real floorplan inputs — pending

The two user-provided images are not present. Do not substitute the synthetic tool fixture for this acceptance gate.

Create an operator-owned manifest outside Git, with exactly two cases:

```json
{
  "cases": [
    {"name":"case-a","image":"/absolute/path/to/a.png","reference":"/absolute/path/to/a.reference.json"},
    {"name":"case-b","image":"/absolute/path/to/b.jpg","reference":"/absolute/path/to/b.reference.json"}
  ]
}
```

Each reference is manually checked `FloorplanData` in EXIF-oriented original pixels, including reliable dimension anchors, all structural rooms/openings, target room IDs and visible target furniture. Use the same coordinate convention as the API; set `image` to the uploaded identity when preparing the reference. An optional manifest `aliases` map freezes equivalent category/room labels before running. Reference hashes are frozen in the batch index, and reference contents are never sent to recognition tools or model prompts.

1. Run `npm run test:floorplan:live -- --manifest /absolute/path/manifest.json --stage start`. This creates two attempts per actual image and pauses for operator confirmation. Open each printed workbench URL, inspect and correct the draft, then confirm. Recognition failures stay in the batch.
2. Run `npm run test:floorplan:live -- --stage collect --index /absolute/path/run-index.json`. This compares first recognition and confirmed results separately, checks correction limits, real four-role provenance, source/check evidence and atomic commit. Pending tasks yield exit 2; failed gates yield exit 1.
3. Keep every batch. Do not loosen thresholds or silently overwrite an earlier failed batch. The full S2 report additionally needs rectangular text and local-edit regression plus persistence/browser checks.
