import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import puppeteer, { type Browser } from "puppeteer-core";
import { SceneError } from "../../../packages/scene-core/src/index.js";
import { CandidateStore } from "./candidates.js";

const IDLE_CLOSE_MS = 180_000;

function chromePath(): string {
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

/**
 * Pooled headless Chromium renderer.
 * Reuses a warm Browser instance across queued candidate renders, auto-recovers
 * on crash, and releases idle browser resources via an unref'd timer.
 */
export class RenderWorker {
  private queue: Promise<unknown> = Promise.resolve();
  private browser?: Browser;
  private idleTimer?: ReturnType<typeof setTimeout>;

  private scheduleIdleClose() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      void this.close();
    }, IDLE_CLOSE_MS);
    this.idleTimer.unref?.();
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.connected) {
      return this.browser;
    }
    this.browser = undefined;
    const launched = await puppeteer.launch({
      executablePath: chromePath(),
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu-sandbox",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--hide-scrollbars",
      ],
    });
    launched.once("disconnected", () => {
      if (this.browser === launched) this.browser = undefined;
    });
    this.browser = launched;
    return launched;
  }

  async close() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    const current = this.browser;
    this.browser = undefined;
    if (current) {
      await current.close().catch(() => {});
    }
  }

  private async captureOnce(
    store: CandidateStore,
    project: string,
    id: string,
    baseUrl: string,
  ) {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      const token = process.env.ACTISCAPE_TOOL_TOKEN?.trim();
      if (token)
        await page.setExtraHTTPHeaders({
          Authorization: `Bearer ${token}`,
          "x-actiscape-token": token,
        });
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
      await page.goto(url.toString(), { waitUntil: "load", timeout: 60_000 });
      await page.waitForFunction(
        () =>
          (window as any).__candidateReady ||
          (window as any).__candidateError,
        { timeout: 60_000 },
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
    } finally {
      await page.close().catch(() => {});
      this.scheduleIdleClose();
    }
  }

  render(store: CandidateStore, project: string, id: string, baseUrl: string) {
    const run = async () => {
      try {
        return store.verifyEvidence(project, id);
      } catch {}
      try {
        return await this.captureOnce(store, project, id, baseUrl);
      } catch (firstErr) {
        // Auto-heal once if the pooled Chromium process crashed mid-render
        await this.close();
        try {
          return await this.captureOnce(store, project, id, baseUrl);
        } catch (retryErr) {
          const err = retryErr instanceof Error ? retryErr : (firstErr as Error);
          throw new SceneError(
            "RENDER_FAILED",
            `候选截图失败：${err.message}`,
            503,
          );
        }
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }
}
