# S0 / S1 / S2-A / S2-B / S2-C implementation status

## 2026-11-12 cleanup baseline

This section is the current engineering gate for the `feat/floorplan-auto-completion`
working branch. The historical S2-C claims below remain evidence for their recorded
commits; they are not a release claim for the current branch. Phase 1 is focused on
the reliable local edit loop: explicit target state, authorization-safe repairs,
candidate checks, atomic commit, undo/redo, and recovery.

- Completed in this phase: negated and compound requests leave the deterministic
  fast path; move/rotate/color and explicit width/depth/height edits use the
  deterministic path; open/close actions are idempotent desired-state operations;
  quick actions never move blocking furniture; compound requests require
  normal intent grounding and field authorization; action/photo candidates use a
  deterministic evidence mode; service-side task authorization is frozen by hash;
  AgentArts timeout requests cancellation before returning.
- Verification: Node tests 101/101, Python agent tests 201/201 with the pinned Node
  runtime, and TypeScript typecheck.
- Live acceptance: current working-tree Node/Python services passed 6/6 fixed
  local-edit cases (reading corner, add, size/color, delete, multi-turn,
  clarification). The separate action run completed with `modelCalls=0`,
  candidate `verification=deterministic`, empty evidence, and revision 1.
  Evidence: [`phase1-current-20261112/live/report.json`](../test-results/phase1-current-20261112/live/report.json)
  and [`action-live.json`](../test-results/phase1-current-20261112/live/action-live.json).
- Deferred: floorplan/photo/cloud expansion remains experimental until this edit
  gate is accepted. The independent code/design audit is in
  [`INDEPENDENT_DESIGN_ALIGNMENT_AUDIT_20261112.md`](INDEPENDENT_DESIGN_ALIGNMENT_AUDIT_20261112.md).

Approved scope: single-floor editor; complete upstream parametric catalogue, cabinets and 17 free-form types; persistent projects/assets and undo/redo; real scene APIs. S2-A adds conversation-driven local furniture editing through four roles, frozen candidates, deterministic checks, real screenshots and one atomic commit.

Development branch: `dev/core`. Upstream: `ZWD11/house-plan-designer@b94183f9ce2215db9a178da89a90d2ecefb18497`.

## Gates

- [x] S0.1: isolated runtime and immutable upstream reference
- [x] S0.2: executed behaviour baseline and evidence
- [x] S1.1: extracted dependency-managed business modules
- [x] S1.2: transactional scene service, assets and durable history
- [x] S1.3: complete editable-project workflow
- [x] S1.4: full retained modelling and editing coverage
- [x] S1.5: integration acceptance and handoff

This file records actual gates. A scaffold, mock, skipped check or embedded upstream HTML does not establish S1 completion.

Historical S1 accepted implementation and test commit: `2749ff0adf4f3e6d97e5c8c17faf901e0e8d3ece`. S2-A started from `884b03e`.

Executed evidence: 10 core/service groups; 14 original baseline checks; 16 real-browser workflows; 24 modelling recipe comparisons; all 266 catalogue bodies match mesh/vertex counts and measured dimensions within 0.01 mm. Fixed-view captures use asserted camera parameters. See [acceptance](ACCEPTANCE.md) for differences, original limitations and scope boundaries.

## S1 closeout and S2-A

| Gate                               | Actual status                                                                                                                         | Evidence                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| M0 validation closeout             | Passed; wall heights, beam endpoints, nested recipes and references reject invalid transactions with field locations                  | `aa5e1a7`; Node tests                                                                       |
| M1 frozen candidates and checks    | Passed; real HTTP, readonly WebGL screenshots, scope protection, atomic commit/replay and undo                                        | `ae5b7a4`; `evidence/s2a/candidates/`                                                       |
| M2 framework and model             | Passed; official DeepSeek tool continuation, typed arguments and image input                                                          | `128e23e`; `evidence/s2a/agent/model-smoke.json`                                            |
| M3 four-role CLI                   | Passed; main/design/assets/check really participate in an add-furniture case; LangGraph durable recovery and bounded failures covered | `1c2a418`, `d526734`; live traces and Python tests                                          |
| M4 conversation workbench          | Passed; selection, clarification, continuous references, progress, cancellation, SSE and persistent reopening                         | `b2d1f7a`; browser evidence                                                                 |
| M5 local integration               | Passed; original full regression, 12/12 live cases, GLB edits, retry, clean install, stopped backup/restore and remote CI             | `65ad21e`, `e9231e3`; [S2-A acceptance](S2A_ACCEPTANCE.md)                                  |
| Member three platform connectivity | Local SDK real tool loop passed; cloud deployment and ARM64 image remain pending                                                      | `evidence/s2a/platform-probe/report.json`; [handoff](../deploy/agentarts-minimal/README.md) |

The original S0 checkboxes cover member one's upstream/editor baseline. They do not mean that the whole team's platform, asset generation or competition deliverables have passed.

## S2-B rectangular text generation

| Gate                                  | Actual status                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| B0 structure and initialization tools | Passed: true net dimensions and unit conversion, fixed structure IDs, readonly preview, checked initialization, one transaction and undo to blank |
| B1 brief and real Skill               | Passed: missing information waits; brief, defaults, source evidence and versioned Skill content persist; old edit identities survive migration    |
| B2 four-role generation               | Passed: two fixed cases twice; final batch 4/4 with official DeepSeek, catalogue tools, deterministic checks and real images                      |
| B3 workbench                          | Passed: actual new-project button, conversation/brief card, clarification, mode transition, service restart and continuous reference/edit         |
| B4 regression and handoff             | Passed: Node 17 / Python 23, original full regression, six S2-A model flows, complete stopped backup/restore, Skill wheel resources and remote CI |

The first formal batch passed 2/4; two asset request/instance indexing failures were rejected without changing projects. After strict per-request schema correction, a new complete batch passed 4/4. Both batches remain in [S2-B acceptance](S2B_ACCEPTANCE.md). Final generation prompt version is `s2b-rectangular-2`; the first real Skill is `rectangular-living-reading@0.1.0`.

## S2-C floorplan inputs

S2-C is complete on service commit `4f204a9` with business code `b3d2617`. The V3-6 same-version matrix ran both frozen floorplans twice: all four runs passed first recognition and final scoring with zero repairs, zero object corrections, revision 4, real catalogue assets, independent WebGL checks, one atomic commit, undo/redo and a real local conversation edit. This closes the two-image S2-C gate; S3 photo assets, S4 GEPA and S5 AgentArts deployment remain separate work. See [two-image matrix](S2C_FULL_MATRIX.md) and [release evidence](evidence/s2c-v3-6-two-image-2of2-20261108.json).

The entries below are chronological development history. Failures and stage conclusions remain unchanged for their recorded commits and must not be read as the current release status.

Earlier V3 bounded recognition introduced fixed candidate analysis, separate structure and furniture passes, deterministic merging and controlled V1/V2/V3 browsers. The fixed single-image batch at `c72d4e9` was 0/2: one mixed wall-candidate orientation and one out-of-wall opening; both failed closed before draft creation. See [V3 flow alignment](S2C_FLOW_ALIGNMENT.md).

V3-2 adds candidate-wall grouping, one bounded structure repair, fixed measurement precomputation and explicit manual recheck. Two development runs created drafts; the second compiled after 49 manual corrections but failed the independent source review on openings, furniture placement and dimension evidence. No candidate or formal project was submitted. See [development evidence](evidence/s2c-v3-dev-loop-20261108.json).

Latest V3-3 implementation adds deterministic perimeter-wall closure, wall-band measurement, opening scans, external dimension-line candidates, target-room furniture contours and code-first review arbitration. New tasks use `s2c-floorplan-v3-3`, `structureSkeletonVersion=3`, `hpd-adapter-5`, Skill 0.5.2 and `s2c-4` scoring. The frozen real image replays to 6 walls, 7 openings, 4 dimension candidates and 51 furniture contour candidates without model calls. Controlled V1/V2/V3 browser and WebGL flows pass. The one planned real run at `9a14a9f` completed structure without repair but failed at furniture contour ownership: `fc_041` was assigned to both the dining-table group and the west chair. No draft or formal write occurred; the batch stopped. See [flow alignment report](S2C_FLOW_ALIGNMENT.md) and [failed-run evidence](evidence/s2c-v3-3-live-20261108.json).

V3-4 adds an independent local furniture-grounding model while retaining DeepSeek for structure, measurement and orchestration. Qwen3-VL-32B-Instruct-FP8 and GLM-4.6V-Flash were both loaded through vLLM and called on the same frozen structure and image. Neither passed: Qwen still omitted two chairs and coupled the dining table to chair contours; GLM produced four chairs with 0.7273 category precision and 0.6154 recall. The execution path now enforces four fixed images, contour-ID-only output, one recovery attempt, ownership rejection and model/usage evidence. No real zero-correction task, second image or formal project submission was started. See [V3-4 comparison evidence](evidence/s2c-v3-4-vision-comparison-20261108.json).

V3-5 replaces raw contour selection with a deterministic object graph and lightweight activity units. The frozen image yields 19 object candidates, 13 selectable target objects, a separate sofa/rug/coffee table representation, and one radial dining group containing six independent chairs. Qwen returns object IDs plus `group_seated` membership; code validates ownership, unique primary objects and complete chair membership. The offline pass reached 13/13 objects, six chairs, 1.0 category precision/recall and all layout thresholds after one bounded repair. Controlled V1/V2/V3 browser, WebGL, Python, Node, typecheck, build and full original-capability regression pass. See [V3-5 offline evidence](evidence/s2c-v3-5-offline-20261108.json).

The single real run at `423d826` completed structure but failed closed with `FURNITURE_MISSING`: Qwen returned only exclusions on the first call and an empty object array on the bounded repair. No draft or formal write occurred. A post-failure offline hardening now requires the exact selectable-symbol count in the request schema and passes 13/13 offline, but the real-image batch was stopped and was not rerun. See [V3-5 live failure](evidence/s2c-v3-5-live-20261108.json).

After explicit approval, `81ee0b1` was run once as an independent new batch. It failed again with `FURNITURE_MISSING`: both guided responses omitted `symbols` entirely. The schema bug is now isolated to JSON Schema property optionality; `symbols` and `activityGroups` are added to the schema `required` array while retaining exact count bounds. The corrected schema passes a real local-vLLM offline replay at 13/13 objects, six chairs and 1.0 category precision/recall, but it has not been run against real imagery. See [second live failure](evidence/s2c-v3-5-live-r2-20261108.json).

The next real run at `108aee5` passed first recognition completely: walls, seven openings, 13 furniture objects and activity groups all scored 1.0, including six chairs. It then stopped in measurement because labelled dimensions lacked deterministic geometry-feature bindings. No compile, confirmation or project write occurred. This moves the active blocker from recognition to the measurement layer. See [third live run](evidence/s2c-v3-5-live-r3-20261108.json).

The `a1457d6` measurement fix kept all four labels as anchors and generated wall-face features plus dimension commands in fixed code, with draft revision/hash forced by code. One independent real run then compiled, passed deterministic checks and review, matched all four dimension constraints exactly, and passed all 13 furniture layout thresholds at zero human corrections. First recognition remained 1.0 for walls, seven openings, 13 furniture objects and activity groups. Independent scoring failed only because the model expanded the visible room labels instead of copying `Living Room`, `Bedroom` and `Bathroom` verbatim. The batch stopped without a second run, confirmation, candidate or project write. Commit `1256273` now requires verbatim source room labels offline, but that prompt change has not been rerun. See [fourth live run](evidence/s2c-v3-5-live-r4-20261108.json).

The `b3690bc` follow-up run confirmed that verbatim labels are available from structure recognition and that furniture/candidate geometry produced the correct initial rotations. The measurement role nevertheless overwrote room names and six furniture rotations before diagnostics, so first recognition, dimensions, compile and review passed while independent final scoring failed. The batch stopped at one run with zero formal writes. Commit `59aed64` now freezes semantics during measurement: model proposals may only patch wall `a/b/thicknessPx`, maintain uncertainties and set height/wall thickness; fixed code filters rooms, symbols, openings, targets, anchors and measurement collections. Replaying all four captured responses removes every semantic mutation. Python 90/90, Node 36/36, typecheck, build and controlled V3 browser pass, but the fix has not been rerun on the real image. See [fifth live run](evidence/s2c-v3-5-live-r5-20261108.json).

After the semantic freeze, `f21b65d` produced the first fully passing pre-confirmation score: all recognition, room labels, topology, 13 furniture layouts and four dimensions matched, with zero manual corrections. The task still stopped because four stale blocking uncertainties were treated as unconditional hard failures even though fixed code had complete dimension and opening evidence. Commit `cec6510` now arbitrates uncertainties against code: code-covered dimension/opening notes become advisory, while unresolved blockers fail closed. Replaying the exact failed draft yields review `passed=true` with four advisories. Python 93/93 and the controlled V3 browser pass; the run used 17 calls and 110.76 seconds, stopped after one run and wrote no formal project. See [sixth live run](evidence/s2c-v3-5-live-r6-20261108.json).

The `f2e96c0` batch again achieved full first-recognition scores but failed before measurement because the initial reviewer was called while deterministic diagnostics still lacked code-generated dimension rows. The check role twice returned no structured review and the task ended with `MODEL_FORMAT`. Commit `ab4e7a7` now skips the initial review when diagnostics require measurement repair and proceeds directly to the code-owned measurement stage; the later pre-confirmation review remains mandatory. The batch stopped after one run with no compile, confirmation or formal write. Python 94/94, controlled V3 browser and WebGL pass. See [seventh live run](evidence/s2c-v3-5-live-r7-20261108.json).

The `461c468` run completed the entire runtime workflow for the first time: all recognition and dimension checks passed, the draft was confirmed, 13 real catalogue assets rendered with WebGL evidence, one transaction committed, undo returned to blank, redo restored the plan, and a real local colour edit committed. Independent proof still rejected two catalogue choices (`fourSofa`, `bookshelf`) and the procedural plant footprint. Commit `88eb7e2` now normalizes equivalent sofa/bookshelf/plant choices by confirmed footprint while preserving explicit user keys, and scales the plant group to its declared footprint. Replaying the captured assets yields `sofa` and `cabTall`; the existing plant instance now passes geometry proof at approximately 477×466 mm. Python 96/96, Node 36/36, typecheck, build, controlled V3, full browser and 266-item WebGL regression pass. The batch stopped after one run with no second image. See [eighth live run](evidence/s2c-v3-5-live-r8-20261108.json).

The `6f0930b` batch again passed first recognition and final scoring with zero corrections. It stopped before confirmation on one open-kitchen/living-room scope uncertainty even though deterministic topology found one valid living target room and the requested kitchen scope was structure-only. Commit `c33a67b` resolves that uncertainty as advisory when the target living/dining room exists and no other deterministic blocker remains. Replaying the captured draft yields `passed=true`; Python 97/97 and controlled V3 browser pass. No second run occurred. See [ninth live run](evidence/s2c-v3-5-live-r9-20261108.json).

The new `npm run test:floorplan:v35-replay` gate combines captured r8 through r11 failures, current equivalent-asset normalization, activity binding repair, uncertainty arbitration, catalogue mapping proof and actual Three.js bounds in one zero-model-call run. It currently passes with `sofa`, `cabTall`, valid plant geometry, the complete r8 workflow, zero blocking r9/r10 issues and the r11 `fo_012 -> fo_017` satellite repair. See [combined replay evidence](evidence/s2c-v3-5-replay-20261108.json).

The `eb8626f` live run repeated the increasingly common pattern: perfect recognition and final scoring, followed by an opening-type uncertainty that the fixed candidates had already resolved. Commit `296d0d6` adds structured uncertainty codes and a pre-preview reconciliation pass that downgrades only code-covered blockers. The following `296d0d6` run then failed earlier when Qwen reused the dining-table object for a chair on both attempts. Commit `ca82633` repairs chair bindings from the activity candidate's complete satellite set without another model call, turning the captured `fo_012` reuse into `fo_017`. Python 99/99, Node 36/36, typecheck, build and controlled V3 pass. No second run occurred. See [tenth](evidence/s2c-v3-5-live-r10-20261108.json) and [eleventh](evidence/s2c-v3-5-live-r11-20261108.json) live runs.

A paired run then achieved one complete success but exhausted the shared budget in its second run because uncatalogued local dimension labels remained blocking through repeated measurement rounds. Commit `30b1f06` resolves `DIMENSION_LOCAL` as advisory once all fixed dimensions are bound. A new independent batch at that commit passed both complete real runs: 19 calls / 164.01 seconds and 17 calls / 159.07 seconds, both with zero repairs, zero manual corrections, revision 4, real catalogue assets, WebGL, atomic commit, undo/redo and local edit. At that stage the S2-C single-image gate reached **2/2**; the second image and two-image matrix were still pending. See [single-image 2/2 evidence](evidence/s2c-v3-5-single-image-2of2-20261108.json).

The second frozen “92” image then received an independent six-room, 12-opening, 13-furniture evaluation reference and a real attempt at commit `de61350`. Its first run did not pass: hpd-adapter-5 turned the image/line envelope into a rectangular four-wall outline, kept only two interior walls, emitted no dimension candidates, and produced 0.3785/0.2580 wall precision/recall plus one matched opening and seven matched furniture items. The task stopped at `waiting_input` with no compilation or formal write. The auto-started second run was cancelled after five calls under the stop-on-failure rule. At that stage the second image was **0/2**. See [second-image report](S2C_SECOND_IMAGE.md) and [evidence](evidence/s2c-v3-5-second-image-failed-20261108.json).

V3-6 replaced that broken geometry path for new tasks with `hpd-adapter-6-1`, `structureSkeletonVersion=4` and Skill `0.5.6`. Source-mask wall components, concavity-aware endpoint snapping, analysis gaps and an external dimension line compile the 92 image into 28 wall segments, 12 openings and six rooms; the corrected reference scores walls 1.0/1.0 and openings 0.9167/1.0. The object graph produced 11 target objects, one four-chair dining activity group, a table-sized primary object and a tight TV-cabinet group while excluding fixed entry cabinets. The offline V3-6 replay passed with zero model calls, after which the frozen real matrix completed 2/2 for this image.

The orthogonal image draft compiler, durable image storage, overlay correction and explicit confirmation workflow are implemented. Reconnaissance, measurement and review retain confirmed positions and per-symbol sizes; catalogue decisions are separate from recognition. Controlled browser/WebGL, transaction and restart tests pass. Both real floorplans have now passed 2/2 in the same-version matrix.

## Skill Pool v1

The runtime now accepts only `actiscape.skill.v1`. The fixed in-repo snapshot contains 32 Skills: 30 migrated member-three packages plus two built-in floorplan/text-generation Skills. Nine are active and verified; 23 member-three packages remain reserved and cannot enter a model shortlist.

Code filters by task mode, project state, room kind, area, capabilities and verification status. The grounding model may select one primary Skill and at most two modifiers from that shortlist; intake and repair Skills are activated automatically by fixed workflow stages. Skill bundles pin manifest, body, referenced judgements and licence text by hash, while old tasks continue reading their frozen legacy snapshots.

`npm run test:skill-pool:v1` runs the seven active member-three Skills through real candidate preflight and two-view WebGL for positive cases and verifies the expected real-core codes for boundary cases. The repair Skill is captured at task start but activated only after a deterministic failure, so file updates cannot mix into a running task. At the Skill Pool v1 release the combined gate passed with Python 129 and Node 41; the later V4 contract and development-reference gates raise the current totals to Python 139 and Node 47. Evidence is stored in [Skill Pool v1 L3](evidence/skill-pool-v1-l3-20261109.json), [structure/catalogue validation](evidence/skill-pool-v1-structure-20261109.json) and [repair snapshot verification](evidence/skill-pool-v1-repair-snapshot-20261109.json). GEPA candidate optimisation and final evaluation splitting remain open.

## Generic scene foundation

The first general-scene batch adds versioned input, evidence, intent, scene-program and scene-draft contracts. Generic drafts persist independently from the formal project, bind project revision, enforce idempotent patches, preserve a revision/hash chain, reject stale edits and prevent budget regression. The scene program type supports arbitrary wall directions and multi-level containers, while the current capability policy accepts only orthogonal single-floor drafts.

A data-driven scene registry now owns room status, Skill mapping, materials, default furniture, object categories and catalogue candidates. The rectangular text path reads active room metadata from the registry, and the TypeScript compiler no longer accepts only the original two room-purpose strings. Existing `purpose` data remains readable. Reserved rooms are explicitly rejected as unsupported.

This foundation does not migrate the floorplan recognition flow, reconstruct whole-home furniture, activate reserved rooms or claim photo input. Those remain later gates in [Scene Architecture](SCENE_ARCHITECTURE.md). Executed results are in [scene foundation evidence](evidence/scene-foundation-v1-20261109.json).

Text-generation and local-edit tasks maintain a task-bound generic draft alongside the existing candidate and commit path. Text is projected into IntentSpec, imported project state into baseline authority, and shell/candidate plans into SceneProgram with catalogue asset resolutions. V4 floorplan drafts are different: the legacy `/floorplan-drafts` API is now a façade over the same persisted SceneDraft v2 record, so there is no second floorplan draft, no post-candidate projection write, and no independent confirmation authority. Evidence for the earlier compatibility bridge remains in [scene draft projection](evidence/scene-draft-projection-20261109.json) and [floorplan scene projection](evidence/floorplan-scene-projection-20261109.json).

The next floorplan development batch introduces V4 without changing the accepted V3-6 matrix. New reconstruction tasks use `workflowVersion=4`, `recognitionVersion=4`, `s2c-floorplan-v4-2`, Skill `0.7.0`, `hpd-adapter-6-1`, `candidatePolicyVersion=geometry-only` and `s2c-6` scoring. The floorplan scope defaults to all visible rooms, supports deterministic functional-area inclusion/exclusion, and code recomputes target rooms after room-label consolidation. V4 furniture candidates carry authoritative room IDs, remove legacy living-room category hints and fixed-entry exclusions, and use the full residential catalogue category set. Capacity is 300 furniture objects with a 100-command patch limit.

V4 draft persistence now uses only `SceneDraft v2`: a floorplan recognition block stores the pixel proposal, source image hash, anchors, measurements, review and confirmation metadata, while `SceneProgram` is deterministically derived in millimetres. Geometry edits advance the SceneDraft revision/hash and invalidate review/confirmation; review and confirmation metadata bind the current hash without changing that hash. The old `/floorplan-drafts` URLs remain usable as a façade, while V1/V2/V3 records continue using the original table. A V4 task with different `draftId` and `sceneDraftId` values fails closed. Tests cover single-table persistence, generic SceneDraft visibility, idempotent commands, review/confirmation without hash drift, invalidation after edits, candidate creation from the same confirmed draft and unchanged legacy V1-V3 storage. Evidence is in [floorplan SceneDraft authority](evidence/floorplan-scene-authority-v2-20261110.json).

V4-2 starts the multi-Agent responsibility split without changing recognition acceptance. `main` no longer owns structure recognition; new tasks call a dedicated `structure` role that only selects wall, opening, room and dimension candidate IDs. Measurement runs under the same structure role, furniture remains a separate `vision` role restricted to object candidate IDs, and `assets`, `design` and `check` retain independent scopes. Each role receives an allowlisted `RoleContextV1`, and completed model turns emit hash-bound stage results. The fixed Coordinator maps validated review errors to `structure`, `vision`, `assets`, `design` or itself; structure and vision receive at most one targeted repair, while assets and design share the existing three-round budget.

A static provider registry and subprocess runner now wrap the existing HPD adapter as an experimental structure provider. Runner output is an `ArtifactEnvelopeV1` containing pixel candidates, source and scope hashes, provider identity, evidence hashes and a runtime file-access guard. Providers cannot write SceneDraft, commit projects or read evaluation-only directories. Read-only `/api/agent/vision/providers` and `/api/agent/capabilities` endpoints expose provider status and actual supported scope. No new structure backend, furniture provider or V4-2 real acceptance result is claimed yet.

This is not a whole-home acceptance result. The two existing images still lack reviewed furniture references for bedrooms, kitchens, bathrooms and studies, and no real V4 zero-correction run has been executed. The accepted S2-C result remains the V3-6 two-image, living/dining-furniture matrix. The executed V4 contract gate is recorded in [floorplan V4 contract evidence](evidence/floorplan-v4-contract-20261109.json).

A separate four-image candidate pool now covers one modern colored two-bedroom plan and three public-domain Oak Ridge single-floor plans. Each working image is size-bounded, SHA-256 bound and source-attributed. `2bhk-bungalow` and `oak-ridge-c` now have compilable, hash-bound development references with 9/21 and 10/15 room/object counts respectively; their wall, opening, room and object overlays were visually reviewed. The other two remain unannotated candidates. No model draft was copied into a reference and no missing bed was invented. `npm run test:full-home:references` verifies source/reference/overlay hashes and compiles both references. The pool is documented in [full-home candidates](../fixtures/full-home-candidates/README.md) and remains outside recognition prompts and acceptance scoring.

The reviewed reference batch passes Node `47`, Python `139` and typecheck. Detailed hashes and the two overlay artifacts are recorded in [full-home reference review](evidence/full-home-reference-review-20261109.json). This is still a development-reference gate, not an independent-review or real-model result.

The first zero-model V4 replay separated raw contour evidence from the model-facing object list and enforced the 300-selectable-object limit without changing V3. Later code review found that this replay was **oracle-assisted**: reference anchors, rooms and targetRoomIds entered the candidate structure, and the complete reference was passed to `contours` as `spec`. Its raw measurements are retained, but it is no longer authoritative for provider selection or recognition acceptance. The classification and original hash are recorded in [oracle-assisted evidence](evidence/full-home-v4-replay-oracle-assisted-20261109.json).

The replacement quality plane runs candidate capture and scoring in separate processes. The candidate process receives only image bytes, user scope and adapter version; it runs as `nobody`, the evaluation directory is unreadable, and a Python audit hook fails closed on any forbidden access. The artifact is written and hash-sealed before a separate scorer loads the reference. Wall coverage uses spatial union, while openings and future discrete objects use maximum-cardinality one-to-one matching so duplicate or merged candidates cannot inflate recall.

The clean zero-model baseline is still **blocked**:

- `2bhk-bungalow`: 45 wall candidates cover `0.5709` of reference wall length; 149 opening candidates match `0/15` reference openings.
- `oak-ridge-c`: 20 wall candidates cover `0.0103`; 3 opening candidates match `0/14`.
- Room regions, furniture candidates, final selection, categories and activity groups remain unmeasured because this profile does not claim those capabilities.

Both reference-access probes and audit checks passed, so the quality plane is trustworthy enough to proceed. The failure remains in the fixed candidate layer, not DeepSeek or Qwen. The next architecture batch is the V4 single-authority switch; provider comparison must wait until the new draft path and its geometry checks are in place. No live task, draft, candidate or project write was started. Evidence is in [quality batch 1](evidence/floorplan-quality-batch1-20261109.json).

## Remaining scope

S2-A provides local multi-agent editing. S2-B adds initial rectangular-room generation and the first real Skill. S2-C adds two frozen floorplan-image cases with two fully passing real runs each. Nonrectangular/multiroom text generation and cabinet/kitchen/free-form recipe conversation editing remain later; existing manual editing is retained.

S3 integrates real photo-to-model jobs and placement checks. S4 now has the versioned Skill Pool v1; GEPA candidate optimisation and the frozen development/validation/final evaluation split remain open. S5 completes AgentArts orchestration, external checkpoints, deployment and end-to-end competition evidence. None of these is established by a successful local SDK probe.
