# Stage 2 repair acceptance — 2026-11-11

Manual real-Agent acceptance against the latest local service and DeepSeek agent.

- Base commit: `061a864`
- Branch: `stage-2/repair-quality`
- Agent model: `deepseek-flash` (real DeepSeek service)
- Cases: `openable`, `wall`, `circulation`
- Repeats: 2 per case
- Result: **6/6 passed**
- Each case: target error cleared, only authorized furniture changed, structure unchanged, no added/deleted furniture, `remainingIssues=0`
- Reports: `report.json` and per-case JSON in this directory

This is a manual acceptance run, not a CI job. CI only runs deterministic repair fixtures and UI/structural checks.
