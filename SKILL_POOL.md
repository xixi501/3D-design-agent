# ActiScape Skill 池

面向"普通用户自助做室内设计"的多 Agent 系统（ActiScape / 演境）的**技能包集合**。
成员3 交付；当前 30 个技能包、69 条判据、60 个可执行案例。

> 阅读顺序建议：本文件 → `skills/README.md`（索引与状态）→ 任选一个包的 `SKILL.md` → 它的 `examples/`。
> 想快速判断"这东西靠不靠谱"：看第 5 节"验证"和 `reports/`，不用读代码。

---

## 1 这个池子是干什么的

系统里有一个主控 Agent 和三个专职 Agent（空间设计/资产/检查）。它们做设计时需要"经验"——不是模型自由发挥，而是**可引用、可检查、可版本化的判据与操作步骤**。这个池子就是那层经验：

- 每条经验 = 一个**判据 ID**（如 `J-CIR-01` 主通道净宽），带阈值、来源、能否被工具检查；
- 每个场景 = 一个**技能包**（如"小空间客餐厅布置"），说明"什么时候用、怎么做、依赖什么、怎么验证"；
- 每个包带**两个可执行案例**（正向 + 边界），能被脚本跑出结论。

## 2 目录

```
.
├── README.md              # 本文件
├── ATTRIBUTIONS.md        # 来源与许可（哪些来自上游、哪些自写）
├── VERSION.json           # 本次快照：技能数/判据数/案例数/指纹
├── skills/
│   ├── README.md          # ★ 索引：30 个包、分组、验证结果、加载方式
│   ├── _framework/        # 池子的"宪法"
│   │   ├── FORMAT.md      #   包格式（Agent Skills 规范 + manifest + ops.json）
│   │   ├── JUDGEMENTS.md  #   判据库（69 条，唯一真源）
│   │   ├── TOOLS.md       #   工具契约（场景/检查/资产/技能加载，待成员1 确认）
│   │   ├── VERIFY.md      #   三级验证机制与已知局限
│   │   └── CHANGELOG.md   #   框架变更
│   └── <skill-id>/        # 30 个技能包
│       ├── SKILL.md       #   人读：何时用/怎么做/依赖/验证/版本来源
│       ├── manifest.json  #   机读：适用条件、依赖、案例、来源、状态
│       └── examples/<case>/{case.md, ops.json, expected.md}
├── tools/                 # 可复跑的检查工具
│   ├── skill_lint.py      #   结构检查（12 项）
│   ├── mockscene.py       #   最小几何引擎（12 类判定，不渲染）
│   ├── dry_run.py         #   跑案例并与预期比对
│   └── make_index.py      #   生成 skills/README.md
└── reports/               # 证据
    ├── lint.json          #   结构检查结果（22/22 → 30/30）
    ├── dry_run.json/.md   #   案例执行结果（44/44 → 60/60）
    ├── http_cases.md      #   契约级执行（44 案例走 HTTP）
    ├── skill_pool.md      #   池子交付报告
    └── capability_without_m1m2.md  # 无成员1/2 时的能力边界
```

## 3 一个包长什么样

```yaml
---
name: living-dining-small            # 与目录名一致
description: 8–25㎡ 客餐厅…（≤1024 字符，写清"做什么 + 什么时候用"）
license: MIT
compatibility: 需要 catalog.search / scene.get_snapshot / scene.apply_edits / check.run
metadata: {version: 0.1.0, status: pending_adaptation, level: structure, owner: member3}
---
```

正文五节固定：**什么时候用 / 怎么做 / 依赖什么 / 怎么验证 / 版本与来源**。
判据只写 ID（`[J-CIR-01]`），阈值去 `JUDGEMENTS.md` 查——避免两处真源。

`manifest.json` 是给加载器/选择器用的：`applies_when`（场景、面积、输入前置）、`not_applicable`、`depends.{tools,judgements}`、`cases`、`provenance`、`validation`。

## 4 状态机

| 状态 | 含义 | 现在 |
|---|---|---|
| `pending_adaptation` | 内容就绪，依赖工具未落地 | **全部 30 个** |
| `pending_validation` | 依赖可用、跑过正反案例、待稳定复跑 | — |
| `released` | 固定案例复跑稳定 + 证据齐 | — |

所以现在能证明的是：**内容自洽 + 几何可执行**；不能证明的是：**接真实场景服务后仍然成立**（那要等成员1 的 `scene.*` / `check.run`）。

## 5 验证（怎么复跑）

```powershell
python tools/skill_lint.py          # 结构：0 error
python tools/dry_run.py --all       # 案例：正向通过 + 边界按预期被拦
python tools/make_index.py          # 刷新 skills/README.md
```

判定不是"跑完没崩"，而是**双向断言**：
- 正向案例必须 `pass=true` 且禁止触发的错误码一个不出；
- 边界案例必须 `pass=false` 且指定错误码出现。

这证明"技能警告的错误，检查器真能抓到"——技能与检查口径一致。

## 6 来源（简版）

- 上游 [house-plan-designer](https://github.com/ZWD11/house-plan-designer) @ `b94183f9`（MIT）：判据 13 条、262 个家具 key 尺寸、检查阈值；
- 外部 [interior-design-expert](https://github.com/curiositech/some_claude_skills)（MIT）：**只取数值**（通行/净距/照度/色温），未复制文本；
- 其余自写（含 AI 辅助）：判据 28 条经验值 + 6 条项目约定。

逐项见 `ATTRIBUTIONS.md`，每个包的 `manifest.provenance` 也各自记录。

## 7 给评审 agent 的提示

- **格式**：`SKILL.md` 用 Agent Skills 规范（便于任何支持该规范的加载器直接读）；`manifest.json` 是本项目加的，因为规范里的 `metadata` 只能是字符串键值对，装不下"依赖+案例+状态"。
- **可以挑战的点**：① 判据是否该独立成文件而不写进技能正文；② 案例 `ops.json` 是否该换成更中性的场景描述；③ 30 个包的颗粒度是否过细（比如"主卧"和"次卧"是否该合并成"卧室"带参数）；④ 是否需要一个机器可读的"技能选择"字段（现在是 `applies_when` 自由结构）。
- **改格式的代价**：30 个包 + 60 个案例统一改由脚本可完成（`tools/` 里有解析器），但会把 `version` 全部升一个次版本。
- 有问题直接提，我按反馈批量改，之后照这个形式继续加包。
