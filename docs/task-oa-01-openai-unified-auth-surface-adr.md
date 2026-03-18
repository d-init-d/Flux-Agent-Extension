# OA-01 - OpenAI Unified Auth Surface ADR

## Status

Accepted

## Scope

This ADR locks the phase-1 product and architecture contract for the `OpenAI Unified Auth Surface` initiative.

It is intentionally limited to:

- provider/auth UX semantics
- helper/deep-link browser-login direction
- migration semantics from legacy `codex`
- MVP vs later backlog boundaries

It does not change runtime code, UI code, manifests, or storage schemas by itself.

## Context

The repo already has a working API-key-backed `openai` path and a separately introduced account-backed `codex` path.

That split was useful when the project needed to keep ChatGPT-account-backed access clearly separate from API-key semantics. However, the next initiative phase wants a simpler user-facing shape:

- users choose `OpenAI`
- users then choose one of exactly 2 login methods

Official OpenAI guidance also separates ChatGPT billing/subscription semantics from platform API billing. That means the product cannot collapse all OpenAI access into one vague "OpenAI account" concept without creating UX ambiguity and future migration risk.

At the same time, this phase still does not want to take on:

- headless login
- extension-owned OAuth callback pages
- `chrome.identity` / `oauth2` expansion
- scraping cookies, browser tabs, `localStorage`, or `sessionStorage`

## Decision

### 1) Product surface lock

`OpenAI` is the single primary provider surface for this ecosystem in the UX for this initiative.

Under `OpenAI`, the product must show exactly 2 auth choices:

1. `ChatGPT Pro/Plus (browser)`
2. `Manually enter API Key`

No third option is allowed in this phase.

### 2) Internal auth-lane lock

The product surface is unified, but the implementation must keep two distinct internal auth lanes:

- `openai + api-key`
- `openai + browser-account`

The extension must not treat these as interchangeable just because they sit under the same provider label.

### 3) Browser-login transport lock

The browser-account lane uses a helper/deep-link flow in this phase.

This phase explicitly excludes:

- headless login
- full extension-owned OAuth callback handling
- extension-managed browser auth windows as the primary flow

### 4) Legacy migration lock

Existing `codex` account-backed state is treated as legacy compatibility state that should migrate toward `openai + browser-account`.

`codex` may remain internally during migration, but it should no longer define the intended long-term primary UX surface.

## UX Contract

### Provider surface vs internal auth lanes

The UX contract is:

- `Provider = OpenAI`
- `Login method = ChatGPT Pro/Plus (browser)`
- `Login method = Manually enter API Key`

The architecture contract is:

| Concern                    | `openai + api-key`          | `openai + browser-account`                              |
| -------------------------- | --------------------------- | ------------------------------------------------------- |
| User-facing provider       | `OpenAI`                    | `OpenAI`                                                |
| User-facing auth label     | `Manually enter API Key`    | `ChatGPT Pro/Plus (browser)`                            |
| Billing semantics          | OpenAI platform/API billing | ChatGPT plan/account entitlement                        |
| Stored long-lived material | encrypted API key           | encrypted minimal account artifact / refresh material   |
| Runtime material           | API key                     | memory-only session/runtime token                       |
| Model policy               | platform/API models         | account-backed models                                   |
| Readiness rule             | key saved + validated       | helper login complete + account valid + session healthy |

The provider surface may be unified, but the semantics are not. Storage, validation, runtime resolution, and model availability must remain auth-aware.

### Why billing/API-key semantics must not be overloaded

The product must not imply that a ChatGPT Pro/Plus account is the same thing as an OpenAI API key.

Reasons:

- OpenAI documents ChatGPT billing and platform API billing as separate systems.
- A user can have ChatGPT entitlement without having an API key.
- A user can have an API key without ChatGPT Pro/Plus entitlement.
- Model availability, quota behavior, and failure states differ between the two lanes.
- Collapsing them into one ambiguous `OpenAI account` concept would create misleading copy and fragile runtime assumptions.

The UI can be simpler without becoming semantically vague.

## Why Helper/Deep-Link Wins This Phase

### Chosen direction: helper/deep-link

The selected direction is a helper/deep-link browser-login flow where:

1. the extension initiates login for `ChatGPT Pro/Plus (browser)`
2. a helper or deep-link handoff opens the official browser login path
3. the resulting minimal long-lived account material returns to the trusted background boundary
4. the vault stores encrypted long-lived state
5. runtime-only session material stays memory-only

The helper/deep-link path is only acceptable if the background validates provenance before persisting anything. At minimum, the browser-login handoff must be bound to an extension-initiated request `state`/nonce and rejected if the response cannot be matched to that request.

### Rejected for this phase: headless

Headless login is out of scope because it adds higher fragility, larger anti-bot risk, worse supportability, and more ambiguity about what the product is actually automating.

### Rejected for this phase: full extension-owned OAuth callback

Full extension-owned OAuth/callback handling is out of scope because it would force broader auth surface ownership now:

- callback pages
- redirect URI/state/PKCE lifecycle
- potential `chrome.identity` / manifest changes
- a larger review and security burden before the UX contract is even stabilized

The helper/deep-link path gives a narrower, phase-appropriate boundary while preserving a future path toward a more official browser auth contract later.

## Migration Semantics: `codex` -> `openai + browser-account`

Migration in this initiative means the product changes its primary surface, not that account-backed state disappears.

Required migration semantics:

- existing encrypted `codex` account artifacts remain valid migration input
- the product should map compatible legacy account-backed state to `openai + browser-account`
- migration must preserve secret-boundary rules: encrypted long-lived state in vault, memory-only runtime tokens
- the UI should stop presenting `codex` as the preferred first-run provider once the migration bridge lands
- legacy compatibility may remain temporarily in registry/runtime code while rollout completes

This is a surface migration with compatibility preservation, not a destructive auth reset.

## Security And Trust-Boundary Rules

The earlier auth ADR security boundaries remain in force.

This phase specifically keeps these rules locked:

- no cookie scraping
- no reuse of logged-in ChatGPT tabs as the auth mechanism
- no `localStorage` / `sessionStorage` scraping
- no persistence of short-lived runtime session tokens
- no raw helper payloads or raw secrets exposed to options/popup/sidepanel UI
- no headless auth in this phase
- no helper/deep-link payload may be written into the vault until the background verifies provenance and matches the response to an extension-issued request `state`/nonce

## MVP vs Later Backlog

### MVP

- one primary `OpenAI` provider surface
- exactly two auth choices under `OpenAI`
- helper/deep-link browser login contract
- auth-aware readiness and model policy
- background-owned runtime unification for API key vs browser-account
- legacy `codex` migration bridge
- docs and regression coverage aligned with the new contract

### Later backlog

- headless login
- full extension-owned OAuth/callback handling
- richer multi-account switching
- deeper entitlement/model discovery
- removal of remaining legacy `codex` compatibility once migration is complete

## Consequences

### Positive

- product UX becomes simpler without hiding auth differences
- roadmap work can proceed against a locked two-choice contract
- migration from `codex` has a clear destination shape
- future auth work can evolve without pretending API keys and ChatGPT plans are the same thing

### Negative

- implementation must support one provider surface with multiple auth lanes
- model policy and readiness policy become more explicit and therefore more complex
- helper/deep-link coordination still needs a careful trust-boundary design in OA-03

## Execution Notes For Follow-Up Tasks

- OA-02 should implement multi-auth provider surface primitives without reintroducing a separate primary `codex` UX.
- OA-03 should define the helper/deep-link payload, background trust checks, and user-visible error states.
- OA-08 should focus on safe migration semantics before the UI fully removes `codex` from first-run flows.

## Resulting Lock For This Phase

Until a later ADR explicitly changes direction, the initiative is locked to:

- exactly 2 `OpenAI` auth choices
- helper/deep-link browser login for the account-backed lane
- no headless login
- no full extension-owned OAuth callback flow in this phase
