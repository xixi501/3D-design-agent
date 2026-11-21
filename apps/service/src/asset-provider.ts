import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import {
  calibrateAssetRecord,
  imageMime,
  inspectGlb,
} from "./assets.js";
import { AssetCache } from "./asset-cache.js";
import {
  AssetJobStore,
  type AssetJob,
  type AssetJobStatus,
  type AssetProviderName,
  type GenerateAssetInput,
  type ReferenceImageInput,
  type ReferenceViewLabel,
} from "./asset-job-store.js";
import { RemoteAssetClient } from "./remote-asset-client.js";
import type { ProjectStore } from "./store.js";
import type { AssetRecord } from "../../../packages/scene-core/src/index.js";

export type {
  AssetJob,
  AssetJobStatus,
  AssetProviderName,
  GenerateAssetInput,
  ReferenceImageInput,
  ReferenceViewLabel,
};

export interface GeneratedAssetResponse {
  job: AssetJob;
  asset?: AssetRecord;
  cached?: boolean;
  pollUrl?: string;
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

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function computeInputSha256(input: GenerateAssetInput): string {
  const baseSha = createHash("sha256").update(input.image).digest("hex");
  const refs = input.referenceImages || [];
  if (!refs.length) return baseSha;
  const refShas = refs.map((r) =>
    createHash("sha256").update(r.image).digest("hex"),
  );
  const views = input.referenceViews || refs.map((r) => r.view || "");
  return createHash("sha256")
    .update(JSON.stringify([baseSha, views, ...refShas]))
    .digest("hex");
}

/**
 * Three-tier asset gateway coordinator: Real-Cache → Remote-GPU → Demo Fallback.
 * Delegates storage, caching, and HTTP transport to dedicated collaborators.
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

  private readonly cache: AssetCache;
  private readonly jobs: AssetJobStore;
  private readonly remote: RemoteAssetClient;

  constructor(options: AssetProviderOptions) {
    this.store = options.store;
    this.dataDir = options.dataDir;
    this.cacheDir =
      options.cacheDir ||
      process.env.ACTISCAPE_ASSET_CACHE_DIR ||
      path.join(options.dataDir, "real-generated-assets");
    const resolvedUrl = (
      options.serviceUrl ??
      process.env.ASSET_SERVICE_URL ??
      ""
    ).replace(/\/+$/, "");
    this.serviceUrl = resolvedUrl;
    this.apiKey = options.apiKey ?? process.env.ASSET_API_KEY ?? "";
    this.demoAssetPath =
      options.demoAssetPath ??
      process.env.ACTISCAPE_DEMO_ASSET ??
      path.resolve("fixtures/textured-vase.glb");
    this.timeoutMs =
      options.timeoutMs ?? Number(process.env.ASSET_REMOTE_TIMEOUT_MS || 180000);
    this.logger = options.logger;

    this.cache = new AssetCache(this.cacheDir);
    this.jobs = new AssetJobStore(path.join(options.dataDir, "asset-jobs"));
    this.remote = new RemoteAssetClient(
      resolvedUrl,
      this.apiKey,
      this.timeoutMs,
    );
  }

  providers() {
    return {
      cache: {
        directory: this.cacheDir,
        cases: this.cache.list().length,
      },
      remote: {
        configured: this.remote.configured,
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
    if (!input.image.length) throw new Error("图片不能为空");
    const mime = imageMime(input.image);
    if (!mime) throw new Error("只支持 PNG、JPEG 或 WebP 图片");
    const sha = computeInputSha256(input);
    const job = this.jobs.create(
      input,
      sha,
      mime,
      this.remote.configured ? "remote-gpu" : "demo",
    );

    const cached = this.cache.find(sha);
    if (cached) {
      const asset = this.importGlb(
        cached.glb,
        input.name || cached.metadata.name,
        {
          provider: "real-cache",
          sourceImageSha256: sha,
          category: input.category || cached.metadata.category,
          isRealGeneration: cached.metadata.is_real_generation !== false,
          targetHeightMm: input.targetHeightMm,
          metadata: cached.metadata,
        },
      );
      return this.succeed(job, asset, { cached: true });
    }

    if (this.remote.configured) {
      try {
        const remote = await this.remote.submit(input, mime, sha);
        job.status = "queued";
        job.remoteJobId = remote.id;
        this.jobs.save(job);
        return { job, pollUrl: `/api/assets/jobs/${job.id}` };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger?.warn({ error: message }, "remote asset submit failed; using demo");
        job.remoteError = message;
        return this.succeed(job, this.demoAsset(input, sha), { fallback: true });
      }
    }
    return this.succeed(job, this.demoAsset(input, sha));
  }

  getJob(id: string): AssetJob {
    return this.jobs.get(id);
  }

  listJobs(): AssetJob[] {
    return this.jobs.list();
  }

  async poll(id: string): Promise<GeneratedAssetResponse> {
    const job = this.jobs.get(id);
    if (job.status === "succeeded")
      return {
        job,
        asset: job.assetId ? this.store.asset(job.assetId) : undefined,
        cached: job.cached,
      };
    if (job.status === "failed") return { job };
    if (!job.remoteJobId || !this.remote.configured)
      return this.succeed(
        job,
        this.demoAsset(this.inputFor(job), job.sourceImageSha256),
        { fallback: true },
      );

    try {
      const remote = await this.remote.getJob(job.remoteJobId);
      if (remote.status === "queued" || remote.status === "running") {
        job.status = remote.status;
        this.jobs.save(job);
        return { job, pollUrl: `/api/assets/jobs/${job.id}` };
      }
      if (remote.status === "failed")
        throw new Error(
          remote.error?.message || remote.error?.code || "远端 GPU 任务失败",
        );

      const result = remote.result || {};
      const bytes = await this.remote.downloadModel(result, job.remoteJobId);
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
      const image = this.jobs.readInputImage(job);
      if (image.length) {
        this.cache.write(job.sourceImageSha256, image, bytes, {
          input_sha256: job.sourceImageSha256,
          name: job.name,
          category: job.category,
          provider: "remote-gpu",
          is_real_generation: true,
          size_mm: { w: asset.w, d: asset.d, h: asset.h },
          glb_sha256: asset.sha256,
          scale_calibrated: asset.scaleCalibrated === true,
          scale_source: asset.scaleSource,
          created_at: new Date().toISOString(),
        });
      }
      return this.succeed(job, asset);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.warn({ error: message }, "remote asset job failed; using demo");
      job.remoteError = message;
      return this.succeed(
        job,
        this.demoAsset(this.inputFor(job), job.sourceImageSha256),
        { fallback: true },
      );
    }
  }

  calibrate(assetId: string, targetHeightMm: number): AssetRecord {
    const record = this.store.asset(assetId);
    const updated = calibrateAssetRecord(record, targetHeightMm);
    this.store.updateAsset(updated);
    if (record.sourceImageSha256)
      this.cache.updateCalibration(record.sourceImageSha256, updated);
    return updated;
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
    this.jobs.save(job);
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
      generatedAt: new Date().toISOString(),
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

  private inputFor(job: AssetJob): GenerateAssetInput {
    return {
      image: this.jobs.readInputImage(job),
      filename: job.inputFile,
      name: job.name,
      category: job.category,
      targetHeightMm: job.targetHeightMm,
    };
  }
}
