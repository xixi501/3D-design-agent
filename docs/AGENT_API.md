# S2-A 会话、候选与工具契约

浏览器通过同源 `/api/agent` 访问 Python 服务。项目规则与修改继续由 Node 服务执行。Node OpenAPI 位于 `/api/openapi.json`，Agent OpenAPI 位于 `/api/agent/openapi.json`。

当前已有场景编辑协议以 [阶段 1 编辑协议](PHASE1_EDIT_PROTOCOL.md) 为准，包含候选前独立授权、版本失效、精确编辑检查模式与任务统计。以下同时保留历史接口说明。

S2-C 已增加户型图识别草稿与确认流程，见 [S2C_RUNBOOK.md](S2C_RUNBOOK.md)。真实图片验收状态见 [S2C_STATUS.md](S2C_STATUS.md)。

S2-B 已增加矩形文字生成，操作与恢复见 [S2B_RUNBOOK.md](S2B_RUNBOOK.md)。原编辑请求保持兼容。

Skill Pool v1 接口和组合规则见 [SKILL_POOL_V1.md](SKILL_POOL_V1.md)。

## 会话和任务

| 方法与路径                                    | 能力                                                    |
| --------------------------------------------- | ------------------------------------------------------- |
| GET `/api/agent/health`                       | Agent 状态、模型配置标志及运行版本                      |
| GET/POST `/api/agent/conversations`           | 按 projectId 查询、创建项目会话                         |
| GET `/api/agent/conversations/:id`            | 会话与持久焦点对象                                      |
| GET/POST `/api/agent/conversations/:id/tasks` | 查询任务；提交自然语言任务                              |
| GET `/api/agent/tasks/:id`                    | 当前状态、结果、预算与错误                              |
| GET `/api/agent/tasks/:id/events`             | SSE progress/snapshot；支持 Last-Event-ID 和 after 游标 |
| GET `/api/agent/tasks/:id/trace`              | 角色、工具、模型用量、版本与证据事件；after 分页        |
| POST `/api/agent/tasks/:id/resume`            | 澄清或恢复可继续的任务                                  |
| POST `/api/agent/tasks/:id/cancel`            | 请求安全取消                                            |

创建会话：`{"projectId":"已有项目身份"}`。创建任务：

```json
{
  "requestId": "调用方生成的唯一身份",
  "input": "把这把单人沙发向左移动200毫米，再在旁边加一盏落地灯",
  "selectedIds": ["实际家具身份"]
}
```

同一会话的同一 requestId 与相同内容返回原任务；不同内容返回 409。恢复请求同样使用独立 requestId 去重，并携带补充 input 和 selectedIds。原任务的预算不会因恢复而重置。每个项目的活动任务由 SQLite 唯一约束保护。

任务可附 `mode: "edit" | "generate_rectangular" | "reconstruct_floorplan"`，默认 edit。默认值不改变旧请求的去重哈希。生成任务仅在空白项目使用，后续澄清继续恢复同一任务；成功后新增的对话任务使用 edit。

户型草稿手工修改后，使用 `POST /api/agent/tasks/:id/recheck-floorplan` 重新审核当前哈希：

```json
{
  "requestId": "new-id",
  "draftId": "draft-id",
  "draftRevision": 3,
  "draftHash": "64-hex"
}
```

该入口只读取当前草稿和诊断证据，不修改几何、不产生正式项目写入。审核通过后保存绑定当前哈希的 `sourceReview`；相同 `requestId` 重试不会重复调用模型或新增审核记录。

GET `/api/agent/skills` 默认返回 active 的 v1 Skill，可按 `mode`、`roomKind`、`area`、`kind`、`status`、`activation` 过滤；`activation=all` 返回完整池。GET `/api/agent/skills/:id` 返回单个 Skill 摘要。任务的 `generation` 包含已收集 brief、missing、defaults、`skillSelection`、`skillBundle` 摘要、`skillsUsed`，以及通用草稿的 `sceneDraftId`、`sceneDraftRevision` 和 `sceneDraftHash`；完整 Skill 正文、判据原文和许可证文本只在服务端持久快照与角色上下文中保留。

新任务只接受 `actiscape.skill.v1`。代码先按任务模式、项目状态、房间、面积、能力和 verified 状态生成短名单，grounding 模型只能从短名单选择一个主 Skill 和最多两个 modifier。intake 和 repair 由代码自动启用。Skill 不能申请正式场景写入、项目提交或脚本执行能力，实际修改仍走独立授权、候选、预检、所需审核和固定提交。

状态为 queued、running、waiting_input、committing、completed、failed、conflict、cancelled。修改保存后返回 completed 和 committedRevision；已满足或纯否定请求返回 completed、noChange=true 和 committedRevision=null，不创建候选。结果包含字段变化、实际检查策略、统计；需要视觉审核时提供两个证据 URL，确定性编辑 evidence=[]。

明确的选中对象优先解决“这把/它”；无选择时参考会话焦点。重复且缺少区分条件的对象需要澄清。主控仅确定本次授权对象和字段，设计角色不能扩大范围。

## 候选

候选入口 `/api/projects/:id/candidates`。创建请求包含 requestId、taskId、baseRevision、scope、edits 和摘要。相同请求身份必须对应完整相同内容，新增对象 ID 仅生成一次。

scope 包含 targetIds、allowDeleteIds、allowAddKeys、requirements，可附 fieldMask、additionBounds 和 allowedRoomIds。Agent 编排始终提供具体字段授权；未授权对象、结构和配方字段不可修改。数量按明确的 project 或 targets 范围统计。

允许的编辑：

```json
[
  {
    "type": "update",
    "id": "已有家具身份",
    "values": { "x": 6600, "rot": 195 }
  },
  { "type": "create", "key": "floorLamp", "values": { "x": 5850, "y": 4900 } }
]
```

基础字段限 x/y/z/rot/w/d/h/color，删除使用 `{"type":"delete","id":"已授权删除的家具身份"}`。新建只选参数化目录。已有 GLB 的 color 编辑同时记录 opt.tint，保留原文件与其他配方字段。

候选可附 `activityGroups:[{name,memberIds}]`，只允许引用候选生成后仍存在的真实家具，并作为 `plan.source.activityGroups` 元数据保存。它不增加位置、旋转、尺寸或删除权限，也不提供成组移动接口。

| 候选子入口                       | 行为                                                  |
| -------------------------------- | ----------------------------------------------------- |
| GET `/:candidate`                | 固定快照、稳定命令、哈希、业务差异、检查与证据状态    |
| GET `/:candidate/checks`         | 确定性检查及阻断项                                    |
| POST `/:candidate/render`        | 单 worker 队列生成俯视和斜视 PNG，不写正式场景        |
| GET `/:candidate/evidence/:view` | 读取校验通过的 top/oblique 图片                       |
| POST `/:candidate/review`        | 记录独立 Agent 或显式 operator 检查，引用两个图片 SHA |
| POST `/:candidate/commit`        | 按原始版本、候选哈希和固定操作身份提交                |

commit 请求必须携带候选返回的 operationId、原 baseRevision 和 candidateHash。提交时重新验证固定命令重放、场景差异、几何、PNG 哈希和检查结论；然后在同一个数据库事务中更新正式项目、历史、操作记录与候选提交记录。重复提交返回原结果，不再次修改，即使用户后来已撤销。

operator 检查仅供显式工具验收，不能当成检查 Agent 已执行的证据。正式对话流程使用 agent 检查；角色工具注册表不提供 review/commit 的通用写入能力，提交由固定代码节点执行。

## 矩形初始化预览与候选

POST `/api/projects/:id/initialization-preview`：只读编译空白项目的矩形结构，要求 taskId、baseRevision、brief。返回固定结构身份、预览快照、初始化命令、毫米尺寸、门窗与默认值；不增加正式修订号或历史。

```json
{
  "taskId": "example-rectangular-task",
  "baseRevision": 0,
  "brief": {
    "purpose": "living_dining",
    "width": { "value": 6, "unit": "m" },
    "depth": { "value": 4, "unit": "m" },
    "doors": [
      {
        "side": "south",
        "position": "offset",
        "offset": { "value": 400, "unit": "mm" }
      }
    ],
    "windows": [{ "side": "north", "position": "center" }]
  }
}
```

实际 taskId 为最多 100 字符的字母、数字、下划线或连字符，Agent 使用 UUID。purpose 支持 living_dining / reading_lounge；尺寸支持 mm/cm/m。门窗必须给墙面和 center/offset 位置；doors 至少一项，windows=[] 明确表示没有窗。未提供窗数组不能当作无窗。

创建候选仍使用 `/api/projects/:id/candidates`，增加 `kind:"initialize"` 和同一份 brief，scope/edits/requestId/taskId/baseRevision 继续必需。scope 仅允许新增目录家具，并包含每项配方的数量。初始化不接受通过改变目录默认尺寸来绕过空间要求。

结构身份由同一任务固定；家具身份在候选创建时固定。响应保留原家具 diff，并增加 structure 中各集合的 added/deleted/updated 身份；generation 返回输入 brief、毫米尺寸、门窗和默认值。复用同一渲染、检查、review 和 commit 子入口。

正式提交重新编译并比对冻结结构，要求当前项目仍为空白、版本一致、家具清单与几何通过、两个 PNG 哈希有效、独立检查通过。结构与家具一起进入一个事务，撤销恢复原空白项目。PROJECT_NOT_EMPTY / REVISION_CONFLICT 不会覆盖现有内容。

## 检查与显示边界

检查复用 TypeScript 核心的有效房间区域、参数化轮廓和 SAT，包含字段保护、需求数量、20 mm 容差的房间占地包含及有效高度。吊装家具的有效离地与三维渲染使用同一函数。

新增或加重的相关几何问题阻断提交，既有无关问题继续展示。S2-B 增加门洞内侧 800 mm 局部净空检查；Skill Pool v1 同时增加窗帘前 150 mm、窗前 400 mm 和门内 700 mm 栅格近似可达区检查。GLB 仍是矩形占地；未验证精确网格、支撑面、完整建筑通路或法规。

图片采用同一候选真实 Three.js 网格。检查视图将墙体设为 15% 不透明度并隐藏吊顶，便于观察家具；这属于取证视图，不更改项目数据。截图失败、证据缺失或检查未通过不能提交。

真实调用样例见 `scripts/agent-demo.mjs`、`scripts/candidate-acceptance.mjs`；模型兼容验证见 `python -m actiscape_agent.smoke`。所有凭证保留在服务端。
