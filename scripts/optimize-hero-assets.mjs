import fs from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { simplify } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";

const root = path.resolve("apps/editor/public/hero-assets");
const manifestPath = path.join(root, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const entries = new Map(manifest.assets.map((entry) => [entry.id, entry]));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.simplifier": MeshoptSimplifier,
});
await MeshoptSimplifier.ready;

function documentJson(file) {
  const data = fs.readFileSync(file);
  return JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString("utf8").trim());
}
function faceCount(document) {
  return document.meshes.flatMap((mesh) => mesh.primitives).reduce(
    (sum, primitive) => sum + document.accessors[primitive.indices].count / 3,
    0,
  );
}

for (const entry of manifest.assets) {
  const file = path.join(root, `${entry.id}.glb`);
  const before = faceCount(documentJson(file));
  for (let attempt = 0; attempt < 10 && faceCount(documentJson(file)) > 15000; attempt++) {
    const current = faceCount(documentJson(file));
    console.log(`Optimizing ${entry.id}: ${current} -> 15000`);
    const document = await io.read(file);
    await document.transform(
      simplify({
        simplifier: MeshoptSimplifier,
        ratio: 15000 / current,
        error: 1,
        lockBorder: false,
      }),
    );
    await io.write(file, document);
  }
  const document = documentJson(file);
  entry.faces = faceCount(document);
  entry.bytes = fs.statSync(file).size;
  if (entry.faces > 15000) throw new Error(`${entry.id}: ${entry.faces} faces remain`);
  for (const mesh of document.meshes) {
    for (const primitive of mesh.primitives) {
      if (!primitive.attributes.NORMAL && primitive.attributes.TEXCOORD_0 !== undefined)
        throw new Error(`${entry.id}: normals were not preserved`);
      if (document.materials[primitive.material]?.pbrMetallicRoughness?.baseColorTexture && primitive.attributes.TEXCOORD_0 === undefined)
        throw new Error(`${entry.id}: UV coordinates were not preserved`);
    }
  }
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
