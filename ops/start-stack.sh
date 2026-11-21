#!/usr/bin/env bash
# 共享实例启动器：全组共用一套服务（3131 场景/工作台 / 3132 Agent / 3133 资产）。
# 用法：start-stack.sh [core|stable|assets|skills|<绝对路径>] [--only-app|--only-assets]
set -euo pipefail
ulimit -c 0 2>/dev/null || true

DATA=/workspace/actiscape-data
SESSION=actiscape
LOGDIR=$DATA/logs
ARCHDIR=$LOGDIR/archive
BAKDIR=$LOGDIR/backups

TARGET=${1:-core}
MODE=${2:-all}

case "$TARGET" in
  core|"")  DIR=$DATA/3D-design-agent ;;
  stable)   DIR=$DATA/3D-design-agent-stable ;;
  assets)   DIR=$DATA/3D-design-agent-assets ;;
  skills)   DIR=$DATA/3D-design-agent-skills ;;
  /*)       DIR=$TARGET ;;
  *) echo "用法: start-stack.sh [core|stable|assets|skills|<绝对路径>] [--only-app|--only-assets]"; exit 1 ;;
esac

[ -d "$DIR" ] || { echo "目录不存在: $DIR"; exit 1; }
mkdir -p "$LOGDIR" "$ARCHDIR" "$BAKDIR"

TS="$(date -u +%Y%m%d-%H%M%SZ)"
PY_BIN="$DATA/3D-design-agent/.venv/bin/python"
[ -x "$PY_BIN" ] || PY_BIN="python3"

# 1. 在线一致性热备 SQLite（兼容 WAL 模式，绝不直接裸 cp 导致丢事务或页撕裂）
"$PY_BIN" - "$DATA" "$BAKDIR" "$LOGDIR" "$TS" <<'PY'
import shutil, sqlite3, sys
from pathlib import Path

data, bak_dir, log_dir, ts = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4]
targets = [
    ("projects", data / "3D-design-agent/data/projects.sqlite", log_dir / "projects.sqlite.bak"),
    ("tasks", data / "3D-design-agent/data/agent/tasks.sqlite", None),
]
for prefix, src, compat_bak in targets:
    if not src.exists():
        continue
    dst = bak_dir / f"{prefix}.{ts}.sqlite"
    s_conn = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
    d_conn = sqlite3.connect(str(dst))
    try:
        s_conn.backup(d_conn)
    finally:
        d_conn.close()
        s_conn.close()
    if compat_bak is not None:
        shutil.copy2(dst, compat_bak)
    # 保留最近 10 份时间戳备份
    old = sorted(bak_dir.glob(f"{prefix}.*.sqlite"))[:-10]
    for f in old:
        f.unlink(missing_ok=True)
    print(f"已安全备份 {src.name} -> {dst.name}")
PY

# 2. 轮转归档旧日志（严禁直接清空，保留验收与排障证据）
rotate_log() {
  local log_file="$1"
  local stem="$2"
  if [ -s "$log_file" ]; then
    mv -f "$log_file" "$ARCHDIR/${stem}.${TS}.log"
    ls -1t "$ARCHDIR"/${stem}.*.log 2>/dev/null | tail -n +21 | xargs -r rm -f
  fi
  : > "$log_file"
}

BRANCH=$(git -C "$DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)
COMMIT=$(git -C "$DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)
DIRTY=$(git -C "$DIR" status --porcelain 2>/dev/null | wc -l | tr -d ' ')

OPS_DIR="$DIR/ops"
[ -d "$OPS_DIR" ] || OPS_DIR="$DATA"

if [ "$MODE" = "--only-app" ]; then
  tmux kill-window -t "$SESSION:app" 2>/dev/null || true
  rotate_log "$LOGDIR/start-app.log" "start-app"
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    tmux new-window -t "$SESSION" -n app -c "$DIR" \
      "ACTISCAPE_DIR='$DIR' bash '$OPS_DIR/run-actiscape.sh'"
  else
    tmux new-session -d -s "$SESSION" -n app -c "$DIR" \
      "ACTISCAPE_DIR='$DIR' bash '$OPS_DIR/run-actiscape.sh'"
  fi
  tmux pipe-pane -t "$SESSION:app" -o "cat >> $LOGDIR/start-app.log"
elif [ "$MODE" = "--only-assets" ]; then
  tmux kill-window -t "$SESSION:assets" 2>/dev/null || true
  rotate_log "$LOGDIR/start-asset.log" "start-asset"
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    tmux new-window -t "$SESSION" -n assets -c "$DIR/apps/asset-service" \
      "ACTISCAPE_DIR='$DIR' bash '$OPS_DIR/run-asset.sh'"
  else
    tmux new-session -d -s "$SESSION" -n assets -c "$DIR/apps/asset-service" \
      "ACTISCAPE_DIR='$DIR' bash '$OPS_DIR/run-asset.sh'"
  fi
  tmux pipe-pane -t "$SESSION:assets" -o "cat >> $LOGDIR/start-asset.log"
else
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  rotate_log "$LOGDIR/start-app.log" "start-app"
  rotate_log "$LOGDIR/start-asset.log" "start-asset"
  tmux new-session -d -s "$SESSION" -n app -c "$DIR" \
    "ACTISCAPE_DIR='$DIR' bash '$OPS_DIR/run-actiscape.sh'"
  tmux new-window -t "$SESSION" -n assets -c "$DIR/apps/asset-service" \
    "ACTISCAPE_DIR='$DIR' bash '$OPS_DIR/run-asset.sh'"
  tmux pipe-pane -t "$SESSION:app" -o "cat >> $LOGDIR/start-app.log"
  tmux pipe-pane -t "$SESSION:assets" -o "cat >> $LOGDIR/start-asset.log"
  tmux select-window -t "$SESSION:app"
fi

cat > "$LOGDIR/stack-status.json" <<EOF
{"startedAt":"$(date -Iseconds)","dir":"$DIR","branch":"$BRANCH","commit":"$COMMIT","dirtyFiles":$DIRTY,"mode":"$MODE","restartedBy":"$(id -un)"}
EOF
echo "已启动：$DIR  branch=$BRANCH commit=$COMMIT 未提交=$DIRTY mode=$MODE"
echo "等待服务就绪（最多 90s）…"
a=000; b=000
for i in $(seq 1 30); do
  if [ "$MODE" != "--only-assets" ]; then
    a=$(curl -sS --noproxy '*' -o /dev/null -w "%{http_code}" --max-time 2 http://127.0.0.1:3131/api/health 2>/dev/null || echo 000)
  else
    a=200
  fi
  if [ "$MODE" != "--only-app" ]; then
    b=$(curl -sS --noproxy '*' -o /dev/null -w "%{http_code}" --max-time 2 http://127.0.0.1:3133/api/v1/health 2>/dev/null || echo 000)
  else
    b=200
  fi
  if [ "$a" = "200" ] && [ "$b" = "200" ]; then
    echo "  就绪：app=$a asset=$b（$((i*3))s）"
    break
  fi
  sleep 3
done
[ "$a" = "200" ] || echo "  ⚠ app 未就绪（$a）"
[ "$b" = "200" ] || echo "  ⚠ asset 未就绪（$b），提交资产会回退 demo"
echo "查看状态：bash $OPS_DIR/status.sh"
