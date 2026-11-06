# 原版读图工具适配与验证

产品 `dev/core`，固定来源为 `ZWD11/house-plan-designer@b94183f9ce2215db9a178da89a90d2ecefb18497`，MIT。新增工具原样保存于 `apps/agent/actiscape_agent/vendor/house_plan_designer`，逐文件哈希在其 `provenance.json`，不改动原 S0 的 `reference/upstream`。每次辅助进程执行前验证哈希，工具响应保留来源版本、适配版本、参数、原图哈希和证据文件哈希。

## 角色与执行边界

| 角色     | 真实工具                                                                                                         | 工作及权限                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 主控     | `analyze_floorplan` → `analyze.py`；原图与最多四次裁剪                                                           | 读像素墙段、断口、尺寸刻度、编号分析图和掩膜，整理房间与家具语义；未取得分析证据不能推进 |
| 空间设计 | `fit_wall_faces` → `wallfit.py`；`measure_dimension_chain` → `axismap.py`；`preview_floorplan` → TypeScript 核心 | 实测墙面、中线和厚度，核对标注及基准，接收结构错误；不能虚构刻度或为通过检查改数字       |
| 资产     | 原有批量目录查询                                                                                                 | 按图中家具选择真实配方；无几何校正和正式写入工具                                         |
| 检查     | `audit_floorplan_source` → `wallaudit.py`＋`furnoverlay.py`；原有候选检查与三维视图                              | 独立核对墙体、门窗和家具占地／朝向；未读取当前草稿哈希的对账不得通过                     |

正式几何、统一比例、房间拓扑与门窗归属仍由 TypeScript 编译；正式写入仍由固定候选提交节点执行。上游 `check.mjs` 依赖旧编辑器的浏览器全局，没有整块搬入；其结构核对职责由现有 TypeScript 预检和候选检查承接。四角色没有通用脚本、文件路径或正式项目 HTTP 写入工具。

主控初读后，空间设计必须实际测墙、核对已有尺寸并预检，结果及每次失败持久保存。首次测量之后最多修复三轮，与后续家具候选修复共用 `repairsUsed`，重启不重置。所有角色继续共享 24 次模型请求／600 秒活动时间，确认等待暂停计时。旧任务使用已固定的 Skill 快照；新任务固定 `floorplan-reconstruction@0.2.0` 内容和哈希。局部编辑及矩形文字生成流程保持原范围。

`analyze.py` 在没有真实比例时以 1 为占位运行，仅返回像素字段，不采用其毫米草稿和承重推测。灰度阈值、颜色容差及有真实比例后的描边检测可有界调整，记录实际参数；默认颜色容差 80，适用于深色彩墙，不含单图坐标补丁。尺寸刻度、墙段、断口仍可能漏检或误检。

`axismap.py` 返回标注尺寸链的诊断坐标和局部比例差异；本轮没有将其分段拉伸移入正式场景。正式场景继续采用既定的统一比例、3% 比例差异和明确尺寸 1 mm 约束。图像量化或尺寸基准不清会继续阻断，不能仅为得到画面而绕开。墙体对账也属启发式证据；零差异不证明无漏墙、无漏家具，误报须说明。

## API、文件与恢复

- `POST /api/floorplan-images/:image/tools/analyze`：`{grayMax?,satMax?,outlined?,mmPerPixel?}`，返回原版像素候选和 `analysis.png`、`mask.png`。
- `POST .../tools/fit`：`{walls:[{id,kind:"H"|"V",c,p0,p1,skip?,search?}]}`，每次 1–20 段，返回墙面、中心、厚度及采样数。
- `POST .../tools/axis`：`{ticks,distances,samples?,basis,evidence}`，距离为真实相邻标注的毫米值，刻度为严格递增原图像素，返回尺寸链诊断。
- `POST /api/projects/:id/floorplan-preflight`：`{imageId,data}`，未持久草稿的只读 TypeScript 编译；返回错误字段，不更改项目、草稿、历史。
- `POST /api/projects/:id/floorplan-drafts/:draft/source-audit`：按服务端编译几何序列化只读 HouseSpec，运行原版对账和家具叠图；调用方不能提交任意文件路径或替代几何。
- `GET /api/floorplan-images/:image/tools/:toolId/files/:name`：读取经过哈希验证的 PNG。工具记录及 PNG 保存在 `data/floorplan-images/<image>/tools/<hash>/`，随整个停服数据目录备份恢复。

工具结果缓存身份覆盖原图哈希、参数、上游来源、适配版本和（对账时）草稿哈希；修改草稿会取得不同证据。文件缺失、损坏、越界或非法参数明确失败。任务 `generation.upstreamTools` 与 `floorplan_tool_result` 事件保存角色、工具和完整证据引用。工作台“识别与测量证据”显示最新角色结果与原图核对图，失败任务也可查看已有证据。

## 验证状态

工程检查已完成：Node 27/27、Python 42/42、类型检查、构建、原版哈希检查通过。新增 Node 测试真实执行原版像素脚本，验证墙面测量、尺寸链冲突、预检字段、原图对账、文件完整性、持久重开和不改变项目／草稿／历史；Python 受控测试验证角色调用门槛及跨重启共享三轮修复。受控测试不证明自动识别质量。

接入前同图两次真实 DeepSeek 试验为 0/2 编译通过，均识别出三个房间标签，但尺寸基准混用；另有错墙和漏餐椅。正式项目保持 revision 0，未确认、未补几何。源图固定为 [FloorPlan Creator 一居室示例](https://floorplancreator.io/floor-plan-templates/one-bedroom-apartment)，PNG SHA-256 `7ffeba5739402634c8744d723125c134e722d794f55ebd5140246b76681841aa`。原图仅用于本机内部评估，不主张其可再分发许可。

接入后真实同图对照待运行。真实识别与完整 S2 保持待验收；不能用脚本已接入、编译成功或开发者人工稿代替图像保真门槛。原图、首次输出、模型与工具记录、所有失败、修复和未提交项目保留在本机 `test-results/floorplan-system-eval-20261106/`。
