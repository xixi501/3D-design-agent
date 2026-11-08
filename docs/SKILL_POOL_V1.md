# ActiScape Skill Pool v1

## 当前状态

Skill 池以 `actiscape.skill.v1` 固定快照随 Agent 包发布。当前共 32 个 Skill：

- 主系统内置 2 个：`rectangular-living-reading`、`floorplan-reconstruction`。
- 成员三内容 30 个，全部完成 v1 结构迁移。
- 运行时 active 且 verified 共 9 个；成员三其余 23 个为 `reserved`，不会进入模型候选短名单。

首批成员三 active Skill：

```text
living-dining-small
living-dining-open
social-reading-zone
style-coherence
lighting-color
floorplan-intake
layout-check-repair
```

## 执行边界

固定代码负责任务阶段、工具权限、候选检查、截图、审核和正式提交。Skill 只提供阶段内专业判断。

- 一个任务最多一个主 Skill 和两个 modifier。
- `style-coherence`、`lighting-color` 只注入约束和验收项，不产生独立修改轮次。
- `floorplan-intake` 在冻结需求前由代码自动启用。
- `layout-check-repair` 只在候选检查失败后启用，复用现有三轮修复预算。
- `photo-object-import` 在 S3 资产作业完成前保持 reserved。
- `social-reading-zone` 的功能分组只写入 `plan.source.activityGroups` 元数据，不提供成组移动、旋转或删除权限。
- Skill 不得申请正式场景写入、项目提交、任意脚本或数据库权限。

## v1 契约

每个 manifest 使用：

- `schemaVersion: actiscape.skill.v1`
- `kind: intake | layout | edit | floorplan | modifier | repair | asset`
- `status: draft | conformant | verified | deprecated`
- `activation: active | reserved`
- `appliesTo.modes` 只使用 `generate_rectangular | edit | reconstruct_floorplan | asset_import`；不得使用 `generate_from_text`、`edit_existing` 或 `floorplan_import`。
- 结构化 `appliesTo`、语义 `capabilities`、判据 ID、组合限制、许可证和验证状态。

结构化判据位于 `apps/agent/actiscape_agent/skills/_framework/judgements.v1.json`，使用 `judgements` 数组。内容哈希覆盖 manifest、正文、被引用判据和许可证文本。

## 选择与快照

代码先按任务模式、项目状态、房间类型、面积、能力可用性、activation 和 verified 状态生成短名单。grounding 模型只从短名单返回：

```json
{
  "primarySkillId": "living-dining-small",
  "modifierSkillIds": ["style-coherence", "lighting-color"],
  "reason": "18 平方米客餐厅，明确风格与照明要求"
}
```

任务保存完整 `generation.skillBundle`，包括主 Skill、modifier、自动 intake/repair、判据和 bundle 哈希。运行中的任务不再读取更新后的文件；外部任务视图会移除正文和判据原文，只保留摘要、版本、角色与哈希。

## API

- `GET /api/agent/skills`：默认只返回 active Skill，可用 mode、roomKind、area、kind、status、activation 过滤；`activation=all` 供只读检查。
- `GET /api/agent/skills/:id`：返回单个 Skill 的 v1 摘要、能力、验证状态和内容哈希。
- Agent `/health`：返回 `skillPool` 版本、哈希、总数和 active/reserved 数量。
- 任务结果：新增 `skillSelection`，`skillsUsed` 继续保留并增加角色。

固定错误码：`SKILL_POOL_INVALID`、`SKILL_SELECTION_INVALID`、`SKILL_RESERVED`、`SKILL_CAPABILITY_MISSING`、`SKILL_SNAPSHOT_INVALID`。模型越界、选择 reserved、组合冲突或能力缺失时 fail-closed。

## 验证

成员三负责：

- v1 结构与判据引用：32/32 运行时快照可加载。
- 60 个 L1/L2 案例在固定内容内通过。
- 未知 catalog key、未提交依赖和过期证据必须失败。

主系统负责：

- `npm run test:skill-pool:v1`：首批 7 个成员三 active Skill 各跑正向与边界案例。
- 正向案例通过真实候选预检与两视图 WebGL。
- 边界案例命中真实核心问题码；已有非阻断问题仍保留为证据。
- Python、Node、类型检查、构建、浏览器、原能力和完整离线门禁通过。

结构、分类与目录 key 结果见 [Skill Pool v1 结构证据](evidence/skill-pool-v1-structure-20261109.json)；真实核心结果见 [Skill Pool v1 L3 证据](evidence/skill-pool-v1-l3-20261109.json)。

## 兼容与升级

- 旧任务继续读取冻结的历史 `skillSnapshot`；新任务只使用 v1 `skillBundle`。
- 成员三更新通过固定快照同步提交进入主仓，不直接合并其开发分支。
- `reserved` 升为 active 需要单独提交，并且必须新增真实核心证据。
- 本阶段不包含 GEPA、AgentArts 完整部署和照片资产作业。
