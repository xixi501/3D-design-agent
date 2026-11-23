import fs from "node:fs";
import path from "node:path";
import { launch, gpuInfo } from "../reference/upstream/scripts/browser.mjs";

const asset = process.env.ACTISCAPE_ASSET || "b18e5b47-f55f-4168-baaf-741f8477daad";
const base = process.env.ASSET_URL || "http://127.0.0.1:3133";
const out = path.resolve(process.env.CAPTURE_DIR || "/workspace/actiscape-data/handoff/asset-realism-demo");
fs.mkdirSync(out, { recursive: true });
const browser = await launch({ gpu: false, viewport: { width: 1440, height: 1000 } });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => { errors.push(error.message); console.log(error.stack); });
  page.on("console", (message) => console.log(message.type(), message.text()));
  page.on("response", (response) => { if (response.status() >= 400) console.log("HTTP", response.status(), response.url()); });
  await page.goto(`${base}/?asset=${asset}`, { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelector("#meta-mode")?.textContent.includes("5 视角"), { timeout: 60000 });
  for (const angle of [0, 180, -90, 90]) {
    await page.click(`[data-view-angle="${angle}"]`);
    await new Promise((resolve) => setTimeout(resolve, 800));
    await (await page.$("#viewer")).screenshot({ path: path.join(out, `view-${angle}.png`) });
  }
  const assetMetadata = await fetch(`${base}/api/v1/assets/${asset}`).then((response) => response.json());
  fs.writeFileSync(path.join(out, "asset.json"), JSON.stringify(assetMetadata, null, 2));
  console.log(JSON.stringify({ asset, output: out, gpu: await gpuInfo(page), errors }));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
