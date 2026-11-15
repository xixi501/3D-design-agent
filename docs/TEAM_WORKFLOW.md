# 团队工作说明（2026-11-15 起）

本文件描述**当前部署形态与协作方式**。历史验收文档见 `docs/ACCEPTANCE.md`、`docs/S2C_FULL_ACCEPTANCE*` 等。

## 1. 端口（已统一）

| 用途 | 端口 | 备注 |
|---|---|---|
| 编辑器 + 场景服务 | **3131** | 平台公网转发指向这个端口；平台侧需容器内监听 0.0.0.0 才能被转发访问 |
| Agent 服务 | **3132** | 由场景服务代理，一般不直接对外 |
| 资产服务（Hunyuan3D） | **3133** | 常驻显存约 19.9 GiB |

- 所有脚本的默认地址已改为上述端口（可用 `ACTISCAPE_URL` / `ACTISCAPE_SCENE_URL` / `ASSET_SERVICE_URL` 覆盖）。
- 旧的 3001 / 3002 / 3003 不再使用；`8010` 已废弃。

## 2. 分支与工作区

服务端（`/workspace/actiscape-data/`）用 `git worktree` 让一个仓库对应多个目录：

| 目录 | 分支 | 用途 |
|---|---|---|
| `3D-design-agent/` | `dev/core` | 主干开发；共享实例默认从这里启动 |
| `3D-design-agent-stable/` | `main` | 稳定版，对外演示用 |
| `3D-design-agent-assets/` | `dev/assets` | 成员二 |
| `3D-design-agent-skills/` | `dev/skills-deploy` | 成员三（**未合并进 main**，见第 6 节） |

四个目录共用一份 `.env` 和一份数据目录（`ACTISCAPE_DATA_DIR` 指向绝对路径 `.../3D-design-agent/data`），`node_modules` / `.venv` 软链到主目录，避免重复安装。

## 3. 日常流程

```bash
# 开工前同步基线（很重要，别再落后 205 个提交）
git merge origin/main

# 改完
git add -A
git commit -m "feat(xxx): ..."
git push origin dev/<你的分支>

# 想看效果：把共享实例指到你的目录（3 秒，全员可见）
bash /workspace/actiscape-data/start-stack.sh assets

# 随时看现在跑的是什么
bash /workspace/actiscape-data/status.sh
```

合并走 GitHub PR：`dev/<分支>` → `main`。PR 页面会直接告诉你能否合并、有没有冲突。

## 4. 共享实例

- 只有一套服务在跑，谁都可以重启：`start-stack.sh core|stable|assets|skills`
- 重启会自动备份数据库到 `logs/projects.sqlite.bak`，并把「目录/分支/提交/谁重启」写入 `logs/stack-status.json`
- `status.sh` 汇总：分支、提交、未提交文件数、实例归属、三个端口健康、GPU 占用

## 5. 新容器恢复

容器是**从镜像重建**的，系统包不保留。新容器只需：

```bash
bash /workspace/actiscape-data/bootstrap.sh
```

它会装系统依赖、校验 venv/权重/CUDA 扩展、重启服务并做健康检查（全新容器约 2–3 分钟）。数据、权重、代码都在持久盘，不会丢。

## 6. 已知状态与红线

1. **`dev/skills-deploy` 未合并进 `main`**：`npm run test:skill-pool:v1` 在该分支上会因 `entry-storage/ENT-dev-01` 的 `OPENABLE_FRONT_BLOCKED`（换鞋凳距鞋柜仅 200 mm，需 450 mm）失败。该用例数据在 `apps/agent/actiscape_agent/skills/`，主线的同名用例已修（净空 470 mm），分支需要基于新 main 重新核对。
2. **禁止提交大文件**：GitHub 单文件上限 100 MB。`core.*` 已加入 `.gitignore`，启动脚本也已 `ulimit -c 0`。若再出现 `pre-receive hook declined`，先查 `git show --stat HEAD` 里有没有超大文件。
3. **数据目录共享**：同一份 `data/`，不要同时跑两个实例写库；切换分支重启前 `start-stack.sh` 会自动备份。
4. **平台公网转发**：只有服务监听 `0.0.0.0` 时才能被 `http://aic.bnu.edu.cn/aiforward…` 访问；当前 `.env` 是 `HOST=127.0.0.1`（更安全），请用 SSH 隧道：
   ```bash
   ssh -L 3131:localhost:3131 bnu-3dd
   ```
5. **容器 IP 会变**：重建后问账号主要新 IP，改本地 `~/.ssh/config` 的 `HostName`。

## 7. 常见问题

**`git fetch --all` 看不到别人分支**：本仓库是单分支克隆，需要：

```bash
git config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'
git fetch --all
```

**`npm run test:skill-pool:v1` 报 `ECONNREFUSED 127.0.0.1:3001`**：该脚本不读 `.env`，显式传地址：

```bash
ACTISCAPE_SCENE_URL=http://127.0.0.1:3131 npm run test:skill-pool:v1
```

**测试跑出一堆 `core.*`**：已通过 `ulimit -c 0` 和 `.gitignore` 处理；若历史遗留，直接删。