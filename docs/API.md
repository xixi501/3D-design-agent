# 真实场景工具 API

S2-A 新增会话、持久候选、渲染取证和提交接口，见 [Agent 与候选 API](AGENT_API.md)。现有手工编辑接口继续可用。

S2-C 的图片上传、版本化草稿、标定、叠加、确认和整层初始化接口见 [户型图 API 与恢复](S2C_RUNBOOK.md)。图片草稿使用校正后原图像素，正式项目仍使用毫米；不能混用两套坐标。真实图片质量与完整 S2 状态见 [验收报告](S2C_ACCEPTANCE.md)。

新增原版墙线、墙面拟合、尺寸链、只读结构预检及原图对账接口见 [工具适配 API](S2C_UPSTREAM_TOOLS.md)。这些接口仅生成诊断与证据，不写正式项目或历史；模型角色按职责取得相应工具，正式提交仍经候选检查。

入口 `/api`，运行时 OpenAPI：`GET /api/openapi.json`。本目录 `openapi.json` 是交付版本的静态副本。场景坐标、距离、实例及资产标称尺寸为毫米，x/y 是地面，z 是离地高度；旋转为度。Three.js 内部是米，坐标 `(x,z,y)/1000`，偏航为 `-rot`。

资产 `normalization.center` 使用 GLB 源文件坐标单位，顺序为 `[中心 X, 底部 Y, 中心 Z]`；`normalization.scale` 是源文件单位转换到米的系数。渲染层先平移，再缩放，业务工具直接使用返回的 w/d/h 毫米尺寸。

| 方法与路径                         | 作用                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| GET `/health`                      | 服务与 SQLite 健康状态                                                         |
| GET `/catalog`                     | 全部 266 项目录、默认配方、17 类自由造型、材质、家具风格及适用类型、门窗默认值 |
| GET `/projects`                    | 持久项目列表                                                                   |
| POST `/projects`                   | `{document, assetMap?, imageMap?}` 创建 / 导入；无 document 创建空项目         |
| GET `/projects/:id`                | 完整快照、修订号、资产身份、历史位置                                           |
| GET `/projects/:id/export`         | JSON 快照、资产清单和可选原图来源清单                                          |
| POST `/projects/:id/commands`      | 原子命令批次                                                                   |
| GET `/projects/:id/history`        | 最近 200 个编辑事务、当前位置与操作记录                                        |
| POST `/projects/:id/undo`、`/redo` | 持久撤销 / 重做，生成新修订号                                                  |
| GET `/projects/:id/events`         | SSE `revision` 事件；客户端据此重新读取快照                                    |
| GET `/projects/:id/checks`         | 确定性检查结果、对象 ID、覆盖范围与限制                                        |
| GET `/assets`、`/assets/:id`       | 已上传资产与尺寸/归一化元数据                                                  |
| POST `/assets`                     | multipart 单个 GLB 文件字段 `file`                                             |
| GET `/assets/:id/file`             | 持久 GLB 文件                                                                  |

## 命令协议

```json
{
  "operationId": "调用方为本次操作生成的唯一身份",
  "baseRevision": 7,
  "summary": "调整阅读角",
  "commands": [
    {
      "type": "update",
      "collection": "furniture",
      "id": "已有对象身份",
      "patch": { "x": 6200, "rot": 30 }
    }
  ]
}
```

成功返回 `{project, replayed}`。`project` 包含 `formatVersion:1`、`id`、`revision`、完整 `plan`、`roomLabelArchive`、`assets` 和 `{undo,redo}` 历史计数。编辑修订号与文件格式版本独立。

支持的命令：

| type              | 字段                            | 语义                                                       |
| ----------------- | ------------------------------- | ---------------------------------------------------------- |
| `add`             | `collection`, `object`（含 id） | 新增完整对象                                               |
| `update`          | `collection`, `id`, `patch`     | 深合并对象，数组整体替换，null 删除该字段；id 不可修改     |
| `delete`          | `collection`, `id`              | 删除对象；删墙同时删除该墙门窗，其他悬空引用会拒绝整批提交 |
| `createFurniture` | `key`, `x`, `y`, `overrides?`   | 按原版目录创建，服务生成独立身份                           |
| `duplicate`       | `collection`, `id`, `offset?`   | 深复制配方与新身份；结构对象需显式创建引用关系             |
| `project`         | `patch`                         | 修改 name、height、look、north、phase                      |

集合包括 `nodes/walls/openings/furniture/structs/beams/rooms/measures/elec/voids/comments`。后置功能的数据可保留，但没有相应演示工作台入口。本轮开发应主要使用前八项。

家具基础字段：`id,key,type,name,w,d,h,x,y,z?,rot,color`。`cab` 为柜体配方，`kit` 为橱柜配方，`opt` 为造型参数。默认值从 `/catalog` 获取，实际参数示例见固定项目和 `scripts/modeling-parity.mjs`。

自由模型的 `opt.op` 是 0–1 的不透明度；省略时使用 `freeMaterials[opt.mat].op`，材质未指定透明度则为 1。家具风格的适用类型以 `styleTypes` 为准。

外部 GLB 默认保留文件材质。旧项目中的 `color` 继续作为二维表示颜色；需要三维颜色叠加时显式设置 `opt.tint`，白色表示保持原材质。属性面板会同时记录这一显式参数，撤销后恢复原文件材质。

尺寸会在提交前校验。例如庭院门两侧立柱各 200 mm，宽度必须大于 400 mm；无效配方返回明确错误，不提交后再让浏览器绘制失败。

自由造型：`box,roundBox,cyl,halfCyl,tube,sphere,hemi,cone,pyramid,wedge,arch,arcWall,slats,steps,torus,lathe,extrude`。自由多边形用 `opt.outline` 保存 `x,y|x,y|...`，重新开项目继续参数化生成。柜体分格支持 `door,drawer,open,hang,hangOpen,glass,niche,mixed`。

## 事务与失败

- 一批 1–500 条命令；任何一条无效，全部不生效。
- 版本过期：HTTP 409 `REVISION_CONFLICT`，`details.currentRevision` 提供当前版本。
- 相同 operationId 与相同请求重试：返回原始成功结果，`replayed:true`，不重复修改。原始结果可能比当前项目旧；调用方需要时重新 GET 项目。
- 相同身份但不同内容 / 不同动作：HTTP 409 `OPERATION_CONFLICT`。
- 撤销和重做只需 `{operationId,baseRevision}`。操作后 revision 增加，不回退。
- 撤销后新编辑清除旧 redo 分支；已接受操作记录仍保留。
- 快照、历史、cursor、操作结果在同一个 SQLite 事务内更新。没有返回成功的保存不能由调用方自行认定已成功；响应丢失时先以原请求重试或读取当前状态。

错误结构：`{error,message,details?}`。不支持的多楼层、缺失模型、无效配方、对象引用和 GLB 格式都会明确返回错误。

## 可直接执行的工具示例

```bash
npm run tools:demo
node scripts/tool-demo.mjs PROJECT_ID
node scripts/import-asset.mjs fixtures/textured-vase.glb PROJECT_ID 2200 2200 420
```

示例调用真实 HTTP，演示读取、版本保护、修改、去重、冲突处理和检查。`ACTISCAPE_URL` 可指定服务。浏览器中打开相同项目可看到 SSE 更新。

检查采用继承的参数化轮廓分解与 SAT 相交、垂直区间、墙体与洞口。GLB 占地按矩形估算；不宣称精确网格穿插、支撑面、可达性、日照或法规验证。后续检查 Agent 应读取 `coverage/limitations`，不得把“无问题”解释为所有领域均已验证。

## 单图测量反馈与证据复用（71226cf）

原工具 HTTP 路径和参数保持兼容。尺寸链 N 个刻度只接受 N-1 个相邻距离；422 `details` 增加期望数、实际数和示例。预检 `checks.issues[].details` 可包含尺寸端点、基准与残差，或墙端／门窗原图位置和对象身份，不改变通过规则。

Agent 终止预检工具增加可选 `change_reasons`：以 `anchors:0`、`symbols:chair1` 等集合与身份为键说明原图依据。差异保存于任务测量记录，未解释删除或标注变化会阻断；这不是正式场景 API 写入权限。相同原图及参数的成功测量可复用，改变参数或失败结果不复用，重启继续使用原任务证据。预算保持不变。

当前提示词 8、适配器 2、Skill 0.3.0 的两次真实单图仍失败，没有可交付三维结果。零对象人工校正门槛及复现、评分、全部失败见 [单图实测](S2C_SINGLE_IMAGE.md)。

## V3 受控两阶段识别

新户型图任务带 `workflowVersion=3` 和 `recognitionVersion=3`。草稿新增 `categoryCode` 与 `sourceLabel`；V3 符号的 `category` 保留为 `categoryCode` 兼容值。旧草稿继续接受自由文本 `category`。

`categoryCode` 固定为 `sofa`、`armchair`、`chair`、`coffeeTable`、`sideTable`、`diningTable`、`tvCabinet`、`bookshelf`、`sideboard`、`cabinet`、`desk`、`plant`、`rug`、`floorLamp`、`decor`、`other`。V3-1/V3-2 历史评分保持 `s2c-3`，V3-3 新评分使用 `s2c-4`；阈值不变。

V3-3 新任务继续使用 `workflowVersion=3`、`recognitionVersion=3`，固定 `s2c-floorplan-v3-3`、`structureSkeletonVersion=3` 和 `hpd-adapter-5`。`analyze` 只增加 `candidateWalls`、`openingCandidates`、`dimensionCandidates`、`lineCandidates` 和候选图，不删除旧字段；现有工具路径增加只读 `contours` 模式，返回目标房间编号家具轮廓和 `contours.png`、`target_contours.png`。旧 V1/V2/V3-1/V3-2 任务保持原适配器和冻结 Skill。

V3-4 保持上述工具和 HTTP 路径，家具语义 Pass 改由独立 grounding 模型完成。默认 `ACTISCAPE_VISION_MODEL=Qwen/Qwen3-VL-32B-Instruct-FP8`，`ACTISCAPE_VISION_BASE_URL=http://127.0.0.1:3003/v1`。模型只返回轮廓 ID、类别、标签和朝向，代码继续计算坐标、尺寸和所有权。任务生成记录新增 `furnitureModel`，包含 provider、model、配置版本、调用数、输入/输出 token 和耗时；健康接口返回 `visionConfigured`、`visionAvailable`、`visionModel` 与 `visionBaseUrl`。

V3-5 新任务使用 `s2c-floorplan-v3-5`、Skill `0.5.4`、`activity-unit-1` 和评分 `s2c-5`。`contours` 在旧字段上增加稳定 `objectCandidates`、`activityGroupCandidates`、`objects.png` 和 `groups.png`；模型只选择一个 `objectCandidateId`，并提交餐桌／椅子等活动组关系。草稿新增可选 `activityGroups`，家具符号可带 `objectCandidateId`、`activityGroupIds` 与 `activityRole`；确认后的 `plan.source.activityGroups` 保存对应的正式对象 ID。旧 V1 至 V3-4 任务继续使用各自冻结版本。

V3-6 新任务使用 `s2c-floorplan-v3-6-1`、Skill `0.5.6`、`structureSkeletonVersion=4`、`hpd-adapter-6` 和同一 `s2c-5` 门槛。复杂图的 `analyze` 不再用整图包围盒生成矩形四面墙，而是从真实低饱和灰墙掩膜提取定向连通段、吸附交点、保留分析断口并单独检测外部尺寸线；简单矩形图可回退到已验证的旧候选层。家具对象图新增上下各两椅的桌面合成、细长 group 柜体收纳、固定玄关柜排除和旋转前后宽深归一。外部尺寸候选携带 `unitHint=mm`，原图只写数字 `9700` 时仍可绑定；同一开放区域的客厅、餐厅、玄关标签由代码合并为单个客餐厅目标。分析响应增加 `wallmask.png` 和候选诊断字段，旧 V1 至 V3-5 任务继续使用各自冻结适配器与 Skill。

V3-5 硬阻断错误包括 `UNKNOWN_OBJECT_CANDIDATE`、`OBJECT_CANDIDATE_REUSED`、`ACTIVITY_GROUP_INCOMPLETE`、`ACTIVITY_GROUP_ROLE_INVALID` 和 `UNRESOLVED_ACTIVITY_GROUP`。一次有界修复仍使用同一任务预算和请求上限。

草稿可附 `dimensionObservations` 保存全部已读标注；只有最长外围外尺寸作为统一比例锚点，其余标注作为交叉核对证据，避免把示意墙厚和标注差值误当成多套比例。审核问题可附 `source`、`severity`、`evidenceRefs`、`bbox`。代码先执行确定性检查，无法由候选或诊断复现的模型问题记为 `advisory`；自动验收入口使用冻结参考和对应版本的 `s2c-4`／`s2c-5` 评分，不放宽 90% 与 1 mm 门槛。

现有 HTTP 路径不变。V3 审核仍提交到 `POST /api/projects/:id/floorplan-drafts/:draft/review`，但问题对象增加固定 `code`。真实单图使用：

```bash
npm run test:floorplan:tools:live -- /absolute/path/to/original.png 2 --v3-acceptance
```

## 第二版户型图测量

第二版数据、measurement-updates、diagnostics、review、fit-bound 的参数与兼容说明见 [流程对齐接口](S2C_FLOW_ALIGNMENT.md)。新增测量结果不直接写正式项目；最终提交继续使用冻结候选与版本/去重机制。
