#!/usr/bin/env node
/** Build a self-contained AgentArts deploy bundle (ARM64/CLI/manual Docker). */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist/agentarts-bundle");
const sourcePackage = path.join(root, "apps/agent/actiscape_agent");
const deployDir = path.join(root, "deploy/agentarts-minimal");
const lock = path.join(root, "apps/agent/requirements.lock");

function fail(message) {
  console.error(`prepare-agentarts-bundle: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(sourcePackage)) fail("缺少 apps/agent/actiscape_agent");
if (!fs.existsSync(deployDir)) fail("缺少 deploy/agentarts-minimal");
if (!fs.existsSync(lock)) fail("缺少 apps/agent/requirements.lock");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// 1. Self-contained business package (all skills, schemas, vendor files).
fs.cpSync(sourcePackage, path.join(out, "actiscape_agent"), {
  recursive: true,
  filter: (source) => {
    const name = path.basename(source);
    return name !== "__pycache__" && !name.endsWith(".pyc");
  },
});

// 2. Runtime entrypoints.
for (const file of ["app.py", "agent.py", "task_runtime.py"]) {
  const source = path.join(deployDir, file);
  if (!fs.existsSync(source)) fail(`缺少 deploy/agentarts-minimal/${file}`);
  fs.copyFileSync(source, path.join(out, file));
}

// 3. Python requirements without the editable parent path.
const lines = fs
  .readFileSync(lock, "utf8")
  .split(/\r?\n/)
  .filter((line) => line.trim())
  .filter((line) => !/^(?:-e|--editable)\s+/.test(line.trim()))
  .filter((line) => !line.trim().startsWith("apps/agent"));
const requirements = [
  "# Generated from apps/agent/requirements.lock by scripts/prepare-agentarts-bundle.mjs",
  "# actiscape_agent is copied into this bundle; no editable parent path is needed.",
  "--index-url https://repo.huaweicloud.com/repository/pypi/simple",
  "--trusted-host repo.huaweicloud.com",
  "",
  ...lines,
  "",
].join("\n");
fs.writeFileSync(path.join(out, "requirements.txt"), requirements);

// 4. Self-contained Dockerfile.
fs.writeFileSync(
  path.join(out, "Dockerfile"),
  `# Generated AgentArts bundle: Dockerfile
FROM python:3.13-slim
WORKDIR /app
COPY . /app
RUN pip install --no-cache-dir -r requirements.txt \\
    -i https://repo.huaweicloud.com/repository/pypi/simple \\
    --trusted-host repo.huaweicloud.com \\
    && python -c "from agentarts.sdk import AgentArtsRuntimeApp; print('SDK OK')"
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

// 5. Official CLI config example. Never place real credentials here.
fs.writeFileSync(
  path.join(out, ".agentarts_config.yaml.example"),
  `# Copy to .agentarts_config.yaml and replace placeholders.
# The official CLI may generate its own file; this example documents the required shape.
default_agent: actiscape
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
      repository: your-swr-repository
      organization_auto_create: true
      repository_auto_create: true
    runtime:
      arch: arm64
      invoke_config:
        protocol: HTTP
        port: 8080
`,
);

const runbook = `# AgentArts 自包含部署包（ARM64）

本目录由 \`npm run build:agentarts-bundle\` 生成，**不要手工修改**。

## 0. 目标环境

- 华为云 \`cn-southwest-2\`（贵阳一）
- **ARM64** Ubuntu 22.04（鲲鹏 ECS 或 Mac M 系列）
- Docker 18.06+
- Python 3.10+（构建机）
- 可访问公网（Docker Hub / 华为云 PyPI / SWR）

> 官方明确：X86 镜像在 AgentArts 调用会失败；请在 ARM64 机器构建。

## 1. 配置 Docker 国内镜像加速（推荐）

\`\`\`bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": [
    "https://docker.m.daocloud.net",
    "https://dockerproxy.net",
    "https://mirror.baidubce.com"
  ]
}
EOF
sudo systemctl daemon-reload
sudo systemctl restart docker
\`\`\`

Docker 27+ 推 SWR 时若报 OCI 格式错误：

\`\`\`bash
export DOCKER_BUILDKIT=0
# 或
export BUILDKIT_USE_OCI_MEDIA_TYPES=0
\`\`\`

## 2. 安装 AgentArts CLI

\`\`\`bash
python3 -m venv venv
source venv/bin/activate
pip install agentarts-sdk -i https://repo.huaweicloud.com/repository/pypi/simple --trusted-host repo.huaweicloud.com
export HUAWEICLOUD_SDK_AK="..."
export HUAWEICLOUD_SDK_SK="..."
\`\`\`

## 3. 官方 CLI 路径（推荐先试）

\`\`\`bash
# 在本目录执行
agentarts configure --entrypoint app:app
# 按提示填写：
#   Agent name: actiscape（小写字母开头）
#   Region: cn-southwest-2
#   Dependency file: requirements.txt
#   SWR Organization: 你的组织（或先留空/自动创建）
#   SWR Repository: 建议留空，自动创建

agentarts launch
\`\`\`

如果 \`agentarts configure\` 生成了新的 Dockerfile，请确认它与本目录自带的 Dockerfile 不冲突；本包的业务入口始终是 \`app:app\`。

## 4. 手动 Docker 路径（CLI 不适用时）

\`\`\`bash
docker buildx build \\
  --platform linux/arm64 \\
  -t swr.cn-southwest-2.myhuaweicloud.com/<org>/actiscape-agentarts:<tag> \\
  --push .
\`\`\`

## 5. 运行时环境变量

必须：

- \`MODEL_API_KEY\`（华为云 MaaS Key）
- \`MODEL_URL\`（例如 \`https://api.modelarts-maas.com/openai/v1\`）
- \`MODEL_NAME\`（模型接口的 model 值）
- \`ACTISCAPE_SCENE_URL\`（云端可达的 HTTPS 场景网关）
- \`ACTISCAPE_TOOL_TOKEN\`（网关 Bearer Token）

可选：

- \`AGENT_RUN_PORT=8080\`
- \`AGENTARTS_TASK_TIMEOUT=180\`
- \`DEEPSEEK_THINKING=enabled\`（仅当 MaaS 明确支持 thinking 字段）

> 不要把任何 Key 写入镜像或提交到 Git。

## 6. 本地接口验证

\`\`\`bash
python app.py
# 另开终端
curl http://127.0.0.1:8080/ping
curl -X POST http://127.0.0.1:8080/invocations \\
  -H 'content-type: application/json' \\
  -d '{"action":"run_task","projectId":"<id>","mode":"interactive_action","input":"打开衣柜门","selectedIds":["<furniture-id>"]}'
\`\`\`

## 7. 云端验收

- \`/ping\` 健康；
- \`probe\` 调用成功；
- \`run_task\` 动作任务完成；
- 场景项目 revision 正确递增；
- 重复请求幂等；
- 容器重启后无本地状态依赖。

## 8. 回滚

- 记录上一个可用镜像 digest；
- 在 AgentArts Runtime 切回旧 digest；
- 场景数据不在容器内，回滚不需要恢复本地 SQLite；
- 不要删除 SWR 旧镜像，保留至少一个可回退版本。
`;
fs.writeFileSync(path.join(out, "DEPLOY_RUNBOOK.md"), runbook);

let commit = "unknown";
try {
  commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
} catch {
  // git is optional for a source archive.
}

fs.writeFileSync(
  path.join(out, "BUNDLE_MANIFEST.json"),
  JSON.stringify(
    {
      schemaVersion: "actiscape.agentarts-bundle.v1",
      generatedAt: new Date().toISOString(),
      sourceCommit: commit,
      target: "linux/arm64",
      entrypoint: "app:app",
      runtimeEntrypoints: ["app.py", "agent.py", "task_runtime.py"],
      package: "actiscape_agent/",
      python: "3.13-slim",
      files: fs
        .readdirSync(out)
        .sort(),
    },
    null,
    2,
  ) + "\n",
);

let count = 0;
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else count++;
  }
};
walk(out);
console.log(`AgentArts bundle: ${path.relative(root, out)}`);
console.log(`source commit: ${commit}`);
console.log(`files: ${count}`);
console.log(`next: cd ${path.relative(root, out)} && cat DEPLOY_RUNBOOK.md`);
