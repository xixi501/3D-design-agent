# 演境 ActiScape 交接：在现有服务器验证视觉模型 API 替换

交接快照：2026 年 11 月 14 日，北京时间。供第一次接触本项目的执行 Agent 使用。

## 先确认你要做的事

你和写这份交接的 Agent 在同一台服务器上。**先在现有浙江服务器验证：能否通过一个外部模型 API，替换项目原来本地运行的 `Qwen3-VL-32B-Instruct-FP8`。** 本轮验证对象是户型图流程中的**已有家具识别与分组**。请先读完本文、复查现场，然后和用户讨论候选 API 和模型。本文不预设提供商、模型、端点或密钥。团队现有的通用模型也可以参加，只要对应的 API 能接收实际图片并返回业务需要的结果。

本轮完成条件是交付可复跑的实验、候选模型的实测证据、通过或未通过的判断，以及将来接入所需的改动。当前工作台作为共享演示环境保留，用独立进程和目录做实验。北京容器迁移、AgentArts 正式部署、主 Agent 模型切换、成员 2 接入是后续工作。

## 项目在哪里，运行的是什么

| 项目 | 交接时核对结果 |
| --- | --- |
| 正式项目 | **`/workspace/3D-design-agent`**。另一个工作目录 `/workspace/scenesmith_repro` 是参考项目，切到正式项目再操作。 |
| 当前分支 | **`feat/floorplan-auto-completion`**，HEAD `754f02e93c8c2336eb10b0f4f03b4f44a09946fa`。该提交是汇报和验收文档，最近业务代码提交为 `a6f66c5fa65f3b3a064d1c148849989eed6039b0`。 |
| Git 状态 | 交接时相对本机 `origin/dev/core` 引用领先 21 个提交，无已跟踪文件改动，`docs/` 有其他人的未跟踪审计和汇报材料。直接从远端默认分支拉取会拿到不同基线。实验从上述 HEAD 读取，避免重置、清理或覆盖现有工作区。 |
| 运行环境 | Python 3.13.13，项目解释器 `/workspace/3D-design-agent/.venv/bin/python`。Node.js 24.22.2 在 `/workspace/.actiscape-tools/node-v24.22.2-linux-x64/bin/node`；纯模型探针使用 Python 即可。 |
| 浙江工作台 | `127.0.0.1:3131`，`/api/health` 返回 `ok: true`。演示项目 ID `474baa8b-9f54-441f-b7d2-8ef9de555ed3`，实验使用隔离数据目录。 |
| 浙江 Agent | `127.0.0.1:3132`；直接 `/health` 与工作台代理的 `/api/agent/health` 均返回成功。健康接口报告运行提交 `a6f66c5…`，主模型 `deepseek-flash`、`modelConfigured: true`。该字段只说明密钥有配置。 |
| 旧视觉服务 | Agent 仍配置 `http://127.0.0.1:3003/v1` 和 `Qwen/Qwen3-VL-32B-Instruct-FP8`，但本次复查 `visionAvailable: false`，直连 `/v1/models` 得到 `Connection refused`。接手时复查。当前服务器 GPU 为 RTX PRO 6000 Blackwell，交接时已有显存占用，不假定能为旧服务腾出空间。 |
| 北京服务器 | 学校容器有 V100 32 GiB，持久化挂载点 `/workspace/actiscape-data` 只在北京容器可用。用户已说明北京不能访问浙江这台视觉服务。原 32B FP8 配置无法直接搬到这张 V100，实测历史中仅权重就约占 33.5 GiB。本轮目录与执行都在浙江。 |

接手后可先做以下低成本检查。`3003` 的预期现状是可能连接失败，仍可继续准备候选实验。

```bash
cd /workspace/3D-design-agent
git status -sb
git log -1 --oneline
.venv/bin/python --version
curl --noproxy '*' --max-time 3 -fsS http://127.0.0.1:3131/api/health
curl --noproxy '*' --max-time 3 -fsS http://127.0.0.1:3131/api/agent/health
curl --noproxy '*' --max-time 3 -fsS http://127.0.0.1:3003/v1/models
```

## 先理解项目，再理解这次替换点

演境是一个室内设计工作台。用户用文字描述需求、上传户型图，或在现有场景上交互，得到可编辑、可保存、可重新打开的二维／三维室内场景。项目分三块：

1. **主系统**。`apps/editor` 是工作台，`apps/service` 是 Node 场景服务，`packages/scene-core` 是共享几何和规则层。`apps/agent` 是 Python 服务。`policy.py` 以代码分流文字生成、户型图重建、对话编辑、简单交互和照片资产放置。`workflow.py` 用 LangGraph 串联需求理解、资产选择、设计、检查等按需调用的角色。场景服务持有项目版本和正式写入权，负责候选、几何检查和提交。任务、事件及检查点落在 SQLite，可追踪并恢复部分中断。本地工作台及场景编辑已有验收记录；九种矩形房间文字生成已有固定样例自测。任意真实户型图自动重建仍有局限。
2. **成员 2 的照片生成 3D**。独立的 Hunyuan3D 资产服务，负责照片到 GLB、任务查询、下载和尺寸校准。已有学校侧部署记录，本机 `origin/dev/assets` 指向 `b781088`，可用 `git show origin/dev/assets:docs/member2-deployment.md` 阅读。主系统有照片资产放置路径和资产客户端，远端最新版尚未完成主系统联调。其 GPU 推理和本次户型识图是两件事。
3. **成员 3 的 Skill 池与平台适配**。按任务与阶段选择知识并冻结任务快照。目前 33 个 Skill，17 个启用且验证过，16 个预留。仓库有 AgentArts 运行时打包和本地等效验证。正式云端部署、场景服务回连和真实模型调用仍需后续验证。

### 三条看起来都和视觉有关的链路

| 链路 | 代码位置与责任 |
| --- | --- |
| 本轮要替换的家具识别模型 | `apps/agent/actiscape_agent/floorplan_v3.py` 的 `recognize_furniture_activity` 和 `_vision_structured_call`。代码先提取几何候选，模型根据原图与标注给候选分配类别、房间和活动组；现有代码校验引用并从候选组装位置、尺寸等几何。`floorplan_v4_2.py` 沿用 V4 家具提示词与 `geometry-only` 候选规则。 |
| 主 Agent 的看图任务 | 户型结构识别、证据审查，以及部分生成或复杂编辑的截图审查通过主模型链路发图，入口见 `roles.py`、`model.py` 和 `workflow.py`。手动编辑和部分精确操作走确定性检查。换家具模型不会替这条链路完成验证。 |
| 像素候选工具 | `floorplan_upstream.py` 和 `floorplan_vision/` 的 provider registry 用于提取并验证图像几何证据。`GET /api/agent/vision/providers` 列出的是这类工具，不是云模型列表。无需为候选 API 在这个 registry 注册条目。 |

本项目对户型导入有多个版本。能力矩阵把 V3-6-1 的验证范围限制为两张冻结客餐厅户型图；V4-2 是实验性的全屋流程。下面的实验用公开一居室固定客餐厅区域隔离家具语义判断。通过只说明替代 API 值得进入下一阶段，不能算全屋或完整户型导入验收。

## 执行步骤

### 1. 先和用户定候选 API

先完成上面的现场复查，再和用户确认本轮实际使用的 API、模型 ID 和已有授权。从服务商文档核实图像输入、单请求可用图片数、大小限制和结构化输出形式。密钥从授权配置取得，用环境变量注入，不打印进终端输出或报告。此时可以同时准备固定实验输入；模型未定或缺少密钥时，如实交付准备进度。

现有家具客户端读取 `ACTISCAPE_VISION_BASE_URL`、`ACTISCAPE_VISION_MODEL`、`ACTISCAPE_VISION_API_KEY`；`ACTISCAPE_VISION_PROVIDER` 是来源记录标签。`BASE_URL` 填 API 根地址，代码追加 `/chat/completions`。默认用 Bearer 鉴权，以及 `image_url` 携带 PNG Base64 Data URL，非流式读取 `choices[0].message.content`。健康探测另用 `GET /models` 匹配模型 ID，不能拿它代替实际图片请求。

### 2. 准备同输入实验

1. 在浙江创建独立实验目录，例如 `/workspace/actiscape-vision-api-eval`，记录 `git rev-parse HEAD`。以 [现有家具探针](../scripts/vision-furniture-probe.py) 为起点，把实验适配放到该目录，复用项目 `.venv/bin/python` 和仓库代码。旧探针的默认候选策略和标注图回退与当前链路有差异，不能直接把未改的探针结果当作当前协议验证。
2. 从 `fixtures/s2c-real/one-bedroom-system-probe.json` 取得公开一居室图片地址和实验请求。下载原图或从现场找相同副本，用 `one-bedroom.evaluation-manifest.json` 核对原图和参考文件的 SHA-256。找不到同哈希原图就记录素材阻断。`one-bedroom.evaluation-only.json` 只在评分时读取，其内容不进入请求、候选生成或修正提示。
3. 用 `fixtures/s2c-v3-5-replay.json` 的 `r9.draft.data` 作为已有结构快照，只保留 `walls`、`openings`、`rooms`、`targetRoomIds`、`uncertainties` 等本次需要的结构信息，去掉已有的家具、类别、分组和历史模型输出。固定目标客餐厅。结构阶段在本实验中被隔离，避免主 Agent 或墙体识别失败影响家具模型对比。
4. 用项目 Python 以子进程执行 `apps/agent/actiscape_agent/floorplan_upstream.py`。标准输入传 JSON，字段为 `mode`、`adapterVersion: "hpd-adapter-6-1"`、`image`（原图字节的 Base64，不带 Data URL 前缀）、`parameters`。`analyze` 用空参数，从输出 JSON 的 `files["candidates.png"].data` 解码标注图。`contours` 传 `parameters.spec=固定结构` 和 `parameters.policyVersion="geometry-only"`，同样解码 `objects.png` 与 `groups.png`，并取返回的对象和活动组候选。模型取图顺序固定为**原图、`candidates.png`、`objects.png`、`groups.png`**。保存四张图、结构输入和候选数据的哈希，记录目标房间与可选对象、分组数量。出现空候选、标签图 ID 对不上或漏了参考中清晰可见的家具时，先判断是否是候选工具自身的问题。
5. 对照 `recognize_furniture_activity` 构造相同字段，使用 V4 `VISION_ACTIVITY`、`FurnitureActivityRecognition` 和 `_assemble_activity_symbols`。应用生产请求的数量约束：每个可选对象、每个活动组都要处理，且不能把可选对象塞进 `excludedObjectCandidates`。以同一份固定输入比较模型。若切到非严格 JSON，仍应本地核验相同数量约束、ID 唯一性、候选房间归属和组成员覆盖；继续使用项目已有 schema 和组装器，不绕过几何检查。探针的手工结构快照和生产流程的前序步骤在报告里明确区分。

### 3. 验证接口，再测业务结果

1. **旧模型对照**：若执行时 `3003` 已恢复且返回预期模型，用固定输入独立跑两轮，作为现场同输入基线。若仍离线，继续候选 API；把仓内历史对照标成历史结果，并注明版本及输入差异。历史结果可查 `docs/evidence/s2c-v3-5-vision/qwen3-vl-v35-required-offline-report.json`。同输入对照缺失不会阻止候选达到绝对验收门槛，但报告不能给出现场 A/B 或性能提升结论。旧模型离线时不为本轮自动重启 GPU 服务。
2. **候选 API 冒烟**：从浙江发一个单图请求，确认当前主机的连通性、鉴权、图片传递和返回格式。随后发完整四图请求，优先沿用当前严格 `response_format=json_schema`。如果文档或错误证实只支持普通 JSON，再在实验副本适配为 `json_object` 并在提示词中说明字段要求，同时保留所有本地校验。在报告区分严格 schema、普通 JSON、以及服务端接受字段但未执行严格约束三种情况。`/models` 失败但真实调用成功时，单独注明健康探测待适配。
3. **候选 API 正式实验**：对同一个候选模型、同一个已确认的请求模式跑两轮独立请求，每轮独立输出目录。记录首回结果，沿用生产流程的一次格式／引用纠错机会，记录纠错结果；不人工改模型输出。明确是网络/鉴权、请求被拒、响应结构、候选本身或家具语义错误。候选不通过则把失败对象和原因带给用户，共同决定是否换另一个 API。

## 验收和交付

- **门槛**：同一候选两轮都通过业务校验，并且零人工修正。沿用 `vision-furniture-probe.py` 的 `score.passed`，一居室案例类别精确率和召回率各至少 **0.90**，识别 **13 件家具，其中 6 把椅子**，并通过现有位置、尺寸和朝向门槛。探针现有的位置和朝向门槛分别是中心偏差不超过 150 mm、朝向偏差不超过 10°，宽深误差各不超过 100 mm 与参考尺寸 15% 中较大者。若当前候选生成本身不能支撑门槛，保留失败证据，不删参考对象或降低阈值来得出模型通过。
- **交付内容**：`README.md`、可运行探针及复跑命令、固定输入哈希清单、每轮脱敏响应和评分 JSON。README 写清楚实际主机、源码提交、旧模型可用性、候选模型 ID、请求模式、是否纠错、错误码、命中和错漏、耗时、调用次数及可取得的用量。记录同输入旧模型对照是否实际完成。资料与脚本不带密钥，公开样例原图只按实验需要存放。
- **结论**：两轮通过且当前接口兼容，写明需要配置的变量；两轮通过但请求或探活不兼容，列出最小客户端适配；未通过则按阻断分类写明最远已完成的步骤和接手需要补充的条件。先交付给用户核对，再排正式环境切换。候选成立后，再从北京用同一 API 和案例复查，之后安排迁移；AgentArts 另行验证运行时出网、主 Agent 的模型路径和场景服务回连。

## 建议阅读顺序

1. [项目进展汇报](reports/20261113-progress/阶段进展汇报.md) 与 [系统架构](ARCHITECTURE.md)，了解产品和已验证范围。
2. [户型流程分派](../apps/agent/actiscape_agent/floorplan_flow.py)、[当前家具识别入口](../apps/agent/actiscape_agent/floorplan_v3.py#L3414)、[独立视觉客户端](../apps/agent/actiscape_agent/vision_client.py)、[家具探针](../scripts/vision-furniture-probe.py)，对应本次执行。
3. [样例及参考说明](../fixtures/s2c-real/README.md)、[户型能力矩阵](../apps/agent/actiscape_agent/capability_registry.py)、[AgentArts 交接记录](AGENTARTS_DEPLOYMENT_DECISION_20261110.md)，了解结果边界和后续安排。`scripts/floorplan-live.mjs` 要求两个真实案例并在完整任务结束后评分，这次独立家具验证使用探针即可。
