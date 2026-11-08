# ActiScape Skill 池（v1）

成员三交付的技能内容层：**30 个场景技能包、69 条判据、60 个可执行案例**。
全部按 `actiscape.skill.v1` 组织；结构（L1）与案例（L2）已通过，**真实核心（L3）未验收**。

> 阅读顺序：本文件 → `skills/README.md`（索引）→ 任一包 `SKILL.md` → 它的 `examples/`。
> 只想确认"能不能用"：直接跳到第 5 节，四条命令可原地复跑。

---

## 1 这个池子是干什么的

主控 Agent 与三个专职 Agent（空间设计 / 资产 / 检查）做设计时需要"经验"：可引用、可检查、可版本化的判据与操作步骤。这个池子提供这层内容：

- 每条经验 = 一个**判据 ID**（如 `J-CIR-01` 主通道净宽），带阈值、来源、可检查性；
- 每个场景 = 一个**技能包**，说明"什么时候用、怎么做、依赖什么能力、怎么验证"；
- 每个包带**两个可执行案例**（正向 + 边界），可被脚本判定。

## 2 目录

```
.
├── SKILL_POOL.md              # 本文件（评审入口）
├── ATTRIBUTIONS.md            # 来源与许可（上游/外部均为 MIT；逐包来源表）
├── VERSION.json               # 本次快照：技能数/判据数/案例数/activation/指纹
├── skills/
│   ├── README.md              # 人读索引（自动生成）
│   ├── index.v1.json          # 池索引（actiscape.skill-pool.v1，选择器读这个）
│   ├── LICENSES/MIT.txt       # 全池共享许可证（不在每个包里复制）
│   ├── _framework/
│   │   ├── skill.schema.json      # manifest 的 JSON Schema（actiscape.skill.v1）
│   │   ├── judgements.schema.json # 判据文件的 JSON Schema
│   │   ├── judgements.v1.json     # 69 条判据的结构化版本（唯一真源）
│   │   ├── FORMAT.md              # 包格式说明
│   │   ├── JUDGEMENTS.md          # 判据的人读版本
│   │   ├── TOOLS.md               # capability 语义与错误码
│   │   ├── VERIFY.md              # 三级验证机制与已知局限
│   │   └── CHANGELOG.md           # 框架变更
│   └── <skill-id>/
│       ├── SKILL.md               # 人读：五节固定
│       ├── manifest.json          # 机读：v1 结构
│       └── examples/<case-id>/{case.md, ops.json, expected.md}
├── tools/
│   ├── skill_lint.py              # 结构检查（v1 schema）
│   ├── mockscene.py               # 最小几何引擎（dry-run 用）
│   ├── dry_run.py                 # 跑案例并与预期比对
│   ├── validate_catalog.py        # catalog key 校验
│   ├── make_index.py              # 生成索引
│   └── data/catalog-sizes.json    # 固定尺寸表（随仓库提交，不依赖外部目录）
└── reports/
    ├── lint.v1.json               # 30/30，0 error
    ├── dry_run.v1.json            # 60/60
    ├── catalog_keys.v1.json       # 0 个未知 key
    └── skill_pool.v1.md           # 交付报告
```

## 3 一个包长什么样

```json
{
  "schemaVersion": "actiscape.skill.v1",
  "id": "living-dining-small",
  "version": "0.2.0",
  "kind": "layout",
  "status": "conformant",
  "activation": "active",
  "appliesTo": { "modes": ["generate_rectangular"], "roomKinds": ["living_dining"],
                 "areaM2": [8, 25], "projectState": "empty", "requiredInputs": ["dimensions"] },
  "capabilities": ["scene.read", "catalog.search", "candidate.propose", "candidate.preflight", "candidate.review"],
  "judgements": ["J-CIR-01"],
  "composition": { "maxPerTask": 1, "conflictsWith": ["living-dining-open"] },
  "license": { "spdx": "MIT", "attribution": "repository:ATTRIBUTIONS.md" },
  "validation": { "structure": true, "dryRun": true, "realCore": false }
}
```

`SKILL.md` 保留 Agent Skills 的格式与五节：**什么时候用 / 怎么做 / 依赖什么 / 怎么验证 / 版本与来源**。
正文只写专业判断与语义 capability，不出现主系统内部工具名。

### 池索引（`skills/index.v1.json`）

```json
{
  "schemaVersion": "actiscape.skill-pool.v1",
  "poolVersion": "2026-11-09",
  "counts": { "skills": 30, "active": 7, "reserved": 23, "cases": 60, "judgements": 69 },
  "active": ["..."],
  "reserved": ["..."],
  "skills": [
    { "id": "living-dining-small", "version": "0.2.0", "kind": "layout",
      "status": "conformant", "activation": "active", "capabilities": ["..."], "judgements": ["..."] }
  ]
}
```

`modes` 只允许四个值：`generate_rectangular`、`edit`、`reconstruct_floorplan`、`asset_import`。
固定规则：layout 只用 `generate_rectangular`；`social-reading-zone` 用 `edit`；modifier 用
`generate_rectangular + edit`；`floorplan-intake` 用 `generate_rectangular + reconstruct_floorplan`；
`layout-check-repair` 用 `edit + generate_rectangular + reconstruct_floorplan`；`photo-object-import` 用 `asset_import`。

## 4 分类与启用

| kind | 数量 | 技能 |
|---|---|---|
| layout | 21 | 客餐厅×2、主卧、儿童房、次卧、书房、办公、厨房、中岛、卫浴、玄关、阳台、开间、别墅、电竞、健身、影音、婴儿房、榻榻米、茶室、家政间 |
| edit | 1 | social-reading-zone（只改指定区域） |
| modifier | 5 | 适老、宠物、出租房、风格统一、照明配色 |
| intake | 1 | floorplan-intake |
| repair | 1 | layout-check-repair |
| asset | 1 | photo-object-import |

**首批 active（7 个）**：`living-dining-small`、`living-dining-open`、`social-reading-zone`、`style-coherence`、`lighting-color`、`floorplan-intake`、`layout-check-repair`。
其余 23 个为 `reserved`；`photo-object-import` 等 S3 资产作业完成后再启用。

**能力模型**：技能只能声明 `scene.read / catalog.search / candidate.propose / candidate.preflight / candidate.review / candidate.render / asset.job`。
**没有 `scene.write`、`project.commit`、`script.execute`**：技能只产出候选与验收意见，正式场景由主系统审批、落库与回滚。

按 kind 的额外约束：
- **modifier（5 个）**只提供约束与验收项，不声明 `candidate.propose` / `candidate.preflight`，声明 `scene.read / catalog.search / candidate.review`；
- **intake**只整理输入、假设与确认项，不声明 `candidate.propose` / `candidate.render` / `floorplan.analyze` / `floorplan.measure`，声明 `scene.read / candidate.preflight`；识图与尺寸识别由主系统执行。

**关于 `wallArt`**：catalog 里没有 `wallLamp`，`aging-friendly` 等 reserved 案例用 `wallArt`（挂墙装饰）表示"墙面装饰/壁灯占位"。它是**挂墙装饰，不是实际壁灯**，当前只用于 reserved 案例的几何与挂墙验证；若启用真实壁灯能力，必须新增 `wallLamp` 目录配方，不能用 `wallArt` 冒充真实壁灯。

## 5 验证

```bash
python tools/skill_lint.py --schema v1
python tools/dry_run.py --all --report reports/dry_run.v1.json
python tools/validate_catalog.py
python tools/make_index.py --schema v1
git diff --check
```

判定是**双向断言**：正向案例必须 `pass=true` 且禁止触发的错误码一个不出；边界案例必须 `pass=false` 且指定错误码出现。
这证明"技能警告的错误，检查器真能抓到"，而不是各说各话。

已知局限（详见 `_framework/VERIFY.md`）：
- 通行只验"可达宽区比例"，不验瓶颈最小净宽；
- 操作三角、眩光、取景、检修、声学、踏步等判据不在引擎里，属人工验收；
- 几何引擎是替身，口径以主系统真实检查器为准。

## 6 状态的含义

| 字段 | 现在 | 含义 |
|---|---|---|
| `status` | `conformant` | 结构 + 案例通过；**不是**真实核心验收 |
| `validation.structure` | true | L1 通过 |
| `validation.dryRun` | true | L2 通过 |
| `validation.realCore` | **false** | 未接主系统真实场景/检查器；接入后由主系统改为 `verified` |

## 7 来源

- 上游 [house-plan-designer](https://github.com/ZWD11/house-plan-designer) @ `b94183f9`（MIT）：判据与家具尺寸；
- 外部 [interior-design-expert](https://github.com/curiositech/some_claude_skills)（MIT）：只取数值（通行/净距/照度/色温）；
- 其余自写（含 AI 辅助），逐包来源见 `ATTRIBUTIONS.md`。

## 8 给评审者的提示

- **可以挑战**：① `kind` 划分是否合理（尤其 5 个 modifier 是否该拆）；② `appliesTo` 的字段是否够选择器用；③ `ops.json` 这种坐标化案例是否要换成更中性的场景描述；④ 30 个包颗粒度是否过细。
- **改格式的代价**：30 个包 + 60 个案例可由脚本统一改，`tools/` 里有解析器；改完整体升次版本。
- **不要**把 `conformant` 读成"核心已验收"；L3 必须由主系统跑同批 60 个案例后升级。
