**ActiScape 原始设计对齐与独立代码审计（2026-11-12）**

审计版本：`feat/floorplan-auto-completion`，`abf6dc085ae708a2880387e5a17468f33de06140`。本报告未修改产品代码、未启动付费模型或 GPU 生成、未执行真实云部署。依据是原始设计、代码、当前离线/浏览器回归和零模型针对性复现；交接与“完成情况”文档只作为线索。

**1. 判断与设计基准**

项目已经有值得保留的编辑器、持久化、命令历史、候选与事务基础。主要问题是：若干实现违背了“只修改授权对象”“独立需求检查”“固定版本恢复”；全屋输入链路又把感知、几何合法性、原图忠实度和家具设计混成一项成功判定。继续增加 Agent、版本号和像素特例，会掩盖这些基础问题。

设计基准有两个时间层次：

- [2026-11-05 总设计书](/workspace/3D-design-agent/docs/ICT项目设计书.docx)，v1.1，重点为客餐厅、持续对话与人工共同编辑、自有物品入场、四角色按需协作、有限修复和可追溯保存。重点参见 1.1—1.3、2.3、3.3—3.5、4.1—4.5、5.6—5.7。
- [2026-11-10 执行计划](/workspace/3D-design-agent/1110计划.md)，明确把范围扩至全屋、动作净空、照片入场与 AgentArts，并暂缓 GEPA。其 1.1 选择的是“VLM 拓扑辅助 + 2D 确认弹窗轻量化半自动标定”，4.1—4.2 规定按任务路由和统一确定性门禁。

因此，“扩展全屋”“代码 Supervisor”“暂缓 GEPA”“不加刚体物理”都有设计依据，不宜误判为跑偏。真正的偏离是把清晰图片辅助导入推进成零人工自动识图的硬前提，把代码几何通过当成原图审核通过，以及把本地模拟/冻结样板的成功提升为整条产品能力完成。

原计划自身也有需要修正的工程估计：激活房间注册表不等于完成全屋设计；“几秒标定即可全屋生成”需要完整结构候选为前提；无状态容器不能依靠临时 SQLite 获得跨重启恢复。

**2. 原设计与实现对照**

| 设计要求 | 当前实现与证据 | 判断 |
| --- | --- | --- |
| 同一场景可编辑、撤销、保存、重开 | Node 项目服务、命令历史、SSE、编辑器与浏览器回归存在且本次通过 | 主方向一致，应保留 |
| 一个主控、专职角色按需参与 | PolicyController 与 LangGraph 已实现；精确操作有零模型路径；复杂任务走角色 | 组织方式合理，路由语义有严重缺陷 |
| 只改指定对象，保护无关对象 | 快速动作自动修复自行扩大 scope，移动阻挡家具 | 实质违背设计 |
| 几何检查、需求检查、渲染综合审核 | 户型原图审核把所有模型 issue 降为 advisory | 原图语义审核失去否决能力 |
| 用户可确认推断，支持轻量纠错 | 有草稿对象编辑、两点标定、全屋选择；但候选限制与硬门禁使缺失结构难以通过 | 入口存在，辅助导入路线未真正闭合 |
| 统一场景表示与坐标 | SceneDraft 单表持久化成立；通用 program 与正式 floorplan 各用一套几何派生 | 持久化统一，几何语义仍分叉 |
| 固定版本执行、恢复不变 | 多个版本继承同一大型类；同名 adapter 在不同提交输出不同；V3-6 回放失败 | 仅冻结元数据不够 |
| 照片生成、确认尺度、落在支撑面并保存 | 网关与放置流程已存在；仓库交付文档仍记录真实缓存为零、资产服务未合入 | 无法据此认定原 S3 完整验收已完成 |
| 云端长作业、进度、中断恢复 | 云适配器使用进程级临时 SQLite，同步等待；确认/恢复/状态代理未对齐 | 本地适配基础成立，原 S5 未闭合 |
| 通过效果与真实操作证明贡献 | 有大量回归与样板；全屋 2BHK 展示曾直接 materialize evaluation-only fixture | 可证明编译/展示，不可证明真实识图和泛化 |

**3. 优先修复的代码问题**

以下 P1 表示应阻止以当前行为作为可靠用户能力发布；不意味着已经发生生产事故。复现原始结果在 [本次证据目录](/workspace/3D-design-agent/test-results/independent-audit-20261112/summary.json)。

**F01 / P1：自动修复自行给无关家具追加移动权限。**

位置：[interactive_flow.py:171](/workspace/3D-design-agent/apps/agent/actiscape_agent/interactive_flow.py:171)，尤其 213 行重新构造 scope。

用户仅选择衣柜并说“打开衣柜”。首次 Candidate 失败后，`_repair_blocked` 找到旁边的床，直接构造 `targetIds=[bed]` 与床的 x/y fieldMask，追加移动编辑。没有读取原用户授权、保护对象或“只检查”的约束。若新候选通过，之后走快速路径的代码审核即可提交。

本次零模型复现：原 scope 只包含衣柜；修复 scope 改成床；床 y 从 2100 变成 2650，返回 `route=render`。这说明候选的 scope 校验只能证明“修改满足调用者自己提供的 scope”，不能证明 scope 来自用户授权。

修复：任务创建/主控理解后生成不可变授权记录，绑定任务与项目版本，由服务端校验；后续角色和修复代码只能取其子集。检查发现旁边家具阻挡时，返回可预览建议；只有已有布局修复授权才可移动。另需修正 metric 语义：检查端给的是净空缺额，修复端却把它作为剩余净空再做减法。

证据：[policy-probes.json](/workspace/3D-design-agent/test-results/independent-audit-20261112/policy-probes.json)。

**F02 / P1：户型原图审核的所有模型阻断项被统一降级。**

位置：[floorplan_v3.py:363](/workspace/3D-design-agent/apps/agent/actiscape_agent/floorplan_v3.py:363)，`_arbitrate_review`。V4/V4.2 继承该方法。

代码将每条模型 issue 的 severity 无条件设置为 advisory，再以 `not blocking_code_issues` 计算 passed。它没有逐项判断“代码是否覆盖了这个问题”。本次输入：模型 `passed=false`，指出“原图第二张床缺失”，附对象、证据与 bbox；输出：`passed=true`，该问题被降级。

同时，[floorplan_v3.py:249](/workspace/3D-design-agent/apps/agent/actiscape_agent/floorplan_v3.py:249) 在确定性检查通过后，对 `DOOR_SWING`、`WALL_THICKNESS`、`FURNITURE_AMBIGUITY` 直接返回已解决。几何自洽无法证明门向、墙厚或家具类别与原图相符。

修复：为检查项建立覆盖表。数值和几何由代码裁决；漏对象、错误类别、原图不符、用户风格/用途约束等保留独立语义审核。证据不足可以转用户确认，不能无条件改成通过。最终候选还有另一层审核，因此本复现证明的是“原图审核不能阻断”，并非所有检查都被绕过。

证据：[review-probes.json](/workspace/3D-design-agent/test-results/independent-audit-20261112/review-probes.json)。

**F03 / P1：快速路由不能保持否定、复合意图与显式开关语义。**

位置：[policy.py:262](/workspace/3D-design-agent/apps/agent/actiscape_agent/policy.py:262)、[policy.py:341](/workspace/3D-design-agent/apps/agent/actiscape_agent/policy.py:341)，以及 InteractiveFlow 的动作构造。

本次复现：

- “不要向左移动10厘米”被识别为向左移动 100 mm。
- “向左移动10厘米，并改成蓝色”只返回移动，颜色被丢弃；快速路径没有模型语义复核。
- “关闭衣柜”返回 `toggle_open`；对已关闭衣柜执行该命令，得到 `open=true`。

修复：区分用户语义 `set_open(false)` 与 UI 的 toggle，显式指令具备幂等结果。精确、单义且被完整消费的句子才走快速通道；带否定、多个动作、保护条件或未解析剩余内容的请求交给理解阶段。不要靠继续堆正则覆盖自然语言。

证据：[policy-probes.json](/workspace/3D-design-agent/test-results/independent-audit-20261112/policy-probes.json)、[geometry-probes.json](/workspace/3D-design-agent/test-results/independent-audit-20261112/geometry-probes.json)。

**F04 / P1：同一识别草稿有两个不等价的几何编译结果。**

位置：[floorplan-scene-draft.ts:73](/workspace/3D-design-agent/packages/scene-core/src/floorplan-scene-draft.ts:73) 与 [floorplan.ts:814](/workspace/3D-design-agent/packages/scene-core/src/floorplan.ts:814)。

`floorplanToSceneProgram` 使用像素坐标直接乘比例；正式 `compileFloorplan` 会减 origin，measurementVersion=2 时还调用测量约束求解。因此在现有 fixture 中，同一沙发在 program 为 (2500,1800)，正式符号为 (2000,1300)。两者至少需要显式坐标变换。

更实质的差异：给北墙 thicknessPx=30、比例 10，其他墙不提供 thicknessPx。SceneProgram 将缺省墙厚取所有已观测墙厚的最大值，东墙得到 300 mm；正式编译东墙为 200 mm。这无法用原点差异解释。

修复：保留像素 observation，统一生成经过测量求解、原点变换、墙分段及开洞处理的 canonical program；预览、检查、正式命令都从同一编译产物派生，并保留 source ID 映射。单表保存并不自动带来单一几何权威。

证据：[geometry-probes.json](/workspace/3D-design-agent/test-results/independent-audit-20261112/geometry-probes.json)、[thickness-probe.json](/workspace/3D-design-agent/test-results/independent-audit-20261112/thickness-probe.json)。

**F05 / P1：版本冻结只是标签，旧验收链路已有可观察回归。**

位置：[floorplan_v4.py](/workspace/3D-design-agent/apps/agent/actiscape_agent/floorplan_v4.py)、[floorplan_v4_2.py](/workspace/3D-design-agent/apps/agent/actiscape_agent/floorplan_v4_2.py)、[floorplan_candidates_v4.py:815](/workspace/3D-design-agent/apps/agent/actiscape_agent/floorplan_candidates_v4.py:815)。

V4/V4.2 都继承约 4233 行的 FloorplanV3 文件。新分支修改其共享 ground、结构组装、空家具处理和 adapter；这些行为没有完整按旧版本隔离。

本次 `test:floorplan:v36-replay` 在第一张冻结图上失败：期望 `candidateSummary.fallback='legacy-v3'`，实际 undefined。为了区分历史问题与当前分支问题，本次只读导出了两个旧提交的 Python 源码，使用相同输入、相同 `adapterVersion=hpd-adapter-6-1` 和空参数直接运行：

| 代码快照 | 墙候选 | 门窗候选 | 尺寸候选 | fallback/recovery |
| --- | ---: | ---: | ---: | --- |
| 历史验收 serviceCommit `4f204a9` | 6 | 7 | 4 | legacy-v3 |
| dev/core `4fa7935` | 8 | 2 | 0 | raw-hpd-segments |
| 当前 `abf6dc0` | 7 | 3 | 0 | raw-hpd-segments |

这是同名 adapter 行为漂移的证据；也说明回放失败不应全部归因于当前 feature 分支。没有重跑付费真实模型矩阵，不能进一步断言全部历史真实任务必然失败。

修复：给 provider/编译器实现分配不可变 digest 或真实新版本；恢复旧任务必须验证兼容实现，或明确停下而不是静默用新代码。旧版本回放进入 CI。仅冻结 Skill/prompt/版本字符串不能完成此要求。

证据：[baseline-comparison.json](/workspace/3D-design-agent/test-results/independent-audit-20261112/baseline-comparison.json)、[v36-replay.log](/workspace/3D-design-agent/test-results/independent-audit-20261112/v36-replay.log)。

**F06 / P1：新分支把像素缺口直接变成洞口，还删除原有不确定性。**

位置：[floorplan_flow.py:183](/workspace/3D-design-agent/apps/agent/actiscape_agent/floorplan_flow.py:183)。

`_merge_collinear_wall_gaps` 对 2—300 px 的共线间距合墙，新增 `type=hole`，并按关键词删除涉及这些墙的 OPENING_TYPE uncertainty。没有要求门窗证据，也未按实际尺度确定容差。

本次输入两段墙、50 px 缺口、零门窗候选，并保留“窗还是断墙未知”阻断项；输出合墙、生成 hole、删除该阻断项。若真实是窗，hole 的默认离地/顶高与窗不同，影响三维墙体和通行判断。

修复：把“墙中线连续”与“该区间是什么洞口”分开。合并支持几何清理，但区间语义必须有来源，未知就保留 unknown；只有绑定新证据或用户确认后才能消解 uncertainty。当前 heuristic 不应直接作为正式自动完成路线合入。

证据：[gap-probe.json](/workspace/3D-design-agent/test-results/independent-audit-20261112/gap-probe.json)。

**F07 / P1（云端目标）：临时运行时无法满足跨重启恢复与幂等。**

位置：[task_runtime.py:18](/workspace/3D-design-agent/deploy/agentarts-minimal/task_runtime.py:18)、[agent-proxy.ts](/workspace/3D-design-agent/apps/service/src/agent-proxy.ts)、[agentarts-proxy.ts](/workspace/3D-design-agent/apps/service/src/agentarts-proxy.ts)。

云适配器把 TaskManager 保存在进程全局，其任务与检查点写入 `tempfile.mkdtemp`。热进程内 requestId 去重成立；换容器/进程后没有同一份任务记录，重新创建 taskId 后 Candidate/operationId 也会改变。快照版本与原子事务不能替代跨实例业务幂等。

`run_task` 同步轮询，超时只返回 timeout，任务可能继续运行；用户看见超时后可能仍收到晚到的正式修改。云转发主要覆盖任务创建，GET/SSE/resume/confirm 的完整同源路由尚不对称。

修复：统一持久 task/job API，任务身份绑定 project+requestId，状态、检查点、预算放在外部持久存储。AgentArts 作为执行端；前端查询和确认同一外部任务；对超时明确区分“请求超时但任务继续”与“任务已停止”。进程级状态不能作为外部可恢复任务的唯一权威。

**F08 / P2：结构草稿降级被另一层审核重新堵死。**

位置：[floorplan_v3.py:3432](/workspace/3D-design-agent/apps/agent/actiscape_agent/floorplan_v3.py:3432) 与 [floorplan_v3.py:329](/workspace/3D-design-agent/apps/agent/actiscape_agent/floorplan_v3.py:329)。

前者在没有家具候选时允许返回空 symbols，后者只要 symbols 为空就生成 FURNITURE_MISSING 阻断项。因而“无家具原图/只导入结构”与“识别器漏检全部家具”都没有统一产品语义。代码允许创建草稿，不等于允许审核确认。

修复：显式区分 source_has_no_furniture、structure_only、furniture_detection_failed；按任务目标制定审核范围。

**F09 / P2：声明 300 家具容量，写入仍会撞到 100 命令上限。**

位置：[floorplan_v3.py:4039](/workspace/3D-design-agent/apps/agent/actiscape_agent/floorplan_v3.py:4039) 将所有 symbols 和 activityGroups 一次写入 measurement-updates；[floorplan-draft-mutations.ts:49](/workspace/3D-design-agent/apps/service/src/floorplan-draft-mutations.ts:49) 拒绝超过 100 条命令。

这是静态可证的容量不一致，本次没有运行 300 对象真实模型流程。修复应设计原子批次或可恢复分批协议，正确推进 draft revision/hash；不要只把一个数组拆成几段而忽略失败与确认一致性。

**F10 / P2：V4 手动重审选择了 V3 实现。**

位置：[manager.py:172](/workspace/3D-design-agent/apps/agent/actiscape_agent/manager.py:172)。`recheck_floorplan` 固定实例化 FloorplanV3，绕过 ground 中的 V4/V4.2 选择。实际运行取到的是 V3 的客餐厅 CHECK 文本，但日志 promptVersion 仍可能记为 V4.2。

修复：统一 resolver，根据冻结版本选择 ground、review 和 repair 的同一个实现，覆盖手动重审与恢复分支。

**F11 / P2：户型总尺寸提取忽略原始单位。**

位置：[floorplan_tools.py:54](/workspace/3D-design-agent/apps/agent/actiscape_agent/floorplan_tools.py:54)。正则抓取“总宽/宽度/width”后的数字，直接写入 totalWidthMm；“总宽9.6米”会作为 9.6 mm 下传。原设计明确要求确定性单位换算。

修复：所有模态共用量纲解析；无法确认单位则请求补充，不默认毫米。代码静态确认，本次未为此调用外部模型。

**4. 更深层的架构与 3D 表达问题**

**4.1 几何合法性、原图忠实度、设计好坏需要三类判定。**

当前“墙不相交/家具不穿墙”只能说明有限几何条件成立，无法发现漏掉一张床、餐桌朝向与需求不符、风格不一致。原图重建应以忠实度为目标；设计任务允许提出新布局，并解释软约束取舍。把两者都做成冻结坐标后反复过检，会让设计 Agent 退化成映射器，也让审核过度依赖候选自身。

建议：硬约束保存尺寸、授权、保留对象、合法几何；图像证据检查保存类别、数量、可见关系；设计目标保存动线、功能组、可用性、风格等软约束。每个 issue 标出来源、检查覆盖范围和负责阶段。

**4.2 缺少规范化墙图，但问题不是“只要装一个几何库”。**

当前 compileFloorplan 已做正交交点切分、部分重复段归并和 Node/Wall 生成；不能笼统说仓库“没有墙图”。真正缺少的是跨感知、测量、草稿、正式场景共用的规范化图，以及稳定的 source↔node/edge/face 身份。

此外，[floorplan.ts:915](/workspace/3D-design-agent/packages/scene-core/src/floorplan.ts:915) 将所有 degree<2 端点判错。本次给闭合房间加入一面合法的局部隔墙，编译直接拒绝。房间外壳需要闭合，不代表所有内墙都不能有自由端。自由端、识图缺墙、门洞断口需要不同语义。

建议以 wall support graph 为几何骨架，显式表示洞口区间、墙厚、交点与房间面；用户房间用途可挂在面/种子点上，开放式客餐厨还需要功能区语义。成熟几何工具可辅助 noding、snap、polygonize、布尔运算和异常诊断，但不能自行决定一个缺口是门、窗还是不存在的墙。

补充技术依据：CGAL 的 arrangement/DCEL 将顶点、半边和面显式关联；Shapely `polygonize_full` 能分别返回 polygon、cut edge、dangle 与 invalid ring。这适合用来建立诊断原型，不表示本项目应立即引入全部 CGAL 或再建一个几何写库服务。

**4.3 感知角色只能从不足的候选里选择，修复就没有有效动作。**

[1110计划.md:111](/workspace/3D-design-agent/1110计划.md:111) 的 VLM 拓扑辅助在 V4.2 中被收紧为只能选择 candidateWallId。候选没包含真实外墙时，更多模型轮次无法选择出那面墙。反过来，新 heuristic 又会无证据创建 hole，说明“限制太死”与“规则擅自补语义”同时存在。

建议保留多来源观测：HPD/分割矢量化/受限 VLM proposal。VLM 允许提交附原图 ROI、证据、置信度的补墙或语义修正建议；进入同一图编译、差异预览与必要用户确认。确定性层拥有计算与提交权限，不承担凭空判断图像真实含义的职责。

**4.4 工程版本增长快于边界稳定。**

大型 FloorplanV3 同时容纳多个版本、识别、房间归并、测量、审核仲裁与恢复；V4 以薄继承扩展。RoleContext/StageResult 是有用契约，但不能仅靠记录 hash 证明所有执行路径遵守同一角色边界。多个输入路径仍是专门实现，通用 SceneProgram 在部分路径只是投影。

建议保留代码 Supervisor 与四个逻辑职责，在图像输入时按需调用 structure/vision 专项能力；把 provider、measurement solver、canonical geometry compiler、review policy、version resolver 做成可独立测试的模块。不要为了架构整齐要求每个阶段都调用 LLM，也不要把所有旧任务实现继续塞入一个新版本类。

**4.5 快速命令仍承担统一截图成本；全局单 worker 会阻塞其他项目。**

[workflow.py:595](/workspace/3D-design-agent/apps/agent/actiscape_agent/workflow.py:595) 的快速路径不消费 Check 模型，但仍先渲染两张图片；[render-worker.ts](/workspace/3D-design-agent/apps/service/src/render-worker.ts) 对新候选启动 Chrome。[manager.py:34](/workspace/3D-design-agent/apps/agent/actiscape_agent/manager.py:34) 只创建一个队列 worker，跨项目任务串行。

当前这样做有利于简单可靠，但应测量端到端 P50/P95 后按风险分级；精确已授权命令用确定性执行与必要差异证据，复杂生成再用渲染和模型审核。独立资产作业/只读候选可限流并行，每项目正式提交仍串行。

**5. 验收与文档治理问题**

[总完成表](/workspace/3D-design-agent/docs/TOTAL_PLAN_COMPLETION_20261110.md) 将 P1 全屋标成完成，同时说明 2BHK 是冻结 fixture；将 P4 标成完成，同时说明本地模拟、非真实云。限制说明有记录，但标题级“完成”容易在后续交接中丢掉限定条件。

[旧质量基线](/workspace/3D-design-agent/docs/evidence/floorplan-quality-batch1-20261109.json) 并不是没有指标：两张图已有墙覆盖和门窗指标，且都被明确判为 baseline-blocked。它只覆盖小规模候选测试，不能当作真实上传完整基准。交接文档“没有基准和指标”的表述过于绝对，应改成“已有局部候选基准，缺少代表性端到端任务集”。

本次验证：

| 命令 | 结果 | 能证明什么 |
| --- | --- | --- |
| npm test | 96 passed | 当前 Node 单元/接口测试 |
| npm run test:agent 对应 pytest | 193 passed | 当前 Python 离线测试 |
| npm run build | 通过 | 类型检查和前端构建 |
| npm run test:all | exit 0，约166秒 | 参考、核心、浏览器、建模/目录/视觉回归 |
| npm run test:floorplan:v35-replay | 通过 | 指定历史捕获回放 |
| npm run test:floorplan:v36-replay | 失败 | 当前代码不满足旧 V3-6 回放要求 |

本次先发现宿主 PATH 没有 npm；找到 Node 24.22.2 后使用项目要求的环境重跑。上表只列修正环境后的最终结果，不将初次环境失败归为代码缺陷。

`test:all` 没包含 Python 与 V3-6 专项回放；CI 虽另有 Python job，也没有运行此专项。因此“完整测试全绿”不等于所有已承诺能力无回归。需要按能力声明组织必跑 gate，并输出 code/adapter/prompt/skill/compiler/model/fixture 的真实版本与 digest。

评测应恢复原设计对开发、验证、最终场景家族隔离的要求。两张图多轮成功是有价值的回归证据，不等于盲测泛化。原 S4 的 18 个任务、冻结策略对照可以保留为后续目标；按 1110 计划，GEPA 现在暂缓是合理安排。

**6. 建议后续实施顺序**

**第一步：先恢复原设计的三条可靠性约束。**

修复 F01 授权扩大、F02 审核无条件降级、F03 指令语义；统一任务授权、desired-state 动作、语义与几何检查覆盖。把本报告反例加入真正的端到端回归，并让未授权移动被服务端拒绝。此阶段完成标准不是“模型说没问题”，而是上述反例都得到正确动作/拒绝/澄清。

**第二步：统一几何编译与版本边界。**

修复 F04/F05/F10/F11：量纲与坐标变换只处理一次，draft preview 和正式 Candidate 使用同一编译结果；旧 adapter 版本实现冻结或明确不兼容。把 V3-6 回放加入发布 gate。将 F06 的猜洞口逻辑从正式自动路径撤回为建议，避免把未知信息直接变成事实。

当前 feature 分支建议保留用于验证；总尺寸传递、锚点推导等改动按独立小提交复核后再合并。不要把合墙、猜洞口、删除 uncertainty 和“空家具可用”打包认定为自动完成能力。

**第三步：兑现 1110 计划中的辅助导入，而非继续以全自动为唯一出口。**

定义三个可验收结果：可编辑结构草稿；用户核对后结构可提交；满足特定输入条件的自动通过。原图无家具时允许结构先入场，家具识别失败时明确说明。缺失结构能用带证据的 proposal 或低成本手工描墙修正。CAD/DXF 可作为后续更可靠的结构化入口，不必取代普通用户的图片入口。

建议先选一个受控输入档次，建立包含正常、缺尺寸、空家具、局部隔墙、歧义洞口等的开发集和未参与调优的验证集，记录墙/洞口/房间质量、尺寸误差、人工修正步数和到首次可编辑结果的时间。阈值由产品可接受的修正成本决定，不能仅由“自动识图算法能不能通过”决定。

**第四步：补回原方案的差异化主链路。**

完成真实花盆/花瓶/摆件输入到尺度确认、指定台面、继续编辑、撤销和重开；把 GPU 资产生成与场景放置分别验收。然后完成外部任务持久化和 AgentArts 的任务查询、确认、恢复链路，在真实平台验证。冻结样板、缓存命中、实时生成分别标注。

**第五步：再检验多 Agent 与 Skill 的收益。**

在同一模型、工具和预算下，对比精简流程、设计+检查流程、完整按需多角色流程。记录成功率、保护约束、人工干预、耗时、调用数与成本；结合固定设计约束和人工盲评检查布局质量。没有收益的调用应删减。待任务集、失败记录和发布流程稳定后再做 GEPA。

建议目标链路为：用户意图与不可变授权 → 按需感知/资产/设计 → 规范化场景草稿 → 统一几何编译 → 硬约束与独立语义审核 → 必要用户确认 → 固定 Candidate 原子提交。Agent 数量由任务需求决定；持久任务、场景数据和正式提交边界继续由工程代码负责。

**7. 本次工作的边界**

本报告可证明上述静态缺陷与零模型反例存在、当前回归结果及历史同名 adapter 的候选漂移。它没有证明现有全部真实任务都失败，也没有评价真实云环境性能或新照片生成质量。未修改产品代码；新增本报告，证据放在被仓库忽略的 test-results 目录中。

补充参考只用于技术建议：CGAL 2D Arrangements / DCEL、Shapely polygonize_full、LangGraph Durable Execution。对本仓库的判断均以本地设计与源码为依据。
