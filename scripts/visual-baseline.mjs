import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { ACESFilmicToneMapping, PCFSoftShadowMap, SRGBColorSpace } from "three";
import { createApp } from "../apps/service/src/app.ts";
import { launch } from "../reference/upstream/scripts/browser.mjs";
const out = path.resolve("test-results/visual");
fs.mkdirSync(out, { recursive: true });
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actiscape-visual-"));
const { app } = await createApp({
  dataDir: directory,
  staticDir: path.resolve("dist/editor"),
  logger: false,
});
await app.listen({ port: 0, host: "127.0.0.1" });
const browser = await launch({
    gpu: false,
    viewport: { width: 1280, height: 900 },
  }),
  plan = JSON.parse(
    fs.readFileSync("fixtures/living-dining.plan.json", "utf8"),
  );
const camera = {
  position: [12, 12, 14],
  target: [4.5, 0.8, 3],
  fov: 45,
  width: 960,
  height: 720,
};
// Analysis-only copy: expose the existing renderer without changing any algorithm.
const reference = fs.readFileSync(
  "reference/runtime/living-dining.html",
  "utf8",
);
const instrumented = reference.replace(
  /(<script type="module"[^>]*>)([\s\S]*?)(<\/script>)/,
  (_match, open, code, close) =>
    open +
    code +
    "\n;window.__referenceCapture = () => ({renderer:qt});\n" +
    close,
);
assert.notEqual(instrumented, reference);
fs.writeFileSync("reference/runtime/visual-reference.html", instrumented);
async function fixView(page, original) {
  const capture = await page.evaluate(
    async ({ original, camera, settings }) => {
      if (original) {
        __designer.replacePlan(
          JSON.parse(localStorage.getItem("visual-baseline")),
        );
        await __designer.setView("3d");
        __designer.S3.applyQuality("fast");
      }
      const refs = original
          ? {
              ...__designer.S3.sceneRefs(),
              renderer: __referenceCapture().renderer,
            }
          : __actiscape.three,
        pane = original ? refs.pane : refs.host;
      Object.assign(pane.style, {
        display: "block",
        position: "fixed",
        left: "0px",
        top: "0px",
        width: camera.width + "px",
        height: camera.height + "px",
        zIndex: 99999,
      });
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      refs.renderer.setPixelRatio(1);
      refs.renderer.setSize(camera.width, camera.height);
      refs.renderer.toneMapping = settings.toneMapping;
      refs.renderer.toneMappingExposure = 1.25;
      refs.renderer.outputColorSpace = settings.colorSpace;
      refs.renderer.shadowMap.enabled = true;
      refs.renderer.shadowMap.type = settings.shadowType;
      refs.controls.enabled = false;
      refs.controls.enableDamping = false;
      refs.camera.position.fromArray(camera.position);
      refs.controls.target.fromArray(camera.target);
      refs.controls.update();
      refs.camera.fov = camera.fov;
      refs.camera.aspect = camera.width / camera.height;
      refs.camera.updateProjectionMatrix();
      refs.camera.updateMatrixWorld();
      const lights = [];
      refs.scene.traverse((o) => {
        if (o.isLight) lights.push(o);
      });
      const hemisphere = lights.find((o) => o.isHemisphereLight).clone(),
        sun = lights.find((o) => o.isDirectionalLight).clone();
      lights.forEach((o) => (o.visible = false));
      hemisphere.name = "acceptanceHemisphere";
      hemisphere.visible = true;
      hemisphere.color.set("#fff8ef");
      hemisphere.groundColor.set("#b2bcc7");
      hemisphere.intensity = 2.4;
      sun.name = "acceptanceSun";
      sun.visible = true;
      sun.color.set("#fff4e0");
      sun.intensity = 2.8;
      sun.position.set(8, 14, 10);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      Object.assign(sun.shadow.camera, {
        left: -20,
        right: 20,
        top: 20,
        bottom: -20,
        near: 0.1,
        far: 60,
      });
      sun.shadow.bias = -0.0003;
      refs.scene.add(hemisphere, sun);
      refs.scene.environment = null;
      refs.scene.background = hemisphere.color.clone().set("#eef1f4");
      const canvas = original ? refs.canvas : refs.renderer.domElement;
      // Render and read pixels synchronously before either editor's frame loop can alter the pose.
      refs.renderer.render(refs.scene, refs.camera);
      return {
        image: canvas.toDataURL("image/png"),
        position: refs.camera.position.toArray(),
        target: refs.controls.target.toArray(),
        width: canvas.width,
        height: canvas.height,
      };
    },
    {
      original,
      camera,
      settings: {
        toneMapping: ACESFilmicToneMapping,
        colorSpace: SRGBColorSpace,
        shadowType: PCFSoftShadowMap,
      },
    },
  );
  assert.deepEqual(
    capture.position.map((n) => +n.toFixed(6)),
    camera.position,
  );
  assert.deepEqual(capture.target, camera.target);
  assert.equal(capture.width, camera.width);
  assert.equal(capture.height, camera.height);
  fs.writeFileSync(
    path.join(out, original ? "original-fixed.png" : "editor-fixed.png"),
    Buffer.from(capture.image.split(",")[1], "base64"),
  );
  return {
    position: capture.position,
    target: capture.target,
    width: capture.width,
    height: capture.height,
  };
}
try {
  const original = await browser.newPage();
  await original.goto(
    pathToFileURL(path.resolve("reference/runtime/visual-reference.html"))
      .href + "?debug",
    { waitUntil: "load" },
  );
  await original.waitForFunction(() => window.__designer);
  await original.evaluate(
    (plan) => localStorage.setItem("visual-baseline", JSON.stringify(plan)),
    plan,
  );
  const originalCapture = await fixView(original, true);
  const editor = await browser.newPage(),
    address = app.server.address();
  await editor.goto(`http://127.0.0.1:${address.port}/?debug`, {
    waitUntil: "load",
  });
  await editor.waitForFunction(
    () =>
      window.__actiscape?.project &&
      document.querySelector("#save-state").textContent === "已保存到项目服务",
  );
  const editorCapture = await fixView(editor, false);
  fs.writeFileSync(
    path.join(out, "settings.json"),
    JSON.stringify(
      {
        input: "fixtures/living-dining.plan.json",
        sha256: createHash("sha256").update(JSON.stringify(plan)).digest("hex"),
        camera,
        actualCaptures: { original: originalCapture, editor: editorCapture },
        instrumentation:
          "An analysis-only reference copy exposes qt for synchronous rendering. Upstream reference files and business algorithms are unchanged.",
        light: {
          hemisphere: { sky: "#fff8ef", ground: "#b2bcc7", intensity: 2.4 },
          sun: { color: "#fff4e0", intensity: 2.8, position: [8, 14, 10] },
        },
        renderer: "SwiftShader",
        browser: await browser.version(),
        purpose:
          "Fixed camera, light and resolution for manual visual inspection. Data and geometry assertions are separate; no pixel-equivalence claim.",
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS fixed-view captures produced with shared camera, lights, resolution and input",
  );
} finally {
  await browser.close();
  await app.close();
  fs.rmSync(directory, { recursive: true, force: true });
}
