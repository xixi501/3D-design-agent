#!/usr/bin/env bash
set -u
DATA=/workspace/actiscape-data
REPO="${1:-$DATA/3D-design-agent}"

echo "── 代码 ─────────────────────────────"
echo "目录   : $REPO"
echo "分支   : $(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
echo "提交   : $(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)"
DIRTY_CNT=$(git -C "$REPO" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
echo "未提交 : ${DIRTY_CNT} 个文件"
git -C "$REPO" status --porcelain 2>/dev/null | head -n 10 | sed 's/^/         /'

echo "── 共享实例 ─────────────────────────"
[ -f "$DATA/logs/stack-status.json" ] && cat "$DATA/logs/stack-status.json"
echo ""
tmux list-sessions 2>/dev/null | sed 's/^/         /' || echo "         (无 tmux 会话)"

echo "── 端口 ─────────────────────────────"
printf "  3131  %s\n" "$(curl -sS --noproxy '*' -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3131/api/health 2>/dev/null || echo down)"
printf "  3132  %s\n" "$(curl -sS --noproxy '*' -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3132/health 2>/dev/null || echo down)"
printf "  3133  %s\n" "$(curl -sS --noproxy '*' -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3133/api/v1/health 2>/dev/null || echo down)"

echo "── 隧道 ─────────────────────────────"
OPS_TUNNEL="$REPO/ops/tunnel.sh"
[ -f "$OPS_TUNNEL" ] || OPS_TUNNEL="$DATA/tunnel.sh"
bash "$OPS_TUNNEL" status 2>/dev/null | sed 's/^/  /'

echo "── GPU ──────────────────────────────"
nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu --format=csv,noheader 2>/dev/null || echo "  N/A"
