import assert from "node:assert/strict";
import { launch } from "../reference/upstream/scripts/browser.mjs";
import { furnitureStyles } from "../packages/scene-core/src/index.js";

const base = process.env.ACTISCAPE_URL || "http://127.0.0.1:3131";
const token = process.env.ACTISCAPE_TOOL_TOKEN?.trim();
const headers = {
  ...(token ? { Authorization: `Bearer ${token}`, "x-actiscape-token": token } : {}),
  "content-type": "application/json",
};
async function api(path, body) {
  const response = await fetch(`${base}/api${path}`, body === undefined ? { headers } : { method: "POST", headers, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  return data;
}
const document = await api("/examples/living-dining");
const project = await api("/projects", { document });
const browser = await launch({ gpu: false, viewport: { width: 1440, height: 900 } });
try {
  const page = await browser.newPage();
  if (token) await page.setExtraHTTPHeaders({ Authorization: `Bearer ${token}`, "x-actiscape-token": token });
  const errors = [];
  const missing = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() === 404 && /hero-assets|textures|api\/assets/.test(response.url())) missing.push(response.url());
  });
  const ready = () => page.waitForFunction(() => window.__actiscape?.project && !__actiscape.busy && document.querySelector("#save-state")?.textContent?.startsWith("已保存"), { timeout: 60000 });
  await page.goto(`${base}/?project=${project.id}&debug`, { waitUntil: "load" });
  await ready();
  const current = () => page.evaluate(() => __actiscape.project);
  const update = async (id, patch) => {
    const before = await current();
    await api(`/projects/${before.id}/commands`, {
      operationId: crypto.randomUUID(),
      baseRevision: before.revision,
      summary: "写实兼容验收",
      commands: [{ type: "update", collection: "furniture", id, patch }],
    });
    await page.waitForFunction((revision) => __actiscape.project.revision > revision, {}, before.revision);
    await ready();
  };
  const add = async (key, open = false) => {
    const object = await page.evaluate((key) => __actiscape.createFurniture(key, 4500, 4500), key);
    if (open) object.opt = { ...(object.opt || {}), open: true };
    const before = await current();
    await api(`/projects/${before.id}/commands`, {
      operationId: crypto.randomUUID(),
      baseRevision: before.revision,
      summary: "添加兼容验收对象",
      commands: [{ type: "add", collection: "furniture", object }],
    });
    await page.waitForFunction((revision) => __actiscape.project.revision > revision, {}, before.revision);
    await ready();
    return object;
  };
  const inspect = async (id) => {
    await page.waitForFunction((id) => __actiscape.three.furniture.has(id), { timeout: 60000 }, id);
    return page.evaluate((id) => {
    const root = __actiscape.three.furniture.get(id);
    if (!root) return { missing: true, scale: [], materials: [], lights: [], children: [] };
    const materials = [];
    const lights = [];
    root.traverse((object) => {
      if (object.isMesh) {
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          materials.push({ uuid: material.uuid, color: material.color?.getHexString(), emissive: material.emissiveIntensity });
        }
      }
      if (object.isPointLight) lights.push({ intensity: object.intensity });
    });
    return { hero: root.userData.heroAsset, scale: root.scale.toArray(), materials, lights, children: root.children.map((child) => ({ z: child.position.z })) };
  }, id);
  };

  const plan = await current();
  const chairs = plan.plan.furniture.filter((item) => item.key === "chair").slice(0, 2);
  assert.equal(chairs.length, 2);
  for (const chair of chairs) assert.equal((await inspect(chair.id)).hero, "chair-01");
  await update(chairs[0].id, { color: "#ff0000" });
  const tinted = await inspect(chairs[0].id);
  const untouched = await inspect(chairs[1].id);
  assert.ok(tinted.materials.some((material) => material.color === "ff0000"));
  assert.ok(untouched.materials.every((material) => material.color !== "ff0000"));
  assert.notDeepEqual(tinted.materials.map((material) => material.uuid), untouched.materials.map((material) => material.uuid));
  for (const id of chairs.map((chair) => chair.id)) {
    assert.deepEqual((await inspect(id)).scale, [1, 1, 1]);
  }
  console.log("PASS independent tint and unit root scale");

  for (const [pack, style] of [["european", "luxury"], ["chinese", "chinese"], ["modern", "modern"], ["japanese", "japanese"], ["cream", "cream"], ["aging_care", "nordic"]]) {
    const before = await current();
    await api(`/projects/${before.id}/apply-style-pack`, { operationId: crypto.randomUUID(), baseRevision: before.revision, styleId: pack });
    await page.waitForFunction((revision) => __actiscape.project.revision > revision, {}, before.revision);
    await ready();
    const styled = await inspect(chairs[0].id);
    const expected = furnitureStyles[style].fabric.slice(1);
    assert.ok(styled.materials.some((material) => material.color === expected), `${style} did not recolor the hero asset`);
    console.log(`PASS style ${style}`);
  }

  const lamp = await add("deskLamp");
  await update(lamp.id, { opt: { on: false } });
  let lampState = await inspect(lamp.id);
  assert.ok(lampState.lights.every((light) => light.intensity === 0));
  assert.ok(lampState.materials.every((material) => !material.emissive));
  await update(lamp.id, { opt: { on: true } });
  lampState = await inspect(lamp.id);
  assert.ok(lampState.lights.some((light) => light.intensity > 0));
  assert.ok(lampState.materials.some((material) => material.emissive > 0));
  console.log("PASS lamp on/off");

  const desk = await add("desk", true);
  assert.deepEqual((await inspect(desk.id)).scale, [1, 1, 1]);
  assert.ok((await inspect(desk.id)).children.some((child) => child.z > 0));
  const single = await add("singleSofa");
  assert.equal((await inspect(single.id)).hero, "armchair-01");
  const curved = await add("curveTrainingTable");
  assert.equal((await inspect(curved.id)).hero, undefined);
  const free = await add("freeBox");
  assert.equal((await inspect(free.id)).hero, undefined);
  console.log("PASS drawer and protected mappings");
  assert.deepEqual(errors, []);
  assert.deepEqual(missing, []);
  console.log(JSON.stringify({ projectId: project.id, errors, missing }));
} finally {
  await browser.close();
}
