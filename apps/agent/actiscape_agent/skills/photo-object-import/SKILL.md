---
name: photo-object-import
description: 把用户拍的单件物品照片变成场景里的独立家具对象，并落到用户点选或语言指定的支撑面上。当用户上传花盆/花瓶/摆件照片、说"把这个放到茶几上/窗台上"，或要替换场景里某个已有物品时使用；不适用于多件合影、透明反光物、需要精确测绘的场合。
license: MIT
compatibility: 需要 asset.job / scene.read / candidate.propose + candidate.preflight
  / candidate.preflight / candidate.review / candidate.render；资产服务未就绪时按第 4 节降级（只出资产规格与落位建议，不落位）。
metadata:
  version: 0.3.0
  status: verified
  level: structure
  owner: member3
  kind: asset
  activation: active
  judgement_refs: J-ASSET-01,J-ASSET-02,J-CIR-01,J-OVER-01,J-VER-01,J-VER-02
  capabilities: scene.read,asset.job,candidate.propose,candidate.preflight,candidate.render,candidate.review
---

# 照片物品入场景与局部摆放

> v1 接入说明：本 Skill 只声明语义 capability，不能直接写正式场景、提交项目或执行任意脚本。所有修改必须形成候选，并由固定代码预检、渲染、审核和提交。

## 什么时候用

✅ 适用：

- 用户上传**单件**物品照片（花盆、花瓶、摆件、台灯、小家电），要放进已有场景；
- 用户说"放到这张茶几上 / 电视柜上 / 窗台上"，或直接点了一个落点；
- 用户想把场景里已有的某个物品替换成自己的（先删后加，保持对象身份可追溯）。

❌ 不适用：

- 一张照片里有多件物品（先请用户分开拍）；
- 透明、强反光、细长易断的物品（首版不承诺，说明限制）；
- 用户要"按实物精确尺寸还原"（单张照片给不出可靠尺度，见第 5 步）；
- 还没有场景（先走 `floorplan-intake`，再进本技能）。

## 怎么做

**第 1 步 · 收集三样东西**

1. 照片：单件、轮廓清楚、背景尽量干净（不干净时说明"会先去背景，边缘可能不完美"）；
2. 尺寸线索：用户知道的真实尺寸（高/宽/口径任一项）；没有就准备第 5 步的问法；
3. 想放的位置：点选落点，或语言指定的已知对象（"这张茶几"）。

**第 2 步 · 提交作业（幂等）**
`asset.job`，`request_id` 用"项目 + 照片摘要 + 用户会话"生成一次并复用；用户连点两次、网络重试都用同一个 `request_id`，避免建两个作业 [J-ASSET-01]。
`params` 里带上裁剪框与去背景开关（首版默认开）。

**第 3 步 · 等待，不落位**
`asset.job` 轮询；期间告诉用户"模型在生成，生成好再确认外观"。
**作业未完成前不得把资产放进场景** [J-ASSET-01]；也不要把照片临时贴到场景里充数。

**第 4 步 · 取结果并确认外观**
`asset.job` 拿 `asset_id`、预览图与 `meta`：

- 给用户看预览，确认轮廓、主色、有没有明显破面或贴图缺失；
- "模型能打开"不等于"外观可用"，要请用户确认一句；
- 外观不行就重生成（新的 `request_id`），不要拿它硬放。

**第 5 步 · 尺寸确认（最容易出事的一步）**

- `meta.scale_calibrated = true`：仍有误差，需要用户确认包围尺寸；
- `scale_calibrated = false`：**必须问**，并给参照建议——"花盆口径多少厘米？""和 A4 纸（297×210）比大概多大？"；
- 用户说不清时，用同类常见尺寸给一个区间让用户选（例如花瓶高 25 / 35 / 45cm），并标注"尺寸为用户确认，非实测"；
- 未确认尺寸前不落位 [J-ASSET-02]。

**第 6 步 · 找支撑面并落位**

- 点选落点：取落点下方最近的支撑面（地面 / 台面），把资产底部原点放到面上；
- 语言指定："放到这张茶几上"→ 用对象名匹配场景里的 `coffeeTable`/`sideTable`/`tvCabinet`；匹配到多个时列出来让用户选，不要自己挑；
- 提交 `candidate.propose + candidate.preflight`：`add` 一个对象，带 `on: <支撑物 id>`、`at`、`rot`、`w/d/h`；`base_version` 用当前版本 [J-VER-01]。
- 台面物件不得超出支撑面边缘 [J-ASSET-02]；不遮挡通行（茶几四周仍要留出通道 [J-CIR-01]）。

**第 7 步 · 检查与收尾**
`candidate.preflight / candidate.review` 重点看 `ASSET-02`（越界）与 `OVER-01`（与台面已有物品重叠）、`CIR-01`（挡住通道）。
最多 3 轮微调 [J-VER-02]；仍放不下就换小一档的尺寸或换落点，并说明原因。
最后 `candidate.render` 出一张近景给用户确认，把"尺寸来源=用户确认/模型估计"写进修改说明。

## 依赖什么

| 工具                                      | 用途                         | 状态    |
| ----------------------------------------- | ---------------------------- | ------- |
| `asset.job` / `asset.job` / `asset.job`   | 异步生成、状态、产物与元数据 | 待成员2 |
| `scene.read`                              | 取支撑面与已有对象           | 待成员1 |
| `candidate.propose + candidate.preflight` | 落位（`on` 支撑面）          | 待成员1 |
| `candidate.preflight / candidate.review`  | 越界、重叠、通道             | 可 mock |
| `candidate.render`                        | 近景证据                     | 待成员1 |

与原项目 Skill 的差异：上游只有"手动导入 GLB"的入口，没有照片流程、没有作业状态、没有尺度确认；本技能把这三件事补成可执行步骤，并把"失败不改坏场景"写进流程。

未适配时的降级路径（状态仍为 `pending_adaptation`）：

- 没有资产服务：先输出"资产规格单"（外观描述、目标尺寸、落点、支撑面 id、需要的照片要求），交成员2 侧生成后回填；
- 没有 `candidate.propose + candidate.preflight`：给坐标与 `on` 目标，由主控转成场景命令。

## 怎么验证

- **正向** `POI-dev-01`：客厅已有茶几，用户上传花瓶照片、确认高 350，放到茶几中心。期望 `candidate.preflight / candidate.review` 通过（支撑面包含、不越界、不挡通道）。
- **边界** `POI-dev-02`：同场景，用户说不清尺寸、按"看起来很大"给了 700×700 的底盘，落在 1200×600 的茶几上。期望报 `ASSET-02`（超出支撑面），技能应退回尺寸确认而不是硬放。

## 版本与来源

- v0.1.0（2026-11-07）：首版。流程对应设计书 §4.1（照片→可用资产）与 §4.4（失败不改场景）；判据 `J-ASSET-01/02` 为本项目新增（见判据库 J 组）。
- 许可：MIT。上游仅借鉴 GLB 导入的对象身份思路，未复制实现。
- 未验证：真实生成质量、真实支撑面识别、真实撤销与保存重开（都依赖成员1/2 工具）。
