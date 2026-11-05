import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
const python =
  process.env.ACTISCAPE_AGENT_PYTHON ||
  path.resolve(
    process.platform === "win32"
      ? ".venv/Scripts/python.exe"
      : ".venv/bin/python",
  );
if (!fs.existsSync(python))
  run(process.env.PYTHON || "python3", ["-m", "venv", ".venv"]);
run(python, [
  "-m",
  "pip",
  "install",
  "-r",
  "apps/agent/requirements.lock",
  "-e",
  "apps/agent",
]);
