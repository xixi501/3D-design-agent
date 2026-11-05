import fs from "node:fs";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import generateModule from "@babel/generator";
const traverse = traverseModule.default || traverseModule;
const generate = generateModule.default || generateModule;
const html = fs.readFileSync("reference/upstream/assets/template.html", "utf8");
const source = html.match(/<script type="module"[^>]*>([\s\S]*?)<\/script>/)[1];
const ast = parse(source, { sourceType: "module" });
let program;
traverse(ast, {
  Program(p) {
    program = p;
    p.stop();
  },
});
const bindings = program.scope.bindings;
const declarations = Object.entries(bindings).map(([name, b]) => {
  const refs = new Set();
  b.path.traverse({
    ReferencedIdentifier(p) {
      const dep = p.scope.getBinding(p.node.name);
      if (dep && dep.scope === program.scope && dep !== b)
        refs.add(p.node.name);
    },
  });
  return {
    name,
    start: b.path.node.start,
    end: b.path.node.end,
    kind: b.kind,
    type: b.path.node.type,
    deps: [...refs],
    writes: b.constantViolations.length,
    text: source.slice(
      b.path.node.start,
      Math.min(b.path.node.end, b.path.node.start + 200),
    ),
  };
});
fs.mkdirSync("test-results/analysis", { recursive: true });
fs.writeFileSync(
  "test-results/analysis/declarations.json",
  JSON.stringify(declarations, null, 2),
);
fs.writeFileSync(
  "test-results/analysis/formatted.js",
  generate(ast, { comments: true }).code,
);
console.log(
  JSON.stringify(
    {
      declarations: declarations.length,
      statements: ast.program.body.length,
      sourceBytes: Buffer.byteLength(source),
      largest: declarations
        .toSorted((a, b) => b.end - b.start - (a.end - a.start))
        .slice(0, 18)
        .map((x) => ({
          name: x.name,
          type: x.type,
          bytes: x.end - x.start,
          start: x.start,
          text: x.text.slice(0, 100),
        })),
    },
    null,
    2,
  ),
);
