# ActiScape 资产服务（成员二）

独立的图片任务、GLB 资产存储与三维预览模块。当前版本 `0.1.0`。

## 能力边界

- `demo` 后端：固定返回团队核心分支的 `textured-vase.glb` 示例，只验证上传、状态、持久化、预览与下载。**结果不是输入照片的真实重建。**
- `hunyuan` 后端：调用 Hunyuan3D-2 图像到几何与贴图管线，输出真实生成 GLB。需要 NVIDIA CUDA GPU，具体安装见 [SERVER_RUNBOOK.md](SERVER_RUNBOOK.md)。
- 单张照片中的背面与遮挡区域由模型补全；真实尺寸不能仅凭照片确定。元数据中的 `scale_calibrated` 首版固定为 `false`，由主系统向用户确认尺寸。

## 本机演示

需要 Python 3.10–3.13，无需 GPU。

```bash
cd apps/asset-service
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e .
ASSET_BACKEND=demo python -m asset_service
```

打开 `http://127.0.0.1:8000/`。选择 `examples/demo-input.png` 或自己的 JPEG/PNG/WebP，提交后可以旋转、缩放模型并下载 GLB。Three.js 0.160.0 通过 CDN 加载，首次打开页面需要联网。

运行时数据默认写入当前目录的 `generated_assets/`。该目录包含输入图片与模型，不应提交到 Git。

## HTTP 调用

创建任务：

```bash
curl -X POST http://127.0.0.1:8000/api/v1/jobs \
  -H 'Idempotency-Key: demo-vase-001' \
  -F 'name=演示花瓶' \
  -F 'file=@examples/demo-input.png;type=image/png'
```

从响应复制 `job.id`，查询状态：

```bash
curl http://127.0.0.1:8000/api/v1/jobs/JOB_ID
curl http://127.0.0.1:8000/api/v1/assets
curl -OJ http://127.0.0.1:8000/api/v1/assets/ASSET_ID/model
```

如果服务设置了 `ASSET_API_KEY`，除健康检查外的请求都要加请求头：

```bash
-H "X-API-Key: $ASSET_API_KEY"
```

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/v1/health` | 服务、版本与后端状态 |
| POST | `/api/v1/jobs` | multipart 图片字段 `file`、可选 `name`；支持 `Idempotency-Key` |
| GET | `/api/v1/jobs` | 任务列表 |
| GET | `/api/v1/jobs/{id}` | 查询状态、错误或完成结果 |
| GET | `/api/v1/assets` | 已完成资产列表 |
| GET | `/api/v1/assets/{id}` | 资产元数据 |
| GET | `/api/v1/assets/{id}/model` | 下载完整 GLB |

任务状态为 `queued → running → succeeded`，失败为 `failed` 并带 `error.code/message`。服务重启会把未完成任务标为 `JOB_INTERRUPTED`，不会假装后台任务仍在运行；已完成资产可以继续读取。相同幂等键和相同内容返回原任务，相同键对应不同内容返回 HTTP 409。

## 元数据与坐标

完成任务的 `result` 同时是资产元数据，包含：

- `asset_id/job_id`：稳定身份；当前二者相同。
- `model_url`：相对 URL，不含某台机器的私有绝对路径。
- `generation.mode/is_real_generation/model`：明确区分演示与真实生成。
- `file.sha256/bytes/vertices/materials`：文件校验与基本规模。
- `spatial.unit=m`、`up_axis=Y`、`bounds_min/bounds_max`：GLB 源坐标信息。
- `spatial.size_m/size_mm`：宽 `w`、深 `d`、高 `h`。
- `spatial.normalization`：`scale` 为源单位到米的系数，`center` 为 `[中心X, 底部Y, 中心Z]`。
- `spatial.scale_calibrated=false`：尺寸仍需用户确认。

## 交给成员一

主系统 `dev/core` 已提供 `POST /api/assets`，接收静态、未压缩、贴图内嵌 GLB，返回毫米尺寸和归一化信息。本服务导出时检查这些约束。将下载的 GLB 上传主系统即可：

```bash
curl -X POST http://127.0.0.1:3001/api/assets \
  -F 'file=@JOB_OR_ASSET_ID.glb;type=model/gltf-binary'
```

主系统场景使用毫米、地面 x/y、向上 z；GLB 使用米、Y-up。主系统已有转换与导入脚本 `scripts/import-asset.mjs`。本模块不负责落点、房间状态、撤销或保存。

## 配置

见 `.env.example`。环境变量需要由 shell 或部署平台注入，本模块不会自动读取 `.env`。

- `ASSET_BACKEND=demo|hunyuan`
- `ASSET_DATA_DIR`：持久数据目录，服务器上应放在持久磁盘。
- `ASSET_API_KEY`：可选；公网/共享平台部署必须设置。
- `ASSET_CORS_ORIGINS`：允许跨域调用的主系统来源，逗号分隔；同源网页无需设置。
- `HUNYUAN_*`：真实生成模型、子目录、代码版本与低显存开关。

## 已知限制

- 单进程单 GPU 工作线程，适合首版演示，不是分布式队列。
- 重启不自动恢复未完成任务；需要重新提交。
- 首版不做自动减面、真实尺寸推断或支撑面检查。
- 输入图片和生成结果保存在本地磁盘，生产部署需要备份与访问控制。
