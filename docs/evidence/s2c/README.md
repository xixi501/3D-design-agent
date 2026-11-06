# S2-C 证据索引

业务版本：`e0020510445cbe2cfbf78eba45e02d650ede165c`，基线：`afc51eb`。两张真实户型图缺失，`realImageAcceptance:false`，完整 S2 未结项。

| 路径                             | 内容                                                 | 证据边界                                                                             |
| -------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `source-manifest.json`           | 业务源码、工具、锁文件和固定夹具逐文件 SHA-256       | 不包含 `.env`、运行数据库或密钥                                                      |
| `ci-business.json`               | 固定业务版本的远端 CI 状态和运行身份                 | 两个作业成功；不是模型或图片质量评分                                                 |
| `controlled-browser/`            | 报告、原图叠加、编辑器来源图、俯视与斜视             | 真实浏览器／WebGL／LangGraph，模型响应明确受控；上传、校正、提交、历史和独立备份恢复 |
| `protocol-probes/`               | 五轮官方模型图片协议试验，含所有失败                 | 使用明确标记的合成图；最后一次工具图片和识别草稿协议通过，但不声称真实图识别质量     |
| `live-before-fixes/`             | `9285bb6` 的完整文字及局部编辑批次                   | 保留 3/4、5/6 的成功与失败；失败没有正式写入                                         |
| `live-final/text-4/`             | 最终业务版本文字案例各两次                           | 官方 API，4/4；原始任务、轨迹、场景与历史断言                                        |
| `live-final/edit-6/`             | 最终版本六类对话                                     | 官方 API，6/6；多轮引用、歧义等待和恢复                                              |
| `live-final/source-local-edit/`  | 合成来源场景上的两个真实局部编辑及截图               | 初始化受控，后续移动／改色真实；保护全部结构、其他家具及来源                         |
| `live-final/summary.json`        | 请求、时间、Token、角色、版本和格式续答汇总          | 按唯一任务 ID 和事件序号去重；缓存 Token 不等于计费金额                              |
| `original-regression/`           | 最终版本完整原能力回归日志和报告                     | 原版基准、16 个浏览器流程、24 个配方、266 个目录、固定视角                           |
| `wheel.json`                     | 最终业务包 SHA-256 及两个 Skill 的打包文件清单       | wheel 在本机 test-results；不分发凭证或数据                                          |
| `stopped-regression-backup.json` | 真实模型测试服务完整停服后的数据目录复制及逐文件哈希 | 数据副本只留本机；主工作台继续运行；不替代真实图片后的恢复验收                       |
| `evidence-sha256.json`           | 本目录其余证据逐文件哈希                             | 自身不递归列入                                                                       |

模型配置：DeepSeek 官方 API `deepseek-flash`、high thinking；实际服务标识与返回指纹见每个轨迹的 runtime/model_end。提示词 `s2a-local-edit-2`、`s2b-rectangular-2`、`s2c-floorplan-3`，Skill 正文快照和内容哈希随任务固定。协议试验保留它执行时的历史版本，不能把旧探针改写成最终版本的运行。

评分入口与真正的两图门槛见 [真实输入准备](../../../fixtures/s2c-real/README.md)；操作与恢复见 [运行说明](../../S2C_RUNBOOK.md)，整体结论见 [验收报告](../../S2C_ACCEPTANCE.md)。
