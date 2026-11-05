# 真实场景工具 API

S2-A 新增会话、持久候选、渲染取证和提交接口，见 [Agent 与候选 API](AGENT_API.md)。现有手工编辑接口继续可用。

入口 `/api`，运行时 OpenAPI：`GET /api/openapi.json`。本目录 `openapi.json` 是交付版本的静态副本。场景坐标、距离、实例及资产标称尺寸为毫米，x/y 是地面，z 是离地高度；旋转为度。Three.js 内部是米，坐标 `(x,z,y)/1000`，偏航为 `-rot`。

资产 `normalization.center` 使用 GLB 源文件坐标单位，顺序为 `[中心 X, 底部 Y, 中心 Z]`；`normalization.scale` 是源文件单位转换到米的系数。渲染层先平移，再缩放，业务工具直接使用返回的 w/d/h 毫米尺寸。

| 方法与路径                         | 作用                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| GET `/health`                      | 服务与 SQLite 健康状态                                                         |
| GET `/catalog`                     | 全部 266 项目录、默认配方、17 类自由造型、材质、家具风格及适用类型、门窗默认值 |
| GET `/projects`                    | 持久项目列表                                                                   |
| POST `/projects`                   | `{document, assetMap?}` 创建 / 导入；无 document 创建空项目                    |
| GET `/projects/:id`                | 完整快照、修订号、资产身份、历史位置                                           |
| GET `/projects/:id/export`         | JSON 快照与资产清单                                                            |
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
