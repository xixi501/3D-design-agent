# 演境 ActiScape 完整交接与独立审核说明

日期：2026-11-12  
交接对象：接手本仓库的独立审核 Agent  
目的：说明项目总体进度、代码设计、当前已确认事实、未完成项和已知问题，供独立审核使用。

> 审核者不应把本文当作结论。本文区分“已验证”“仓库文档记录”“本次未复现”“WIP”。所有具体能力应以代码、测试、运行结果和证据文件为准。

---

## 1. 当前快照

| 项目 | 当前值 |
|---|---|
| 仓库 | `/workspace/3D-design-agent` |
| 当前分支 | `feat/floorplan-auto-completion` |
| 当前 HEAD | `abf6dc0` |
| `dev/core` | `4fa7935`，已合并 PR #6 |
| `main` | `da793c6`，落后于 `dev/core` |
| 未提交文件 | `docs/FLOORPLAN_UPLOAD_METHOD_REVIEW_20261112.md`、`docs/UX_AGENT_ACCEPTANCE_BRIEF_20261111.md`、本文档 |
| Python 测试 | `193 passed`（本次执行） |
| TypeScript build | 本次执行通过；未执行完整 `npm run test:all` |
| Node 测试 | 文档记录 47 项；本次未重新执行 |
| 工作区代码 | 除上述两个未跟踪文档外干净 |

当前分支没有 PR，没有合并到 `dev/core` 或 `main`。

---

## 2. 项目总体目标

演境 / ActiScape 是一个面向普通用户的 AI 3D 室内设计工作台，不是单纯的聊天应用，也不是单纯的户型识别工具。

产品主链路：

```text
打开/新建项目
→ 2D 平面/分屏/3D 查看
→ 直接编辑，或对话让 Agent 修改
→ 确定性检查
→ AI 修复或人工调整
→ 保存、撤销/重做、导出
```

户型图上传只是入口能力之一，目标是把真实户型带入工作台，继续做编辑、家具、检查和导出。

### 当前已定义的产品边界

- 单层户型；
- 正交平面；
- 保留整层墙体、门窗、房间；
- 家具来自目录，不凭空生成原图没有的家具；
- 几何和正式提交由确定性代码负责，Agent 负责理解意图、生成候选和建议；
- 旧 V1/V2/V3 任务按冻结版本恢复；
- 不承诺任意图片、任意户型、全屋任意风格都能全自动。

### 当前没有正式定义的东西

上传功能“做到什么程度算完成”没有统一验收层级。实际出现过的说法包括：

- 有初步结果；
- 能打开草稿面板；
- 能通过预览；
- 可确认草稿；
- 全自动；
- 可写入正式项目。

这些层级没有被产品、测试和文档统一，是当前交接中需要重点审核的问题之一。

---

## 3. 代码总体设计

### 3.1 Monorepo 组成

| 路径 | 职责 |
|---|---|
| `packages/scene-core` | 场景类型、命令、几何、确定性检查、Candidate、户型编译、SceneDraft |
| `apps/service` | Fastify 项目服务、SQLite 存储、历史、资产、SSE、API、户型草稿 façade |
| `apps/editor` | 原生 DOM 工作台、2D 编辑、Three.js 3D、检查面板、Agent 侧栏 |
| `apps/agent` | Python/LangGraph Agent、角色、工具、HPD 适配、Skill、视觉调用、持久任务 |
| `scripts` | 验收、回放、浏览器操作、质量采样、模型 smoke |
| `tests` | TypeScript/Node 核心、服务、户型质量测试 |
| `apps/agent/tests` | Python Agent、候选、结构、测量、角色契约测试 |
| `docs/evidence` | 历史验收、回放和发布证据 |
| `fixtures` | 冻结户型图、参考场景、样例 |

### 3.2 两条主要链路

#### 直接编辑

```text
Editor 命令
→ Fastify /api
→ scene-core 校验/编译
→ SQLite 事务 + 历史
→ SSE 通知其他视图
```

特点：

- 场景状态由 Node 服务持久化；
- 前端不直接写数据库；
- 版本过期提交会被拒绝；
- 撤销/重做跨重开保留；
- 资产是独立 GLB 引用。

#### Agent 修改

```text
工作台对话/选择
→ Agent 任务
→ 角色协作
→ Candidate
→ 确定性预检/真实截图检查
→ 固定提交节点
→ Node 原子事务
```

特点：

- Agent 不获得正式场景写权限；
- 候选绑定快照、哈希、检查结果；
- 提交由固定代码执行；
- 失败时保留原项目；
- 旧任务按冻结快照恢复。

### 3.3 户型识别链路

当前户型相关实现跨 Node、Python 和上游工具，关键概念如下。

#### 上游

- `house-plan-designer`：提供像素墙段、断口、尺寸线、墙面对账等工具；
- 固定提交、来源和许可记录在 `docs/THIRD_PARTY.md` 与 vendor 的 provenance 中。

#### Node / scene-core

负责：

- 草稿数据结构和版本；
- 墙、门窗、房间、锚点、测量特征；
- 户型编译为场景；
- 预览检查；
- 原图审核和确认；
- 与正式项目提交的边界；
- V4 使用 SceneDraft v2 作为持久化权威，旧 `/floorplan-drafts` 是 façade。

#### Python Agent

负责：

- HPD 调用；
- 结构候选组装；
- 结构/家具/测量/资产/检查角色；
- 视觉模型调用；
- 候选证据；
- 有界修复；
- 任务恢复。

#### 当前 V4.2 方向

- `workflowVersion=4`；
- `recognitionVersion=4`；
- `s2c-floorplan-v4-2`；
- `hpd-adapter-6-1`；
- `candidatePolicyVersion=geometry-only`；
- Skill `0.7.0`；
- 全屋模式，结构模型只选择候选，不自由生成几何；
- 测量绑定、原图审核、确认和候选提交分离。

### 3.4 当前 TypeScript 几何层的事实

这一点对独立审核很重要：

- **没有使用 Shapely、Clipper、Clipper2、JSTS、Turf 或 earcut。**
- 墙体几何、房间区域、点在多边形内判断主要由继承的几何代码和手写业务规则完成。
- 房间检测不是通用平面图半边/最小环算法，而是基于墙几何区域和房间标签的矩形分解/合并。
- 门窗是墙上的区间属性，不是独立墙体。
- 没有通用多边形布尔运算、约束三角化或平面图最小环库。

因此：

- 基础编辑/检查可以工作；
- 但复杂墙网、碎墙、悬空端点、房间闭合、洞口归属，缺少一层通用几何清理；
- 这也是当前上传链路卡住的结构性原因之一。

### 3.5 关键设计原则

1. 几何和正式提交由确定性代码负责。
2. Agent 只提案，不直接写正式场景。
3. Candidate 绑定版本、哈希、证据和检查结果。
4. 旧任务使用冻结版本，不随新代码改变。
5. V4 草稿使用 SceneDraft v2 单一权威，避免多套草稿。
6. 审核/确认绑定草稿哈希，编辑后失效。
7. 失败关闭，不静默改项目。

这些原则在代码和测试中有部分落实，但独立审核应验证它们是否在真实流程中成立。

---

## 4. 当前总体进度

### 4.1 已记录为通过的阶段

以下为仓库文档/证据记录，本次交接未逐项重跑：

| 阶段 | 文档状态 | 说明 |
|---|---|---|
| S0/S1 | 通过 | 上游提取、编辑器、持久化、事务、资产、撤销/重做 |
| S2-A | 通过 | 四角色对话局部编辑、候选、截图检查、原子提交 |
| S2-B | 通过 | 矩形文字生成、真实 Skill、澄清、持久恢复 |
| S2-C V3-6 | 通过 | 两张冻结户型图各两轮真实矩阵，0 修复、0 人工对象校正、提交/撤销/重做/局部编辑 |
| Skill Pool v1 | 通过 | 固定快照、manifest、哈希、代码短名单 |
| V4 合同/SceneDraft | 通过 | V4 草稿单一权威、幂等命令、审核/确认哈希绑定 |

V3-6 的两图矩阵是当前文档中最重要的已接受户型结果。它使用旧版本链路，不代表当前 V4.2/feature 分支的真实上传结果。

### 4.2 当前 feature 分支

`feat/floorplan-auto-completion` 上的提交：

```text
450bc9b pass total dimensions and derive outline anchors
981c522 merge collinear wall gaps and relax anchor tolerance
8e15215 auto-merge wall gaps / structure-only drafts
231afec order auto anchor endpoints
abf6dc0 merge outer candidates / prefer declared outline scale
```

内容：

- 总宽/总高传给 HPD；
- 自动锚点；
- 候选墙跨洞口合并；
- 草稿墙段合并、开洞重映射；
- 自动测量特征；
- 空家具结构草稿；
- 预览通过后尝试 wallaudit。

这些改动：

- 有 Python 测试；
- 没有真实图端到端通过；
- 没有 PR；
- 没有合并。

### 4.3 当前工作区未跟踪文档

- `docs/FLOORPLAN_UPLOAD_METHOD_REVIEW_20261112.md`
- `docs/UX_AGENT_ACCEPTANCE_BRIEF_20261111.md`
- `docs/HANDOFF_FULL_AUDIT_20261112.md`（本文档）

前两者分别是现状/问题记录和 UX 验收说明；本文档是本次交接说明。均未提交。

---

## 5. 户型上传：真实测试记录

### 5.1 输入

用户提供的真实户型图：

```text
919 × 1024
9600 × 10800 mm
比例约 0.897，接近 8:9
```

### 5.2 HPD 直接分析

```text
wall segments: 22
gaps: 9
outline: 9600 × 10766
width_scale: 14.393
height_scale: 14.439
差异约 0.3%
```

结论：图本身比例合格；HPD 尺寸比例基本一致。

### 5.3 实际失败

第一次真实上传失败：

```text
固定代码无法把全部已读尺寸绑定到实测墙面
```

原因链：

1. HPD 漏掉完整外墙；
2. 模型只能从候选碎墙段中选择；
3. 草稿不闭合；
4. 锚点找不到完整墙面；
5. 测量特征无法绑定。

### 5.4 分割模型实验

使用 OpenBIM M2-DA UNet+ResNet34：

- 模型在 GPU 上推理成功；
- wall 像素 57643；
- window 像素 15364；
- door 像素 6126；
- 叠加图能覆盖外墙。

但分割结果：

- 没有被矢量化成墙体候选；
- 只作为叠加证据/合成图输入；
- 重新交给 HPD 后，结构模型仍选碎段；
- 端到端仍失败。

### 5.5 VLM 纠错实验

Qwen3-VL-32B 输入：

- 原图；
- 分割叠加图；
- 当前草稿墙线叠加图。

输出：

- 6 条 `add_wall`；
- 坐标沿真实外轮廓；
- 没有贴图片白边。

应用后：

- 尺寸绑定错误消失；
- 预览报“发现未连接墙端”；
- 无法进入 wallaudit。

### 5.6 确定性清理原型

本次在 `/tmp` 中做了原型（未提交产品代码）：

- 共线合并；
- 去包含；
- 端点吸附；
- 30px 内连接；
- 门窗重映射；
- 锚点特征重建。

结果：

```text
27 面墙 → 25 面墙
8 个门窗 → 8 个门窗
```

预览仍有 **10 个悬空墙端**。

剩余缺口 15–70px，包含：

- 真实门洞；
- 窗洞；
- 凹角；
- 外墙/内墙交接。

简单连墙会堵住门窗；不连则不闭合。

因此：

- wallaudit 没有进入；
- 可确认草稿没有生成；
- 上传能力未完成。

---

## 6. 当前问题清单

### A. 上传/几何

1. HPD 像素候选漏外墙、切碎段。
2. 结构模型只能在候选里选，不能补缺失墙。
3. 分割 mask 没有矢量化，只作为证据。
4. VLM 能提补墙建议，但不能保证连接和闭合。
5. 缺少确定性几何清理：端点吸附、共线合并、去碎墙、房间闭合、洞口归属。
6. 门窗和断墙没有稳定分类；缺口 15–70px 可能都是不同语义。
7. 测量特征/锚点与业务墙/草稿墙没有统一表示。
8. 局部尺寸链不能绑定时直接阻断，而不是降级警告。
9. 房间检测不是通用最小环/平面图算法。
10. `wallaudit` 只在人工修复后的受控草稿上得到 0 问题；真实自动流程未到达。

### B. 表示与架构

1. 同时存在像素 mask、HPD 墙段、业务墙、草稿墙、测量特征、锚点、VLM 操作。
2. 没有单一 Node-Edge-Face / 墙中线图。
3. 转换层会丢绑定；错误定位困难。
4. Agent 的 VLM 操作没有成为受限编辑协议，也没有草稿面板入口。
5. 分割/视觉模型没有进入正式 provider 层；实验脚本在 `/tmp`，不可从仓库复现。

### C. 产品与验收

1. 上传的“可识别/可核对/可确认/可自动”没有正式定义。
2. 上传工作占用了较多主产品精力。
3. 普通用户是否能理解拓扑报错，未验证。
4. 人工补墙、CAD/DXF、模板兜底的产品定位未定。
5. 没有真实上传基准集和量化指标（墙/门窗召回、房间闭合率、尺寸误差、人工修正量）。
6. 全屋样板的代表性、样例质量、移动端体验仍是独立风险。

### D. 仓库/CI/依赖

1. `main` 落后于 `dev/core`。
2. feature 分支无 PR、未合并。
3. 本次只跑了 Python 193；完整 `npm run test:all` 未跑。
4. VLM/OpenBIM 依赖外部服务、GPU、模型权重；分割权重在 `/tmp/openbim-models`，未进入仓库/部署流程。
5. OpenBIM 依赖安装在 vllm 环境，不在项目 `.venv`；不可复现。
6. 旧文档中的 Node/Python 数字与当前分支不完全对应，审计时需重新执行。
7. 两个未跟踪文档未提交。

### E. 其他已知产品风险

来自既有审计文档，本次未重新验证：

- 产品画廊中存在/曾存在坏样例或被误认为产品能力的样例；
- 全屋布局质量、结构问题可修复性、检查问题分类仍有风险；
- 检查项可能把无关家具纳入 objectIds，导致 Agent 目标不精确；
- 真实照片转 3D、华为云 AgentArts、生产 VLM 未完成；
- 测试通过不等于普通用户能完成任务；
- 语义设计质量（动线、家具关系、风格一致性）缺少系统评估。

---

## 7. 已尝试但未成立的路线

| 路线 | 结果 |
|---|---|
| 调 HPD 参数 | `gray-max=175` 22 段墙但漏外墙；`220` 26 段墙但纵向比例变差；`255` 130 段墙噪声过大 |
| 原始候选 fallback | 能避免直接失败，但不能补外墙 |
| 候选墙跨洞口合并 | 受控图有效，真实图仍受 HPD 漏墙限制 |
| 自动锚点/测量特征 | 解决部分绑定错误，不能解决墙网不闭合 |
| 放宽锚点容差 | 从 0.3% 到 0.5%，只解决像素舍入，不解决缺墙 |
| 分割图贴回原图 | 分割本身可用，但 HPD 仍重新检测/模型仍选碎段 |
| VLM 补外墙 | 能提出正确外轮廓，但补完仍悬空，不能闭合 |
| 规则端点连接 | 清理后仍有 10 个悬空端，门窗/凹角无法区分 |
| 人工修复受控草稿 | 预览可通过、wallaudit 0，但不属于自动产品链路 |

---

## 8. 独立审核建议关注的问题

以下是给审核 Agent 的问题，不是结论：

1. 当前 `dev/core` 是否真的能支撑 README 中描述的能力？
2. V3-6 两图矩阵的证据是否仍能复现？是否只存在于旧提交/旧环境？
3. 当前 feature 分支的改动是否值得合并？有没有引入回归？
4. 上传链路的真实验收标准应该是什么？现有代码/测试是否支持？
5. 几何层没有通用库、只有手写规则，这对当前和后续能力的影响有多大？
6. V4 SceneDraft 单一权威在真实流程中是否成立？
7. Agent 的 Candidate/Check/Commit 边界是否有绕过路径？
8. 当前文档、UI 文案和实际能力是否有不一致？
9. 真实户型上传是否应继续自动路线，还是应明确降级为辅助导入/CAD？
10. 测试是否只覆盖 happy path？真实图和真实用户路径是否有证据？

---

## 9. 关键文件索引

### 架构与状态

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_STATUS.md`
- `docs/SCENE_ARCHITECTURE.md`
- `docs/PROJECT_AUDIT_BRIEF_20261111.md`
- `docs/FLOORPLAN_UPLOAD_METHOD_REVIEW_20261112.md`
- `docs/UX_AGENT_ACCEPTANCE_BRIEF_20261111.md`

### 户型

- `docs/S2C_ACCEPTANCE.md`
- `docs/S2C_FULL_MATRIX.md`
- `docs/S2C_SECOND_IMAGE.md`
- `docs/S2C_RUNBOOK.md`
- `docs/FLOORPLAN_QUALITY.md`
- `docs/evidence/s2c-v3-6-two-image-2of2-20261108.json`
- `docs/evidence/floorplan-quality-batch1-20261109.json`
- `docs/evidence/floorplan-v4-contract-20261109.json`

### 代码入口

- `packages/scene-core/src/index.ts`
- `packages/scene-core/src/floorplan.ts`
- `apps/service/src/main.ts`
- `apps/service/src/store.ts`
- `apps/editor/src/`
- `apps/agent/actiscape_agent/`
- `apps/agent/actiscape_agent/floorplan_v3.py`
- `apps/agent/actiscape_agent/floorplan_flow.py`
- `apps/agent/actiscape_agent/floorplan_candidates_v4.py`
- `apps/agent/actiscape_agent/floorplan_upstream.py`

### 验证

```bash
npm test
npm run test:agent
npm run test:all
npm run test:floorplan:v35-replay
npm run test:floorplan:v36-replay
npm run test:full-home:references
```

本次只确认：

```text
.venv/bin/python -m pytest -q apps/agent/tests
193 passed
```

`npm run test:all` 需要 Node 24、Python 3.13、Chrome/Chromium、模型/数据环境；本次未完整执行。

---

## 10. 交接结论

当前项目总体是：

- 编辑器、持久化、候选/检查/提交、文字生成、旧 V3-6 户型矩阵有较多已记录能力；
- V4.2 和多 Agent 结构仍在开发；
- 真实户型上传的端到端能力未完成；
- 当前卡点不是单点视觉模型，而是“感知结果到确定性几何”的转换层；
- 代码、文档和验收标准之间存在需要独立审核的不一致。

本文只描述当前事实和问题，不对“应该继续自动识别还是转向 CAD/辅助导入”作结论。该方向需要审核后由项目负责人决定。
