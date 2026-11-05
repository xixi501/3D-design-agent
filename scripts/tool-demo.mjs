/** Real HTTP tool example. Usage: ACTISCAPE_URL=http://127.0.0.1:3001 node scripts/tool-demo.mjs [projectId] */
const base = process.env.ACTISCAPE_URL || "http://127.0.0.1:3001";
async function request(url, body) {
  const response = await fetch(
    base + "/api" + url,
    body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(result.message), {
      status: response.status,
      ...result,
    });
  return result;
}
let project = process.argv[2]
  ? await request(`/projects/${process.argv[2]}`)
  : await request("/projects", {
      document: await request("/examples/living-dining"),
    });
const chair = project.plan.furniture.find((f) => f.key === "armchair");
if (!chair) throw Error("Project must contain an armchair");
const requestBody = {
  operationId: crypto.randomUUID(),
  baseRevision: project.revision,
  summary: "工具示例：调整阅读角",
  commands: [
    {
      type: "update",
      collection: "furniture",
      id: chair.id,
      patch: { x: chair.x - 200, rot: (chair.rot + 15) % 360 },
    },
  ],
};
const response = await request(`/projects/${project.id}/commands`, requestBody);
project = response.project;
const retry = await request(`/projects/${project.id}/commands`, requestBody);
if (!retry.replayed) throw Error("Idempotency failed");
try {
  await request(`/projects/${project.id}/commands`, {
    ...requestBody,
    operationId: crypto.randomUUID(),
  });
  throw Error("Expected stale revision to be rejected");
} catch (error) {
  if (error.error !== "REVISION_CONFLICT") throw error;
  console.log("Stale revision correctly rejected:", error.details);
}
const checks = await request(`/projects/${project.id}/checks`);
console.log(
  JSON.stringify(
    {
      projectId: project.id,
      revision: project.revision,
      editedObject: chair.id,
      replayed: retry.replayed,
      checks,
      open: `${base}/?project=${project.id}`,
    },
    null,
    2,
  ),
);
