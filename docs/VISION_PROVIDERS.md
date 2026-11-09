# 视觉 Provider 边界

视觉 provider 是固定工具进程，不是 Agent。它只把原图转换为像素空间证据，不能选择工作流、读取评估参考、修改 SceneDraft 或提交项目。

## 数据流

```text
image bytes + user scope + provider options
  -> isolated provider subprocess
  -> ArtifactEnvelopeV1
  -> FloorplanVisionArtifactV1
  -> deterministic image_geometry
  -> SceneProgram / SceneDraft v2
```

## Registry

- registry 是仓内静态清单，不支持运行时扫描或热插拔。
- `production` 只允许通过真实候选基准和许可检查的 provider。
- `experimental` 只能用于开发任务。
- `research-only` 必须在隔离目录运行，不能进入正式配置或能力声明。
- 每个 manifest 固定 provider ID、版本、能力、仓库、commit、许可和权重哈希。

## Runner

- runner 使用子进程，不把 provider 直接加载进 Agent 进程。
- 输入只允许图片、用户 scope、适配器版本和 provider 选项。
- 输出必须是可哈希 artifact；模型调用和 adapter 调用分别记账。
- provider 失败返回明确错误，不自动切换到另一个 provider。
- 运行环境移除业务密钥，并禁止访问 `fixtures/full-home-candidates` 和 `fixtures/s2c-real`。

## 当前状态

当前 registry 只有 `hpd-adapter-6-1`，状态为 `experimental`。它只声明墙、门窗和尺寸候选能力，不声明房间或家具对象能力。

只读入口：

```text
GET /api/agent/vision/providers
GET /api/agent/capabilities
```

新增 provider 必须先通过候选覆盖率、重复率、歧义率、许可和失败恢复基准，再由明确提交加入 production registry。
