import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createApp } from "../apps/service/src/app.ts";
const out = path.resolve(
  "test-results/floorplan-model-smoke",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
fs.mkdirSync(out, { recursive: true });
const { app, store, floorplans } = await createApp({
  dataDir: path.join(out, "data"),
  logger: false,
});
try {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${app.server.address().port}`,
    image = await floorplans.upload(
      fs.readFileSync("fixtures/s2c-synthetic.png"),
      "synthetic-protocol-only.png",
    ),
    project = store.create(
      (await import("../packages/scene-core/src/index.ts")).blankPlan(),
    );
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      path.resolve(".venv/bin/python"),
      [
        "scripts/floorplan-model-smoke.py",
        "--base",
        base,
        "--image",
        image.id,
        "--project",
        project.id,
        "--out",
        out,
      ],
      { stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("exit", resolve);
  });
  process.exitCode = code ?? 1;
} finally {
  await app.close();
}
