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
