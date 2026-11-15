import fs from "node:fs";
import path from "node:path";
const [file, projectId, x = "2200", y = "2200", z = "420"] =
  process.argv.slice(2);
if (!file || !projectId)
  throw Error(
    "Usage: node scripts/import-asset.mjs model.glb projectId [x_mm y_mm z_mm]",
  );
const base = process.env.ACTISCAPE_URL || "http://127.0.0.1:3131";
async function response(r) {
  const json = await r.json();
  if (!r.ok) throw Error(JSON.stringify(json));
  return json;
}
const data = new FormData();
data.append("file", new Blob([fs.readFileSync(file)]), path.basename(file));
const asset = await response(
  await fetch(base + "/api/assets", { method: "POST", body: data }),
);
const project = await response(
  await fetch(`${base}/api/projects/${projectId}`),
);
const object = {
  id: crypto.randomUUID(),
  key: `model:${asset.id}`,
  type: "model",
  modelId: asset.id,
  name: asset.name,
  x: Number(x),
  y: Number(y),
  z: Number(z),
  rot: 0,
  w: asset.w,
  d: asset.d,
  h: asset.h,
  color: "#ffffff",
};
const result = await response(
  await fetch(`${base}/api/projects/${projectId}/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operationId: crypto.randomUUID(),
      baseRevision: project.revision,
      summary: "导入成员二资产",
      commands: [{ type: "add", collection: "furniture", object }],
    }),
  }),
);
console.log(
  JSON.stringify(
    { asset, objectId: object.id, revision: result.project.revision },
    null,
    2,
  ),
);
