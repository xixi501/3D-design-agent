/** Minimal isolated image runtime for Node tests; production agents retain their Python 3.13 environment. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const executable = (directory) =>
  path.resolve(
    directory,
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
export function imagePython() {
  const configured =
    process.env.ACTISCAPE_IMAGE_PYTHON ||
    process.env.ACTISCAPE_AGENT_PYTHON ||
    process.env.ACTISCAPE_PYTHON;
  if (configured) return configured;
  return (
    [executable(".venv"), executable(".tools/image-python")].find((file) =>
      fs.existsSync(file),
    ) || executable(".tools/image-python")
  );
}
function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw Error("Image runtime setup failed: " + command);
}
export function ensureImageRuntime() {
  const python = imagePython();
  const probe = spawnSync(
    python,
    ["-c", "import sys;assert sys.version_info >= (3,12)"],
    { stdio: "ignore" },
  );
  if (probe.error || probe.status !== 0) {
    if (fs.existsSync(python))
      throw Error(
        "The image helper requires Python >=3.12; full agents require Python 3.13.",
      );
    if (!["bin", "Scripts"].includes(path.basename(path.dirname(python))))
      throw Error(
        "Configure an existing interpreter or a virtual-environment bin/python path.",
      );
    const cachedRoot =
      process.env.RUNNER_TOOL_CACHE &&
      path.join(process.env.RUNNER_TOOL_CACHE, "Python");
    const cached =
      cachedRoot && fs.existsSync(cachedRoot)
        ? fs
            .readdirSync(cachedRoot)
            .filter((v) => v.startsWith("3.13."))
            .sort()
            .reverse()
            .map((v) =>
              path.join(
                cachedRoot,
                v,
                process.arch === "arm64" ? "arm64" : "x64",
                "bin",
                "python",
              ),
            )
        : [];
    const seeds = [
      executable(".venv"),
      ...cached,
      "python3.13",
      "python3",
      "python",
    ];
    const seed = seeds.find((candidate) => {
      const p = spawnSync(
        candidate,
        ["-c", "import sys;assert sys.version_info >= (3,12)"],
        { stdio: "ignore" },
      );
      return !p.error && p.status === 0;
    });
    if (!seed)
      throw Error(
        "Python >=3.12 is required for image-only Node checks; full agent setup requires Python 3.13.",
      );
    const directory = path.dirname(path.dirname(python));
    run(seed, ["-m", "venv", directory]);
  }
  const ready = spawnSync(python, ["-c", "import PIL,cv2,numpy"], {
    stdio: "ignore",
  });
  if (ready.status === 0) return;
  const isolated = spawnSync(
    python,
    ["-c", "import sys;assert sys.prefix != sys.base_prefix"],
    { stdio: "ignore" },
  );
  if (isolated.status !== 0)
    throw Error(
      "Image dependencies are missing; configure a virtual environment or run npm run setup:agent. System Python is not modified.",
    );
  const lines = fs
      .readFileSync("apps/agent/requirements.lock", "utf8")
      .split(/\r?\n/),
    packages = ["pillow", "numpy", "opencv-python-headless"].map((name) =>
      lines.find((line) => line.toLowerCase().startsWith(name + "==")),
    );
  if (packages.some((p) => !p))
    throw Error("Locked image dependency versions are required");
  run(python, ["-m", "pip", "install", ...packages]);
  run(python, ["-c", "import PIL,cv2,numpy"]);
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  ensureImageRuntime();
