# Task 03 - Auth Strategy ADR for ChatGPT Plus / Codex Provider

## Status

Accepted

## Context

The current extension supports provider auth modes oriented around single-provider credentials such as API keys and GitHub OAuth. The project now wants an OpenCode-style provider that can use a ChatGPT Plus account with Codex access.

Task 01 documented the architectural gap between the extension and OpenCode-style account storage. Task 02 concluded that a public, stable, third-party Chrome extension auth flow was not confirmed, while experimental reuse of official account-backed auth artifacts remains technically plausible but high risk.

## Decision

- Continue the feature as `experimental`
- Introduce a new account-backed provider family instead of overloading `openai`
- Use provider code name `codex`
- Use auth family label `chatgpt-account`
- Enforce `official-auth-first` as a hard architecture rule
- Accept only an import or reuse model based on official client auth artifacts as the experimental fallback
- Reject cookie scraping, browser-session scraping, localStorage scraping, and anti-bot replay as implementation strategies

## Decision Drivers

- `openai` already means API-key-backed platform billing in this codebase
- ChatGPT Plus and Codex entitlement are not equivalent to a normal OpenAI API key
- The extension needs a model that can evolve toward a future official auth path without rewriting the provider surface again
- The vault and background runtime need stricter trust boundaries than a browser-session-driven design would allow
- Product copy must reflect the real risk and support level of the feature

## Provider Naming Strategy

### Provider Family

- Family: `chatgpt-account`
- Concrete provider name in code: `codex`
- UI label: `ChatGPT Plus / Codex (Experimental)`

### Naming Rules

- Do not overload `openai`
- Do not present this as API-key-backed access
- Keep room for a future official OpenAI extension auth path without breaking the account-backed provider identity

## Auth Strategy

### Primary Rule

- `official-auth-first`

If a public, supported extension-facing auth surface becomes available, the project should migrate to it.

### Accepted Experimental Path

- Import or reuse auth artifacts produced by official OpenAI or Codex clients
- Store only the minimum long-lived artifact required for refresh or revalidation
- Keep short-lived runtime session tokens in memory only

### Explicitly Rejected Paths

- Cookie scraping from browser storage or web pages
- Browser-session piggybacking on a logged-in ChatGPT tab
- localStorage or sessionStorage token scraping from the ChatGPT web app
- Anti-bot, fingerprint, MFA, or CAPTCHA replay

## Trust And Secret Boundaries

### UI Boundary

- Options and onboarding surfaces may trigger connect, import, validate, revoke, and refresh actions
- UI only receives masked metadata and status
- UI never receives raw artifacts, refresh material, or runtime access tokens

### Background Boundary

- The background runtime is the sole trusted owner of secrets
- All secret resolution, validation, token refresh, revocation, and quota refresh actions run in the background

### Storage Boundary

- Persist only encrypted long-lived account artifacts
- Persist non-secret metadata separately from secrets
- Keep runtime access tokens memory-only whenever possible
- Never persist cookies, browser session blobs, MFA material, or anti-bot state

## High-Level Data Flow

1. User opens the provider settings UI and selects `ChatGPT Plus / Codex (Experimental)`
2. User imports or connects an auth artifact produced by an official OpenAI/Codex client
3. Background verifies artifact shape and minimal entitlement viability
4. Vault stores encrypted long-lived artifact and masked metadata
5. Runtime resolves the active account and exchanges or refreshes a short-lived runtime token
6. Provider `codex` performs requests using the runtime token only
7. Quota, rate-limit, and entitlement status are cached as metadata
8. Revoke or remove wipes the stored artifact, metadata, and in-memory session cache

## Runtime Injection Point

The account-backed provider must resolve credentials before the provider instance enters the active chat path.

### Required Runtime Change

- `src/background/ui-session-runtime.ts`
  - Inject account and session resolution before provider switching and request execution
  - Ensure the current credential resolution path is upgraded to support account-backed providers

### Supporting Surfaces

- `src/background/credential-vault.ts`
- `src/shared/types/storage.ts`
- `src/shared/types/messages.ts`
- `src/shared/config/provider-registry.ts`
- `src/core/ai-client/provider-loader.ts`
- `src/core/ai-client/providers/`
- `src/options/App.tsx`

## Alternatives Considered

### Reuse `openai` Provider

- Rejected
- It would blur billing, auth, and entitlement semantics between API keys and ChatGPT-account-backed access

### Wait For Official Third-Party Extension OAuth Only

- Rejected for now
- It blocks all learning and implementation progress, though it remains the preferred future state

### Cookie Or Browser-Session Scraping

- Rejected
- Security, ToS, privacy, stability, and review risk are too high

### Cancel The Feature Entirely

- Rejected
- An experimental path still exists and can be isolated behind strong warnings and boundaries

## Consequences

### Positive

- Preserves a clean distinction between API-key providers and account-backed providers
- Creates a future-proof migration path toward official auth
- Keeps secret handling centralized in the background and vault

### Negative

- Feature must ship as experimental and unsupported by upstream
- Implementation complexity is higher than a plain provider addition
- Upstream auth changes may still break the flow

### Neutral

- Multiple systems must be upgraded together: types, vault, runtime, UI, messages, docs, and tests

## Scope After This ADR

### Task 04

- Expand type system for account-backed auth, account records, session state, quota state, and selection strategy

### Task 05

- Expand message contracts for connect, import, validate, revoke, auth status, and quota status

### Task 06

- Generalize the vault into an account-capable secure store

### Task 07

- Implement the ChatGPT-account auth artifact handling module

### Task 08

- Add manifest, identity, callback, or permission changes only if the chosen import or validation flow truly requires them

### Task 09

- Build a background account and session manager with refresh and rate-limit logic

### Task 10

- Add the `codex` provider adapter using short-lived runtime tokens

### Task 11

- Register the provider as a first-class selectable provider in the product

### Task 12

- Build the account-connect UI and account-state UX in Options

## Go / No-Go Gates

### Go

- The project can proceed without cookie or browser-session scraping
- The imported artifact comes from an official client flow
- Runtime access tokens can remain memory-only
- Privacy and security disclosures can be updated truthfully
- The provider remains clearly labeled as experimental

### No-Go

- The implementation requires cookie scraping or browser-session reuse
- The implementation requires localStorage or sessionStorage scraping from ChatGPT pages
- The implementation requires long-lived persistence of browser session secrets
- The implementation depends on anti-bot or fingerprint replay
- The implementation cannot validate entitlement or token stability at all

## Task 04 Recommendation

Task 04 should lock the schema before any runtime work starts.

### Immediate Type-System Direction

- Add a new provider auth method for account import
- Add new auth kinds for account artifacts and runtime session tokens
- Split provider account records from provider credential records
- Add quota, rate-limit, entitlement, and active-account metadata types
- Design backward-compatible storage migration so current API-key and OAuth-token providers continue to work unchanged
