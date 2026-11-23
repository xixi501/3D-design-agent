import fs from "node:fs";
import { launch, gpuInfo } from "../reference/upstream/scripts/browser.mjs";

const base = process.env.ACTISCAPE_URL || "http://127.0.0.1:3131";
const project = process.env.ACTISCAPE_PROJECT || "bf7acd71-35ff-4cbc-8d64-1ba48c6c1420";
const token = process.env.ACTISCAPE_TOOL_TOKEN?.trim();
const out = "/workspace/actiscape-data/handoff/performance-baseline.json";
const browser = await launch({ gpu: false, viewport: { width: 1440, height: 900 } });

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

try {
  const results = [];
  for (const high of (process.env.BENCHMARK_SKIP_HIGH ? [false] : [false, true])) {
    const page = await browser.newPage();
    if (token) await page.setExtraHTTPHeaders({ Authorization: `Bearer ${token}`, "x-actiscape-token": token });
    await page.goto(`${base}/?project=${project}&debug${high ? "&realism" : ""}`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__actiscape?.project && !__actiscape.busy, { timeout: 120000 });
    await page.click("[data-view='3d']");
    const sample = await page.evaluate(async (count) => {
      const frames = [];
      let previous = performance.now();
      for (let index = 0; index < count; index++) {
        await new Promise(requestAnimationFrame);
        const now = performance.now();
        frames.push(now - previous);
        previous = now;
      }
      const navigation = performance.getEntriesByType("navigation")[0];
      const resources = performance.getEntriesByType("resource").map((entry) => ({
        name: entry.name,
        transferSize: entry.transferSize,
        decodedBodySize: entry.decodedBodySize,
        duration: entry.duration,
      }));
      return {
        frames,
        navigation: navigation ? { domContentLoaded: navigation.domContentLoadedEventEnd, load: navigation.loadEventEnd } : null,
        resources,
        heap: performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null,
        render: __actiscape.three.renderer.info.render,
      };
    }, high ? 30 : 120);
    const frames = sample.frames.slice(2);
    results.push({
      mode: high ? "forced-realism" : "automatic-fallback",
      gpu: await gpuInfo(page),
      frameCount: frames.length,
      frameMs: {
        p50: percentile(frames, 0.5),
        p95: percentile(frames, 0.95),
        mean: frames.reduce((sum, value) => sum + value, 0) / frames.length,
      },
      navigation: sample.navigation,
      heap: sample.heap,
      render: sample.render,
      resources: sample.resources,
    });
    await page.close();
  }
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.map(({ resources, ...result }) => result), null, 2));
} finally {
  await browser.close();
}
