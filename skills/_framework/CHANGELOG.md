# 框架变更记录

## v1.1（2026-11-09）· 兼容性收口

- **模式枚举**：只保留主系统四个值（`generate_rectangular / edit / reconstruct_floorplan / asset_import`），按 kind 固定组合，lint 强校验。
- **职责边界**：modifier 不再声明 `candidate.propose` / `candidate.preflight`，正文改为"只注入约束与验收项"；intake 去掉 `floorplan.analyze/measure` 与候选提交，只保留 `scene.read` + `candidate.preflight`。
- **capability 一致性**：正文用到即必须声明；`social-reading-zone` / `layout-check-repair` / `photo-object-import` 补 `candidate.render`，`living-dining-open` 补 `candidate.render`。
- **池索引**：`skills/index.v1.json` 改为 `actiscape.skill-pool.v1`（`poolVersion` + `active[]` + `reserved[]` + `skills[]`）。
- **许可证**：新增 `skills/LICENSES/MIT.txt`（全池共享）。
- **活动组**：`activityGroups` 字段由 `ids` 改为 `memberIds`；`expected.md` 明确"不提供成组移动权限 / 仅用于识别与证据 / 轮廓与所有权一对一"。
- **工具**：`skill_lint.py` 增加模式、capability、池索引、许可证、activityGroups 校验；`dry_run.py` / `make_index.py` 排除 `LICENSES` 等非技能目录。

## v1.0（2026-11-09）· actiscape.skill.v1

- **格式**：manifest 迁移到严格 v1（`schemaVersion / kind / activation / appliesTo / capabilities / judgements / composition / license / validation`）；删除 `depends`、`cases`、`provenance` 等旧字段；技能版本升 `0.2.0`。
- **能力模型**：技能只声明语义 capability，**禁止 `scene.write` / `project.commit`**；正文不再出现 `scene.get_snapshot` / `scene.apply_edits` / `check.run` / `view.capture` 等主系统工具名。
- **判据**：新增 `judgements.v1.json`（69 条，结构化 ID/分组/文本/阈值/来源/可检查性/版本）与两个 JSON Schema；manifest 只引用 ID。
- **分类**：`kind` 固定为 `intake/layout/edit/floorplan/modifier/repair/asset`；首批 `active` 7 个，其余 `reserved`；全部 `status: conformant`、`validation.realCore: false`。
- **修复**：① 固定尺寸表提交到 `tools/data/`，`mockscene` 不再依赖未提交目录；② 未知 catalog key（`pendant`/`wallLamp`）改为真实 key，并新增 `validate_catalog.py`；③ `group` 案例改为 `source.activityGroups` 元数据；④ 删除无提交支撑的 HTTP/部署/smoke 声明；⑤ 文档路径统一 `/`、文件统一 LF。
- **新增工具**：`tools/validate_catalog.py`；`skill_lint.py --schema v1`、`make_index.py --schema v1`。

## v0.3（2026-11-08）

- **判据库**：新增 `J-VIEW-02`（观看距离 = 屏幕对角线 × 1.2–1.6，半自动）、`J-CIR-11`（地台高差 > 150 须留踏步/缓坡，半自动）、`J-CIR-12`（<6㎡ 辅房 600 净宽门槛 + 门弧净空）、`J-GYM-01/02`（器械安全操作区、镜面墙）、`J-GAM-01`（桌面进深与视距）、`J-NUR-01/02`（尿布台、家电直吹）、`J-UTL-01`（扫地机基站）。
  来源：写影音室 / 榻榻米 / 健身 / 电竞 / 婴儿房 / 家政间技能时提出的缺口；对应技能已改为引用这些 ID，或在"版本与来源"里声明为人工项。
- **工具**：`dry_run.py`、`skill_lint.py` 启动时把 stdout 切到 UTF-8——GBK 控制台下打印 emoji 会 `UnicodeEncodeError` 并以 exit 1 退出（报告其实已写出），队友容易误判成失败。
- **技能池扩容**：22 → 30 个包（新增次卧、榻榻米、茶室、影音室、健身角、电竞房、婴儿房、家政间），案例 44 → 60。
- **发布**：新增 `release/build_release.py` 与 `dist/skill-pool/`，用于推送到 GitHub 分支供评审。

## v0.2（2026-11-07）

- **判据库**：新增 `J-CUR-02`（窗墙前净距 300/400）、`J-LIGHT-05`（屏幕眩光）、`J-LIGHT-06`（灯位对中）、`J-VIEW-01`（视频取景）、`J-SAFE-01`（高柜固定/圆角/插座）、`J-SAFE-02`（可逆改造）、`J-CIR-09`（端头绕行）、`J-CIR-10`（会议长桌净空）、`J-KIT-05`（厨房选形）、`J-ENT-03`（检修可达）、`J-BAL-02`（机位排水）、`J-STY-04`（五金一致性）、`J-VER-03`（未解决清单完整性）。
  来源：写技能时暴露的缺口，由 4 个技能批次提出。新增项一律标"人工/半自动"，不冒称引擎可查。
  编号冲突处理：两批分别提出 `J-LIGHT-05`、`J-CIR-09`，按先到先得合并，后到者改为 `J-LIGHT-06`、`J-CIR-10`。
- **判据库**：`J-LIGHT-02` 补"会议桌 300–500 lux"一档。
- **判据库**：`J-KIT-01`（操作三角）可检查性由"自动"下调为"人工"——引擎没有三角检查器，之前标错了。
- **FORMAT.md**：数值规则改为"判据库为唯一真源，正文可复述、不得新增阈值"；原表述与参考实现冲突。
- **VERIFY.md**：补全 L2 的 12 个检查码与判定口径；新增"已知局限"（通行只验可达比例，不验瓶颈净宽）。
- **mockscene.py**：距离场由曼哈顿 BFS 改为 3-4 chamfer（近似欧氏）——曼哈顿会在拐角把 500 的缝算成 700；新增墙内侧 350 门槛带排除，避免把门洞本身当成宽通道。
- **skill_lint.py**：判据正则 `J-[A-Z]{2,4}` → `{2,6}`，否则 `J-LIGHT-*` / `J-ASSET-*` 完全不可见。

## v0.1（2026-11-07）

- 首版：FORMAT / TOOLS / JUDGEMENTS / VERIFY 四份文件；22 个技能包；lint + dry-run 两级验证。
