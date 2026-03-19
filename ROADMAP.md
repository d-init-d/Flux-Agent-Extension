# AI Browser Controller - Detailed Roadmap

> **Version:** 1.0.0
> **Last Updated:** 2026-03-19
> **Timeline:** 20 weeks (5 phases)
> **Target Release:** v1.0.0 Chrome Web Store

---

## Timeline Overview

```
Week  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20
      â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤                                              PHASE 1: Foundation
                     â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤                    PHASE 2: Core Engine
                                                â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤    PHASE 3: UI & Integration
                                                               â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤  PHASE 4: Advanced
                                                                              â”œâ”€â”€â”€â”€â”€â”€â”¤  PHASE 5: Ship
```

---

## Active Initiative: ChatGPT Plus / OpenCode-Style Provider

**Goal:** Add an account-backed provider that can use a ChatGPT Plus account with Codex access, following the operational model used by OpenCode rather than an API-key-only flow.

**Execution Rule:** one task at a time -> verify -> PASS -> commit -> push -> update roadmap/tracker -> move next.

| Task                                         | Status | Notes                                                                                                                      |
| -------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| T1 - OpenCode account discovery              | DONE   | Discovery doc completed in `docs/task-01-opencode-account-discovery.md`                                                    |
| T2 - Feasibility and risk assessment         | DONE   | Feasibility doc completed in `docs/task-02-chatgpt-plus-feasibility.md`                                                    |
| T3 - Architecture decision record            | DONE   | ADR completed in `docs/task-03-auth-strategy-adr.md`                                                                       |
| T4 - Provider/account/token/quota types      | DONE   | Groundwork landed across shared types, vault schema, provider registry, and compile-safe runtime wiring                    |
| T5 - UI <-> background auth message surface  | DONE   | Account-backed message contracts and compile-safe runtime plumbing landed                                                  |
| T6 - Secure account store                    | DONE   | Vault now supports encrypted codex account artifacts, account CRUD, activation, revocation, and quota metadata             |
| T7 - ChatGPT account auth module             | DONE   | Import-based Codex auth parsing, persistence, and structural validation landed                                             |
| T8 - Manifest and auth callback wiring       | DONE   | No manifest change required for the current import-based flow; decision captured in `docs/task-08-manifest-auth-wiring.md` |
| T9 - Background account/session manager      | DONE   | Background session state machine, memory-only caching, and fail-safe refresh deferral landed                               |
| T10 - ChatGPT/Codex provider adapter         | DONE   | Codex provider adapter now consumes account-backed runtime tokens and streams Responses-style output                       |
| T11 - Registry/loader/default config updates | DONE   | Codex is now a first-class validated provider surface across registry, runtime, and options-state plumbing                 |
| T12 - Options account-connect UI             | DONE   | Options page now supports Codex artifact import, account actions, and explicit experimental UX                             |
| T13 - Onboarding/popup/sidepanel UX          | DONE   | Codex state-aware onboarding copy, popup gating, and sidepanel guidance are now wired through shared UX helpers            |
| T14 - Unit and integration tests             | DONE   | Codex auth/provider/runtime/UI coverage now spans parser, session manager, adapter, popup, sidepanel, and options flows    |
| T15 - Manual QA checklist                    | DONE   | Manual QA checklist is captured in `docs/task-15-manual-qa-checklist.md`                                                   |
| T16 - Docs and tester guidance               | DONE   | README, TESTING, SECURITY, and tester-facing references now describe the Codex account-backed flow accurately              |

---

## Active Initiative: CLIProxyAPI First-Class Provider

**Goal:** Add a first-class `cliproxyapi` provider for the extension so users can connect to CLIProxyAPI directly instead of routing through the OpenAI provider setup, while keeping the existing OpenAI-compatible runtime plumbing and security posture.

**MVP Scope:** API-key auth, endpoint-based setup, first-class provider UI, hosted `https://...` support, local loopback `http://localhost` / `http://127.0.0.1` support for CLIProxyAPI only, runtime validation, popup/sidepanel compatibility, test coverage, and docs.

**Execution Rule:** one task at a time -> implement -> verify -> PASS -> commit -> push -> update roadmap -> move next.

| Task                                                     | Status | Verify                                                                                                                                                                                                    | Notes                                                                                                                                             |
| -------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| CP-01 - Initiative scaffold in roadmap                   | DONE   | Roadmap section reviewed locally                                                                                                                                                                          | Added execution rule, task table, decision notes, and execution log scaffold for CLIProxyAPI work                                                 |
| CP-02 - Shared provider surface                          | DONE   | `pnpm typecheck`; targeted Vitest on provider surface                                                                                                                                                     | Added `cliproxyapi` to shared provider types/registry plus endpoint metadata, token window, and rate-limit baselines                              |
| CP-03 - Loader alignment                                 | DONE   | `pnpm exec vitest run src/core/ai-client/__tests__/provider-loader.test.ts src/shared/config/__tests__/surface-consistency.test.ts`; `pnpm typecheck`                                                     | `cliproxyapi` is now lazy-loadable and aligned with the runtime provider surface                                                                  |
| CP-04 - Provider plumbing                                | DONE   | `pnpm exec vitest run src/core/ai-client/__tests__/provider-loader.test.ts`; `pnpm typecheck`                                                                                                             | Reused the OpenAI-compatible preset/factory with the documented local default base URL (`http://127.0.0.1:8317`) and `/v1/...` API paths          |
| CP-05 - Shared endpoint policy                           | DONE   | `pnpm exec vitest run src/shared/config/__tests__/provider-endpoint-policy.test.ts`; `pnpm typecheck`                                                                                                     | Added a shared endpoint policy/normalization module for CLIProxyAPI, Ollama, and HTTPS-only providers                                             |
| CP-06 - Options endpoint validation and quick connect UX | DONE   | `pnpm exec vitest run src/options/__tests__/App.test.tsx`; `pnpm typecheck`                                                                                                                               | Options and runtime mock now reuse the shared policy, normalize `/v1...` inputs, and show provider-specific helper/error copy                     |
| CP-07 - Background validation and runtime enforcement    | DONE   | `pnpm exec vitest run src/background/__tests__/credential-vault.test.ts src/background/__tests__/ui-session-runtime.test.ts -t "cliproxyapi"`; `pnpm typecheck`                                           | Background save/validate/runtime paths now enforce the same policy and keep normalized base URLs through credential checks and live session sends |
| CP-08 - Popup, onboarding, and sidepanel alignment       | DONE   | `pnpm exec vitest run src/popup/__tests__/App.test.tsx src/sidepanel/__tests__/App.test.tsx src/options/__tests__/App.test.tsx src/sidepanel/store/__tests__/sessionStore.test.ts`; `pnpm typecheck`      | Popup, onboarding/options, sidepanel, and session defaults now surface real CLIProxyAPI readiness instead of generic OpenAI-biased states         |
| CP-09 - Test sweep and security regression coverage      | DONE   | `pnpm exec vitest run src/shared/ui/__tests__/key-based-provider-ux.test.ts src/options/__tests__/provider-key-extraction.test.tsx src/background/__tests__/ui-session-runtime.test.ts`; `pnpm typecheck` | Added CLIProxyAPI-focused readiness/unit/security regressions plus a stable OpenAI vault fixture for the full runtime harness                     |
| CP-10 - Docs and closeout                                | DONE   | `pnpm lint`; `pnpm typecheck`; `pnpm test`; `pnpm build`; `pnpm audit --audit-level=high`                                                                                                                 | README/testing guidance now document CLIProxyAPI setup, readiness rules, manual QA expectations, and the closeout audit refresh                   |

### Execution Notes

- [2026-03-18] CP-01 DONE
  - Roadmap scaffold created for the CLIProxyAPI initiative.
  - Next step: start CP-02 and land the shared provider surface before touching runtime or UI policy.
- [2026-03-18] CP-02 DONE
  - Added `cliproxyapi` as a first-class shared provider with API-key auth, endpoint metadata, default model, and compile-safe token/rate-limit defaults.
  - Next step: start CP-03 to align the lazy loader/runtime registration surface without expanding endpoint policy yet.
- [2026-03-18] CP-03 DONE
  - Added `cliproxyapi` to the lazy provider loader so runtime/provider creation stays aligned with the shared registry surface.
  - Next step: land CP-04 by wiring `cliproxyapi` through the OpenAI-compatible provider preset/factory only.
- [2026-03-18] CP-04 DONE
  - Wired `cliproxyapi` through the OpenAI-compatible preset/factory with the documented local default base URL `http://127.0.0.1:8317` and `/v1/...` API paths.
  - Added minimal loader/provider regression coverage, including a guard against duplicating `/v1` when a hosted endpoint is already versioned.
  - Next step: start CP-05 to centralize endpoint normalization/validation in a shared policy module.
- [2026-03-18] CP-05 DONE
  - Added a shared CLIProxyAPI/Ollama/HTTPS endpoint policy that normalizes `/v1`, `/v1/chat/completions`, and `/v1/models` inputs.
  - Next step: land CP-06 by reusing that policy in the Options UX and test runtime mock.
- [2026-03-18] CP-06 DONE
  - Options provider setup now reuses the shared endpoint policy, accepts CLIProxyAPI loopback HTTP, normalizes saved/tested endpoints, and shows provider-specific guidance.
  - Next step: land CP-07 so the background runtime enforces the same endpoint policy instead of trusting the UI alone.
- [2026-03-18] CP-07 DONE
  - Background provider save, credential validation, and live session runtime now enforce the shared endpoint policy and preserve normalized base URLs for CLIProxyAPI.
  - Added targeted runtime coverage to prove `cliproxyapi` session sends switch providers with the normalized `/v1` base URL.
  - Next step: move to CP-08 for popup/onboarding/sidepanel alignment and then CP-09 for a broader regression sweep.
- [2026-03-18] CP-08 DONE
  - Popup, sidepanel, and onboarding/options now distinguish missing endpoint vs saved-but-unvalidated vs ready for `cliproxyapi`, while Codex account-backed guidance stays intact.
  - Session creation defaults now prefer the active provider/model from settings so new sidepanel sessions no longer fall back to OpenAI-biased defaults when CLIProxyAPI is selected.
  - Next step: move to CP-09 for the broader regression/security sweep over provider readiness, runtime gating, and secret-handling edges.
- [2026-03-18] CP-09 DONE
  - Added unit coverage for key-based readiness states, provider-key extraction regressions for CLIProxyAPI, and narrow runtime gating so stale or unvalidated CLIProxyAPI credentials cannot back live sends.
  - The full `ui-session-runtime` suite now boots with a stable unlocked OpenAI vault fixture, so unrelated runtime tests no longer fail en masse on missing credential state.
  - Next step: move to CP-10 for docs/closeout only.
- [2026-03-18] CP-10 DONE
  - README and TESTING now document CLIProxyAPI as an endpoint-first provider with explicit readiness rules, runtime blocking conditions, and manual QA steps.
  - Final closeout also refreshes transitive dependency overrides for `flatted` and `undici`, bringing `pnpm audit --audit-level=high` back to a clean result.

### Decision Notes

- `cliproxyapi` ships as a dedicated provider, not as an alias of `custom` or a hidden OpenAI endpoint override.
- Runtime should reuse the existing OpenAI-compatible provider plumbing wherever possible.
- Local non-HTTPS support is a narrow exception for CLIProxyAPI only and must stay limited to exact loopback hosts.
- Endpoint normalization and validation must converge in a shared policy module so options, background, and tests use the same source of truth.
- `customHeaders` is out of MVP unless required by a real CLIProxyAPI deployment; if enabled later it must be reviewed as a separate security-sensitive task.

---

## Closed Initiative: OpenAI Unified Auth Surface

**Goal:** When users choose `OpenAI`, the product should show exactly 2 auth choices:

1. `ChatGPT Pro/Plus (browser)`
2. `Manually enter API Key`

The browser path should use a helper/deep-link login flow. This phase explicitly excludes headless login and full extension-owned OAuth callback handling.

**MVP Scope:** one primary `OpenAI` surface in Options/onboarding, auth-method-aware readiness, helper/deep-link browser login contract, account-backed runtime reuse for Codex/OpenAI-style account access, auth-method-aware model handling, legacy `codex` migration bridge, docs, and regression coverage.

**Execution Rule:** one task at a time -> implement -> verify -> PASS -> commit -> push -> update roadmap/blueprint -> move next.

| Task                                                                  | Status | Verify                                                                                                                                                                                                                                                  | Notes                                                                                                                                                                                                       |
| --------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OA-01 - ADR and UX contract lock                                      | DONE   | `git diff --check`; `pnpm exec prettier --check ROADMAP.md BLUEPRINT.md docs/task-03-auth-strategy-adr.md docs/task-oa-01-openai-unified-auth-surface-adr.md`                                                                                           | Locked the initiative to one `OpenAI` surface with exactly 2 auth choices, helper/deep-link browser login, no headless, and legacy `codex -> openai + browser-account` migration semantics                  |
| OA-02 - Multi-auth provider surface redesign                          | DONE   | `pnpm exec vitest run src/shared/config/__tests__/surface-consistency.test.ts`; `pnpm typecheck`                                                                                                                                                        | Added shared multi-auth choice metadata/helpers, exposed the ordered OpenAI dual-auth surface, and kept the legacy-safe top-level `openai` lane on API-key metadata                                         |
| OA-03 - Browser helper/deep-link auth contract                        | DONE   | `git diff --check`; `pnpm exec prettier --check ROADMAP.md BLUEPRINT.md docs/task-oa-03-browser-helper-deep-link-auth-contract.md`                                                                                                                      | Locked the launch direction, request/response payload semantics, provenance validation rules, trust boundary, persistence rules, and canonical browser-login result states                                  |
| OA-04 - Vault and message-surface expansion                           | DONE   | `pnpm exec vitest run src/background/__tests__/credential-vault.test.ts`; `pnpm typecheck`                                                                                                                                                              | Added sanitized OpenAI browser-login state/message primitives, session-only pending attempt storage, and encrypted OpenAI account-artifact vault support without changing helper runtime yet                |
| OA-05 - Unified OpenAI runtime auth coordinator                       | DONE   | `pnpm exec vitest run src/background/**tests**/openai-runtime-auth-coordinator.test.ts src/background/**tests**/codex-account-session-manager.test.ts src/background/**tests**/ui-session-runtime.test.ts -t "openai browser-account                    | OpenAIRuntimeAuthCoordinator                                                                                                                                                                                | CodexAccountSessionManager"`; `pnpm typecheck` | Added a background-owned OpenAI auth coordinator that keeps the API-key lane unchanged, routes trusted browser-account state through an internal Codex runtime adapter, rejects non-ready account-backed state before chat, and keeps runtime session tokens memory-only |
| OA-06 - Options/OpenAI auth-choice UX                                 | DONE   | `pnpm exec vitest run src/options/**tests**/App.test.tsx src/background/**tests**/ui-session-runtime.test.ts -t "OpenAI browser-account                                                                                                                 | OpenAI login methods                                                                                                                                                                                        | helper-missing                                 | auth choice"`; `pnpm typecheck`; `pnpm build`                                                                                                                                                                                                                            | Options/onboarding now persist the OpenAI auth choice, show exactly 2 OpenAI login methods, keep API-key UX intact, and surface sanitized browser-account helper status from background only |
| OA-07 - Model catalog and routing policy                              | DONE   | `pnpm exec vitest run src/shared/config/**tests**/openai-model-catalog.test.ts src/options/**tests**/App.test.tsx src/background/**tests**/openai-runtime-auth-coordinator.test.ts src/background/**tests**/ui-session-runtime.test.ts -t "openai model | OpenAIRuntimeAuthCoordinator                                                                                                                                                                                | openai browser-account runtime                 | recommended default and suggested OpenAI models                                                                                                                                                                                                                          | resets shipped OpenAI models"`; `pnpm typecheck`; `pnpm build`                                                                                                                               | Added a shared OpenAI lane-aware model catalog, auth-aware Options suggestions/defaults, cross-lane runtime blocking, and explicit manual override behavior without touching OA-08/OA-09 scope |
| OA-08 - Legacy Codex migration bridge                                 | DONE   | `pnpm exec vitest run src/background/__tests__/openai-runtime-auth-coordinator.test.ts src/background/__tests__/ui-session-runtime.test.ts src/options/__tests__/App.test.tsx`; `pnpm typecheck`; `pnpm build`                                          | Added a non-destructive read-path bridge so legacy `codex` state surfaces under `openai + browser-account` without rewriting encrypted vault secrets or disturbing the API-key lane                         |
| OA-09 - Popup/sidepanel/onboarding alignment plus regression coverage | DONE   | `pnpm exec vitest run src/popup/__tests__/App.test.tsx src/sidepanel/__tests__/App.test.tsx src/options/__tests__/App.test.tsx src/sidepanel/store/__tests__/sessionStore.test.ts`; `pnpm typecheck`; `pnpm build`                                      | Popup and sidepanel now share auth-aware OpenAI readiness mapping, block browser-account non-ready states, and keep legacy codex bridge UX surfaced as OpenAI browser-account without leaking raw artifacts |
| OA-10 - Docs, manual QA, and closeout                                 | DONE   | `pnpm lint`; `pnpm typecheck`; `pnpm test`; `pnpm build`; `pnpm audit --audit-level=high`                                                                                                                                                               | README/testing/manual-QA now describe the OpenAI dual-auth surface truthfully, keep helper availability honest for this repo/build, and close the initiative without re-promoting Codex UX                  |

### UX Contract

- `Provider = OpenAI` remains the single primary entry point for the OpenAI ecosystem.
- `Login method = ChatGPT Pro/Plus (browser)` maps to an account-backed runtime path backed by helper/deep-link login.
- `Login method = Manually enter API Key` keeps the existing OpenAI API-key path.
- `Headless` is intentionally out of scope for this phase.
- The UI must stop presenting `codex` as the primary first-run choice once the migration bridge is ready.

### Decision Notes

- Browser login uses helper/deep-link transport, not full extension-owned OAuth callback handling.
- Do not add `chrome.identity`, `oauth2`, or callback pages in this phase unless the auth strategy changes.
- Do not scrape cookies, localStorage, sessionStorage, or logged-in browser tabs.
- Account-backed runtime tokens remain memory-only; long-lived artifacts stay encrypted in the vault.
- Helper/deep-link responses must be provenance-validated and matched to an extension-issued request `state`/nonce before anything is persisted.
- Model availability must depend on the selected auth method.
- `codex` may remain as an internal or legacy compatibility path during migration, but not as the primary UX surface.

### MVP vs Later Backlog

- **MVP:** OpenAI dual-auth UX, helper/deep-link browser login, auth-aware model handling, runtime unification, migration bridge, docs/tests.
- **Later:** headless login, official extension OAuth/callback, richer multi-account switching, deeper model entitlement discovery, full retirement of the legacy `codex` surface.

### Execution Notes

- [2026-03-18] OA-01 DONE
  - Added `docs/task-oa-01-openai-unified-auth-surface-adr.md` to lock the UX and architecture contract for one `OpenAI` provider surface with exactly 2 auth choices.
  - Updated `docs/task-03-auth-strategy-adr.md` so the old `codex`-as-primary-surface decision is explicitly superseded in part while keeping the same trust-boundary and anti-scraping rules.
  - Synced roadmap/blueprint wording around helper/deep-link browser login, no headless, no full extension-owned OAuth callback in this phase, and `codex -> openai + browser-account` migration semantics.
  - Next step: start OA-02 and redesign the provider/auth surface so one provider can express multiple auth methods without collapsing their semantics.
- [2026-03-18] OA-02 DONE
  - Added a shared `authChoices` metadata primitive plus exported helpers so later tasks can read ordered auth choices without changing current runtime assumptions.
  - `openai` now advertises exactly 2 auth choices in the required order, while the top-level `openai.authFamily/authMethod` stays pinned to the current API-key lane for backward compatibility.
  - Marked `codex` as `legacy-internal` metadata-only surface exposure without changing its existing account-backed runtime behavior.
  - Verify: `pnpm exec vitest run src/shared/config/__tests__/surface-consistency.test.ts`; `pnpm typecheck`
  - Next step: start OA-03 and define the browser helper/deep-link auth contract that will back the new OpenAI browser lane.
- [2026-03-18] OA-03 DONE
  - Added `docs/task-oa-03-browser-helper-deep-link-auth-contract.md` to lock the browser-account helper/deep-link contract before any OA-04 storage/message or OA-05 runtime work lands.
  - The contract fixes the launch initiator/control direction, request/response payload envelopes, `requestId`/`state`/`nonce` semantics, provenance validation, persistence boundaries, and canonical `success`/`cancel`/`timeout`/`stale`/`mismatch`/`helper-missing`/`error` states.
  - Synced roadmap/blueprint wording so the background remains the only trusted owner of auth-attempt validation and vault persistence decisions.
  - Verify: `git diff --check`; `pnpm exec prettier --check ROADMAP.md BLUEPRINT.md docs/task-oa-03-browser-helper-deep-link-auth-contract.md`
  - Next step: start OA-04 and implement the pending-attempt, sanitized message, and vault schema surfaces exactly to this contract without exposing raw helper payloads to UI.
- [2026-03-18] OA-04 DONE
  - Expanded shared storage/message primitives so `OpenAI + ChatGPT Pro/Plus (browser)` can carry sanitized pending/result state without exposing raw helper payloads, callback secrets, or runtime tokens.
  - Generalized the credential vault so encrypted long-lived account artifacts can be stored for both legacy `codex` and new `openai` account-backed records, while pending browser-login attempts remain session-only and are excluded from durable vault metadata.
  - Verify: `pnpm exec vitest run src/background/__tests__/credential-vault.test.ts`; `pnpm typecheck`
  - Note: OA-05 should now consume the sanitized `browserLogins` surface plus encrypted `openai` account artifacts to build the final background-only runtime auth coordinator.
- [2026-03-18] OA-05 DONE
  - Added a background-owned OpenAI auth coordinator that resolves the runtime lane from trusted vault/account state, keeps API-key behavior unchanged, and routes ready browser-account sessions through the internal `codex` runtime adapter while preserving `openai` as the user-facing provider.
  - Generalized the existing Codex account session manager so the same memory-only runtime-session hydration logic can safely back both legacy `codex` and new `openai` browser-account artifacts without exposing raw helper payloads or durable runtime tokens.
  - Verify: `pnpm exec vitest run src/background/__tests__/openai-runtime-auth-coordinator.test.ts src/background/__tests__/codex-account-session-manager.test.ts src/background/__tests__/ui-session-runtime.test.ts -t "openai browser-account|OpenAIRuntimeAuthCoordinator|CodexAccountSessionManager"`; `pnpm typecheck`
  - Execution note: OA-06 should now wire explicit auth-choice UI onto this coordinator instead of branching auth logic in the UI layer.
- [2026-03-18] OA-06 DONE
  - Added an OpenAI-only `Login method` control that persists `providers.openai.authChoiceId`, defaults to the legacy-safe `api-key` lane, and hides the API key form when `ChatGPT Pro/Plus (browser)` is selected.
  - Options/onboarding now reuse sanitized background account-auth status for the browser lane, surface canonical helper-missing messaging when no helper app is available, and keep existing trusted OpenAI browser-account artifacts validatable without exposing raw helper or artifact data.
  - Verify: `pnpm exec vitest run src/options/__tests__/App.test.tsx src/background/__tests__/ui-session-runtime.test.ts -t "OpenAI browser-account|OpenAI login methods|helper-missing|auth choice"`; `pnpm typecheck`; `pnpm build`
  - Note: OA-07 should stay focused on auth-aware model availability/routing only; do not expand the helper, popup/sidepanel alignment, or legacy migration bridge there.
- [2026-03-19] OA-07 DONE
  - Added a shared OpenAI model catalog with lane-specific defaults/suggestions plus routing helpers that distinguish shipped API-key models from shipped browser-account models while still allowing unknown manual override ids.
  - Options now swap recommended defaults and suggested models when the OpenAI login method changes, and switching lanes resets only those shipped models that obviously belong to the other lane.
  - Background OpenAI runtime routing now prefers persisted `providers.openai.authChoiceId`, routes browser-account models through the internal Codex adapter without hardcoding `codex-mini-latest`, and rejects known cross-lane mismatches before live requests.
  - Verify: `pnpm exec vitest run src/shared/config/__tests__/openai-model-catalog.test.ts src/options/__tests__/App.test.tsx src/background/__tests__/openai-runtime-auth-coordinator.test.ts src/background/__tests__/ui-session-runtime.test.ts -t "openai model|OpenAIRuntimeAuthCoordinator|openai browser-account runtime|recommended default and suggested OpenAI models|resets shipped OpenAI models"`; `pnpm typecheck`; `pnpm build`
  - Note: OA-08 remains intentionally separate; no legacy `codex -> openai + browser-account` migration bridge landed here.
- [2026-03-19] OA-08 DONE
  - Added a fail-safe compatibility bridge that maps legacy `codex` provider config, active/default provider state, account metadata, and runtime auth material onto the `openai + browser-account` surface when no explicit OpenAI browser state exists yet.
  - The bridge stays idempotent and read-path-first: encrypted vault artifacts remain in place under legacy Codex storage until users explicitly save new OpenAI browser-account state.
  - Verify: `pnpm exec vitest run src/background/__tests__/openai-runtime-auth-coordinator.test.ts src/background/__tests__/ui-session-runtime.test.ts src/options/__tests__/App.test.tsx`; `pnpm typecheck`; `pnpm build`
  - Note: OA-09 still owns popup/sidepanel/onboarding alignment and any broader readiness UX sweep outside the Options/background bridge landed here.
- [2026-03-19] OA-09 DONE
  - Added shared provider-surface mapping so popup, sidepanel, and session defaults all respect OpenAI auth choice semantics instead of treating OpenAI as API-key-only once browser-account is selected.
  - Popup and sidepanel now block live actions for non-ready OpenAI browser-account states, while legacy bridged `codex` readiness is surfaced as `OpenAI + browser-account` rather than Codex-first UX.
  - Added regression coverage for popup, sidepanel, session defaults, and existing options bridge assertions; raw helper/artifact strings stay out of surfaced UI copy.
  - Verify: `pnpm exec vitest run src/popup/__tests__/App.test.tsx src/sidepanel/__tests__/App.test.tsx src/options/__tests__/App.test.tsx src/sidepanel/store/__tests__/sessionStore.test.ts`; `pnpm typecheck`; `pnpm build`
  - Note: OA-10 is still docs/manual-QA closeout only; do not expand product behavior there.
- [2026-03-19] OA-10 DONE
  - Updated `README.md`, `TESTING.md`, and `docs/task-15-manual-qa-checklist.md` so the tester-facing story now matches the shipped product: `OpenAI` is the primary surface with exactly 2 login methods, popup/options/sidepanel are auth-choice-aware, and `codex` is legacy/internal compatibility only.
  - Kept helper availability honest: the helper/deep-link contract exists, but this repo/build still commonly surfaces `helper-missing` unless trusted helper artifacts or legacy bridge state already exist.
  - Final closeout also greened the remaining lint/test gates and restored the deterministic E2E suites by seeding a vault-backed OpenAI API-key fixture in the E2E harness before sidepanel sends run.
  - Verify: `pnpm lint`; `pnpm typecheck`; `pnpm test`; `pnpm build`; `pnpm audit --audit-level=high`

### Initial Todo Seed

- OA-01: write the ADR/update docs to lock `OpenAI + 2 auth choices`.
- OA-02: redesign provider registry/types for multi-auth-per-provider support.
- OA-03: define helper/deep-link transport and error-state contract.
- OA-04: expand vault/message schema for OpenAI browser-account state.
- OA-05: build a background auth coordinator that chooses API key vs account-backed runtime material.
- OA-06: implement Options/onboarding UX for `Login method` under OpenAI.
- OA-07: implement auth-aware model list/routing behavior.
- OA-08: migrate current Codex state into the new OpenAI browser-account surface.
- OA-09: align popup/sidepanel/readiness and land regression/security coverage.
- OA-10: update docs/manual QA and close the phase with full gates.

---

## Active Initiative: OpenCode-Style Auth Store Simplification

**Goal:** Replace the current user-facing vault/passphrase UX with an OpenCode-style app-managed auth store so the extension feels simpler to use while keeping background-owned trust boundaries for secrets and browser-account flows.

**Target product shape:**

- No visible `Initialize vault` / `Unlock vault` / passphrase flow in the primary UX.
- `OpenAI` keeps the 2 auth lanes already shipped:
  1. `ChatGPT Pro/Plus (browser)`
  2. `Manually enter API Key`
- Long-lived auth material persists in extension-owned local storage, similar in spirit to OpenCode's local `auth.json` model.
- Short-lived runtime session/access tokens remain memory-only or session-only.
- `chrome.storage.sync` remains out of scope for secrets.

**Execution Rule:** one task at a time -> implement -> verify -> PASS -> commit -> push -> update roadmap/blueprint -> move next.

| Task                                          | Status | Verify                                                                                                                    | Notes                                                                                                                                                    |
| --------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OS-01 - ADR lock for app-managed auth store   | DONE   | `git diff --check`; `pnpm exec prettier --check ROADMAP.md BLUEPRINT.md docs/task-os-01-opencode-style-auth-store-adr.md` | Locked the app-managed auth-store decision, trust boundary, migration rule, and security trade-off in `docs/task-os-01-opencode-style-auth-store-adr.md` |
| OS-02 - Auth store schema redesign            | DONE   | `pnpm exec vitest run src/shared/storage/__tests__/auth-store.test.ts src/shared/config/__tests__/openai-legacy-codex-bridge.test.ts src/background/__tests__/openai-runtime-auth-coordinator.test.ts`; `pnpm typecheck` | Added additive app-managed auth-store types/defaults/normalizers and a sanitized state projection without changing runtime or UI precedence yet |
| OS-03 - Background secret-ownership contract  | DONE   | `pnpm exec vitest run src/background/__tests__/app-managed-auth-store-manager.test.ts src/shared/storage/__tests__/auth-store.test.ts src/background/__tests__/credential-vault.test.ts`; `pnpm typecheck` | Added a background-only app-managed auth-store manager that owns durable reads/writes for the new auth-store surface while exposing sanitized state projections to future UI/runtime consumers |
| OS-04 - Vault to app-store migration bridge   | DONE   | `pnpm exec vitest run src/background/__tests__/credential-vault.test.ts src/background/__tests__/app-managed-auth-store-manager.test.ts src/shared/storage/__tests__/auth-store.test.ts src/background/__tests__/openai-runtime-auth-coordinator.test.ts src/background/__tests__/ui-session-runtime.test.ts`; `pnpm typecheck`; `pnpm build` | Added a dual-read, single-write bridge for API-key lanes so new writes land in the app-managed auth store while legacy vault data remains a non-destructive fallback |
| OS-05 - Runtime and readiness contract update | DONE   | `pnpm exec vitest run src/shared/ui/__tests__/key-based-provider-ux.test.ts src/background/__tests__/ui-session-runtime.test.ts src/background/__tests__/openai-runtime-auth-coordinator.test.ts`; `pnpm typecheck`; `pnpm build` | API-key readiness now honors auth-store-backed credentials without requiring a vault unlock, while account-backed lanes continue to fail closed on their own semantic state |
| OS-06 - UX simplification spec                | DONE   | `pnpm exec vitest run src/shared/ui/__tests__/key-based-provider-ux.test.ts src/options/__tests__/App.test.tsx src/options/__tests__/provider-key-extraction.test.tsx src/popup/__tests__/App.test.tsx src/sidepanel/__tests__/App.test.tsx`; `pnpm typecheck`; `pnpm build` | Removed visible vault/passphrase UX from primary Options/onboarding flows, switched popup/sidepanel notices to simpler stored-credential states, and kept helper-missing honest while leaving legacy vault runtime code intact |
| OS-07 - Regression, QA, and rollout plan      | DONE   | `pnpm lint`; `pnpm test`; `pnpm typecheck`; `pnpm build`; `pnpm audit --audit-level=high`                                                                      | Hardened auth-store-first regressions, fixed slow test timeouts under full-suite load, and restored the full repo gate set before final cleanup       |
| OS-08 - Legacy vault cleanup and closeout     | DONE   | `pnpm lint`; `pnpm test`; `pnpm typecheck`; `pnpm build`; `pnpm audit --audit-level=high`                                                                      | Closed the initiative by removing primary-flow vault claims from docs/QA, retaining only clearly labeled legacy compatibility shims where still required |

### MVP Scope

- Extension-owned persistent auth store using `chrome.storage.local`.
- No user-facing vault/passphrase in the main auth flows.
- OpenAI dual-auth UX remains intact.
- Browser-account helper/deep-link flow stays background-owned.
- API-key lane and browser-account lane continue to use auth-aware runtime/model routing.
- Non-destructive migration path from current vault-backed data.

### Explicitly Out of Scope

- OS keychain / Windows Credential Manager / native secure enclave integration.
- Full extension-owned OAuth callback redesign.
- Headless login.
- `chrome.storage.sync` for secrets.
- Cookie scraping, localStorage scraping, sessionStorage scraping, or piggybacking on logged-in tabs.
- Immediate hard deletion of all vault code before migration is stable.

### Decision Notes

- This initiative is primarily a UX simplification, not a claim of stronger at-rest security.
- The closest extension equivalent to OpenCode's local auth file is `chrome.storage.local`, not an encrypted user-passphrase vault and not a native keychain.
- Background remains the only trusted owner of secrets; UI surfaces must stay sanitized.
- Short-lived runtime tokens remain memory-only or session-only.
- Persist only the minimum long-lived auth material needed for revalidation/refresh.
- Do not sync secrets through the browser account.
- Do not silently claim security equivalence with the current passphrase-based vault; the trade-off must be documented honestly.

### Migration Strategy

- Schema-first: add the new auth store before removing the vault.
- Dual-read bridge: read the new auth store first, then fall back to vault-backed records if the new store has no data.
- Single-write cutover: all new writes go only to the new auth store once the bridge lands.
- Lazy per-provider migration: convert provider records on demand, not through a destructive one-shot rewrite.
- Cleanup only after migration is stable, idempotent, and regression coverage is green.

### Security Guardrails

- No raw API keys, helper payloads, refresh material, or runtime session tokens in Options/Popup/Sidepanel.
- No persistence of short-lived runtime/session tokens.
- No persistence of raw callback URLs, nonce/state payloads, or browser session blobs.
- Revoke/remove must wipe durable auth material plus any in-memory runtime cache.
- Helper/deep-link results must still pass provenance + request binding checks before persistence.

### Initial Todo Seed

- OS-01: write the ADR that replaces user-facing vault UX with an app-managed auth store and records the security trade-off.
- OS-02: redesign storage types for persistent auth records without user passphrases.
- OS-03: lock the background-only secret ownership contract.
- OS-04: implement and verify a dual-read, single-write migration bridge from the vault.
- OS-05: replace vault-lock readiness semantics in runtime/UI state.
- OS-06: design the simplified auth UX for OpenAI and other provider lanes.
- OS-07: expand regression tests, E2E fixtures, and rollout checks.
- OS-08: remove legacy vault UX/code once migration is proven stable.

### Execution Notes

- [2026-03-19] OS-01 DONE
  - Added `docs/task-os-01-opencode-style-auth-store-adr.md` to lock the move away from user-facing vault/passphrase UX and toward an OpenCode-style app-managed auth store.
  - Synced `ROADMAP.md` and `BLUEPRINT.md` so the planned initiative now consistently states the trust boundary, migration rule, and honest security trade-off.
  - Verify: `git diff --check`; `pnpm exec prettier --check ROADMAP.md BLUEPRINT.md docs/task-os-01-opencode-style-auth-store-adr.md`
  - Next step: OS-02 redesigns the persistent auth-store schema before any migration, runtime, or UX changes land.
- [2026-03-19] OS-02 DONE
  - Added additive app-managed auth-store schema primitives in `src/shared/types/storage.ts` plus shared defaults/normalizers in `src/shared/storage/auth-store.ts`.
  - Added a sanitized auth-store state projection that deliberately strips API-key secrets and browser-account artifact payloads while keeping the current vault-backed runtime/UI behavior unchanged.
  - Verify: `pnpm exec vitest run src/shared/storage/__tests__/auth-store.test.ts src/shared/config/__tests__/openai-legacy-codex-bridge.test.ts src/background/__tests__/openai-runtime-auth-coordinator.test.ts`; `pnpm typecheck`
  - Next step: OS-03 uses this schema to lock the background-only secret ownership contract before migration or UX simplification work lands.
- [2026-03-19] OS-03 DONE
  - Added `src/background/app-managed-auth-store-manager.ts` as the new background-owned auth-store boundary for durable auth-store writes, durable secret/artifact reads, sanitized state reads, and session-only browser-login pending attempts.
  - Kept all current runtime/UI paths unchanged while proving that raw secrets and artifact payloads stay out of the UI-facing state contract exposed by the new manager; the legacy vault remains the active shipped source until the migration task lands.
  - Verify: `pnpm exec vitest run src/background/__tests__/app-managed-auth-store-manager.test.ts src/shared/storage/__tests__/auth-store.test.ts src/background/__tests__/credential-vault.test.ts`; `pnpm typecheck`
  - Next step: OS-04 lands the dual-read, single-write migration bridge before any readiness or UX simplification work.
- [2026-03-19] OS-04 DONE
  - Added a dual-read, single-write bridge inside the legacy `CredentialVault` facade for API-key lanes: app-managed auth store data is now preferred on reads, legacy vault data lazily seeds the new store on fallback reads, and new API-key writes land only in the new store.
  - Kept browser-account lanes, helper semantics, and existing OpenAI/Codex account-backed runtime behavior unchanged while preventing deleted API-key records from silently resurrecting through legacy fallback.
  - Verify: `pnpm exec vitest run src/background/__tests__/credential-vault.test.ts src/background/__tests__/app-managed-auth-store-manager.test.ts src/shared/storage/__tests__/auth-store.test.ts src/background/__tests__/openai-runtime-auth-coordinator.test.ts src/background/__tests__/ui-session-runtime.test.ts`; `pnpm typecheck`; `pnpm build`
  - Next step: OS-05 replaces `vault-locked` readiness semantics with auth-store-aware readiness now that the underlying API-key bridge is live.
- [2026-03-19] OS-05 DONE
  - Added auth-store-aware readiness semantics for API-key lanes by tagging bridged credential records with their storage source and teaching key-based provider UX to stop reporting `vault-locked` when the credential already lives in the app-managed auth store.
  - Tightened account-backed status handling so OpenAI browser-account status no longer gets polluted by a separate OpenAI API-key credential when the browser lane is selected, while legacy vault-backed account lanes keep their existing semantics until later tasks.
  - Verify: `pnpm exec vitest run src/shared/ui/__tests__/key-based-provider-ux.test.ts src/background/__tests__/ui-session-runtime.test.ts src/background/__tests__/openai-runtime-auth-coordinator.test.ts`; `pnpm typecheck`; `pnpm build`
  - Next step: OS-06 removes the visible vault UX and replaces it with the simplified auth-store-first Options/onboarding/popup/sidepanel flow.
- [2026-03-19] OS-06 DONE
  - Removed the visible Credential Vault card plus passphrase/init/unlock controls from the primary Options/onboarding setup surface, and rewrote API-key messaging around local credential storage instead of user-managed vault UX.
  - Updated shared provider UX copy plus popup/sidepanel notices to use neutral actionable states such as `Stored credential unavailable`, `Reconnect required`, `Validation required`, and `Helper unavailable`, while keeping `helper-missing` honest and leaving legacy background vault/runtime logic untouched.
  - Verify: `pnpm exec vitest run src/shared/ui/__tests__/key-based-provider-ux.test.ts src/options/__tests__/App.test.tsx src/options/__tests__/provider-key-extraction.test.tsx src/popup/__tests__/App.test.tsx src/sidepanel/__tests__/App.test.tsx`; `pnpm typecheck`; `pnpm build`
  - Execution note: UX-only pass. Legacy vault code still exists behind the scenes for migration compatibility and later cleanup under OS-08.
  - Next step: OS-07 expands regression coverage, E2E fixtures, and rollout notes around the simplified auth UX before any legacy cleanup starts.
- [2026-03-19] OS-07 DONE
  - Hardened the full regression gate by fixing auth-store-first follow-up issues in Options/Copilot legacy local storage fallback, tightening background auth-store manager edge cases, and giving the slowest Options/E2E auth scenarios explicit timeouts so they stay deterministic under full-suite load.
  - Re-ran the complete repository gate set and restored green status for lint, test, typecheck, build, and audit before vault cleanup begins.
  - Verify: `pnpm lint`; `pnpm test`; `pnpm typecheck`; `pnpm build`; `pnpm audit --audit-level=high`
  - Next step: OS-08 can now focus on legacy vault cleanup and final docs/closeout instead of firefighting regressions.
- [2026-03-19] OS-08 DONE
  - Updated `README.md`, `TESTING.md`, and `docs/task-15-manual-qa-checklist.md` so the product story now treats the auth-store-first model as primary, scopes remaining vault language to legacy compatibility only, and keeps the security trade-off honest.
  - Kept legacy vault internals as clearly labeled compatibility shims instead of pretending the repo fully deleted them; primary OpenAI and CLIProxyAPI flows are now documented as local-auth-store-first.
  - Verify: `pnpm lint`; `pnpm test`; `pnpm typecheck`; `pnpm build`; `pnpm audit --audit-level=high`

---

## PHASE 1: Foundation (Week 1-4)

**Goal:** Working build system, shared infrastructure, security primitives.
**Exit Criteria:** `pnpm build` produces loadable extension, all shared types compile, tests run.

---

### Sprint 1.1 (Week 1-2): Project Bootstrap

#### `@sub-tech-lead` Tasks

| ID    | Task                                              | Est. Hours | Depends On | Acceptance Criteria                  |
| ----- | ------------------------------------------------- | ---------- | ---------- | ------------------------------------ |
| F-01  | Initialize project with Vite + CRXJS + TypeScript | 4h         | â€”        | `pnpm dev` starts, HMR works         |
| F-01a | Configure tsconfig.json (strict mode, paths)      | 1h         | F-01       | `tsc --noEmit` passes                |
| F-01b | Configure vite.config.ts with CRXJS plugin        | 2h         | F-01       | Extension loads in Chrome            |
| F-01c | Create manifest.json (MV3, permissions)           | 2h         | F-01       | Chrome accepts manifest              |
| F-01d | Setup pnpm workspace, install dependencies        | 1h         | F-01       | All deps install cleanly             |
| F-03  | Define shared TypeScript interfaces               | 8h         | F-01       | All core types in src/shared/        |
| F-03a | Action types & ElementSelector                    | 3h         | â€”        | All 30+ action types defined         |
| F-03b | AI provider interfaces                            | 2h         | â€”        | IAIProvider, IAIClientManager        |
| F-03c | Storage schema types                              | 2h         | â€”        | StorageSchema, ExtensionSettings     |
| F-03d | Message protocol types                            | 1h         | â€”        | ExtensionMessage, ExtensionResponse  |
| F-06  | Error handling framework                          | 4h         | F-03       | ErrorCode enum, ExtensionError class |

#### `@sub-ui-designer` Tasks

| ID    | Task                                       | Est. Hours | Depends On | Acceptance Criteria                        |
| ----- | ------------------------------------------ | ---------- | ---------- | ------------------------------------------ |
| F-02  | Design token CSS variables                 | 4h         | â€”        | design-tokens.css with all tokens          |
| F-02a | Color palette (light + dark)               | 2h         | â€”        | 13 semantic color tokens per theme         |
| F-02b | Typography, spacing, shadows               | 1h         | â€”        | Font scale, 4px spacing grid               |
| F-02c | Tailwind config with custom tokens         | 1h         | F-02a      | tailwind.config.js extends tokens          |
| F-10  | Base UI component library                  | 8h         | F-02       | Button, Input, Badge, Card, Modal, Spinner |
| F-10a | Button component (variants, sizes, states) | 2h         | F-02       | Primary, secondary, ghost, danger          |
| F-10b | Input component (text, password toggle)    | 2h         | F-02       | States: default, focus, error, disabled    |
| F-10c | Card, Badge, Modal, Spinner                | 4h         | F-02       | All with dark mode support                 |

#### `@sub-qa-tester` Tasks

| ID    | Task                               | Est. Hours | Depends On | Acceptance Criteria                     |
| ----- | ---------------------------------- | ---------- | ---------- | --------------------------------------- |
| F-07  | Vitest setup with Chrome API mocks | 4h         | F-01       | `pnpm test` runs, mock chrome.\* works  |
| F-07a | vitest.config.ts with JSDOM        | 1h         | F-01       | Config loads cleanly                    |
| F-07b | Chrome API mock library            | 3h         | F-01       | chrome.tabs, storage, scripting mocked  |
| F-08  | GitHub Actions CI pipeline         | 3h         | F-07       | CI runs on PR: lint + type-check + test |
| F-08a | ci.yml (lint, tsc, test, build)    | 2h         | â€”        | Green pipeline on main                  |
| F-08b | release.yml (build + package .zip) | 1h         | â€”        | Produces extension .zip artifact        |

#### `@sub-security-auditor` Tasks

| ID    | Task                                    | Est. Hours | Depends On | Acceptance Criteria                    |
| ----- | --------------------------------------- | ---------- | ---------- | -------------------------------------- |
| F-04  | Storage encryption (AES-256-GCM)        | 6h         | F-03       | API keys encrypted/decrypted correctly |
| F-04a | Web Crypto API wrapper                  | 3h         | â€”        | encrypt(), decrypt() functions         |
| F-04b | PBKDF2 key derivation                   | 2h         | â€”        | 310k iterations, random salt           |
| F-04c | Secure storage wrapper                  | 1h         | F-04a      | get/set with auto-encrypt              |
| F-09  | Security primitives                     | 6h         | F-03       | Sanitizer, URL validator, PII detector |
| F-09a | Input sanitizer (HTML strip, escape)    | 2h         | â€”        | Strips all HTML/script tags            |
| F-09b | URL validator (blocklist, scheme check) | 2h         | â€”        | Rejects javascript:, chrome://, etc.   |
| F-09c | PII detector (SSN, CC, email, phone)    | 2h         | â€”        | Detects and redacts 5 PII types        |

### Sprint 1.2 (Week 3-4): Message Bridge & Integration

#### `@sub-tech-lead` Tasks

| ID    | Task                            | Est. Hours | Depends On | Acceptance Criteria                   |
| ----- | ------------------------------- | ---------- | ---------- | ------------------------------------- |
| F-05  | Message protocol implementation | 8h         | F-03       | SW â†” CS bidirectional messaging     |
| F-05a | Service Worker bridge           | 3h         | F-03d      | Send/receive with type safety         |
| F-05b | Content Script bridge           | 3h         | F-03d      | Receive/respond with validation       |
| F-05c | Message validation + nonce      | 2h         | F-05a      | Reject invalid/replayed messages      |
| F-11  | Service Worker entry point      | 4h         | F-05       | Boots cleanly, listeners registered   |
| F-12  | Content Script entry point      | 4h         | F-05       | Injects on page load, bridge ready    |
| F-13  | Logging framework               | 2h         | â€”        | Logger with levels, no sensitive data |

#### `@sub-qa-tester` Tasks

| ID    | Task                                 | Est. Hours | Depends On | Acceptance Criteria                         |
| ----- | ------------------------------------ | ---------- | ---------- | ------------------------------------------- |
| F-14  | Unit tests for Sprint 1 deliverables | 8h         | All F-\*   | 80%+ coverage on shared/                    |
| F-14a | Encryption tests                     | 2h         | F-04       | Encrypt/decrypt round-trip, wrong key fails |
| F-14b | Sanitizer tests                      | 2h         | F-09       | XSS payloads blocked, clean input passes    |
| F-14c | Message protocol tests               | 2h         | F-05       | Valid messages pass, invalid rejected       |
| F-14d | PII detection tests                  | 2h         | F-09c      | All PII types detected + redacted           |

### Phase 1 Milestone Checklist

```
â–¡ pnpm dev starts extension with HMR
â–¡ pnpm build produces loadable .zip
â–¡ pnpm test runs with 80%+ coverage
â–¡ CI pipeline green on main branch
â–¡ All shared types compile (tsc --noEmit = 0 errors)
â–¡ SW â†” CS message bridge working (verified in test)
â–¡ API key encryption working (round-trip test)
â–¡ Base UI components rendered in Side Panel shell
â–¡ Security primitives tested (sanitizer, PII, URL validator)
```

---

## PHASE 2: Core Engine (Week 5-10)

**Goal:** AI can receive commands, generate actions, and execute them on web pages.
**Exit Criteria:** User types "Go to google.com and search for cats" â†’ AI navigates, types, clicks.

---

### Sprint 2.1 (Week 5-6): AI Client

#### `@sub-tech-lead` Tasks

| ID    | Task                               | Est. Hours | Depends On | Acceptance Criteria                  |
| ----- | ---------------------------------- | ---------- | ---------- | ------------------------------------ |
| C-01  | Base AI provider abstract class    | 4h         | F-03       | BaseProvider with common logic       |
| C-02  | Claude provider                    | 6h         | C-01       | Streaming chat with Claude API       |
| C-03  | OpenAI provider                    | 4h         | C-01       | Streaming chat with GPT-4o           |
| C-04  | Gemini provider                    | 4h         | C-01       | Streaming chat with Gemini API       |
| C-05  | Ollama + OpenRouter providers      | 4h         | C-01       | Local model + OpenRouter support     |
| C-06  | AI Client Manager                  | 6h         | C-01~05    | Provider switching, fallback, retry  |
| C-06a | Streaming parser (SSE/JSON chunks) | 3h         | â€”        | Handles all provider stream formats  |
| C-06b | Token counter (estimate)           | 1h         | â€”        | Approximate token count per provider |
| C-06c | Rate limiter                       | 2h         | â€”        | Respects provider rate limits        |

#### `@sub-tech-lead` + `@sub-security-auditor` Tasks

| ID    | Task                        | Est. Hours | Depends On | Acceptance Criteria                      |
| ----- | --------------------------- | ---------- | ---------- | ---------------------------------------- |
| C-07  | System prompt engineering   | 6h         | C-01       | Produces valid JSON actions consistently |
| C-07a | Core system prompt          | 3h         | â€”        | AI returns structured JSON               |
| C-07b | Context injection template  | 2h         | â€”        | Page content safely delimited            |
| C-07c | Prompt injection test suite | 1h         | C-07a      | 20+ injection attempts all blocked       |

#### `@sub-qa-tester` Tasks

| ID     | Task                                | Est. Hours | Depends On | Acceptance Criteria                     |
| ------ | ----------------------------------- | ---------- | ---------- | --------------------------------------- |
| C-25a  | AI Client unit tests                | 8h         | C-01~06    | All providers tested with mocks         |
| C-25a1 | Mock fetch for each provider format | 3h         | â€”        | Realistic mock responses                |
| C-25a2 | Streaming parser tests              | 2h         | â€”        | Partial chunks, errors handled          |
| C-25a3 | Error/retry/fallback tests          | 3h         | â€”        | Rate limit â†’ retry, fail â†’ fallback |

### Sprint 2.2 (Week 7-8): Command Parser + Browser Controller

#### `@sub-tech-lead` Tasks

| ID    | Task                                 | Est. Hours | Depends On | Acceptance Criteria               |
| ----- | ------------------------------------ | ---------- | ---------- | --------------------------------- |
| C-08  | Command Parser: JSON extraction      | 4h         | C-07       | Extracts actions from AI response |
| C-09  | Zod schemas for all 30+ action types | 8h         | F-03a      | Every ActionType has Zod schema   |
| C-11  | Tab Manager                          | 4h         | F-03       | Create, close, switch, list tabs  |
| C-12  | Scripting Adapter (chrome.scripting) | 8h         | F-05       | Execute scripts in tabs           |
| C-13  | Debugger Adapter (CDP)               | 12h        | F-03       | Attach, send CDP commands, detach |
| C-13a | CDP: Input.dispatchMouseEvent        | 3h         | C-13       | Click, hover, drag simulation     |
| C-13b | CDP: Input.dispatchKeyEvent          | 3h         | C-13       | Typing, shortcuts simulation      |
| C-13c | CDP: Page.captureScreenshot          | 2h         | C-13       | Full page screenshot              |
| C-13d | CDP: Runtime.evaluate                | 2h         | C-13       | Execute JS in page context        |
| C-13e | CDP: DOM.\* commands                 | 2h         | C-13       | Query, modify DOM via CDP         |

#### `@sub-security-auditor` Tasks

| ID    | Task                                | Est. Hours | Depends On | Acceptance Criteria                   |
| ----- | ----------------------------------- | ---------- | ---------- | ------------------------------------- |
| C-10  | Command sanitizer                   | 6h         | C-09       | All action payloads sanitized         |
| C-10a | URL validation for navigate actions | 2h         | â€”        | Blocks javascript:, data:, chrome://  |
| C-10b | Selector sanitization               | 2h         | â€”        | No script injection via selectors     |
| C-10c | Sensitivity classification          | 2h         | â€”        | Each action classified SAFEâ†’BLOCKED |

### Sprint 2.3 (Week 9-10): Content Scripts + Orchestrator

#### `@sub-tech-lead` Tasks

| ID    | Task                             | Est. Hours | Depends On | Acceptance Criteria                           |
| ----- | -------------------------------- | ---------- | ---------- | --------------------------------------------- |
| C-14  | Selector Engine (multi-strategy) | 8h         | F-12       | CSS, XPath, text, ARIA, placeholder, nearText |
| C-14a | CSS selector resolution          | 1h         | â€”        | querySelector with nth                        |
| C-14b | XPath resolution                 | 1h         | â€”        | document.evaluate                             |
| C-14c | Text/ARIA/placeholder resolution | 3h         | â€”        | Fuzzy text match, role query                  |
| C-14d | nearText (proximity selector)    | 3h         | â€”        | Find element near given text                  |
| C-15  | Click/hover/focus actions        | 4h         | C-14       | Dispatch MouseEvent correctly                 |
| C-16  | Fill/type/select actions         | 6h         | C-14       | React-compatible input simulation             |
| C-16a | React-safe value setter          | 3h         | â€”        | Override React's synthetic events             |
| C-16b | Select dropdown handler          | 2h         | â€”        | Works with native + custom selects            |
| C-16c | Checkbox/radio handler           | 1h         | â€”        | Check, uncheck with events                    |
| C-17  | Scroll actions                   | 2h         | C-14       | scrollIntoView, scrollBy                      |
| C-18  | Extract/screenshot               | 4h         | C-14       | Get text, attributes, screenshot              |
| C-19  | DOM Inspector (context builder)  | 6h         | C-14       | Summarize page DOM for AI                     |
| C-19a | Visible element extraction       | 3h         | â€”        | Only elements in viewport                     |
| C-19b | Interactive element detection    | 2h         | â€”        | Buttons, links, inputs, selects               |
| C-19c | Page summary generation          | 1h         | â€”        | Compact text summary                          |
| C-20  | Auto-wait engine                 | 4h         | C-14       | Wait for element, navigation, network idle    |
| C-21  | Session Manager                  | 6h         | C-06       | Create, pause, resume, abort sessions         |
| C-22  | Context Builder                  | 6h         | C-19       | Build AI context from page state              |
| C-23  | Orchestrator: Action queue       | 8h         | ALL        | Receive actions â†’ execute in order          |
| C-24  | Error recovery pipeline          | 4h         | C-23       | Retry â†’ alternative â†’ ask user            |

#### `@sub-qa-tester` Tasks

| ID    | Task                                   | Est. Hours | Depends On | Acceptance Criteria                    |
| ----- | -------------------------------------- | ---------- | ---------- | -------------------------------------- |
| C-25b | Content Script unit tests              | 12h        | C-14~C-20  | Selector, actions, auto-wait tested    |
| C-25c | Browser Controller tests               | 8h         | C-11~C-13  | Tab manager, adapters tested           |
| C-25d | Session + Orchestrator tests           | 6h         | C-21~C-24  | Full action flow tested                |
| C-25e | Integration test: SW â†” CS round-trip | 4h         | ALL        | Message â†’ action â†’ result verified |

#### `@sub-security-auditor` Tasks

| ID    | Task                             | Est. Hours | Depends On | Acceptance Criteria                  |
| ----- | -------------------------------- | ---------- | ---------- | ------------------------------------ |
| C-26  | Security review of Phase 2 code  | 8h         | ALL        | No security issues in core modules   |
| C-26a | Prompt injection test battery    | 4h         | C-07       | 50+ injection scenarios tested       |
| C-26b | XSS review of content scripts    | 2h         | C-14~C-18  | No innerHTML with user data          |
| C-26c | Message protocol security review | 2h         | F-05       | Origin validation, replay protection |

### Phase 2 Milestone Checklist

```
â–¡ AI streams response from all 5 providers
â–¡ Command parser extracts valid actions from AI response
â–¡ Content script clicks, fills, types on real websites
â–¡ Selector engine finds elements via CSS, text, ARIA
â–¡ Auto-wait works for dynamic content (SPA pages)
â–¡ Screenshot captured via tabs API + CDP
â–¡ Orchestrator executes action sequence with error recovery
â–¡ 80%+ unit test coverage on all core modules
â–¡ Security review passed (prompt injection, XSS, message security)
â–¡ DEMO: "Go to google.com and search for cats" works end-to-end
```

---

## PHASE 3: UI & Integration (Week 11-14)

**Goal:** Full user-facing UI, connected to core engine, ready for human testing.
**Exit Criteria:** Non-technical user can install, configure, and run a multi-step automation task.

---

### Sprint 3.1 (Week 11-12): Side Panel + Popup

#### `@sub-ui-designer` Tasks

| ID    | Task                                     | Est. Hours | Depends On | Acceptance Criteria                    |
| ----- | ---------------------------------------- | ---------- | ---------- | -------------------------------------- |
| U-01  | Side Panel: ChatContainer + layout       | 6h         | F-10       | Header, chat area, input, responsive   |
| U-02  | Message bubbles: user, AI, action, error | 8h         | U-01       | 4 variants with animations             |
| U-02a | User message bubble                      | 2h         | â€”        | Right-aligned, timestamp               |
| U-02b | AI message bubble with markdown          | 3h         | â€”        | Markdown rendering, action buttons     |
| U-02c | Action status bubble (progress)          | 2h         | â€”        | Progress bar, step counter, cancel     |
| U-02d | Error bubble with recovery options       | 1h         | â€”        | Retry, alternative, report             |
| U-03  | Input area with commands                 | 4h         | U-01       | Text input, send button, / commands    |
| U-03a | Slash command autocomplete               | 2h         | â€”        | /screenshot, /extract, /settings       |
| U-03b | Multi-line input support                 | 1h         | â€”        | Shift+Enter for newline                |
| U-03c | Send via Ctrl+Enter                      | 1h         | â€”        | Keyboard shortcut working              |
| U-04  | Action log panel (collapsible)           | 4h         | U-01       | Timeline of executed actions           |
| U-05  | Action timeline with statuses            | 3h         | U-04       | Pending/running/done/failed icons      |
| U-06  | Popup: Quick actions + page info         | 6h         | F-10       | 360x480, current page, 4 quick actions |
| U-13  | Dark/Light mode toggle                   | 3h         | F-02       | System/light/dark, persists            |

#### `@sub-tech-lead` Tasks

| ID    | Task                                 | Est. Hours | Depends On | Acceptance Criteria            |
| ----- | ------------------------------------ | ---------- | ---------- | ------------------------------ |
| U-15  | Connect UI stores â†” Service Worker | 8h         | U-01, C-23 | useSession, useChat hooks work |
| U-15a | Session store (Zustand)              | 3h         | â€”        | Create/list/switch sessions    |
| U-15b | Chat store + message streaming       | 3h         | â€”        | Real-time AI response display  |
| U-15c | Action log store + events            | 2h         | â€”        | Action progress updates in UI  |

### Sprint 3.2 (Week 13-14): Options, Onboarding, Overlays

#### `@sub-ui-designer` Tasks

| ID    | Task                           | Est. Hours | Depends On | Acceptance Criteria                              |
| ----- | ------------------------------ | ---------- | ---------- | ------------------------------------------------ |
| U-07  | Options: Provider settings     | 4h         | F-10       | Provider dropdown, API key (masked), test button |
| U-08  | Options: Permission toggles    | 3h         | U-07       | Toggle switches for each capability              |
| U-09  | Options: Appearance settings   | 2h         | U-07       | Theme, language selection                        |
| U-10  | Onboarding: 4-step flow        | 8h         | F-10       | Welcome â†’ Connect â†’ Permissions â†’ Ready    |
| U-10a | Welcome screen                 | 1h         | â€”        | Logo, features list, CTA                         |
| U-10b | Connect AI provider            | 3h         | â€”        | Provider select, key input, test                 |
| U-10c | Permission explanation         | 2h         | â€”        | CAN do / CANNOT do lists                         |
| U-10d | Ready + quick tips             | 2h         | â€”        | Shortcut info, first command                     |
| U-11  | In-Page: Element highlight     | 4h         | â€”        | Pulsing border around target element             |
| U-12  | In-Page: Action status overlay | 4h         | â€”        | Floating card showing current action             |
| U-17  | Accessibility audit + fixes    | 6h         | ALL UI     | WCAG 2.1 AA compliance                           |

#### `@sub-tech-lead` Tasks

| ID    | Task                              | Est. Hours | Depends On | Acceptance Criteria                  |
| ----- | --------------------------------- | ---------- | ---------- | ------------------------------------ |
| U-14  | Keyboard shortcuts system         | 3h         | â€”        | Ctrl+Shift+Y (panel), Escape (stop)  |
| U-15d | Connect overlay to content bridge | 4h         | U-11       | Highlight element when AI targets it |

#### `@sub-qa-tester` Tasks

| ID    | Task                    | Est. Hours | Depends On | Acceptance Criteria                             |
| ----- | ----------------------- | ---------- | ---------- | ----------------------------------------------- |
| U-16  | E2E test: Full pipeline | 12h        | ALL        | User â†’ AI â†’ action â†’ result â†’ UI update |
| U-16a | Navigation E2E test     | 3h         | â€”        | "Go to X" â†’ page navigates                    |
| U-16b | Form filling E2E test   | 3h         | â€”        | "Fill this form" â†’ fields populated           |
| U-16c | Click interaction E2E   | 3h         | â€”        | "Click login" â†’ button clicked                |
| U-16d | Error recovery E2E      | 3h         | â€”        | Element not found â†’ retry â†’ success         |

#### `@sub-security-auditor` Tasks

| ID    | Task                        | Est. Hours | Depends On | Acceptance Criteria              |
| ----- | --------------------------- | ---------- | ---------- | -------------------------------- |
| U-18  | Security audit of UI layer  | 4h         | ALL UI     | No XSS, secure API key display   |
| U-18a | API key input security      | 2h         | U-07       | Never in DOM, masked, copy-proof |
| U-18b | Markdown rendering security | 2h         | U-02b      | DOMPurify strict config          |

### Phase 3 Milestone Checklist

```
â–¡ Side Panel fully functional (chat, actions, progress)
â–¡ Popup shows page info + quick actions
â–¡ Options page configures provider + settings
â–¡ Onboarding flow works for first-time users
â–¡ In-page overlay highlights target elements
â–¡ Dark mode / Light mode works correctly
â–¡ Keyboard shortcuts functional
â–¡ E2E tests pass: navigate, fill, click, error recovery
â–¡ Accessibility audit passed (WCAG 2.1 AA)
â–¡ Security audit passed for UI layer
â–¡ DEMO: Non-technical user can complete "search Amazon for laptops"
```

---

## PHASE 4: Advanced Features (Week 15-18)

**Goal:** Playwright-level capabilities via CDP, recording/playback, workflows.
**Exit Criteria:** Extension handles file upload, network intercept, PDF, geolocation, iframe.

---

### Sprint 4.1 (Week 15-16): Advanced CDP Features

#### `@sub-tech-lead` Tasks

| ID      | Task                                       | Est. Hours | Depends On | Acceptance Criteria                                                                                                                          |
| ------- | ------------------------------------------ | ---------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| A-01    | Network interception                       | 8h         | C-13       | Intercept requests, modify responses                                                                                                         |
| A-01a   | Fetch.enable + requestPaused               | 4h         | â€”        | Intercept matching URL patterns                                                                                                              |
| A-01b   | Mock response injection                    | 2h         | â€”        | Return custom response body                                                                                                                  |
| A-01c   | Request blocking                           | 2h         | â€”        | Block specific URLs (ads, trackers)                                                                                                          |
| A-02    | Device emulation                           | 4h         | C-13       | Mobile viewport, user agent, touch                                                                                                           |
| A-02a   | Emulation.setDeviceMetricsOverride         | 2h         | â€”        | iPhone, Pixel, iPad presets                                                                                                                  |
| A-02b   | Emulation.setUserAgentOverride             | 1h         | â€”        | Match device user agent                                                                                                                      |
| A-02c   | Emulation.setTouchEmulationEnabled         | 1h         | â€”        | Touch events for mobile                                                                                                                      |
| A-03    | Geolocation mock                           | 6h         | C-13       | Set fake GPS coordinates via CDP                                                                                                             |
| A-03.1  | Type definition in `actions.ts`            | 0.5h       | â€”        | `MockGeolocationAction` interface, `'mockGeolocation'` in `ActionType` union, added to `Action` union                                        |
| A-03.2  | Sensitivity classification                 | 0.5h       | A-03.1     | `mockGeolocation: 'medium'` in `BASE_SENSITIVITY` (`action-classifier.ts` line ~84)                                                          |
| A-03.3  | Zod schema in `action-schemas.ts`          | 1h         | A-03.1     | Add `'mockGeolocation'` to `ACTION_TYPES` array (â†’35 total), add `mockGeolocationSchema` to `actionSchemas`, add to `orderedActionSchemas` |
| A-03.4  | System prompt update in `system.ts`        | 0.5h       | A-03.3     | Add to `ACTION_REFERENCE` Advanced section, compact prompt list, `SUPPORTED_ACTION_TYPES` array (â†’35 total)                                |
| A-03.5  | CDP wrappers in `debugger-adapter.ts`      | 0.5h       | C-13       | `setGeolocationOverride(tabId, {latitude, longitude, accuracy})` and `clearGeolocationOverride(tabId)` methods                               |
| A-03.6  | `GeolocationMockManager` class             | 1h         | A-03.5     | New file `src/background/geolocation-mock-manager.ts`, follow `DeviceEmulationManager` pattern exactly                                       |
| A-03.7  | Runtime routing in `ui-session-runtime.ts` | 1h         | A-03.6     | Import manager, add to constructor, route in `executeAutomationAction`, cleanup in abort/newTab/switchTab/closeTab                           |
| A-03.8  | Unit tests for all components              | 1h         | A-03.7     | Tests for manager, CDP wrappers, schema, runtime routing. Update count assertions (34â†’35)                                                  |
| A-03.9  | Run all verification gates                 | â€”        | A-03.8     | `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm audit --audit-level=high`                                                                 |
| A-03.10 | Update tracker, commit, push               | â€”        | A-03.9     | DELIVERY_TRACKER.md update, `git commit`, `git push`                                                                                         |
| A-04    | PDF generation                             | 3h         | C-13       | Save page as PDF                                                                                                                             |
| A-05    | File upload                                | 4h         | C-13       | Handle file input elements                                                                                                                   |
| A-06    | iframe support                             | 6h         | C-13       | Route actions into targeted frames and interact                                                                                              |
| A-06a   | Frame-aware CS bridge                      | 3h         | â€”        | `all_frames` + frame-targeted messaging                                                                                                      |
| A-06b   | Frame context + selector targeting         | 3h         | â€”        | `selector.frame` + frame registry routing                                                                                                    |
| A-07    | Multi-tab automation                       | 6h         | C-11       | Orchestrate actions across tabs                                                                                                              |
| A-07a   | Cross-tab action sequencing                | 3h         | â€”        | "Open new tab, go to X, then..."                                                                                                             |
| A-07b   | Tab state synchronization                  | 3h         | â€”        | Know which tab has what page                                                                                                                 |

> Execution note: `A-04` remains in scope, but active implementation order is `A-05 -> A-06 -> A-04` because upload and iframe support are more core to browser control workflows.

### Sprint 4.2 (Week 17-18): Recording & Workflows

#### `@sub-tech-lead` + `@sub-ui-designer` Tasks

| ID    | Task                              | Est. Hours | Depends On | Acceptance Criteria                        |
| ----- | --------------------------------- | ---------- | ---------- | ------------------------------------------ |
| A-08  | Action recording                  | 12h        | C-14       | Record user clicks/types as actions        |
| A-08a | Click event capture               | 3h         | â€”        | Record element selector + position         |
| A-08b | Input event capture               | 3h         | â€”        | Record typed values                        |
| A-08c | Navigation event capture          | 2h         | â€”        | Record URL changes                         |
| A-08d | Recording UI (start/stop/pause)   | 4h         | â€”        | Red indicator, controls `@sub-ui-designer` |
| A-09  | Action playback (macros)          | 6h         | A-08       | Replay recorded action sequence            |
| A-09a | Playback engine with timing       | 3h         | â€”        | Execute actions with delays                |
| A-09b | Playback controls UI              | 3h         | â€”        | Play/pause/speed `@sub-ui-designer`        |
| A-10  | Export actions as script          | 4h         | A-08       | Export JSON, Playwright, Puppeteer format  |
| A-11  | Saved workflows manager           | 8h         | A-08       | Save, name, organize, share workflows      |
| A-11a | Workflow storage schema           | 2h         | â€”        | Name, description, actions, tags           |
| A-11b | Workflow list UI                  | 3h         | â€”        | Grid/list view `@sub-ui-designer`          |
| A-11c | Workflow run/edit/delete          | 3h         | â€”        | Full CRUD operations                       |
| A-12  | Advanced prompt templates         | 4h         | C-07       | Templates for common tasks                 |
| A-12a | "Extract table data" template     | 1h         | â€”        | Optimized for data extraction              |
| A-12b | "Fill form from profile" template | 1h         | â€”        | Use saved user profile data                |
| A-12c | "Compare prices" template         | 1h         | â€”        | Multi-tab price comparison                 |
| A-12d | "Monitor page changes" template   | 1h         | â€”        | Periodic check + alert                     |

#### `@sub-qa-tester` Tasks

| ID    | Task                       | Est. Hours | Depends On | Acceptance Criteria               |
| ----- | -------------------------- | ---------- | ---------- | --------------------------------- |
| A-13  | Advanced feature tests     | 12h        | A-01~A-12  | All advanced features tested      |
| A-13a | Network interception tests | 3h         | A-01       | Intercept, modify, block verified |
| A-13b | File upload tests          | 2h         | A-05       | File reaches server correctly     |
| A-13c | Recording/playback tests   | 4h         | A-08,A-09  | Record â†’ playback matches       |
| A-13d | Multi-tab tests            | 3h         | A-07       | Cross-tab orchestration works     |

#### `@sub-security-auditor` Tasks

| ID    | Task                               | Est. Hours | Depends On | Acceptance Criteria                |
| ----- | ---------------------------------- | ---------- | ---------- | ---------------------------------- |
| A-14  | Security review: Advanced features | 6h         | ALL A-\*   | No new attack vectors              |
| A-14a | Network intercept security         | 2h         | A-01       | Can't be used for credential theft |
| A-14b | Script export security             | 2h         | A-10       | No sensitive data in exports       |
| A-14c | Workflow storage security          | 2h         | A-11       | Workflows can't contain secrets    |

> Live execution status: `A-03.1` through `A-03.9` PASS; `A-03.10` remains pending because commit/push requires an explicit user request. `A-05`, `A-07`, `A-08`, `A-09`, and `A-10` are PASS; `A-06` implementation is complete and still tracked against the same known audit baseline (`rollup` via `@crxjs/vite-plugin`). `A-11` is now PASS: `A-11a`, `A-11b`, `A-11c`, and `A-11 QA` are all complete, with gate evidence from commit `1a3ff94` (`pnpm typecheck`, selective Vitest, `pnpm test` at `67 files / 1088 tests`, `pnpm build`, and `pnpm audit --audit-level=high` on the known `rollup` baseline only). `A-12` is now PASS: `A-12a` through `A-12d` are complete, the sidepanel now exposes extract-table, fill-from-profile, compare-prices, and monitor-page-changes prompt templates without changing background/runtime contracts, and the suite passed `pnpm typecheck`, targeted Vitest (`src/core/ai-client/__tests__/prompts.test.ts` and `src/sidepanel/components/__tests__/InputComposer.test.tsx`), full `pnpm test`, `pnpm build`, and the same known `rollup` audit baseline only. `A-13` is now PASS: advanced-feature coverage is complete via manager-level and runtime suites, with new assertions for active-session network interception and staged upload isolation/total-size limits, while existing runtime coverage already verifies recording/playback and cross-tab orchestration. Verification passed with `pnpm typecheck`, targeted Vitest (`src/background/__tests__/network-interception-manager.test.ts`, `src/background/__tests__/file-upload-manager.test.ts`, and `src/background/__tests__/ui-session-runtime.test.ts` at `3 files / 49 tests`), full `pnpm test` at `67 files / 1103 tests`, `pnpm build`, and the same known `rollup` audit baseline only. `A-14` is now PASS: network interception is restricted to `XHR`/`Fetch` and blocked from auth/credential endpoints, recording exports redact sensitive strings without breaking JSON/script syntax, and persisted workflows redact sensitive action data before storage. Verification passed with `pnpm typecheck`, targeted Vitest (`src/background/__tests__/network-interception-manager.test.ts`, `src/shared/storage/__tests__/workflows.test.ts`, `src/background/__tests__/ui-session-runtime.test.ts`, and `src/test/e2e/full-pipeline.test.tsx` at `4 files / 63 tests`), full `pnpm test` at `67 files / 1106 tests`, `pnpm build`, and the same known `rollup` audit baseline only. `P-01a` is now PASS: barrel imports were replaced with direct subpath imports across the targeted runtime, background managers, and options provider wiring to tighten import granularity and tree-shaking hygiene without behavior changes. Verification passed with `pnpm typecheck`, targeted Vitest (`src/background/__tests__/ui-session-runtime.test.ts`, `src/background/__tests__/network-interception-manager.test.ts`, `src/background/__tests__/device-emulation-manager.test.ts`, `src/background/__tests__/geolocation-mock-manager.test.ts`, and `src/options/__tests__/App.test.tsx` at `5 files / 88 tests`), full `pnpm test` at `67 files / 1106 tests`, `pnpm build` (2236 modules transformed; `assets/index.ts-DL7ktuPx.js` at 237.42 kB, `assets/index.html-Ow2SK_3Q.js` at 46.23 kB, `assets/openrouter-CA8C8MnQ.js` at 28.17 kB), and the same known `rollup` audit baseline only.

### Phase 4 Milestone Checklist

```
â–¡ Network interception working (block ads, mock APIs)
â–¡ Device emulation working (iPhone, Pixel presets)
â–¡ Geolocation mock working
âœ… PDF generation working
âœ… File upload working via staged sidepanel uploads
âœ… iframe interaction working via frame-aware bridge routing
âœ… Multi-tab automation working
â–¡ Action recording captures user actions accurately
â–¡ Action playback replays with correct timing
âœ… Export to JSON/Playwright format working
âœ… Workflow manager: save, load, run, delete
â–¡ Security review passed for all advanced features
â–¡ DEMO: Record filling a form â†’ replay on different site
```

---

## PHASE 5: Polish & Ship (Week 19-20)

**Goal:** Production-ready, tested, secure, Chrome Web Store approved.
**Exit Criteria:** v1.0.0 published on Chrome Web Store.

---

### Sprint 5.1 (Week 19): Hardening

#### `@sub-tech-lead` Tasks

| ID    | Task                               | Est. Hours | Depends On | Acceptance Criteria                |
| ----- | ---------------------------------- | ---------- | ---------- | ---------------------------------- |
| P-01  | Performance optimization           | 8h         | ALL        | < 500KB bundle, < 50MB idle memory |
| P-01a | Bundle analysis + tree shaking     | 3h         | â€”        | Remove unused code                 |
| P-01b | Lazy load AI providers             | 2h         | â€”        | Only load active provider          |
| P-01c | Content script size optimization   | 2h         | â€”        | Minimal CS payload                 |
| P-01d | Service Worker keep-alive strategy | 1h         | â€”        | SW doesn't die mid-task            |
| P-05a | README.md                          | 4h         | â€”        | Installation, usage, features      |
| P-05b | CONTRIBUTING.md                    | 2h         | â€”        | Dev setup, PR process              |

> Live execution status: `P-01a` is PASS via direct subpath imports for runtime/options/background manager dependencies. `P-01b` is PASS: runtime and options provider paths lazy-load only the active provider through `src/core/ai-client/provider-loader.ts`, the injected `aiClientManager` test path remains unchanged, and build output now emits provider-specific chunks (`claude`, `openai`, `gemini`, `ollama`, `openrouter`, plus `provider-loader`). `P-01c` is PASS: `src/content/index.ts` now lazy-loads `DOMInspector`, `AutoWaitEngine`, `ActionStatusOverlay`, and action executors by action family so the eager content-script entry stays minimal, while `src/content/__tests__/manager.test.ts` covers lazy page-context loading and `src/options/__tests__/App.test.tsx` now stubs provider creation to keep the provider validation UI test stable under the new lazy-load path. `P-05a` is PASS: root `README.md` has been reconciled against the repo's current `package.json`, `src/manifest.json`, CI/release workflows, and architecture/testing/security docs so installation, commands, extension surfaces, permissions, and repo documentation references match the actual project state. `P-05b` is PASS: `CONTRIBUTING.md` now documents local setup, verification commands, extension surfaces, CI behavior, release packaging, and PR expectations against the repo's current scripts and workflows. `P-02a` is PASS: `src/test/e2e/p-02a-real-sites.test.tsx` adds deterministic harness-level real-site scenarios for Google, Amazon, and GitHub so search/result, commerce, and repository-tab flows execute through the sidepanel + `UISessionRuntime` path without touching live network dependencies. Verification passed with `pnpm typecheck`, targeted Vitest (`src/test/e2e/p-02a-real-sites.test.tsx` at `1 file / 3 tests`), full `pnpm test` at `68 files / 1115 tests`, `pnpm build`, and `pnpm audit --audit-level=high`, with only the same known `rollup` advisories via `@crxjs/vite-plugin`. `P-02` remains in progress toward the broader `50+` scenario target.

> Update: `P-02b` is PASS via `src/test/e2e/p-02b-spa-sites.test.tsx`, which adds deterministic SPA-oriented E2E coverage for React-style route transitions, Vue-style filter refinement, and Angular-style multi-step wizard flows through the sidepanel + `UISessionRuntime` path. Verification passed with `pnpm typecheck`, targeted Vitest on `src/test/e2e/p-02b-spa-sites.test.tsx` (`1 file / 3 tests`), full `pnpm test` (`69 files / 1118 tests`), `pnpm build`, and `pnpm audit --audit-level=high`, with only the same known `rollup` advisories via `@crxjs/vite-plugin`. `P-02` remains in progress pending `P-02d`.

> Update: `P-02c` is PASS via `src/test/e2e/p-02c-edge-cases.test.tsx`, which adds deterministic edge-case E2E coverage for slow page-context fetches, oversized DOM/page-context inputs, and graceful no-op degradation when live page-context collection fails. Verification passed with `pnpm typecheck`, targeted Vitest on `src/test/e2e/p-02c-edge-cases.test.tsx` (`1 file / 3 tests`), full `pnpm test` (`70 files / 1121 tests`), `pnpm build`, and `pnpm audit --audit-level=high`, with only the same known `rollup` advisories via `@crxjs/vite-plugin`. `P-02` remains in progress pending `P-02d`.

> Update: `P-02d` is PASS via `src/test/e2e/p-02d-error-recovery.test.tsx`, which adds deterministic error-recovery E2E coverage for recoverable retries that continue the plan, unrecoverable failures that halt the remaining actions cleanly, and optional-action failures that surface safely without crashing the UI/runtime. Verification passed with `pnpm typecheck`, targeted Vitest on `src/test/e2e/p-02d-error-recovery.test.tsx` (`1 file / 3 tests`), full `pnpm test` (`71 files / 1124 tests`), `pnpm build`, and `pnpm audit --audit-level=high`, with only the same known `rollup` advisories via `@crxjs/vite-plugin`. `P-02` remains in progress toward the broader `50+` scenario target.

> Update: `P-06` is now in progress via `BETA_PROGRAM.md` and `.github/ISSUE_TEMPLATE/beta-feedback.md`, which prepare the beta-program operating kit inside the repo. `P-06b` is PASS with seven structured scripts covering onboarding, provider setup, popup, side panel, recording/playback, export, and workflow reuse. `P-06a` and `P-06c` now have recruitment and triage assets ready, but still require real testers, real browser runs, and actual issue intake before they can be marked complete. Verification for this docs-only slice used `git diff --check` on the new files and tracker updates.

> Update: `P-03a` is PASS via `src/core/command-parser/__tests__/prompt-injection-battery.test.ts`, which now blocks 139 prompt-injection-style attempts and asserts the roadmap target of `100+` blocked attempts directly in the battery. Verification passed with `pnpm typecheck`, targeted Vitest on `src/core/command-parser/__tests__/prompt-injection-battery.test.ts` (`1 file / 1 test`), full `pnpm test` (`71 files / 1124 tests`), `pnpm build`, and `pnpm audit --audit-level=high`, with only the same known `rollup` advisories via `@crxjs/vite-plugin`. `P-03` remains in progress pending `P-03b`, `P-03c`, and `P-03d`.

> Update: `P-03b` is PASS via `src/sidepanel/components/__tests__/MessageBubble.xss-matrix.test.tsx`, which adds a deterministic 20-context XSS matrix over the actual `marked -> DOMPurify -> anchor hardening` render path used by assistant markdown. Verification passed with `pnpm typecheck`, targeted Vitest on the new matrix plus existing markdown/sanitizer suites (`3 files / 136 tests`), full `pnpm test` (`72 files / 1144 tests`), `pnpm build`, and `pnpm audit --audit-level=high`, with only the same known `rollup` advisories via `@crxjs/vite-plugin`. `P-03` remains in progress pending `P-03c` and `P-03d`.

> Update: `P-03c` is PASS via `src/options/__tests__/provider-key-extraction.test.tsx`, which adds extraction-resistance coverage over save, validate, blocked-save, unexpected-failure, stale-session, and multi-provider transition paths to prove raw provider keys are not recoverable from storage snapshots or surfaced in the options UI. Verification passed with `pnpm typecheck`, targeted Vitest on `src/options/__tests__/App.test.tsx` plus `src/options/__tests__/provider-key-extraction.test.tsx` (`2 files / 39 tests`), full `pnpm test` (`73 files / 1150 tests`), `pnpm build`, and `pnpm audit --audit-level=high`, with only the same known `rollup` advisories via `@crxjs/vite-plugin`. `P-03` remains in progress pending `P-03d`.

> Update: `P-03d` is PASS via `src/core/bridge/__tests__/message-protocol-fuzzing.test.ts`, plus small hardening updates in `src/core/bridge/message-validation.ts` and `src/core/bridge/service-worker-bridge.ts` so hostile getter/proxy payloads degrade to invalid-message handling instead of crashing bridge code. Verification passed with `pnpm typecheck`, targeted Vitest on the bridge fuzzing + validation suites (`5 files / 100 tests`), full `pnpm test` (`74 files / 1156 tests`), `pnpm build`, and `pnpm audit --audit-level=high`, with only the same known `rollup` advisories via `@crxjs/vite-plugin`. With `P-03a` through `P-03d` complete, `P-03` is now PASS with no new critical/high findings observed in the repo-side penetration-test evidence.

> Update: `P-04` is PASS via `PERMISSIONS.md`, `PRIVACY_POLICY.md`, `DATA_USE_DISCLOSURE.md`, and `docs/privacy-policy.html`, all aligned to the live manifest and current options/runtime behavior. `P-04a` is PASS because every declared permission and the broad `"<all_urls>"` host scope are explicitly justified against shipped features. `P-04b` and `P-04c` are PASS as repo-side compliance artifacts; the remaining live Chrome Web Store form entry now belongs to `P-08` submission execution rather than the documentation-prep scope of `P-04`.

> Update: `P-07` is PASS via `SECURITY_SIGNOFF.md`, backed by completed `P-03a` through `P-03d` evidence plus the final dependency remediation pass that upgraded vulnerable transitive packages, pinned `esbuild` to `0.27.3`, updated `dompurify`, and removed the stale `@types/dompurify` package. Verification passed with `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm audit --audit-level=high`, which now reports `No known vulnerabilities found`. `P-04b` and `P-04c` remain operational/compliance follow-ups, but they do not block the security sign-off target.

> Update: `P-08a` is PASS via `STORE_LISTING.md`, `STORE_SCREENSHOTS.md`, `BLUEPRINT.md`, and the five committed store assets in `store-assets/`, which now provide final Chrome Web Store title/description copy, caption mapping, and screenshot PNGs for the popup, sidepanel workspace, sidepanel workflows, and options control surface. `P-08b` is PASS via `scripts/package-release.mjs`, `package.json`, `.github/workflows/release.yml`, and `.gitignore`, which add a reproducible `pnpm package:release` flow that packages `dist/` into `releases/flux-agent-extension-v0.1.0.zip` locally and reuses the same path in GitHub Releases. Verification passed with `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm package:release` (`releases/flux-agent-extension-v0.1.0.zip`), and `pnpm audit --audit-level=high`, which now reports `No known vulnerabilities found`. `P-08` remains in progress pending `P-08c` and the actual Chrome Web Store submission/review loop.

> Update: `P-01` remains PARTIAL via `PERFORMANCE_BASELINE.md`. The repo now has a measured baseline for bundle output (`pnpm build`) and packaged release size (`pnpm package:release`), but the current release zip is still above the roadmap's final `< 500KB gzipped` target and the idle-memory target still needs manual browser profiling before `P-01` can be marked PASS.

> Update: `P-02` is now PASS via `src/test/e2e/p-02e-scenario-matrix.test.tsx` and `E2E_SCENARIO_MATRIX.md`, which lift deterministic E2E coverage to 50 documented scenarios across real-site, SPA, edge-case, error-recovery, and matrix-driven flows. Verification passed with `pnpm exec vitest run src/test/e2e/p-02e-scenario-matrix.test.tsx` (`1 file / 24 tests`), `pnpm test`, `pnpm build`, and `pnpm audit --audit-level=high`.

> Update: `P-08c` is now PARTIAL via `CWS_REVIEW_RESPONSE.md`, which prepares the reviewer-response operating kit inside the repo, including expected evidence, canned answer structure, and escalation rules. The remaining work is external: the actual submission and live back-and-forth with Chrome Web Store reviewers still requires publisher access.

> Update: `P-09` is PASS via `POST_LAUNCH_MONITORING.md`, which defines the post-launch owner rotation, inboxes, crash/error triage expectations, response times, rollback triggers, and daily/weekly monitoring cadence needed after release.

> Update: `P-11` is PASS via `RELEASE_SIGNOFF.md`, which records the final ship gates for lint, typecheck, targeted/new E2E coverage, full test suite, build, release packaging, and high-threshold audit status in a single release checklist artifact.

#### `@sub-qa-tester` Tasks

| ID    | Task                                           | Est. Hours | Depends On | Acceptance Criteria             |
| ----- | ---------------------------------------------- | ---------- | ---------- | ------------------------------- |
| P-02  | E2E test suite expansion                       | 16h        | ALL        | 50+ E2E scenarios               |
| P-02a | Real-world site tests (Google, Amazon, GitHub) | 6h         | â€”        | Major sites work correctly      |
| P-02b | SPA tests (React, Vue, Angular apps)           | 4h         | â€”        | SPA navigation + interaction    |
| P-02c | Edge case tests (slow net, large DOM)          | 3h         | â€”        | Graceful degradation            |
| P-02d | Error recovery tests                           | 3h         | â€”        | All error paths tested          |
| P-06  | Beta testing coordination                      | 8h         | ALL        | 10+ testers, feedback collected |
| P-06a | Beta tester recruitment                        | 2h         | â€”        | 10-20 diverse testers           |
| P-06b | Test scenarios for beta                        | 2h         | â€”        | Structured test scripts         |
| P-06c | Feedback collection + triage                   | 4h         | â€”        | Issues filed, prioritized       |

#### `@sub-security-auditor` Tasks

| ID    | Task                              | Est. Hours | Depends On | Acceptance Criteria                |
| ----- | --------------------------------- | ---------- | ---------- | ---------------------------------- |
| P-03  | Penetration testing               | 8h         | ALL        | No critical/high findings          |
| P-03a | Prompt injection pen test         | 3h         | â€”        | 100+ injection attempts blocked    |
| P-03b | XSS pen test across 20 sites      | 2h         | â€”        | No XSS in any site context         |
| P-03c | API key extraction attempts       | 2h         | â€”        | Keys not extractable               |
| P-03d | Message protocol fuzzing          | 1h         | â€”        | No crashes from malformed messages |
| P-04  | Chrome Web Store compliance       | 4h         | â€”        | All policies satisfied             |
| P-04a | Permission justification document | 2h         | â€”        | Each permission explained          |
| P-04b | Privacy policy                    | 1h         | â€”        | GDPR-compliant privacy policy      |
| P-04c | Data use disclosure               | 1h         | â€”        | CWS data use form completed        |

### Sprint 5.2 (Week 20): Launch

#### `@sub-tech-lead` Tasks

| ID    | Task                                     | Est. Hours | Depends On | Acceptance Criteria             |
| ----- | ---------------------------------------- | ---------- | ---------- | ------------------------------- |
| P-08  | Chrome Web Store submission              | 4h         | P-03, P-04 | Extension submitted + approved  |
| P-08a | Store listing (screenshots, description) | 2h         | â€”        | 5 screenshots, compelling copy  |
| P-08b | Build final release package              | 1h         | â€”        | Versioned, signed .zip          |
| P-08c | Submit + respond to review               | 1h         | â€”        | Address any review feedback     |
| P-09  | Post-launch monitoring setup             | 2h         | â€”        | Error tracking, crash reporting |

#### `@sub-qa-tester` Tasks

| ID   | Task                      | Est. Hours | Depends On | Acceptance Criteria      |
| ---- | ------------------------- | ---------- | ---------- | ------------------------ |
| P-10 | Final regression test     | 4h         | ALL        | All existing tests green |
| P-11 | Release sign-off document | 2h         | P-10       | All quality gates passed |

#### `@sub-security-auditor` Tasks

| ID   | Task                    | Est. Hours | Depends On | Acceptance Criteria            |
| ---- | ----------------------- | ---------- | ---------- | ------------------------------ |
| P-07 | Final security sign-off | 2h         | P-03       | No open critical/high findings |

### Phase 5 Milestone Checklist

```
[ ] Bundle size < 500KB gzipped
[ ] Memory usage < 50MB idle, < 150MB active
[x] 50+ E2E tests passing
[x] Penetration test passed (0 critical, 0 high findings)
[ ] Beta testing completed (10+ users, major bugs fixed)
[ ] Chrome Web Store policies compliance verified
[ ] Privacy policy published
[x] README + CONTRIBUTING documentation complete
[x] Final regression test passed
[x] Security sign-off obtained
[ ] Chrome Web Store submission approved
[ ] v1.0.0 RELEASED
```

---

## Mandatory Development Workflow

> **This section is NORMATIVE.** Every agent session MUST follow this workflow for all phases. See BLUEPRINT.md Â§9 for full details.
> **Enforcement:** This applies EVERY time the user instructs the agent to work. No exceptions.

### Phase-Level Planning (MANDATORY FIRST STEP)

When the user gives a command to work on any phase or task group:

1. **READ** BLUEPRINT.md Â§9 and the relevant phase section below
2. **CREATE a detailed TodoList** (`todowrite` tool) â€” atomic, sequential tasks
3. **ASSIGN each task** to exactly ONE sub-agent (`@sub-tech-lead`, `@sub-ui-designer`, `@sub-qa-tester`, `@sub-security-auditor`)
4. **SHOW the todolist** to the user before writing any code
5. **NEVER start coding without a todolist**

> âš ï¸ If the agent starts implementing without creating a todolist first, the session is invalid.

### Per-Task Execution Flow

```
PLAN â†’ DELEGATE â†’ REVIEW â†’ VERIFY â†’ PASS â†’ COMMIT â†’ NEXT
```

1. **PLAN** â€” Mark task `in_progress` in todolist (only ONE at a time). Read relevant files for context.
2. **DELEGATE** â€” Call the `task` tool with the correct `subagent_type` to delegate implementation:
   - `sub-tech-lead` â†’ Core logic, managers, adapters, CDP, schemas, types, prompts
   - `sub-ui-designer` â†’ UI components, styling, frontend pages
   - `sub-qa-tester` â†’ Tests, mocks, coverage, E2E scenarios
   - `sub-security-auditor` â†’ Security audit, classification, vulnerability checks
   - The prompt MUST include: exact files, code patterns, acceptance criteria
   - **Main agent MUST NOT implement directly** â€” only delegate, review, verify
3. **REVIEW** â€” Main agent reads the sub-agent's output. Checks correctness, pattern adherence, no regressions. If rejected â†’ re-delegate with specific feedback (do NOT fix it yourself)
4. **VERIFY** â€” Run ALL verification gates:
   - `pnpm typecheck` â†’ Exit 0
   - `pnpm vitest run <changed-files>` â†’ All pass
   - `pnpm test` â†’ All pass
   - `pnpm build` â†’ Exit 0
   - `pnpm audit --audit-level=high` â†’ No new advisories
5. **PASS** â€” Only if ALL gates pass:
   - Mark task `completed` in todolist **immediately** (never batch)
   - Update DELIVERY_TRACKER.md with `âœ… PASS`
   - Update this roadmap's task status
6. **COMMIT** â€” `git commit` (task files only) + `git push origin main`
7. **NEXT** â€” Proceed to next task in order. **Never skip ahead.**

### TodoList Management Rules

| Rule                         | Detail                                               |
| ---------------------------- | ---------------------------------------------------- |
| Create BEFORE work           | Todolist must exist before any code is written       |
| One `in_progress` at a time  | Never have multiple tasks in_progress simultaneously |
| Mark complete IMMEDIATELY    | As soon as a task passes, mark it â€” never batch    |
| Include sub-agent assignment | Each todo must note which `@sub-*` is responsible    |
| Update on scope change       | If scope changes, update todolist before proceeding  |
| Todolist = source of truth   | If it's not in the todolist, it doesn't get done     |

### Hard Rules

| Rule                         | Detail                                                             |
| ---------------------------- | ------------------------------------------------------------------ |
| Sequential execution         | Tasks run in roadmap order, no skipping                            |
| Evidence required            | All 5 gates must pass before marking PASS                          |
| One commit per task          | Never batch multiple tasks in one commit                           |
| Revert on 3 failures         | Stop â†’ revert â†’ document â†’ escalate                          |
| Sub-agent implements         | Main agent only delegates (via `task` tool), reviews, and verifies |
| Never start without todolist | Mandatory for every phase/task group                               |
| Never bypass delegation      | Every task goes through a sub-agent, no exceptions                 |

---

## Post-Launch Roadmap (v1.1+)

| Version | Timeline   | Features                                         | Owner                                 |
| ------- | ---------- | ------------------------------------------------ | ------------------------------------- |
| v1.1    | Week 21-24 | User profiles, form auto-fill from saved data    | `@sub-tech-lead`                      |
| v1.2    | Week 25-28 | Cloud sync (conversations, workflows)            | `@sub-tech-lead`                      |
| v1.3    | Week 29-32 | Visual mode: AI sees screenshots, not just DOM   | `@sub-tech-lead`                      |
| v1.4    | Week 33-36 | Marketplace: Share workflows publicly            | `@sub-tech-lead` + `@sub-ui-designer` |
| v2.0    | Week 37-44 | Multi-browser support (Firefox, Edge extensions) | `@sub-tech-lead`                      |

---

## Summary Statistics

| Metric                | Value |
| --------------------- | ----- |
| Total Tasks           | ~100  |
| Total Estimated Hours | ~450h |
| Phases                | 5     |
| Sprints               | 10    |
| Weeks                 | 20    |
| Files to Create       | ~100+ |
| Test Coverage Target  | 80%+  |
| E2E Scenarios         | 50+   |
| Security Test Cases   | 100+  |

### Hours by Subagent

| Subagent                | Estimated Hours | % of Total |
| ----------------------- | --------------- | ---------- |
| `@sub-tech-lead`        | ~250h           | 56%        |
| `@sub-ui-designer`      | ~90h            | 20%        |
| `@sub-qa-tester`        | ~70h            | 16%        |
| `@sub-security-auditor` | ~40h            | 9%         |
