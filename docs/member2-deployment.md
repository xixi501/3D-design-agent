# 成员二资产服务部署交接

更新日期：2026-11-13

## 部署版本

- Git 分支：`dev/assets`
- 部署提交：`6845457a00af9d54a50ebc59e189e85bfbd6617f`
- 模块版本：`actiscape-asset-service 0.2.1`
- Hunyuan3D 代码：`f8db63096c8282cb27354314d896feba5ba6ff8a`
- 服务后端：`hunyuan`
- 路径前缀：`/aiforward1107998469848563712`

## 访问地址

平台基础 URL：

```text
http://aic.bnu.edu.cn/aiforward1107998469848563712
```

API 根路径：

```text
http://aic.bnu.edu.cn/aiforward1107998469848563712/api/v1
```

平台当前提供 HTTP 转发，未验证 HTTPS。主系统不要去掉路径前缀；0.2.1 会通过 `ASSET_ROOT_PATH` 处理该前缀。

## 鉴权

除健康检查和 OpenAPI 外，请求均使用请求头：

```http
X-API-Key: <私密密钥>
```

密钥不写入 Git、日志或交付报告。服务器上的配置位置为：

```text
/public/home/wangruohan/.config/actiscape/asset-service.env
```

文件权限为 `600`。请通过成员间私密渠道交接密钥。

## 主要接口

- `GET /api/v1/health`
- `POST /api/v1/assets/generate`：multipart 图片字段为 `image`
- `GET /api/v1/jobs/{id}`
- `GET /api/v1/assets/{id}`
- `POST /api/v1/assets/{id}/calibrate`
- `GET /api/v1/assets/{id}/model.glb`
- `GET /api/v1/assets/{id}/preview.png`
- `GET /openapi.json`

生成请求可选字段：`name`、`prompt`、`category`、`placement_type`、`target_height_mm`、`max_faces`、`force_regenerate`。

健康检查响应：

```json
{
  "status": "ok",
  "version": "0.2.1",
  "backend": "hunyuan",
  "real_generation": true
}
```

未提供或错误 API Key：

```http
401
```

```json
{"detail":"需要有效的 X-API-Key"}
```

任务或资产不存在：

```http
404
```

```json
{"detail":"任务不存在"}
```

## 已有联调资产

任务与资产 ID：

```text
5a775fe0-4b15-4e54-9bab-87b6146773dd
```

外部下载地址：

```text
http://aic.bnu.edu.cn/aiforward1107998469848563712/api/v1/assets/5a775fe0-4b15-4e54-9bab-87b6146773dd/model
```

已验证：

- 外部任务查询：HTTP 200，状态 `succeeded`
- 外部 GLB 下载：HTTP 200
- 文件大小：21,211,900 字节
- SHA-256：`05433b823f4c7fc4fd69fb351f9b94c3a40ab8780321ca6cd406ede8abdeff1e`

该记录由 0.1.0 生成，只有旧字段 `model_url`，缺少 `glbUrl`、`previewUrl` 和 `physicalDimensionsMm`。它适合验证任务查询、鉴权和 GLB 下载，不代表 0.2.1 新生成记录的完整契约。由于旧 GLB 原点不是 `bottom_center`，不能仅通过补元数据将其标记为新版资产。

## 服务管理

服务目录：

```bash
/public/home/wangruohan/member2-assets-server-6845457/member2-assets-server
```

持久数据：

```bash
/public/home/wangruohan/member2-assets-server/generated_assets
```

日志：

```bash
/public/home/wangruohan/member2-assets-server-6845457/member2-assets-server/server.log
```

查看进程：

```bash
cd /public/home/wangruohan/member2-assets-server-6845457/member2-assets-server
ps -p "$(cat server.pid)" -o pid,stat,etime,cmd
```

查看日志：

```bash
tail -f server.log
```

停止：

```bash
kill "$(cat server.pid)"
```

重启：

```bash
cd /public/home/wangruohan/member2-assets-server-6845457/member2-assets-server

set -a
source /public/home/wangruohan/.config/actiscape/asset-service.env
set +a

export ASSET_BACKEND=hunyuan
export ASSET_HOST=0.0.0.0
export ASSET_PORT=8000
export ASSET_ROOT_PATH=/aiforward1107998469848563712
export ASSET_DATA_DIR=/public/home/wangruohan/member2-assets-server/generated_assets
export HF_ENDPOINT=https://hf-mirror.com
export HF_HUB_DISABLE_XET=1
export HF_HUB_OFFLINE=1
export HUNYUAN_CODE_VERSION=f8db63096c8282cb27354314d896feba5ba6ff8a
export HUNYUAN_LOW_VRAM=0
export LD_LIBRARY_PATH=/public/home/wangruohan/.local/actiscape-libs:/public/home/wangruohan/miniconda3/envs/actiscape-assets/targets/x86_64-linux/lib:/public/home/wangruohan/miniconda3/envs/actiscape-assets/lib

nohup /public/home/wangruohan/miniconda3/envs/actiscape-assets/bin/python -m asset_service > server.log 2>&1 &
echo $! > server.pid
```

`nohup` 可防止网页终端或 SSH 断开导致服务退出。容器被平台停止、重建或超过自动停止期限后仍需重启；平台自动停止期限当前为 360 小时。

## 已验证网络范围

- 容器内部：`http://127.0.0.1:8000/api/v1/health` 返回 200。
- 本机外部网络到平台 HTTP 地址：健康检查 200，未带 Key 401，错误 Key 401。
- 学校容器通过平台外部地址访问自身：正确 Key 查询任务 200，GLB 下载 200。
- 尚未由主系统或 AgentArts 所在网络实际调用。
- 平台未验证 HTTPS；当前基础 URL 是 HTTP。

## 本次未做事项

- 未重新执行 GPU 推理。
- 未验证减面、背面材质修复或轻量预设。
- 未进行主系统场景入场、编辑、撤销和保存重开。
- 未对真实旧资产调用校准接口，避免修改既有记录。
