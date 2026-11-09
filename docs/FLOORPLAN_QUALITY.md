# 户型候选质量平面

户型图识别不能把评估参考传给候选工具，也不能用一次模型调用是否成功代替几何正确性。本目录定义生产式评测的最小边界：

```text
image bytes + user scope + adapter version
  -> isolated candidate process
  -> sealed FloorplanVisionArtifactV1
  -> separate scoring process
  -> candidate coverage / duplicate / ambiguity report
```

## 当前实现

- `scripts/quality/run-floorplan-candidate.ts` 只读取原图、用户范围和适配器版本，候选产物先写盘并计算 SHA-256。
- 候选进程通过 `setpriv` 切换到 `nobody`，评估目录临时设为仅 root 可访问，并安装 Python 审计钩子。
- `scripts/quality/score-floorplan-candidates.ts` 在候选进程退出并校验产物哈希后才读取参考。
- `packages/scene-core/src/floorplan-quality.ts` 使用最大基数、最小成本一对一匹配；合并候选不能同时命中两个参考对象。
- `packages/scene-core/src/vision-artifact.ts` 定义严格、版本化、像素空间的 provider 产物，不允许候选直接写毫米场景。
- `apps/agent/actiscape_agent/floorplan_vision/` 提供静态 provider registry、子进程 runner、HPD 包装器和运行时证据守卫；真实 Agent 主链只通过 `ArtifactEnvelopeV1` 接收 provider 结果。

## 命令

```bash
npm run quality:floorplan:batch
npm run test:floorplan:quality
```

单个流程也可以分开运行，确保捕获和评分不是同一进程：

```bash
npm run quality:floorplan:capture -- \
  --image fixtures/full-home-candidates/2bhk-bungalow.jpg \
  --id 2bhk-bungalow \
  --output test-results/floorplan-quality/2bhk-bungalow

npm run quality:floorplan:score -- \
  --capture test-results/floorplan-quality/2bhk-bungalow/capture.json
```

## 指标解释

- 候选池墙覆盖召回至少 `95%` 才允许进入最终选择。
- 门窗和家具使用一对一最大匹配；一个合并框最多算一个参考实例。
- 报告必须同时保留候选数量比、完全等价重复率和歧义参考率。
- 候选召回不是最终验收；最终选择后的墙、门窗和家具 precision/recall 仍需至少 `90%`。
- 当前 HPD 基线失败不阻止架构修复，但不得作为 provider 选型或真实 V4 通过证据。

## 未测量

本批不声称已实现房间区域推导、盲家具候选、类别、活动组、最终选择或场景写入。候选产物中对应能力均为 `false`，评分报告明确标为 `not-measured`。
