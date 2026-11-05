/** Scope-aware extraction of MIT-licensed upstream business code. Runtime never loads the HTML. */
import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import generateModule from "@babel/generator";
import * as t from "@babel/types";
import * as THREE from "three";
import { format } from "prettier";
const traverse = traverseModule.default || traverseModule,
  generate = generateModule.default || generateModule;
const html = fs.readFileSync("reference/upstream/assets/template.html", "utf8");
const source = html.match(/<script type="module"[^>]*>([\s\S]*?)<\/script>/)[1];
const ast = parse(source, { sourceType: "module" });
let prog;
traverse(ast, {
  Program(p) {
    prog = p;
    p.stop();
  },
});
// The upstream room-label recovery cache is business state, not a process global.
const roomBinding = prog.scope.bindings.ol;
for (const ref of roomBinding.referencePaths)
  ref.replaceWith(t.identifier("roomLabelArchive"));
prog.scope.bindings.nM.path.node.params.push(
  t.assignmentPattern(t.identifier("roomLabelArchive"), t.arrayExpression([])),
);
prog.scope.crawl();
const bindings = prog.scope.bindings,
  records = new Map();
for (const [name, b] of Object.entries(bindings)) {
  const deps = new Set();
  b.path.traverse({
    ReferencedIdentifier(p) {
      const dep = p.scope.getBinding(p.node.name);
      if (dep && dep.scope === prog.scope && dep !== b) deps.add(p.node.name);
    },
  });
  records.set(name, {
    name,
    b,
    deps,
    start: b.path.node.start,
    end: b.path.node.end,
  });
}
const threeMap = {
  H: "Vector3",
  Be: "Color",
  ht: "Group",
  Me: "Mesh",
  Jt: "MeshStandardMaterial",
  to: "ExtrudeGeometry",
  Is: "Shape",
  pe: "Vector2",
  ot: "BoxGeometry",
  Hn: "CylinderGeometry",
  ds: "SphereGeometry",
  Bt: "BufferGeometry",
  vt: "Float32BufferAttribute",
  of: "LatheGeometry",
  mo: "PlaneGeometry",
  Pn: "MeshBasicMaterial",
  e0: "DoubleSide",
  Hi: "FrontSide",
  un: "Texture",
  gs: "CanvasTexture",
  Et: "SRGBColorSpace",
  b0: "ClampToEdgeWrapping",
  A0: "RepeatWrapping",
  r0: "LinearFilter",
  Ni: "UnsignedByteType",
  pc: "MathUtils",
};
for (const [name, r] of records) {
  if (r.start < 127187 || r.start > 675000 || !r.b.path.isClassDeclaration())
    continue;
  const text = source.slice(r.start, r.end);
  const candidates = [
    ...text.matchAll(/(?:\.type="([A-Za-z0-9]+)"|\.is([A-Za-z0-9]+)=!0)/g),
  ].map((m) => m[1] || m[2]);
  const c = candidates.find((n) => typeof THREE[n] === "function");
  if (c) threeMap[name] = c;
}
const owner = new Map(),
  manifest = [];
const rootdir = "packages/scene-core/src/inherited";
fs.mkdirSync(rootdir, { recursive: true });
const preamble =
  "/** Derived from ZWD11/house-plan-designer@b94183f9 (MIT, Copyright 2026 ZWD11).\n * Scope-aware extraction: scripts/extract-upstream.mjs. See reference/upstream/LICENSE.\n * Three.js core is an npm dependency; inherited modelling helpers retain their original behaviour. */\n";
async function emit(file, roots, extraImports = {}) {
  const selected = new Set(),
    imports = new Map(),
    externalThree = new Map();
  function visit(n) {
    if (extraImports[n]) {
      imports.set(n, extraImports[n]);
      return;
    }
    if (threeMap[n]) {
      externalThree.set(n, threeMap[n]);
      return;
    }
    if (owner.has(n)) {
      imports.set(n, owner.get(n));
      return;
    }
    if (selected.has(n) || !records.has(n)) return;
    selected.add(n);
    for (const d of records.get(n).deps) visit(d);
  }
  roots.forEach(visit);
  const ordered = [...selected]
    .map((n) => records.get(n))
    .sort((a, b) => a.start - b.start);
  const statements = ordered.map((r) => {
    const node = t.cloneNode(r.b.path.node, true);
    return t.exportNamedDeclaration(
      t.isVariableDeclarator(node)
        ? t.variableDeclaration(r.b.kind === "const" ? "const" : "let", [node])
        : node,
    );
  });
  let head = preamble;
  if (externalThree.size)
    head += `import { ${[...externalThree].map(([alias, name]) => `${name} as ${alias}`).join(", ")} } from 'three';\n`;
  const groups = new Map();
  for (const [n, f] of imports) {
    let rel = path.relative(path.dirname(file), f).replaceAll("\\", "/");
    if (!rel.startsWith(".")) rel = "./" + rel;
    (groups.get(rel) || groups.set(rel, []).get(rel)).push(n);
  }
  for (const [f, names] of groups)
    head += `import { ${names.join(", ")} } from '${f}';\n`;
  // q0's initialization is an upstream top-level side effect, not part of its declarator.
  let code = generate(t.program(statements), { comments: false }).code;
  if (selected.has("q0"))
    code +=
      "\nyu.forEach(group => group.items.forEach(item => { q0[item.key] = item; }));\n";
  for (const root of roots)
    if (!selected.has(root)) {
      if (imports.has(root)) code += `\nexport { ${root} };`;
    }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const formatted = await format(head + code + "\n", { parser: "babel" });
  fs.writeFileSync(file, formatted);
  for (const n of selected) owner.set(n, file);
  const unexpected = ordered
    .filter((r) => r.start >= 127187 && r.start < 675000)
    .map((r) => ({
      name: r.name,
      text: source.slice(r.start, r.end).slice(0, 120),
    }));
  manifest.push({
    file,
    roots,
    bindings: selected.size,
    bytes: Buffer.byteLength(formatted),
    imports: [...imports],
    three: [...externalThree],
    unexpectedVendor: unexpected,
  });
}
await emit(`${rootdir}/catalog.js`, [
  "Hc",
  "q0",
  "yu",
  "ii",
  "Q0",
  "cs",
  "$r",
  "tf",
  "i7",
  "ja",
  "F5",
]);
await emit(`${rootdir}/topology.js`, [
  "Wc",
  "D4",
  "Vc",
  "nM",
  "Te",
  "q1",
  "Xe",
  "Vt",
  "ms",
  "Va",
]);
await emit(`${rootdir}/footprints.js`, [
  "Cu",
  "Qc",
  "xp",
  "qP",
  "V1",
  "Zg",
  "Ts",
  "Ns",
  "yi",
  "Pt",
  "dd",
  "L4",
  "vi",
  "Ci",
  "KU",
  "Ls",
  "Jg",
  "B4",
  "Gr",
]);
await emit(`${rootdir}/house-spec.js`, ["Gb", "xd"]);
await emit("apps/editor/src/modeling/furniture-2d.js", ["Fh"], {
  LC: "apps/editor/src/modeling/asset-cache.ts",
});
await emit(
  "apps/editor/src/modeling/furniture-3d.js",
  ["Ov", "Ba", "j0", "Cp", "Gd", "Zo"],
  {
    DC: "apps/editor/src/modeling/asset-cache.ts",
    fv: "apps/editor/src/modeling/asset-cache.ts",
  },
);
await emit("apps/editor/src/modeling/surfaces.js", [
  "Ko",
  "zd",
  "Mv",
  "Qu",
  "Lu",
  "Ps",
  "Hd",
  "ei",
  "C4",
  "eM",
  "Sv",
  "qC",
  "$y",
  "BM",
]);
fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync(
  "docs/extraction-manifest.json",
  JSON.stringify(
    { upstream: "b94183f9ce2215db9a178da89a90d2ecefb18497", modules: manifest },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    manifest.map(({ file, bindings, bytes, unexpectedVendor }) => ({
      file,
      bindings,
      bytes,
      unexpectedVendor,
    })),
    null,
    2,
  ),
);
