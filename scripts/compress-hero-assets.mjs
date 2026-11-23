import fs from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { meshopt, textureCompress } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

const root = path.resolve("apps/editor/public/hero-assets");
const backup = path.resolve("/workspace/actiscape-data/handoff/hero-uncompressed");
const manifestPath = path.join(root, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.encoder": MeshoptEncoder,
});
await MeshoptEncoder.ready;
let before = 0;
let after = 0;
for (const entry of manifest.assets) {
  const file = path.join(root, `${entry.id}.glb`);
  const originalBytes = fs.statSync(file).size;
  before += originalBytes;
  const backupFile = path.join(backup, `${entry.id}.glb`);
  if (!fs.existsSync(backupFile)) fs.copyFileSync(file, backupFile);
  const document = await io.read(file);
  await document.transform(
    textureCompress({ encoder: sharp, targetFormat: "webp", quality: 88, effort: 70 }),
    meshopt({ encoder: MeshoptEncoder, level: "high" }),
  );
  await io.write(file, document);
  entry.bytes = fs.statSync(file).size;
  after += entry.bytes;
  console.log(`${entry.id}: ${(originalBytes / 1048576).toFixed(2)} -> ${(entry.bytes / 1048576).toFixed(2)} MB`);
}
manifest.compression = {
  geometry: "EXT_meshopt_compression",
  texture: "image/webp",
  quality: 88,
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ beforeMB: before / 1048576, afterMB: after / 1048576, ratio: after / before }));
