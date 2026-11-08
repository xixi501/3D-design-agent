# S0 / S1 / S2-A / S2-B / S2-C implementation status

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

V3 bounded recognition is implemented: fixed analysis builds a candidate skeleton, separate structure and furniture passes submit typed results, and deterministic code merges only evidenced walls, openings, rooms and target furniture. Controlled V1/V2/V3 browsers pass. The fixed real single-image batch at `c72d4e9` is still 0/2: one mixed wall-candidate orientation and one out-of-wall opening; both failed closed before draft creation. Complete S2 remains pending. See [V3 flow alignment](S2C_FLOW_ALIGNMENT.md).

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

The orthogonal image draft compiler, durable image storage, overlay correction and explicit confirmation workflow are implemented. Four-role reconstruction retains confirmed positions and per-symbol sizes; catalogue decisions are separate from recognition. Controlled browser/WebGL, transaction and restart tests pass. The two real user floorplans and their quality matrix remain pending, so complete S2 is not accepted. See [S2-C status](S2C_STATUS.md) and [runbook](S2C_RUNBOOK.md).

## Remaining scope

S2-A provides local multi-agent editing. S2-B adds initial rectangular-room generation and the first real Skill. Complete S2 still needs two clear floorplan-image cases and full integration acceptance. Nonrectangular/multiroom text generation and cabinet/kitchen/free-form recipe conversation editing remain later; existing manual editing is retained.

S3 integrates real photo-to-model jobs and placement checks; S4 adds versioned Skills and GEPA with the frozen evaluation split; S5 completes AgentArts orchestration, external checkpoints, deployment and end-to-end competition evidence. None of these is established by a successful local SDK probe.
