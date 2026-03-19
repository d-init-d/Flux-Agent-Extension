# Testing Guide

Last updated: 2026-03-19

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

## OpenAI manual QA

- Manual QA for the unified OpenAI auth surface lives in `docs/task-15-manual-qa-checklist.md`.
- Treat that checklist as the current source of truth for tester steps across `Options`, `Popup`, and `Sidepanel`.
- The primary provider under test is `OpenAI`.
- Test both shipped OpenAI login methods:
  1. `ChatGPT Pro/Plus (browser)`
  2. `Manually enter API Key`

## CLIProxyAPI manual QA

- Treat `CLIProxyAPI` as the endpoint-first provider under test.
- Use one real local or hosted endpoint plus a real locally stored API key.
- Canonical local examples:
  - `http://127.0.0.1:8317`
  - `http://127.0.0.1:8317/v1`
- Canonical hosted example:
  - `https://your-domain/v1`

## CLIProxyAPI-specific checks

- Confirm `Options` blocks `http://` endpoints that are not exact loopback hosts.
- Confirm `Options` accepts loopback HTTP for CLIProxyAPI and normalizes `/v1`, `/v1/chat/completions`, and `/v1/models` to a stable base URL.
- Confirm `Popup` shows the correct readiness state for CLIProxyAPI:
  - `Endpoint required`
  - `Test connection`
  - `Ready`
- Confirm `Sidepanel` blocks send until CLIProxyAPI has both a saved endpoint and a validated locally stored API key.
- Confirm changing the CLIProxyAPI endpoint after validation marks the credential as stale and re-locks readiness until validation is rerun.
- Confirm raw CLIProxyAPI API keys never appear in regular storage snapshots, UI text, or blocked-save error states.

## OpenAI browser-account checks

- Confirm `OpenAI` shows exactly 2 login methods and that browser-account is selected through `ChatGPT Pro/Plus (browser)` rather than through `codex` first-run UX.
- Confirm the browser-account lane only becomes ready when trusted local artifacts/helper-backed state exists; do not treat vault init/unlock as a primary setup step anymore.
- Confirm browser-account status is background-owned and surfaced to UI as sanitized readiness/health data only.
- Confirm popup quick actions and sidepanel send stay blocked for `Helper missing`, `Account missing`, `Refresh required`, `Revoked`, `Session expired`, or other degraded browser-account states, plus any legacy compatibility-only lock state when you intentionally test that path.
- Confirm auth-choice-aware copy and readiness stay consistent across `Options`, `Popup`, and `Sidepanel` when switching between OpenAI login methods.

## OpenAI browser-account limitations and legacy bridge

- The browser-account lane is still helper/deep-link based and background-owned.
- This repo/build does not ship a usable helper binary on its own, so clean local builds commonly surface `helper-missing` unless trusted helper artifacts or a legacy Codex bridge state already exist.
- Runtime auth is memory-only once hydrated; this repo/build does not add headless login, scraping, or extension-owned OAuth callback handling.
- No manifest change is part of this flow. The shipped implementation still uses the existing `src/manifest.json`; see `docs/task-08-manifest-auth-wiring.md`.
- Refresh is intentionally deferred to the official client/helper flow. If a browser-account session becomes stale, expired, revoked, or refresh-required, recover through the supported account-backed path rather than an extension-owned OAuth exchange.
- Legacy bridge coverage matters: when legacy trusted Codex artifacts/state already exist, the product may surface that readiness under `OpenAI + ChatGPT Pro/Plus (browser)` without requiring users to start from the legacy Codex UX.
- Current account-backed adapter coverage is text-only; image input is not supported.
- If you specifically test a legacy compatibility path that still relies on the old vault shim, document it as legacy-only coverage rather than the primary setup route.

## Release gates

Treat a change as release-ready only when these all pass:

1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm test`
4. `pnpm build`
5. `pnpm audit --audit-level=high`

The release sign-off artifact is maintained in [RELEASE_SIGNOFF.md](/D:/OpenCode_Sanbox/Flux%20Agent%20Extension/RELEASE_SIGNOFF.md).
