# AgentArts 上云前置改造审核交接（2026-11-10）

> 给审核 Agent：  
> 本轮完成了 **4 项上云前置代码改造 + 2 项冻结前收尾**，仓库已达到“拷到 ARM64 机器即可执行 `agentarts launch` 或 `docker build`”的产物就绪状态。
> 但**还没有在真实 ARM64 Docker/华为云 AgentArts 中构建和部署**。请把本文件与 `docs/AGENTARTS_DEPLOYMENT_DECISION_20261110.md`、实际代码一起审核，再给出下一步计划。

---

## 0. 仓库状态

- 路径：`/workspace/3D-design-agent`
- 分支：`dev/core`
- 代码基线：`716c696 feat(agentarts): add self-contained ARM64 bundle and cloud auth`
- 冻结前收尾（Token 闭环 / live 脚本 / 幂等运行时）另建 commit
- 本文档另建 docs-only commit；当前 HEAD 以 `git log -1` 为准
- 工作区：提交后干净
- 关键前置提交：
  - `b8dfcaf`：P4 本地运行时/cloud proxy 证据
  - `55d254c`：AgentArts 部署路径决策
  - `716c696`：双入口 / MaaS / 鉴权 / 自包含 Bundle

---

## 1. 本轮 4 项改造完成情况

| 任务 | 状态 | 实际实现 | 测试/证据 |
| --- | --- | --- | --- |
| 1. `AGENT_RUN_PORT` + `app:app` | **完成** | `agent.py` 双端口；新增 `deploy/agentarts-minimal/app.py`；Dockerfile 使用 `CMD python app.py` | Bundle 内 `app.py` 启动 `/ping` 通过；官方入口 `app:app` 与旧 `agent:app` 均可用 |
| 2. MaaS 环境变量兼容 | **完成** | `model_settings()` 支持 `MODEL_API_KEY/MODEL_URL/MODEL_NAME`；非 DeepSeek base 默认不发 `extra_body.thinking`；health 识别两个 Key | `test_model_config.py` 3 项；`create_model()` 用 MaaS 配置构造通过 |
| 3. 服务端 Bearer 鉴权 | **完成** | `apps/service` 可选 `ACTISCAPE_TOOL_TOKEN` Hook；支持 Bearer 与 `x-actiscape-token`；健康检查/公开文档放行 | `tests/agent-auth.test.ts` 覆盖开启/关闭、错误/正确 token |
| 4. 自包含 Bundle | **完成** | `scripts/prepare-agentarts-bundle.mjs`；根命令 `npm run build:agentarts-bundle`；生成 326 文件 Bundle | Bundle 测试通过；33 个 Skills；`requirements.txt` 无本地 editable 路径；`DEPLOY_RUNBOOK.md` 完整 |
| 5. 浏览器 Token 闭环 | **完成** | 服务端支持 `?token=`、Cookie、Header；编辑器 localStorage + `x-actiscape-token`；render-worker 带 token | 查询/Cookie 鉴权测试；受保护服务 live 验证通过 |
| 6. 云端一键取证 | **完成** | `scripts/verify-agentarts-live.mjs` + `verify:agentarts:live` | 受保护场景服务上 ping/action/duplicate 通过，revision 0→1 |

### 1.1 任务 1 细节

- `deploy/agentarts-minimal/agent.py`：
  ```python
  port = int(os.environ.get("AGENT_RUN_PORT") or os.environ.get("RUNTIME_PORT") or "8080")
  host = os.environ.get("RUNTIME_HOST", "0.0.0.0")
  ```
- `deploy/agentarts-minimal/app.py`：
  ```python
  from agent import app, handler
  ```
- 手动 Docker 与官方 CLI 共用同一个 `AgentArtsRuntimeApp`。

### 1.2 任务 2 细节

- `DEEPSEEK_MODEL` 优先，其次 `MODEL_NAME`；
- `DEEPSEEK_BASE_URL` 优先，其次 `MODEL_URL`；
- `DEEPSEEK_API_KEY` 优先，其次 `MODEL_API_KEY`；
- 非 DeepSeek 官方 base_url（如 `modelarts-maas.com`）默认 `extra_body={}`；显式 `DEEPSEEK_THINKING=enabled` 才发送 thinking；
- `health.modelConfigured` 同时识别两个 Key。

### 1.3 任务 3 细节

- 未设置 token：保持本地免密，现有编辑器/浏览器测试零影响；
- 设置 token：保护 `/api/*`；
- 放行 `/api/health`、`/api/openapi.json`；
- 支持：
  - `Authorization: Bearer <token>`
  - `x-actiscape-token: <token>`
- 不匹配返回 `401 {"error":"UNAUTHORIZED"}`。

**注意**：如果同一服务既给云端 Agent 又给浏览器编辑器使用，启用 token 后编辑器需要携带 token；建议云端场景网关单独暴露给 Agent，编辑器继续走本地/受控入口。

### 1.4 任务 4 Bundle 细节

```bash
cd /workspace/3D-design-agent
npm run build:agentarts-bundle
```

产物：

```text
dist/agentarts-bundle/
  app.py
  agent.py
  task_runtime.py
  actiscape_agent/        # 33 Skills + schemas + vendor
  requirements.txt        # 无 -e apps/agent / apps/agent 本地路径
  Dockerfile              # python:3.13-slim, COPY . /app, CMD python app.py
  .dockerignore
  .agentarts_config.yaml.example
  DEPLOY_RUNBOOK.md
  BUNDLE_MANIFEST.json
```

- Bundle 的 `Dockerfile` 设置 `AGENT_RUN_PORT=8080 RUNTIME_PORT=8080 RUNTIME_HOST=0.0.0.0`；
- Bundle 内 `app.py` 实测 `AGENT_RUN_PORT=8091` 启动 `/ping` 正常；
- `dist/` 被 Git 忽略，**Bundle 不提交仓库**；需要时重新生成。

---

### 1.5 冻结前 2 项收尾

- **浏览器 Token 闭环**：
  - `?token=` 或 Cookie `actiscape_token=` 或 Header 均可放行；查询/首次 Header 请求会种 `HttpOnly` Cookie；
  - 编辑器从 URL 读取 token 存 localStorage，每次 `api()` 带 `x-actiscape-token`；
  - 截图/GLB/EventSource 通过 Cookie 工作；
  - `render-worker` 的 Chromium 也注入 Bearer token，避免受保护服务下候选截图 401。
- **一键云端取证**：
  - `npm run verify:agentarts:live` 自动 ping、创建衣柜+茶几项目、`run_task` 开门、重复 requestId 幂等、可选 probe；
  - 输出 `test-results/agentarts-live-verification.json`；
  - 在受保护的本地运行时上实测 `passed=true`，revision 0→1，重复后仍为 1。

## 2. 验证结果

在代码基线 `716c696` 上执行：

| 命令 | 结果 |
| --- | --- |
| `npm test` | **82 passed / 0 failed** |
| `PYTHONPATH=apps/agent .venv/bin/python -m pytest apps/agent/tests -q` | **187 passed** |
| `npm run build:agentarts-bundle` | 通过，326 files |
| `npm run test:all` | **exit 0**（baseline/browser/parity/catalog/visual） |
| `npm run test:skill-pool:v1` | **exit 0**（13 Skills / 26 cases） |
| `npm test -w @actiscape/scene-core` | **23 passed** |
| `node scripts/platform-probe.mjs --prepare-only` | 通过 |
| `git status --short` | 空 |
| `git diff --check` | 通过 |

已验证的 Bundle 启动：

```text
PATH=/tmp/no-node-bin:/usr/bin:/bin
AGENT_RUN_PORT=8091
GET /ping -> {"status":"Healthy"}
```

---

## 3. 现在真实能做到什么

- 本地用 AgentArts SDK 跑 `/ping`、`probe`、`run_task`；
- 无 Node 宿主运行时执行完整 `run_task` 动作任务；
- 工作台网关 → 运行时 → 场景服务 cloud proxy 任务；
- 生成自包含 Bundle，内含全部 33 个 Skill、依赖、Dockerfile、runbook；
- 标准 MaaS 环境变量配置与 health 检查；
- 服务端可选 Bearer 鉴权；
- `app:app` 官方入口与 `agent:app` 旧入口双兼容。

## 4. 现在不能声称什么

1. **没有真实 ARM64 镜像**：本环境没有 Docker/`CAP_SYS_ADMIN`，无法构建。
2. **没有真实华为云 AgentArts 部署**：`cloudDeploymentVerified=false`。
3. **没有跑过真实完整 `platform-probe`**：只跑了 `--prepare-only`；完整 probe 需要模型 Key/Runtime。
4. **没有真实 MaaS 调用**：只验证了配置构造；没有用真实 `MODEL_API_KEY` 请求 MaaS。
5. **没有真实 V100 资产**：`data/real-generated-assets/` 仍为 0 案例，`apps/asset-service` 不存在。
6. **Bundle 没有 Docker build 验证**：326 文件内容/导入/`/ping` 已验证，但镜像构建/运行未验证。
7. **鉴权只做服务端 token**：浏览器编辑器在 token 模式下需要额外携带 token，当前未自动注入。
8. **生产级运维未做**：无多租户、限流、审计、外部任务持久化；`run_task` 仍是临时 SQLite 同步任务。

---

## 5. 审核 Agent 请重点检查

### 5.1 代码

1. `deploy/agentarts-minimal/app.py` / `agent.py`：
   - `app:app` 是否正确；
   - `AGENT_RUN_PORT` / `RUNTIME_PORT` 优先级；
   - 是否误改了 probe 逻辑。
2. `config.py` / `model.py`：
   - MaaS 变量优先级；
   - 非 DeepSeek 地址是否确实不发送 `extra_body.thinking`；
   - `api_key` 是否显式传入；
   - health 的 `modelConfigured`。
3. `apps/service/src/app.ts`：
   - token 未设置时是否完全放行；
   - token 设置后 `/api/health`、`/api/openapi.json` 是否放行；
   - `x-actiscape-token` 支持；
   - 是否影响本地浏览器测试。
4. `scripts/prepare-agentarts-bundle.mjs`：
   - `requirements.txt` 是否还有本地路径；
   - 33 Skills 是否完整；
   - Bundle 是否自包含（无 `../apps/agent`）；
   - `.agentarts_config.yaml.example` 的 YAML 是否可被 AgentArts SDK 解析；
   - `DEPLOY_RUNBOOK.md` 的命令是否可执行。
5. 是否有没有进入 Bundle 的必需文件（例如 vendor、schemas、skill 示例）。

### 5.2 产物

```bash
cd /workspace/3D-design-agent
git status --short
git log -1 --oneline

npm test
PYTHONPATH=apps/agent .venv/bin/python -m pytest apps/agent/tests -q
npm run build:agentarts-bundle
npm run test:all
npm run test:skill-pool:v1
npm test -w @actiscape/scene-core
node scripts/platform-probe.mjs --prepare-only
```

然后：

```bash
find dist/agentarts-bundle -maxdepth 1 -type f -printf '%f\n' | sort
grep -n "apps/agent\|^-e " dist/agentarts-bundle/requirements.txt || true
python - <<'PY'
from agentarts.toolkit.utils.runtime.config import AgentArtsConfigList
c=AgentArtsConfigList.from_yaml('dist/agentarts-bundle/.agentarts_config.yaml.example')
print(c.default_agent, c.agents['actiscape'].base.entrypoint)
PY
```

---

## 6. 下一步需要决策的事项

### 6.1 构建机

请选择：

- **A. 华为云 `cn-southwest-2` 鲲鹏 ARM64 Ubuntu 22.04 ECS**（首选，符合官方）；
- **B. 成员三 Mac M 系列**（ARM64 原生，可行）；
- **C. 华为云 CodeArts/SWR 云端构建**（若平台支持）；
- **D. Windows x86 + buildx QEMU**（不推荐，官方明确 X86 镜像调用失败）。

当前 x86 受限服务器不可作为构建机。

### 6.2 官方 CLI 还是手动 Docker

- **官方 CLI**：`agentarts configure --entrypoint app:app` + `agentarts launch`；
- **手动 Docker**：`docker buildx build --platform linux/arm64` + SWR + Runtime；
- Bundle 两者都支持，但需要确认赛题是否指定其一。

### 6.3 场景网关

- 受保护的 HTTPS 隧道（最快）；
- 或把 `apps/service` 部署到云上；
- 或成员三本地网关 + 隧道（只适合联调）。

### 6.4 模型

- 赛题 2 是否强制华为云 MaaS？
- 如果强制，必须用真实 `MODEL_API_KEY` 跑一次 MaaS 调用；
- 如果允许 DeepSeek，当前 `DEEPSEEK_*` 路径也可用。

---

## 7. 建议的下一步计划

### 阶段 0：审核与冻结

- 审核本文件/代码；
- 通过后打 tag：
  ```bash
  git tag agentarts-cloudready-716c696 716c696
  ```
- 不再改业务代码，除非部署发现阻断 Bug。

### 阶段 1：ARM64 构建与 `/ping`

- 在 ARM64 Ubuntu 22.04 上：
  ```bash
  npm run build:agentarts-bundle
  cd dist/agentarts-bundle
  docker buildx build --platform linux/arm64 -t actiscape-agentarts:cloudready --load .
  docker run --rm -p 8080:8080 actiscape-agentarts:cloudready
  curl http://127.0.0.1:8080/ping
  ```

### 阶段 2：安全场景网关

- 启动 `apps/service`；
- 设置 `ACTISCAPE_TOOL_TOKEN`；
- 通过 HTTPS 隧道/云网关暴露；
- 用 token 请求验证 401/200；
- 再给 AgentArts 配置 `ACTISCAPE_SCENE_URL` + token。

### 阶段 3：华为云部署

- `agentarts configure --entrypoint app:app`；
- 或手动 SWR + Runtime；
- 配置 `MODEL_API_KEY/MODEL_URL/MODEL_NAME`；
- `/ping`；
- `probe`；
- `run_task`。

### 阶段 4：验收证据

- 镜像 digest / 架构；
- Runtime ID / 部署 ID；
- `/ping` 日志；
- `/invocations` 返回；
- 场景项目 revision；
- 重复请求幂等；
- 重启容器无本地状态依赖；
- 回滚镜像。

### 阶段 5：P2.1

- 真实 V100 `asset.glb` 入缓存；
- 跑 real-cache/remote/校准/照片落位。

---

## 8. 审核 Agent 请输出

1. 对本轮 4 项改造的通过/不通过结论；
2. 选定的构建机（A/B/C/D）；
3. 选定的部署路径（官方 CLI / 手动 Docker）；
4. 场景网关与鉴权方案；
5. MaaS 是否强制及真实模型验证计划；
6. 下一步具体任务单、负责人和验收证据；
7. 需要主系统继续修改的代码清单（如有）。

---

## 9. 证据索引

- [AgentArts 部署决策](AGENTARTS_DEPLOYMENT_DECISION_20261110.md)
- [当前完成情况](CURRENT_COMPLETION_REVIEW_20261110.md)
- [P4 验收](P4_ACCEPTANCE_20261110.md)
- [1110 计划总表](TOTAL_PLAN_COMPLETION_20261110.md)
- [P4 总览](evidence/p4-agentarts-20261110/contact-sheet.png)
- [无 Node 运行时动作](evidence/p4-agentarts-20261110/no-node-runtime-run.json)
- [无 Node 运行时照片](evidence/p4-agentarts-20261110/no-node-photo-run.json)
- [PATH/ping](evidence/p4-agentarts-20261110/no-node-runtime-ping.txt)
- [云端转发](evidence/p4-agentarts-20261110/cloud-proxy-run.json)
- [候选 envelope](evidence/p4-agentarts-20261110/candidate-envelope.json)
- [AgentArts 入口](../deploy/agentarts-minimal/app.py)
- [Bundle 脚本](../scripts/prepare-agentarts-bundle.mjs)
- [部署说明](../deploy/agentarts-minimal/README.md)

---

## 10. 结论

**代码侧已 ready，环境侧未验证。**

- 4 项前置改造完成；
- Bundle 自包含；
- 测试全绿；
- 但真实 ARM64 镜像、华为云 Runtime、MaaS 真实调用、V100 资产仍待执行。

建议审核 Agent 优先批准 **ARM64 ECS + 自包含 Bundle** 的下一步计划，并明确场景网关与 MaaS 两个外部条件。
