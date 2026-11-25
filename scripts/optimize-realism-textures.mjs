import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve("apps/editor/public/textures");
const backup = path.resolve("/workspace/actiscape-data/handoff/textures-before-fluidity");
fs.mkdirSync(backup, { recursive: true });
let before = 0;
let after = 0;
for (const name of fs.readdirSync(root).filter((file) => file.endsWith(".jpg"))) {
  const file = path.join(root, name);
  const original = fs.readFileSync(file);
  before += original.length;
  const backupFile = path.join(backup, name);
  if (!fs.existsSync(backupFile)) fs.copyFileSync(file, backupFile);
  const output = await sharp(original)
    .resize(512, 512, { fit: "fill" })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  fs.writeFileSync(file, output);
  after += output.length;
  console.log(`${name}: ${(original.length / 1024).toFixed(0)} -> ${(output.length / 1024).toFixed(0)} KB`);
}
console.log(JSON.stringify({ beforeMB: before / 1048576, afterMB: after / 1048576 }));
