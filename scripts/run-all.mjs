import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const development = process.argv.includes("--dev");
const python =
  process.env.ACTISCAPE_AGENT_PYTHON ||
  path.resolve(
    process.platform === "win32"
      ? ".venv/Scripts/python.exe"
      : ".venv/bin/python",
  );
if (!fs.existsSync(python))
  throw new Error("缺少 Agent Python 环境，请先运行 npm run setup:agent");
const children = [
  spawn(
    process.execPath,
    [
      "--env-file-if-exists=.env",
      "--import",
      "tsx",
      ...(development ? ["--watch"] : []),
      "apps/service/src/main.ts",
    ],
    { stdio: "inherit" },
  ),
  spawn(python, ["-m", "actiscape_agent"], { stdio: "inherit" }),
];
if (development)
  children.push(
    spawn(
      process.execPath,
      [
        "node_modules/vite/bin/vite.js",
        "--config",
        "apps/editor/vite.config.ts",
        "--host",
        "127.0.0.1",
      ],
      { stdio: "inherit" },
    ),
  );
let closing = false;
function close() {
  if (closing) return;
  closing = true;
  children.forEach((child) => child.kill("SIGTERM"));
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, close);
for (const child of children) {
  child.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
    close();
  });
  child.on("exit", (code) => {
    if (!closing && code) process.exitCode = code;
    close();
  });
}
