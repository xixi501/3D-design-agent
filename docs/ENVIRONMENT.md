# S0.1 来源与隔离环境

产品克隆位于 `/workspace/3D-design-agent`，分支 `dev/core`。SceneSmith 位于 `/workspace/scenesmith_repro`，没有作为产品依赖安装目录使用。

上游 `https://github.com/ZWD11/house-plan-designer` 固定提交 `b94183f9ce2215db9a178da89a90d2ecefb18497`。上游只提供打包 HTML，未取得原始 TypeScript 或 sourcemap。十个原始文件的 SHA-256 和 MIT 许可保存在 `reference/upstream/`。

| 环境 | 本机位置 / 固定版本 |
|---|---|
| Node | `/workspace/.actiscape-tools/node-v24.22.2-linux-x64/bin`，24.22.2 |
| Python 参考构建 | 产品内 `.tools/reference-python`，Pillow 13.0.0 |
| 浏览器 | Chrome for Testing 156.0.8078.4；通过上游 browser.mjs 查找 |
| GPU 验证 | SwiftShader 软件渲染；实际 renderer 写入浏览器报告 |
| Three.js | npm 0.160.0，与原版 r160 对照 |
| 依赖安装 | npm workspaces + package-lock.json，已执行干净 `npm ci` 与 SQLite 原生模块 smoke test |

Node 官方压缩包 SHA-256：`48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75`，安装前已核对。

参考构建：`npm run reference:build`。默认选择产品内部的 Python venv，可通过 `ACTISCAPE_PYTHON` 覆盖。原版运行入口为 `reference/runtime/living-dining.html?debug`，运行输出和环境都不提交 Git。

基准花瓶 GLB 与客餐厅 HouseSpec 由 `scripts/prepare-fixtures.py` 生成；固定业务对象快照在 `fixtures/`。原版文件仅用于对照、分析和许可追溯，产品构建不加载原 HTML。
