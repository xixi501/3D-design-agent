# 来源与许可（ATTRIBUTIONS）

本仓库的 Skill 池不是从零发明，也不是整段复制。所有外部内容都在下面列清楚。

## 1 上游项目（判据的主要来源）

- **house-plan-designer** — https://github.com/ZWD11/house-plan-designer
- 固定版本：`b94183f9ce2215db9a178da89a90d2ecefb18497`
- 许可：MIT（Copyright (c) 2026 ZWD11）
- 使用权范围：读取并改写为判据与技能内容；本地副本在 `src_upstream/`
- 用到的文件：
  - `SKILL.md`（总流程、开工前确认清单）
  - `reference/furnishing.md`（布置常识：通道 700、窗帘活动区 150、推拉门 400、高柜挡窗 400、挂墙必实墙、家电齐备）
  - `reference/workflow-check.md`（检查阈值：尺寸链 30mm、墙体/门窗/叠图对账）
  - `reference/spec-format.md`（坐标、朝向、房间、家具 key 语义）
  - `reference/route-image.md`（缺尺寸要问、比例要说明、承重待确认）
  - `reference/catalog-sizes.json`（262 个家具 key 的默认尺寸，原样作为 `deploy/data/` 与技能举例的依据）
- 未使用：其 `scripts/` 下的识别与构建脚本（`analyze.py`、`build.py`、`check.mjs`、`qa.mjs` 等）——本项目不迁移旧工具链。

## 2 外部同类技能（数值型经验的来源）

- **interior-design-expert** — https://github.com/curiositech/some_claude_skills
- 作者：Erich Owens；许可：MIT（Copyright (c) 2025 Erich Owens）
- 用到的文件：`SKILL.md`、`references/space-planning.md`、`references/lighting-design.md`
- 使用方式：**只提取数值与判定口径**（通行 900/600/450、沙发-茶几 450、餐椅后推 900、床侧 600、书桌 900×900、衣柜前 750；IES 照度分区与色温区间），未复制段落文本。
- 对应判据：`J-CIR-*`、`J-LIGHT-*` 中的 10 条。

## 3 规范与行业资料（引用，需复核）

| 判据 | 依据 | 状态 |
|---|---|---|
| `J-STA-01` 房间面积下限 | GB 50096 常用引用值（双人卧室 9㎡、单人卧室 5㎡、兼起居 12㎡、起居室 10㎡） | **须按现行版本与地方标准复核** |
| `J-STA-02` 净高 | 规范/经验（主要房间 ≥2400、局部 ≥2200） | 须复核 |
| `J-KIT-01` 操作三角 | NKBA 通行经验（三边合计 3.6–6.6m，每边 1.2–2.7m） | 经验值，非强制 |
| `J-SAFE-01` 高柜固定/圆角/插座 | 经验与常见规范要求 | 须按现行标准复核 |

## 4 自写内容（无外部对应）

以下内容在来源项目中**没有对应文本**，由本项目自写（含 AI 辅助撰写，按 `skills/_framework/FORMAT.md` 模板与 `JUDGEMENTS.md` 判据组织）：

- 22 个技能包中，`provenance.based_on` 指向 `skills/_framework/JUDGEMENTS.md` 的 5 个包（玄关、阳台、卫浴、厨房、餐厨一体）——它们间接继承上面的上游/外部判据；
- 会客+阅读的**功能分组与"只改一组"**方法（`social-reading-zone`）；
- 照片物品导入的**作业状态机、尺度确认、失败不改场景**（`photo-object-import`，依据设计书 §4.1/§4.4）；
- 检查→有限修复→如实报告的**流程与红线**（`layout-check-repair`，依据设计书 §4.4）；
- 户型图/文字需求的**进场确认与假设表**（`floorplan-intake`）；
- 9 个职业/人群/房源场景（适老、宠物、出租房、开间、别墅首层、办公、风格、照明、儿童房）的具体操作链。

这些内容的性质是"把行业常识与项目约定结构化"，不是研究贡献；其中的经验阈值（判据库 `经验` 类 28 条）没有权威出处，需要专业复核。

## 5 没有做的事

- 没有抓取付费内容或未公开资料；
- 没有整段复制第三方技能文本（外部只取数值）；
- 没有把来源项目的脚本作为本项目实现。
