# 启动、验证与恢复

本文保留 S1 基础运行说明。当前完整工作台含 Python Agent 服务，请优先按 [S2-A 启动与恢复](S2A_RUNBOOK.md) 安装与启动。

产品目录 `/workspace/3D-design-agent`，开发分支 `dev/core`。本工程不读取、安装或修改 SceneSmith 的环境。

## 环境

- Node.js 24（`.nvmrc` 固定 24.22.2），npm lockfile 固定依赖。
- 前端 Three.js 0.160.0 / TypeScript / Vite；服务 Fastify 5 / better-sqlite3。
- 基准重建另外使用 Python + Pillow；产品运行不需要 Python。
- 浏览器验证使用真实 Chrome/Chromium，设置 `CHROME_PATH` 可指定位置。测试默认 SwiftShader 软件渲染。

本机隔离 Node：`/workspace/.actiscape-tools/node-v24.22.2-linux-x64/bin`。下载包的官方 SHA-256 校验值：`48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75`。

```bash
cd /workspace/3D-design-agent
export PATH=/workspace/.actiscape-tools/node-v24.22.2-linux-x64/bin:$PATH
npm ci
npm run build
npm start
```

打开 `http://127.0.0.1:3001/`。开发时使用 `npm run dev`：编辑器 5173，API 3001。默认只监听本机；远程部署通过反向代理或端口转发访问。

```bash
ACTISCAPE_DATA_DIR=/absolute/persistent/actiscape PORT=3001 HOST=127.0.0.1 npm start
curl --fail http://127.0.0.1:3001/api/health
```

数据库和 GLB 必须放在同一个持久数据目录的 `projects.sqlite` 和 `assets/` 中。不要将数据目录放入 Git。服务输出 JSON 请求与错误日志。单用户可信环境，不提供账号隔离或公网鉴权。

## 基准与验收

首次为原版建立独立 Python 环境：

```bash
python3 -m venv .tools/reference-python
.tools/reference-python/bin/python -m pip install Pillow==13.0.0
npm run reference:build
```

`ACTISCAPE_PYTHON` 可以指定其他独立 Python。原版入口为 `reference/runtime/living-dining.html?debug`，固定源码位于 `reference/upstream`，哈希见其 `provenance.json`。

```bash
npm run test:all
```

该命令运行来源校验、核心/服务测试、生产构建、原版基准、真实浏览器操作、24 组建模参数对照与 266 项目录几何对照。需要已安装 Chrome 和 Pillow。普通开发可分别运行 `npm test`、`npm run build`、`npm run test:browser`。

新结果保存在 `test-results/`，当前交付证据在 `docs/evidence/`。浏览器测试使用独立临时数据库并实际重启服务，不访问日常 `data/`。原版参考 HTML 永不加载进产品应用。

## 保存、导出与资产

编辑事务在服务端持久化后才显示保存成功。拖动期间是预览，松开后提交一次事务。项目列表中的“打开”恢复同一项目及其撤销位置；不同浏览器连接同一服务也能恢复。

拖动或输入过程中若场景被脚本 / 另一页面修改，本次编辑可能因起始版本过期而拒绝。界面会刷新最新场景并提示重试，不会把旧交互静默覆盖到新版本上。

项目链接使用 `/?project=项目身份`。工作台打开项目时更新地址，工具示例也会输出对应链接，可在干净浏览器中直接打开同一项目。

导出 JSON 包含当前完整场景及资产清单，**不内嵌 GLB，也不携带数据库中的历史事务**。重新导入 JSON 会创建新项目，保留业务对象 ID。恢复已有项目及历史用“打开项目”；跨服务器迁移使用以下完整目录备份。

原版 JSON 缺少模型文件时，导入对话框列出引用，选择对应 GLB 并确认映射。GLB 上传失败或场景校验失败不会提交部分项目。资产以 SHA-256 标识，重复上传复用同一文件；当前没有自动清理，历史引用不会被删除。

## 停服备份与恢复

1. 停止编辑请求，用 Ctrl+C / SIGTERM 正常停止服务，确认进程退出。
2. 完整复制数据目录（若还有 `-wal`、`-shm` 文件，一并复制）。记录当前业务 Git 提交、Node 版本和依赖锁文件。
3. 在目标服务器安装对应提交与依赖，把完整备份复制到新的持久目录。
4. 用 `ACTISCAPE_DATA_DIR` 指向该目录启动，检查 `/api/health`，打开原项目，验证版本、撤销/重做和 GLB 贴图。

示例（服务停止后）：

```bash
cp -a data /absolute/backups/actiscape-2026-11-05
ACTISCAPE_DATA_DIR=/absolute/backups/actiscape-2026-11-05 npm start
```

升级前先保留完整备份。回退时使用备份对应的业务提交和数据目录；不要用旧程序覆盖未知新格式数据库。本阶段格式版本为 1，没有跨版本数据库自动迁移。

## 排障

- `REVISION_CONFLICT`：读取最新快照，重新检查用户意图后提交；不能只换版本号强行覆盖。
- `OPERATION_CONFLICT`：操作身份已用于不同内容，修正调用方去重逻辑。
- 网络中断：界面显示失败，恢复连接后重新读快照；脚本可用相同操作身份和完整请求重试。
- `MISSING_ASSETS`：上传缺失 GLB，并在导入时提交旧引用到稳定资产身份的映射。
- `UNSUPPORTED_GLB`：返回具体格式原因。首版接受有三维体积、资源完整的静态未压缩 GLB，贴图为内嵌 PNG/JPEG；不支持 Draco、Meshopt、KTX2、骨骼动画或变形目标，单文件最多 50 MB / 300 万顶点。
- SQLite 原生模块：确认使用 Node 24 后重新 `npm ci`；当前平台 native smoke test 必须成功。
- Vite 的单 chunk 大小提示不影响构建通过；三维建模代码当前随工作台一起加载。
