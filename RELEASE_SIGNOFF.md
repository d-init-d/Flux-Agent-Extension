# Release Sign-Off

Last updated: 2026-03-13

## Release

- Version: `v0.1.0`
- Scope: ship-ready hardening pass, credential vault/runtime alignment, popup quick actions live control surface, action-surface parity, and Phase 5 release artifacts

## Verification results

- `pnpm lint`: PASS
- `pnpm typecheck`: PASS
- `pnpm exec vitest run src/test/e2e/p-02e-scenario-matrix.test.tsx`: PASS (`24/24`)
- `pnpm test`: PASS
- `pnpm build`: PASS
- `pnpm package:release`: PASS
- `pnpm audit --audit-level=high`: PASS (`No known vulnerabilities found`)

## Release evidence

- Deterministic E2E scenario count is now `50` in [E2E_SCENARIO_MATRIX.md](/D:/OpenCode_Sanbox/Flux%20Agent%20Extension/E2E_SCENARIO_MATRIX.md)
- Release artifact generated at `releases/flux-agent-extension-v0.1.0.zip`
- Current build metrics are recorded in [PERFORMANCE_BASELINE.md](/D:/OpenCode_Sanbox/Flux%20Agent%20Extension/PERFORMANCE_BASELINE.md)
- CWS review-response prep is recorded in [CWS_REVIEW_RESPONSE.md](/D:/OpenCode_Sanbox/Flux%20Agent%20Extension/CWS_REVIEW_RESPONSE.md)
- Post-launch monitoring setup is recorded in [POST_LAUNCH_MONITORING.md](/D:/OpenCode_Sanbox/Flux%20Agent%20Extension/POST_LAUNCH_MONITORING.md)

## Sign-off status

- Repo quality gates: PASS
- Security baseline: PASS
- Docs/store/release artifacts: repo-ready
- External dependencies still required for full public launch:
  - real beta testers and issue intake (`P-06`)
  - Chrome Web Store submission and reviewer interaction (`P-08c`)
  - final human memory profiling for full `P-01` closure

## Decision

Repo-side release sign-off is approved. External launch operations remain separate follow-up work.
