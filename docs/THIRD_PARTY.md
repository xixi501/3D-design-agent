# 来源与许可

原始编辑器：ZWD11 / house-plan-designer，固定提交 `b94183f9ce2215db9a178da89a90d2ecefb18497`，MIT，Copyright 2026 ZWD11。许可原文保留于 `reference/upstream/LICENSE`；原始文件逐个哈希在 `reference/upstream/provenance.json`。

继承的场景、二维、参数化建模和材质模块保留上述声明，并通过提取清单追溯。产品运行不包含整块旧应用脚本。Three.js 使用 npm 0.160.0（MIT）；原版定制的几何辅助实现随继承模块保留，Three.js 许可副本位于 `reference/THREE-LICENSE`。

其他依赖与精确版本以 `package-lock.json` 为准，安装包自身的 LICENSE 随 npm 依赖取得，包括 Fastify（MIT）、better-sqlite3（MIT）、TypeScript（Apache-2.0）、Vite（MIT）和 Puppeteer（Apache-2.0）。

固定客餐厅、展台 JSON 和带贴图花瓶是本项目验收样例；花瓶由 `scripts/prepare-fixtures.py` 程序生成，不需要第三方模型下载或权重。
