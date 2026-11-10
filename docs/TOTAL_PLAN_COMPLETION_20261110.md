# 1110 计划完成情况总表（P4 收官版）

> 用途：给验收 Agent 一份可直接核对的“计划 vs. 实际完成”状态报告。
> 执行口径：用户只验收最终展示成果；代码、契约、测试与设计由执行 Agent 自验收。
> 本文件已按 **P4 完成 + G7/G4/G8/G10 收口** 更新。

## 0. 仓库状态

- 路径：`/workspace/3D-design-agent`
- 分支：`dev/core`
- 本交付以 `git log -1` 为准；工作区应在提交后保持干净。
- 当前测试基线：**Node 79、Python 169、`npm run test:all` exit 0**。
- 真实 V100 缓存仍为 0 案例（P2.1 外部依赖）；`apps/asset-service` 仍未合入。
- 真实华为云 AgentArts 未部署；P4 在本地模拟 `/invocations` 验收，`cloudDeploymentVerified=false`。

### 0.1 阶段编号映射

| 文档 `1110计划.md` | 用户口径 | 内容 |
| --- | --- | --- |
| 阶段 P0 | **用户 P1** | 3D 可交互动作、开启净空、台面吸附 |
| 阶段 P1 | **用户 P0** | 全屋多房间（自然语言 8 类房间 + 户型图 V4 全屋） |
| 阶段 P2 | 用户 P2 | 成员二照片转 3D 入场（网关 + 三级资产提供器） |
| 阶段 P3 | 用户 P3 | SkillDispatcher 双维切片 + PolicyController 动态路由 |
| 阶段 P4 | 用户 P4 | 华为云 AgentArts 无状态容器化 |

执行顺序：用户 P0 = 文档 P1 → 用户 P1 = 文档 P0 → 用户 P2 → 用户 P3 → 用户 P4。

## 1. 总览矩阵

| 文档阶段 | 用户编号 | 状态 | 主要依据 | 未闭合项 |
| --- | --- | --- | --- | --- |
| P0 | P1 | **完成（G3 可选未做）** | `docs/P1_ACCEPTANCE_20261110.md`；动作/净空/台面真实演示 | 柜体前方地面“半透明开启包络线框”仍未单独绘制（G3 可选加分项） |
| P1 | P0 | **主体完成，1 项兜底未实现** | `docs/P0_ACCEPTANCE_20261110.md`；7 类房间 + 2BHK | `roles.py` 确定性排布兜底未实现（G2）；2BHK 展示用冻结 fixture |
| P2 | P2 | **成员一完成；P2.1 外部依赖** | `docs/P2_ACCEPTANCE_20261110.md` | `apps/asset-service` 未合入；真实 V100 缓存 0；P2 第二验收命令不可执行 |
| P3 | P3 | **完成，G4/G7/G8 已收口** | `docs/P3_ACCEPTANCE_20261110.md` | FastExec 不含单件平移/改色；动作/照片冲突默认等待；Repair 仍是有界指令 |
| P4 | P4 | **完成（本地模拟，非真实云部署）** | `docs/P4_ACCEPTANCE_20261110.md`；候选 envelope + runtime 全流程 | 真实华为云凭证/网络未验证；云端转发同步、无 SSE/resume |

## 2. 本轮 P4 实现

### 2.1 P4.1 去 Node 依赖

- 新增 `POST /api/tools/floorplan-candidate`：
  - `imageId` / `imageBase64` / `imagePath`（限制目录）；
  - Node 网关侧执行 pinned HPD 像素候选；
  - 返回严格 `ArtifactEnvelopeV1`，只读不写项目。
- `floorplan_vision/runner.py`：
  - `ACTISCAPE_VISION_RUNNER=remote` / `local` / 自动；
  - 容器无 `node` 时自动远端 `SceneClient` HTTP；
  - 校验 provider/input/scope/artifact hash；
  - 远端失败如实返回 `failed`。
- 测试：`test_floorplan_vision_provider.py` remote 用例、`tests/floorplan-candidate.test.ts`。

### 2.2 P4.2 AgentArts 完整 Workflow

- 新增 `deploy/agentarts-minimal/task_runtime.py`：
  - 临时 SQLite + `TaskManager`；
  - `action="run_task"` 执行完整 Workflow；
  - 返回 status/taskId/result/error/generation；
  - 超时/失败不冒充成功。
- `agent.py` 双模式：
  - `action="probe"` 或 `originalX/targetX` → 原 `platform_probe`；
  - 标准业务载荷 → `run_task`。
- `apps/service`：
  - `GET /api/agentarts/status`；
  - `POST /api/agentarts/run`；
  - 配置 `AGENTARTS_INVOCATIONS_URL` 时，带 `projectId` 的任务创建转换为同步 cloud task；
  - 本地模式自动剥离 `projectId`，保持原 TaskInput 严格契约。
- 测试：`test_agentarts_runtime.py`、`tests/agentarts-proxy.test.ts`。

**边界**：云端转发是同步的；真实生产建议用 AgentArts 异步任务/轮询。`node scripts/platform-probe.mjs --prepare-only` 通过，但完整 probe 需要真实 SDK 运行时/模型。

## 3. 本轮收口的 4 项技术债

### 3.1 G7：Skill 池 replay 100% 变绿（已关闭）

- 按架构裁定保留 450mm 阈值，不放宽 `OPENABLE_FRONT_BLOCKED`；
- 修改 `living-dining-small/LD-dev-01/ops.json`：
  - `o_sofa` → `[1800,3100]`
  - `o_table` → `[1800,4325]`
  - `o_rug` → `[1800,4200]`
  - 电视柜前净空 475mm ≥ 450mm；
- 同时修复被新检查暴露的旧示例：
  - `LDO-dev-01` 电视柜前移 200mm；
  - `GBR-dev-02` 衣柜南移，避免 `WIN-01`；
  - `HOF-dev-01` 书桌抽屉对办公椅做“可移动座椅”豁免；
  - `HOF-dev-02` replay 支持 `on` 宿主，`ASSET-02` 映射到台面错误码；
- `scripts/skill-pool-v1-replay.mjs` active 列表从 7 扩到 **13** 个有示例的 active Skill；
- 结果：`npm run test:skill-pool:v1` **exit 0**，13 Skills / 26 cases，modelCalls=0。

### 3.2 G4：active Skill 切片无 fallback（已关闭）

- `SkillManifest` 新增可选 `stageHints`，`slice_for_stage` 优先按显式阶段提示切步骤/章节；
- 为 `rectangular-living-reading`、`style-coherence`、`lighting-color`、`photo-object-import` 等补齐阶段提示；
- 修复 `**第 N 步 …** [J-…]` 带尾注时无法解析步骤的问题；
- 新增 `test_active_stage_slices_have_no_fallback`：active primary/modifier 在 asset/layout/check/repair 均 `fallback=false`；
- 结果：`pytest` 169 passed。

### 3.3 G8：命令脚本口径（已关闭）

- `packages/scene-core/package.json` 新增：
  ```json
  "test": "cd ../.. && tsx --test tests/core.test.ts tests/actions.test.ts tests/candidate-contracts.test.ts tests/floorplan-v4.test.ts"
  ```
- `npm test -w @actiscape/scene-core` → **23 passed**；
- 文档 P0 验收命令不再不可执行。

### 3.4 G10：工作区与提交（本轮完成）

- 更新本报告与 `docs/P4_ACCEPTANCE_20261110.md`；
- 在 `dev/core` 上创建规范提交，工作区回到干净 HEAD；
- 提交前必须全绿：`npm test`、`pytest`、`npm run build`、`npm run test:all`、`npm run test:skill-pool:v1`、`node scripts/platform-probe.mjs --prepare-only`。

## 4. 验证命令与结果

| 命令 | 当前结果 |
| --- | --- |
| `npm test` | **79 passed / 0 failed** |
| `PYTHONPATH=apps/agent .venv/bin/python -m pytest apps/agent/tests -q` | **169 passed** |
| `npm run build` | 通过（typecheck + vite） |
| `npm run test:all` | **exit 0**（baseline/browser/parity/catalog/visual） |
| `npm run test:skill-pool:v1` | **exit 0**（13 Skills / 26 cases） |
| `npm test -w @actiscape/scene-core` | **23 passed** |
| `node scripts/platform-probe.mjs --prepare-only` | 通过 |
| `git diff --check` | 通过 |

## 5. 真实展示证据

- **用户 P0 / 文档 P1 全屋**：[总览](evidence/p0-whole-home-20261110/contact-sheet.png) · [2BHK 画布](evidence/p0-whole-home-20261110/whole-home-2bhk-canvas.png)
- **用户 P1 / 文档 P0 动作**：[总览](evidence/p1-actions-20261110/contact-sheet.png) · [冲突检查](evidence/p1-actions-20261110/32-conflict-checks.png) · [一键全开](evidence/p1-actions-20261110/44-overview-open.png)
- **用户 P2 / 文档 P2 照片**：[总览](evidence/p2-photo-assets-20261110/contact-sheet.png) · [校准](evidence/p2-photo-assets-20261110/70-dialog.png) · [台面落位](evidence/p2-photo-assets-20261110/71-placed.png)
- **用户 P3 / 文档 P3 动作+照片**：[总览](evidence/p3-policy-actions-20261110/contact-sheet.png) · [动作](evidence/p3-policy-actions-20261110/action-oblique.png) · [照片](evidence/p3-policy-actions-20261110/photo-oblique.png) · [冲突](evidence/p3-policy-actions-20261110/p3-blocked-chat.png)
- **用户 P4 / 文档 P4 AgentArts**：[总览](evidence/p4-agentarts-20261110/contact-sheet.png) · [候选 envelope](evidence/p4-agentarts-20261110/candidate-envelope.json) · [runtime 全流程](evidence/p4-agentarts-20261110/runtime-run.json)

阶段报告：

- [P0 全屋](P0_ACCEPTANCE_20261110.md)
- [P1 动作](P1_ACCEPTANCE_20261110.md)
- [P2 照片](P2_ACCEPTANCE_20261110.md)
- [P3 Skill/Policy](P3_ACCEPTANCE_20261110.md)
- [P4 AgentArts](P4_ACCEPTANCE_20261110.md)

## 6. 仍然开放的事项

### 6.1 P2.1 真实 V100 / `apps/asset-service`（外部依赖）

- 缓存 0 案例；目录契约/加载逻辑已就绪；
- 成员二交付后放入 `data/real-generated-assets/<sha>/` 即可自动切换，无需改 P3/P4 路由；
- 这不是接口缺失，是用户明确要求“先做接口、不等队友”。

### 6.2 G2：`roles.py` 确定性排布兜底

- 7 类房间仍依赖 DeepSeek 实时生成；
- 模型失败/超时没有代码级保底；
- 建议在 `roles.py`/`generation_roles.py` 补主卧、次卧、书房、厨卫、玄关的确定性布局器。

### 6.3 G3：地面开启包络线框（可选）

- 当前有柜门 3D 开启姿态 + 检查面板 mm 数；
- 没有独立的地面半透明/虚线包络层；
- 不影响确定性检查与动作验收。

### 6.4 P3 两个非阻塞边界

- `interactive_action` 只做开门/开柜/开关灯；单件平移/改色仍走 `edit`；
- 动作/照片候选冲突默认 `waiting_input`，不自动进入 RepairPolicyRouter 重排；Repair 是角色有界指令，不是全自动几何修复。

### 6.5 真实华为云部署

- `cloudDeploymentVerified=false`；
- 本环境只验证 SDK 运行时、本地模拟 `/invocations`、网关转发与 probe 兼容；
- 真实部署需华为云账号、`AGENTARTS_INVOCATIONS_URL`、Bearer token、网络/超时策略。

## 7. 给验收 Agent 的检查清单

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

预期：

- Node 79；Python 169；build 通过；`test:all` exit 0；replay exit 0；scene-core 23；probe prepare 通过；
- `git status --short` 为空（本交付提交后）。

关键抽查：

1. `apps/service/src/floorplan-candidate.ts`：输入三选一、路径限制、envelope hash；
2. `floorplan_vision/runner.py`：remote 检测与 hash 校验；
3. `deploy/agentarts-minimal/agent.py` + `task_runtime.py`：probe/run_task 双模式；
4. `apps/service/src/agentarts-proxy.ts` + `agent-proxy.ts`：云端转发与本地 projectId 剥离；
5. `scripts/skill-pool-v1-replay.mjs`：13 active Skills / 26 cases；
6. `packages/scene-core/src/candidate.ts`：surface create 支持 `parentObjectId/placement`。

## 8. 结论

- **文档 P0/P3/P4 已落地并可展示**；文档 P1/P2 的主体已完成，但分别留下 G2 与 P2.1 外部依赖。
- **G7/G4/G8/G10 已在本轮关闭**：replay 全绿、切片无 fallback、scene-core 命令可执行、工作区即将提交。
- **不能声称真实华为云已部署或真实 V100 已接入**；报告已明确标注 `cloudDeploymentVerified=false` 与缓存 0。
- 下一步若继续：优先真实 AgentArts 部署验证与 P2.1 真实资产；G2/G3 作为稳定性/展示增强。
