# 成员三：AgentArts 最小真实工具联通

这是独立平台验收入口。完整四 Agent 业务在 `apps/agent`；本包用 AgentArts SDK 0.1.10 包装一个小型 LangGraph，验证模型真实读工具、移动测试对象、回读和撤销。本机 SDK 验证通过不代表已在 AgentArts 云端部署。

当前交接业务版本 `e002051` 已含 S2-C 图片、草稿、确认与整层初始化工程；两张真实图片及完整 S2 仍待验收，见 [S2-C 状态](../../docs/S2C_STATUS.md)。本最小应用继续只验工具联通，不默认部署完整图片编排。后续完整编排需要外部持久检查点，以及可访问的原图、处理图和证据文件服务，不能只复制 SQLite 而遗漏文件。

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
