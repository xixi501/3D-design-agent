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

Latest single-image engineering update `71226cf`: structured measurement diagnostics, persistent evidence reuse and recognition-preservation checks pass Node 28 / Python 47, full original regression and controlled browser tests. Two real fixed-image runs remain 0/2; no formal writes. See [single-image report](S2C_SINGLE_IMAGE.md). The second image and complete S2 matrix did not start under the agreed stop condition.

The orthogonal image draft compiler, durable image storage, overlay correction and explicit confirmation workflow are implemented. Four-role reconstruction retains confirmed positions and per-symbol sizes; catalogue decisions are separate from recognition. Controlled browser/WebGL, transaction and restart tests pass. The two real user floorplans and their quality matrix remain pending, so complete S2 is not accepted. See [S2-C status](S2C_STATUS.md) and [runbook](S2C_RUNBOOK.md).

## Remaining scope

S2-A provides local multi-agent editing. S2-B adds initial rectangular-room generation and the first real Skill. Complete S2 still needs two clear floorplan-image cases and full integration acceptance. Nonrectangular/multiroom text generation and cabinet/kitchen/free-form recipe conversation editing remain later; existing manual editing is retained.

S3 integrates real photo-to-model jobs and placement checks; S4 adds versioned Skills and GEPA with the frozen evaluation split; S5 completes AgentArts orchestration, external checkpoints, deployment and end-to-end competition evidence. None of these is established by a successful local SDK probe.
