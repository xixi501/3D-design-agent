# 演境 ActiScape

面向普通用户的室内场景设计 Agent 项目，以 house-plan-designer 为基础开展重构与扩展。

计划体验：户型图或文字需求 → 可编辑三维房间 → 对话或手动调整 → 上传自有物品照片并导入模型 → 漫游查看 → 保存与继续修改。

当前仓库完成协作初始化，产品功能处于后续开发阶段。首版聚焦住宅客餐厅。

`dev/assets` 已增加成员二的独立资产服务初版：支持图片任务、GLB 持久化、三维预览，以及本机 demo 和学校 GPU 服务器 Hunyuan3D 两种明确区分的模式。首个真实花瓶已生成并完成外观初验。运行与交接见 [资产服务说明](apps/asset-service/README.md)，实施计划见 [成员二计划](docs/member2-plan.md)，实际进度与限制见 [成员二进度](docs/member2-progress.md)，当前部署见 [成员二部署](docs/member2-deployment.md)。

## 四条长期分支

| 分支 | 负责人 | 用途 |
| --- | --- | --- |
| `main` | 主系统负责人汇总 | 集成和阶段交付，接收经检查的开发分支 PR |
| `dev/core` | 成员一（主开发者） | 主前端、场景编辑、工作台、Agent 编排、检查与双层 harness、最终集成 |
| `dev/assets` | 成员二 | 外部资产生成与整理，优先实现单件照片转可用 GLB |
| `dev/skills-deploy` | 成员三 | Skill 提取、收集与适配、版本维护、AgentArts 接入及阶段性部署 |

每个人在自己的电脑或服务器上开发；通过 Git 同步代码，通过说明和调用样例交接模块。

## 开始开发

```bash
git clone https://github.com/xixi501/3D-design-agent.git
cd 3D-design-agent
git fetch origin
```

按负责人选择一条分支：

```bash
# 成员一
git switch --track origin/dev/core

# 成员二
git switch --track origin/dev/assets

# 成员三
git switch --track origin/dev/skills-deploy
```

以上三个切换命令按自己的身份选择一个执行。已有本地分支时直接使用 `git switch 分支名`。

提交、同步与合并步骤见 [协作说明](CONTRIBUTING.md)。

## 模块交接

- 成员二交付独立可运行或可调用的资产模块、模型样例与接入说明；成员一完成模型入场和场景编辑集成。
- 成员三交付带来源、依赖、示例和版本的 Skill，以及可复现的阶段部署；成员一提供业务工具与固定应用版本。
- 模块内部框架、目录及实现方案由负责人决定。准备接入时对齐必要的输入输出、依赖和版本，不要求所有人使用同一服务器。
- 每位负责人交付运行或调用方法、验证结果、已知限制；未实现和模拟能力应明确标记。

## 主要参考

- [house-plan-designer](https://github.com/ZWD11/house-plan-designer)：室内场景与编辑器基础。
- [Hunyuan3D-2](https://github.com/Tencent-Hunyuan/Hunyuan3D-2)：图像到三维资产。
- [SceneSmith](https://github.com/nepfaff/scenesmith)：参考资产生成与整理实现。
- [AgentArts SDK](https://github.com/huaweicloud/agentarts-sdk-python)：平台运行与部署。

复用第三方代码时保留来源和相应许可。参考项目不是本仓库已完成的能力。
