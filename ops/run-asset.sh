#!/usr/bin/env bash
set -u
ulimit -c 0 2>/dev/null || true
source /workspace/actiscape-data/env.sh
# 清除容器遗留旧驱动路径，避免 pymeshlab / hy3dgen OpenGL 符号冲突
unset LD_LIBRARY_PATH

DATA=/workspace/actiscape-data
REPO_DIR="${ACTISCAPE_DIR:-$DATA/3D-design-agent}"
SERVICE_DIR="$REPO_DIR/apps/asset-service"
LEGACY_ENV_BASE="$DATA/3d-asset-service"
MODELS="$DATA/models"

cd "$SERVICE_DIR" || exit 1
export ASSET_BACKEND="${ASSET_BACKEND:-hunyuan}"
export ASSET_HOST=127.0.0.1
export ASSET_PORT="${ASSET_PORT:-3133}"
export ASSET_DATA_DIR="${ASSET_DATA_DIR:-$LEGACY_ENV_BASE/generated_assets}"
export ASSET_MAX_IMAGE_MB=10
export ASSET_MAX_FACES=20000
export HUNYUAN_MODEL_PATH="$MODELS/Hunyuan3D-2"
export HUNYUAN_PAINT_DIR="$MODELS/Hunyuan3D-2/hunyuan3d-paint-v2-0-turbo"
export HUNYUAN_CODE_VERSION="f8db63096c8282cb27354314d896feba5ba6ff8a"
export HUNYUAN_LOW_VRAM="${HUNYUAN_LOW_VRAM:-0}"
export HY3DGEN_MODELS="$MODELS"
export U2NET_HOME="$MODELS/u2net"
export PYTHONPATH="$SERVICE_DIR"
export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
export OMP_NUM_THREADS=6 MKL_NUM_THREADS=6 OPENBLAS_NUM_THREADS=6

mkdir -p "$ASSET_DATA_DIR"
echo "[asset-service] $(date '+%F %T') dir=$SERVICE_DIR backend=$ASSET_BACKEND port=$ASSET_PORT model=$HUNYUAN_MODEL_PATH"
exec "$LEGACY_ENV_BASE/.venv/bin/python" -m asset_service
