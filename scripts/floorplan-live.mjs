import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { geometryProof } from "./floorplan-geometry.mjs";
import {
  scoreFloorplan,
  catalogueMappingProof,
} from "../packages/scene-core/src/floorplan-metrics.ts";
import {
  validateFloorplan,
  checkFloorplanInitialization,
  compileFloorplan,
} from "../packages/scene-core/src/floorplan.ts";
import { blankPlan } from "../packages/scene-core/src/index.ts";
const option = (key, fallback) => {
  const i = process.argv.indexOf("--" + key);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const stage = option("stage", "start"),
  base = (process.env.ACTISCAPE_URL || "http://127.0.0.1:3001").replace(
    /\/$/,
    "",
  ),
  sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function api(route, body) {
  const response = await fetch(
    base + "/api" + route,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const value = await response.json();
  if (!response.ok) throw Error(JSON.stringify(value));
  return value;
}
const save = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
};
if (stage === "start") {
  const manifestFile = path.resolve(
    option("manifest", "fixtures/s2c-real/manifest.json"),
  );
  if (!fs.existsSync(manifestFile)) {
    console.error(
      "PENDING: two real images and a frozen manual reference manifest are required. See fixtures/s2c-real/README.md",
    );
    process.exitCode = 2;
  } else {
    const manifestBytes = fs.readFileSync(manifestFile),
      manifest = JSON.parse(manifestBytes),
      cases = manifest.cases;
    if (!Array.isArray(cases) || cases.length !== 2)
      throw Error("Exactly two real image cases are required");
    const directory = path.resolve(
        "test-results/floorplan-live",
        new Date().toISOString().replace(/[:.]/g, "-"),
      ),
      indexFile = path.join(directory, "run-index.json");
    const index = {
      base,
      createdAt: new Date().toISOString(),
      manifestFile,
      manifestHash: sha(manifestBytes),
      aliases: manifest.aliases || {},
      runs: [],
      completeS2Accepted: false,
    };
    const prepared = [];
    const catalogue = (await api("/catalog")).items;
    for (const item of cases) {
      const imageFile = path.resolve(path.dirname(manifestFile), item.image),
        referenceFile = path.resolve(
          path.dirname(manifestFile),
          item.reference,
        ),
        bytes = fs.readFileSync(imageFile),
        referenceHash = sha(fs.readFileSync(referenceFile));
      const form = new FormData();
      form.append("file", new Blob([bytes]), path.basename(imageFile));
      const response = await fetch(base + "/api/floorplan-images", {
          method: "POST",
          body: form,
        }),
        image = await response.json();
      if (!response.ok) throw Error(JSON.stringify(image));
      const reference = JSON.parse(fs.readFileSync(referenceFile));
      if (
        reference.image.id !== image.id ||
        reference.image.sha256 !== image.sha256 ||
        reference.image.width !== image.width ||
        reference.image.height !== image.height
      )
        throw Error(
          "Reference image identity/dimensions must match the uploaded oriented image before starting model tasks",
        );
      compileFloorplan(reference, "reference-validation");
      const allowedCatalogueKeys = item.allowedCatalogueKeys || {};
      for (const symbol of reference.symbols.filter((s) =>
        reference.targetRoomIds.includes(s.roomId),
      )) {
        const keys =
          allowedCatalogueKeys[symbol.id] ||
          (symbol.catalogKey ? [symbol.catalogKey] : []);
        if (
          !Array.isArray(keys) ||
          !keys.length ||
          keys.some((k) => !Object.hasOwn(catalogue, k))
        )
          throw Error(
            "Freeze allowed real catalogue keys for every reference target symbol before running: " +
              symbol.id,
          );
      }
      prepared.push({
        item,
        image,
        imageFile,
        referenceFile,
        bytes,
        referenceHash,
        allowedCatalogueKeys,
      });
    }
    if (new Set(prepared.map((p) => p.image.sha256)).size !== 2)
      throw Error(
        "Two distinct real images are required, not repeated copies of one image",
      );
    const synthetic = sha(fs.readFileSync("fixtures/s2c-synthetic.png"));
    if (prepared.some((p) => p.image.sha256 === synthetic))
      throw Error(
        "The labelled synthetic tool fixture cannot count as a real floorplan case",
      );
    for (const {
      item,
      image,
      imageFile,
      referenceFile,
      bytes,
      referenceHash,
      allowedCatalogueKeys,
    } of prepared) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        const project = await api("/projects", {}),
          conversation = await api("/agent/conversations", {
            projectId: project.id,
          }),
          task = await api(`/agent/conversations/${conversation.id}/tasks`, {
            requestId: crypto.randomUUID(),
            mode: "reconstruct_floorplan",
            imageId: image.id,
            input:
              "请识别这张单层户型图，保留整层结构并复现客餐厅原图家具布局，先提供草稿供我确认。",
            selectedIds: [],
          });
        const run = {
          name: item.name,
          attempt,
          imageFile,
          imageHash: sha(bytes),
          referenceFile,
          referenceHash,
          allowedCatalogueKeys,
          projectId: project.id,
          taskId: task.id,
          url: base + "/?project=" + project.id,
        };
        index.runs.push(run);
        save(indexFile, index);
        console.log(JSON.stringify(run));
      }
    }
    console.log(
      JSON.stringify({
        status: "awaiting_recognition_and_operator_confirmation",
        indexFile,
        completeS2Accepted: false,
      }),
    );
  }
} else if (stage === "collect") {
  const file = path.resolve(
      option("index", "test-results/floorplan-live/run-index.json"),
    ),
    index = JSON.parse(fs.readFileSync(file));
  if (sha(fs.readFileSync(index.manifestFile)) !== index.manifestHash)
    throw Error("Frozen manifest changed; create a new batch");
  const reports = [];
  for (const run of index.runs) {
    if (
      sha(fs.readFileSync(run.referenceFile)) !== run.referenceHash ||
      sha(fs.readFileSync(run.imageFile)) !== run.imageHash
    )
      throw Error("Frozen input/reference changed");
    const task = await api("/agent/tasks/" + run.taskId),
      trace = await api("/agent/tasks/" + run.taskId + "/trace");
    if (task.status !== "completed") {
      reports.push({
        ...run,
        passed: false,
        pending: ["queued", "running", "waiting_input", "committing"].includes(
          task.status,
        ),
        task,
        trace,
      });
      continue;
    }
    const candidate = await api(
        `/projects/${run.projectId}/candidates/${task.result.candidateId}`,
      ),
      revisions = await api(
        `/projects/${run.projectId}/floorplan-drafts/${candidate.generation.draftId}/revisions`,
      ),
      image = await api("/floorplan-images/" + task.generation.imageId);
    const original = task.generation.rawRecognition || revisions[0].data,
      raw = {
        ...original,
        image: {
          id: image.id,
          sha256: image.sha256,
          width: image.width,
          height: image.height,
        },
      };
    delete raw.status;
    delete raw.question;
    const reference = JSON.parse(fs.readFileSync(run.referenceFile)),
      confirmed = candidate.floorplan.data;
    let rawValid = true;
    try {
      validateFloorplan(raw);
    } catch {
      rawValid = false;
    }
    const geometry = await geometryProof(base, run.projectId, candidate);
    const scores = scoreFloorplan(
      raw,
      confirmed,
      reference,
      candidate.generation.corrections,
      index.aliases,
    );
    const catalogueMapping = catalogueMappingProof(
      candidate.state.plan,
      reference,
      scores.confirmed.layout,
      run.allowedCatalogueKeys || {},
    );
    const checks = checkFloorplanInitialization(
      { plan: blankPlan(), roomLabelArchive: [] },
      candidate.state,
      confirmed,
      candidate.taskId,
      candidate.floorplan.binding,
      candidate.floorplan.matches,
    );
    const roleEvents = trace.filter((e) => e.kind === "agent_start"),
      roles = new Set(roleEvents.map((e) => e.data.role)),
      runtime = trace.find((e) => e.kind === "runtime")?.data;
    const realRoles =
      ["main", "assets", "design", "check"].every((role) => roles.has(role)) &&
      !roleEvents.some((e) => e.data.controlled) &&
      runtime?.modelProvider === "api.deepseek.com";
    const evidence = [];
    for (const e of candidate.evidence) {
      const bytes = Buffer.from(
        await (
          await fetch(
            base +
              `/api/projects/${run.projectId}/candidates/${candidate.id}/evidence/${e.view}`,
          )
        ).arrayBuffer(),
      );
      const valid =
        sha(bytes) === e.sha256 && e.candidateHash === candidate.hash;
      evidence.push({ ...e, valid });
      fs.writeFileSync(
        path.join(
          path.dirname(file),
          `${run.name}-${run.attempt}-${e.view}.png`,
        ),
        bytes,
      );
    }
    const passed =
      rawValid &&
      geometry.passed &&
      catalogueMapping.passed &&
      scores.passed &&
      checks.passed &&
      realRoles &&
      candidate.committed !== null &&
      candidate.review?.passed &&
      evidence.length === 2 &&
      evidence.every((e) => e.valid);
    reports.push({
      ...run,
      passed,
      pending: false,
      rawValid,
      geometry,
      catalogueMapping,
      scores,
      checks,
      realRoles,
      evidence,
      task,
      trace,
      raw,
      confirmed,
    });
  }
  const pending = reports.some((r) => r.pending),
    passed = reports.length === 4 && reports.every((r) => r.passed);
  save(path.join(path.dirname(file), "report.json"), {
    passed,
    pending,
    completeS2Accepted: false,
    realImageMatrixPassed: passed,
    reports,
  });
  console.log(
    JSON.stringify({
      passed,
      pending,
      realImageMatrixPassed: passed,
      completeS2Accepted: false,
      output: path.join(path.dirname(file), "report.json"),
    }),
  );
  process.exitCode = passed ? 0 : pending ? 2 : 1;
} else throw Error("stage must be start or collect");
