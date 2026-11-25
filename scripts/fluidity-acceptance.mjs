import assert from "node:assert/strict";
import { launch } from "../reference/upstream/scripts/browser.mjs";

const base = process.env.ACTISCAPE_URL || "http://127.0.0.1:3131";
const project = process.env.ACTISCAPE_PROJECT || "bf7acd71-35ff-4cbc-8d64-1ba48c6c1420";
const token = process.env.ACTISCAPE_TOOL_TOKEN?.trim();
const browser = await launch({ gpu: false, viewport: { width: 1440, height: 900 } });

try {
  const page = await browser.newPage();
  if (token) await page.setExtraHTTPHeaders({ Authorization: `Bearer ${token}`, "x-actiscape-token": token });
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (/\/hero-assets\/.*\.glb/.test(request.url())) {
      setTimeout(() => request.continue().catch(() => {}), 4000);
    } else request.continue().catch(() => {});
  });
  const started = Date.now();
  await page.goto(`${base}/?project=${project}&debug`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__actiscape?.three?.furniture?.size >= 12, { timeout: 15000 });
  const firstSceneMs = Date.now() - started;
  assert.ok(firstSceneMs < 3000, `First scene waited for hero downloads: ${firstSceneMs} ms`);
  await page.waitForFunction(() => [...__actiscape.three.furniture.values()].some((group) => group.userData.heroAsset), { timeout: 20000 });
  console.log(`PASS parameterized first scene ${firstSceneMs} ms with delayed hero requests`);

  await page.click("[data-view='3d']");
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const before = await page.evaluate(() => __actiscape.three.renderer.info.render.frame);
  await new Promise((resolve) => setTimeout(resolve, 700));
  const after = await page.evaluate(() => __actiscape.three.renderer.info.render.frame);
  assert.equal(after, before, "Static scene kept rendering");
  const shadow = await page.evaluate(() => ({
    autoUpdate: __actiscape.three.renderer.shadowMap.autoUpdate,
    size: __actiscape.three.scene.children.find((object) => object.isDirectionalLight)?.shadow.mapSize.x,
  }));
  assert.equal(shadow.autoUpdate, false);
  assert.equal(shadow.size, 1024);
  console.log("PASS zero static renders and on-demand 1024 software shadows");

  const canvas = await page.$("#three-view canvas");
  const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * 0.55, bounds.y + bounds.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.6, { steps: 8 });
  await page.mouse.up();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const interacted = await page.evaluate(() => __actiscape.three.renderer.info.render.frame);
  assert.ok(interacted > after, "Orbit interaction did not invalidate the frame");
  console.log("PASS orbit interaction resumes rendering");
  await page.close();

  for (const [query, ultra] of [["realism", false], ["realism=ultra", true]]) {
    const quality = await browser.newPage();
    if (token) await quality.setExtraHTTPHeaders({ Authorization: `Bearer ${token}`, "x-actiscape-token": token });
    await quality.goto(`${base}/?project=${project}&debug&${query}`, { waitUntil: "load" });
    await quality.waitForFunction(() => window.__actiscape?.three?.realism, { timeout: 60000 });
    assert.equal(await quality.evaluate(() => !!__actiscape.three.realism.composer), ultra);
    await quality.close();
  }
  console.log("PASS fluent default and opt-in ultra post-processing");
} finally {
  await browser.close();
}
