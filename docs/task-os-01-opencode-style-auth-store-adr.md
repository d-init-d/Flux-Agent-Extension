# OS-01: OpenCode-Style Auth Store ADR

**Status:** Accepted  
**Date:** 2026-03-19  
**Scope:** Replace the current user-facing vault/passphrase UX with an extension-owned app-managed auth store while preserving the shipped OpenAI dual-auth surface.

---

## Decision

Flux will move away from a user-facing passphrase-backed vault UX and toward an app-managed auth store that behaves closer to OpenCode's local auth persistence model.

For this Chrome extension, the closest equivalent is an extension-owned durable auth store in `chrome.storage.local`.

This ADR locks the following product and architecture rules:

1. The primary UX no longer exposes `Initialize vault`, `Unlock vault`, or passphrase entry as normal setup steps.
2. `OpenAI` remains the primary provider surface with exactly 2 auth choices:
   - `ChatGPT Pro/Plus (browser)`
   - `Manually enter API Key`
3. Durable long-lived auth material persists in extension-owned local storage.
4. Short-lived runtime/session/access tokens remain memory-only or session-only.
5. The background remains the only trusted owner of secrets.
6. UI surfaces receive masked metadata and status only; they must never receive raw secrets.
7. `chrome.storage.sync` is never used for secrets.
8. Helper/deep-link provenance and request binding checks remain mandatory before persistence.

---

## Why This Direction

The current vault/passphrase model is safer against some local-at-rest risks, but it adds too much friction for the intended product experience.

The target UX should feel closer to OpenCode:

- simple auth setup
- no vault jargon in the normal flow
- persistent local auth without a user-managed passphrase ceremony
- background-owned trust boundaries and sanitized UI state

This is a usability-first decision, not a claim of stronger local-at-rest protection.

---

## Security Trade-off

This initiative reduces user friction, but it weakens local-at-rest protection compared with a passphrase-protected vault.

The team must document this honestly:

- convenience improves
- local compromise blast radius increases
- the model is not equivalent to a user-held passphrase vault
- the model is not equivalent to an OS keychain/native secure enclave

This is acceptable only if the following remain true:

- background-only secret ownership
- no raw helper payloads or callback material in UI-facing state
- no persistence of short-lived runtime/session tokens
- no cookie scraping, localStorage scraping, sessionStorage scraping, or logged-in-tab piggybacking
- no browser-account secret sync through Chrome account storage

---

## Trust Boundary

### Trusted owner

The background service worker is the only trusted owner of durable auth material and runtime token derivation.

### Untrusted/limited surfaces

The following surfaces only receive sanitized state:

- Options
- Onboarding
- Popup
- Sidepanel

These surfaces may render:

- masked identifiers
- provider/account status
- validation timestamps
- helper availability state

They may not receive:

- raw API keys
- raw account artifacts
- raw helper payloads
- callback URLs
- `requestId` / `state` / `nonce`
- refresh material
- access/session tokens

---

## Migration Rule

This transition is non-destructive and staged.

1. Add the new app-managed auth store first.
2. Read the new auth store first.
3. Fall back to the existing vault-backed store only when the new store has no equivalent data.
4. New writes go only to the new auth store once the migration bridge lands.
5. Legacy vault UX/code is removed only after the bridge is stable and covered by regression tests.

This ADR explicitly rejects a destructive one-shot rewrite of all stored secrets.

---

## Relationship To Existing OpenAI Work

This ADR does not change the shipped OpenAI auth surface contract:

- `ChatGPT Pro/Plus (browser)` remains helper/deep-link based
- `Manually enter API Key` remains the API-key lane
- auth-aware model routing remains in place
- the legacy `codex -> openai + browser-account` bridge remains valid

What changes is the storage and readiness model behind those flows.

---

## Explicitly Out Of Scope

- headless login
- full extension-owned OAuth callback redesign
- native OS keychain integration
- `chrome.storage.sync` secrets
- claiming parity with the old vault's at-rest protection
- immediate deletion of all vault code before migration stabilizes

---

## Acceptance Checks

OS-01 is complete when:

1. `ROADMAP.md` marks OS-01 as done and points to this ADR.
2. `BLUEPRINT.md` reflects the app-managed auth-store direction and trust boundary accurately.
3. The docs clearly state the security trade-off instead of implying vault-equivalent protection.
