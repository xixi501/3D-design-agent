import fs from "node:fs";
import { spawnSync } from "node:child_process";
const python =
  process.env.ACTISCAPE_PYTHON ||
  (fs.existsSync(".tools/reference-python/bin/python")
    ? ".tools/reference-python/bin/python"
    : "python3");
fs.mkdirSync("reference/runtime", { recursive: true });
const result = spawnSync(
  python,
  [
    "reference/upstream/scripts/build.py",
    "fixtures/living-dining.spec.json",
    "-o",
    "reference/runtime/living-dining.html",
    "--no-underlay",
  ],
  { stdio: "inherit" },
);
if (result.status !== 0) {
  console.error(
    "Reference build needs Python with Pillow. See docs/RUNBOOK.md.",
  );
  process.exit(1);
}
