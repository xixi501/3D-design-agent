# 来源与许可

原始编辑器：ZWD11 / house-plan-designer，固定提交 `b94183f9ce2215db9a178da89a90d2ecefb18497`，MIT，Copyright 2026 ZWD11。许可原文保留于 `reference/upstream/LICENSE`；原始文件逐个哈希在 `reference/upstream/provenance.json`。

继承的场景、二维、参数化建模和材质模块保留上述声明，并通过提取清单追溯。产品运行不包含整块旧应用脚本。Three.js 使用 npm 0.160.0（MIT）；原版定制的几何辅助实现随继承模块保留，Three.js 许可副本位于 `reference/THREE-LICENSE`。

其他依赖与精确版本以 `package-lock.json` 为准，安装包自身的 LICENSE 随 npm 依赖取得，包括 Fastify（MIT）、better-sqlite3（MIT）、TypeScript（Apache-2.0）、Vite（MIT）和 Puppeteer（Apache-2.0）。

S2-A Python 依赖锁定于 `apps/agent/requirements.lock`，包含 LangGraph 1.2.20（MIT）、LangChain 1.4.9（MIT）、langchain-deepseek 1.1.1（MIT）、langgraph-checkpoint-sqlite 3.1.3（MIT）、FastAPI（MIT）、httpx（BSD-3-Clause）及 AgentArts SDK 0.1.10（Apache-2.0）。各包声明和许可随安装包保留；`ActiDeepSeek` 是本项目针对思考模式自动工具选择编写的小型适配器。

模型服务使用 DeepSeek 官方 API；不分发模型权重。AgentArts 本轮仅包含自行编写的最小 LangGraph 工具联通入口和 SDK 调用，不复制完整平台模板。真实模型验收记录不包含 API 密钥。

S2-B 内置的 `rectangular-living-reading` 设计技能整理自上述固定上游 `reference/spec-format.md`（坐标、家具朝向和布局约定）与 ActiScape 项目规则。技能包保留来源、MIT 许可和独立版本；它不声称是上游完整 Skill 的原样移植。

固定客餐厅、展台 JSON 和带贴图花瓶是本项目验收样例；花瓶由 `scripts/prepare-fixtures.py` 程序生成，不需要第三方模型下载或权重。
