# S2-C 第二版：原版流程对齐

本轮以 `e6161f5` 为起点，继续使用 DeepSeek 官方 `deepseek-flash`、原 LangGraph/LangChain 依赖和同一张已冻结一居室样图。参考几何及原图不变，不把参考或目录评分白名单传给 Agent。本报告先记录工程交付；真实批次结果在固定业务版本运行后附录，不以受控模型替代。

## 历史分类更正

上一批第二次并非完全没有调用预检：模型发起了 `preview_floorplan`，但把 `change_reasons` 放进 draft，校验失败。return_direct 和通用结构化恢复随后走了不同出口，最后被未成功预检守卫拦截。两次均完成四次裁剪，但任务仅保存两条记录，存在并发覆盖；修改依据也因每轮相对原稿重新检查、未累计而反复失效。离线复核与原始结果哈希见 `evidence/s2c-flow-alignment-r0.json`。原失败结论保持，不删除或改写旧运行。

## 第二版工作流

主控像素识别并立即保存独立草稿 → 诊断图 → 检查初审 → 设计提交 MeasuredDraftUpdate → 固定代码原子修改与 TypeScript 预检 → 当前哈希原图审核 → 用户确认 → 资产匹配、冻结候选、原图对账与三维检查 → 固定代码一次提交。

新任务 generation.workflowVersion=2；旧任务缺少版本或版本1，继续旧流程及已冻结 Skill，未加载快照的旧任务使用随包的0.3.0快照。旧工具请求使用固定适配器2，第二版使用适配器3；保留旧辅助程序并隔离缓存。新任务固定 `floorplan-reconstruction@0.4.0`、`s2c-floorplan-v2-1`、`hpd-adapter-3`。

第二版只有结构化结果出口：空间设计返回基准草稿版本/哈希、commands、changeReasons、evidenceRefs，代码始终执行预检。字段错误最多一次有预算的结构恢复，失败准确报告 MODEL_FORMAT 并保存工具参数，不再借终止预检的返回代替结构化结果。修改批次先保存为 pendingMeasurement；响应丢失后用同一请求重试，不再请求模型生成另一批。所有阶段共享24请求、600秒活动时间、初稿后三轮修复；等待确认暂停，重启不重置。

首次识别保留供评分，确认前可以按原图修正假设；确认后保持结构和布局冻结。修改依据绑定具体对象的前后哈希累计保存，相同状态不重复索取依据。人工命令仍计 corrections，Agent 原子修改单列 agentEdits，不把两者混为人工校正。

## 几何与证据

measurementVersion=2 的墙、门窗、房间和符号仍为原图像素观测；新增 features 与 dimensions。特征绑定墙面、中线、墙端或开口边缘；尺寸绑定特征、标注索引和证据。每个已读标注都须绑定，不能忽略冲突。

TypeScript 内核 axis-constraints-1 在统一配准初值上执行带权最小二乘与线性硬约束，消除重复行、拒绝矛盾，保持已有连接。明确标注控制最终几何，像素测量为观测；最终尺寸残差≤1mm，另检查3%比例冲突、墙面/端点过度位移、反向墙面、墙厚、开口、房间及摆放。家具仍按统一配准保留位置占地，不自动重排。报告残差和校准量，项目 source 保存内核、输入、解算和符号映射。

fit_wall_candidates 只引用实际分析记录和0起始墙段索引，或实际裁剪内的新视觉候选。服务决定取样范围，返回墙面、中线、厚度、采样和可视证据；特征需引用匹配当前墙身份/中线/厚度的绑定测量。采样多不证明语义正确，仍需原图审核。

共享证据在任务事务中原子更新，四个裁剪名额中主控最多两个，设计和检查共享其余名额。原图身份、范围、坐标变换、文件哈希和工具版本一起保存；角色取得实际图片，失败不缓存，不同参数不复用。每轮诊断包括像素草稿；可编译时另显示实际毫米几何按原统一配准回投，不能依靠非线性反变换制造重合。审核绑定当前草稿哈希和诊断证据，修改使其失效。

符号可以记录 functionalArea、included、exclusionReason、evidenceRefs。明确排除的开放厨房观测不进入目标家具，排除原因仍需审核；不会因为同处一个连通房间而自动布置厨房。

## 接口和存储

- `POST /api/projects/:id/floorplan-drafts/:draft/measurement-updates`：{requestId,draftRevision,draftHash,commands,changeReasons,evidenceRefs}。commands 为 patch/upsert/delete/calibrate/targets/defaults；patch 仅改指定对象字段，集合另支持 features/dimensions。修改按整批验证与提交。
- `POST .../:draft/diagnostics`：绑定当前草稿哈希的检查、观测叠图、可用的真实几何回投、尺寸残差与校准量。文件复用原证据文件读取入口。
- `POST .../:draft/review`：{requestId,draftRevision,draftHash,review:{passed,summary,issues},evidenceRefs}。旧诊断不能审核新稿；确认不能豁免代码问题。
- `POST /api/floorplan-images/:image/tools/fit-bound`：分析候选 {walls:[{id,analysisId,index}]}；漏检候选需 {id,cropId,kind,c,p0,p1}，坐标必须位于该裁剪原图范围。取样不直接修改草稿。

现有图片、草稿、预检和候选接口保持兼容。Node 数据库增量迁移至4作为版本门禁，旧请求/候选哈希不重写；Python任务表不新增SQL版本。降级到旧程序需恢复升级前完整停服备份。导出/恢复包含 source 中的测量输入、结果、原图与证据，不能只复制SQLite。

## 验证与复现

工程检查覆盖尺寸约束与观测差异、错误基准、矛盾/冗余约束、过度校准、稳定ID、第一/二版评分、证据失效、并发裁剪、一次格式恢复、修改依据累计、响应丢失与重启，以及旧任务快照恢复。

`npm run test:floorplan` 验旧工作流；`npm run test:floorplan -- --v2` 验第二版。均使用明确标识的受控模型，执行真实浏览器、HTTP、SQLite、WebGL、确认、一次提交、撤销/重做、停服备份及独立恢复，不计真实图片识别成功。

真实单图：`npm run test:floorplan:tools:live -- /absolute/path/to/original.png 2 --v2-acceptance`。原图和独立参考哈希先验证；新评分使用 one-bedroom.v2-evaluation.json，几何参考文件不变。评分将实际解算特征距离和原图定位分开，不再用“参考像素长度×候选比例”判断1mm。既定90%识别及最终保真位置/角度/尺寸门槛不放宽，评分版本记 s2c-2。

仅当独立评分、零对象校正、代码与当前原图审核全部通过时，验收脚本模拟确认并标记；其后实际调用目录、四角色、三维证据，核对目录实例、一次提交、撤销/重做及真实局部编辑。失败不确认，保留所有调用与结果，任一次失败即不通过单图门槛，不进入第二图或完整S2。
