# 当前完成情况验收交接（P4 收官提交 `a1d2857`）

> 给验收 Agent：本文件是截至 2026-11-10 的**当前状态**，不是阶段计划。  
> 仓库：`/workspace/3D-design-agent` · 分支 `dev/core`  
> P4 代码交付提交：`a1d2857`；本验收文档随后的 docs-only commit 一并提交，当前 HEAD 以 `git log -1` 为准。  
> 工作区：提交后**干净**（`git status --short` 为空）。  
> 结论：文档 P0/P3/P4 已完成；P1/P2 主体完成但各留 1 项明确缺口；P4 为**本地模拟验收**，真实华为云未部署。

## 1. 阶段编号映射

| 文档 `1110计划.md` | 用户口径 | 内容 |
| --- | --- | --- |
| P0 | **用户 P1** | 3D 开关门柜动作、开启净空、台面吸附 |
| P1 | **用户 P0** | 全屋多房间（文字 8 类 + 户型图 V4 全屋） |
| P2 | 用户 P2 | 照片转 3D 资产入场 |
| P3 | 用户 P3 | SkillDispatcher + PolicyController |
| P4 | 用户 P4 | 华为云 AgentArts 无状态容器化 |

## 2. 一句话状态

- **已完成**：3D 动作与净空、全屋主力房型、照片资产三级提供器（成员一接口）、Skill 阶段切片、Policy 四路径、动作/照片候选闭环、AgentArts 远程视觉候选 + `run_task` 运行时 + 网关云端转发。
- **已收口**：G7 Skill replay、G4 切片 fallback、G8 命令口径、G10 工作区提交。
- **未完成**：P2.1 真实 V100/`apps/asset-service`（外部依赖）、G2 确定性排布兜底、G3 地面包络线框（可选）、真实华为云部署验证。

## 3. 总览矩阵

| 阶段 | 状态 | 证据 | 未闭合项 |
| --- | --- | --- | --- |
| P0 / 用户 P1 | **完成** | `docs/P1_ACCEPTANCE_20261110.md`；动作/净空/台面演示 | G3 地面半透明包络线框未单独绘制（不影响检查） |
| P1 / 用户 P0 | **主体完成** | `docs/P0_ACCEPTANCE_20261110.md`；7 类房间 + 2BHK | G2 `roles.py` 确定性排布兜底未实现；2BHK 用冻结 fixture |
| P2 / 用户 P2 | **成员一完成** | `docs/P2_ACCEPTANCE_20261110.md`；三级 provider + 编辑器闭环 | P2.1 `apps/asset-service` 未合入、真实 V100 缓存 0；第二验收命令不可执行 |
| P3 / 用户 P3 | **完成** | `docs/P3_ACCEPTANCE_20261110.md`；动作/照片候选真实提交 | FastExec 不含单件平移/改色；动作/照片冲突默认等待；Repair 是有界指令 |
| P4 / 用户 P4 | **完成（本地模拟）** | `docs/P4_ACCEPTANCE_20261110.md`；候选 envelope + runtime 全流程 | 真实华为云未部署；云端转发同步、无 SSE/resume |

## 4. P4 实际落地

### 4.1 远程视觉候选

- `POST /api/tools/floorplan-candidate`：
  - 输入支持 `imageId` / `imageBase64` / 受限目录 `imagePath`；
  - 返回严格 `ArtifactEnvelopeV1`；
  - 只读，不写项目/草稿/历史。
- `floorplan_vision/runner.py`：
  - `ACTISCAPE_VISION_RUNNER=remote|local|auto`；
  - 容器无 `node` 时自动远端；
  - 校验 provider/input/scope/artifact hash。
- 证据：[候选 envelope](evidence/p4-agentarts-20261110/candidate-envelope.json)。

**注意**：网关端点由 Node 服务拥有；实际 HPD 像素适配器沿用仓库既有 Python 实现，由网关主机调用。AgentArts 容器本身只通过 HTTP 访问 `ACTISCAPE_SCENE_URL`，不依赖 Node。

### 4.2 AgentArts 运行时

- `deploy/agentarts-minimal/task_runtime.py`：
  - 临时 SQLite + `TaskManager`；
  - `action="run_task"` 执行真实 Workflow；
  - 返回 `status/taskId/result/error/generation`。
- `agent.py`：
  - probe 载荷保持原逻辑；
  - 标准业务载荷进入 `run_task`。
- `apps/service`：
  - `GET /api/agentarts/status`；
  - `POST /api/agentarts/run`；
  - `AGENTARTS_INVOCATIONS_URL` 配置时，带 `projectId` 的任务创建转换为同步 cloud task；
  - 本地模式自动剥离 `projectId`。
- 证据：[runtime 全流程](evidence/p4-agentarts-20261110/runtime-run.json)、[P4 总览](evidence/p4-agentarts-20261110/contact-sheet.png)。

## 5. 本轮收口的 4 项技术债

| 缺口 | 处理 | 结果 |
| --- | --- | --- |
| G7 Skill replay | 保留 450mm 阈值；修 `LD-dev-01` 沙发/茶几/地毯；同步修 LDO/GBR/HOF 旧示例；active 扩到 13 个 | `npm run test:skill-pool:v1` exit 0，13 Skills / 26 cases |
| G4 切片 fallback | `SkillManifest.stageHints`、步骤尾注解析、style/lighting/rectangular/photo 提示 | active primary/modifier 四阶段无 `fallback=true` |
| G8 命令口径 | `packages/scene-core/package.json` 增加 `test` | `npm test -w @actiscape/scene-core` 23 passed |
| G10 提交 | 147 文件完整提交；验收文档随后 docs-only commit | 代码提交 `a1d2857`，工作区干净 |

## 6. 验证结果

在 P4 代码交付 `a1d2857` 上执行并记录：

| 命令 | 结果 |
| --- | --- |
| `npm test` | **79 passed / 0 failed** |
| `PYTHONPATH=apps/agent .venv/bin/python -m pytest apps/agent/tests -q` | **169 passed** |
| `npm run test:all` | **exit 0**（baseline / browser / parity / catalog / visual） |
| `npm run test:skill-pool:v1` | **exit 0**（13 Skills / 26 cases，modelCalls=0） |
| `npm test -w @actiscape/scene-core` | **23 passed** |
| `node scripts/platform-probe.mjs --prepare-only` | 通过 |
| `npm run build` | 通过 |
| `git diff --check` | 通过 |
| `git status --short` | 空 |

## 7. 仍然开放的事项

1. **P2.1 真实 V100 / `apps/asset-service`**
   - `data/real-generated-assets/` 只有 README，真实案例 0；
   - `apps/asset-service` 目录不存在；
   - 用户明确要求先做接口、不等队友；不是接口设计缺失。
2. **G2 确定性排布兜底**
   - 7 类房间仍依赖 DeepSeek 实时生成；
   - 模型失败/超时无代码级布局保底。
3. **G3 地面开启包络线框（可选）**
   - 当前有 3D 开启姿态 + 检查面板 mm 数；
   - 无独立地面半透明/虚线包络层。
4. **P3 两个非阻塞边界**
   - `interactive_action` 只做开门/开柜/开关灯；单件平移/改色仍走 `edit`；
   - 动作/照片冲突默认 `waiting_input`，不自动进入 Repair 重排。
5. **真实华为云部署**
   - `cloudDeploymentVerified=false`；
   - 只验证 SDK 运行时、本地模拟 `/invocations`、网关转发、probe 兼容；
   - 真实部署需要 AgentArts 凭证/网络/超时策略。

## 8. 验收 Agent 建议检查顺序

```bash
cd /workspace/3D-design-agent
git status --short
git log -1 --oneline

npm test
PYTHONPATH=apps/agent .venv/bin/python -m pytest apps/agent/tests -q
npm run build
npm run test:all
npm run test:skill-pool:v1
npm test -w @actiscape/scene-core
node scripts/platform-probe.mjs --prepare-only
```

重点抽查：

1. `apps/service/src/floorplan-candidate.ts`：三选一输入、路径限制、envelope hash；
2. `apps/agent/actiscape_agent/floorplan_vision/runner.py`：remote 自动检测与 hash 校验；
3. `deploy/agentarts-minimal/agent.py` + `task_runtime.py`：probe/run_task 双模式；
4. `apps/service/src/agentarts-proxy.ts` + `agent-proxy.ts`：云端转发与本地 `projectId` 剥离；
5. `scripts/skill-pool-v1-replay.mjs`：13 active / 26 cases；
6. `packages/scene-core/src/candidate.ts`：surface create 的 `parentObjectId/placement`。

## 9. 证据索引

- 全屋：[P0 全屋总览](evidence/p0-whole-home-20261110/contact-sheet.png)
- 动作：[P1 动作总览](evidence/p1-actions-20261110/contact-sheet.png)
- 照片：[P2 照片总览](evidence/p2-photo-assets-20261110/contact-sheet.png)
- Skill/Policy：[P3 总览](evidence/p3-policy-actions-20261110/contact-sheet.png)
- AgentArts：[P4 总览](evidence/p4-agentarts-20261110/contact-sheet.png)
- 详细阶段报告：
  - [P0_ACCEPTANCE_20261110.md](P0_ACCEPTANCE_20261110.md)
  - [P1_ACCEPTANCE_20261110.md](P1_ACCEPTANCE_20261110.md)
  - [P2_ACCEPTANCE_20261110.md](P2_ACCEPTANCE_20261110.md)
  - [P3_ACCEPTANCE_20261110.md](P3_ACCEPTANCE_20261110.md)
  - [P4_ACCEPTANCE_20261110.md](P4_ACCEPTANCE_20261110.md)
  - [TOTAL_PLAN_COMPLETION_20261110.md](TOTAL_PLAN_COMPLETION_20261110.md)

## 10. 给下一步计划的三条输入

1. **若要继续“真实上云”**：优先补 AgentArts 异步任务/轮询、真实凭证部署、云端 SSE 或前端轮询，而不是只做同步 `/invocations`。
2. **若要继续“真实照片转 3D”**：P2.1 的 V100 产物/`apps/asset-service` 是唯一外部前置；接口已稳定。
3. **若要提高全屋稳定性**：先补 G2 确定性排布兜底；G3 和 P3 的 FastExec/Repair 增强属于展示与体验优化。
