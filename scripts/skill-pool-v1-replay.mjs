/** Real-core L3 conformance for the active Skill Pool v1 set. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { blankPlan } from "../packages/scene-core/src/index.ts";

const root = path.resolve(import.meta.dirname, "..");
const skillRoot = path.join(root, "apps/agent/actiscape_agent/skills");
const catalogue = JSON.parse(
  fs.readFileSync(path.join(root, "fixtures/catalog.json"), "utf8"),
);
const base = (
  process.env.ACTISCAPE_SCENE_URL || "http://127.0.0.1:3001"
).replace(/\/$/, "");

const active = [
  "living-dining-small",
  "living-dining-open",
  "social-reading-zone",
  "style-coherence",
  "lighting-color",
  "floorplan-intake",
  "layout-check-repair",
  "master-bedroom",
  "guest-bedroom",
  "home-office",
  "kitchen-line-l-u",
  "bathroom-standard",
  "entry-storage",
];

const mappedCodes = {
  "CUR-01": ["CUR-01"],
  "WIN-01": ["WIN-01"],
  "DOOR-01": ["DOORWAY_BLOCKED"],
  "DOOR-02": ["DOORWAY_BLOCKED"],
  "OVER-01": ["POSSIBLE_OVERLAP"],
  "WALL-01": ["FURNITURE_IN_WALL"],
  "ASSET-02": ["SURFACE_ITEM_OVERHANG", "SURFACE_ITEM_COLLISION", "SURFACE_ITEM_HOST_MISSING"],
  "CIR-02": ["CIR-02", "DOORWAY_BLOCKED", "OUTSIDE_ROOM"],
};

async function response(request) {
  const replay = await request;
  const text = await replay.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!replay.ok)
    throw new Error(`${replay.status} ${JSON.stringify(data).slice(0, 2000)}`);
  return data;
}

async function json(url, body, method = "POST") {
  return response(
    fetch(base + url, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

function point(value) {
  return { x: Number(value[0]), y: Number(value[1]) };
}

function centroid(polygon) {
  const points = polygon.map(point);
  const sum = points.reduce(
    (result, current) => ({
      x: result.x + current.x,
      y: result.y + current.y,
    }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function objectFromCase(raw, idFallback) {
  const recipe = catalogue[raw.key];
  assert.ok(recipe, `Unknown catalogue key ${raw.key}`);
  const [x, y] = raw.at || [0, 0];
  return {
    ...recipe,
    ...raw,
    id: raw.id || idFallback,
    x: Number(x),
    y: Number(y),
    rot: Number(raw.rot || 0),
    w: Number(raw.w ?? recipe.w),
    d: Number(raw.d ?? recipe.d),
    h: Number(raw.h ?? recipe.h),
    color: raw.color || recipe.color || "#cccccc",
  };
}

function planFromCase(value) {
  const plan = blankPlan();
  plan.name = `Skill L3 ${value.case_id}`;
  const nodes = new Map();
  const nodeFor = ([x, y]) => {
    const key = `${x}:${y}`;
    if (!nodes.has(key))
      nodes.set(key, { id: `n_${nodes.size}`, x: Number(x), y: Number(y) });
    return nodes.get(key);
  };
  plan.walls = value.scene.walls.map((wall) => {
    const a = nodeFor(wall.a),
      b = nodeFor(wall.b);
    return {
      id: wall.id,
      a: a.id,
      b: b.id,
      // Skill ops use wall centerlines as the usable room boundary. The L3
      // adapter keeps that coordinate contract; production floorplans retain
      // their measured wall thickness and inner-face offsets.
      t: 20,
      bearing: Boolean(wall.bearing),
      status: "existing",
    };
  });
  plan.nodes = [...nodes.values()];
  const wallById = new Map(value.scene.walls.map((wall) => [wall.id, wall]));
  plan.openings = value.scene.openings.map((opening) => {
    const wall = wallById.get(opening.wall);
    assert.ok(wall, `Unknown opening wall ${opening.wall}`);
    const a = point(wall.a),
      b = point(wall.b);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const from = Number(opening.from),
      to = Number(opening.to);
    assert.ok(
      from >= 0 && to > from && to <= length + 1,
      "Opening range invalid",
    );
    return {
      id: opening.id,
      wall: opening.wall,
      type: opening.type,
      pos: (from + to) / 2,
      width: to - from,
      sill: Number(opening.sill ?? (opening.type === "door" ? 0 : 900)),
      head: Number(opening.head ?? 2100),
      hinge: opening.hinge === "to" ? 1 : 0,
      side: 1,
    };
  });
  plan.rooms = value.scene.rooms.map((room) => ({
    id: room.id,
    ...centroid(room.polygon),
    name: room.name,
    mat: "oak",
    wallMat: "latexWhite",
    ceil: { type: "none", drop: 0, edgeW: 400, cove: false },
  }));
  plan.furniture = (value.scene.objects || []).map((object, index) =>
    objectFromCase(object, `initial_${index}`),
  );
  return plan;
}

function candidateEdits(value, project) {
  const creates = [],
    updates = [],
    deletes = [],
    fieldMask = {},
    groups = [],
    activityGroups = [],
    skipped = [];
  const ids = new Set(project.plan.furniture.map((item) => item.id));
  const localIds = new Set();
  const xs = project.plan.nodes.map((node) => node.x),
    ys = project.plan.nodes.map((node) => node.y),
    bounds = {
      x0: Math.min(...xs),
      x1: Math.max(...xs),
      y0: Math.min(...ys),
      y1: Math.max(...ys),
    };
  const fitCenter = (object) => {
    const rotated = object.rot % 180 !== 0;
    const hx = (rotated ? object.d : object.w) / 2,
      hy = (rotated ? object.w : object.d) / 2;
    const result = { ...object };
    for (const [key, min, max, half] of [
      ["x", bounds.x0, bounds.x1, hx],
      ["y", bounds.y0, bounds.y1, hy],
    ]) {
      const lower = min + half + 10,
        upper = max - half - 10;
      if (result[key] < lower && lower - result[key] <= 200)
        result[key] = lower;
      if (result[key] > upper && result[key] - upper <= 200)
        result[key] = upper;
    }
    return result;
  };
  for (const edit of value.edits) {
    if (edit.op === "add") {
      const object = fitCenter(objectFromCase(edit.object, "candidate"));
      localIds.add(object.id);
      creates.push({
        type: "create",
        key: object.key,
        values: {
          x: object.x,
          y: object.y,
          rot: object.rot,
          w: object.w,
          d: object.d,
          h: object.h,
          color: object.color,
          ...(object.on
            ? { parentObjectId: object.on, placement: "surface" }
            : {}),
        },
      });
    } else if (edit.op === "move") {
      updates.push({
        type: "update",
        id: edit.id,
        values: { x: edit.to[0], y: edit.to[1] },
      });
      fieldMask[edit.id] = [
        ...new Set([...(fieldMask[edit.id] || []), "x", "y"]),
      ];
    } else if (edit.op === "rotate") {
      updates.push({ type: "update", id: edit.id, values: { rot: edit.rot } });
      fieldMask[edit.id] = [...new Set([...(fieldMask[edit.id] || []), "rot"])];
    } else if (edit.op === "resize") {
      const values = {};
      for (const key of ["w", "d", "h"])
        if (edit[key] !== undefined) values[key] = edit[key];
      updates.push({ type: "update", id: edit.id, values });
      fieldMask[edit.id] = [
        ...new Set([...(fieldMask[edit.id] || []), ...Object.keys(values)]),
      ];
    } else if (edit.op === "remove") {
      deletes.push(edit.id);
    } else if (edit.op === "material") {
      if (edit.color) {
        updates.push({
          type: "update",
          id: edit.id,
          values: { color: edit.color },
        });
        fieldMask[edit.id] = [
          ...new Set([...(fieldMask[edit.id] || []), "color"]),
        ];
      } else skipped.push("material");
    } else if (edit.op === "group") {
      for (const id of edit.ids || [])
        assert.ok(ids.has(id) || localIds.has(id), `Unknown group id ${id}`);
      groups.push({ name: edit.name, ids: edit.ids || [] });
      if ((edit.ids || []).every((id) => ids.has(id)))
        activityGroups.push({ name: edit.name, memberIds: edit.ids });
    } else {
      throw new Error(`Unsupported Skill edit op ${edit.op}`);
    }
  }
  const targetIds = [
    ...new Set(updates.map((item) => item.id).concat(deletes)),
  ];
  return {
    edits: [
      ...creates,
      ...updates,
      ...deletes.map((id) => ({ type: "delete", id })),
    ],
    scope: {
      targetIds,
      allowDeleteIds: deletes,
      allowAddKeys: [...new Set(creates.map((item) => item.key))],
      fieldMask,
      requirements: [],
    },
    groups,
    activityGroups,
    skipped,
  };
}

function codes(result) {
  return [...new Set(result.checks.issues.map((item) => item.code))].sort();
}

function triggered(code, got) {
  const mapped = mappedCodes[code];
  if (mapped !== undefined) return mapped.some((item) => got.includes(item));
  return got.includes(code);
}

function expectedMatched(expected, got) {
  return expected.every((code) => triggered(code, got));
}

const results = [];
for (const skillId of active) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(skillRoot, skillId, "manifest.json"), "utf8"),
  );
  assert.equal(manifest.status, "verified", `${skillId} is not verified`);
  assert.equal(manifest.activation, "active", `${skillId} is not active`);
  for (const caseName of fs
    .readdirSync(path.join(skillRoot, skillId, "examples"))
    .sort()) {
    const skillCase = JSON.parse(
      fs.readFileSync(
        path.join(skillRoot, skillId, "examples", caseName, "ops.json"),
        "utf8",
      ),
    );
    const project = await json("/api/projects", {
      document: planFromCase(skillCase),
    });
    const translated = candidateEdits(skillCase, project);
    const candidate = await json(`/api/projects/${project.id}/candidates`, {
      requestId: `skill-v1:${skillId}:${skillCase.case_id}`,
      taskId: `skill-v1:${skillId}:${skillCase.case_id}`,
      baseRevision: project.revision,
      scope: translated.scope,
      edits: translated.edits,
      activityGroups: translated.activityGroups,
      summary: `${skillId} ${skillCase.case_id}`,
    });
    const got = codes(candidate);
    const expected = skillCase.expect;
    if (translated.activityGroups.length)
      assert.equal(
        candidate.state.plan.source?.activityGroups?.length,
        translated.activityGroups.length,
        `${skillId}/${caseName} did not persist activity-group metadata`,
      );
    if (expected.pass) {
      assert.equal(
        candidate.checks.passed,
        true,
        `${skillId}/${caseName}: ${JSON.stringify(candidate.checks.issues)}`,
      );
      assert.ok(
        expected.must_not_trigger.every((code) => !triggered(code, got)),
        `${skillId}/${caseName} triggered forbidden code: ${got}; issues=${JSON.stringify(candidate.checks.issues)}`,
      );
      const evidence = await json(
        `/api/projects/${project.id}/candidates/${candidate.id}/render`,
        {},
      );
      assert.ok(
        evidence.length >= 2,
        "Positive L3 case needs two rendered views",
      );
    } else {
      const surfaced = expectedMatched(expected.must_trigger, got);
      assert.ok(
        !candidate.checks.passed || surfaced,
        `${skillId}/${caseName} unexpectedly passed; furniture=${candidate.state.plan.furniture.length}; issues=${JSON.stringify(candidate.checks.issues)}`,
      );
      if (expected.must_trigger.length)
        assert.equal(
          surfaced,
          true,
          `${skillId}/${caseName} expected ${expected.must_trigger}, got ${got}`,
        );
      assert.ok(
        (expected.must_not_trigger || []).every(
          (code) => !triggered(code, got),
        ),
        `${skillId}/${caseName} triggered forbidden code: ${got}; issues=${JSON.stringify(candidate.checks.issues)}`,
      );
    }
    results.push({
      skillId,
      caseId: skillCase.case_id,
      kind: skillCase.kind,
      passed: candidate.checks.passed,
      codes: got,
      groupCandidates: translated.groups.length,
      persistedActivityGroups:
        candidate.state.plan.source?.activityGroups?.length || 0,
      skippedMetadataEdits: translated.skipped,
    });
  }
}

const report = {
  passed: true,
  modelCalls: 0,
  service: base,
  activeSkills: active.length,
  cases: results,
};
const output = path.join(root, "test-results", "skill-pool-v1-l3.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
