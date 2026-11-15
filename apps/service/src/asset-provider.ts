import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import {
  calibrateAssetRecord,
  imageMime,
  inspectGlb,
} from "./assets.js";
import type { ProjectStore } from "./store.js";
import type { AssetRecord } from "../../../packages/scene-core/src/index.js";

export type AssetProviderName = "real-cache" | "remote-gpu" | "demo";
export type AssetJobStatus = "queued" | "running" | "succeeded" | "failed";

export interface AssetJob {
  id: string;
  status: AssetJobStatus;
  provider: AssetProviderName;
  name: string;
  category?: string;
  targetHeightMm?: number;
  sourceImageSha256: string;
  inputFile: string;
  createdAt: string;
  updatedAt: string;
  remoteJobId?: string;
  assetId?: string;
  error?: string;
  remoteError?: string;
  cached?: boolean;
  fallback?: boolean;
}

export interface GeneratedAssetResponse {
  job: AssetJob;
  asset?: AssetRecord;
  cached?: boolean;
  pollUrl?: string;
}

export interface GenerateAssetInput {
  image: Buffer;
  filename?: string;
  name?: string;
  category?: string;
  targetHeightMm?: number;
}

interface CacheCase {
  directory: string;
  metadata: Record<string, any>;
  glb: Buffer;
}

interface AssetProviderOptions {
  store: ProjectStore;
  dataDir: string;
  cacheDir?: string;
  serviceUrl?: string;
  apiKey?: string;
  demoAssetPath?: string;
  timeoutMs?: number;
  logger?: FastifyBaseLogger;
}

const IMAGE_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

function now() {
  return new Date().toISOString();
}

function readJson<T = any>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function writeJson(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(temporary, file);
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/**
 * Real-Cache First → Remote GPU Async → Demo Fallback.
 *
 * The provider owns only asset generation and calibration. It never writes a
 * formal Project; the editor/agent still places the returned AssetRecord through
 * the normal Candidate / command gate.
 */
export class AssetProvider {
  readonly store: ProjectStore;
  readonly dataDir: string;
  readonly cacheDir: string;
  readonly serviceUrl?: string;
  readonly apiKey?: string;
  readonly demoAssetPath: string;
  readonly timeoutMs: number;
  readonly logger?: FastifyBaseLogger;
  private readonly jobsDir: string;

  constructor(options: AssetProviderOptions) {
    this.store = options.store;
    this.dataDir = options.dataDir;
    this.cacheDir =
      options.cacheDir ||
      process.env.ACTISCAPE_ASSET_CACHE_DIR ||
      path.join(options.dataDir, "real-generated-assets");
    this.serviceUrl = (
      options.serviceUrl ??
      process.env.ASSET_SERVICE_URL ??
      ""
    ).replace(/\/+$/, "");
    this.apiKey = options.apiKey ?? process.env.ASSET_API_KEY ?? "";
    this.demoAssetPath =
      options.demoAssetPath ??
      process.env.ACTISCAPE_DEMO_ASSET ??
      path.resolve("fixtures/textured-vase.glb");
    this.timeoutMs =
      options.timeoutMs ?? Number(process.env.ASSET_REMOTE_TIMEOUT_MS || 180000);
    this.logger = options.logger;
    this.jobsDir = path.join(options.dataDir, "asset-jobs");
    fs.mkdirSync(this.jobsDir, { recursive: true });
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  providers() {
    return {
      cache: {
        directory: this.cacheDir,
        cases: this.listCache().length,
      },
      remote: {
        configured: Boolean(this.serviceUrl),
        url: this.serviceUrl || null,
        apiKeyConfigured: Boolean(this.apiKey),
      },
      demo: {
        available: fs.existsSync(this.demoAssetPath),
        path: this.demoAssetPath,
      },
    };
  }

  async generate(input: GenerateAssetInput): Promise<GeneratedAssetResponse> {
    if (!input.image.length)
      throw new Error("图片不能为空");
    const sha = createHash("sha256").update(input.image).digest("hex"),
      mime = imageMime(input.image);
    if (!mime)
      throw new Error("只支持 PNG、JPEG 或 WebP 图片");
    const job = this.createJob(input, sha, mime);
    const cached = this.cacheFor(sha);
    if (cached) {
      const asset = this.importGlb(cached.glb, input.name || cached.metadata.name, {
        provider: "real-cache",
        sourceImageSha256: sha,
        category: input.category || cached.metadata.category,
        isRealGeneration: cached.metadata.is_real_generation !== false,
        targetHeightMm: input.targetHeightMm,
        metadata: cached.metadata,
      });
      return this.succeed(job, asset, { cached: true });
    }
    if (this.serviceUrl) {
      try {
        const remote = await this.submitRemote(input, mime, sha);
        job.status = "queued";
        job.remoteJobId = remote.id;
        this.saveJob(job);
        return {
          job,
          pollUrl: `/api/assets/jobs/${job.id}`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger?.warn({ error: message }, "remote asset submit failed; using demo");
        const asset = this.demoAsset(input, sha);
        job.remoteError = message;
        return this.succeed(job, asset, { fallback: true });
      }
    }
    const asset = this.demoAsset(input, sha);
    return this.succeed(job, asset);
  }

  getJob(id: string): AssetJob {
    const job = readJson<AssetJob>(path.join(this.jobsDir, `${id}.json`));
    if (!job) throw new Error(`资产任务不存在：${id}`);
    return job;
  }

  listJobs(): AssetJob[] {
    if (!fs.existsSync(this.jobsDir)) return [];
    return fs
      .readdirSync(this.jobsDir)
      .filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))
      .map((name) => readJson<AssetJob>(path.join(this.jobsDir, name))!)
      .filter(Boolean)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Lazy non-blocking poll: each GET checks the remote job and advances it. */
  async poll(id: string): Promise<GeneratedAssetResponse> {
    const job = this.getJob(id);
    if (job.status === "succeeded")
      return {
        job,
        asset: job.assetId ? this.store.asset(job.assetId) : undefined,
        cached: job.cached,
      };
    if (job.status === "failed") return { job };
    if (!job.remoteJobId || !this.serviceUrl)
      return this.succeed(job, this.demoAsset(this.inputFor(job), job.sourceImageSha256), {
        fallback: true,
      });
    try {
      const remote = await this.remoteJob(job.remoteJobId);
      if (remote.status === "queued" || remote.status === "running") {
        job.status = remote.status;
        this.saveJob(job);
        return { job, pollUrl: `/api/assets/jobs/${job.id}` };
      }
      if (remote.status === "failed")
        throw new Error(
          remote.error?.message || remote.error?.code || "远端 GPU 任务失败",
        );
      const result = remote.result || {};
      const bytes = await this.downloadRemote(result, job.remoteJobId);
      const asset = this.importGlb(bytes, job.name, {
        provider: "remote-gpu",
        sourceImageSha256: job.sourceImageSha256,
        category: job.category || result.generation?.category,
        isRealGeneration: true,
        targetHeightMm: job.targetHeightMm,
        metadata: {
          size_mm: result.spatial?.size_mm,
          normalization: result.spatial?.normalization,
          spatial: result.spatial,
          scale_calibrated: result.spatial?.scale_calibrated,
          scale_source: result.spatial?.scale_source,
        },
      });
      const image = fs.readFileSync(path.join(this.jobsDir, job.inputFile));
      this.writeCache(job.sourceImageSha256, image, bytes, {
        input_sha256: job.sourceImageSha256,
        name: job.name,
        category: job.category,
        provider: "remote-gpu",
        is_real_generation: true,
        size_mm: { w: asset.w, d: asset.d, h: asset.h },
        glb_sha256: asset.sha256,
        scale_calibrated: asset.scaleCalibrated === true,
        scale_source: asset.scaleSource,
        created_at: now(),
      });
      return this.succeed(job, asset);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.warn({ error: message }, "remote asset job failed; using demo");
      job.remoteError = message;
      return this.succeed(job, this.demoAsset(this.inputFor(job), job.sourceImageSha256), {
        fallback: true,
      });
    }
  }

  calibrate(assetId: string, targetHeightMm: number): AssetRecord {
    const record = this.store.asset(assetId);
    const updated = calibrateAssetRecord(record, targetHeightMm);
    this.store.updateAsset(updated);
    if (record.sourceImageSha256) this.updateCacheMetadata(record.sourceImageSha256, updated);
    return updated;
  }

  private createJob(input: GenerateAssetInput, sha: string, mime: string): AssetJob {
    const id = randomUUID(),
      extension = IMAGE_EXT[mime] || ".png",
      inputFile = `${id}${extension}`;
    fs.writeFileSync(path.join(this.jobsDir, inputFile), input.image);
    const job: AssetJob = {
      id,
      status: "running",
      provider: this.serviceUrl ? "remote-gpu" : "demo",
      name: (input.name || input.filename || "未命名物品")
        .replace(/\.[^.]+$/, "")
        .slice(0, 120),
      category: input.category,
      targetHeightMm: input.targetHeightMm,
      sourceImageSha256: sha,
      inputFile,
      createdAt: now(),
      updatedAt: now(),
    };
    this.saveJob(job);
    return job;
  }

  private saveJob(job: AssetJob) {
    job.updatedAt = now();
    writeJson(path.join(this.jobsDir, `${job.id}.json`), job);
  }

  private succeed(
    job: AssetJob,
    asset: AssetRecord,
    extra: { cached?: boolean; fallback?: boolean } = {},
  ): GeneratedAssetResponse {
    job.status = "succeeded";
    job.assetId = asset.id;
    if (
      asset.provider === "real-cache" ||
      asset.provider === "remote-gpu" ||
      asset.provider === "demo"
    )
      job.provider = asset.provider;
    job.cached = extra.cached === true;
    job.fallback = extra.fallback === true || Boolean(job.remoteError);
    job.error = undefined;
    this.saveJob(job);
    return {
      job,
      asset,
      cached: job.cached,
      ...(job.fallback ? { pollUrl: undefined } : {}),
    };
  }

  private importGlb(
    bytes: Buffer,
    name: string | undefined,
    options: {
      provider: AssetProviderName;
      sourceImageSha256: string;
      category?: string;
      isRealGeneration: boolean;
      targetHeightMm?: number;
      metadata?: Record<string, any>;
    },
  ): AssetRecord {
    const inspected = inspectGlb(bytes, name || "照片物品");
    let record: AssetRecord = {
      ...inspected,
      name: name || inspected.name,
      category: options.category,
      sourceImageSha256: options.sourceImageSha256,
      provider: options.provider,
      isRealGeneration: options.isRealGeneration,
      scaleCalibrated: false,
      scaleSource: options.isRealGeneration ? "raw_uncalibrated" : "demo",
      defaultPlacement: "surface",
      generatedAt: now(),
    };
    const size = options.metadata?.size_mm;
    if (size && finite(size.h)) {
      const factor = size.h / inspected.h;
      record = {
        ...record,
        w: finite(size.w) ? size.w : record.w * factor,
        d: finite(size.d) ? size.d : record.d * factor,
        h: size.h,
        normalization: {
          scale: record.normalization.scale * factor,
          center: [
            ...(options.metadata?.normalization?.center ||
              record.normalization.center),
          ] as [number, number, number],
        },
        scaleCalibrated:
          options.metadata?.scale_calibrated === true ||
          options.metadata?.spatial?.scale_calibrated === true,
        scaleSource:
          options.metadata?.scale_source ||
          (options.isRealGeneration ? "raw_uncalibrated" : "demo"),
      };
    }
    if (options.targetHeightMm)
      record = calibrateAssetRecord(record, options.targetHeightMm);
    this.store.saveAsset(record, bytes);
    return this.store.updateAsset(record);
  }

  private demoAsset(input: GenerateAssetInput, sha: string): AssetRecord {
    if (!fs.existsSync(this.demoAssetPath))
      throw new Error("演示资产缺失，请检查 fixtures/textured-vase.glb");
    const bytes = fs.readFileSync(this.demoAssetPath);
    const record = this.importGlb(bytes, input.name, {
      provider: "demo",
      sourceImageSha256: sha,
      category: input.category || "vase",
      isRealGeneration: false,
      targetHeightMm: input.targetHeightMm,
      metadata: { size_mm: { w: 320, d: 320, h: 400 } },
    });
    // The fixed demo GLB is content-addressed; keep a stable, explicit label.
    if (record.provider !== "demo")
      return this.store.updateAsset({
        ...record,
        provider: "demo",
        isRealGeneration: false,
        scaleSource: record.scaleCalibrated ? "user_confirmed" : "demo",
        defaultPlacement: "surface",
      });
    return record;
  }

  private cacheFor(sha: string): CacheCase | undefined {
    for (const directory of this.cacheDirectories()) {
      const metadata = readJson<Record<string, any>>(
        path.join(directory, "metadata.json"),
      );
      if (!metadata) continue;
      const inputSha =
        metadata.input_sha256 ||
        metadata.inputSha256 ||
        metadata.source_image_sha256;
      if (inputSha !== sha) continue;
      const glbFile = path.join(
        directory,
        typeof metadata.glb === "string" ? metadata.glb : "asset.glb",
      );
      if (!fs.existsSync(glbFile)) continue;
      return { directory, metadata, glb: fs.readFileSync(glbFile) };
    }
    return undefined;
  }

  private listCache(): CacheCase[] {
    const cases: CacheCase[] = [];
    for (const directory of this.cacheDirectories()) {
      const metadata = readJson<Record<string, any>>(
        path.join(directory, "metadata.json"),
      );
      const glbFile = path.join(
        directory,
        typeof metadata?.glb === "string" ? metadata.glb : "asset.glb",
      );
      if (metadata && fs.existsSync(glbFile))
        cases.push({ directory, metadata, glb: fs.readFileSync(glbFile) });
    }
    return cases;
  }

  private cacheDirectories(): string[] {
    if (!fs.existsSync(this.cacheDir)) return [];
    return fs
      .readdirSync(this.cacheDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(this.cacheDir, entry.name));
  }

  private writeCache(
    sha: string,
    image: Buffer,
    glb: Buffer,
    metadata: Record<string, any>,
  ) {
    const directory = path.join(this.cacheDir, sha);
    if (fs.existsSync(path.join(directory, "asset.glb"))) return;
    fs.mkdirSync(directory, { recursive: true });
    const extension = IMAGE_EXT[imageMime(image) || "image/png"] || ".png";
    fs.writeFileSync(path.join(directory, `input${extension}`), image);
    fs.writeFileSync(path.join(directory, "asset.glb"), glb);
    writeJson(path.join(directory, "metadata.json"), metadata);
  }

  private updateCacheMetadata(sha: string, record: AssetRecord) {
    const directory = path.join(this.cacheDir, sha);
    const metadata = readJson<Record<string, any>>(
      path.join(directory, "metadata.json"),
    );
    if (!metadata) return;
    writeJson(path.join(directory, "metadata.json"), {
      ...metadata,
      size_mm: { w: record.w, d: record.d, h: record.h },
      scale_calibrated: record.scaleCalibrated === true,
      scale_source: record.scaleSource,
      updated_at: now(),
    });
  }

  private async submitRemote(
    input: GenerateAssetInput,
    mime: string,
    sha: string,
  ): Promise<{ id: string }> {
    const resolvedName = input.name || "未命名物品";
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(input.image)], { type: mime }),
      input.filename || "upload.png",
    );
    form.append("name", resolvedName);
    if (input.category) form.append("category", input.category);
    if (input.targetHeightMm)
      form.append("target_height_mm", String(input.targetHeightMm));
    // 幂等键必须代表“整个请求”。资产服务按 (图片 + name + 参数) 哈希校验，
    // 若只用图片 sha，同图换名重传会被判 409 冲突，网关再把它当成远端失败而静默回退 demo。
    const idempotencyKey = createHash("sha256")
      .update(sha)
      .update("\n")
      .update(resolvedName)
      .update("\n")
      .update(input.category || "")
      .update("\n")
      .update(String(input.targetHeightMm || 0))
      .digest("hex");
    const headers: Record<string, string> = {
      "Idempotency-Key": idempotencyKey,
    };
    if (this.apiKey) headers["X-API-Key"] = this.apiKey;
    const response = await fetch(`${this.serviceUrl}/api/v1/jobs`, {
      method: "POST",
      headers,
      body: form,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body: any = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        body?.detail || `远端资产服务 HTTP ${response.status}`,
      );
    const remote = body.job || body;
    if (!remote?.id) throw new Error("远端资产服务没有返回 job.id");
    return { id: String(remote.id) };
  }

  private async remoteJob(id: string): Promise<any> {
    const headers: Record<string, string> = {};
    if (this.apiKey) headers["X-API-Key"] = this.apiKey;
    const response = await fetch(
      `${this.serviceUrl}/api/v1/jobs/${encodeURIComponent(id)}`,
      { headers, signal: AbortSignal.timeout(this.timeoutMs) },
    );
    const body: any = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(body?.detail || `远端任务查询 HTTP ${response.status}`);
    return body.job || body;
  }

  private async downloadRemote(result: any, remoteJobId: string): Promise<Buffer> {
    const url =
      result.model_url ||
      (result.asset_id
        ? `/api/v1/assets/${result.asset_id}/model`
        : `/api/v1/jobs/${remoteJobId}/model`);
    const absolute = /^https?:/.test(url) ? url : `${this.serviceUrl}${url}`;
    const headers: Record<string, string> = {};
    if (this.apiKey) headers["X-API-Key"] = this.apiKey;
    const response = await fetch(absolute, {
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok)
      throw new Error(`下载远端 GLB 失败：HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  private inputFor(job: AssetJob): GenerateAssetInput {
    const file = path.join(this.jobsDir, job.inputFile);
    return {
      image: fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0),
      filename: job.inputFile,
      name: job.name,
      category: job.category,
      targetHeightMm: job.targetHeightMm,
    };
  }
}
