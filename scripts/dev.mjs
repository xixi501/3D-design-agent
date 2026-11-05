import { spawn } from "node:child_process";
const children = [
  spawn("node", ["--import", "tsx", "--watch", "apps/service/src/main.ts"], {
    stdio: "inherit",
  }),
  spawn(
    "node",
    [
      "node_modules/vite/bin/vite.js",
      "--config",
      "apps/editor/vite.config.ts",
      "--host",
      "127.0.0.1",
    ],
    { stdio: "inherit" },
  ),
];
let closing = false;
function close() {
  if (closing) return;
  closing = true;
  children.forEach((child) => child.kill("SIGTERM"));
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, close);
children.forEach((child) => child.on("exit", close));
