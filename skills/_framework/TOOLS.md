# 工具契约（草案 v0.1，等成员1/2 确认）

技能里**只能**调用这里列出的工具名。工具未实现时，技能标 `pending_adaptation`，用 `mock` 级别验证。

> 依据：设计书 §3.2（场景快照 / 场景修改 / 资产作业 / 检查报告 / Skill 包）、§3.3（版本一致性）、§4.4（内层修复）。命名是提案，成员1 改名前请同步改这里并升版本。

## 1. 读取

| 工具 | 入参 | 返回 | 说明 | 状态 |
|---|---|---|---|---|
| `catalog.search` | `{query?, category?, limit?}` | `{items:[{key,name,category,w,d,h,style?,mount:"floor"\|"wall"\|"ceiling"}]}` | 家具库检索；首版 key 来自上游 `catalog-sizes.json`（262 项），成员1 重构后需对齐 | 可 mock（本地有尺寸表） |
| `scene.get_snapshot` | `{project_id}` | `{version, rooms:[{id,name,area_m2,w,d}], walls:[...], openings:[...], objects:[{id,key,name,at:[x,y],rot,w,d,h,z,mount,style}]}` | 正式场景快照 | 待成员1 |
| `scene.list_objects` | `{project_id, version?, filter?}` | `{objects:[...]}` | 轻量查询 | 待成员1 |

## 2. 写入（唯一入口，必须带 `base_version`）

| 工具 | 入参 | 返回 | 说明 | 状态 |
|---|---|---|---|---|
| `scene.apply_edits` | `{project_id, base_version, op_id, edits:[Edit]}` | `{version, applied:[id], rejected:[{index,code,message}]}` | 所有正式修改走这里；`op_id` 用于幂等去重 | 待成员1 |
| `scene.diff` | `{project_id, from_version, to_version}` | `{added, removed, changed}` | 用于证明"只改了指定对象"[J-VER-01] | 待成员1 |

`Edit` 类型（与设计书 §3.2 一致）：

```jsonc
{"op":"add",    "object":{"key":"sofa","at":[1800,1200],"rot":0,"w":2200,"d":950,"style":"nordic"}}
{"op":"remove", "id":"obj_17"}
{"op":"move",   "id":"obj_17","to":[2050,1200]}
{"op":"rotate", "id":"obj_17","rot":90}
{"op":"resize", "id":"obj_17","w":2400,"d":1000}
{"op":"material","id":"obj_17","mat":"oak"}
{"op":"group",  "name":"阅读组","ids":["obj_21","obj_22","obj_23"]}   // 功能分组，v1 可选
```

## 3. 检查

| 工具 | 入参 | 返回 | 说明 | 状态 |
|---|---|---|---|---|
| `check.run` | `{project_id, version, scope?:["circulation","clearance","proportion","kitchen","bath","asset"]}` | `{pass:bool, issues:[{code, severity:"error"\|"warn"\|"info", judgement_id, object_ids, at, evidence, fix_hint}]}` | 检查项与判据 ID 对应；`pass=false` 时技能进入有限修复 | 可 mock（本仓 `tools/mockscene.py`） |

## 4. 资产（成员2）

| 工具 | 入参 | 返回 | 说明 | 状态 |
|---|---|---|---|---|
| `assets.submit` | `{project_id, image_ref, request_id, params?}` | `{job_id, state}` | 同一 `request_id` 不重复建作业 | 待成员2 |
| `assets.status` | `{job_id}` | `{state:"queued"\|"running"\|"done"\|"failed", progress, error?}` | 轮询即可 | 待成员2 |
| `assets.get` | `{job_id}` | `{asset_id, glb_ref, preview_ref, meta:{unit:"mm", axis:"+y-up", origin:"bbox_bottom_center", bounds:[w,d,h], scale_calibrated:bool, source, params}}` | `scale_calibrated=false` 时必须让用户确认尺寸后才落位 [J-ASSET-01/02] | 待成员2 |

## 5. 技能与证据

| 工具 | 入参 | 返回 | 说明 | 状态 |
|---|---|---|---|---|
| `skills.list` / `skills.load` | `{skill_id, version}` | `{skill_id, version, manifest, body_ref}` | 由成员1 实现加载与选择；固定版本 | 待成员1 |
| `view.capture` | `{project_id, version, mode:"plan2d"\|"view3d"\|"walk", camera?}` | `{image_ref}` | 验收证据 | 待成员1 |
| `skill.execute` | `{skill_id, case_id?}` | `{ok, pass, codes, match_expect, image_ref, issues}` | **S0 演示用**：把一个技能案例串起来（建场景→提交→检查→出图）。依赖 `SCENE_SERVICE_URL`；真实编排仍归成员1 | 可 mock（本仓 `mock/scene_service.py`） |

## 6. 错误码（统一）

| 码 | 含义 | 技能应如何反应 |
|---|---|---|
| `E_VERSION_CONFLICT` | `base_version` 过期 | 重新取快照，基于最新版本重算，不覆盖用户新操作 |
| `E_NOT_FOUND` | 对象/资产/作业不存在 | 报告并停止该分支，不猜测 |
| `E_INVALID_ARG` | 参数越界（负尺寸、坐标出界） | 修正或询问用户 |
| `E_ASSET_PENDING` | 资产作业未完成 | 告诉用户进度，不落位 |
| `E_ASSET_FAILED` | 资产作业失败 | 保留现场，说明原因，允许重新提交（新 `request_id`） |
| `E_CONSTRAINT_UNSATISFIABLE` | 摆不下（空间不足） | 提出替代方案或降级方案，不假装成功 |
| `E_SERVICE_UNAVAILABLE` | 依赖的外部服务不可达（场景/资产） | 说明哪一段没接上，保留现场，不重试到超时 |

## 7. 与技能的关系

- 技能 `manifest.depends.tools` 列出所需工具与最低版本；任一 `待*` → 技能状态 `pending_adaptation`。
- 技能正文出现 `待*` 工具时，必须给出**降级路径**（用已有工具 + 人工确认），不能直接失败。
- 工具契约升版本时，`tools.schema_version` 同步升，并在 `CHANGELOG.md` 记录兼容性。
