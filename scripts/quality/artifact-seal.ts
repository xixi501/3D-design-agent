import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

function canonical(value: unknown, field = "value"): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${field} 包含非有限数值`);
    return value;
  }
  if (Array.isArray(value))
    return value.map((item, index) => canonical(item, `${field}.${index}`));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined)
        throw new Error(`${field}.${key} 不能为 undefined`);
      output[key] = canonical(item, `${field}.${key}`);
    }
    return output;
  }
  throw new Error(`${field} 包含不可序列化值`);
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonical(value))}\n`;
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function readJson<T = unknown>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export function writeSealedJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bytes = Buffer.from(canonicalJson(value));
  const digest = sha256(bytes);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, bytes, { mode: 0o644 });
  fs.renameSync(temporary, file);
  return digest;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`未知参数 ${argument}`);
    const key = argument.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags.add(key);
    } else {
      values.set(key, next);
      index += 1;
    }
  }
  return {
    has: (key: string) => flags.has(key) || values.has(key),
    get: (key: string) => values.get(key),
    required: (key: string) => {
      const value = values.get(key);
      if (!value) throw new Error(`缺少 --${key}`);
      return value;
    },
  };
}

export function relativePath(root: string, file: string) {
  const value = path.relative(root, file).split(path.sep).join("/");
  if (!value || value.startsWith("../") || path.isAbsolute(value))
    throw new Error(`产物不在允许目录内：${file}`);
  return value;
}
