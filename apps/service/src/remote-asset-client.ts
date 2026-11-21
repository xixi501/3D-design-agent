import { createHash } from "node:crypto";
import { imageMime } from "./assets.js";
import type { GenerateAssetInput, ReferenceViewLabel } from "./asset-job-store.js";

const DEFAULT_VIEWS: ReferenceViewLabel[] = [
  "back",
  "left",
  "right",
  "top",
  "bottom",
];

/**
 * HTTP client encapsulating the GPU asset-service (/api/v1/jobs) contract,
 * supporting both single-view and Hunyuan3D-2mv multi-view inputs.
 */
export class RemoteAssetClient {
  readonly baseUrl: string;

  constructor(
    serviceUrl: string,
    readonly apiKey: string = "",
    readonly timeoutMs: number = 180_000,
  ) {
    this.baseUrl = serviceUrl.replace(/\/+$/, "");
  }

  get configured(): boolean {
    return Boolean(this.baseUrl);
  }

  private authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (this.apiKey) headers["X-API-Key"] = this.apiKey;
    return headers;
  }

  async submit(
    input: GenerateAssetInput,
    mime: string,
    compositeSha: string,
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

    const refs = input.referenceImages || [];
    if (refs.length > 5) {
      throw new Error("最多支持 5 张多视角参考图片");
    }
    const views: ReferenceViewLabel[] =
      input.referenceViews && input.referenceViews.length === refs.length
        ? input.referenceViews
        : refs.map((r, i) => r.view || DEFAULT_VIEWS[i]);
    for (let i = 0; i < refs.length; i++) {
      const refMime = imageMime(refs[i].image);
      if (!refMime) throw new Error("参考图只支持 PNG、JPEG 或 WebP 图片");
      form.append(
        "reference_images",
        new Blob([new Uint8Array(refs[i].image)], { type: refMime }),
        refs[i].filename || `${views[i]}.png`,
      );
    }
    if (refs.length) {
      form.append("reference_views", JSON.stringify(views));
    }

    const idempotencyKey = createHash("sha256")
      .update(compositeSha)
      .update("\n")
      .update(resolvedName)
      .update("\n")
      .update(input.category || "")
      .update("\n")
      .update(String(input.targetHeightMm || 0))
      .update("\n")
      .update(views.join(","))
      .digest("hex");

    const response = await fetch(`${this.baseUrl}/api/v1/jobs`, {
      method: "POST",
      headers: this.authHeaders({ "Idempotency-Key": idempotencyKey }),
      body: form,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        body?.detail || `远端资产服务 HTTP ${response.status}`,
      );
    }
    const remote = body.job || body;
    if (!remote?.id) throw new Error("远端资产服务没有返回 job.id");
    return { id: String(remote.id) };
  }

  async getJob(id: string): Promise<any> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/jobs/${encodeURIComponent(id)}`,
      {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );
    const body: any = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(body?.detail || `远端任务查询 HTTP ${response.status}`);
    return body.job || body;
  }

  async downloadModel(result: any, remoteJobId: string): Promise<Buffer> {
    const url =
      result.model_url ||
      (result.asset_id
        ? `/api/v1/assets/${result.asset_id}/model`
        : `/api/v1/jobs/${remoteJobId}/model`);
    const absolute = /^https?:/.test(url) ? url : `${this.baseUrl}${url}`;
    const response = await fetch(absolute, {
      headers: this.authHeaders(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok)
      throw new Error(`下载远端 GLB 失败：HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
}
