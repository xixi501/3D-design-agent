#!/usr/bin/env bash
# 新容器一键幂等恢复：装系统依赖 → 校验 venv/权重/CUDA 扩展 → 起三服务与公网隧道 → 健康检查
set -u
ulimit -c 0 2>/dev/null || true

DATA=/workspace/actiscape-data
REPO=$DATA/3D-design-agent
ASSET_ENV=$DATA/3d-asset-service
LOG=$DATA/logs/bootstrap.log
mkdir -p "$DATA/logs"
exec >> "$LOG" 2>&1
echo "=== $(date '+%F %T') bootstrap start ==="

source "$DATA/env.sh" 2>/dev/null || true

need_apt=0
for bin in tmux curl; do command -v "$bin" >/dev/null 2>&1 || need_apt=1; done
[ -e /usr/lib/x86_64-linux-gnu/libGL.so.1 ] || need_apt=1
[ -e /usr/lib/x86_64-linux-gnu/libOpenGL.so.0 ] || need_apt=1
if [ "$need_apt" = 1 ]; then
  echo "[apt] installing base packages"
  sudo apt-get update -qq
  sudo apt-get install -y --no-install-recommends \
    tmux curl file libgl1 libopengl0 libglib2.0-0 libegl1 libgles2 \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 \
    libcairo2 libatspi2.0-0 libxshmfence1 libx11-xcb1 fonts-liberation fonts-noto-cjk >/dev/null 2>&1
  echo "[apt] done tmux=$(command -v tmux) libGL=$([ -e /usr/lib/x86_64-linux-gnu/libGL.so.1 ] && echo ok)"
else
  echo "[apt] already satisfied"
fi

# 1. 主项目 venv（Python 3.13）
if [ ! -x "$REPO/.venv/bin/python" ]; then
  echo "[venv] rebuilding project venv"
  "$DATA/tools/py313/bin/python" -m venv "$REPO/.venv"
  "$REPO/.venv/bin/python" -m pip install -q -U pip
  "$REPO/.venv/bin/python" -m pip install -q -r "$REPO/apps/agent/requirements.lock" -e "$REPO/apps/agent"
else
  echo "[venv] project venv ok: $("$REPO/.venv/bin/python" --version)"
fi

# 2. 资产服务 venv（Python 3.10 + CUDA 依赖，代码统一指向 Git 仓库 apps/asset-service）
if [ ! -x "$ASSET_ENV/.venv/bin/python" ]; then
  echo "[asset-venv] rebuilding"
  /opt/conda/bin/python -m venv --system-site-packages "$ASSET_ENV/.venv"
  "$ASSET_ENV/.venv/bin/python" -m pip install -q --index-url https://pypi.tuna.tsinghua.edu.cn/simple \
    fastapi "uvicorn[standard]" python-multipart "Pillow>=10,<13" "numpy>=1.26,<3" "trimesh>=4.4,<5" "httpx>=0.27,<1" \
    "transformers==4.48.2" "diffusers==0.32.1" einops opencv-python-headless omegaconf accelerate \
    pymeshlab pygltflib xatlas "rembg==2.0.57" onnxruntime tqdm pybind11 ninja wheel
  "$ASSET_ENV/.venv/bin/python" -m pip install -q --no-deps -e "$ASSET_ENV/src/hy3dgen-src"
  "$ASSET_ENV/.venv/bin/python" -m pip install -q --no-deps -e "$REPO/apps/asset-service"
else
  echo "[asset-venv] ok"
fi

# 3. CUDA 扩展校验
export CUDA_HOME=/usr/local/cuda-12.1
export PATH="$CUDA_HOME/bin:$PATH"
export TORCH_CUDA_ARCH_LIST=7.0
if ! ls "$ASSET_ENV/src/hy3dgen-src/hy3dgen/texgen/differentiable_renderer/"*.so >/dev/null 2>&1; then
  echo "[ext] rebuilding differentiable_renderer"
  ( cd "$ASSET_ENV/src/hy3dgen-src/hy3dgen/texgen/differentiable_renderer" && CXXFLAGS="-std=c++17" "$ASSET_ENV/.venv/bin/python" setup.py build_ext --inplace >/dev/null 2>&1 )
fi
if ! "$ASSET_ENV/.venv/bin/python" -c "import torch, custom_rasterizer_kernel" >/dev/null 2>&1; then
  echo "[ext] rebuilding custom_rasterizer"
  ( cd "$ASSET_ENV/src/hy3dgen-src/hy3dgen/texgen/custom_rasterizer" && "$ASSET_ENV/.venv/bin/python" -m pip install -q --no-build-isolation --no-deps . >/dev/null 2>&1 )
fi

# 4. 权重检查
for p in "$DATA/models/Hunyuan3D-2/hunyuan3d-dit-v2-0/model.fp16.safetensors" \
         "$DATA/models/Hunyuan3D-2mv/hunyuan3d-dit-v2-mv/model.fp16.safetensors" \
         "$DATA/models/Hunyuan3D-2/hunyuan3d-paint-v2-0-turbo/unet/diffusion_pytorch_model.bin" \
         "$DATA/models/u2net/u2net.onnx"; do
  [ -s "$p" ] && echo "[model] ok $(basename "$p")" || echo "[model] MISSING $p"
done

# 5. 启动三服务栈（3131 / 3132 / 3133）与公网隧道
echo "[start] restarting stack & tunnel"
OPS_DIR="$REPO/ops"
[ -d "$OPS_DIR" ] || OPS_DIR="$DATA"
bash "$OPS_DIR/start-stack.sh" core || echo "[start] FAILED"
bash "$OPS_DIR/tunnel.sh" start || echo "[tunnel] FAILED"

echo "[health] app=$(curl -sS --noproxy '*' -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3131/api/health 2>/dev/null)"
echo "[health] agent=$(curl -sS --noproxy '*' -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3132/health 2>/dev/null)"
echo "[health] asset=$(curl -sS --noproxy '*' -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3133/api/v1/health 2>/dev/null)"
echo "=== $(date '+%F %T') bootstrap done ==="
