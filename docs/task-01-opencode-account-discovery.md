# Task 01 - OpenCode Account Discovery

## Goal

Understand how an OpenCode-style account-backed provider differs from the current extension architecture so the project can add a ChatGPT Plus / Codex-capable provider without forcing API keys.

## Scope And Evidence

This discovery pass is based on the current extension codebase plus local OpenCode and Antigravity reference material available on this machine.

### Extension Files Reviewed

- `src/background/ui-session-runtime.ts`
- `src/background/credential-vault.ts`
- `src/shared/crypto/secure-storage.ts`
- `src/shared/types/storage.ts`
- `src/shared/types/messages.ts`
- `src/shared/config/provider-registry.ts`
- `src/core/ai-client/manager.ts`
- `src/core/ai-client/provider-loader.ts`
- `src/core/ai-client/providers/openai.ts`
- `src/core/ai-client/providers/copilot.ts`
- `src/core/auth/github-device-flow.ts`
- `src/options/App.tsx`
- `src/shared/extension-client.ts`

### OpenCode / Antigravity References Reviewed

- `C:\Users\dmn05\.config\opencode\opencode.json`
- `C:\Users\dmn05\.config\opencode\plugins\antigravity-sync.ts`
- `C:\Users\dmn05\.config\opencode\antigravity-accounts.json`
- `C:\Users\dmn05\.config\opencode\antigravity.json`
- `C:\Users\dmn05\.config\opencode\AGENTS.md`

## Current Extension Architecture

### Message And Runtime Flow

- UI surfaces call `sendExtensionRequest()` from `src/shared/extension-client.ts`.
- The service worker routes requests in `src/background/ui-session-runtime.ts`.
- Provider settings, vault actions, validation, and chat requests all flow through the same runtime router.

### Provider Model

- Providers are first-class entries in `src/shared/config/provider-registry.ts`.
- Provider instances are created by `src/core/ai-client/provider-loader.ts`.
- Runtime switching is handled inside `src/core/ai-client/manager.ts`.
- Concrete providers like `src/core/ai-client/providers/openai.ts` assume a direct credential in config.

### Credential Model

- Long-lived secrets are stored through `src/background/credential-vault.ts`.
- Encrypted secret storage is implemented by `src/shared/crypto/secure-storage.ts`.
- Storage metadata is defined in `src/shared/types/storage.ts`.
- The current vault model is oriented around one credential record per provider.

## Current Auth Surface

### Supported Auth Types Today

- `src/shared/config/provider-registry.ts` supports `api-key`, `oauth-github`, and `none`.
- `src/shared/types/storage.ts` supports `api-key`, `oauth-token`, and `none` at the stored credential level.
- There is no native account-based auth type for refresh-token or session-backed providers.

### Existing UI Behavior

- `src/options/App.tsx` renders an API key form for `api-key` providers.
- `src/options/App.tsx` renders a GitHub OAuth device-flow UI for `oauth-github` providers.
- There is no account inventory, account switching, entitlement view, quota view, or session refresh UI.

### Existing OAuth-Like Reference

- `src/core/auth/github-device-flow.ts` is the best in-repo reference for a login flow that obtains a long-lived token and exchanges it for a short-lived provider token.
- `src/core/ai-client/providers/copilot.ts` is the best in-repo reference for per-request token refresh before chat requests.

## OpenCode / Antigravity Observations

### Provider Setup Pattern

- `C:\Users\dmn05\.config\opencode\opencode.json` enables `opencode-antigravity-auth@beta`.
- The provider configuration shown in `opencode.json` does not store a static API key for the account-backed flow.
- This suggests auth is handled outside the plain provider config surface.

### Account Store Pattern

- `C:\Users\dmn05\.config\opencode\antigravity-accounts.json` stores accounts rather than one credential per provider.
- Each account record contains fields such as:
  - `email`
  - `refreshToken`
  - `managedProjectId`
  - `lastUsed`
  - `enabled`
  - `rateLimitResetTimes`
  - `cachedQuota`
  - `fingerprint`

### Scheduling And Rotation Pattern

- `C:\Users\dmn05\.config\opencode\plugins\antigravity-sync.ts` shows account-management concepts such as:
  - `activeIndex`
  - `activeIndexByFamily`
  - selection strategies like `sticky`, `hybrid`, and `round-robin`
- `C:\Users\dmn05\.config\opencode\antigravity.json` stores strategy and debug flags.

### Quota And Rate-Limit Pattern

- Account records contain cached quota snapshots and reset times.
- Rate-limit tracking is attached to model families, not just a single provider key.
- This is a much richer model than the extension currently uses.

## Data Model Comparison

| Concern | Extension Today | OpenCode / Antigravity Reference | Gap |
| --- | --- | --- | --- |
| Provider credential | One record per provider | Many accounts with metadata | Needs account-store abstraction |
| Secret type | API key or OAuth token | Refresh token plus account metadata | Needs new auth kind |
| Rotation | None | Strategy-based selection | Needs scheduler |
| Quota tracking | Generic provider health only | Per-account cached quota and reset times | Needs quota model |
| Session refresh | Minimal, provider specific | Account-backed lifecycle implied | Needs session manager |
| UI | Save one credential | Connect, inspect, rotate, validate accounts | Needs account UI |

## Gap Analysis

- The extension does not support an account-backed provider auth kind.
- The extension does not have a multi-account store with metadata and health.
- The extension does not have a scheduler for account selection or family-aware routing.
- The extension does not expose quota, entitlement, or rate-limit status in storage or UI.
- The provider runtime is built around `AIModelConfig.apiKey`, not account resolution.
- The message contract lacks commands for login start, auth callback completion, account status, logout, quota refresh, and rotation strategy.
- The options page assumes one provider maps to one saved credential.
- The best runtime token-refresh reference is `copilot`, but it is still single-account and provider-specific.
- OpenCode account references are available locally, but the actual `opencode-antigravity-auth@beta` source is not present in this workspace.
- There appears to be a risk that the current extension runtime does not fully wire stored credentials into every chat path yet, which must be validated before layering on account auth.

## Session And Token Lifecycle Boundaries

### Confirmed

- OpenCode locally stores account-style metadata and refresh-like secrets.
- The extension already has secure encrypted storage and one OAuth-like implementation.
- The extension can already validate and persist provider credentials through background messages.

### Not Yet Confirmed

- The exact exchange path from an OpenCode / Antigravity refresh token into a Codex-usable access or session token.
- Whether ChatGPT Plus / Codex support for an extension can rely on an official OAuth or identity surface.
- Whether the implementation must depend on a browser session or a non-public account flow.

## Required Artifacts For Implementation

### Data Types

- `ChatGPTAccountRecord`
- `ChatGPTAccountQuota`
- `ChatGPTProviderState`
- `ChatGPTSessionToken`
- `AccountSelectionStrategy`

### Background Surfaces

- Start login
- Complete callback
- Get auth status
- Refresh session token
- List accounts
- Set active strategy
- Remove account
- Logout account
- Refresh quota status

### Storage Surfaces

- Encrypted account secrets
- Non-secret account metadata
- Token expiry state
- Entitlement state
- Rate-limit and quota cache

## Risks And Open Questions

- The actual auth plugin source for OpenCode is not locally available, so some lifecycle details are still inferred from config and stored account data.
- The machine has multiple Antigravity-related storage locations and schema versions documented across files, so the source of truth must be chosen explicitly.
- `refreshToken`-style account data is far more sensitive than an API key; direct file import or sync must be designed carefully.
- If ChatGPT Plus / Codex requires a non-public or browser-session-based flow, security, stability, and ToS risk all increase.
- The provider family boundary is still open: the project may need a dedicated `opencode` or `chatgpt-account` provider rather than overloading `openai`.

## Proposed Exit Criteria For Task 01

- The current extension auth architecture is documented.
- The OpenCode / Antigravity account model is documented from available evidence.
- The gaps between both systems are listed clearly.
- The unknowns that block implementation are listed explicitly.
- The next task can move into feasibility analysis with a stable discovery baseline.
