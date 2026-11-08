# Skill 池 v1 交付报告

> 2026-11-09 · 成员三 · 分支 `dev/skills-deploy`
> 起点 `d547afd`；本次把旧格式迁移到 `actiscape.skill.v1`，并修复 7 类遗留问题。

## 1 结果

| 项 | 值 |
|---|---|
| 技能包 | 30（`layout` 21 / `edit` 1 / `modifier` 5 / `intake` 1 / `repair` 1 / `asset` 1） |
| 启用 | `active` 7、`reserved` 23 |
| 判据 | 69 条（结构化于 `skills/_framework/judgements.v1.json`） |
| 案例 | 60 个（30 正向 + 30 边界） |
| L1 结构 | **30/30，0 error**（`reports/lint.v1.json`） |
| L2 案例 | **60/60**（`reports/dry_run.v1.json`） |
| catalog key | **0 个未知**（86 个被引用 key，全部存在于固定表） |
| 状态 | 全部 `status: conformant`、`validation.realCore: false` |

## 2 迁移做了什么

1. **manifest**：改为 v1 严格结构（`schemaVersion / kind / activation / appliesTo / capabilities / judgements / composition / license / validation`），删除了 `depends`、`cases`、`provenance` 等旧字段。
2. **SKILL.md**：工具名全部替换为语义 capability（`scene.read / candidate.propose / candidate.preflight / candidate.render / asset.job`），重写"依赖什么"一节；modifier 增加"只提供约束与验收项，不独立产生第二轮修改"；repair 保留三轮预算说明；版本升 `0.2.0` 并保留历史条目。
3. **判据**：新增 `judgements.v1.json`（ID/分组/文本/阈值/来源/可检查性/版本），技能 manifest 只引用 ID。
4. **schema**：新增 `skill.schema.json`、`judgements.schema.json`，`skill_lint.py --schema v1` 按 schema 校验。
5. **索引**：新增 `skills/index.v1.json`（机读）与 `skills/README.md`（人读，自动生成）。

## 3 修复的遗留问题

| # | 问题 | 处理 |
|---|---|---|
| 1 | `mockscene.py` 依赖未提交的 `src_upstream/reference/catalog-sizes.json` | 固定表提交到 `tools/data/catalog-sizes.json`；`mockscene` 默认读它，`dry_run.py --catalog` 可换表 |
| 2 | 案例用了不存在的 key（`pendant`、`wallLamp`） | 改为 `chandelier`、`wallArt`；新增 `validate_catalog.py`，未知 key 直接失败 |
| 3 | `group` 案例暗示成组移动被执行 | 8 个案例改为 `scene.source.activityGroups` 元数据；`ops.json` 里不再有 `group` 操作 |
| 4 | 报告引用了未提交的 `mock/`、`deploy/`、smoke 证据 | 删除 `http_cases.*`、`capability_without_m1m2.md` 等无提交支撑的声明 |
| 5 | 计数过期（60 判据、22 技能等） | 全仓统一为 30 包 / 60 案例 / 69 判据 |
| 6 | README 反斜杠路径、CRLF | 文档改用 `/`；新写文件统一 LF |
| 7 | 缺 catalog/capability/judgement/kind/activation 校验 | 全部并入 `skill_lint.py --schema v1` |

## 4 active / reserved

**active（7）**：`living-dining-small`、`living-dining-open`、`social-reading-zone`、`style-coherence`、`lighting-color`、`floorplan-intake`、`layout-check-repair`
**reserved（23）**：其余全部，含 `photo-object-import`（等 S3 资产作业）。

## 5 没做、必须由主系统完成的 L3

1. 接真实场景/检查器，跑同一批 60 个案例，`validation.realCore` 由主系统改 `true`，`status` 升 `verified`；
2. 核对 `capabilities` 与实际实现是否一一对应（尤其 `candidate.preflight` 的检查码集合）；
3. 确认 `source.activityGroups` 的读取接口（本池只写元数据，不做成组移动）；
4. 确认 `wallArt` 作为墙面装饰/壁灯占位的语义是否可接受（catalog 无 `wallLamp` key）；
5. 若主系统检查器与本池 dry-run 口径不一致，以主系统为准并回写判据库。

## 6 复现

```bash
python tools/skill_lint.py --schema v1
python tools/dry_run.py --all --report reports/dry_run.v1.json
python tools/validate_catalog.py
python tools/make_index.py --schema v1
git diff --check
```

全新 checkout 即可运行：尺寸表随 `tools/data/` 提交，无任何外部目录依赖。

## 7 兼容性收口（2026-11-09，第二次提交）

| # | 项 | 处理 |
|---|---|---|
| 1 | 模式枚举 | 删除 `generate_from_text` / `edit_existing` / `floorplan_import`；统一为 `generate_rectangular` / `edit` / `reconstruct_floorplan` / `asset_import`，并按 kind 固定组合（lint 校验） |
| 2 | modifier 越权 | 5 个 modifier 不再声明 `candidate.propose` / `candidate.preflight`；正文"提交与检查"步骤改为"交付约束与验收项（不自己提交）" |
| 3 | intake 越权 | `floorplan-intake` 删除 `floorplan.analyze/measure`、正文去掉 `candidate.propose/render`，只声明 `scene.read` + `candidate.preflight`，并写明识图由主系统执行 |
| 4 | active capability | `social-reading-zone` / `layout-check-repair` / `photo-object-import` 补齐 `candidate.render`（后者补 `catalog.search`）；`living-dining-open` 补 `candidate.render`；正文使用即声明，由 lint 强校验 |
| 5 | 池索引 | `skills/index.v1.json` 改为 `actiscape.skill-pool.v1`，含 `poolVersion`、`active[]`、`reserved[]`、`skills[]` |
| 6 | 许可证 | 新增 `skills/LICENSES/MIT.txt`（全池共享，不逐包复制） |
| 7 | 活动组字段 | 8 个案例的 `activityGroups` 由 `ids` 改为 `memberIds`；`expected.md` 固定写明"主系统不提供成组移动权限 / 只用于识别与证据 / 轮廓与所有权一对一" |

**关于 `wallArt`**：catalog 无 `wallLamp`，`aging-friendly` 等 reserved 案例用 `wallArt` 表示"墙面装饰/壁灯占位"。它是挂墙装饰、不是实际壁灯，仅用于 reserved 案例的几何与挂墙验证；启用真实壁灯必须新增 `wallLamp` 目录配方，不能用 `wallArt` 冒充。

仍待主系统完成的 L3 不变：真实场景/检查器接入后，把 7 个 active Skill 的 `validation.realCore` 改 `true`、`status` 升 `verified`；本池不自行宣布通过。
