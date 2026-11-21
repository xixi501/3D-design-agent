# 华为云西南-贵阳一（`cn-southwest-2`）专线中转网关部署指南

## 为什么需要该节点？

学校 GPU 容器（`173.0.61.4`）处于校园网 NAT 内，校外入站必须拨学校 VPN，公有云无法直达。
原先使用的免费第三方 `serveo.net` 存在两大痛点：
1. **双重跨网绕行极慢**：`贵阳 AgentArts ↔ MCP 网关 ↔ 海外 Serveo ↔ 北师大` 单次只读检查回源高达 `7.2 s`（总耗时 `15.8 s`）；
2. **免费隧道不稳定**：随时可能断连、限流或触发防钓鱼中间页，导致 SSE 实时进度流中断。

在与 AgentArts **同地域（西南-贵阳一 `cn-southwest-2`）** 部署一台最小规格云主机（1C2G 耀云/ECS，支持鲲鹏 ARM64 或 x86_64）运行 `frps + Caddy`：
- 校内容器主动出网连接贵阳 `7000` 端口，**免学校 VPN**；
- AgentArts 运行时与 MCP 网关访问场景服务走**华为云同城高速网络**，回源延迟从 `7.2 s` 降至 **`< 50 ms`**；
- Caddy 自动管理 Let's Encrypt HTTPS 证书并开启 `flush_interval -1`，完美支持工作台 SSE 实时流。

---

## 5 分钟切换步骤

### 第 1 步：准备华为云主机
1. 在华为云 **西南-贵阳一** 购买最小规格 Ubuntu 22.04 实例（1 核 2 GB、按需或包月均可，带宽 3–5 Mbps 足够）。
2. 安全组入方向放行 TCP 端口：**`22`**（SSH）、**`80` / `443`**（Web/HTTPS）、**`7000`**（FRP 隧道控制端口）。
   > 切勿对外放行 `13131`（该端口仅在云主机本机 `127.0.0.1` 供 Caddy 反代使用）。

### 第 2 步：在云主机一键安装 `frps + Caddy`
将本目录 `setup-ecs.sh` 拷到云主机执行：

```bash
TOKEN="$(openssl rand -hex 24)"
sudo bash setup-ecs.sh <你的域名或云主机公网IP> "$TOKEN"
```

### 第 3 步：在校内容器切换隧道模式
1. 若容器 `/workspace/actiscape-data/tools/frpc` 尚未放入二进制，下载对应 `frp_0.61.1_linux_amd64` 的 `frpc` 放到 `/workspace/actiscape-data/tools/frpc` 并 `chmod +x`。
2. 在 `/workspace/actiscape-data/3D-design-agent/.env` 中配置：
   ```ini
   TUNNEL_MODE=frp
   FRP_SERVER_ADDR=<云主机公网IP或域名>
   FRP_SERVER_PORT=7000
   FRP_AUTH_TOKEN=<第2步生成的TOKEN>
   PUBLIC_BASE_URL=https://<你的域名>
   ```
3. 重启隧道守护进程并验证：
   ```bash
   bash /workspace/actiscape-data/3D-design-agent/ops/tunnel.sh restart
   bash /workspace/actiscape-data/3D-design-agent/ops/tunnel.sh status
   ```
4. 将华为云 AgentArts 运行时环境变量 `ACTISCAPE_SCENE_URL` 与 MCP 网关 Target 地址同步更新为新的 `PUBLIC_BASE_URL`。

> **无缝回退**：在未配置 `TUNNEL_MODE=frp` 时，`ops/tunnel.sh` 默认继续使用 `serveo` 固定子域，保持现有链路零中断。
