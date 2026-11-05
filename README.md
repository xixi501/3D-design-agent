# 演境 ActiScape

面向普通用户的室内场景设计 Agent 项目，以 house-plan-designer 为基础开展重构与扩展。

计划体验：户型图或文字需求 → 可编辑三维房间 → 对话或手动调整 → 上传自有物品照片并导入模型 → 漫游查看 → 保存与继续修改。

当前 `dev/core` 提供 S0 原版基准与 S1 单层模块化主系统：保留 266 项原版家具、定制柜与 17 类自由造型，提供二维/分屏/三维编辑、持久项目与 GLB、跨重开撤销/重做，以及真实场景工具 API。首版聚焦住宅客餐厅。

自然语言对话、四 Agent 编排、照片生成模型和 AgentArts 完整部署进入后续阶段，当前工作台可手工编辑，也可由脚本通过 HTTP 修改。

## 运行产品

需要 Node.js 24，精确版本见 `.nvmrc`。

```bash
npm ci
npm run build
npm start
```

打开 `http://127.0.0.1:3001/`。第一次进入载入客餐厅；“打开项目”可切换已有项目或三个固定样例。左侧模型库添加家具，右侧编辑配方；修改确认后保存到项目服务。

开发使用 `npm run dev`（编辑器 5173 / API 3001）。数据默认在 `data/`，用 `ACTISCAPE_DATA_DIR` 指定持久目录。

## 本轮交付与验证

- [验收报告](docs/ACCEPTANCE.md)：已执行用例、几何对照、原版限制和差异。
- [运行与备份](docs/RUNBOOK.md)：隔离环境、完整验证命令、健康检查和恢复方法。
- [真实 API](docs/API.md)：事务、版本、去重、资产与调用样例；运行时 `/api/openapi.json`。
- [模块与来源](docs/ARCHITECTURE.md)：打包 HTML 提取方式、模块边界、显式状态。
- [成员交接](docs/HANDOFF_S1.md)：成员二 GLB 入场、成员三平台工具接入以及后续 S2–S5。

`npm test` 验证核心与服务，`npm run test:browser` 在生产构建上操作真实浏览器。原版与完整建模对照还需要独立 Python/Pillow 和 Chrome；配置完成后执行 `npm run test:all`。具体步骤见运行说明。

## 四条长期分支

| 分支 | 负责人 | 用途 |
| --- | --- | --- |
| `main` | 主系统负责人汇总 | 集成和阶段交付，接收经检查的开发分支 PR |
| `dev/core` | 成员一（主开发者） | 主前端、场景编辑、工作台、Agent 编排、检查与双层 harness、最终集成 |
| `dev/assets` | 成员二 | 外部资产生成与整理，优先实现单件照片转可用 GLB |
| `dev/skills-deploy` | 成员三 | Skill 提取、收集与适配、版本维护、AgentArts 接入及阶段性部署 |

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
