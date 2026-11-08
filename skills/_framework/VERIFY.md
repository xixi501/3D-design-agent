# 验证机制 v0.1

三层，**能验到哪层写哪层，不许混写**。这也是 S4 验收要求的"待适配 / 模拟通过 / 真实工具验证"三分法的落地。

| 层 | 名称 | 验什么 | 工具 | 通过标准 |
|---|---|---|---|---|
| L1 | `structure` | 包结构、字段、判据引用、工具引用、禁用词、案例齐备 | `tools/skill_lint.py` | 0 error |
| L2 | `dry_run` | 案例可执行、正向案例全通过、边界案例 trigger 到预期检查项 | `tools/dry_run.py` + `tools/mockscene.py` | 正向 pass + 边界按预期 fail |
| L3 | `real_tool` | 接成员1/2 真工具跑同批案例 | 待成员1 | 逐条证据（日志/报告/截图） |

## L1 结构与规范

```powershell
& D:\anaconda3\envs\rock\python.exe tools\skill_lint.py
```

查 12 项：
1. `SKILL.md` 有 frontmatter，`name` 合规且与目录名一致；
2. `description` 非空、≤1024；
3. `manifest.json` 通过 schema（必填字段、枚举值）；
4. `manifest.id` == 目录名 == frontmatter.name；
5. `depends.judgements` 全部存在于 `_framework/JUDGEMENTS.md`；
6. `depends.tools` 全部存在于 `_framework/TOOLS.md`；
7. 状态与 level 自洽（`pending_adaptation` → level 必须 `structure`）；
8. 正文引用的 `[J-xxx]` 都在 manifest 的 `depends.judgements` 或判据库中；
9. 正文无旧工具链词（`analyze.py`/`build.py`/`check.mjs`/`qa.mjs`/`wallaudit`/`furnoverlay`/`npm run`）；
10. 实例文件齐备（`case.md`/`ops.json`/`expected.md`），`ops.json` 结构合规；
11. 引用来源与许可存在（`provenance.license`）；
12. 边界案例声明了 `expect`。

## L2 几何 dry-run

```powershell
& D:\anaconda3\envs\rock\python.exe tools\dry_run.py --all --report reports\dry_run.json
```

`mockscene.py` 是一个**只做几何与净空判定的最小场景引擎**（不渲染、不生成模型），实现以下检查：

| 检查码 | 对应判据 | 做法 |
|---|---|---|
| `CIR-02`（门口） | J-CIR-02 | 门口 300 深范围内必须有自由落脚格，否则判"门口被堵" |
| `CIR-02`（通行区） | J-CIR-01 | 50mm 栅格 + 3-4 chamfer 距离场（近似欧氏），扣除墙内侧 350 门槛带；门口可达的"宽区"（净宽 ≥ min_passage）要占宽区 ≥60%，否则判"只能到达 X%" |
| `CIR-02`（多门） | J-CIR-02 | 同一房间内各门必须互相连通 |
| `DOOR-02` | J-DOOR-02 | 门扇扫掠矩形（洞宽 × 洞宽，向内）内不得有落地家具 |
| `CUR-01` | J-CUR-01 | 窗内侧 150mm 条带内不得有 h>600 落地家具（窗帘自身除外） |
| `DOOR-01` | J-DOOR-01 | 推拉/折叠/隐形门洞内侧 400mm 条带内不得有家具 |
| `WIN-01` | J-WIN-01 | 窗前 400mm、h>窗台的柜类不得出现 |
| `WALL-01` | J-WALL-01 | 挂墙件必须贴实墙（≤80mm）且不压洞口；吸顶件不查 |
| `OVER-01` | J-OVER-01 | 落地家具两两不重叠（例外：椅/凳与桌、边几与会客家具、地毯与窗帘、台面物与其支撑物） |
| `ASSET-02` | J-ASSET-02 | `on` 支撑物必须包含被放物件的落地投影 |
| `STA-01` | J-STA-01 | 房间面积 ≥ 对应下限（按房间名匹配） |
| `PROP-01` | J-PROP-01 | 主家具长度 ≤ 所属墙面 × 2/3（需 `wall_ref`） |

**已知局限（必须在交付里说明，不要当成"已验证"）**：
- 通行只验"可达宽区的比例"，不验"瓶颈最小净宽"：两片宽区之间若只隔一道 450 的窄口，仍可能通过。真正的瓶颈宽度要等 L3 真工具；技能里若写"通道 700"，案例只能证明没有更宽的阻塞，不能证明每处都 700。
- 操作三角（J-KIT-01）、视线/眩光（J-LIGHT-05）、取景（J-VIEW-01）、检修（J-ENT-03）、排水（J-BAL-02）、安全固定（J-SAFE-01）不在引擎里，属于人工验收项。

判定：`pass = 无 error 级问题`。warn 级（如比例建议）不影响 pass，但会记入报告。

**为什么这样算"验证过"**：正向案例证明"按技能做出来的布置能通过几何检查"；边界案例证明"技能警告的错误确实会被检查抓到"。两者都过，才说明技能与检查口径一致；只有文本没有案例，不算验证。

## L3 真工具（待成员1）

同一批 `ops.json`，把 `mockscene` 换成真 `scene.apply_edits` + `check.run`，对比两边结论是否一致。不一致时先查：坐标约定、家具 key 尺寸、`mount` 判定、洞口通行规则。

## 证据归档

```
reports/
├── lint.json
├── dry_run.json
└── dry_run.md          # 人读汇总：每包 L1/L2 结果 + 未覆盖项
```

每个包验证后把结果写回 `manifest.validation`：

```json
{"record": "reports/dry_run.json#living-dining-small", "checked_at": "2026-11-07", "checks": ["L1", "L2"]}
```

## 不做什么

- 不用 LLM 打分代替几何检查（打分会飘，几何不会）；
- 不把 `structure` 说成"已验证"；
- 不在缺工具时假装跑通——技能里写清降级路径，状态照样是 `pending_adaptation`。
