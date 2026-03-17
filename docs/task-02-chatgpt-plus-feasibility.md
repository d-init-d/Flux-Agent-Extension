# Task 02 - ChatGPT Plus / Codex Feasibility

## Goal

Assess whether a third-party Chrome extension can add an OpenCode-style provider backed by a ChatGPT Plus account with Codex access, and determine whether the path is official, unsupported, or not currently viable.

## Final Verdict

- Official third-party Chrome extension auth path: `not-currently-feasible`
- Unofficial account-token or auth-cache reuse: `feasible-unofficial-high-risk`
- Browser session or cookie reuse: `feasible-unofficial-high-risk`, but less acceptable than token import or auth-cache reuse

## Key Conclusion

There is clear evidence that Codex supports ChatGPT-account-backed authentication for first-party clients such as the Codex CLI and IDE integrations. There is not enough evidence for a public, documented, stable auth flow intended for a third-party Chrome extension.

If this project must support ChatGPT Plus / Codex before an official extension-facing auth program exists, the safest technical direction is an explicitly experimental account-token import or auth-cache reuse model. Cookie or browser-session scraping should not be the default path.

## Evidence Reviewed

### Official OpenAI Documentation

- `https://developers.openai.com/codex/auth/`
- `https://developers.openai.com/codex/cli/`
- `https://developers.openai.com/codex/ide/`
- `https://developers.openai.com/codex/pricing/`
- `https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan`
- `https://help.openai.com/en/articles/9039756-billing-settings-in-chatgpt-vs-platform`

### OpenAI Codex Source References

- `https://github.com/openai/codex/blob/main/codex-rs/login/src/server.rs`
- `https://github.com/openai/codex/blob/main/codex-rs/login/src/device_code_auth.rs`
- `https://github.com/openai/codex/blob/main/codex-rs/cli/src/login.rs`
- `https://github.com/openai/codex/blob/main/codex-rs/core/src/auth/storage.rs`

### Local Project References

- `docs/task-01-opencode-account-discovery.md`
- `src/shared/config/provider-registry.ts`
- `src/shared/types/storage.ts`
- `src/manifest.json`
- `SECURITY.md`
- `PRIVACY_POLICY.md`
- `DATA_USE_DISCLOSURE.md`

## Official Findings

### What Is Confirmed

- Codex supports account-backed sign-in for first-party OpenAI clients.
- Official Codex documentation describes ChatGPT account sign-in and API key sign-in.
- Official pricing and help content state that ChatGPT Plus includes Codex access.
- OpenAI's help center explicitly separates ChatGPT billing from platform API billing.

### What Is Not Confirmed

- A public OAuth or browser identity flow intended for third-party Chrome extensions.
- A supported redirect model for `chrome.identity.launchWebAuthFlow` or equivalent third-party extension auth.
- A documented third-party token exchange surface for reusing ChatGPT Plus entitlement inside an external extension.

## Auth Option Assessment

### Option A - Official Extension Auth Flow

- Status: `not-currently-feasible`
- Reasoning:
  - First-party Codex auth exists.
  - No public evidence was found for a supported third-party Chrome extension auth surface.
  - No public OpenAI documentation was found for extension-owned redirect URIs, third-party OAuth client registration, or extension-specific identity guidance.

### Option B - Auth Cache Or Token Import

- Status: `feasible-unofficial-high-risk`
- Reasoning:
  - Official Codex clients appear to cache account-backed auth locally.
  - Reusing that auth state is technically more plausible than scraping a live browser session.
  - The reuse contract is still undocumented for external Chrome extensions.

### Option C - Browser Session Or Cookie Reuse

- Status: `feasible-unofficial-high-risk`
- Reasoning:
  - It is technically possible to build a browser-session-driven approach.
  - This is the most fragile and least acceptable option because it depends on non-public web behavior, challenge flows, CSRF patterns, and anti-bot protections.

## Subscription, API, And Entitlement Distinctions

### ChatGPT Plus

- ChatGPT Plus is a ChatGPT-side subscription.
- Based on official docs, it includes Codex access.
- It does not imply a standard OpenAI API key or API billing balance.

### OpenAI API Key

- OpenAI API keys belong to the platform API side.
- Billing is separate from ChatGPT plans.
- This is why the current extension can work with API keys even though that is not the same thing as using a ChatGPT Plus account.

### Codex Entitlement

- Codex entitlement is the actual right to access Codex features.
- A ChatGPT account may still require the correct plan, workspace, or entitlement state.
- A generic logged-in account is not enough unless the downstream Codex flow recognizes the entitlement.

## Security Assessment

### Decision Boundary

This task is acceptable only if the provider can use an official or clearly supported auth surface. Any design that depends on browser-session reuse, cookie extraction, localStorage token scraping, undocumented endpoint replay, or anti-bot fingerprint emulation is treated as a non-public flow.

### Highest-Risk Findings

- Critical: account takeover risk if a ChatGPT session cookie, refresh artifact, or equivalent account token is stored or exposed
- Critical: terms-of-service and anti-circumvention risk if the implementation depends on non-public session flow
- High: MFA or CAPTCHA downgrade if the extension persists a reusable artifact after the user completes web login challenges
- High: redirect or callback misuse risk if auth does not bind state, PKCE, issuer, and redirect URI exactly
- High: privacy and disclosure mismatch if account-session material is stored under the current provider-credential documentation model
- High: extension blast radius is already meaningful because the extension has broad host access and debugger capability

### Required Security Rules

- No cookie scraping from web pages or browser cookie stores
- No automated CAPTCHA solving, MFA bypass, or anti-bot evasion
- No raw session-cookie persistence in extension storage
- Background-only secret handling; UI sees masked metadata only
- Access tokens should be memory-only whenever possible
- All login, refresh, revoke, and quota actions must be fully redacted in logs

### Compliance Position

- Official auth flow: acceptable for implementation review
- Non-public web-session flow: research-only unless project ownership explicitly accepts ToS, lockout, privacy, and Chrome Web Store review risk

## Assumptions

- The currently published OpenAI docs reviewed here are representative of what is officially supported today.
- The open-source Codex auth implementation reflects the first-party account-backed login lifecycle.
- The project goal remains account-backed access for ChatGPT Plus / Codex rather than API-key fallback.

## Unknowns

- Whether OpenAI offers a private or partner-only auth path for browser extensions
- Whether token audiences or device binding rules permit safe reuse outside first-party clients
- Whether quota and rate-limit status can be queried through a stable interface
- Whether business or workspace entitlements introduce additional gating for Codex-backed flows
- Whether an acceptable official device-flow or localhost-style extension adaptation exists without violating extension constraints

## Recommendation For Task 03

- Adopt `official-auth-first` as the architecture rule.
- Reject cookie or browser-session scraping as the default design.
- If implementation must continue before an official extension auth path is found, scope the provider as:
  - experimental
  - unsupported by upstream
  - subject to breakage
  - isolated under a dedicated provider family rather than overloading `openai`
- Prefer an import or reuse model based on official Codex auth artifacts over web-session piggybacking.

## Go / No-Go Gates

### Go

- A supported or clearly documentable auth flow exists without cookie or localStorage scraping.
- MFA and CAPTCHA do not need to be automated or bypassed.
- Tokens are scoped, revocable, and compatible with the vault threat model.
- Privacy and data-use disclosures can be updated accurately.

### No-Go

- The extension must read cookies, session storage, or local storage from the ChatGPT web app.
- The extension must replay undocumented anti-bot headers or fingerprint material.
- A long-lived browser session secret must be stored locally.
- The flow is too brittle to survive upstream auth changes.

## Task 02 Exit State

- Feasibility classification is complete.
- Security and compliance boundaries are explicit.
- Task 03 can now produce an architecture decision record without assuming an official extension auth flow exists.
