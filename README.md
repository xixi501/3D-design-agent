# 演境 ActiScape

面向普通用户的室内场景设计 Agent 项目，以 house-plan-designer 为基础开展重构与扩展。

计划体验：户型图或文字需求 → 可编辑三维房间 → 对话或手动调整 → 上传自有物品照片并导入模型 → 漫游查看 → 保存与继续修改。

当前 `dev/core` 提供 S0/S1 编辑器基础、S2-A 对话局部修改与 S2-B 矩形文字生成：保留 266 项家具、定制柜与 17 类自由造型，支持二维/分屏/三维、持久项目与 GLB、跨重开撤销/重做；四个 Agent 通过候选预检和截图检查后自动提交。

新建空白项目后，可描述矩形客餐厅或阅读会客间；缺少关键尺寸和门窗时先补问，需求摘要卡记录输入、默认值和实际设计 Skill。生成后继续通过对话增删家具、调整摆放、尺寸和颜色。

S2-C 增加清晰单层正交 PNG/JPEG 户型图的工程链路：原图识别 → 叠加草稿 → 比例标定与校正 → 显式确认 → 保留整层结构并复现选定客餐厅家具。工具及受控浏览器集成已验证。“92 户型”人工稿被用户指出房型不符，已撤回准确复现结论，不能用其三维和保存检查证明识别能力。当前接入固定上游的墙线、墙面拟合、尺寸链及原图对账工具，按角色分配并保留调用证据。**自动识别质量、正式两图矩阵和完整 S2 仍待验收**。不规则／多房间文字生成、建模配方的对话编辑、照片生成、正式 Skill 池／GEPA 和 AgentArts 全链路仍为后续阶段。

最新 V3 将识别拆成固定的结构骨架、结构判断、家具清点和确定性合并；旧 V1/V2 任务保持冻结。V3 受控浏览器通过，真实单图两次验收仍须单独执行，见[流程对齐](docs/S2C_FLOW_ALIGNMENT.md)。

V3 固定真实单图批次 `c72d4e9` 仍为 **0/2**：两次均在结构组装阶段被确定性校验拒绝，没有生成草稿或正式项目。完整 S2 未通过。

V3-2 已修复候选墙分组并加入一次结构修复、预计算测量和人工重审。它能在真实图运行中生成草稿；第二次开发运行经 49 项人工校正后编译通过，但独立审核仍发现门窗、家具位置和尺寸证据偏差，因此没有确认或正式提交。

## 运行产品

需要 Node.js 24、Python 3.13 和已安装 Chrome/Chromium；模型使用 DeepSeek 官方 API，密钥只在服务端 `.env` 配置。

```bash
npm ci
npm run setup:agent
npm run build
npm run start:all
```

打开 `http://127.0.0.1:3001/`。第一次进入载入客餐厅；“打开项目”可切换已有项目或三个固定样例。左侧模型库添加家具，右侧编辑配方；修改确认后保存到项目服务。

开发使用 `npm run dev`（编辑器 5173 / 项目服务 3001 / Agent 3002）。数据默认在 `data/`，用 `ACTISCAPE_DATA_DIR` 指定完整持久目录。详见 [S2-C 使用与恢复](docs/S2C_RUNBOOK.md) 和 [模型配置](docs/S2A_RUNBOOK.md)。

## 本轮交付与验证

- [第二版流程对齐](docs/S2C_FLOW_ALIGNMENT.md)：统一提交与固定预检、共享证据、标注约束解算及当前哈希原图审核；工程验证通过，真实单图仍为 0/2，未提交三维。实测后的两项修正只做离线验证。

- [单图自动复现实测](docs/S2C_SINGLE_IMAGE.md)：尺寸反馈、测量复用和差异保护已实现；两次真实识别仍失败，未提交三维，完整 S2 待验收。
- [S2-C 状态与验收](docs/S2C_ACCEPTANCE.md)：工具、受控浏览器、真实模型回归及两张实际户型图的待验收门槛。
- [S2-C 使用与恢复](docs/S2C_RUNBOOK.md)：上传、标定、校正、确认、图片来源、API 与完整数据备份。
- [92 户型实图记录](docs/S2C_SAMPLE_92.md)：失败试验、被否定的人工稿与更正说明。
- [原版读图工具适配](docs/S2C_UPSTREAM_TOOLS.md)：角色工具分工、真实调用接口、版本与验证边界。
- [S2-B 验收](docs/S2B_ACCEPTANCE.md)：文字生成、真实 Skill、重复案例与跨重启对话。
- [S2-B 使用与恢复](docs/S2B_RUNBOOK.md)：输入约定、真实模型脚本、数据升级与备份。
- [S2-A 验收](docs/S2A_ACCEPTANCE.md)：真实四 Agent、12 次对话案例、GLB、故障恢复与平台验收状态。
- [Agent 与候选 API](docs/AGENT_API.md)：会话、任务、授权、检查和原子提交。
- [成员三平台接入包](deploy/agentarts-minimal/README.md)：本机 SDK 验证与云端待办。

- [验收报告](docs/ACCEPTANCE.md)：已执行用例、几何对照、原版限制和差异。
- [运行与备份](docs/RUNBOOK.md)：隔离环境、完整验证命令、健康检查和恢复方法。
- [真实 API](docs/API.md)：事务、版本、去重、资产与调用样例；运行时 `/api/openapi.json`。
- [模块与来源](docs/ARCHITECTURE.md)：打包 HTML 提取方式、模块边界、显式状态。
- [成员交接](docs/HANDOFF_S1.md)：成员二 GLB 入场、成员三平台工具接入以及后续 S2–S5。

`npm test` 验证核心与服务，`npm run test:browser` 在生产构建上操作真实浏览器。原版与完整建模对照还需要独立 Python/Pillow 和 Chrome；配置完成后执行 `npm run test:all`。具体步骤见运行说明。

## 四条长期分支

| 分支                | 负责人             | 用途                                                               |
| ------------------- | ------------------ | ------------------------------------------------------------------ |
| `main`              | 主系统负责人汇总   | 集成和阶段交付，接收经检查的开发分支 PR                            |
| `dev/core`          | 成员一（主开发者） | 主前端、场景编辑、工作台、Agent 编排、检查与双层 harness、最终集成 |
| `dev/assets`        | 成员二             | 外部资产生成与整理，优先实现单件照片转可用 GLB                     |
| `dev/skills-deploy` | 成员三             | Skill 提取、收集与适配、版本维护、AgentArts 接入及阶段性部署       |

每个人在自己的电脑或服务器上开发；通过 Git 同步代码，通过说明和调用样例交接模块。

## 开始开发

```bash
git clone https://github.com/xixi501/3D-design-agent.git
cd 3D-design-agent
git fetch origin
```

按负责人选择一条分支：

```bash
# 成员一
git switch --track origin/dev/core

# 成员二
git switch --track origin/dev/assets

# 成员三
git switch --track origin/dev/skills-deploy
```

以上三个切换命令按自己的身份选择一个执行。已有本地分支时直接使用 `git switch 分支名`。

提交、同步与合并步骤见 [协作说明](CONTRIBUTING.md)。

## 模块交接

- 成员二交付独立可运行或可调用的资产模块、模型样例与接入说明；成员一完成模型入场和场景编辑集成。
- 成员三交付带来源、依赖、示例和版本的 Skill，以及可复现的阶段部署；成员一提供业务工具与固定应用版本。
- 模块内部框架、目录及实现方案由负责人决定。准备接入时对齐必要的输入输出、依赖和版本，不要求所有人使用同一服务器。
- 每位负责人交付运行或调用方法、验证结果、已知限制；未实现和模拟能力应明确标记。

## 主要参考

- [house-plan-designer](https://github.com/ZWD11/house-plan-designer)：室内场景与编辑器基础。
- [Hunyuan3D-2](https://github.com/Tencent-Hunyuan/Hunyuan3D-2)：图像到三维资产。
- [SceneSmith](https://github.com/nepfaff/scenesmith)：参考资产生成与整理实现。
- [AgentArts SDK](https://github.com/huaweicloud/agentarts-sdk-python)：平台运行与部署。

复用第三方代码时保留来源和相应许可。参考项目不是本仓库已完成的能力。
