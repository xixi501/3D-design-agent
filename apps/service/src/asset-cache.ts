import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { imageMime } from "./assets.js";
import type { AssetRecord } from "../../../packages/scene-core/src/index.js";

export interface CacheCase {
  directory: string;
  metadata: Record<string, any>;
  glb: Buffer;
}

const IMAGE_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

export function readJsonFile<T = any>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

export function writeJsonAtomic(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(temporary, file);
}

/**
 * Content-addressed local cache for real GPU-generated GLB assets.
 */
export class AssetCache {
  constructor(readonly directory: string) {
    fs.mkdirSync(directory, { recursive: true });
  }

  private directories(): string[] {
    if (!fs.existsSync(this.directory)) return [];
    return fs
      .readdirSync(this.directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(this.directory, entry.name));
  }

  find(sha: string): CacheCase | undefined {
    for (const dir of this.directories()) {
      const metadata = readJsonFile<Record<string, any>>(
        path.join(dir, "metadata.json"),
      );
      if (!metadata) continue;
      const inputSha =
        metadata.input_sha256 ||
        metadata.inputSha256 ||
        metadata.source_image_sha256;
      if (inputSha !== sha) continue;
      const glbFile = path.join(
        dir,
        typeof metadata.glb === "string" ? metadata.glb : "asset.glb",
      );
      if (!fs.existsSync(glbFile)) continue;
      return { directory: dir, metadata, glb: fs.readFileSync(glbFile) };
    }
    return undefined;
  }

  list(): CacheCase[] {
    const cases: CacheCase[] = [];
    for (const dir of this.directories()) {
      const metadata = readJsonFile<Record<string, any>>(
        path.join(dir, "metadata.json"),
      );
      const glbFile = path.join(
        dir,
        typeof metadata?.glb === "string" ? metadata.glb : "asset.glb",
      );
      if (metadata && fs.existsSync(glbFile))
        cases.push({ directory: dir, metadata, glb: fs.readFileSync(glbFile) });
    }
    return cases;
  }

  write(
    sha: string,
    image: Buffer,
    glb: Buffer,
    metadata: Record<string, any>,
  ) {
    const dir = path.join(this.directory, sha);
    if (fs.existsSync(path.join(dir, "asset.glb"))) return;
    fs.mkdirSync(dir, { recursive: true });
    const extension = IMAGE_EXT[imageMime(image) || "image/png"] || ".png";
    fs.writeFileSync(path.join(dir, `input${extension}`), image);
    fs.writeFileSync(path.join(dir, "asset.glb"), glb);
    writeJsonAtomic(path.join(dir, "metadata.json"), metadata);
  }

  updateCalibration(sha: string, record: AssetRecord) {
    const dir = path.join(this.directory, sha);
    const metadata = readJsonFile<Record<string, any>>(
      path.join(dir, "metadata.json"),
    );
    if (!metadata) return;
    writeJsonAtomic(path.join(dir, "metadata.json"), {
      ...metadata,
      size_mm: { w: record.w, d: record.d, h: record.h },
      scale_calibrated: record.scaleCalibrated === true,
      scale_source: record.scaleSource,
      updated_at: new Date().toISOString(),
    });
  }
}
