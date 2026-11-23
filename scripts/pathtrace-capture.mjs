import fs from "node:fs";
import path from "node:path";
import { launch } from "../reference/upstream/scripts/browser.mjs";

const base = process.env.ACTISCAPE_URL || "http://127.0.0.1:3131";
const project = process.env.ACTISCAPE_PROJECT || "bf7acd71-35ff-4cbc-8d64-1ba48c6c1420";
const out = path.resolve(process.env.CAPTURE_DIR || "/workspace/actiscape-data/handoff/pathtrace-smoke");
fs.mkdirSync(out, { recursive: true });
const browser = await launch({ gpu: false, viewport: { width: 1000, height: 760 } });
try {
  const page = await browser.newPage();
  const token = process.env.ACTISCAPE_TOOL_TOKEN?.trim();
  if (token) await page.setExtraHTTPHeaders({ Authorization: `Bearer ${token}`, "x-actiscape-token": token });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (["error", "warning"].includes(message.type())) console.log(message.type(), message.text()); });
  await page.goto(`${base}/?project=${project}&debug&pathtrace`, { waitUntil: "load" });
  await page.waitForFunction(() => __actiscape?.three?.photoReady, { timeout: 30000 });
  await page.click("[data-view='3d']");
  await page.waitForFunction(() => __actiscape.three.photoTracer.samples >= 8, { timeout: 300000 });
  await (await page.$("#three-view")).screenshot({ path: path.join(out, "pathtrace.png") });
  console.log(JSON.stringify({ samples: await page.evaluate(() => __actiscape.three.photoTracer.samples), errors, output: out }));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
