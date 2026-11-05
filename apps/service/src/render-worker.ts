import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import puppeteer from "puppeteer-core";
import { SceneError } from "../../../packages/scene-core/src/index.js";
import { CandidateStore } from "./candidates.js";

function chromePath() {
  const root = path.join(os.homedir(), ".cache/ms-playwright");
  const paths = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    ...(fs.existsSync(root)
      ? fs
          .readdirSync(root)
          .filter((n) => n.startsWith("chromium-"))
          .reverse()
          .map((n) => path.join(root, n, "chrome-linux64/chrome"))
      : []),
  ];
  const found = paths.find((p) => p && fs.existsSync(p));
  if (!found)
    throw new SceneError(
      "RENDER_UNAVAILABLE",
      "请配置 CHROME_PATH 指向已安装的 Chrome/Chromium",
      503,
    );
  return found;
}
export class RenderWorker {
  private queue: Promise<unknown> = Promise.resolve();
  render(store: CandidateStore, project: string, id: string, baseUrl: string) {
    const run = async () => {
      try {
        return store.verifyEvidence(project, id);
      } catch {}
      const browser = await puppeteer.launch({
        executablePath: chromePath(),
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--use-angle=swiftshader",
          "--enable-unsafe-swiftshader",
          "--hide-scrollbars",
        ],
      });
      try {
        const page = await browser.newPage();
        await page.setViewport({
          width: 960,
          height: 720,
          deviceScaleFactor: 1,
        });
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        const url = new URL("/render.html", baseUrl);
        url.searchParams.set("project", project);
        url.searchParams.set("candidate", id);
        await page.goto(url.toString(), { waitUntil: "load", timeout: 60000 });
        await page.waitForFunction(
          () =>
            (window as any).__candidateReady ||
            (window as any).__candidateError,
          { timeout: 60000 },
        );
        const captures = await page.evaluate(() => {
          const w = window as any;
          if (w.__candidateError) throw new Error(w.__candidateError);
          return w.__captureCandidate();
        });
        if (errors.length || captures.length !== 2)
          throw new Error("渲染页面错误");
        return store.saveEvidence(
          project,
          id,
          captures.map((c: any) => ({
            view: c.view,
            data: Buffer.from(c.image.split(",")[1], "base64"),
          })),
        );
      } catch (e) {
        throw new SceneError(
          "RENDER_FAILED",
          `候选截图失败：${(e as Error).message}`,
          503,
        );
      } finally {
        await browser.close();
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }
}
