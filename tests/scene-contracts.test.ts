import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  blankPlan,
  SceneError,
} from "../packages/scene-core/src/index.js";
import {
  validateEvidenceGraph,
  validateInputBundle,
  validateIntentSpec,
  validateSceneDraftPayload,
} from "../packages/scene-core/src/scene-contracts.js";
import {
  CURRENT_SCENE_PROGRAM_POLICY,
  blankSceneProgram,
  validateSceneProgram,
} from "../packages/scene-core/src/scene-program.js";
import { createApp } from "../apps/service/src/app.js";

const sources = [
  {
    sourceId: "text-1",
    kind: "text_brief",
    adapterVersion: "text-v1",
    uri: "task:input",
  },
  {
    sourceId: "plan-1",
    kind: "floorplan_image",
    adapterVersion: "floorplan-v4",
    sha256: "a".repeat(64),
  },
];

const roomProgram = () => ({
  ...blankSceneProgram(),
  levels: [
    {
      id: "level-1",
      name: "一层",
      elevation: 0,
      height: 2800,
      walls: [
        {
          id: "w1",
          a: { x: 0, y: 0 },
          b: { x: 4000, y: 0 },
          thickness: 200,
          sourceRefs: [
            { sourceId: "plan-1", authority: "observed", evidenceRefs: ["wall-1"] },
          ],
        },
        {
          id: "w2",
          a: { x: 4000, y: 0 },
          b: { x: 4000, y: 3000 },
          thickness: 200,
        },
        {
          id: "w3",
          a: { x: 4000, y: 3000 },
          b: { x: 0, y: 3000 },
          thickness: 200,
        },
        {
          id: "w4",
          a: { x: 0, y: 3000 },
          b: { x: 0, y: 0 },
          thickness: 200,
        },
      ],
      openings: [],
      roomSeeds: [
        {
          id: "room-1",
          at: { x: 2000, y: 1500 },
          name: "客餐厅",
          roomType: "living_dining",
          included: true,
        },
      ],
    },
  ],
  objects: [
    {
      id: "object-1",
      levelId: "level-1",
      roomSeedId: "room-1",
      categoryId: "sofa",
      sourceLabel: "沙发",
      included: true,
      placement: "floor",
      x: 1000,
      y: 1000,
      w: 2000,
      d: 900,
      rot: 0,
      evidenceRefs: ["plan-1:sofa"],
    },
  ],
});

const draft = () => ({
  schemaVersion: "actiscape.scene-draft.v1",
  projectId: "placeholder",
  baseProjectRevision: 0,
  inputBundle: { schemaVersion: "actiscape.input-bundle.v1", sources },
  evidenceGraph: {
    schemaVersion: "actiscape.evidence-graph.v1",
    facts: [
      {
        id: "plan-1:rooms",
        sourceId: "plan-1",
        kind: "room-label",
        data: { roomId: "room-1" },
        locator: "pixels:100,100",
      },
    ],
  },
  intentSpec: {
    schemaVersion: "actiscape.intent-spec.v1",
    request: "保留原图客餐厅布局",
    constraints: [
      {
        id: "intent-1",
        kind: "preserve_layout",
        text: "保留原图客餐厅布局",
        strict: true,
        sourceRefs: ["text-1"],
      },
    ],
    unknowns: [],
  },
  program: roomProgram(),
  assetResolutions: [],
  uncertainties: [],
  budgetLedger: {
    modelCalls: 1,
    activeSeconds: 3,
    repairRounds: 0,
    adapterCalls: 1,
    assetJobs: 0,
  },
  fieldAuthorities: [
    {
      path: "program.levels.0.walls",
      authority: "observed",
      sourceIds: ["plan-1"],
    },
  ],
});

test("scene contracts separate evidence, intent, authority and future geometry", () => {
  const bundle = validateInputBundle(draft().inputBundle);
  const evidence = validateEvidenceGraph(draft().evidenceGraph, bundle);
  const intent = validateIntentSpec(draft().intentSpec, bundle);
  assert.equal(evidence.facts[0].sourceId, "plan-1");
  assert.equal(intent.constraints[0].sourceRefs[0], "text-1");
  assert.throws(
    () =>
      validateEvidenceGraph(
        {
          ...draft().evidenceGraph,
          facts: [
            {
              ...draft().evidenceGraph.facts[0],
              sourceId: "text-1",
            },
          ],
        },
        bundle,
      ),
    /不能写入事实证据/,
  );
  const withObjectPhoto = validateInputBundle({
    schemaVersion: "actiscape.input-bundle.v1",
    sources: [
      ...sources,
      {
        sourceId: "photo-1",
        kind: "object_photo",
        adapterVersion: "object-photo-v1",
        sha256: "b".repeat(64),
      },
    ],
  });
  assert.throws(
    () =>
      validateEvidenceGraph(
        {
          ...draft().evidenceGraph,
          facts: [
            {
              ...draft().evidenceGraph.facts[0],
              sourceId: "photo-1",
            },
          ],
        },
        withObjectPhoto,
      ),
    /不能写入事实证据/,
  );
  const blank = validateSceneProgram(blankSceneProgram());
  assert.equal(blank.levels.length, 0);
  const multiLevelAngled = {
    ...roomProgram(),
    levels: [
      {
        ...roomProgram().levels[0],
        walls: [
          roomProgram().levels[0].walls[0],
          {
            id: "angled",
            a: { x: 4000, y: 0 },
            b: { x: 3000, y: 2000 },
            thickness: 200,
          },
        ],
      },
      {
        id: "level-2",
        name: "二层",
        elevation: 3000,
        height: 2800,
        walls: [],
        openings: [],
        roomSeeds: [],
      },
    ],
  };
  assert.throws(
    () => validateSceneProgram(multiLevelAngled),
    /正交墙|单层/,
  );
  assert.equal(
    validateSceneProgram(multiLevelAngled, {
      orthogonalOnly: false,
      singleLevel: false,
      requireIncludedRoom: false,
    }).levels.length,
    2,
  );
  assert.throws(
    () =>
      validateSceneDraftPayload({
        ...draft(),
        fieldAuthorities: [
          {
            path: "program.levels.0.walls",
            authority: "baseline",
            sourceIds: ["text-1"],
          },
        ],
      }),
    /只有已确认项目或户型图/,
  );
});

test("generic scene drafts persist revisions, hashes, replay and shared budget", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scene-draft-"));
  let app = await createApp({ dataDir: dir, logger: false });
  try {
    const project = app.store.create(blankPlan());
    const body = {
      requestId: "create-1",
      draft: { ...draft(), projectId: project.id },
    };
    const first = await app.app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scene-drafts`,
      payload: body,
    });
    assert.equal(first.statusCode, 201, first.body);
    const created = first.json();
    const replayed = await app.app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scene-drafts`,
      payload: body,
    });
    assert.equal(replayed.json().id, created.id);
    assert.equal(replayed.json().hash, created.hash);

    const missing = await app.app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scene-drafts/${created.id}/preview`,
    });
    assert.equal(missing.statusCode, 200, missing.body);
    assert.equal(missing.json().autoCommitReady, false);
    assert.deepEqual(missing.json().missingAssets, ["object-1"]);

    const patched = await app.app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scene-drafts/${created.id}/patches`,
      payload: {
        requestId: "patch-1",
        draftRevision: 0,
        commands: [
          {
            op: "replaceAssetResolutions",
            assetResolutions: [
              {
                objectId: "object-1",
                status: "catalogCandidates",
                catalogKeys: ["sofa"],
              },
            ],
          },
          {
            op: "replaceProgram",
            program: {
              ...roomProgram(),
              objects: [
                {
                  ...roomProgram().objects[0],
                  catalogKey: "sofa",
                },
              ],
            },
          },
        ],
      },
    });
    assert.equal(patched.statusCode, 200, patched.body);
    assert.equal(patched.json().revision, 1);
    assert.notEqual(patched.json().hash, created.hash);
    const ready = await app.app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scene-drafts/${created.id}/preview`,
    });
    assert.equal(ready.json().autoCommitReady, true);

    const stale = await app.app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scene-drafts/${created.id}/patches`,
      payload: {
        requestId: "stale",
        draftRevision: 0,
        commands: [{ op: "replaceUncertainties", uncertainties: [] }],
      },
    });
    assert.equal(stale.statusCode, 409);
    const regression = await app.app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scene-drafts/${created.id}/patches`,
      payload: {
        requestId: "regression",
        draftRevision: 1,
        commands: [
          {
            op: "replaceBudgetLedger",
            budgetLedger: {
              modelCalls: 0,
              activeSeconds: 3,
              repairRounds: 0,
              adapterCalls: 1,
              assetJobs: 0,
            },
          },
        ],
      },
    });
    assert.equal(regression.statusCode, 422);
    assert.equal(regression.json().error, "BUDGET_REGRESSION");
    const revisions = await app.app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/scene-drafts/${created.id}/revisions`,
    });
    assert.deepEqual(
      revisions.json().map((item: any) => item.revision),
      [0, 1],
    );
    app.store.close();
    app = await createApp({ dataDir: dir, logger: false });
    const reopened = await app.app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/scene-drafts/${created.id}`,
    });
    assert.equal(reopened.statusCode, 200);
    assert.equal(reopened.json().hash, patched.json().hash);
  } finally {
    await app.app.close();
  }
});
