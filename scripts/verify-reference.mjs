import fs from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const provenance = JSON.parse(
  fs.readFileSync("reference/upstream/provenance.json", "utf8"),
);
for (const [file, sha256] of Object.entries(provenance.files)) {
  const data = fs.readFileSync("reference/upstream/" + file);
  assert.equal(createHash("sha256").update(data).digest("hex"), sha256, file);
}
const manifest = JSON.parse(
  fs.readFileSync("docs/extraction-manifest.json", "utf8"),
);
for (const module of manifest.modules) {
  assert.deepEqual(module.unexpectedVendor, [], module.file);
  if (module.file.startsWith("packages/"))
    assert.doesNotMatch(
      fs.readFileSync(module.file, "utf8"),
      /\b(?:window|document|localStorage|indexedDB)\s*[.(]/,
    );
}
console.log(
  `Verified ${Object.keys(provenance.files).length} immutable files and ${manifest.modules.length} extracted modules`,
);
