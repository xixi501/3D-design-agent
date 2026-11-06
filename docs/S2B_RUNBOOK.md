# S2-B 文字生成与恢复

产品目录 `/workspace/3D-design-agent`，开发分支 `dev/core`。继续使用现有 Node 24、Python 3.13、Chrome 和服务端 DeepSeek 配置；安装与统一启动见 [S2-A 运行说明](S2A_RUNBOOK.md)。

```bash
npm ci
npm run setup:agent
npm run build
npm run start:all
```

## 在工作台生成房间

1. 打开工作台，点击“新建”，进入空白项目的生成对话。
2. 描述单个矩形客餐厅或阅读会客间。提供横向室内净宽、纵向净深、入口所在墙面和位置，以及是否有窗和窗的位置。
3. 缺少信息时，助手一起询问，需求摘要卡列出待补充项。直接在同一对话补充或纠正。
4. 信息完整后，尺寸与门窗固定，四角色生成并检查。检查通过自动保存；失败时保留问题和候选，不声称已保存。
5. 成功后继续局部编辑。一次生成是一个事务，撤销恢复为空白，重做恢复整套方案。

完整描述示例：

> 生成一个矩形客餐厅，室内横向净宽6米、纵向净深4米。入口在南墙，门洞左边距西侧内墙400毫米；北墙窗居中。三人沙发、茶几、电视柜、餐桌各一个，餐椅四把、落地灯一盏。采用简约中性配色，家具使用目录默认尺寸，门窗宽高与层高使用默认值。

位置按二维视图：北／上、东／右、南／下、西／左。水平门窗偏移自左侧内墙量，竖直偏移自上侧内墙量，距离表示开口起点。`居中` 可以直接确定位置；只有“靠左”等描述时还需补充距离。没有窗请明确说“没有窗”。

所有尺寸由代码从 mm/cm/m 换算。默认层高 2800 mm、墙厚 200 mm；门宽 900 mm、离地 0、顶高 2100 mm；窗宽 1500 mm、离地 900 mm、顶高 2400 mm。净尺寸在摘要卡及候选结果中明确记录，二维外围尺寸线沿用编辑器的墙中线标注。

初始家具使用目录默认尺寸，防止为塞进房间而偷偷缩小。生成后可通过已有局部编辑明确修改尺寸。门内侧 800 mm 净空是本项目的布局规则，不等同于完整通路或建筑规范检查。

## 模型验收命令

```bash
npm test
npm run test:agent
npm run test:initialization
npm run tools:generation-demo
npm run tools:generation-demo -- --living
npm run test:generation:live
```

`tools:generation-demo` 和 `test:generation:live` 使用真实官方模型并消耗额度。每次正式矩阵生成独立结果目录，保存全部成功和失败；不覆盖旧批次。`test:initialization` 使用真实 HTTP 和 WebGL、显式 operator 检查，不调用模型。

真实浏览器验收分为服务重启前后两个阶段：

```bash
npm run test:generation:browser
# 第一阶段成功后，完整停止项目与 Agent 服务，确认进程退出，再重新 npm run start:all。
npm run test:generation:browser -- --after-restart
```

第一阶段通过实际“新建”和对话输入验证缺失信息、同任务补充、刷新恢复、生成、SSE 与撤销/重做。第二阶段重新打开同一会话，使用“它”修改阅读座位，再验证跨重启历史。两个阶段都通过普通入口，无需 debug 全局变量。

原 S2-A 六类模型流程可独立复验：

```bash
ACTISCAPE_ACCEPTANCE_REPEATS=1 ACTISCAPE_ACCEPTANCE_OUT=test-results/s2b-edit-regression npm run test:agent:live
```

## Skill 与任务状态

首个 Skill 位于 Agent 包内的 `skills/rectangular-living-reading/`，包含 manifest、设计正文和 MIT 许可。来源是固定上游 HouseSpec 格式及本项目布局规则。角色实际读取正文，所需工具须已注册。

每个任务持久保存模式、需求、原文依据、默认值、冻结结构与 Skill 正文快照。结果记录 Skill 身份、版本和内容哈希；任务恢复使用原快照。它是文件设计指导，不提供任意脚本或正式场景写权限。

任务预算仍是 24 次模型请求、10 分钟活动时间和初稿后最多三轮修复。等待补充不计活动时间。结构化结果校正、超时与限流重试均计入预算。资产选择每项需求返回一个配方，数量四把椅子不展开成四条资产选择。

已有正式项目不允许文字初始化。生成过程中出现手工修改会校验版本；项目已非空则停止，不能覆盖。提交响应不明时仍用原候选、原 operationId 确认，不重新创建一套场景。

## 数据升级、备份与回退

Node 项目数据库迁移版本为 2，Agent 任务数据库版本为 1；正式项目 JSON 格式仍为 1。旧候选不重算哈希，旧请求默认 edit 并保留原去重语义，旧项目与历史不清空。

完整备份须等待 Node、Agent 及其检查点连接真正关闭。端口关闭可能早于 SQLite 完成退出；确认进程已退出后，复制整个数据目录，包括 WAL/SHM、资产、图片、任务和检查点。恢复步骤见 [原运行说明](S2A_RUNBOOK.md)。回退使用升级前备份及对应代码，不能用旧版程序直接打开升级后的数据库。

验收脚本可指定生成项目进行完整副本恢复：

```bash
# 源 Node 与 Agent 均已停止，且没有 queued/running/committing 任务。
node --import tsx scripts/backup-acceptance.mjs 实际生成项目ID
```

本轮仍为单用户可信开发环境。户型图、照片服务、正式 Skill 池、GEPA 和 AgentArts 全链路属于后续阶段。
