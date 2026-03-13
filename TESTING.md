# Testing Guide

Last updated: 2026-03-13

This file is the current testing source of truth for the repo.

## Core commands

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm audit --audit-level=high`

## Suite layout

### Unit and integration coverage

- Core runtime, content, bridge, storage, provider, and UI coverage lives under `src/**/__tests__`.
- Chrome APIs are mocked through the shared test setup and `src/test/mocks/chrome.ts`.

### Deterministic E2E coverage

Executable E2E-style suites live in [src/test/e2e](/D:/OpenCode_Sanbox/Flux%20Agent%20Extension/src/test/e2e):

- [full-pipeline.test.tsx](/D:/OpenCode_Sanbox/Flux%20Agent%20Extension/src/test/e2e/full-pipeline.test.tsx)
- [p-02a-real-sites.test.tsx](/D:/OpenCode_Sanbox/Flux%20Agent%20Extension/src/test/e2e/p-02a-real-sites.test.tsx)
- [p-02b-spa-sites.test.tsx](/D:/OpenCode_Sanbox/Flux%20Agent%20Extension/src/test/e2e/p-02b-spa-sites.test.tsx)
- [p-02c-edge-cases.test.tsx](/D:/OpenCode_Sanbox/Flux%20Agent%20Extension/src/test/e2e/p-02c-edge-cases.test.tsx)
- [p-02d-error-recovery.test.tsx](/D:/OpenCode_Sanbox/Flux%20Agent%20Extension/src/test/e2e/p-02d-error-recovery.test.tsx)
- [p-02e-scenario-matrix.test.tsx](/D:/OpenCode_Sanbox/Flux%20Agent%20Extension/src/test/e2e/p-02e-scenario-matrix.test.tsx)

The detailed `50`-scenario accounting lives in [E2E_SCENARIO_MATRIX.md](/D:/OpenCode_Sanbox/Flux%20Agent%20Extension/E2E_SCENARIO_MATRIX.md).

## What the E2E suites cover

- Side-panel prompt execution from user input to action log updates
- Popup/side-panel session handoff paths
- Recording, playback, replay stop/resume, and export behavior
- Real-site-style, SPA-style, edge-case, and error-recovery planning flows
- Deterministic scenario matrix coverage for common workflow shapes used in Phase 5 hardening

## Release gates

Treat a change as release-ready only when these all pass:

1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm test`
4. `pnpm build`
5. `pnpm audit --audit-level=high`

The release sign-off artifact is maintained in [RELEASE_SIGNOFF.md](/D:/OpenCode_Sanbox/Flux%20Agent%20Extension/RELEASE_SIGNOFF.md).
