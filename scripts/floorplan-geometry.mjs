/** Measure actual Three.js meshes separately from recipe values and image comparisons. */
import { launch } from "../reference/upstream/scripts/browser.mjs";
export async function geometryProof(base, projectId, candidate) {
  const browser = await launch({
    gpu: false,
    viewport: { width: 1280, height: 900 },
  });
  try {
    const page = await browser.newPage();
    await page.goto(
      base + "/?project=" + encodeURIComponent(projectId) + "&debug=1",
      { waitUntil: "load" },
    );
    await page.waitForFunction(() => window.__actiscape?.buildFurniture);
    const objects = await page.evaluate((plan) => {
      const api = window.__actiscape,
        T = api.THREE;
      return plan.furniture.map((f) => {
        const group = api.buildFurniture(f, plan);
        group.updateMatrixWorld(true);
        const box = new T.Box3().setFromObject(group, true),
          size = box.getSize(new T.Vector3()).multiplyScalar(1000),
          center = box.getCenter(new T.Vector3()).multiplyScalar(1000),
          w = size.x,
          d = size.z,
          h = size.y;
        return {
          id: f.id,
          key: f.key,
          nominal: { w: f.w, d: f.d, h: f.h },
          actual: { w, d, h },
          localCenter: { x: center.x, y: center.y, z: center.z },
          passed:
            [w, d, h, center.x, center.y, center.z].every(Number.isFinite) &&
            w > 0 &&
            d > 0 &&
            h > 0 &&
            Math.abs(w - f.w) <= Math.max(100, f.w * 0.15) &&
            Math.abs(d - f.d) <= Math.max(100, f.d * 0.15) &&
            Math.hypot(center.x, center.z) <= 150,
        };
      });
    }, candidate.state.plan);
    return {
      passed: objects.every((o) => o.passed),
      objects,
      coverage: [
        "actual unrotated Three.js mesh bounds in mm",
        "nominal/actual footprint deviation: max(100 mm,15%)",
        "mesh horizontal centre offset <=150 mm",
      ],
      limitations: [
        "not triangle-level collision or support-surface validation",
      ],
    };
  } finally {
    await browser.close();
  }
}
