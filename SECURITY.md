# Security Architecture & Threat Model

> **Version:** 1.1.0
> **Last Updated:** 2026-03-17
> **Classification:** Internal - Security Sensitive
> **Owner:** @sub-security-auditor

---

## Table of Contents

1. [Threat Model](#1-threat-model)
2. [Current Permission Profile](#2-current-permission-profile)
3. [Credential Vault Model](#3-credential-vault-model)
4. [Sensitive Action Protections](#4-sensitive-action-protections)
5. [Prompt Injection and Content Handling](#5-prompt-injection-and-content-handling)
6. [Data Handling Policies](#6-data-handling-policies)
7. [Current Control Status](#7-current-control-status)
8. [Release Expectations](#8-release-expectations)
9. [Secure Defaults](#9-secure-defaults)

---

## 1. Threat Model

### 1.1 Primary Attack Surfaces

- Provider API traffic and credential handling
- Untrusted web pages inspected or automated by the extension
- Background debugger access used for advanced browser control
- Extension message passing between popup, side panel, options, background, and content scripts
- Local persistence for settings, recordings, and workflow metadata

### 1.2 Highest-Risk Scenarios

| ID | Threat | Severity | Current Mitigation |
|----|--------|----------|--------------------|
| T1 | Credential theft from local storage | HIGH | Background-owned encrypted credential vault, masked metadata only in normal storage |
| T2 | Prompt injection from hostile page content | HIGH | Sanitized page-context pipeline, structured action parsing, explicit action allowlist |
| T3 | Arbitrary script execution on pages | HIGH | `evaluate` disabled by default, gated behind `Advanced mode` and custom-script permission |
| T4 | Over-broad browser control via debugger | HIGH | Session-scoped debugger attachment, action-level routing, explicit high-risk audit metadata |
| T5 | Sensitive page interaction (passwords, payments, submits) | HIGH | Password interaction off by default, action sensitivity checks, confirmation-oriented defaults |
| T6 | Legacy secret leakage from pre-vault storage keys | MEDIUM | Automatic migration from `encryptedKeys` and `providerSessionApiKeys` into the vault |

### 1.3 Security Posture Summary

The current build favors explicitness over convenience:

- Provider credentials are resolved in the background runtime, not from UI-local state.
- The shipped action surface is centralized so prompt, parser, runtime, and message allowlists stay aligned.
- High-risk script execution is opt-in twice: first through `Advanced mode`, then through the custom-script permission.

---

## 2. Current Permission Profile

### 2.1 Manifest Permissions

| Permission | Required Today | Risk Level | Why It Exists |
|-----------|----------------|------------|---------------|
| `activeTab` | YES | LOW | Operate on the user-selected active tab |
| `tabs` | YES | MEDIUM | Track, switch, and manage session tab targets |
| `scripting` | YES | MEDIUM | Inject and coordinate content-script helpers |
| `storage` | YES | LOW | Persist settings, workflows, and encrypted vault metadata |
| `sidePanel` | YES | LOW | Main Flux control surface |
| `debugger` | YES | HIGH | CDP-backed actions such as screenshots, device emulation, PDF, keyboard events, and `evaluate` |
| `webNavigation` | YES | MEDIUM | Navigation state tracking and recording |
| `downloads` | YES | LOW | Export recordings, screenshots, and generated PDFs |

### 2.2 Host Permissions

The shipped manifest currently declares:

```json
{
  "host_permissions": ["<all_urls>"]
}
```

This is broader than an ideal least-privilege profile, but it matches the current product surface: Flux can inspect and automate the active page across arbitrary sites. Documentation and store disclosure must continue to reflect that broad host access.

### 2.3 Security Implications

- `debugger` is not optional in the current shipped manifest. Treat it as a privileged capability that must remain tightly routed through background handlers.
- `<all_urls>` is the current source of truth. Any documentation claiming narrower host access is inaccurate.
- Provider credentials and browser-automation privileges are intentionally separated: normal settings storage can describe providers, but only the vault can hold provider secrets.

---

## 3. Credential Vault Model

### 3.1 Current Architecture

Provider credentials are managed by the background-owned `CredentialVault`.

- Encrypted credential payloads are stored in `chrome.storage.local` through `SecureStorage`.
- Vault metadata in normal storage contains only record metadata such as provider, auth kind, mask, timestamps, and stale/validated state.
- Unlock state is cached per browser session in `chrome.storage.session` and in background memory.
- Options and popup flows use background messages such as `VAULT_INIT`, `VAULT_UNLOCK`, `API_KEY_SET`, and `API_KEY_VALIDATE`; they do not write raw secrets to local settings storage.
- GitHub Copilot OAuth tokens follow the same vault path as API-key providers.

### 3.2 Operational Rules

1. Raw provider secrets must never be written into plain extension settings.
2. Errors and validation messages must not echo provider secrets back into UI state.
3. The vault must be unlocked before key-based providers are validated or used at runtime.
4. Legacy secrets in `encryptedKeys` or `providerSessionApiKeys` must be migrated and then removed.
5. Runtime provider initialization must resolve `provider config + decrypted credential + endpoint` together; there is no supported path that uses a key-based provider without resolving the vault first.

### 3.2.1 Codex Account-Backed Boundary

- `codex` is an `experimental` provider and does not use the normal API-key setup path.
- The current implementation imports an official ChatGPT/Codex auth artifact into the vault, validates the artifact locally, and hydrates runtime access tokens only inside the background session manager.
- Popup, sidepanel, and options surfaces receive masked state and health metadata through background messages; they do not store raw artifact bodies, refresh tokens, or live session tokens.
- Runtime session material is cached in background memory and cleared when the vault is locked, the account is revoked, or the runtime snapshot is no longer trusted.
- Live refresh is intentionally deferred to the official client flow; stale or expired artifacts require re-import rather than extension-owned token exchange.

### 3.3 Credential Record Shape

```typescript
interface ProviderCredentialRecord {
  version: 1;
  provider: AIProviderType;
  authKind: 'api-key' | 'oauth-token' | 'none';
  maskedValue: string;
  updatedAt: number;
  validatedAt?: number;
  stale?: boolean;
}
```

`maskedValue` is UI-facing metadata only. It is never treated as a usable credential.

---

## 4. Sensitive Action Protections

### 4.1 Standard Versus High-Risk Actions

Most browser actions execute through the standard automation surface. The current build treats `evaluate` as the clearest high-risk capability.

| Action Area | Default State | Protection |
|-------------|---------------|------------|
| `click`, `fill`, `extract`, `scroll`, screenshots | Enabled through normal execution flow | Structured schemas, runtime validation, content-script routing |
| `press`, `hotkey` | Enabled | Routed through background keyboard handling for stability |
| `evaluate` | Disabled by default | Requires `Advanced mode` and `allowCustomScripts`, runs through debugger runtime, result size capped and JSON-safe |
| Password interaction | Disabled by default | `allowPasswordInteraction` remains false in secure defaults |
| Purchase/submit flows | Confirmation-oriented defaults | `requireConfirmForPurchase` and `requireConfirmForSubmit` stay true |

### 4.2 Evaluate-Specific Rules

- Parser capability: `evaluate` is only allowed when the advanced-mode gate is active.
- Runtime capability: the background runtime rejects `evaluate` unless both `debugMode` (used as the advanced-mode flag) and `allowCustomScripts` are enabled.
- Execution path: `evaluate` runs through the debugger-backed runtime path, not directly through UI code.
- Output handling: results are serialized into JSON-safe values and truncated to a maximum preview size before UI logging.
- Audit trail: action-progress events, stored action history, and recording exports mark `evaluate` as `high risk` with an explicit reason.

### 4.3 Recording and Export Expectations

- JSON recording exports preserve `riskLevel` and `riskReason` metadata.
- Playwright and Puppeteer exports emit explicit warnings when a recording includes `evaluate`.
- Any future automation surface that replays exported recordings must preserve those warnings instead of silently stripping them.

---

## 5. Prompt Injection and Content Handling

### 5.1 Defense Layers

- Page content is sanitized before it becomes AI-visible context.
- AI outputs are parsed into structured actions instead of executing free-form text.
- The shipped action surface is centralized in shared config, then reused by the system prompt, Zod schemas, and runtime handlers.
- Blocked browser surfaces such as internal browser pages remain outside the normal automation path.

### 5.2 Current Guarantees

- The system prompt does not advertise actions that the shipped runtime does not support.
- The message allowlist is derived from shared config instead of being maintained as a separate hand-written list.
- Custom scripting stays opt-in and visibly risky rather than blending into ordinary actions.

---

## 6. Data Handling Policies

### 6.1 Data Classification

| Data Type | Classification | Storage | Sent to AI? | Notes |
|-----------|----------------|---------|-------------|-------|
| Provider credentials | SECRET | Encrypted vault only | Never | Includes API keys, Copilot OAuth tokens, and Codex auth artifacts |
| Vault metadata | INTERNAL | `chrome.storage.local` | Never | Masked record metadata only |
| Unlock state | SENSITIVE | `chrome.storage.session` + memory | Never | Cleared when the session is locked or browser session ends |
| Chat/session content | PRIVATE | Local extension storage | Yes, selectively | Depends on user request and provider flow |
| Page context | CONTEXTUAL | Memory and session pipeline | Yes, sanitized | Used to ground automation requests |
| Action logs and recordings | INTERNAL | Local extension storage / downloads | No | `evaluate` entries marked high risk |

For Codex specifically, imported auth artifacts are treated as `SECRET` vault-only material even though the runtime consumes them as account-backed session input rather than as a conventional API key.

### 6.2 Handling Rules

- Send only the minimum page context needed to satisfy the active task.
- Do not copy raw secrets into logs, errors, or exported artifacts.
- Keep screenshots opt-in by default for provider context.
- Treat exported recordings as user-owned artifacts; include security metadata instead of silently dropping risky steps.

---

## 7. Current Control Status

### Implemented Controls

- [x] Encrypted credential vault with background-owned access path
- [x] Legacy secret migration from pre-vault storage keys
- [x] Secret-safe provider validation and masked UI metadata
- [x] Centralized provider/action/message config reused across runtime surfaces
- [x] Advanced-mode gate for `evaluate` and custom scripts
- [x] High-risk annotations for `evaluate` in logs and recording exports
- [x] Prompt-injection, XSS, and message-fuzzing automated test coverage

### Still Requires Ongoing Attention

- [ ] Review whether the shipped manifest can narrow `debugger` or host scope without regressing core features
- [ ] Keep store disclosure and docs aligned with the current broad host-permission model
- [ ] Keep Codex docs aligned with the current import-only flow; do not describe manifest, callback, or extension-owned refresh behavior that does not exist yet
- [ ] Continue reducing non-critical lint warnings before final release sign-off
- [ ] Re-run dependency audit before every release candidate

---

## 8. Release Expectations

Before calling a build release-ready:

1. `pnpm typecheck` must pass.
2. `pnpm test` must pass.
3. `pnpm build` must pass.
4. `pnpm lint` must not introduce new warnings in touched areas.
5. Store documentation must match the current manifest, vault model, and advanced-mode behavior.
6. Dependency audit must show no new `high` or `critical` findings.

Codex-specific release notes must also stay honest about these current boundaries:

- `experimental` provider status
- account-backed artifact import instead of API-key auth
- no manifest/auth-callback change in the current flow
- vault/background secret boundary and memory-only runtime session hydration
- recovery via re-import + validate when sessions are stale, expired, revoked, or refresh-required

---

## 9. Secure Defaults

```typescript
const SECURE_DEFAULTS: ExtensionSettings = {
  includeScreenshotsInContext: false,
  streamResponses: true,
  maxContextLength: 8000,
  allowCustomScripts: false,
  defaultTimeout: 10000,
  maxRetries: 2,
  allowedDomains: [],
  blockedDomains: ['chrome://*', 'chrome-extension://*', 'about:*'],
  requireConfirmForPurchase: true,
  requireConfirmForSubmit: true,
  allowPasswordInteraction: false,
  conversationRetentionDays: 30,
  actionLogRetentionDays: 7,
  debugMode: false,
  logNetworkRequests: false,
};
```

`debugMode: false` is also the default `Advanced mode` posture. In the current implementation, `allowCustomScripts` must remain false unless advanced mode is explicitly enabled.
