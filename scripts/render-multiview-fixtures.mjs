import fs from "node:fs";
import path from "node:path";
import { launch } from "../reference/upstream/scripts/browser.mjs";

const out = path.resolve("/workspace/actiscape-data/handoff/category-fixtures");
const fixtureAssets = path.resolve("apps/asset-service/asset_service/static/hero-assets");
fs.mkdirSync(fixtureAssets, { recursive: true });
for (const model of ["sofa-01", "bed-02", "desk-lamp-01", "plant-02"]) {
  fs.copyFileSync(path.resolve(`apps/editor/public/hero-assets/${model}.glb`), path.join(fixtureAssets, `${model}.glb`));
}
const browser = await launch({ gpu: false, viewport: { width: 700, height: 700 } });
try {
  const page = await browser.newPage();
  for (const model of ["sofa-01", "bed-02", "desk-lamp-01", "plant-02"]) {
    const directory = path.join(out, model);
    fs.mkdirSync(directory, { recursive: true });
    await page.goto(`http://127.0.0.1:3133/multiview-fixture.html?model=${model}`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__fixtureReady, { timeout: 60000 });
    for (const angle of ["front", "back", "left", "right", "top"]) {
      const data = await page.evaluate((angle) => window.__setAngle(angle), angle);
      fs.writeFileSync(path.join(directory, `${angle}.png`), Buffer.from(data.split(",")[1], "base64"));
    }
    console.log(`Rendered ${model}`);
  }
} finally {
  await browser.close();
}
