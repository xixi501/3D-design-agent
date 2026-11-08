# 来源与许可

原始编辑器：ZWD11 / house-plan-designer，固定提交 `b94183f9ce2215db9a178da89a90d2ecefb18497`，MIT，Copyright 2026 ZWD11。许可原文保留于 `reference/upstream/LICENSE`；原始文件逐个哈希在 `reference/upstream/provenance.json`。

继承的场景、二维、参数化建模和材质模块保留上述声明，并通过提取清单追溯。产品运行不包含整块旧应用脚本。Three.js 使用 npm 0.160.0（MIT）；原版定制的几何辅助实现随继承模块保留，Three.js 许可副本位于 `reference/THREE-LICENSE`。

其他依赖与精确版本以 `package-lock.json` 为准，安装包自身的 LICENSE 随 npm 依赖取得，包括 Fastify（MIT）、better-sqlite3（MIT）、TypeScript（Apache-2.0）、Vite（MIT）和 Puppeteer（Apache-2.0）。

S2-A Python 依赖锁定于 `apps/agent/requirements.lock`，包含 LangGraph 1.2.20（MIT）、LangChain 1.4.9（MIT）、langchain-deepseek 1.1.1（MIT）、langgraph-checkpoint-sqlite 3.1.3（MIT）、FastAPI（MIT）、httpx（BSD-3-Clause）及 AgentArts SDK 0.1.10（Apache-2.0）。各包声明和许可随安装包保留；`ActiDeepSeek` 是本项目针对思考模式自动工具选择编写的小型适配器。

模型服务使用 DeepSeek 官方 API；不分发模型权重。AgentArts 本轮仅包含自行编写的最小 LangGraph 工具联通入口和 SDK 调用，不复制完整平台模板。真实模型验收记录不包含 API 密钥。

S2-B 内置的 `rectangular-living-reading` 设计技能整理自上述固定上游 `reference/spec-format.md`（坐标、家具朝向和布局约定）与 ActiScape 项目规则。技能包保留来源、MIT 许可和独立版本；它不声称是上游完整 Skill 的原样移植。

固定客餐厅、展台 JSON 和带贴图花瓶是本项目验收样例；花瓶由 `scripts/prepare-fixtures.py` 程序生成，不需要第三方模型下载或权重。

S2-C 图片预处理新增 Pillow 13.0.0（MIT-CMU）、opencv-python-headless 4.14.0.94（Apache-2.0，另保留 wheel 内 LICENSE-3RD-PARTY.txt）及 NumPy 2.5.4（包声明 BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0）。精确版本见 Python 锁文件，完整许可随各安装包保留。像素工具只做方向、解码、裁剪和直线候选，场景几何规则继续由 TypeScript 核心管理。

`floorplan-reconstruction@0.1.0` 为本项目按 S2-C 复现规则整理的 MIT 设计 Skill，包含来源、版本和内容哈希。合成 PNG 由本仓库脚本生成，用于工具和协议验证，不冒充用户真实户型图。

`floorplan-reconstruction@0.5.1` 增加 V3-2 候选墙分组、一次结构修复和人工重审约束；它继续只提供设计指导，不能扩大工具或正式场景写入权限。

`floorplan-reconstruction@0.5.2` 增加 V3-3 确定性墙体闭合、洞口扫描、外围尺寸候选、家具轮廓组合和代码审核仲裁。`dimticks.py`、`dimocr.py` 从同一固定提交加入随包来源清单，但运行时不依赖其未经验证的自动读数；尺寸文字仍由受控视觉角色抄录，端点、基准和证据由代码生成。

`floorplan-reconstruction@0.5.3` 增加独立家具 grounding 模型配置。默认使用 `Qwen/Qwen3-VL-32B-Instruct-FP8`（Apache-2.0），候选实现为 `zai-org/GLM-4.6V-Flash`（MIT）。模型权重由 vLLM 从仓库外缓存加载，不随本项目分发；DeepSeek 继续保留结构与常规 Agent 职责。

`floorplan-reconstruction@0.5.5` 参考 ACRScene 的主辅对象和活动组语义，实现轻量对象图与 `group_seated`／`direct_occupancy`／`direct_access`／`standalone` 关系；V3-6 另增加四椅桌面合成、细长 group 柜体对象和固定玄关柜排除。未引入 ACRScene 的 HSSD、Blender 或布局求解器依赖。

`floorplan-reconstruction@0.2.1` 增加上述固定上游的真实读图工作流。`analyze.py`、`axismap.py`、`wallfit.py`、`wallaudit.py`、`furnoverlay.py`、`dimticks.py`、`dimocr.py`、`imgio.py`、尺寸目录和两份工作流说明原样保存在 Python 包内 `vendor/house_plan_designer`；原始 MIT 许可及逐文件哈希一并保留。适配器限制输入、文件和进程边界，正式场景继续由 TypeScript 编译；详情见 [原版工具适配](S2C_UPSTREAM_TOOLS.md)。

DeepSeek 图像与工具图片协议参考 [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/) 和 [Vision](https://api-docs.deepseek.com/guides/vision/)。本项目适配器修复锁定 SDK 对工具图片数组的文本化，并保留思考模式字段；实际 API 探针及失败记录独立保留。
