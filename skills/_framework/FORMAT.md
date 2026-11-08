# 技能包格式 v0.1

## 0. 采用的标准

包结构沿用 [Agent Skills 规范](https://agentskills.io/specification)：一个目录 + `SKILL.md`（YAML frontmatter + Markdown），可选 `references/`、`scripts/`、`assets/`。这样成员1 可以直接用现成的加载器/解析器，不需要自造格式。

在本标准之上加两样东西（本项目特有）：

1. `manifest.json` —— 机读元数据。规范里的 `metadata` 只能是字符串键值对，装不下"依赖工具 + 案例 + 状态"，所以单独一个文件。
2. `examples/<case-id>/` —— 可执行案例（`ops.json` 可被 mock 引擎跑），这是"验证"的载体。

## 1. 目录

```
skills/<skill-id>/
├── SKILL.md              # 必需：人读的操作说明
├── manifest.json         # 必需：机读元数据（状态/依赖/案例/来源）
├── references/*.md       # 可选：判据摘录、清单、对照表
└── examples/<case-id>/
    ├── case.md           # 输入描述（含房间尺寸、需求原话、已知约束）
    ├── ops.json          # 机器可执行的操作序列（dry-run 用）
    └── expected.md       # 预期行为 + 预期触发的检查项
```

## 2. `SKILL.md`

```markdown
---
name: living-dining-small            # 小写字母/数字/连字符，≤64，不首尾连字符
description: 一句话说清"做什么 + 什么时候用"，≤1024 字符
license: MIT
compatibility: 需要 scene.get_snapshot / scene.apply_edits / check.run / catalog.search
metadata:
  version: "0.1.0"                   # 字符串
  status: pending_adaptation          # pending_adaptation | pending_validation | released
  level: structure                    # structure | dry_run | real_tool
  owner: member3
  judgement_refs: "J-CIR-01,J-CUR-01,J-PROP-01"
---

# <技能名>

## 什么时候用
（适用任务、需要的输入、不适用/需要补充信息的情况）

## 怎么做
（步骤；每步写清调哪个工具、用什么判据；引用写 [J-xxx-xx]）

## 依赖什么
（工具 + 版本；与上游原 Skill 的差异；哪些还没适配）

## 怎么验证
（正向案例、边界/失败案例、预期检查项）

## 版本与来源
（版本、来源许可、修改记录）
```

**硬约束**（lint 会查）：
- 正文**不得**出现旧工具链：`analyze.py`、`build.py`、`check.mjs`、`qa.mjs`、`wallaudit.py`、`furnoverlay.py`、`cadvec.py`、`spec.json`、`npm run`；
- 不得写"反复生成直到通过"；修复必须引用 [J-VER-02] 的预算；
- 不得断言未经实测的收益（"提升 X%"）；
- 引用判据必须存在于 `JUDGEMENTS.md`。**判据库是阈值的唯一真源**：正文可以在判据 ID 紧跟处复述关键数值（便于照着做），但不得给出判据库里没有的新阈值；两者冲突时以判据库为准，并升技能版本。

## 3. `manifest.json`

```json
{
  "schema_version": "0.1",
  "id": "living-dining-small",
  "name": "小空间客餐厅布置",
  "version": "0.1.0",
  "status": "pending_adaptation",
  "level": "structure",
  "summary": "在 8–25㎡ 的客餐厅里排布沙发组、餐桌组与收纳，保留 700 通行。",
  "applies_when": {
    "scene_types": ["客餐厅", "起居室"],
    "area_m2": [8, 25],
    "inputs": ["房间尺寸或户型图", "家具偏好（可选）", "风格（可选）"],
    "preconditions": ["场景已有墙体与门窗"]
  },
  "not_applicable": ["需要拆改墙体", "整栋/别墅", "需要水电改造"],
  "depends": {
    "tools": [{"name": "catalog.search", "min_version": "0.1"}, {"name": "scene.apply_edits", "min_version": "0.1"}, {"name": "check.run", "min_version": "0.1"}],
    "judgements": ["J-CIR-01", "J-CIR-02", "J-CUR-01", "J-PROP-01"],
    "assets": []
  },
  "cases": [
    {"id": "LD-dev-01", "kind": "positive"},
    {"id": "LD-dev-02", "kind": "boundary", "expect": "check.run 报 J-CUR-01"}
  ],
  "provenance": {
    "based_on": ["house-plan-designer@b94183f9/reference/furnishing.md"],
    "license": "MIT",
    "external_refs": []
  },
  "validation": {"record": null, "checked_at": null, "checks": []}
}
```

`status` 语义：
- `pending_adaptation`：内容就绪，依赖工具未落地（`level: structure`）；
- `pending_validation`：依赖可用、跑过正向+边界案例，待稳定复跑（`level: dry_run`）；
- `released`：固定案例复跑稳定 + 证据齐（`level: real_tool` 或 dry_run + 人工评审）。

## 4. 案例与 `ops.json`

```json
{
  "case_id": "LD-dev-01",
  "kind": "positive",
  "scene": {
    "units": "mm",
    "min_passage": 700,
    "walls": [{"id": "w1", "a": [0, 0], "b": [3600, 0], "t": 240}],
    "openings": [{"id": "d1", "wall": "w1", "type": "door", "from": 400, "to": 1300}],
    "rooms": [{"id": "r1", "name": "客餐厅", "polygon": [[0,0],[3600,0],[3600,5200],[0,5200]]}],
    "objects": [{"id": "o1", "key": "sofa", "at": [1800, 700], "rot": 0, "w": 2200, "d": 950}]
  },
  "edits": [
    {"op": "add", "object": {"id": "o2", "key": "coffeeTable", "at": [1800, 1450], "rot": 0, "w": 1200, "d": 600}}
  ],
  "expect": {"pass": true, "must_trigger": [], "must_not_trigger": ["J-CUR-01", "J-DOOR-01"]}
}
```

约定：
- 坐标 mm，原点在房间外轮廓左上角，x 向右、y 向下（与上游 `spec-format.md` 一致）；
- `rot` 0/90/180/270，语义同上游：0 = 背面朝北；
- 墙体坐标是**墙中线**；洞口 `from/to` 是沿墙从 `a` 起的距离；
- 门可通行，窗不可通行；
- 台面物件用 `"on": "<支撑物 id>"`；
- 挂墙/吸顶由家具 `mount` 决定，技能不用手写。

## 5. 场景分类（本池覆盖）

| 组 | 技能 id | 一句话 |
|---|---|---|
| 起居 | `living-dining-small` | 8–25㎡ 客餐厅的高效排布 |
| 起居 | `living-dining-open` | LDK 一体大空间的分区与动线 |
| 起居 | `social-reading-zone` | 会客 + 阅读的功能分组与局部调整 |
| 卧室 | `master-bedroom` | 主卧睡眠区、收纳与梳妆 |
| 卧室 | `kids-room` | 儿童房成长性与安全 |
| 工作 | `home-office` | 书房/居家办公的采光与久坐 |
| 工作 | `office-workstation` | 小型办公工位与会议室 |
| 厨房 | `kitchen-line-l-u` | 一字/L/U 形橱柜与操作三角 |
| 厨房 | `dining-island` | 餐厨一体与中岛 |
| 卫浴 | `bathroom-standard` | 干湿分离与洁具间距 |
| 收纳 | `entry-storage` | 玄关动线与鞋柜收纳 |
| 家政 | `balcony-laundry` | 阳台洗衣与晾晒 |
| 户型 | `studio-micro` | 开间/一居的多功能合一 |
| 人群 | `aging-friendly` | 适老化：扶手、净宽、防滑 |
| 人群 | `pet-friendly` | 宠物家庭的耐污与动线 |
| 房源 | `rental-makeover` | 出租房低成本、可逆改造 |
| 别墅 | `villa-ground-floor` | 别墅首层与庭院 |
| 横向 | `photo-object-import` | 照片物品进场景与局部摆放 |
| 横向 | `style-coherence` | 全屋风格统一 |
| 横向 | `lighting-color` | 照明分层与配色 |
| 横向 | `layout-check-repair` | 检查 → 有限修复 → 如实报告 |
| 横向 | `floorplan-intake` | 户型图/文字需求的信息补齐 |

## 6. 版本规则

- 技能版本：`主.次.修订`；内容改 → 次版本；阈值/判据引用改 → 主版本；错别字 → 修订。
- 判据库、工具契约各自独立版本；技能 manifest 记录所用的判据与工具版本。
- **已发布版本不可覆盖**；更新发布新版本，旧版本保留（设计书 §4.3/§5.6）。
