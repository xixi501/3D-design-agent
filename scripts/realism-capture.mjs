import fs from "node:fs";
import path from "node:path";
import { launch } from "../reference/upstream/scripts/browser.mjs";

const base = process.env.ACTISCAPE_URL || "http://127.0.0.1:3131";
const out = path.resolve(process.env.CAPTURE_DIR || "test-results/realism");
fs.mkdirSync(out, { recursive: true });
const browser = await launch({ gpu: false, viewport: { width: 1440, height: 900 } });
try {
  const page = await browser.newPage();
  const token = process.env.ACTISCAPE_TOOL_TOKEN?.trim();
  if (token) await page.setExtraHTTPHeaders({ Authorization: `Bearer ${token}`, "x-actiscape-token": token });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let project = process.env.ACTISCAPE_PROJECT;
  const headers = token ? { Authorization: `Bearer ${token}`, "x-actiscape-token": token, "content-type": "application/json" } : { "content-type": "application/json" };
  if (!project) {
    const document = await fetch(`${base}/api/examples/living-dining`, { headers }).then((response) => response.json());
    const created = await fetch(`${base}/api/projects`, { method: "POST", headers, body: JSON.stringify({ document }) }).then((response) => response.json());
    if (!created.id) throw Error(JSON.stringify(created));
    project = created.id;
  }
  await page.goto(`${base}/?project=${project}&debug&realism`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__actiscape?.project && !__actiscape.busy && document.querySelector("#save-state")?.textContent?.startsWith("已保存"), { timeout: 60000 });
  await page.click(`[data-view="3d"]`);
  if (process.env.FOCUS_FURNITURE_TYPE) {
    const id = await page.evaluate((type) => __actiscape.project.plan.furniture.find((item) => item.type === type)?.id, process.env.FOCUS_FURNITURE_TYPE);
    if (id) await page.evaluate((id) => __actiscape.three.focusFurniture(id), id);
  } else await page.evaluate(() => __actiscape.three.frame());
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await (await page.$("#three-view")).screenshot({ path: path.join(out, "orbit.png") });
  await page.click("#walk");
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await (await page.$("#three-view")).screenshot({ path: path.join(out, "walk-entry.png") });
  await page.evaluate(() => {
    const view = __actiscape.three;
    view.camera.position.set(7.8, 1.65, 5.2);
    view.yaw = 0.95;
    view.pitch = -0.08;
  });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await (await page.$("#three-view")).screenshot({ path: path.join(out, "walk-sofa.png") });
  const hasGeneratedChair = await page.evaluate(() => __actiscape.project.plan.furniture.some((item) => item.name === "五视角蓝色扶手椅"));
  if (hasGeneratedChair) {
    await page.evaluate(() => {
      const view = __actiscape.three;
      view.camera.position.set(8.0, 1.65, 3.9);
      view.yaw = 2.26;
      view.pitch = -0.45;
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await (await page.$("#three-view")).screenshot({ path: path.join(out, "walk-generated.png") });
  }
  const id = await page.evaluate(() => __actiscape.project.id);
  console.log(JSON.stringify({ projectId: id, output: out, errors }));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
