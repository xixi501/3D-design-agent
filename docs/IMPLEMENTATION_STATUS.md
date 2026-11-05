# S0 / S1 implementation status

Approved scope: single-floor editor; complete upstream parametric catalogue, cabinets and 17 free-form types; persistent projects/assets and undo/redo; real scene APIs. Natural-language agents, photo generation and AgentArts deployment are subsequent stages.

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

Accepted implementation and test commit: `2749ff0adf4f3e6d97e5c8c17faf901e0e8d3ece`.

Executed evidence: 10 core/service groups; 14 original baseline checks; 16 real-browser workflows; 24 modelling recipe comparisons; all 266 catalogue bodies match mesh/vertex counts and measured dimensions within 0.01 mm. Fixed-view captures use asserted camera parameters. See [acceptance](ACCEPTANCE.md) for differences, original limitations and scope boundaries.

S2–S5 remain subsequent work: conversation and four-agent orchestration, photo generation integration, Skill/GEPA evaluation and complete AgentArts deployment.
