# 照片转 3D 资产网关接口（成员一负责侧）

> 实现：`apps/service/src/asset-provider.ts` + `apps/service/src/app.ts`
> 上游：成员二 `apps/asset-service`（FastAPI + Hunyuan3D-2）与学校 V100 服务器
> 原则：`apps/agent`/前端只访问 `apps/service`，不直连 GPU 端口；所有资产仍由编辑器的
> `Candidate / command` 门禁放入场景。

## 1. 三级资产提供器

| 优先级 | provider | 触发条件 | 行为 |
| --- | --- | --- | --- |
| 1 | `real-cache` | 图片 `sha256` 命中 `data/real-generated-assets/<sha>/` | 1 秒内读取真实 V100 产物，登记为 `custom_<assetId>`；`isRealGeneration=true` |
| 2 | `remote-gpu` | 未命中缓存且配置 `ASSET_SERVICE_URL` | 异步提交到成员二 `POST /api/v1/jobs`，立即返回 `202 + pollUrl`；前端轮询，不阻塞对话/工作台 |
| 3 | `demo` | 未配置 GPU 或远端失败 | 使用 `fixtures/textured-vase.glb` 固定演示资产；`isRealGeneration=false`；远端失败时 `fallback=true` 并保留 `remoteError` |

远端成功后，网关自动下载 GLB 并写入 `data/real-generated-assets/<sha>/`，下一次同图直接命中缓存。

## 2. 对外接口

### `POST /api/assets/generate-from-image`

`multipart/form-data`：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `file` | 是 | PNG / JPEG / WebP 单张物品照片，≤10 MB |
| `name` | 否 | 物品名称 |
| `category` | 否 | 成员二类别，如 `vase` / `flowerpot` / `ornament` |
| `targetHeightMm` 或 `target_height_mm` | 否 | 生成时即按目标高度校准 |

响应：

```json
{
  "job": {
    "id": "uuid",
    "status": "succeeded | queued | running | failed",
    "provider": "real-cache | remote-gpu | demo",
    "cached": true,
    "fallback": false,
    "assetId": "asset-…"
  },
  "asset": { "id": "asset-…", "w": 280, "d": 280, "h": 280, "provider": "real-cache", "scaleCalibrated": true, "defaultPlacement": "surface" },
  "cached": true,
  "pollUrl": "/api/assets/jobs/<jobId>"
}
```

- 缓存/演示命中：HTTP **201**，直接返回 `asset`。
- 远端异步：HTTP **202**，返回 `pollUrl`。
- 断言失败不会写入正式 Project；只登记资产。

### `GET /api/assets/jobs/:id`

轮询远端任务。每次请求会向成员二查询一次；成功后下载 GLB、登记资产、写缓存并返回 `asset`。
远端失败时自动回退演示资产（`fallback=true`），同一接口返回成功，前端展示提示即可。

### `GET /api/assets/jobs`

列出本地资产任务（排队/运行/成功/失败）。

### `POST /api/assets/:assetId/calibrate`

```json
{ "targetHeightMm": 280 }
```

按用户确认的真实高度等比校准 `w/d/h` 与 `normalization.scale`，写回 `AssetRecord`：

- `scaleCalibrated=true`
- `scaleSource="user_confirmed"`
- `defaultPlacement="surface"`

不重跑 GPU；不重写不可变 GLB 文件，编辑器通过 `normalization.scale` 渲染为确认尺寸。

### `GET /api/assets/providers`

返回缓存目录/命中案例数、远端是否配置、演示资产是否可用，供工作台显示状态。

## 3. 成员二远端契约（网关适配）

网关按成员二 `origin/dev/assets @ 8552b78` 的 FastAPI 契约调用：

```text
POST {ASSET_SERVICE_URL}/api/v1/jobs        multipart: file, name, category, target_height_mm
GET  {ASSET_SERVICE_URL}/api/v1/jobs/{id}   -> { job: { status, result: { asset_id, model_url, spatial } } }
GET  {ASSET_SERVICE_URL}/api/v1/assets/{asset_id}/model
POST {ASSET_SERVICE_URL}/api/v1/assets/{asset_id}/calibrate   （成员二升级后可选）
```

- 请求头：配置 `ASSET_API_KEY` 时带 `X-API-Key`；`Idempotency-Key` 使用图片 sha256。
- 网关兼容 `result.model_url` 为绝对 URL 或 `/api/v1/...` 相对路径。
- 成员二新增 `/calibrate` 后，网关仍以本地 `POST /api/assets/:id/calibrate` 为统一入口；
  后续可把本地校准透传给远端，不改变前端契约。

## 4. 环境变量

| 变量 | 默认 | 用途 |
| --- | --- | --- |
| `ACTISCAPE_ASSET_CACHE_DIR` | `${ACTISCAPE_DATA_DIR}/real-generated-assets` | 真实 V100 产物缓存根目录 |
| `ASSET_SERVICE_URL` | 空（关闭远端） | 成员二服务地址，例如 `http://127.0.0.1:8010` |
| `ASSET_API_KEY` | 空 | 成员二 `X-API-Key` |
| `ASSET_REMOTE_TIMEOUT_MS` | `180000` | 远端提交/下载超时 |
| `ACTISCAPE_DEMO_ASSET` | `fixtures/textured-vase.glb` | 演示回退 GLB |

## 5. 编辑器闭环

1. 工作台/对话/属性面板上传单张物品照片；
2. `apps/service` 返回资产或排队任务，前端显示“真实缓存 / 远端 GPU / 演示资产”；
3. 用户确认毫米高度 → `POST /api/assets/:id/calibrate`；
4. 前端选择茶几/餐桌/书桌/电视柜/床头柜台面或地面 → 生成普通 `furniture` 命令：
   - 台面：`placement="surface"`、`parentObjectId=<host.id>`、`z=host.z+host.h`；
   - 地面：`placement="floor"`、`z=0`；
5. 仍走编辑器的 `commands`/候选事务，`checkScene` 的 `SURFACE_ITEM_OVERHANG` 与
   `SURFACE_ITEM_COLLISION` 负责最终校验。

## 6. 缓存目录契约

见 [`data/real-generated-assets/README.md`](../data/real-generated-assets/README.md)。
成员二把减面至 ≤3 万顶点、底部中心 `(0,0,0)`、已校准的真实 GLB 放入
`data/real-generated-assets/<input_sha256>/` 即可被网关秒级命中。
