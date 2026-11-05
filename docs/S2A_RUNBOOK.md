# S2-A 启动、工具与恢复

当前工作目录 `/workspace/3D-design-agent`，分支 `dev/core`。Node.js 24 与 Python 3.13 使用独立环境；既有 SceneSmith 环境不作为安装位置。

## 安装和启动

```bash
cd /workspace/3D-design-agent
export PATH=/workspace/.actiscape-tools/node-v24.22.2-linux-x64/bin:$PATH
npm ci
npm run setup:agent
```

`setup:agent` 创建 `.venv` 并从 `apps/agent/requirements.lock` 安装固定版本。换机器时，在项目根目录 `.env` 配置 `DEEPSEEK_API_KEY`，仅由服务端读取，不提交 Git。

```dotenv
DEEPSEEK_API_KEY=YOUR_SERVER_SIDE_KEY
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_REASONING_EFFORT=high
```

```bash
npm run build
npm run start:all
```

打开 `http://127.0.0.1:3001/`，选择右侧“对话”。开发使用 `npm run dev`，工作台端口 5173。统一启动器会管理项目服务 3001 和 Agent 服务 3002，Ctrl+C 同时停止。需要单独运行时使用 `npm start`、`npm run start:agent`；仅编辑器开发使用 `npm run dev:editor`。

```bash
curl --fail http://127.0.0.1:3001/api/health
curl --fail http://127.0.0.1:3001/api/agent/health
```

Agent 健康信息只返回密钥是否已配置、模型名和版本信息。缺少密钥不影响手工编辑，但不能通过真实模型验收。

可配置 `ACTISCAPE_DATA_DIR`（完整持久数据目录）、`ACTISCAPE_AGENT_DATA_DIR`（默认是前者下的 `agent/`）、`ACTISCAPE_AGENT_URL`（Node 访问 Agent，默认本机 3002）、`ACTISCAPE_SCENE_URL`（Agent 访问项目服务，默认本机 3001）、`CHROME_PATH`（只读渲染使用的已安装浏览器）。模型请求默认超时 120 秒；模型、工具和失败重试统一受任务预算约束。

## 可直接执行的验证

```bash
npm test
npm run test:agent
npm run test:candidates
npm run test:agent:smoke
npm run tools:agent-demo
npm run test:agent:browser
npm run test:agent:live
```

`test:agent:smoke`、`tools:agent-demo`、`test:agent:browser`、`test:agent:live` 会真实调用 DeepSeek 并消耗模型额度。演示和验收脚本创建独立测试项目，不应改为日常用户项目。完整原版回归仍用 `npm run test:all`；需要配置独立 Pillow 和 Chrome，见原运行说明。

`tools:agent-demo` 输出实际项目链接。随后 `test:agent:browser` 在该项目验证对话、鼠标选择、SSE、撤销/重做与会话重开。`test:agent:live` 完成六类案例各两次，其结果属于开发验收，不用于 GEPA 最终测试。

## 持久状态与故障恢复

| 位置                       | 内容                                           |
| -------------------------- | ---------------------------------------------- |
| `projects.sqlite`          | 正式场景、项目历史、固定候选、检查和提交记录   |
| `assets/`                  | 持久 GLB                                       |
| `evidence/`                | 与候选哈希绑定的 PNG                           |
| `agent/tasks.sqlite`       | 会话、焦点对象、任务、请求身份、事件和模型预算 |
| `agent/checkpoints.sqlite` | LangGraph 父流程检查点                         |

Node 自动为旧数据库增加候选表，格式版本仍为 1，不清空旧项目与历史。当前场景数据库迁移版本为 1，拒绝使用本程序打开更高迁移版本。

Agent 服务启动时恢复 queued/running/committing 任务。已完成角色节点从检查点继续；角色节点内部中断时可以重跑该节点的只读工具或候选预检。正式提交始终使用固定候选、固定操作身份，因此响应丢失或重启不会重复新增。

提交结果不明时任务保持“确认提交中”，查询或重试同一原子操作，确认最终结果后才结束；不能另发一份修改当作恢复。取消在安全边界生效，已经开始的原子提交会先确认结果。已提交事务通过撤销按钮恢复。

同一项目一次运行一个任务。waiting_input 任务需要补充说明或取消，才释放该项目的任务位置。任务最多 24 次模型请求、10 分钟活动时间；澄清等待暂停计时，中断恢复仍遵守剩余预算。预算耗尽的任务保留记录，后续调整使用新任务。

版本冲突最多重新读取并生成一次候选；再次冲突暂停。界面显示提交版本，历史中的“已保存”表示该次事务曾成功提交，之后的撤销和手工修改仍以当前项目版本为准。

## 完整备份和回退

先停止 Node 与 Agent，确认两个进程退出，再复制**整个持久数据目录**，包含可能保留的 WAL/SHM 文件。只复制项目数据库不能恢复会话、检查点和图片证据。

```bash
cp -a data /absolute/backups/actiscape-s2a
ACTISCAPE_DATA_DIR=/absolute/backups/actiscape-s2a npm run start:all
```

恢复后检查项目版本、历史位置、GLB、候选 PNG、会话与任务，再执行撤销/重做。回退使用备份对应的代码、依赖锁文件和数据目录。项目 JSON 导出继续只包含当前项目快照和资产清单，不携带任务数据库或模型字节。

`node --import tsx scripts/backup-acceptance.mjs` 可在源服务停服后验证完整副本。脚本拒绝在 Node 项目服务运行或存在待执行任务时进行测试复制；还须按上述步骤确认 Agent 进程已经停止，避免在测试副本重复运行实际用户任务。

AgentArts 沙箱本地文件不作为正式检查点存储。完整编排上云前接外部持久存储；本轮平台封装仅验最小真实工具联通。
