import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  FLOORPLAN_VISION_ARTIFACT_SCHEMA,
  validateFloorplanVisionArtifact,
  type FloorplanVisionArtifact,
  type PixelDimensionCandidate,
  type PixelOpeningCandidate,
  type PixelWallCandidate,
  type VisionEvidenceFile,
} from "../../packages/scene-core/src/vision-artifact.js";
import {
  parseArgs,
  readJson,
  relativePath,
  sha256,
  writeSealedJson,
} from "./artifact-seal.js";

const root = process.cwd();
const python = path.join(root, ".venv/bin/python");
const worker = path.join(root, "scripts/quality/candidate_worker.py");
const setpriv = "/usr/bin/setpriv";
const fixtureRoot = path.join(root, "fixtures/full-home-candidates");
const defaultAdapter = "hpd-adapter-6-1";

type Scope = FloorplanVisionArtifact["scope"];

interface ProviderImageFile {
  data: string;
  type: string;
}

function finite(value: unknown, name: string, minimum = -1e7): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum)
    throw new Error(`${name} 不是有效有限数字`);
  return value;
}

function asObject(value: unknown, name: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${name} 必须是对象`);
  return value as Record<string, any>;
}

function asArray(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} 必须是数组`);
  return value;
}

function commandEnvironment(jobRoot: string, forbiddenRoot: string) {
  const temp = path.join(jobRoot, "tmp");
  fs.mkdirSync(temp, { recursive: true, mode: 0o777 });
  fs.chmodSync(jobRoot, 0o777);
  fs.chmodSync(temp, 0o777);
  return {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: jobRoot,
    TMPDIR: temp,
    PYTHONPATH: [
      path.join(root, "apps/agent"),
      path.join(root, "apps/agent/actiscape_agent"),
    ].join(path.delimiter),
    PYTHONHASHSEED: "0",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    MPLCONFIGDIR: temp,
    NUMBA_CACHE_DIR: temp,
    ACTISCAPE_FORBIDDEN_EVIDENCE_ROOT: forbiddenRoot,
  };
}

function runAsNobody(
  arguments_: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; input?: string },
) {
  return spawnSync(
    setpriv,
    [
      "--no-new-privs",
      "--reuid=65534",
      "--regid=65534",
      "--clear-groups",
      ...arguments_,
    ],
    {
      cwd: options.cwd,
      env: options.env,
      input: options.input,
      encoding: "utf8",
      timeout: 240_000,
      maxBuffer: 128 * 1024 * 1024,
    },
  );
}

function ensureRootIsolation() {
  if (!fs.existsSync(setpriv))
    throw new Error("CANDIDATE_ISOLATION_UNAVAILABLE: 缺少 setpriv");
  if (process.getuid?.() !== 0)
    throw new Error(
      "CANDIDATE_ISOLATION_UNAVAILABLE: 需要 root 以切换到无权限用户",
    );
}

function probeReferenceDenied(
  referenceFile: string,
  jobRoot: string,
  forbiddenRoot: string,
) {
  const code = [
    "import os, sys",
    "try:",
    "    descriptor = os.open(sys.argv[1], os.O_RDONLY)",
    "except PermissionError:",
    "    print('denied')",
    "    raise SystemExit(0)",
    "except OSError as error:",
    "    print(type(error).__name__ + ': ' + str(error))",
    "    raise SystemExit(2)",
    "else:",
    "    os.close(descriptor)",
    "    print('readable')",
    "    raise SystemExit(3)",
  ].join("\n");
  const result = runAsNobody([python, "-c", code, referenceFile], {
    cwd: jobRoot,
    env: commandEnvironment(jobRoot, forbiddenRoot),
  });
  if (result.status !== 0 || !result.stdout.includes("denied"))
    throw new Error(
      `REFERENCE_ACCESS_NOT_DENIED: ${result.stderr || result.stdout}`,
    );
  return {
    result: "denied",
    probeUser: "65534:65534",
  };
}

function saveEvidenceFiles(
  outputDirectory: string,
  files: Record<string, ProviderImageFile>,
) {
  const directory = path.join(outputDirectory, "artifacts");
  fs.mkdirSync(directory, { recursive: true });
  const saved: VisionEvidenceFile[] = [];
  for (const [name, artifact] of Object.entries(files)) {
    if (!artifact || typeof artifact.data !== "string")
      throw new Error(`provider 文件 ${name} 缺少 base64 数据`);
    const bytes = Buffer.from(artifact.data, "base64");
    const file = path.join(directory, name);
    fs.writeFileSync(file, bytes);
    saved.push({
      id: name,
      kind:
        name === "candidates.png"
          ? "overlay"
          : name.includes("mask")
            ? "mask"
            : "diagnostic",
      path: relativePath(outputDirectory, file),
      sha256: sha256(bytes),
      mediaType:
        artifact.type === "application/json" ? "application/json" : "image/png",
    });
  }
  return saved.sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeWalls(value: unknown): PixelWallCandidate[] {
  return asArray(value, "candidateWalls").map((raw, index) => {
    const candidate = asObject(raw, `candidateWalls.${index}`);
    const orientation =
      candidate.orient === "v" ? "v" : candidate.orient === "h" ? "h" : null;
    if (!orientation) throw new Error(`candidateWalls.${index}.orient 无效`);
    const start = finite(candidate.s0, `candidateWalls.${index}.s0`);
    const end = finite(candidate.s1, `candidateWalls.${index}.s1`);
    if (end <= start) throw new Error(`candidateWalls.${index} 端点无效`);
    return {
      id: String(candidate.candidateWallId),
      orientation,
      line: finite(candidate.line, `candidateWalls.${index}.line`),
      start,
      end,
      thickness: finite(candidate.t, `candidateWalls.${index}.t`, 0.001),
      ...(typeof candidate.confidence === "number"
        ? { confidence: candidate.confidence }
        : {}),
      evidenceRefs: [
        `provider:wall:${candidate.candidateWallId}`,
        "artifact:wallmask.png",
      ],
    };
  });
}

function normalizeOpenings(value: unknown): PixelOpeningCandidate[] {
  return asArray(value, "openingCandidates").map((raw, index) => {
    const candidate = asObject(raw, `openingCandidates.${index}`);
    const orientation =
      candidate.orient === "v" ? "v" : candidate.orient === "h" ? "h" : null;
    if (!orientation) throw new Error(`openingCandidates.${index}.orient 无效`);
    const typeHint = ["door", "window", "sliding", "hole"].includes(
      candidate.typeHint,
    )
      ? candidate.typeHint
      : "unknown";
    return {
      id: String(candidate.candidateId),
      wallCandidateId:
        typeof candidate.candidateWallId === "string"
          ? candidate.candidateWallId
          : null,
      orientation,
      line: finite(candidate.line, `openingCandidates.${index}.line`),
      start: finite(candidate.start, `openingCandidates.${index}.start`),
      end: finite(candidate.end, `openingCandidates.${index}.end`),
      typeHint,
      ...(typeof candidate.confidence === "number"
        ? { confidence: candidate.confidence }
        : {}),
      evidenceRefs: [
        `provider:opening:${candidate.candidateId}`,
        "artifact:candidates.png",
      ],
    };
  });
}

function normalizeDimensions(value: unknown): PixelDimensionCandidate[] {
  return asArray(value, "dimensionCandidates").map((raw, index) => {
    const candidate = asObject(raw, `dimensionCandidates.${index}`);
    const axis =
      candidate.axis === "v" ? "v" : candidate.axis === "h" ? "h" : null;
    if (!axis) throw new Error(`dimensionCandidates.${index}.axis 无效`);
    const side = ["top", "bottom", "left", "right"].includes(candidate.side)
      ? candidate.side
      : "unknown";
    const a = asObject(candidate.a, `dimensionCandidates.${index}.a`);
    const b = asObject(candidate.b, `dimensionCandidates.${index}.b`);
    const start = finite(a.x, `dimensionCandidates.${index}.a.x`);
    const end = finite(b.x, `dimensionCandidates.${index}.b.x`);
    if (axis === "v") {
      const verticalStart = finite(a.y, `dimensionCandidates.${index}.a.y`);
      const verticalEnd = finite(b.y, `dimensionCandidates.${index}.b.y`);
      return {
        id: String(candidate.candidateId),
        axis,
        side,
        at: start,
        start: Math.min(verticalStart, verticalEnd),
        end: Math.max(verticalStart, verticalEnd),
        unitHint:
          typeof candidate.unitHint === "string" ? candidate.unitHint : null,
        ...(typeof candidate.confidence === "number"
          ? { confidence: candidate.confidence }
          : {}),
        evidenceRefs: [`provider:dimension:${candidate.candidateId}`],
      };
    }
    return {
      id: String(candidate.candidateId),
      axis,
      side,
      at: finite(a.y, `dimensionCandidates.${index}.a.y`),
      start: Math.min(start, end),
      end: Math.max(start, end),
      unitHint:
        typeof candidate.unitHint === "string" ? candidate.unitHint : null,
      ...(typeof candidate.confidence === "number"
        ? { confidence: candidate.confidence }
        : {}),
      evidenceRefs: [`provider:dimension:${candidate.candidateId}`],
    };
  });
}

function loadScope(value: string | undefined): Scope {
  if (!value) {
    return {
      roomSelection: "all_visible",
      functionalAreas: [],
      excludeFunctionalAreas: [],
    };
  }
  const parsed = value.trim().startsWith("{")
    ? JSON.parse(value)
    : readJson(value);
  const scope = asObject(parsed, "scope");
  return {
    roomSelection:
      scope.roomSelection === "selected" ? "selected" : "all_visible",
    functionalAreas: asArray(
      scope.functionalAreas || [],
      "scope.functionalAreas",
    ).map(String),
    excludeFunctionalAreas: asArray(
      scope.excludeFunctionalAreas || [],
      "scope.excludeFunctionalAreas",
    ).map(String),
  };
}

function main() {
  const args = parseArgs();
  const imageFile = path.resolve(args.required("image"));
  const outputDirectory = path.resolve(
    args.get("output") ||
      path.join(
        root,
        "test-results/floorplan-quality",
        path.basename(imageFile, path.extname(imageFile)),
      ),
  );
  const imageId =
    args.get("id") || path.basename(imageFile, path.extname(imageFile));
  const adapterVersion = args.get("adapter") || defaultAdapter;
  const scope = loadScope(args.get("scope"));
  const image = fs.readFileSync(imageFile);
  const imageSha256 = sha256(image);
  const referenceFile = path.join(
    fixtureRoot,
    `${imageId}.evaluation-only.json`,
  );
  if (!fs.existsSync(referenceFile))
    throw new Error(
      `缺少 ${path.basename(referenceFile)}，无法执行参考不可见探针`,
    );
  ensureRootIsolation();

  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(outputDirectory, { recursive: true });
  const sourceCopy = path.join(
    outputDirectory,
    `source${path.extname(imageFile).toLowerCase() || ".img"}`,
  );
  fs.writeFileSync(sourceCopy, image);

  const originalMode = fs.statSync(fixtureRoot).mode & 0o777;
  const jobRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "actiscape-floorplan-quality-"),
  );
  try {
    fs.chmodSync(fixtureRoot, 0o700);
    const probe = probeReferenceDenied(referenceFile, jobRoot, fixtureRoot);
    const payload = JSON.stringify({
      mode: "analyze",
      adapterVersion,
      parameters: {},
      scope,
      image: image.toString("base64"),
    });
    const result = runAsNobody([python, worker], {
      cwd: jobRoot,
      env: commandEnvironment(jobRoot, fixtureRoot),
      input: payload,
    });
    if (result.status !== 0)
      throw new Error(`候选进程失败：${result.stderr || result.stdout}`);
    const response = JSON.parse(result.stdout);
    if (response.error)
      throw new Error(
        `候选进程返回 ${response.error}: ${response.message || "unknown"}`,
      );
    const providerResult = asObject(response.result, "result");
    const size = asArray(providerResult.size, "result.size");
    if (size.length !== 2) throw new Error("provider 没有返回图片尺寸");
    const width = finite(size[0], "result.size[0]", 1);
    const height = finite(size[1], "result.size[1]", 1);
    const evidenceFiles = saveEvidenceFiles(
      outputDirectory,
      asObject(response.files || {}, "files") as Record<
        string,
        ProviderImageFile
      >,
    );
    const walls = normalizeWalls(providerResult.candidateWalls || []);
    const openings = normalizeOpenings(providerResult.openingCandidates || []);
    const dimensions = normalizeDimensions(
      providerResult.dimensionCandidates || [],
    );
    const artifact: FloorplanVisionArtifact = validateFloorplanVisionArtifact({
      schemaVersion: FLOORPLAN_VISION_ARTIFACT_SCHEMA,
      artifactId: `hpd:${imageSha256.slice(0, 16)}`,
      provider: {
        id: "house-plan-designer-hpd",
        version: String(response.adapterVersion || adapterVersion),
        repository: String(response.repository),
        commit: String(response.commit),
        license: String(response.license),
      },
      input: {
        imageSha256,
        width,
        height,
        coordinateSpace: "exif-oriented-original-pixels",
      },
      scope,
      capabilities: {
        walls: true,
        openings: true,
        dimensions: true,
        rooms: false,
        symbols: false,
      },
      candidates: {
        walls,
        openings,
        dimensions,
        rooms: [],
        symbols: [],
      },
      evidenceFiles,
      limitations: [
        ...asArray(response.limitations || [], "limitations").map(String),
        "本批次不测量房间区域、家具对象或最终选择质量",
      ],
      audit: {
        modelCalls: 0,
        referenceAccess: "denied-and-audited",
        candidateInputs: ["image.bytes", "scope", "adapterVersion"],
      },
    });
    const artifactFile = path.join(outputDirectory, "candidate-artifact.json");
    const artifactSha256 = writeSealedJson(artifactFile, artifact);
    const capture = {
      schemaVersion: "actiscape.floorplan-quality-capture.v1",
      status: "sealed",
      generatedAt: new Date().toISOString(),
      image: {
        id: imageId,
        file: relativePath(outputDirectory, sourceCopy),
        sha256: imageSha256,
        width,
        height,
      },
      adapterVersion,
      artifact: {
        file: relativePath(outputDirectory, artifactFile),
        sha256: artifactSha256,
        schemaVersion: artifact.schemaVersion,
        provider: artifact.provider,
        candidateCounts: {
          walls: walls.length,
          openings: openings.length,
          dimensions: dimensions.length,
          rooms: 0,
          symbols: 0,
        },
      },
      isolation: {
        mode: "unprivileged-user+directory-permission+python-audit-hook",
        candidateUser: "65534:65534",
        referenceRoot: relativePath(root, fixtureRoot),
        referenceProbe: probe,
        candidateReferenceRootAccess: "denied",
        audit: asObject(response._qualityGuard || {}, "_qualityGuard"),
      },
      modelCalls: 0,
      candidateInput: [
        "image.bytes",
        "image.sha256",
        "scope",
        "adapterVersion",
      ],
    };
    const captureFile = path.join(outputDirectory, "capture.json");
    const captureSha256 = writeSealedJson(captureFile, capture);
    console.log(
      JSON.stringify(
        {
          status: capture.status,
          imageId,
          artifactFile: path.relative(root, artifactFile),
          artifactSha256,
          captureFile: path.relative(root, captureFile),
          captureSha256,
          candidateCounts: capture.artifact.candidateCounts,
          isolation: capture.isolation.mode,
          modelCalls: 0,
        },
        null,
        2,
      ),
    );
  } finally {
    fs.chmodSync(fixtureRoot, originalMode);
    fs.rmSync(jobRoot, { recursive: true, force: true });
  }
}

main();
