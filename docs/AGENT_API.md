# S2-A 会话、候选与工具契约

浏览器通过同源 `/api/agent` 访问 Python 服务。项目规则与修改继续由 Node 服务执行。Node OpenAPI 位于 `/api/openapi.json`，Agent OpenAPI 位于 `/api/agent/openapi.json`。

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

状态为 queued、running、waiting_input、committing、completed、failed、conflict、cancelled。只有服务确认固定候选已提交，才返回 completed 和 committedRevision。任务结果包含业务差异、具体字段变化、代码检查、检查角色意见及两个证据 URL。

明确的选中对象优先解决“这把/它”；无选择时参考会话焦点。重复且缺少区分条件的对象需要澄清。主控仅确定本次授权对象和字段，设计角色不能扩大范围。

## 候选

候选入口 `/api/projects/:id/candidates`。创建请求包含 requestId、taskId、baseRevision、scope、edits 和摘要。相同请求身份必须对应完整相同内容，新增对象 ID 仅生成一次。

scope 包含 targetIds、allowDeleteIds、allowAddKeys、requirements，可附 fieldMask 和 additionBounds。Agent 编排始终提供具体字段授权；未授权对象、结构和配方字段不可修改。数量按明确的 project 或 targets 范围统计。

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

## 检查与显示边界

检查复用 TypeScript 核心的有效房间区域、参数化轮廓和 SAT，包含字段保护、需求数量、20 mm 容差的房间占地包含及有效高度。吊装家具的有效离地与三维渲染使用同一函数。

新增或加重的相关几何问题阻断提交，既有无关问题继续展示。GLB 仍是矩形占地；未验证精确网格、支撑面、可达性或法规。

图片采用同一候选真实 Three.js 网格。检查视图将墙体设为 15% 不透明度并隐藏吊顶，便于观察家具；这属于取证视图，不更改项目数据。截图失败、证据缺失或检查未通过不能提交。

真实调用样例见 `scripts/agent-demo.mjs`、`scripts/candidate-acceptance.mjs`；模型兼容验证见 `python -m actiscape_agent.smoke`。所有凭证保留在服务端。
