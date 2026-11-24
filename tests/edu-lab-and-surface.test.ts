import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  checkScene,
  createFurniture,
  isSurfaceHost,
  sceneRoomKind,
} from "../packages/scene-core/src/index.js";
import { buildTemplatePlan } from "../apps/service/src/showcase-templates.js";

const FIXTURES_DIR = path.resolve("fixtures");

test("bio-chem-teaching-lab and multimedia-seminar-room templates compile with 0 check issues", () => {
  for (const templateId of ["bio-chem-teaching-lab", "multimedia-seminar-room"]) {
    const { meta, plan } = buildTemplatePlan(templateId, FIXTURES_DIR);
    assert.equal(meta.tier, "edu_lab");
    const report = checkScene(plan);
    const errors = report.issues.filter((i) => i.level === "error");
    assert.equal(
      errors.length,
      0,
      `${templateId} had check errors: ${errors.map((e) => `${e.code}:${e.message}`).join("; ")}`,
    );
  }
});

test("teaching lab and seminar tabletop keys are recognized as surface hosts and room kinds map cleanly", () => {
  assert.equal(sceneRoomKind("teaching_lab"), "multipurpose");
  assert.equal(sceneRoomKind("seminar_classroom"), "multipurpose");
  for (const key of ["kitchenIsland", "conferenceTable", "pantryCounter", "lectern", "deskBench2"]) {
    const item = createFurniture(key, 3000, 3000);
    assert.equal(isSurfaceHost(item), true, `${key} should be a valid surface host`);
  }
});
