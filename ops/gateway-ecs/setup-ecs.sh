#!/usr/bin/env bash
# 一键初始化华为云西南-贵阳一 (cn-southwest-2) 公网中转节点 (frps + Caddy)
# 用法: sudo bash setup-ecs.sh <域名或公网IP> <FRP共享密钥>
set -euo pipefail

PUBLIC_HOST="${1:-}"
FRP_TOKEN="${2:-}"
FRP_VERSION="${FRP_VERSION:-0.61.1}"

if [[ -z "$PUBLIC_HOST" || -z "$FRP_TOKEN" ]]; then
  echo "用法: sudo bash $0 <域名或公网IP> <FRP_AUTH_TOKEN>"
  exit 1
fi

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) FRP_ARCH="amd64" ;;
  aarch64|arm64) FRP_ARCH="arm64" ;;
  *) echo "不支持的架构: $ARCH"; exit 1 ;;
esac

echo "[1/4] 安装基础依赖与 Caddy..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl tar ca-certificates debian-keyring debian-archive-keyring apt-transport-https
if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "[2/4] 安装 frps v${FRP_VERSION} (${FRP_ARCH})..."
if [[ ! -x /usr/local/bin/frps ]]; then
  TMP_DIR="$(mktemp -d)"
  curl -fSL "https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/frp_${FRP_VERSION}_linux_${FRP_ARCH}.tar.gz" -o "$TMP_DIR/frp.tgz"
  tar -xzf "$TMP_DIR/frp.tgz" -C "$TMP_DIR"
  install -m 0755 "$TMP_DIR/frp_${FRP_VERSION}_linux_${FRP_ARCH}/frps" /usr/local/bin/frps
  rm -rf "$TMP_DIR"
fi

echo "[3/4] 写入 frps 配置与 systemd 服务..."
mkdir -p /etc/frp
cat > /etc/frp/frps.toml <<EOF
bindAddr = "0.0.0.0"
bindPort = 7000

auth.method = "token"
auth.token = "${FRP_TOKEN}"

transport.tcpMux = true
transport.heartbeatTimeout = 90
EOF
chmod 600 /etc/frp/frps.toml

cat > /etc/systemd/system/frps.service <<'EOF'
[Unit]
Description=ActiScape FRP Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/frps -c /etc/frp/frps.toml
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

echo "[4/4] 配置 Caddy 反向代理 (含 SSE 流式长连接优化)..."
if [[ "$PUBLIC_HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  SITE_ADDR="http://${PUBLIC_HOST}"
else
  SITE_ADDR="${PUBLIC_HOST}"
fi

cat > /etc/caddy/Caddyfile <<EOF
${SITE_ADDR} {
    encode zstd gzip
    reverse_proxy 127.0.0.1:13131 {
        flush_interval -1
        header_up X-Forwarded-Proto {scheme}
        header_up X-Real-IP {remote_host}
    }
}
EOF

systemctl daemon-reload
systemctl enable --now frps
systemctl enable --now caddy
systemctl reload caddy

echo "=========================================================="
echo "部署完成！"
echo "1. 请确认华为云安全组已放行入方向 TCP: 80, 443, 7000"
echo "2. 在校内 GPU 容器 .env 中追加以下三行后执行: bash ops/tunnel.sh restart"
echo "   TUNNEL_MODE=frp"
echo "   FRP_SERVER_ADDR=${PUBLIC_HOST}"
echo "   FRP_AUTH_TOKEN=${FRP_TOKEN}"
echo "=========================================================="
