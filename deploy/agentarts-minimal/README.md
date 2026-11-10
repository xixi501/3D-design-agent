# 成员三：AgentArts 运行时联通与完整 Workflow

这是 AgentArts 平台验收入口。当前入口同时支持：

- `action="probe"`：原平台冒烟/工具联通逻辑；
- `action="run_task"`：在容器内运行完整 `apps/agent` 多智能体 `Workflow`；
- `agent:app` 与 `app:app` 双入口，兼容手动 Docker 与官方 `agentarts configure`；
- `AGENT_RUN_PORT` / `RUNTIME_PORT` 双端口环境变量。

完整、自包含、带 33 个 Skills 的部署包由根目录生成：

```bash
npm run build:agentarts-bundle
# 产物：dist/agentarts-bundle/
```

Bundle 内含 `DEPLOY_RUNBOOK.md`、`app.py`、`agent.py`、`task_runtime.py`、`actiscape_agent/`、`requirements.txt`、`Dockerfile` 与 `.agentarts_config.yaml.example`，可直接拷到 **ARM64 Ubuntu 22.04** 机器执行官方 CLI 或手动 Docker。

## 本机复核

```bash
RUNTIME_PORT=3080 .venv/bin/python deploy/agentarts-minimal/app.py
node scripts/platform-probe.mjs
```

默认访问 `http://127.0.0.1:3080/invocations`。probe 使用真实模型和场景工具；`run_task` 动作任务不依赖模型 Key。

## 云端步骤

1. 在 **ARM64** Ubuntu 22.04（华为云 `cn-southwest-2` 鲲鹏 ECS 或 Mac M）构建；X86 镜像会在 AgentArts 调用失败。
2. 使用 `dist/agentarts-bundle/DEPLOY_RUNBOOK.md` 的官方 CLI 或手动 Docker 路径。
3. 配置 `MODEL_API_KEY` / `MODEL_URL` / `MODEL_NAME`（MaaS）或 `DEEPSEEK_*`。
4. 配置 `ACTISCAPE_SCENE_URL` 与 `ACTISCAPE_TOOL_TOKEN`；网关启用 Bearer 鉴权。
5. 云端验证 `/ping`、`probe`、`run_task`，并记录镜像 digest、Runtime ID、项目 revision。

## 当前状态

- 本地无 Node 宿主运行时：`/ping` 健康、`run_task` 动作任务 completed；
- 工作台 → 本地运行时 → 场景服务 cloud proxy：completed；
- **真实 ARM64 镜像与华为云部署仍未完成**；
- 当前环境没有 Docker/CAP_SYS_ADMIN，不能在本服务器构建 ARM64 镜像。

## 与 S5 的关系

完整对话任务已接入主编排入口；正式云端验收仍需 ARM64 镜像、可达 HTTPS 场景网关、模型 Key 与平台账号。当前云端状态维持“待实际部署验收”。

<!-- 以下为历史最小 probe 说明，保留供对照 -->

## 已提供内容

- `agent.py`：通过 `agentarts.sdk.AgentArtsRuntimeApp` 暴露 `/invocations` 和 `/ping`。
- 根仓库的 Python 依赖锁文件：包含已验证的 SDK、LangGraph、LangChain 和 DeepSeek 适配器。
- Dockerfile：仅复制 Agent 包和平台入口，凭证与数据目录不会进入镜像。
- `scripts/platform-probe.mjs`：创建独立测试项目、调用本机 SDK、核对移动/撤销与重复请求。

## 本机复核

先按主运行说明启动项目服务，并配置服务端 DeepSeek 密钥：

```bash
RUNTIME_PORT=3080 .venv/bin/python deploy/agentarts-minimal/agent.py
node scripts/platform-probe.mjs
```

默认访问 `http://127.0.0.1:3080/invocations`。脚本使用真实模型和真实场景工具，结束后测试场景恢复原状，再次调用相同请求不重复修改。本机结果记录 executionLocation=local-sdk、cloudDeploymentVerified=false。

## 云端步骤

1. 固定业务提交和依赖锁文件，按 AgentArts SDK 的 LangGraph 模板配置运行时；使用本入口替换模板业务函数。
2. 按平台要求构建 ARM64 镜像。Dockerfile 是构建模板，本轮没有把本机 X86 验证当作 ARM64 构建通过。实际构建后记录镜像 digest、Python 和 SDK 版本。
3. 配置 DEEPSEEK_API_KEY、DEEPSEEK_MODEL=deepseek-flash、ACTISCAPE_SCENE_URL，以及网关使用的 ACTISCAPE_TOOL_TOKEN。ACTISCAPE_CODE_VERSION 填实际业务提交。
4. ACTISCAPE_SCENE_URL 必须是运行时可达的受控 HTTPS 工具入口。令牌验证由网关/反向代理执行；当前本机 Node 默认监听 127.0.0.1，未建设公网用户鉴权。
5. 在业务服务所在环境执行 `node scripts/platform-probe.mjs --prepare-only`，取得测试输入 `test-results/platform-probe/input.json`。再通过 SDK 的平台鉴权调用方式传入该 JSON。
6. 验证日志中存在实际模型工具调用与场景 GET/commands/GET/undo，确认目标恢复、版本前进且重复请求不产生新修改。

接口输入为 requestId、projectId、objectId、baseRevision、originalX、targetX。入口只允许名称以“AgentArts 联通验证”开头的独立测试项目，移动幅度最多 1000 mm。原子操作记录保存在外部项目服务；沙箱内不保存正式场景或任务检查点。

正式云端验收需提交：运行时入口、业务提交、镜像 digest、依赖版本、可达工具地址、实际调用日志、结果回读与撤销证明，以及回退方法。凭证不随记录提交。

## 与 S5 的关系

本包完成平台最小通道的验证准备。完整对话任务部署还需接入主编排入口、外部持久检查点、任务恢复和工作台联通，归入后续平台集成。当前云端状态维持“待成员三实际部署验收”。
