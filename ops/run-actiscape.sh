#!/usr/bin/env bash
set -u
ulimit -c 0 2>/dev/null || true
source /workspace/actiscape-data/env.sh
DIR="${ACTISCAPE_DIR:-/workspace/actiscape-data/3D-design-agent}"
cd "$DIR" || exit 1
echo "[start-all] $(date '+%F %T') dir=$DIR branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) commit=$(git rev-parse --short HEAD 2>/dev/null) node=$(node -v)"
exec npm run start:all
