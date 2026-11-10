# 学校 GPU 服务器逐步操作手册

本手册适用于“网页控制面板上传 ZIP + 服务器终端执行”。不要把密码、私钥、Hugging Face token 或 API Key 发进聊天或提交到 Git。

## 1. 上传与解压

1. 在学校平台网页控制面板找到文件管理/上传文件，上传 `member2-assets-server.zip`。
2. 打开服务器终端。以下假设 ZIP 上传到家目录；如果网页显示其他目录，先 `cd` 到该目录。
3. 执行：

```bash
cd ~
ls -lh member2-assets-server.zip
unzip member2-assets-server.zip
cd member2-assets-server
```

如果提示 `unzip: command not found`，使用 Python 解压，不需要安装 unzip：

```bash
cd ~
python3 -m zipfile -e member2-assets-server.zip member2-assets-server
cd member2-assets-server
```

检查文件：

```bash
ls
# 应看到 pyproject.toml、asset_service、examples、README.md 等
```

## 2. 先检查环境，再决定 CUDA 安装命令

把下面整段复制到服务器终端：

```bash
echo '===== OS ====='
cat /etc/os-release 2>/dev/null || true
uname -a
echo '===== GPU ====='
nvidia-smi
echo '===== PYTHON ====='
python3 --version
command -v python3.11 || true
command -v python3.10 || true
command -v conda || true
echo '===== RESOURCES ====='
free -h
df -h ~ .
echo '===== NETWORK ====='
curl -I --max-time 10 https://huggingface.co 2>/dev/null | head -n 1 || true
```

**先暂停，把完整输出发给助手。** 需要根据 GPU 型号、显存、驱动支持的 CUDA 和 Python 版本选择 PyTorch 命令，不能盲目安装最新 CUDA。

Hunyuan3D-2 官方参考资源量：仅几何约 6 GB 显存，几何加贴图约 16 GB 显存。磁盘还要容纳代码、PyTorch、模型权重和输出，建议预留至少 40 GB；实际以检查与安装结果为准。

## 3. 创建独立 Python 环境

优先使用 Python 3.11。如果上一步没有 `python3.11`，不要自行混用系统 Python，先把情况发给助手。

```bash
cd ~/member2-assets-server
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip setuptools wheel
pip install -e .
```

每次新开终端都要重新进入目录并激活：

```bash
cd ~/member2-assets-server
source .venv/bin/activate
```

## 4. 安装与当前代码匹配的 PyTorch

这一步故意不预写死 CUDA 版本。根据第 2 步的 `nvidia-smi` 输出，由助手给出 PyTorch 官方对应命令，例如会明确指定 `cu121`、`cu124` 或其他适配版本。

安装后先验证：

```bash
python - <<'PY'
import torch
print('torch:', torch.__version__)
print('CUDA available:', torch.cuda.is_available())
print('CUDA runtime:', torch.version.cuda)
print('GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'NONE')
PY
```

只有 `CUDA available: True` 才继续真实生成安装。

## 5. 安装固定版本 Hunyuan3D-2

```bash
cd ~/member2-assets-server
mkdir -p third_party
git clone https://github.com/Tencent-Hunyuan/Hunyuan3D-2.git third_party/Hunyuan3D-2
git -C third_party/Hunyuan3D-2 checkout f8db63096c8282cb27354314d896feba5ba6ff8a
pip install -r third_party/Hunyuan3D-2/requirements.txt
pip install -e third_party/Hunyuan3D-2
```

贴图管线还需要官方两个本地扩展。编译需要服务器有 C++/CUDA 编译工具：

```bash
cd third_party/Hunyuan3D-2/hy3dgen/texgen/custom_rasterizer
python setup.py install
cd ../differentiable_renderer
python setup.py install
cd ~/member2-assets-server
```

如果编译失败，保留完整报错，不要反复换版本；把报错最后的 50 行发给助手。

## 6. 准备模型权重

默认模型为：

- 几何：`tencent/Hunyuan3D-2`，子目录 `hunyuan3d-dit-v2-0`
- 去光照：同仓库，子目录 `hunyuan3d-delight-v2-0`（贴图管线必需）
- 贴图：同仓库，子目录 `hunyuan3d-paint-v2-0-turbo`

预下载可使用 `huggingface-cli download tencent/Hunyuan3D-2 --include "hunyuan3d-dit-v2-0/*" "hunyuan3d-delight-v2-0/*" "hunyuan3d-paint-v2-0-turbo/*"`。若 Xet 通道返回 401，设置 `HF_HUB_DISABLE_XET=1` 后重试；下载中断会复用缓存。

第一次真实任务会自动从 Hugging Face 下载权重，首次等待会明显更长。权重缓存默认在 `~/.cache/huggingface`，不要把缓存目录删除或打包进 ZIP。若服务器访问 Hugging Face 失败，把第 2 步网络结果和实际错误发给助手，再决定镜像或离线上传方式。

## 7. 启动真实生成服务

先设置一个只保存在当前服务器 shell 的访问密钥：

```bash
cd ~/member2-assets-server
source .venv/bin/activate
read -s -p '请设置 ASSET_API_KEY: ' ASSET_API_KEY; echo
export ASSET_API_KEY
```

启动：

```bash
mkdir -p generated_assets
ASSET_BACKEND=hunyuan \
ASSET_HOST=0.0.0.0 \
ASSET_PORT=8000 \
ASSET_DATA_DIR="$PWD/generated_assets" \
HUNYUAN_CODE_VERSION=f8db63096c8282cb27354314d896feba5ba6ff8a \
python -m asset_service 2>&1 | tee server.log
```

保持终端运行。`0.0.0.0` 只允许服务监听平台内部网络接口；公网访问必须使用平台提供的端口映射/应用发布功能，并保留上面的 API Key。不要自行关闭平台防火墙或暴露无认证接口。

低显存模式只有在确认显存不足后使用：停止服务，在启动命令中增加一行 `HUNYUAN_LOW_VRAM=1 \`。它可能降低速度，也不能突破硬件最低要求。

## 8. 健康检查与平台端口映射

另开一个服务器终端：

```bash
curl http://127.0.0.1:8000/api/v1/health
```

应看到 `"backend":"hunyuan"` 和 `"real_generation":true`。然后在网页控制面板找到“自定义服务/端口映射/应用发布”，将内部端口 `8000` 映射为 HTTPS 地址。不同平台名称不同；提供平台名称或截图后再确定具体点击步骤。

打开平台给出的地址，在页面 API Key 输入框填写刚设置的值。Key 只保存在当前浏览器标签页的 `sessionStorage`，不会写入代码。

## 9. 最小真实生成调用

在服务器另一个终端执行（使用有权使用的清晰单件物品照片）：

```bash
cd ~/member2-assets-server
source .venv/bin/activate
read -s -p 'ASSET_API_KEY: ' ASSET_API_KEY; echo
export ASSET_API_KEY
curl -X POST http://127.0.0.1:8000/api/v1/jobs \
  -H "X-API-Key: $ASSET_API_KEY" \
  -H 'Idempotency-Key: server-smoke-001' \
  -F 'name=服务器首个真实案例' \
  -F 'file=@/服务器上的绝对路径/photo.jpg;type=image/jpeg'
```

复制返回的 `job.id`：

```bash
curl -H "X-API-Key: $ASSET_API_KEY" \
  http://127.0.0.1:8000/api/v1/jobs/JOB_ID
```

也可以在网页直接上传，避免手写路径。状态成功后必须同时检查：网页主体轮廓与主色可辨、贴图没有丢失、GLB 可下载、元数据 `is_real_generation=true`。只返回成功不等于外观验收通过。

## 10. 停止、重启与结果恢复

- 停止：在运行服务的终端按 `Ctrl+C`。
- 重启：重新执行第 7 步；`generated_assets` 是持久目录，不要删除。
- 已完成结果：重新打开网页或调用 `/api/v1/assets`。
- 中断任务：重启后会标为 `JOB_INTERRUPTED`，换一个新的幂等键重新提交。
- 下载结果：网页点击“下载 GLB”，或按 README 的 HTTP 示例下载。
- 备份：停止服务后备份 `generated_assets/`；不要把其中的用户图片和结果提交到 Git。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| `CUDA available: False` | 停在第 4 步，提供 `nvidia-smi` 与 PyTorch 输出 |
| `No module named hy3dgen` | 确认已激活 `.venv` 并完成第 5 步 `pip install -e third_party/Hunyuan3D-2` |
| 自定义扩展编译失败 | 提供完整最后 50 行，检查 nvcc、编译器与 CUDA/PyTorch 匹配 |
| `CUDA out of memory` | 停止其他 GPU 进程，提供 `nvidia-smi`；再评估低显存模式或更小模型 |
| Hugging Face 下载超时 | 保留报错，检查平台网络；不要反复删除已有缓存 |
| 网页健康但模型一直排队 | 查看服务终端 `server.log`；首次加载与下载权重可能耗时较长 |
| 任务失败 | 读取任务 `error.code/message` 和服务日志，重新提交时换新的幂等键 |
