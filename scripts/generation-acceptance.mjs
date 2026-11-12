import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import {
  catalog,
  checkScene,
  detectRooms,
  openEnvelope,
  rotatedAabb,
} from "../packages/scene-core/src/index.js";

const base = (process.env.ACTISCAPE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = path.resolve(process.env.ACTISCAPE_ACCEPTANCE_OUT || `test-results/generation-acceptance/${stamp}`);
fs.mkdirSync(out, { recursive: true });
const ONLY = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
const REPEAT = Number(process.argv.find((arg) => arg.startsWith("--repeat="))?.slice(9) || 2);

async function api(route, body) {
  const r = await fetch(base + "/api" + route, body === undefined ? {} : {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const value = await r.json();
  if (!r.ok) throw Error(JSON.stringify(value));
  return value;
}
async function image(route) {
  const r = await fetch(base + "/api" + route);
  if (!r.ok) throw Error(await r.text());
  return Buffer.from(await r.arrayBuffer());
}
async function persistArtifacts(record, dir) {
  try {
    if (record.before) fs.writeFileSync(path.join(dir, "project-before.json"), JSON.stringify(record.before, null, 2));
    if (record.task) {
      fs.writeFileSync(path.join(dir, "task.json"), JSON.stringify(record.task, null, 2));
      if (!record.trace && record.task.id)
        record.trace = await api(`/agent/tasks/${record.task.id}/trace`);
      if (record.trace) fs.writeFileSync(path.join(dir, "trace.json"), JSON.stringify(record.trace, null, 2));
    }
    if (record.projectId) {
      const project = record.after || await api(`/projects/${record.projectId}`);
      record.after = record.after || project;
      fs.writeFileSync(path.join(dir, "project-after.json"), JSON.stringify(project, null, 2));
    }
    if (!record.candidate && record.task?.result?.candidateId && record.projectId) {
      record.candidate = await api(`/projects/${record.projectId}/candidates/${record.task.result.candidateId}`);
    }
    if (record.candidate) {
      fs.writeFileSync(path.join(dir, "candidate.json"), JSON.stringify(record.candidate, null, 2));
      const evidenceDir = path.join(dir, "evidence");
      fs.mkdirSync(evidenceDir, { recursive: true });
      for (const evidence of record.candidate.evidence || []) {
        if (!["top", "oblique"].includes(evidence.view)) continue;
        try {
          const bytes = await image(`/projects/${record.projectId}/candidates/${record.candidate.id}/evidence/${evidence.view}`);
          fs.writeFileSync(path.join(evidenceDir, `${evidence.view}.png`), bytes);
        } catch {}
      }
    }
  } catch (error) {
    record.artifactError = String(error);
  }
}

async function wait(task) {
  const until = Date.now() + 720000;
  while (["queued", "running", "committing"].includes(task.status) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 800));
    task = await api(`/agent/tasks/${task.id}`);
  }
  return task;
}

const CASES = [
  {
    name: "living-dining",
    width: 6000,
    depth: 4000,
    door: { side: "south", position: "offset", offset: 400 },
    window: { side: "north", position: "center" },
    input:
      "生成一个矩形客餐厅，室内横向净宽6米、纵向净深4米。入口在南墙，门洞左边距西侧内墙400毫米；窗在北墙居中。三人沙发、茶几、电视柜、餐桌各一个，餐椅四把、落地灯一盏。简约中性配色，家具采用目录默认尺寸，门窗宽高和层高使用系统默认值。",
    items: [
      { kind: "sofa", count: 1 },
      { kind: "coffeeTable", count: 1 },
      { kind: "tvCabinet", count: 1 },
      { kind: "diningTable", count: 1 },
      { kind: "chair", count: 4 },
      { kind: "floorLamp", count: 1 },
    ],
  },
  {
    name: "reading-lounge",
    width: 5000,
    depth: 3600,
    door: { side: "south", position: "offset", offset: 3500 },
    window: { side: "east", position: "center" },
    input:
      "生成一个矩形阅读会客间，室内横向净宽500厘米、纵向净深360厘米。入口在南墙，门洞左边距西侧内墙350厘米；窗在东墙居中。单人沙发两把、茶几一张、书柜一个、落地灯一盏。简约中性配色，家具采用目录默认尺寸，门窗宽高和层高使用系统默认值。",
    items: [
      { kind: "armchair", count: 2 },
      { kind: "coffeeTable", count: 1 },
      { kind: "bookshelf", count: 1 },
      { kind: "floorLamp", count: 1 },
    ],
  },
  {
    name: "master-bedroom",
    width: 3600,
    depth: 4200,
    door: { side: "south", position: "center" },
    window: { side: "east", position: "center" },
    input:
      "生成一个矩形主卧，室内横向净宽3600毫米、纵向净深4200毫米。入口在南墙居中；窗在东墙居中。1.8m 双人床一张、床头柜两个、衣柜一个。简约中性配色，家具采用目录默认尺寸，门窗宽高和层高使用系统默认值。",
    items: [
      { kind: "bed18", count: 1 },
      { kind: "nightstand", count: 2 },
      { kind: "wardrobe", count: 1 },
    ],
  },
  {
    name: "guest-bedroom",
    width: 3300,
    depth: 3600,
    door: { side: "south", position: "center" },
    window: { side: "north", position: "center" },
    input:
      "生成一个矩形次卧，室内横向净宽3.3米、纵向净深3.6米。入口在南墙居中；窗在北墙居中。1.5m 双人床一张、床头柜一个、衣柜一个。简约中性配色，家具采用目录默认尺寸，门窗宽高和层高使用系统默认值。",
    items: [
      { kind: "bed15", count: 1 },
      { kind: "nightstand", count: 1 },
      { kind: "wardrobe", count: 1 },
    ],
  },
  {
    name: "study",
    width: 3200,
    depth: 3400,
    door: { side: "south", position: "offset", offset: 400 },
    window: { side: "east", position: "center" },
    input:
      "生成一个矩形书房，室内横向净宽320厘米、纵向净深340厘米。入口在南墙，门洞左边距西侧内墙40厘米；窗在东墙居中。书桌、办公椅、书柜各一个。简约中性配色，家具采用目录默认尺寸，门窗宽高和层高使用系统默认值。",
    items: [
      { kind: "desk", count: 1 },
      { kind: "officeChair", count: 1 },
      { kind: "bookshelf", count: 1 },
    ],
  },
  {
    name: "kitchen",
    width: 2400,
    depth: 3200,
    door: { side: "south", position: "center" },
    window: { side: "north", position: "center" },
    input:
      "生成一个矩形厨房，室内横向净宽2400毫米、纵向净深3200毫米。入口在南墙居中；窗在北墙居中。一字橱柜一个、冰箱一个。简约中性配色，家具采用目录默认尺寸，门窗宽高和层高使用系统默认值。",
    items: [
      { kind: "oneLineCounter", count: 1 },
      { kind: "fridge", count: 1 },
    ],
  },
  {
    name: "bathroom",
    width: 1800,
    depth: 2500,
    door: { side: "south", position: "center" },
    window: { side: "north", position: "center" },
    input:
      "生成一个矩形卫生间，室内横向净宽180厘米、纵向净深250厘米。入口在南墙居中；窗在北墙居中。马桶、浴室柜、淋浴房各一个。简约中性配色，家具采用目录默认尺寸，门窗宽高和层高使用系统默认值。",
    items: [
      { kind: "toilet", count: 1 },
      { kind: "vanity", count: 1 },
      { kind: "shower", count: 1 },
    ],
  },
  {
    name: "entry",
    width: 1600,
    depth: 2400,
    door: { side: "south", position: "center" },
    window: null,
    input:
      "生成一个矩形玄关，室内横向净宽1.6米、纵向净深2.4米。入口在南墙居中；明确没有窗。鞋柜、换鞋凳各一个。简约中性配色，家具采用目录默认尺寸，门窗宽高和层高使用系统默认值。",
    items: [
      { kind: "shoeCabinet", count: 1 },
      { kind: "entryBench", count: 1 },
    ],
  },
  {
    name: "corridor",
    width: 1400,
    depth: 3000,
    door: { side: "south", position: "center" },
    window: null,
    input:
      "生成一个矩形过道，室内横向净宽1400毫米、纵向净深3000毫米。入口在南墙居中；明确没有窗。玄关桌一个、绿植一盆。简约中性配色，家具采用目录默认尺寸，门窗宽高和层高使用系统默认值。",
    items: [
      { kind: "consoleTable", count: 1 },
      { kind: "plant", count: 1 },
    ],
  },
];

const DEFAULT_DOOR = { width: 900, sill: 0, head: 2100 };
const DEFAULT_WINDOW = { width: 1500, sill: 900, head: 2400 };
const FRONT = (type, rot) => {
  const r = ((Math.round(rot / 90) * 90) % 360 + 360) % 360;
  return { 0: { x: 0, y: 1 }, 90: { x: -1, y: 0 }, 180: { x: 0, y: -1 }, 270: { x: 1, y: 0 } }[r];
};

function catalogName(f) {
  return catalog[f.key]?.name || f.name || f.key;
}
function classify(item, f) {
  const name = catalogName(f);
  switch (item.kind) {
    case "sofa": return f.type === "sofa" && f.w >= 1800;
    case "coffeeTable": return f.type === "coffeeTable";
    case "tvCabinet": return f.type === "tvCabinet";
    case "diningTable": return f.type === "diningTable";
    case "chair": return f.type === "chair";
    case "floorLamp": return f.type === "floorLamp";
    case "armchair": return f.type === "armchair";
    case "bookshelf": return f.type === "bookshelf" || (f.type === "cabinet" && (name.includes("书柜") || f.key === "cabTall"));
    case "bed18": return f.type === "bed" && Math.abs(f.w - 1800) <= 20;
    case "bed15": return f.type === "bed" && Math.abs(f.w - 1500) <= 20;
    case "nightstand": return f.type === "nightstand";
    case "wardrobe": return f.type === "wardrobe" || (f.type === "cabinet" && name.includes("衣柜"));
    case "desk": return f.type === "desk";
    case "officeChair": return f.type === "officeChair";
    case "oneLineCounter": return f.type === "counter" && name.includes("一字");
    case "fridge": return f.type === "fridge";
    case "toilet": return f.type === "toilet";
    case "vanity": return f.type === "vanity" || name.includes("浴室柜");
    case "shower": return f.type === "shower";
    case "shoeCabinet": return ["cabShoe", "shoeCabinet"].includes(f.key) || name.includes("鞋柜");
    case "entryBench": return f.type === "entryBench" || name.includes("换鞋凳");
    case "consoleTable": return f.type === "consoleTable" || name.includes("玄关桌");
    case "plant": return ["plant", "shrub", "tree"].includes(f.type) || name.includes("绿植");
    default: return false;
  }
}

function facts(plan) {
  const nodes = new Map(plan.nodes.map((n) => [n.id, n]));
  const openings = plan.openings.map((o) => {
    const wall = plan.walls.find((w) => w.id === o.wall);
    const a = nodes.get(wall.a), b = nodes.get(wall.b);
    const horizontal = Math.abs(a.y - b.y) < 0.5;
    const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
    let side, from;
    if (horizontal) {
      side = Math.abs(a.y + wall.t / 2) < 1 ? "north" : "south";
      from = side === "north" ? a.x + (o.pos - o.width / 2) : a.x - (o.pos + o.width / 2);
    } else {
      side = Math.abs(a.x + wall.t / 2) < 1 ? "west" : "east";
      from = side === "west" ? a.y - (o.pos + o.width / 2) : a.y + (o.pos - o.width / 2);
    }
    return { ...o, side, from, wall };
  });
  return openings;
}

function expectedFrom(opening, span, width) {
  if (!opening) return null;
  return opening.position === "center" ? (span - width) / 2 : opening.offset;
}

function noOverlap(plan) {
  const rows = plan.furniture.map((f) => ({ f, box: rotatedAabb(f) }));
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      const x = Math.min(a.box.x1, b.box.x1) - Math.max(a.box.x0, b.box.x0);
      const y = Math.min(a.box.y1, b.box.y1) - Math.max(a.box.y0, b.box.y0);
      const z = Math.min(a.f.z + a.f.h, b.f.z + b.f.h) - Math.max(a.f.z, b.f.z);
      if (x > 20 && y > 20 && z > 20)
        throw Error(`家具重叠：${a.f.name} / ${b.f.name} (${Math.round(x)}×${Math.round(y)})`);
    }
  }
}

function seatRelations(plan) {
  const tableTypes = { chair: "diningTable", officeChair: "desk", armchair: "coffeeTable" };
  for (const seat of plan.furniture.filter((f) => tableTypes[f.type])) {
    const targets = plan.furniture.filter((f) => f.type === tableTypes[seat.type]);
    if (!targets.length) throw Error(`${seat.name} 没有对应桌面`);
    const front = FRONT(seat.type, seat.rot);
    if (!front) throw Error(`${seat.name} 朝向不是 90° 倍数`);
    let best = null;
    for (const target of targets) {
      const dx = target.x - seat.x, dy = target.y - seat.y;
      const distance = Math.hypot(dx, dy) || 1;
      const dot = (dx * front.x + dy * front.y) / distance;
      if (!best || dot > best.dot) best = { target, dot, distance };
    }
    if (!best || best.dot < 0.2)
      throw Error(`${seat.name} 没有朝向${best?.target?.name || "对应桌面"}`);
  }
}

function nightstandRelations(plan) {
  const beds = plan.furniture.filter((f) => f.type === "bed");
  for (const stand of plan.furniture.filter((f) => f.type === "nightstand")) {
    let ok = false;
    for (const bed of beds) {
      const radians = (-bed.rot * Math.PI) / 180;
      const dx = stand.x - bed.x, dy = stand.y - bed.y;
      const localX = dx * Math.cos(radians) - dy * Math.sin(radians);
      const localY = dx * Math.sin(radians) + dy * Math.cos(radians);
      if (
        Math.abs(localX) >= bed.w / 2 - 50 &&
        Math.abs(localX) <= bed.w / 2 + 600 &&
        Math.abs(localY) <= bed.d / 2 + 350
      ) ok = true;
    }
    if (!ok) throw Error(`${stand.name} 不在床边可用位置`);
  }
}

function envelopeInside(plan, width, depth) {
  for (const f of plan.furniture) {
    const envelope = openEnvelope(f);
    if (!envelope) continue;
    for (const p of envelope.polygon)
      if (p.x < -20 || p.x > width + 20 || p.y < -20 || p.y > depth + 20)
        throw Error(`${f.name} 的开启包络超出房间`);
  }
}

function corridorPassage(plan, depth) {
  const furniture = plan.furniture.map((f) => rotatedAabb(f));
  for (let y = 500; y <= depth - 800; y += 100) {
    const spans = furniture
      .filter((b) => b.y0 <= y && b.y1 >= y)
      .map((b) => [b.x0, b.x1])
      .sort((a, b) => a[0] - b[0]);
    let cursor = 0, best = 0;
    for (const [x0, x1] of spans) {
      best = Math.max(best, x0 - cursor);
      cursor = Math.max(cursor, x1);
    }
    best = Math.max(best, 1400 - cursor);
    if (best < 700) throw Error(`过道在 y=${y} 处可通行宽度不足 700 mm`);
  }
}

function expectedOpenings(def) {
  const result = [];
  result.push({
    type: "door", side: def.door.side,
    from: expectedFrom(def.door, def.door.side === "north" || def.door.side === "south" ? def.width : def.depth, DEFAULT_DOOR.width),
    ...DEFAULT_DOOR,
  });
  if (def.window) result.push({
    type: "window", side: def.window.side,
    from: expectedFrom(def.window, def.window.side === "north" || def.window.side === "south" ? def.width : def.depth, DEFAULT_WINDOW.width),
    ...DEFAULT_WINDOW,
  });
  return result;
}

function checkPlan(def, plan) {
  assert.equal(plan.nodes.length, 4, "需要四个结构节点");
  assert.equal(plan.walls.length, 4, "需要四面墙");
  const regions = detectRooms(plan).regions;
  assert.equal(regions.length, 1, "需要唯一封闭矩形房间");
  const rects = regions[0].rects || [];
  const bytes = rects.reduce((sum, r) => sum + r.w * r.h, 0);
  assert.ok(Math.abs(bytes - def.width * def.depth) < 10, `房间面积不符：${bytes}`);
  assert.ok(
    Math.abs(Math.min(...rects.map((r) => r.x))) < 1 &&
    Math.abs(Math.min(...rects.map((r) => r.y))) < 1 &&
    Math.abs(Math.max(...rects.map((r) => r.x + r.w)) - def.width) < 1 &&
    Math.abs(Math.max(...rects.map((r) => r.y + r.h)) - def.depth) < 1,
    "房间净尺寸不符",
  );
  const openings = facts(plan);
  assert.equal(openings.length, def.window ? 2 : 1, "门窗数量不符");
  for (const expected of expectedOpenings(def)) {
    const actual = openings.find((o) => o.type === expected.type);
    assert.ok(actual, `缺少${expected.type}`);
    assert.equal(actual.side, expected.side, `${expected.type} 墙面不符`);
    assert.ok(Math.abs(actual.from - expected.from) <= 1, `${expected.type} 起始位置不符`);
    assert.equal(actual.width, expected.width, `${expected.type} 宽度不符`);
    assert.equal(actual.sill, expected.sill, `${expected.type} 离地不符`);
    assert.equal(actual.head, expected.head, `${expected.type} 顶高不符`);
  }
  const counts = Object.fromEntries(def.items.map((item) => [item.kind, 0]));
  for (const f of plan.furniture) {
    const recipe = catalog[f.key];
    assert.ok(recipe, `未知目录 key ${f.key}`);
    for (const key of ["w", "d", "h"]) assert.equal(f[key], recipe[key], `${f.name} ${key} 未使用目录默认值`);
    assert.equal(f.rot % 90, 0, `${f.name} 朝向不是 90° 倍数`);
    const box = rotatedAabb(f);
    assert.ok(box.x0 >= -20 && box.x1 <= def.width + 20, `${f.name} 横向越界`);
    assert.ok(box.y0 >= -20 && box.y1 <= def.depth + 20, `${f.name} 纵向越界`);
    for (const item of def.items) if (classify(item, f)) counts[item.kind]++;
  }
  for (const item of def.items)
    assert.equal(counts[item.kind], item.count, `${item.kind} 数量不符：${counts[item.kind]}`);
  assert.equal(plan.furniture.length, def.items.reduce((sum, item) => sum + item.count, 0), "存在未要求家具");
  noOverlap(plan);
  const scene = checkScene(plan);
  const hard = scene.issues.filter((i) => i.level === "error" || i.code === "POSSIBLE_OVERLAP");
  assert.deepEqual(hard, [], `判据库问题：${JSON.stringify(hard)}`);
  seatRelations(plan);
  nightstandRelations(plan);
  envelopeInside(plan, def.width, def.depth);
  if (def.name === "corridor") corridorPassage(plan, def.depth);
  return { issues: scene.issues, roomAreaM2: bytes / 1e6 };
}

function judgeHashes() {
  const files = [
    "packages/scene-core/src/index.ts",
    "packages/scene-core/src/candidate.ts",
    "packages/scene-core/src/rectangular.ts",
    "packages/scene-core/src/actions.ts",
  ];
  return Object.fromEntries(files.map((file) => [file, crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")]));
}

const results = [];
const startedAt = new Date().toISOString();
for (const def of CASES) {
  if (ONLY && ONLY !== def.name) continue;
  for (let repeat = 1; repeat <= REPEAT; repeat++) {
    const dir = path.join(out, `${def.name}-${repeat}`);
    fs.mkdirSync(path.join(dir, "evidence"), { recursive: true });
    const record = {
      name: def.name,
      repeat,
      status: "running",
      liveModel: true,
      provider: "DeepSeek official",
      input: def.input,
      expected: { width: def.width, depth: def.depth, door: def.door, window: def.window, items: def.items },
    };
    try {
      const before = await api("/projects", {});
      const conversation = await api("/agent/conversations", { projectId: before.id });
      record.projectId = before.id;
      record.conversationId = conversation.id;
      record.before = before;
      const body = {
        requestId: crypto.randomUUID(),
        mode: "generate_rectangular",
        input: def.input,
        selectedIds: [],
      };
      const accepted = await api(`/agent/conversations/${conversation.id}/tasks`, body);
      assert.equal((await api(`/agent/conversations/${conversation.id}/tasks`, body)).id, accepted.id, "重复任务请求未去重");
      const task = await wait(accepted);
      record.task = task;
      record.after = await api(`/projects/${before.id}`);
      record.trace = await api(`/agent/tasks/${task.id}/trace`);
      assert.equal(task.status, "completed", JSON.stringify(task.result));
      assert.equal(record.after.revision, 1, "正式项目应只增加一次修订");
      assert.equal(record.after.history.undo, 1);
      const checks = checkPlan(def, record.after.plan);
      record.independentChecks = checks;
      assert.equal(task.result.generation.dimensions.width, def.width);
      assert.equal(task.result.generation.dimensions.depth, def.depth);
      const candidate = await api(`/projects/${before.id}/candidates/${task.result.candidateId}`);
      record.candidate = candidate;
      assert.equal(candidate.verification, "screenshots");
      assert.equal(candidate.checks.passed, true, "候选确定性检查未通过");
      assert.deepEqual(candidate.state.plan, record.after.plan, "正式项目与候选快照不一致");
      assert.equal(candidate.committed, 1);
      assert.equal(candidate.review?.source, "agent");
      assert.equal(candidate.review?.passed, true);
      assert.equal(candidate.evidence.length, 2, "需要两个检查视图");
      assert.deepEqual(
        [...new Set(candidate.evidence.map((e) => e.candidateHash))],
        [candidate.hash],
        "检查图未绑定候选哈希",
      );
      const evidenceHashes = [];
      for (const evidence of candidate.evidence) {
        const bytes = await image(`/projects/${before.id}/candidates/${candidate.id}/evidence/${evidence.view}`);
        const sha = crypto.createHash("sha256").update(bytes).digest("hex");
        assert.equal(sha, evidence.sha256, "检查图 SHA 不符");
        evidenceHashes.push(sha);
        fs.writeFileSync(path.join(dir, "evidence", `${evidence.view}.png`), bytes);
      }
      assert.deepEqual([...evidenceHashes].sort(), [...(candidate.review.evidenceHashes || [])].sort());
      assert.equal(task.result.verification.rendered, true);
      assert.equal(task.result.verification.visualReviewed, true);
      const roles = new Set(record.trace.filter((e) => e.kind === "agent_start").map((e) => e.data.role));
      for (const role of ["main", "assets", "design", "check"])
        assert.ok(roles.has(role), `缺少 ${role} 角色调用`);
      for (const tool of ["search_catalogue_batch", "precheck_initialization", "candidate_checks"])
        assert.ok(record.trace.some((e) => e.kind === "tool_start" && e.data.tool === tool), `缺少工具调用 ${tool}`);
      const request = {
        operationId: candidate.operationId,
        baseRevision: candidate.baseRevision,
        candidateHash: candidate.hash,
      };
      const replay = await api(`/projects/${before.id}/candidates/${candidate.id}/commit`, request);
      assert.equal(replay.replayed, true);
      assert.equal((await api(`/projects/${before.id}`)).revision, 1);
      const undone = (await api(`/projects/${before.id}/undo`, {
        operationId: crypto.randomUUID(),
        baseRevision: 1,
      })).project;
      assert.deepEqual(undone.plan, before.plan, "撤销未恢复完整空白场景");
      const redone = (await api(`/projects/${before.id}/redo`, {
        operationId: crypto.randomUUID(),
        baseRevision: 2,
      })).project;
      assert.deepEqual(redone.plan, record.after.plan, "重做未恢复完整生成场景");
      const modelByRole = {};
      for (const event of record.trace.filter((e) => e.kind === "model_start"))
        modelByRole[event.data.role] = (modelByRole[event.data.role] || 0) + 1;
      record.stats = {
        modelCalls: task.modelCalls,
        modelCallsByRole: modelByRole,
        renderCount: task.result.metrics.renderCount,
        repairCount: task.result.metrics.repairCount,
        fallbackCount: task.result.metrics.fallbackCount || 0,
        stageSeconds: task.result.metrics.stageSeconds,
        activeSeconds: task.result.metrics.elapsedSeconds,
        fallbackEvents: record.trace.filter((e) => ["deterministic_layout", "deterministic_assets"].includes(e.kind)).map((e) => e.data),
      };
      record.status = "passed";
      await persistArtifacts(record, dir);
      console.log(`PASS ${def.name} ${repeat}: ${task.modelCalls} calls, ${task.result.metrics.renderCount} images, ${task.result.metrics.repairCount} repairs, ${task.result.metrics.fallbackCount || 0} fallbacks, ${task.result.metrics.elapsedSeconds.toFixed(1)}s`);
    } catch (error) {
      record.status = "failed";
      record.error = error.stack || String(error);
      await persistArtifacts(record, dir);
      console.log(`FAIL ${def.name} ${repeat}: ${error.message}`);
    }
    fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify(record, null, 2));
    results.push({
      name: def.name,
      repeat,
      status: record.status,
      error: record.error?.split("\n")[0],
      projectId: record.projectId,
      taskId: record.task?.id,
      stats: record.stats,
      candidateId: record.task?.result?.candidateId,
    });
    const summary = {
      schemaVersion: "actiscape.generation-acceptance.v1",
      startedAt,
      updatedAt: new Date().toISOString(),
      finished: results.length === (ONLY ? 1 : CASES.length) * REPEAT && results.every((r) => r.status !== "running"),
      base,
      codeCommit: process.env.ACTISCAPE_CODE_COMMIT || null,
      judgeHashes: judgeHashes(),
      provider: "DeepSeek official",
      model: "deepseek-flash",
      directory: out,
      cases: CASES.filter((c) => !ONLY || c.name === ONLY).map((c) => ({
        name: c.name, width: c.width, depth: c.depth, door: c.door, window: c.window, items: c.items,
      })),
      results,
      summary: {
        runs: results.length,
        executed: results.length,
        passed: results.filter((r) => r.status === "passed").length,
        failed: results.filter((r) => r.status === "failed").length,
        modelCalls: results.reduce((sum, r) => sum + (r.stats?.modelCalls || 0), 0),
        renderImages: results.reduce((sum, r) => sum + (r.stats?.renderCount || 0), 0),
        repairs: results.reduce((sum, r) => sum + (r.stats?.repairCount || 0), 0),
        fallbacks: results.reduce((sum, r) => sum + (r.stats?.fallbackCount || 0), 0),
        activeSeconds: results.reduce((sum, r) => sum + (r.stats?.activeSeconds || 0), 0),
      },
    };
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(summary, null, 2));
    fs.writeFileSync("test-results/generation-acceptance/latest.json", JSON.stringify(summary, null, 2));
  }
}
const report = JSON.parse(fs.readFileSync(path.join(out, "report.json"), "utf8"));
assert.ok(report.summary.failed === 0, `See retained results in ${out}`);
assert.equal(report.summary.passed, report.summary.runs, "not all runs passed");
console.log(`MATRIX PASS ${report.summary.passed}/${report.summary.runs}`);
