import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const toolRoot =
  process.env.ACTISCAPE_TOOLS_DIR || path.resolve("..", ".actiscape-tools");
const root = path.join(toolRoot, "vllm-vision");
const executable = path.join(
  root,
  process.platform === "win32" ? "Scripts/vllm.exe" : "bin/vllm",
);
if (!fs.existsSync(executable))
  throw Error("Vision runtime missing; run npm run setup:vision first");

const model =
  process.env.ACTISCAPE_VISION_MODEL || "Qwen/Qwen3-VL-32B-Instruct-FP8";
const port = process.env.ACTISCAPE_VISION_PORT || "3003";
const cache =
  process.env.ACTISCAPE_VISION_CACHE || path.join(toolRoot, "models");
const python = path.join(
  root,
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const cudaProbe = spawnSync(
  python,
  ["-c", "from importlib.resources import files; print(files('nvidia.cu13'))"],
  { encoding: "utf8" },
);
const detectedCudaHome =
  cudaProbe.status === 0 ? cudaProbe.stdout.trim() : undefined;
const cudaHome =
  process.env.CUDA_HOME || process.env.CUDA_PATH || detectedCudaHome;

const child = spawn(
  executable,
  [
    "serve",
    model,
    "--host",
    "127.0.0.1",
    "--port",
    port,
    "--served-model-name",
    model,
    "--download-dir",
    cache,
    "--max-model-len",
    "32768",
    "--limit-mm-per-prompt",
    '{"image":4}',
    "--gpu-memory-utilization",
    process.env.ACTISCAPE_VISION_GPU_MEMORY || "0.9",
    "--dtype",
    "auto",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(cudaHome
        ? {
            CUDA_HOME: cudaHome,
            CUDA_PATH: process.env.CUDA_PATH || cudaHome,
          }
        : {}),
      // The bundled CUDA runtime and nvcc can expose different point
      // versions. Keep vLLM on prebuilt kernels so startup does not require
      // DeepGEMM or FlashInfer JIT compilation against mismatched headers.
      VLLM_USE_DEEP_GEMM: process.env.VLLM_USE_DEEP_GEMM || "0",
      VLLM_MOE_USE_DEEP_GEMM: process.env.VLLM_MOE_USE_DEEP_GEMM || "0",
      VLLM_DEEP_GEMM_WARMUP: process.env.VLLM_DEEP_GEMM_WARMUP || "skip",
      VLLM_USE_FLASHINFER_SAMPLER:
        process.env.VLLM_USE_FLASHINFER_SAMPLER || "0",
      PATH: [
        path.join(root, "bin"),
        ...(cudaHome ? [path.join(cudaHome, "bin")] : []),
        process.env.PATH,
      ]
        .filter(Boolean)
        .join(path.delimiter),
    },
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
