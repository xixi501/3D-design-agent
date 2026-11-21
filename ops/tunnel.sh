#!/usr/bin/env bash
# 公网反向隧道统一管理器：优先使用华为云贵阳一区 FRP 专线中转，未配置时平滑回退 serveo
# 用法: tunnel.sh start|stop|restart|status|url|logs
set -u
ulimit -c 0 2>/dev/null || true

DATA=/workspace/actiscape-data
REPO="$DATA/3D-design-agent"
ENV_FILE="$REPO/.env"
LOG="$DATA/logs/tunnel.log"
SUP=/tmp/actiscape-tunnel-supervise.sh
LOCK=/tmp/actiscape-tunnel.lock

mkdir -p "$DATA/logs"

read_env() {
  local key="$1"
  if [ -f "$ENV_FILE" ]; then
    grep -E "^${key}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | sed -e 's/^["'\'']//;s/["'\'']$//'
  fi
}

TUNNEL_MODE="${TUNNEL_MODE:-$(read_env TUNNEL_MODE)}"
FRP_SERVER_ADDR="${FRP_SERVER_ADDR:-$(read_env FRP_SERVER_ADDR)}"
FRP_SERVER_PORT="${FRP_SERVER_PORT:-$(read_env FRP_SERVER_PORT)}"
FRP_AUTH_TOKEN="${FRP_AUTH_TOKEN:-$(read_env FRP_AUTH_TOKEN)}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-$(read_env PUBLIC_BASE_URL)}"

if [ -z "$TUNNEL_MODE" ]; then
  if [ -n "$FRP_SERVER_ADDR" ] && [ -n "$FRP_AUTH_TOKEN" ]; then
    TUNNEL_MODE="frp"
  else
    TUNNEL_MODE="serveo"
  fi
fi

FRP_BIN="$DATA/tools/frpc"
SERVEO_KEY="$DATA/.ssh/serveo_ed25519"
SERVEO_DOMAIN="actiscape-bnu"

if [ "$TUNNEL_MODE" = "frp" ]; then
  FIXED_URL="${PUBLIC_BASE_URL:-https://${FRP_SERVER_ADDR}}"
  PROC_MATCH="frpc -c /tmp/actiscape-frpc.toml"
else
  FIXED_URL="${PUBLIC_BASE_URL:-https://${SERVEO_DOMAIN}.serveousercontent.com}"
  PROC_MATCH="serveo.net"
fi

gen_supervisor() {
  if [ "$TUNNEL_MODE" = "frp" ]; then
    [ -x "$FRP_BIN" ] || { echo "缺少 frpc 二进制: $FRP_BIN（请见 ops/gateway-ecs/README.md）"; exit 1; }
    cat > /tmp/actiscape-frpc.toml <<EOF
serverAddr = "${FRP_SERVER_ADDR}"
serverPort = ${FRP_SERVER_PORT:-7000}
auth.method = "token"
auth.token = "${FRP_AUTH_TOKEN}"
transport.tcpMux = true

[[proxies]]
name = "actiscape-scene"
type = "tcp"
localIP = "127.0.0.1"
localPort = 3131
remotePort = 13131
EOF
    chmod 600 /tmp/actiscape-frpc.toml
    cat > "$SUP" <<EOF
#!/usr/bin/env bash
while true; do
  "$FRP_BIN" -c /tmp/actiscape-frpc.toml >> "$LOG" 2>&1
  echo "[\$(date '+%F %T')] frpc exited, retry in 3s" >> "$LOG"
  sleep 3
done
EOF
  else
    cat > "$SUP" <<EOF
#!/usr/bin/env bash
while true; do
  ssh -i "$SERVEO_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \\
      -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o TCPKeepAlive=yes \\
      -o ConnectTimeout=20 -o ExitOnForwardFailure=yes \\
      -N -R ${SERVEO_DOMAIN}:80:127.0.0.1:3131 serveo.net >> "$LOG" 2>&1
  echo "[\$(date '+%F %T')] serveo tunnel exited, retry in 5s" >> "$LOG"
  sleep 5
done
EOF
  fi
  chmod 755 "$SUP"
}

stop_tunnel() {
  pkill -f "serveo.net" 2>/dev/null || true
  pkill -f "serveo-supervise" 2>/dev/null || true
  pkill -f "actiscape-frpc.toml" 2>/dev/null || true
  pkill -f "actiscape-tunnel-supervise" 2>/dev/null || true
}

start_tunnel() {
  if pgrep -f "$PROC_MATCH" >/dev/null; then
    echo "已在运行 (${TUNNEL_MODE}): ${FIXED_URL}"
    return 0
  fi
  stop_tunnel
  gen_supervisor
  setsid nohup flock -n "$LOCK" "$SUP" >/dev/null 2>&1 &
  local ok=0 code=000
  for i in $(seq 1 20); do
    sleep 2
    code=$(curl -sS -L -o /dev/null -w "%{http_code}" --max-time 15 "${FIXED_URL}/api/health" 2>/dev/null || echo 000)
    [ "$code" = "200" ] && { ok=1; break; }
  done
  if [ "$ok" = "1" ]; then
    echo "已启动并验证 (${TUNNEL_MODE}): ${FIXED_URL}"
  else
    echo "启动后验证失败（模式=${TUNNEL_MODE}，末次 HTTP=${code}）："
    tail -n 10 "$LOG" 2>/dev/null || true
  fi
}

case "${1:-status}" in
  start)   start_tunnel ;;
  stop)    stop_tunnel; echo "已停止隧道" ;;
  restart) stop_tunnel; sleep 1; start_tunnel ;;
  status)
    if pgrep -f "$PROC_MATCH" >/dev/null; then
      echo "运行中 (${TUNNEL_MODE}): ${FIXED_URL}"
      curl -sS -L -o /dev/null -w "公网健康检查: %{http_code}\n" --max-time 25 "${FIXED_URL}/api/health" 2>/dev/null || true
      curl -sS --noproxy '*' -o /dev/null -w "本机健康检查: %{http_code}\n" --max-time 6 http://127.0.0.1:3131/api/health 2>/dev/null || true
    else
      echo "未运行 (当前配置模式: ${TUNNEL_MODE})"
    fi ;;
  url)     echo "$FIXED_URL" ;;
  logs)    tail -n 30 "$LOG" 2>/dev/null || echo "暂无日志" ;;
  *)       echo "用法: $0 start|stop|restart|status|url|logs"; exit 1 ;;
esac
