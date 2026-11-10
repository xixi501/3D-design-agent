# AgentArts 部署路径决策交接（2026-11-10）

> 给决策 Agent 的第一句话：  
> **当前代码已经完成本地运行时验证，但还没有真实的 ARM64 AgentArts 镜像，也没有部署到华为云。**  
> 请先按 **华为 ICT 大赛创新赛赛题 2** 的官方要求，在 AgentArts 平台/官方文档核实本文件第 3 节的问题，再决定部署路径；不要仅根据本文件或成员三的电脑条件直接拍板。

---

## 1. 当前仓库状态

- 路径：`/workspace/3D-design-agent`
- 分支：`dev/core`
- 代码交付：`b8dfcaf`
- 本文档另建 docs commit；当前 HEAD 以 `git log -1` 为准
- 工作区：提交后干净（`git status --short` 为空）
- 关键历史：
  - `a1d2857`：P0–P4 主体交付
  - `9e31dbe`：当前完成情况交接
  - `2f8c70e`：G2/G3/G5/G6 + 本地代理修复
  - `b8dfcaf`：无 Node 运行时与 cloud proxy 证据

## 2. 当前真实完成度

### 2.1 已验证通过

| 项目 | 结果 |
| --- | --- |
| Node 测试 | **80 passed** |
| Python 测试 | **183 passed** |
| `npm run test:all` | **exit 0** |
| `npm run test:skill-pool:v1` | **exit 0**（13 Skills / 26 cases） |
| `npm test -w @actiscape/scene-core` | **23 passed** |
| `npm run build` | 通过 |
| `platform-probe --prepare-only` | 通过 |
| 无 Node 宿主运行时 | `/ping` 健康；`run_task` 动作任务 completed，revision 2→3 |
| 工作台 → 运行时 → 场景服务 | cloud task completed，revision 4→5 |
| 场景网关候选 envelope | 已通过 fixture 实测 |

### 2.2 已验证但仍属“本地等效”，不是真实云

- 本环境**没有 Docker/Podman**；
- 本环境是 x86_64 Ubuntu 22.04 的受限容器：
  - root 但 `CapEff` 缺少 `CAP_SYS_ADMIN` / `CAP_NET_ADMIN`；
  - `unshare -Ur` 返回 `Operation not permitted`；
  - 无法运行 Docker daemon/runc。
- 因此：
  - 没有构建真实 `python:3.13-slim` 镜像；
  - 没有 ARM64 镜像 digest；
  - 没有部署到华为云 AgentArts；
  - `cloudDeploymentVerified=false`。

### 2.3 当前不能声称

1. 不能声称“真实华为云 AgentArts 已部署”；
2. 不能声称“真实 V100 照片转 3D 已闭环”（P2.1 外部依赖，缓存 0）；
3. 不能声称“ARM64 镜像已验证”；
4. 不能声称“完整 `platform-probe` 已通过”（只跑了 `--prepare-only`）；
5. 不能声称 `apps/service` 已具备生产鉴权/公网安全。

---

## 3. 决策 Agent 必须先核实的事项（赛题 2 / AgentArts）

请优先查阅 **华为 ICT 大赛创新赛赛题 2** 官方页面、AgentArts 官方文档和平台控制台，确认以下事项。不同年份/赛区要求可能不同，以下只是需要核实的问题，不是结论。

### 3.1 赛题与平台硬性要求

- [ ] 赛题 2 是否强制要求使用 **AgentArts Runtime** 部署？是否要求提交部署证明/运行日志？
- [ ] 是否要求使用 **华为云 MaaS 模型**？还是允许 DeepSeek 等外部模型 API？
- [ ] 是否要求 `agentarts configure` + `agentarts launch` 的官方链路，还是允许手动 Docker build/push + SWR + 控制台创建 Runtime？
- [ ] 是否强制镜像使用 **ARM64**？官方入门文档明确写到 X86 镜像调用会失败，但请以赛题 2 当前版本为准。
- [ ] 指定 Region 是否仍为 `cn-southwest-2`（贵阳一）？SWR 组织/仓库是否必须由平台自动创建？
- [ ] 是否有镜像大小、启动时间、并发、超时、冷启动、日志保留等限制？
- [ ] 是否允许 Runtime 访问外部 HTTPS 服务（我们的 `ACTISCAPE_SCENE_URL`）？是否需要备案/白名单/VPCEP？
- [ ] 是否要求所有数据/模型/工具都在华为云内，禁止外部场景服务？如果是，当前“外部 Node 场景网关”方案需要重新设计。
- [ ] 是否要求提供 `.agentarts_config.yaml`、镜像 digest、Runtime ID、`agentarts invoke` 输出等固定材料？

### 3.2 模型与密钥

- [ ] 赛题是否要求 MaaS 的 `MODEL_API_KEY` / `MODEL_URL`（例如 `https://api.modelarts-maas.com/openai/v1`）？
- [ ] 当前 Agent 使用 `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `deepseek-flash`；如果赛题要求 MaaS，需要增加模型适配层或切换配置。
- [ ] 平台是否允许把模型 Key 作为 Runtime 环境变量注入？是否要求 KMS/委托？
- [ ] 模型调用是否必须走平台网关/审计？当前 `apps/agent` 是直接 HTTP 调模型。

### 3.3 构建环境

- [ ] 是否必须使用 **Ubuntu 22.04 ARM64** 构建？
- [ ] 是否接受在 ARM64 Ubuntu 上手动 `docker buildx build --platform linux/arm64`，还是必须 `agentarts launch` 自动构建？
- [ ] Docker 版本是否允许 27+？官方提示 SWR 基础版不支持 OCI 镜像格式，Docker 27 需要 `DOCKER_BUILDKIT=0` 或 `BUILDKIT_USE_OCI_MEDIA_TYPES=0`。
- [ ] 是否允许使用华为云 ECS 鲲鹏 ARM64 作为构建机？是否必须使用指定镜像/系统？
- [ ] 构建机是否必须能访问公网？SWR 推送权限、AK/SK 权限如何配置？

### 3.4 场景网关与网络

- [ ] AgentArts Runtime 是否能访问我们当前的 `apps/service`？
- [ ] 如果当前服务器没有公网入口，是否允许临时 HTTPS 隧道（Cloudflare Tunnel / ngrok / frp）？赛题是否允许？
- [ ] 是否必须把 `apps/service` 也部署到华为云（ECS/CCE/函数工作流）？
- [ ] `apps/service` 当前**没有鉴权中间件**；`ACTISCAPE_TOOL_TOKEN` 只是 Agent 发送，服务端未校验。公网暴露前必须补认证，否则不能上线。
- [ ] 场景数据、候选、证据截图是否需要持久化到华为云 OBS/SFS？当前 `run_task` 使用容器内临时 SQLite，重启会丢任务。

---

## 4. 当前部署资产

### 4.1 已有文件

- `deploy/agentarts-minimal/Dockerfile`
  - `FROM python:3.13-slim`
  - 只复制 `apps/agent` 和 `deploy/agentarts-minimal/{agent.py,task_runtime.py}`
  - 不包含 Node、编辑器、GPU、`.env`、`data/`
- `deploy/agentarts-minimal/agent.py`
  - `AgentArtsRuntimeApp`
  - probe / `run_task` 双模式
  - 入口对象名为 `app`，可用 `agent:app`
- `deploy/agentarts-minimal/task_runtime.py`
  - 临时 SQLite + `TaskManager` + 完整 Workflow
  - 同步执行，超时返回 timeout
- `apps/agent/requirements.lock`
  - AgentArts SDK 0.1.10、LangChain/LangGraph、FastAPI 等
- `apps/service`
  - Node 场景网关；提供 Candidate、CheckScene、Commit、资产、floorplan-candidate
- `data/real-generated-assets/`
  - 目前只有 README，真实 V100 案例 0

### 4.2 入口与端口

- 入口：`agent:app`
- 当前 `agent.py` 读取 `RUNTIME_PORT`（默认 8080），Dockerfile 设置 `RUNTIME_PORT=8080`。
- 官方示例使用 `AGENT_RUN_PORT`。**建议适配两个环境变量**，避免平台注入 `AGENT_RUN_PORT` 时被忽略。
- 部署前请核实平台端口契约（通常 8080）。

### 4.3 官方 CLI 兼容性

官方入门流程是：

```bash
agentarts configure --entrypoint app:app
agentarts launch
```

当前项目不是官方 CLI 模板：

- 入口是 `agent:app`，不是 `app:app`；
- 依赖文件在 `apps/agent/requirements.lock`，不是 deploy 目录的 `requirements.txt`；
- `Dockerfile` 是自定义的，不是 `agentarts configure` 自动生成；
- `COPY . .` 的官方模板会带哪些文件需要确认。

因此决策 Agent 需要在两条路中选一条：

**路径 A：手动 Docker + SWR（当前代码改动最小）**

```bash
docker buildx build \
  --platform linux/arm64 \
  -f deploy/agentarts-minimal/Dockerfile \
  -t swr.cn-southwest-2.myhuaweicloud.com/<org>/actiscape-agentarts:<tag> \
  --push .
```

然后在 AgentArts 控制台/配置中绑定 SWR 镜像。  
优点：现有 Dockerfile、`task_runtime.py`、依赖锁都可原样使用。  
风险：需确认赛题是否接受手动构建/控制台创建 Runtime。

**路径 B：改造成官方 `agentarts launch` 模板**

需要额外准备：

- deploy 目录的 `requirements.txt`；
- 把 `apps/agent` 纳入 CLI 构建上下文；
- 入口改成 `app:app` 或确认 CLI 支持 `agent:app`；
- 允许 CLI 生成/接管 Dockerfile；
- 验证 `agentarts configure` / `launch` 不会丢掉 `task_runtime.py`。

优点：最贴近官方文档和平台默认链路。  
风险：需要改部署包，可能影响现有 Dockerfile 验证。

**建议**：先走路径 A 完成真实 ARM64 镜像与云端 smoke；如果赛题 2 明确要求 `agentarts launch`，再走路径 B。最终以赛题要求为准。

---

## 5. 可选的构建/部署路径

| 路径 | 构建机 | 优点 | 缺点/风险 |
| --- | --- | --- | --- |
| **A. 华为云 ECS 鲲鹏 ARM64 Ubuntu 22.04** | 华为云 ECS | 与官方推荐一致；ARM64 原生；公网；可重复 | 需要云账号/SWR；有成本；需配置 AK/SK |
| **B. 成员三 Mac M 系列** | Mac ARM64 | 无需 ECS；Docker Desktop 原生 ARM64 | 需要他能推 SWR；网络/权限；机器是否可用 |
| **C. 成员三 Windows x86 + buildx QEMU** | Windows x86 | 无需新云主机 | 官方明确 X86 镜像会失败；ARM64 模拟慢/不稳，不建议作为主路径 |
| **D. 华为云 CodeArts/SWR 云端构建** | 云端 | 不依赖个人电脑 | 平台是否支持、配置成本未知，需核实 |
| **E. 当前服务器** | 本服务器 | 代码已在此 | **不可行**：无 Docker、无 CAP_SYS_ADMIN、x86；不要在此装 Docker 硬跑 |

**推荐决策顺序：A（首选）→ B（有 Mac M 时）→ D（云构建）→ C（仅兜底）。当前服务器不作为构建机。**

---

## 6. 场景网关方案

云端 Runtime 不能访问 `127.0.0.1:3013`。可选：

1. **临时 HTTPS 隧道（最快）**
   - 从当前服务器用 Cloudflare Tunnel / ngrok / frp 暴露 `apps/service`；
   - 必须加 Bearer token/反向代理认证；
   - 仅用于验收，验收后关闭。
2. **云上网关（更接近生产）**
   - 把 `apps/service` 部署到华为云 ECS/CCE；
   - 需要 Node 24 + Python（户型图/资产路径）+ 持久化；
   - 工作量和成本更高。
3. **成员三本地网关 + 隧道**
   - 只适合临时联调，不适合正式云端验收。

**当前 `apps/service` 没有服务端鉴权**，公网暴露前必须补：
- Bearer token 中间件；或
- Cloudflare Access / 反向代理 Basic Auth；
- 不能把 3013 裸奔到公网。

---

## 7. 部署前必须补的工程项

无论选哪条路径，建议先完成：

1. **端口契约**：`agent.py` 同时读取 `AGENT_RUN_PORT` 和 `RUNTIME_PORT`。
2. **模型适配核实**：如果赛题要求 MaaS，增加 `MODEL_API_KEY/MODEL_URL/MODEL_NAME` 适配，而不是只用 DeepSeek。
3. **CLI 或手动路径定稿**：不要让成员三在部署现场临时改 Dockerfile。
4. **ARM64 构建目标**：固定 `linux/arm64`，记录镜像 digest。
5. **SWR OCI 兼容**：Docker 27 时设置 `DOCKER_BUILDKIT=0` 或 `BUILDKIT_USE_OCI_MEDIA_TYPES=0`。
6. **公网网关鉴权**：服务端 token 校验或反向代理认证。
7. **测试 payload**：
   - `probe`（需要模型 Key）；
   - `run_task` 动作任务（无模型 Key 也能测）；
   - 重复请求幂等；
   - 重启/超时。
8. **云上持久状态**：当前 `run_task` 临时 SQLite；如平台重启/多副本，需要外部任务存储或明确“同步任务、不恢复”。
9. **日志/证据**：记录 Runtime ID、镜像 digest、架构、`/ping`、`/invocations`、revision、失败回滚。

---

## 8. 建议的验收流程

1. 构建 ARM64 镜像；
2. 本地 `/ping`；
3. 本地 `run_task` 动作任务（无模型）；
4. 推 SWR；
5. AgentArts 部署；
6. 云端 `/ping`；
7. 云端 `probe`（有模型 Key）；
8. 云端 `run_task`；
9. 重复请求幂等；
10. 容器重启/无本地状态；
11. 记录证据并回传。

**验收判据：**
- 云端 `/invocations` 返回 `completed`；
- 场景项目 revision 正确递增；
- Candidate → CheckScene → Commit 有证据；
- 失败/超时明确返回，不静默回退；
- 镜像架构为 ARM64；
- 不依赖 Node/GPU/本地磁盘。

---

## 9. 请决策 Agent 输出的结果

建议决策 Agent 返回：

1. 赛题 2 的硬性要求核对表（逐项“满足/不满足/不适用”及依据链接）；
2. 选择路径：A/B/C/D；
3. 构建机类型、Region、SWR 组织；
4. 是否使用官方 `agentarts launch`，还是手动 Docker；
5. 场景网关方案与鉴权方案；
6. 需要主系统先改的代码清单；
7. 成员三/云主机的最小任务清单；
8. 验收负责人、证据清单、回滚方式。

---

## 10. 关键证据索引

- [当前完成情况](CURRENT_COMPLETION_REVIEW_20261110.md)
- [P4 验收报告](P4_ACCEPTANCE_20261110.md)
- [1110 计划总表](TOTAL_PLAN_COMPLETION_20261110.md)
- [P4 总览](evidence/p4-agentarts-20261110/contact-sheet.png)
- [无 Node 运行时动作](evidence/p4-agentarts-20261110/no-node-runtime-run.json)
- [无 Node 运行时照片](evidence/p4-agentarts-20261110/no-node-photo-run.json)
- [PATH/ping](evidence/p4-agentarts-20261110/no-node-runtime-ping.txt)
- [云端转发](evidence/p4-agentarts-20261110/cloud-proxy-run.json)
- [候选 envelope](evidence/p4-agentarts-20261110/candidate-envelope.json)
- [Dockerfile](../deploy/agentarts-minimal/Dockerfile)
- [AgentArts 入口](../deploy/agentarts-minimal/agent.py)
- [任务运行时](../deploy/agentarts-minimal/task_runtime.py)

---

## 11. 不要误解的几点

- “本地无 Node 运行时通过” ≠ “真实容器/ARM64 通过”；
- “工作台 → 本地运行时 cloud proxy 通过” ≠ “华为云 AgentArts 已部署”；
- “P4 代码完成” ≠ “赛题 2 部署验收完成”；
- “成员三能 build” ≠ “镜像架构/平台链路一定正确”；
- “当前服务器有代码” ≠ “当前服务器能构建 Docker”。

**最终以华为 ICT 大赛创新赛赛题 2 的官方要求和 AgentArts 平台实际控制台为准。**
