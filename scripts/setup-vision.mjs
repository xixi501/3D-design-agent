import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const toolRoot =
  process.env.ACTISCAPE_TOOLS_DIR || path.resolve("..", ".actiscape-tools");
const root = path.join(toolRoot, "vllm-vision");
const python = path.join(
  root,
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
};

if (!fs.existsSync(python)) run("python3", ["-m", "venv", root]);
run(python, ["-m", "pip", "install", "--upgrade", "pip"]);
run(python, ["-m", "pip", "install", "vllm==0.33.0", "huggingface_hub[cli]"]);

if (process.argv.includes("--download")) {
  const model =
    process.env.ACTISCAPE_VISION_MODEL || "Qwen/Qwen3-VL-32B-Instruct-FP8";
  const cache =
    process.env.ACTISCAPE_VISION_CACHE || path.join(toolRoot, "models");
  run(python, [
    "-c",
    [
      "from huggingface_hub import snapshot_download",
      `snapshot_download('${model}', cache_dir='${cache}')`,
    ].join(";"),
  ]);
}

console.log(
  JSON.stringify({
    python,
    downloaded: process.argv.includes("--download"),
  }),
);
