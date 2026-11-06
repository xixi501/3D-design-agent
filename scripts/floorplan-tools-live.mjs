/** Real DeepSeek same-image probe. Supplies PNG + ordinary request only; never edits/approves geometry. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { blankPlan } from "../packages/scene-core/src/index.ts";
import {
  scoreFloorplan,
  scoreFloorplanRecognition,
  catalogueMappingProof,
} from "../packages/scene-core/src/floorplan-metrics.ts";

const completeV2 = process.argv.includes("--v2-acceptance");
const manifestFile = path.resolve(
  "fixtures/s2c-real/one-bedroom-system-probe.json",
);
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const evaluation = JSON.parse(
  fs.readFileSync(
    completeV2
      ? "fixtures/s2c-real/one-bedroom.v2-evaluation.json"
      : "fixtures/s2c-real/one-bedroom.evaluation-manifest.json",
    "utf8",
  ),
);
const referenceBytes = fs.readFileSync(
  path.join("fixtures/s2c-real", evaluation.referenceFile),
);
assert.equal(
  createHash("sha256").update(referenceBytes).digest("hex"),
  evaluation.referenceSha256,
);
const reference = JSON.parse(referenceBytes);
const inputFile = process.argv[2];
if (!inputFile)
  throw Error(
    "Usage: npm run test:floorplan:tools:live -- /absolute/path/to/original.png [1|2]",
  );
const repeats = Number(process.argv[3] || 2);
assert.ok(Number.isInteger(repeats) && repeats >= 1 && repeats <= 2);
const bytes = fs.readFileSync(inputFile);
assert.equal(
  createHash("sha256").update(bytes).digest("hex"),
  manifest.sha256,
  "Use the frozen original, not a substituted/corrected image",
);
const base = (
  process.env.ACTISCAPE_SCENE_URL || "http://127.0.0.1:3001"
).replace(/\/$/, "");
const out = path.resolve(
  "test-results/floorplan-tool-live",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
fs.mkdirSync(out, { recursive: true });
const save = (file, value) =>
  fs.writeFileSync(path.join(out, file), JSON.stringify(value, null, 2) + "\n");
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
const health = await api("/agent/health");
assert.equal(health.modelConfigured, true);
const codeCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
assert.equal(
  health.versions.workingTreeModified,
  false,
  "Restart a clean fixed business version before a live comparison",
);
assert.equal(
  health.versions.codeCommit,
  codeCommit,
  "Server must run the frozen HEAD",
);
const context = {
  manifest,
  evaluation,
  codeCommit,
  serviceVersions: health.versions,
  referenceSentToAgent: false,
  manualGeometryOperations: 0,
  completeS2Accepted: false,
};
save("manifest.json", context);
const form = new FormData();
form.append(
  "file",
  new Blob([bytes], { type: "image/png" }),
  "public-one-bedroom-original.png",
);
const uploaded = await fetch(base + "/api/floorplan-images", {
  method: "POST",
  body: form,
});
assert.ok(uploaded.ok);
const image = await uploaded.json();
save("image.json", image);
const results = [];
for (let repeat = 1; repeat <= repeats; repeat++) {
  const plan = blankPlan();
  plan.name = `系统实测 · 原版读图工具 · ${repeat}`;
  const before = await api("/projects", {
    document: { formatVersion: 1, plan, roomLabelArchive: [] },
  });
  const conversation = await api("/agent/conversations", {
    projectId: before.id,
  });
  const request = {
    requestId: randomUUID(),
    mode: "reconstruct_floorplan",
    imageId: image.id,
    input: manifest.userRequest,
    selectedIds: [],
  };
  let task = await api(
    `/agent/conversations/${conversation.id}/tasks`,
    request,
  );
  save(`${repeat}-accepted.json`, {
    projectId: before.id,
    taskId: task.id,
    conversationId: conversation.id,
    request,
  });
  console.log(
    JSON.stringify({ repeat, projectId: before.id, taskId: task.id }),
  );
  const deadline = Date.now() + 720000;
  while (
    ["queued", "running", "committing"].includes(task.status) &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    task = await api(`/agent/tasks/${task.id}`);
  }
  const trace = await api(`/agent/tasks/${task.id}/trace`),
    after = await api(`/projects/${before.id}`);
  assert.deepEqual(after.plan, before.plan);
  assert.equal(after.revision, 0);
  assert.deepEqual(after.history, { undo: 0, redo: 0 });
  const record = { before, task, trace, after };
  if (task.generation?.draftId) {
    record.draft = await api(
      `/projects/${before.id}/floorplan-drafts/${task.generation.draftId}`,
    );
    record.preview = await api(
      `/projects/${before.id}/floorplan-drafts/${task.generation.draftId}/preview`,
      { taskId: task.id },
    );
    const overlay = await fetch(
      `${base}/api/projects/${before.id}/floorplan-drafts/${task.generation.draftId}/overlay`,
    );
    if (overlay.ok)
      fs.writeFileSync(
        path.join(out, `${repeat}-system-overlay.png`),
        Buffer.from(await overlay.arrayBuffer()),
      );
  }
  const evidenceRecords = [
    ...(task.generation?.upstreamTools || []).map((e) => e.record),
    ...Object.values(task.generation?.evidenceIndex || {}),
  ];
  const fetched = new Set();
  for (const entry of evidenceRecords)
    for (const file of entry.files || []) {
      if (fetched.has(file.path)) continue;
      fetched.add(file.path);
      const response = await fetch(base + "/api" + file.path);
      assert.ok(response.ok);
      const data = Buffer.from(await response.arrayBuffer());
      assert.equal(
        createHash("sha256").update(data).digest("hex"),
        file.sha256,
      );
      fs.writeFileSync(
        path.join(
          out,
          `${repeat}-${entry.id}-${file.name || file.sha256 + ".png"}`,
        ),
        data,
      );
    }
  save(`${repeat}-result.json`, record);
  let scoring = { passed: false, reason: "No complete draft" };
  let firstRecognition;
  const raw = task.generation?.rawRecognition;
  if (raw) {
    const recognition = { ...raw, image: reference.image };
    delete recognition.status;
    delete recognition.question;
    firstRecognition = scoreFloorplanRecognition(
      recognition,
      reference,
      evaluation.aliases,
    );
    if (record.draft) {
      try {
        scoring = scoreFloorplan(
          recognition,
          record.draft.data,
          reference,
          record.draft.corrections,
          evaluation.aliases,
        );
      } catch (error) {
        scoring = { passed: false, reason: error.message };
      }
    }
  }
  let workflow = { passed: false, confirmationSimulated: false };
  if (
    completeV2 &&
    scoring.passed &&
    record.preview?.checks?.passed &&
    record.draft.corrections === 0 &&
    record.draft.sourceReview?.hash === record.draft.hash &&
    record.draft.sourceReview.review.passed
  ) {
    try {
      workflow.confirmationSimulated = true;
      task = await api(`/agent/tasks/${task.id}/confirm-floorplan`, {
        requestId: randomUUID(),
        draftId: record.draft.id,
        draftRevision: record.draft.revision,
        draftHash: record.draft.hash,
      });
      const wait = async (id) => {
        let t = await api("/agent/tasks/" + id);
        const deadline = Date.now() + 720000;
        while (
          ["queued", "running", "committing"].includes(t.status) &&
          Date.now() < deadline
        ) {
          await new Promise((r) => setTimeout(r, 1000));
          t = await api("/agent/tasks/" + id);
        }
        return t;
      };
      task = await wait(task.id);
      record.task = task;
      record.trace = await api("/agent/tasks/" + task.id + "/trace");
      record.after = await api("/projects/" + before.id);
      if (task.status === "completed") {
        const saved = record.after;
        assert.equal(saved.revision, 1);
        assert.equal(
          (await api("/projects/" + before.id + "/history")).entries.length,
          1,
        );
        record.catalogueProof = catalogueMappingProof(
          saved.plan,
          reference,
          scoring.confirmed.layout,
          evaluation.allowedCatalogueKeys,
        );
        const { geometryProof } = await import("./floorplan-geometry.mjs");
        const candidate = await api(
          `/projects/${before.id}/candidates/${task.result.candidateId}`,
        );
        record.geometry = await geometryProof(base, before.id, candidate);
        await api("/projects/" + before.id + "/undo", {
          operationId: randomUUID(),
          baseRevision: 1,
        });
        assert.equal(
          (await api("/projects/" + before.id)).plan.walls.length,
          0,
        );
        await api("/projects/" + before.id + "/redo", {
          operationId: randomUUID(),
          baseRevision: 2,
        });
        assert.deepEqual(
          (await api("/projects/" + before.id)).plan,
          saved.plan,
        );
        const object = saved.plan.furniture.find(
          (f) => f.key === "coffeeTable",
        );
        assert.ok(object);
        let edit = await api(`/agent/conversations/${conversation.id}/tasks`, {
          requestId: randomUUID(),
          input:
            "只把选中的茶几颜色改为 #2458a6，保持位置、尺寸、墙体、门窗和其他家具不变。",
          selectedIds: [object.id],
        });
        edit = await wait(edit.id);
        record.localEdit = {
          task: edit,
          trace: await api("/agent/tasks/" + edit.id + "/trace"),
        };
        if (edit.status === "completed") {
          const changed = await api("/projects/" + before.id);
          assert.equal(
            changed.plan.furniture.find((f) => f.id === object.id).color,
            "#2458a6",
          );
          const restored = structuredClone(changed.plan);
          restored.furniture.find((f) => f.id === object.id).color =
            object.color;
          if (object.color === undefined)
            delete restored.furniture.find((f) => f.id === object.id).color;
          assert.deepEqual(restored, saved.plan);
          record.after = changed;
          const roles = new Set(
            record.trace
              .filter((e) => e.kind === "agent_start")
              .map((e) => e.data.role),
          );
          workflow.passed =
            record.catalogueProof.passed &&
            record.geometry.passed &&
            ["main", "assets", "design", "check"].every((r) => roles.has(r));
        }
      }
    } catch (error) {
      workflow.error = error.message;
      record.after = await api("/projects/" + before.id);
      record.task = await api("/agent/tasks/" + task.id);
      record.trace = await api("/agent/tasks/" + task.id + "/trace");
      task = record.task;
    }
    save(`${repeat}-result.json`, record);
  }
  save(`${repeat}-scoring.json`, {
    firstRecognition,
    scoring,
    zeroObjectCorrections: (record.draft?.corrections || 0) === 0,
    completeFourRoleWorkflow: workflow.passed,
    workflow,
  });
  const result = {
    repeat,
    projectId: before.id,
    taskId: task.id,
    status: task.status,
    error: task.error,
    errorCode: task.result?.errorCode,
    modelCalls: task.modelCalls,
    activeSeconds: task.elapsedSeconds,
    compilationPassed: record.preview?.checks?.passed === true,
    firstRecognition,
    scoring,
    completeV2,
    toolRoles: [
      ...new Set(
        (task.generation?.upstreamTools || []).map(
          (t) => t.role + ":" + t.tool,
        ),
      ),
    ],
    repairs: task.generation?.repairsUsed || 0,
    formalRevision: record.after.revision,
    imageFidelityAccepted: workflow.passed,
    workflow,
    manualGeometryOperations: 0,
  };
  results.push(result);
  save("report.json", { ...context, results });
  console.log(JSON.stringify(result));
}
console.log(
  JSON.stringify({
    output: out,
    compilationPasses: results.filter((r) => r.compilationPassed).length,
    total: results.length,
    imageFidelityAccepted:
      results.length === 2 && results.every((r) => r.imageFidelityAccepted),
    note: "Compilation is not image-fidelity acceptance; independently review all outputs and failures.",
  }),
);
