---
name: universal-spatial-base
description: 所有房间与所有 Agent 阶段默认挂载的 L0 通用空间底座。规定毫米坐标、rot=0/90/180/270 的宽深互换、门洞 800
  mm 净空、柜门/抽屉 450–600 mm 开启包络、台面 z=host.z+host.h 吸附、支撑父子关系，以及 Candidate -> CheckScene
  -> Commit 唯一写入口。适用于客餐厅、卧室、书房、厨房、卫生间、玄关、过道及照片资产入场；不适用于刚体动力学、地震模拟或绕过门禁直接写库。
license: MIT
compatibility: 需要 scene.read / candidate.preflight / candidate.review；只提供公理与约束，不声明写场景能力。
metadata:
  version: 0.1.0
  status: verified
  level: universal
  owner: member1
  kind: universal
  activation: active
  judgement_refs: J-CIR-01,J-CIR-06,J-ASSET-02,J-OVER-01,J-DOOR-02,J-VER-01,J-VER-02
  capabilities: scene.read,candidate.preflight,candidate.review
---

# L0 通用空间底座

> 本 Skill 是知识流，不是控制流。它不决定走哪条工作流，只规定进入任何阶段后必须遵守的物理、坐标和事务公理。所有修改仍由固定代码门禁执行。

## 适用边界

- 适用于单层住宅的矩形/全屋房间、局部编辑、动作检验和照片资产入场。
- 不做刚体动力学、重力自由落体、地震模拟、施工图或结构安全计算。
- 不直接写正式项目；任何写入必须形成 Candidate，经 CheckScene，再提交。

## 坐标与尺寸

- 场景内部统一毫米；Three.js 渲染层用米，且 +Y 为高程轴。
- 平面坐标 `x` 向右、`y` 向下；`rot` 为角度，0=背向北、90=背向东、180=背向南、270=背向西。
- `rot=90/270` 时家具的宽与深互换；判断占地、门前净空和台面尺寸时必须先交换 `w/d`。
- 家具中心点 `x/y` 是占地中心；`z` 是底面高程，不是中心高度。
- 不允许为了塞下家具而擅自缩小用户家具尺寸；尺寸修改必须有用户授权。

## 选品与体量

- Asset 阶段先按房间面积选规格，再选样式：小房间优先小体量、浅进深、可推拉门；不要先选大件再硬塞。
- 同一房间的家具材质/颜色控制在 2–3 类；风格修饰器只提供约束，不替代房间主 Skill 的取舍表。
- 柜体必须记录门型：平开/推拉/抽屉；门型决定开启净空，而不是事后补一条说明。
- 床、沙发、餐桌等占地大的家具必须保留至少 600 mm 侧向通道；书桌/办公椅前保留 ≥900 mm 起身区。

## 排布与净空

- 门洞内侧保留 800 mm 净空；门扇扫掠区不得被柜体、床、沙发或鞋柜占用。
- 平开衣柜/冰箱正前方保留 600 mm；推拉衣柜 500 mm；其他柜体/抽屉 450 mm。
- 柜门开启包络是矩形，门扇扫掠是四分之一圆弧；两者相交即 `DOOR_CABINET_CONFLICT`。
- 窗帘/纱帘/地毯不按落地障碍物处理，但窗帘前 150 mm 与窗前 400 mm 仍有专项检查。
- 台面物品使用支撑关系：`placement="surface"`、`parentObjectId=<host.id>`，高程为 `z = host.z + host.h`；不要用经验值猜桌面高度。
- 台面物品占地不得超出宿主台面边缘（默认 20 mm 容差）；同一宿主上的物品不得相互重叠。
- 没有合适台面时放到地面，不把大件家具吸到小茶几上。

## 检查与报错码

- 结构类：`FURNITURE_IN_WALL`、`DOORWAY_BLOCKED`、`CIR-02`、`POSSIBLE_OVERLAP`。
- 动作类：`OPENABLE_FRONT_BLOCKED`、`DOOR_CABINET_CONFLICT`。
- 台面类：`SURFACE_ITEM_OVERHANG`、`SURFACE_ITEM_COLLISION`、`SURFACE_ITEM_HOST_MISSING`。
- 检查失败先看阻断项，再看 metric；不要用“视觉上差不多”覆盖确定性报错。
- 门/柜门开启净空不足时，优先移动阻挡物或换小一档柜体，不要缩小门扇或删除门洞。

## 修复顺序

1. 先修挡门/挡柜门：`DOORWAY_BLOCKED`、`OPENABLE_FRONT_BLOCKED`、`DOOR_CABINET_CONFLICT`。
2. 再修台面越界/碰撞：`SURFACE_ITEM_OVERHANG`、`SURFACE_ITEM_COLLISION`。
3. 再修普通重叠/穿墙：`POSSIBLE_OVERLAP`、`FURNITURE_IN_WALL`。
4. 最后处理风格与舒适度。每轮只做最小必要移动，不扩大用户授权。
5. 三轮预算内没有安全确定性动作时停止并如实报告，不编造“已修复”。

## 提交门禁

- 所有场景写入必须经过 `Candidate -> CheckScene -> Commit`；动作状态（open/on）与照片资产放置同样适用。
- 候选提交前必须有真实项目 revision、候选 hash、确定性检查和（需要时）独立视觉复核。
- 目录家具使用真实 catalog key 与默认尺寸；照片资产使用真实 AssetRecord 的 `w/d/h`，不虚构模型。
- 事务提交后递增 revision；撤销、重做、保存和重开必须保持一致。

## 进化经验 (Evolved Rules)

> 本段是自进化形态 A 的标准挂载槽位。外层 Reflector 只能追加带触发条件与最小动作的条款，不得改写上面的物理公理或删除门禁。初始为空。

- （暂无）
