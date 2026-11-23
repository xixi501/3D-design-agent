# ActiScape 资产服务（成员二）

独立的单图/多视角图片任务、GLB 资产存储与三维预览模块。当前版本 `0.2.1`。

## 能力边界

- `demo`：固定返回团队核心分支的花瓶样本，只验证流程，不是输入照片的真实重建。
- `hunyuan`：使用 Hunyuan3D-2 几何、去光照和贴图管线；贴图前执行悬浮块清理、退化面清理和默认 20,000 面减面。
- 透明背景 RGBA 图片直接保留；白底或不透明 PNG/JPG 会转为 RGB 后执行背景移除。
- 支持 1–6 张图片。首图为 `front`，补充图片可标记 `back/left/right/top/bottom`；前、后、左、右参与多视角几何，所有有效视角参与贴图。
- 单图背面与遮挡由模型补全。类别默认尺寸不是真实测量值，主系统应向用户确认尺寸。
- 预览页支持多角度上传、正背左右切换、PBR 环境和接触阴影；公开 `/asset-demo/` 仅只读，不开放匿名 GPU 生成。

## 本机演示与测试

需要 Python 3.10–3.13，无需 GPU：

```bash
cd apps/asset-service
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e .
ASSET_BACKEND=demo python -m asset_service
```

打开 `http://127.0.0.1:8000/`。Three.js 0.160.0 及所需 addons 随服务本地提供，不依赖 CDN。运行测试：

```bash
PYTHONPATH=apps/asset-service python3 -m unittest discover -s apps/asset-service/tests -v
```

运行时数据默认在 `generated_assets/`，不提交到 Git。

## 生成接口

```bash
curl -X POST http://127.0.0.1:8000/api/v1/assets/generate \
  -H 'Idempotency-Key: vase-001' \
  -F 'name=陶瓷花瓶' \
  -F 'category=vase' \
  -F 'placement_type=surface' \
  -F 'target_height_mm=280' \
  -F 'max_faces=20000' \
  -F 'image=@examples/front.png;type=image/png' \
  -F 'reference_images=@examples/back.png;type=image/png' \
  -F 'reference_images=@examples/left.png;type=image/png' \
  -F 'reference_views=["back","left"]'
```

可选 `prompt` 当前只记录为生成上下文，不改变 Hunyuan 单图管线。`target_height_mm` 省略时使用类别默认高度；`max_faces` 省略时使用 `ASSET_MAX_FACES=20000`。

相同归一化输入图片的 SHA256 已有成功结果时，接口直接复用并返回 `cached=true`。设置 `force_regenerate=true` 可强制重新生成。`Idempotency-Key` 仍用于请求级去重，相同键对应不同内容返回 409。

原有 `POST /api/v1/jobs`（文件字段 `file`）继续保留，默认使用 `decor` 类别。

## 状态、结果与校准

```bash
curl http://127.0.0.1:8000/api/v1/jobs/JOB_ID
curl http://127.0.0.1:8000/api/v1/assets/ASSET_ID
curl -OJ http://127.0.0.1:8000/api/v1/assets/ASSET_ID/model.glb
```

用户确认尺寸后，无需重新推理：

```bash
curl -X POST http://127.0.0.1:8000/api/v1/assets/ASSET_ID/calibrate \
  -H 'Content-Type: application/json' \
  -d '{"heightMm":280,"category":"vase","placementType":"surface"}'
```

也可传可选 `widthMm/depthMm`。省略时按模型包围盒长宽比计算。校准结果写入任务结果、`metadata.json` 和 `record.json`，`scaleSource` 变为 `user_confirmed`。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/v1/health` | 服务与后端状态 |
| POST | `/api/v1/assets/generate` | 新生成接口，支持类别、尺寸、减面和 SHA256 缓存 |
| POST | `/api/v1/jobs` | 兼容旧任务接口 |
| GET | `/api/v1/jobs/{id}` | 状态、错误或结果 |
| GET | `/api/v1/assets` | 已完成资产 |
| GET | `/api/v1/assets/{id}` | 资产契约与元数据 |
| POST | `/api/v1/assets/{id}/calibrate` | 毫秒级尺寸校准 |
| GET | `/api/v1/assets/{id}/model.glb` | 下载 GLB；旧 `/model` 保留 |
| GET | `/api/v1/assets/{id}/preview.png` | 输入图片预览 |

设置 `ASSET_API_KEY` 后，除健康检查外都需要 `X-API-Key` 请求头。

## 主系统对接契约

资产生成或校准后固定包含：

- `assetId/name/status/category/placementType`。
- `physicalDimensionsMm={width,depth,height}` 和 `scaleSource=category_default|user_confirmed`。
- `pivot=bottom_center`、`inputSha256`、`glbUrl`、`previewUrl`。
- `stats={vertices,faces,fileSizeBytes,aspectRatio}`。
- `generation.mode/is_real_generation`，明确真实生成与 demo。

GLB 文件采用米、Y-up，水平 X/Z 中心为 0，底部 `min_y=0`，最长边归一化为 1。`spatial` 描述该单位包络；主系统应使用 `physicalDimensionsMm` 设置毫米级实例尺寸，不要把单位包络高度当成真实 1 米。

类别默认高度：花瓶 280、台灯 450、植物 600、椅子 820、边几/桌子 520、沙发 840、床 700、摆件 250 mm。`plant/chair/table/side_table/sofa/bed` 默认 `floor`，其他类别默认 `surface`。

## V100 轻量预设导出

在配置好权重和依赖的学校服务器上：

```bash
python -m asset_service.preset \
  examples/photo.jpg \
  presets/real-v100-vase \
  --height-mm 280 \
  --max-faces 20000
```

该命令在贴图前减面，导出底部中心归一化 GLB，并生成 `model.glb`、`preview.png`、`record.json`。预设只有在实际 V100 运行、下载并检查后才能提交。

## 配置与限制

见 `.env.example`。`ASSET_MAX_FACES` 控制默认面数；`ASSET_DATA_DIR` 应位于持久磁盘；`ASSET_CORS_ORIGINS` 配置主系统来源；`HUNYUAN_*` 配置模型与代码版本。

当前为单进程单工作线程；重启不续跑未完成任务。输入和结果需要备份与访问控制。类别默认尺寸不是校准结果，背面材质仍需逐案例检查。
