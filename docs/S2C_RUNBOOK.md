# S2-C 户型图草稿、确认与恢复

图片处理默认复用 Agent 虚拟环境，也可通过 `ACTISCAPE_IMAGE_PYTHON` 指定独立环境。`npm test` 会检查锁定的图片依赖；仅在缺失时准备虚拟环境，不修改系统 Python。Node CI 的独立图片辅助环境支持 Python 3.12+，完整 Agent 环境及 Agent CI 继续固定 Python 3.13。

产品目录 `/workspace/3D-design-agent`，分支 `dev/core`。继续使用 Node 24、Python 3.13、现有 DeepSeek 官方 API 服务端配置和 Chrome。安装：`npm ci && npm run setup:agent`；构建：`npm run build`；统一启动：`npm run start:all`。SceneSmith 环境独立保留。

## 使用

1. 新建空白项目，进入对话面板，点击“上传户型图复现客餐厅”。支持清晰单层正交 PNG/JPEG，最多 20 MB、2500 万像素；保留原图、EXIF 校正后的像素空间、处理图和局部裁剪。
2. 识别结束后打开“核对户型草稿”。检查整层墙体与门窗、每个封闭房间的标签、目标客餐厅和全部目标家具。图层与透明度可单独调整；家具、开口、房间标签及墙线可以拖动，属性表可精确修改像素参数。
3. 确认图中标注的含义；缺少比例时选择两点，输入实际毫米距离，并指定室内净尺寸／墙中线／外轮廓。采用统一比例，不能通过门宽、目录家具、面积或 DPI 猜测。不同可靠标注比例差异超过 3% 必须处理；数值约束仍有超过 1 mm 的差异时也需校正标定端点。
4. 处理全部阻断不确定项。默认层高 2800 mm；未注明墙厚 200 mm；普通门顶 2100 mm，窗台 900 mm、窗顶 2400 mm。门窗宽度、位置及家具占地来自确认稿，不用默认尺寸覆盖。
5. 点击“确认结构与原图布局”。资产角色选择真实目录，设计角色核对符号匹配，代码按确认稿固定位置、尺寸和朝向，检查角色结合原图、叠加图及真实俯视／斜视图审核。通过后结构、家具与来源作为一个事务保存。
6. 成功后继续选择家具进行局部对话编辑；一次撤销可回到空白，重做恢复整个方案。二维工具栏可显示来源原图；已完成任务的草稿查看为只读。

这里只复现选定客餐厅家具。其他房间的墙体、门窗与标签保留。识别阶段不提供目录 key；目录匹配交给资产角色。设计角色读取已选目录的实际元数据，不能改写资产角色逐符号的匹配；匹配需要修复时返回资产角色，仍计入同一任务总修复上限。未识别或无法匹配的目标对象不能静默删除，原图有冲突时也不能自行移动、缩小或减少家具。

## API 与数据

`/api/floorplan-images` 是独立图片命名空间，不能用 GLB 上传接口代替。`POST` 使用单文件 multipart；返回稳定原图身份、原始 SHA-256、处理图 SHA-256、EXIF 后尺寸、归一化变换及像素线候选。`GET /:image/file` 读处理 PNG，`?variant=original` 读原始文件。裁剪入口为 `POST /:image/crops`，请求 `{"box":[x0,y0,x1,y1]}`；返回文件路径、校验值和 `cropToPixel`。小裁剪有限放大，坐标始终按显式变换映回原图；每任务最多四次裁剪尝试。

项目下 `/api/projects/:id/floorplan-drafts`：

- `POST`：`requestId`、`imageId`、`baseRevision`，可附完整 `data`；缺省创建可填写的空草稿。
- `GET /:draft`、`GET /:draft/revisions`：当前草稿及持久版本。
- `POST /:draft/commands`：`requestId`、`draftRevision`、`commands`；不改变正式项目版本和历史。
- `POST /:draft/preview`：可附 `taskId`；返回确定性结构、目标家具毫米参数、默认值与问题，不写项目。
- `GET /:draft/overlay`：真实原图加当前识别层的 PNG，响应带草稿哈希与图片校验值。
- `POST /:draft/confirm`：工具脚本／显式操作员确认入口。需要 `requestId`、`draftRevision`、`draftHash`。
- `POST /:draft/rebase`：仅将仍为空白的项目重新关联到指定 `baseRevision`，增加草稿版本并使确认失效。

草稿 `data` 包含 `image`、`name`、可选毫米 `height/wallThickness`、`anchors`、`walls`、`openings`、`rooms`、`symbols`、`targetRoomIds` 和 `uncertainties`。墙线、开口偏移／宽度、房间点和符号占地使用 EXIF 校正后的原图像素；开口 `offset` 是沿墙 a→b 的中心距离。家具 `w/d` 是旋转前占地。高度字段为毫米。完整合成示例见 `fixtures/s2c-synthetic.floorplan.json`；它只用于工具验证。

草稿命令只有：

```json
[
  {
    "type": "calibrate",
    "anchors": [
      {
        "a": { "x": 50, "y": 50 },
        "b": { "x": 950, "y": 50 },
        "distance": { "value": 9, "unit": "m" },
        "basis": "centerline",
        "evidence": "用户确认图上9000标注"
      }
    ]
  },
  { "type": "targets", "roomIds": ["living"] },
  { "type": "defaults", "values": { "height": 2800 } },
  {
    "type": "upsert",
    "collection": "uncertainties",
    "object": {
      "id": "unknown-door",
      "message": "用户已核对入口位置",
      "blocking": false
    }
  },
  {
    "type": "delete",
    "collection": "symbols",
    "id": "explicitly-removed-object"
  }
]
```

所有命令按批验证；不合法字段、悬空引用和无效参数使整批拒绝。删除被引用对象时，必须在同一批处理引用。新增／更新／删除对象逐项累计人工校正量；比例标定、目标选择与最终确认不计入五项门槛，批量校正不能伪装成一项。

Agent 创建任务：

```json
{
  "requestId": "unique-task",
  "mode": "reconstruct_floorplan",
  "imageId": "实际上传返回的id",
  "input": "识别整层结构并复现客餐厅原图布局，先供我确认",
  "selectedIds": []
}
```

确认工作台任务使用 `POST /api/agent/tasks/:task/confirm-floorplan`，请求：

```json
{
  "requestId": "unique-confirmation",
  "draftId": "实际草稿id",
  "draftRevision": 0,
  "draftHash": "当前草稿完整哈希"
}
```

候选仍走 `/api/projects/:id/candidates`，新增 `kind:"initialize_floorplan"`，带 `floorplan:{draftId,draftRevision,draftHash}` 和 `matches:[{symbolId,key}]`。不接受另传布局 edits 或 scope；授权由冻结的目标房间和符号自动生成。只有空白项目可初始化。预览、候选、截图和最终提交保持相同业务对象 ID，旧 edit/initialize 请求与哈希不变。

错误包括：`INVALID_FLOORPLAN`、`INVALID_IMAGE`、`FLOORPLAN_NOT_READY`（422）；`DRAFT_CONFLICT`、`REVISION_CONFLICT`、`PROJECT_NOT_EMPTY`（409）；`SOURCE_IMAGE_MISSING/INVALID`、`MISSING_SOURCE_IMAGES`（422）。错误后正式版本和历史不改变。

## 确认、检查与恢复

确认等待使用现有 `waiting_input`，不引入绕过每项目活动任务唯一约束的新状态。识别与生成共用 24 次模型请求／600 秒活动时间；等待暂停计时，重启、重新确认和同任务恢复均不重置预算。初稿之后总共最多三轮修复；布局冲突需要明确校正草稿，不能让角色自行改布局。

模型结构化输出被截断或缺少最终结果时，允许一次保留原工具上下文的续答；续答也占用同一请求数和活动时间预算，不能构造替代结果。DeepSeek 适配器保留工具返回的真正图片数组、工具调用身份及思考模式所需字段。运行记录包含模型返回标识、用量、耗时、结束原因和格式恢复事件。

真实整层样图试验发现，high／low 推理均可能把 32768 Token 全部用于思考，再靠续答才产生草稿。像素识别阶段改为 `thinking.type=disabled`、`max_tokens=32768`、请求超时 180 秒；其他角色保持原推理配置、8192／120 秒。像素家具配方增加与实际图宽高一致的结构化上界，毫米误填会在模型结果工具中拒绝，不会猜测换算或写入项目。每次 `agent_start` 记录实际额度与推理配置，24 次请求／600 秒活动时间的总预算及一次格式续答上限保持不变。输出限额覆盖思考与最终输出，接口含义见 [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/) 和 [思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)。

确认后的任何结构、比例、家具或目标区域修改均产生新草稿版本并撤销确认。提交前再次核对正式版本、草稿哈希、原图、固定候选、确定性检查及两张证据。家具只能位于选中房间；所有符号必须逐项匹配。保留门内侧 800 mm 局部净空规则；它不表示完整通道、支撑面或建筑规范已验证。

Node 的确认记录是恢复依据。确认已持久化、Python 尚未恢复时，任务读取、事件流或服务重启会核对同一确认操作；提交响应丢失则查询／重试同一个候选 operationId。手工使项目非空时停止初始化；仍空但版本变化最多重新关联一次并重新确认。

项目 SQLite 统一增量迁移至版本 3；Agent 沿用原 mode/generation JSON 和独立检查点数据库。旧项目、资产、历史、候选哈希及 edit 任务去重保持兼容。升级前必须完整停服备份；回退时使用旧代码与升级前完整数据副本，不能让旧程序直接打开版本 3。

完整备份包含 `projects.sqlite`、图片与裁剪／叠加图、GLB、候选证据及 `agent` 的任务和检查点 SQLite。等待两个服务进程真正退出后复制整个数据目录。来源保存在项目快照和历史中，不实现自动图片回收。JSON 导出附 `sourceImageManifest`；跨服务器先恢复文件／记录，或上传相同原图并使用 `imageMap` 映射；校验值不同的图片不能冒充原来源。

## 验证入口与边界

- `npm test`：核心、事务、迁移、比例、结构、目标房间、评分与资产异常。
- `npm run test:agent`：真实 LangGraph/SQLite 的受控状态、确认、恢复、取消、预算及协议载荷测试。
- `npm run test:floorplan`：真实浏览器、Node/SQLite、LangGraph、WebGL、原子历史和完整停服备份恢复；模型明确为受控替身。
- `node --import tsx scripts/floorplan-model-smoke.mjs`：DeepSeek 官方 API 的真实工具返回图片与合成图识别协议；仍不计作真实户型图验收。
- `npm run test:floorplan:live -- --manifest ... --stage start`：两张真实图片各两次；暂停等待工作台核对确认。
- `npm run test:floorplan:live -- --stage collect --index ...`：对照冻结人工参考，分别评分首次识别、人工校正量和最终保真。参考不进入识别提示词。缺少输入或确认时返回待验收，不记为通过。

真实图片参考必须给每个目标符号设置目录 key 或允许的目录匹配集合。评分检查正式项目实际实例化的目录类型、实际 Three.js 包围盒和确认稿数据，不能仅凭符号标签认定家具类别正确。启动器在任何模型任务创建前校验两张图片及全部参考；同图重复和已知合成夹具不能充当两张真实图片。

当前按用户要求先试一张真实“92 户型”，不把被替换的早先图片凑作第二个案例。完整 S2 仍需真实两图矩阵及集成复验；平台云端联通、照片生成和 GEPA 分别在成员三并行工作及 S3–S5 验收。
