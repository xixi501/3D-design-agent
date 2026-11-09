# 通用场景生成架构

## 目标

ActiScape 的输入可以是文字、户型图、项目数据、室内参考图或物品照片。所有输入必须进入同一可追溯管线，不能用客餐厅、两张演示图或少量目录 key 固化产品能力。

```text
InputBundle
  -> EvidenceGraph + IntentSpec + baseline authority
  -> SceneDraftDocument
  -> SceneProposal patch
  -> SceneProgram validation
  -> candidate / checks / review / atomic commit
```

## 事实、意图与场景

- **InputBundle** 只保存来源身份、类型、adapter 版本和内容哈希，不复制原图或用户文本。
- **EvidenceGraph** 只保存图片、俯视平面图或导入项目支持的事实。文字输入不能写入事实证据，物品照片不能直接写家具。
- **IntentSpec** 保存用户原话、约束、严格程度和未知项。参考照片默认只能产生可确认假设，不能静默确定毫米结构。
- **SceneDraftDocument** 是唯一持久化草稿，组合输入、证据、意图、SceneProgram、资产解析、不确定项、预算和字段权威。
- **SceneProgram** 只在草稿内保存一份。房间边界由墙图与房间种子点推导，不重复存多边形。

结构权威顺序固定为：已确认项目或户型图，其次是用户确认的推断结构。冲突进入 blocking uncertainty。

## SceneProgram

类型级结构支持：

- `levels[]`，每层有墙、洞口、房间种子点和标高。
- 任意方向墙中心线和墙厚。
- 任意房间种子用途 ID 与纳入状态。
- 家具、挂墙物、表面附着物、未知对象和来源引用。
- 未解析对象必须保留标签、几何和证据。

当前 `capabilityPolicy` 只放行正交单层，因此“类型可扩展”不等于“界面已支持多楼层或斜墙”。

## 注册表

`scene-registry.v1.json` 是房间、类别、别名、父类别、目录候选、默认家具、Skill 和 room policy 的版本化数据源。只有 `active` 房间可用于正式文字生成；`reserved` 只表示已有内容或计划，不表示已支持。

新增房间或类别优先只增加注册表和策略数据。若需要改 Python/TypeScript 核心枚举，视为架构回归。

## 草稿 API

| 方法与路径                                            | 作用                                         |
| ----------------------------------------------------- | -------------------------------------------- |
| `GET /api/projects/:id/scene-drafts`                  | 列出草稿摘要                                 |
| `POST /api/projects/:id/scene-drafts`                 | 创建绑定项目 revision 的草稿                 |
| `GET /api/projects/:id/scene-drafts/:draft`           | 读取当前草稿                                 |
| `GET /api/projects/:id/scene-drafts/:draft/revisions` | 读取 revision/hash 链                        |
| `POST /api/projects/:id/scene-drafts/:draft/patches`  | 以 requestId、`draftRevision` 和命令更新草稿 |
| `POST /api/projects/:id/scene-drafts/:draft/preview`  | 只读校验、未解析项和预算状态                 |

草稿更新从不修改正式项目。旧户型草稿 API 保持兼容。

现有矩形文字生成、自然编辑和户型图任务在返回正式候选时，同步维护同一任务绑定的通用草稿：文字成为 IntentSpec，项目当前状态成为 baseline authority，确认户型图成为 observed evidence，墙图、房间种子和家具投影为 SceneProgram。专业候选检查与正式提交仍是当前权威路径；通用草稿先作为可恢复的规范化投影，全屋阶段再迁移候选物化和几何-only 语义策略。

全屋 V4 开发批次已把户型图识别切到独立版本：新任务使用 `workflowVersion=4`、`recognitionVersion=4`、`s2c-floorplan-v4`、Skill `0.7.0` 和 `s2c-6` 评分。房间约束由 `floorplanScope` 决定，代码在房间归并后重新计算全部或指定功能区的目标房间；V4 家具候选使用 `geometry-only`，只输出轮廓、嵌套、邻接、包含和房间归属，类别由 Qwen 视觉角色判断。家具对象上限提升为 300，单 patch 仍为 100 条命令。

这不等同于全屋验收。两张现有图仍缺少卧室、厨房、卫浴、书房等全屋家具参考；V4 目前只完成契约、候选策略、版本隔离、容量和离线测试，执行结果见 [V4 contract evidence](evidence/floorplan-v4-contract-20261109.json)。必须补齐真实全屋参考并通过同图真实零校正运行后，才能对外声明“全屋家具复现已支持”。

两张开发参考已经存在，但首个零模型 V4 回放被阻断：固定墙体与洞口候选的覆盖不足，家具对象图过生成，2BHK 的 280 个可选对象只匹配 1 个参考，Oak Ridge C 的 139 个对象匹配 0 个。详见 [blocked replay evidence](evidence/full-home-v4-replay-blocked-20261109.json)。因此当前禁止启动真实 V4 模型任务，下一步只能先修 fixed candidate layer。

## 预算与容量

- 一个任务共享 24 次模型请求、600 秒活动时间和最多三轮修复。
- 草稿预算只能增加，不能通过 patch 回退或重启重置。
- 当前压力目标为单场景 300 件对象、单 patch 100 条命令。
- 正式项目仍只在最终候选通过检查和审核后提交一次。

## 分阶段边界

1. 公共契约与注册表。
2. 现有文字、户型图和编辑流程迁移到公共契约。
3. 全屋户型图目录家具复现。
4. 全部房间类型的单矩形文字生成。
5. 俯视/透视图片来源与混合资产。
6. 多房间、非矩形文字生成。
7. AI-first 工作台重做。

现有两张户型图只作回归；泛化能力必须由未参与调优的开发、验证和外部最终集证明。
