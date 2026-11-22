import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  actionCommand,
  auditSafety,
  checkScene,
  exportPlanToMujocoXml,
} from "../packages/scene-core/src/index.js";
import { createApp } from "../apps/service/src/app.js";

test("checkScene preserves 100% backwards-compatibility when safetyProfile is not enabled", () => {
  const living = JSON.parse(
    fs.readFileSync(path.resolve("fixtures/living-dining.plan.json"), "utf8"),
  );
  const res = checkScene(living);
  const safetyCodes = res.issues.filter((i) =>
    [
      "WHEELCHAIR_TURNING_BLOCKED",
      "SEISMIC_TOPPLE_BED_HAZARD",
      "SEISMIC_TOPPLE_EXIT_BLOCKED",
      "SENSOR_BLIND_SPOT",
    ].includes(i.code),
  );
  assert.equal(safetyCodes.length, 0);
});

test("auditSafety & checkScene detect elderly wheelchair & HarmonyOS mmWave radar blind-spots, and clear after layout fix", () => {
  const elderly = JSON.parse(
    fs.readFileSync(
      path.resolve("fixtures/elderly-care-hazard.plan.json"),
      "utf8",
    ),
  );
  const report = auditSafety(elderly);
  assert.equal(report.enabled, true);

  const codes = new Set(report.issues.map((i) => i.code));
  assert.ok(
    codes.has("WHEELCHAIR_TURNING_BLOCKED"),
    `Expected WHEELCHAIR_TURNING_BLOCKED in ${[...codes]}`,
  );
  assert.ok(
    codes.has("SENSOR_BLIND_SPOT"),
    `Expected SENSOR_BLIND_SPOT in ${[...codes]} (coverage=${report.radar.coverageRatio})`,
  );
  assert.ok(report.radar.topOccluderIds.includes("radar_blocker_wardrobe"));

  // Opt-in checkScene integration also surfaces blocking safety issues
  const sceneCheck = checkScene(elderly);
  assert.ok(
    sceneCheck.issues.some((i) => i.code === "WHEELCHAIR_TURNING_BLOCKED"),
  );
  assert.ok(sceneCheck.issues.some((i) => i.code === "SENSOR_BLIND_SPOT"));

  // Relocate wardrobe to south-west wall corner and remove oversized coffee table
  const fixed = structuredClone(elderly);
  fixed.furniture = fixed.furniture.filter(
    (f: any) => f.id !== "wheelchair_blocker_table",
  );
  const wardrobe = fixed.furniture.find(
    (f: any) => f.id === "radar_blocker_wardrobe",
  );
  wardrobe.x = 420;
  wardrobe.y = 3150;
  wardrobe.rot = 270;
  wardrobe.opt = { ...(wardrobe.opt || {}), wallAnchored: true };

  const afterReport = auditSafety(fixed);
  const afterCodes = new Set(afterReport.issues.map((i) => i.code));
  assert.ok(!afterCodes.has("WHEELCHAIR_TURNING_BLOCKED"));
  assert.ok(
    !afterCodes.has("SENSOR_BLIND_SPOT"),
    `Expected radar clear after fix, got coverage=${afterReport.radar.coverageRatio}`,
  );
  assert.ok(afterReport.radar.coverageRatio >= 0.85);
});

test("seismic topple audit detects bed strike & exit blockage and clears when wallAnchored is applied", () => {
  const seismic = JSON.parse(
    fs.readFileSync(
      path.resolve("fixtures/seismic-bedroom-hazard.plan.json"),
      "utf8",
    ),
  );
  const report = auditSafety(seismic);
  const codes = new Set(report.issues.map((i) => i.code));
  assert.ok(codes.has("SEISMIC_TOPPLE_BED_HAZARD"));
  assert.ok(codes.has("SEISMIC_TOPPLE_EXIT_BLOCKED"));

  // Reference cabinet with wallAnchored=true must NOT appear in error objectIds
  const errorObjectIds = new Set(report.issues.flatMap((i) => i.objectIds));
  assert.ok(!errorObjectIds.has("anchored_demo_cabinet"));

  // Anchor command helper works deterministically
  const cmd = actionCommand(
    seismic,
    "furniture",
    "unanchored_wardrobe_bed",
    true,
    "anchor_wall",
  );
  assert.ok(cmd && cmd.type === "update");
  assert.equal((cmd as any).patch.opt.wallAnchored, true);

  // Anchor all tall cabinets -> zero seismic errors
  const anchoredPlan = structuredClone(seismic);
  for (const f of anchoredPlan.furniture) {
    if (f.h >= 1400) f.opt = { ...(f.opt || {}), wallAnchored: true };
  }
  const cleanReport = auditSafety(anchoredPlan);
  assert.equal(
    cleanReport.issues.filter((i) => i.code.startsWith("SEISMIC_")).length,
    0,
  );
});

test("exportPlanToMujocoXml produces valid MJCF with doorway cutouts, hinge joints, and wall anchors", () => {
  const seismic = JSON.parse(
    fs.readFileSync(
      path.resolve("fixtures/seismic-bedroom-hazard.plan.json"),
      "utf8",
    ),
  );
  const xml = exportPlanToMujocoXml(seismic);
  assert.ok(xml.startsWith('<?xml version="1.0"'));
  assert.ok(xml.includes("<mujoco model="));
  assert.ok(xml.includes('type="hinge"'));
  assert.ok(xml.includes("<freejoint"));
  assert.ok(xml.includes("_wall_anchor"));
  assert.ok(xml.includes("harmony_mmwave"));
});

test("HTTP routes: /api/mcp/openapi.json, /safety-audit, /anchor-furniture, and /export-mujoco", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "actiscape-safety-"));
  const { app } = await createApp({ dataDir: tmpDir, logger: false });
  try {
    // 1. Curated Huawei Cloud AgentArts Dual-MCP OpenAPI 3.0.3 spec
    const mcpRes = await app.inject({
      method: "GET",
      url: "/api/mcp/openapi.json?serverUrl=https://mcp.example.com",
    });
    assert.equal(mcpRes.statusCode, 200);
    const spec = mcpRes.json();
    assert.equal(spec.openapi, "3.0.3");
    assert.equal(spec.servers[0].url, "https://mcp.example.com");
    const ops = Object.values(spec.paths).flatMap((p: any) => Object.values(p));
    assert.equal(ops.length, 8);
    assert.ok(!JSON.stringify(spec).includes('"anyOf"'));
    assert.ok(!JSON.stringify(spec).includes('"oneOf"'));

    // 2. Create project from seismic showcase fixture
    const exRes = await app.inject({
      method: "GET",
      url: "/api/examples/seismic-bedroom-hazard",
    });
    assert.equal(exRes.statusCode, 200);

    const createRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { document: exRes.json() },
    });
    assert.equal(createRes.statusCode, 201);
    const project = createRes.json();

    // 3. Run /safety-audit
    const auditRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/safety-audit`,
      payload: { seismicIntensity: 7 },
    });
    assert.equal(auditRes.statusCode, 200);
    assert.ok(auditRes.json().blockingCount >= 2);

    // 4. Run /anchor-furniture and verify seismic hazards vanish
    const anchorRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/anchor-furniture`,
      payload: { anchored: true, baseRevision: project.revision },
    });
    assert.equal(anchorRes.statusCode, 200);
    const postAnchorIssues = anchorRes.json().safetyAudit.issues;
    assert.equal(
      postAnchorIssues.filter((i: any) => i.code.startsWith("SEISMIC_")).length,
      0,
    );

    // 5. Export MuJoCo XML
    const mjRes = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/export-mujoco`,
    });
    assert.equal(mjRes.statusCode, 200);
    assert.ok(mjRes.headers["content-type"]?.includes("application/xml"));
    assert.ok(mjRes.body.includes("<mujoco"));
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
