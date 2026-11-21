#!/usr/bin/env node
/** Build and self-verify a complete, self-contained AgentArts deploy bundle (ARM64). */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist/agentarts-bundle");
const sourcePackage = path.join(root, "apps/agent/actiscape_agent");
const deployDir = path.join(root, "deploy/agentarts-minimal");
const lock = path.join(root, "apps/agent/requirements.lock");

const RUNTIME_FILES = ["app.py", "agent.py", "task_runtime.py", "mcp_gateway.py"];

function fail(message) {
  console.error(`prepare-agentarts-bundle: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(sourcePackage)) fail("缺少 apps/agent/actiscape_agent");
if (!fs.existsSync(deployDir)) fail("缺少 deploy/agentarts-minimal");
if (!fs.existsSync(lock)) fail("缺少 apps/agent/requirements.lock");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// 1. Self-contained business package (all skills, schemas, subpackages).
fs.cpSync(sourcePackage, path.join(out, "actiscape_agent"), {
  recursive: true,
  filter: (source) => {
    const name = path.basename(source);
    return name !== "__pycache__" && !name.endsWith(".pyc");
  },
});

// 2. Runtime entrypoints & MCP client (strictly verified).
for (const file of RUNTIME_FILES) {
  const source = path.join(deployDir, file);
  if (!fs.existsSync(source)) fail(`缺少 deploy/agentarts-minimal/${file}`);
  fs.copyFileSync(source, path.join(out, file));
}

// 3. Python requirements without editable parent path.
const lines = fs
  .readFileSync(lock, "utf8")
  .split(/\r?\n/)
  .filter((line) => line.trim())
  .filter((line) => !/^(?:-e|--editable)\s+/.test(line.trim()))
  .filter((line) => !line.trim().startsWith("apps/agent"));
const requirements = [
  "# Generated from apps/agent/requirements.lock by scripts/prepare-agentarts-bundle.mjs",
  "--index-url https://repo.huaweicloud.com/repository/pypi/simple",
  "--trusted-host repo.huaweicloud.com",
  "",
  ...lines,
  "",
].join("\n");
fs.writeFileSync(path.join(out, "requirements.txt"), requirements);

// 4. Self-contained Dockerfile (verifies all runtime modules import cleanly at image build time).
fs.writeFileSync(
  path.join(out, "Dockerfile"),
  `# Generated AgentArts bundle: Dockerfile
FROM python:3.13-slim
WORKDIR /app
COPY . /app
RUN pip install --no-cache-dir -r requirements.txt \\
    -i https://repo.huaweicloud.com/repository/pypi/simple \\
    --trusted-host repo.huaweicloud.com \\
    && python -c "import mcp_gateway, task_runtime, agent, app; print('AgentArts bundle imports OK')"
ENV AGENT_RUN_PORT=8080 RUNTIME_PORT=8080 RUNTIME_HOST=0.0.0.0
EXPOSE 8080
CMD ["python", "app.py"]
`,
);

fs.writeFileSync(
  path.join(out, ".dockerignore"),
  `__pycache__/
*.pyc
.venv/
venv/
.git/
.agentarts_config.yaml
`,
);

// 5. Official CLI config example (no credentials).
fs.writeFileSync(
  path.join(out, ".agentarts_config.yaml.example"),
  `default_agent: actiscape
agents:
  actiscape:
    base:
      name: actiscape
      entrypoint: app:app
      dependency_file: requirements.txt
      region: cn-southwest-2
      platform: linux/arm64
      language: python3
      base_image: python:3.13-slim
    swr_config:
      organization: your-swr-organization
      repository: actiscape-agentarts
      organization_auto_create: true
      repository_auto_create: true
    runtime:
      arch: arm64
      invoke_config:
        protocol: HTTP
        port: 8080
`,
);

// 6. Generated ARM64 Deploy Runbook.
const runbook = `# AgentArts 自包含部署包（ARM64）

本目录由 \`npm run build:agentarts-bundle\` 自动生成并完成静态导入自检，**请勿直接手工修改生成物**。

## 1. 推荐构建方式：GitHub Actions 原生 ARM64 流水线

仓库已内置 \`.github/workflows/build-agentarts-arm64.yml\`（默认使用 GitHub 原生 \`ubuntu-24.04-arm\` Runner，免除 QEMU 跨架构仿真开销）：

1. 在 GitHub 仓库 Secrets 配置 \`SWR_ORG\`、\`SWR_AK\`、\`SWR_SK\`（默认区域 \`cn-southwest-2\`）。
2. 手动触发 **Build & Push AgentArts ARM64 Runtime Image** 或推送 \`v*\` 标签。
3. 在构建摘要获取 \`linux/arm64\` 镜像地址与 Digest，在华为云 AgentArts Runtime 更新版本。

## 2. 手动 Docker Buildx 构建（备选）

\`\`\`bash
docker buildx build \\
  --platform linux/arm64 \\
  --provenance=false \\
  -t swr.cn-southwest-2.myhuaweicloud.com/<org>/actiscape-agentarts:<tag> \\
  --push .
\`\`\`

## 3. 运行时环境变量与委托凭据

必填：
- \`MODEL_API_KEY\` / \`MODEL_URL\` / \`MODEL_NAME\`
- \`ACTISCAPE_SCENE_URL\`（优先使用贵阳一区 \`ops/gateway-ecs/\` HTTPS 专线入口，未配置时回退 \`serveo\`）
- \`ACTISCAPE_TOOL_TOKEN\`

MCP 网关鉴权（三层自动解析）：
1. \`AGENTARTS_MCP_AK\` / \`AGENTARTS_MCP_SK\`（可选）
2. \`HUAWEICLOUD_SDK_AK\` / \`HUAWEICLOUD_SDK_SK\`（可选）
3. 华为云 Runtime 绑定委托 \`DefaultAgentArtsRuntimeAgency\` 时自动读取临时 STS 凭证并缓存刷新（无需静态 AK/SK 常驻）。

## 4. 支持的调用动作

- \`{"action": "ping"}\`：健康探针
- \`{"action": "run_task", "projectId": "...", "input": "..."}\`：执行只读 MCP 场景检查或完整多智能体场景编辑
- \`{"action": "resume_task", "taskId": "...", "input": "..."}\`：在同一会话内补充澄清恢复 \`waiting_input\` 任务
- \`{"action": "cancel_task", "taskId": "..."}\`：取消挂起任务，释放项目锁
`;
fs.writeFileSync(path.join(out, "DEPLOY_RUNBOOK.md"), runbook);

// 7. Static self-verification: ensure every top-level local import inside RUNTIME_FILES exists in bundle.
const bundledTopModules = new Set(
  fs
    .readdirSync(out, { withFileTypes: true })
    .map((e) => (e.isDirectory() ? e.name : e.name.replace(/\.py$/, ""))),
);
for (const file of RUNTIME_FILES) {
  const code = fs.readFileSync(path.join(out, file), "utf8");
  for (const match of code.matchAll(/^\s*(?:from|import)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm)) {
    const mod = match[1];
    if (["mcp_gateway", "task_runtime", "agent", "app", "actiscape_agent"].includes(mod)) {
      if (!bundledTopModules.has(mod)) {
        fail(`${file} 引用了未打包模块 ${mod}`);
      }
    }
  }
}

let sourceCommit = "unknown";
try {
  sourceCommit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
} catch {}

let fileCount = 0;
const countFiles = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) countFiles(path.join(dir, entry.name));
    else fileCount++;
  }
};
countFiles(out);

const manifest = {
  schemaVersion: "actiscape.agentarts-bundle.v2",
  sourceCommit,
  target: "linux/arm64",
  entrypoint: "app:app",
  runtimeFiles: RUNTIME_FILES,
  fileCount,
  generatedAt: new Date().toISOString(),
};
fs.writeFileSync(
  path.join(out, "BUNDLE_MANIFEST.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(JSON.stringify(manifest));
