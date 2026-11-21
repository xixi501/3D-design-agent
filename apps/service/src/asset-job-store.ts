import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readJsonFile, writeJsonAtomic } from "./asset-cache.js";

export type AssetProviderName = "real-cache" | "remote-gpu" | "demo";
export type AssetJobStatus = "queued" | "running" | "succeeded" | "failed";
export type ReferenceViewLabel = "back" | "left" | "right" | "top" | "bottom";

export interface ReferenceImageInput {
  image: Buffer;
  filename?: string;
  view?: ReferenceViewLabel;
}

export interface GenerateAssetInput {
  image: Buffer;
  filename?: string;
  name?: string;
  category?: string;
  targetHeightMm?: number;
  referenceImages?: ReferenceImageInput[];
  referenceViews?: ReferenceViewLabel[];
}

export interface AssetJob {
  id: string;
  status: AssetJobStatus;
  provider: AssetProviderName;
  name: string;
  category?: string;
  targetHeightMm?: number;
  sourceImageSha256: string;
  inputFile: string;
  referenceViews?: ReferenceViewLabel[];
  createdAt: string;
  updatedAt: string;
  remoteJobId?: string;
  assetId?: string;
  error?: string;
  remoteError?: string;
  cached?: boolean;
  fallback?: boolean;
}

const IMAGE_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

/**
 * Local persistence for asynchronous image-to-3D generation jobs.
 */
export class AssetJobStore {
  constructor(readonly directory: string) {
    fs.mkdirSync(directory, { recursive: true });
  }

  create(
    input: GenerateAssetInput,
    sha: string,
    mime: string,
    defaultProvider: AssetProviderName,
  ): AssetJob {
    const id = randomUUID(),
      extension = IMAGE_EXT[mime] || ".png",
      inputFile = `${id}${extension}`,
      now = new Date().toISOString();
    fs.writeFileSync(path.join(this.directory, inputFile), input.image);
    const job: AssetJob = {
      id,
      status: "running",
      provider: defaultProvider,
      name: (input.name || input.filename || "未命名物品")
        .replace(/\.[^.]+$/, "")
        .slice(0, 120),
      category: input.category,
      targetHeightMm: input.targetHeightMm,
      sourceImageSha256: sha,
      inputFile,
      ...(input.referenceViews?.length
        ? { referenceViews: input.referenceViews }
        : {}),
      createdAt: now,
      updatedAt: now,
    };
    this.save(job);
    return job;
  }

  save(job: AssetJob) {
    job.updatedAt = new Date().toISOString();
    writeJsonAtomic(path.join(this.directory, `${job.id}.json`), job);
  }

  get(id: string): AssetJob {
    const job = readJsonFile<AssetJob>(path.join(this.directory, `${id}.json`));
    if (!job) throw new Error(`资产任务不存在：${id}`);
    return job;
  }

  list(): AssetJob[] {
    if (!fs.existsSync(this.directory)) return [];
    return fs
      .readdirSync(this.directory)
      .filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))
      .map((name) => readJsonFile<AssetJob>(path.join(this.directory, name))!)
      .filter(Boolean)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  readInputImage(job: AssetJob): Buffer {
    const file = path.join(this.directory, job.inputFile);
    return fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
  }
}
