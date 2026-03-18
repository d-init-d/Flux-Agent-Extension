# Testing Guide

Last updated: 2026-03-18

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

## Codex manual QA

- Manual QA for the account-backed Codex provider lives in `docs/task-15-manual-qa-checklist.md`.
- Treat that checklist as the current source of truth for tester steps across `Options`, `Popup`, and `Sidepanel`.
- The provider under test is `ChatGPT Plus / Codex (Experimental)`.
- Test with a real official auth artifact exported from an eligible ChatGPT/Codex account; this is not the normal API-key path used by other providers.

## CLIProxyAPI manual QA

- Treat `CLIProxyAPI` as the endpoint-first provider under test.
- Use one real local or hosted endpoint plus a real vault-backed API key.
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
- Confirm `Sidepanel` blocks send until CLIProxyAPI has both a saved endpoint and a validated vault-backed API key.
- Confirm changing the CLIProxyAPI endpoint after validation marks the credential as stale and re-locks readiness until validation is rerun.
- Confirm raw CLIProxyAPI API keys never appear in regular storage snapshots, UI text, or blocked-save error states.

## Codex-specific checks

- Confirm the vault is initialized and unlocked before validation or live prompt tests.
- Confirm artifact import clears the raw payload from the form immediately after submission.
- Confirm validation runs against the account-backed flow and not an API-key flow.
- Confirm popup quick actions and sidepanel send stay blocked for `Vault locked`, `Account missing`, `Refresh required`, `Revoked`, `Session expired`, or other degraded account states.
- Confirm account switching, revoke, remove, and re-import flows update all three surfaces consistently.

## Current Codex limitations and recovery

- Codex is still `experimental`.
- Runtime auth is hydrated from an imported official artifact and cached in background memory; it is not refreshed through an extension-owned OAuth or API-key exchange.
- No manifest change is part of the current flow. The shipped implementation still uses the existing `src/manifest.json`; see `docs/task-08-manifest-auth-wiring.md`.
- Refresh is intentionally deferred to the official client flow. If a session becomes stale, expired, revoked, or refresh-required, recover by importing a fresh official artifact and validating again.
- Validation can succeed for artifact shape while still surfacing `refresh-required` when a fresh Codex-managed login is needed.
- Current adapter coverage is text-only prompts for Codex; image input is not supported.

## Release gates

Treat a change as release-ready only when these all pass:

1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm test`
4. `pnpm build`
5. `pnpm audit --audit-level=high`

The release sign-off artifact is maintained in [RELEASE_SIGNOFF.md](/D:/OpenCode_Sanbox/Flux%20Agent%20Extension/RELEASE_SIGNOFF.md).
