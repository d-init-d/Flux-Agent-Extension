# Task 15 - Unified OpenAI Manual QA Checklist

## Purpose

This checklist closes the OpenAI Unified Auth Surface initiative against the real shipped repo/build state.

It validates that:

- `OpenAI` is the primary user-facing surface for OpenAI-family usage.
- `OpenAI` exposes exactly 2 login methods:
  1. `ChatGPT Pro/Plus (browser)`
  2. `Manually enter API Key`
- `codex` is legacy/internal compatibility, not the first-run primary UX.
- The browser-account lane is account-backed and background-owned.
- This repo/build does **not** ship headless login, scraping, or extension-owned OAuth callback handling.
- The helper/deep-link contract exists, but clean local builds may still show `helper-missing` unless trusted helper artifacts or a legacy bridge already exist.

## Test Scope

- Primary provider under test: `OpenAI`
- Surfaces under test: `Options`, `Popup`, `Sidepanel`
- Lanes under test:
  - `OpenAI -> ChatGPT Pro/Plus (browser)`
  - `OpenAI -> Manually enter API Key`
- Compatibility coverage under test:
  - legacy `codex` bridge into `OpenAI + ChatGPT Pro/Plus (browser)`

## Tester Preconditions

Complete all items before starting.

- [ ] Use a Chrome profile dedicated to QA, or a clean profile with no old Flux extension state that could mask failures.
- [ ] Confirm the unpacked extension build is loaded from the latest local `dist/` output in `chrome://extensions`.
- [ ] Confirm the extension is enabled and the side panel permission is granted if Chrome prompts for it.
- [ ] Confirm `Options`, `Popup`, and `Sidepanel` all open successfully after loading the unpacked build.
- [ ] Confirm the vault is initialized and you know the unlock passphrase or flow needed for the session.
- [ ] Prepare one valid OpenAI API key for the API-key lane.
- [ ] Prepare one valid trusted browser-account setup path if available for this QA pass:
  - trusted helper artifacts already installed, or
  - trusted legacy Codex bridge state/artifacts already present.
- [ ] Prepare one stable public `https://` page for popup quick-action checks.
- [ ] Keep one unsupported/inaccessible tab scenario ready, for example `chrome://newtab`.
- [ ] Do not run this checklist in Incognito unless the extension was explicitly allowed there as part of the build under test.

## Evidence To Capture

Capture lightweight evidence for every failed check and every P0/P1 pass.

- [ ] Screenshot the `OpenAI` login-method chooser showing exactly 2 options.
- [ ] Screenshot one success state for the API-key lane.
- [ ] Screenshot one browser-account state, including `helper-missing` if that is the real local result.
- [ ] Screenshot popup and sidepanel readiness/blocking states when the selected OpenAI login method changes.
- [ ] Record Chrome version, extension build source, date/time, and whether the vault was locked or unlocked at the start.
- [ ] Never paste raw API keys, tokens, or raw browser-account artifacts into the QA report.

## Test Data

- API-key smoke prompt: `Reply with exactly: OA10_API_OK`
- Browser-account smoke prompt: `Reply with exactly: OA10_BROWSER_OK`
- Popup quick-action page: any stable public `https://` page with readable text content

## Priority Legend

- `P0` - ship blocker; must pass
- `P1` - core functional coverage; should pass for release
- `P2` - regression and resilience coverage; should pass before sign-off

---

## P0 - Unified OpenAI Surface Truth

### TC-P0-01 - Open all product surfaces

- [ ] Open `chrome://extensions` and verify the unpacked Flux build is enabled.
- [ ] Open extension `Options`.
- [ ] Open extension `Popup`.
- [ ] Open extension `Sidepanel`.

Expected results:

- [ ] No Chrome load errors are shown for the unpacked build.
- [ ] `Options`, `Popup`, and `Sidepanel` all render without blank screens or crash loops.
- [ ] No obvious missing assets or fatal permission prompt blocks the flow.

### TC-P0-02 - OpenAI is the primary surface with exactly 2 login methods

- [ ] In `Options`, select provider `OpenAI`.
- [ ] Inspect the login-method area.

Expected results:

- [ ] `OpenAI` is presented as the primary user-facing OpenAI-family provider.
- [ ] The UI shows exactly 2 login methods:
  - [ ] `ChatGPT Pro/Plus (browser)`
  - [ ] `Manually enter API Key`
- [ ] The UI does not present `codex` as the preferred first-run path for OpenAI usage.

### TC-P0-03 - Auth-choice-aware surfaces stay aligned

- [ ] In `Options`, switch between the 2 OpenAI login methods.
- [ ] Re-open `Popup` and `Sidepanel` after each switch if needed.

Expected results:

- [ ] `Options`, `Popup`, and `Sidepanel` react to the selected OpenAI login method.
- [ ] API-key guidance appears only for the API-key lane.
- [ ] Browser-account guidance appears only for the browser-account lane.
- [ ] The product does not collapse back into Codex-first copy when `OpenAI` is selected.

---

## P0 - OpenAI API-Key Lane

### TC-P0-04 - Save and validate OpenAI API-key auth

- [ ] In `Options`, keep `OpenAI -> Manually enter API Key` selected.
- [ ] Enter a valid OpenAI API key.
- [ ] Save and validate/test connection.

Expected results:

- [ ] Save/validation succeeds through the API-key lane.
- [ ] Raw API key material is not exposed in normal settings UI or storage-facing status copy.
- [ ] The provider reaches a ready state for the API-key lane.

### TC-P0-05 - Popup quick action works on the OpenAI API-key lane

- [ ] Activate a normal `https://` page.
- [ ] Open `Popup` with `OpenAI -> Manually enter API Key` still selected.
- [ ] Run one quick action, preferably `Summarize page`.

Expected results:

- [ ] Popup recognizes the active page context.
- [ ] Quick actions are enabled when the API-key lane is ready.
- [ ] Starting a quick action opens or reuses a sidepanel session instead of failing silently.

### TC-P0-06 - Sidepanel send works on the OpenAI API-key lane

- [ ] In `Sidepanel`, send the smoke prompt `Reply with exactly: OA10_API_OK`.

Expected results:

- [ ] The `Send` button is enabled before submit.
- [ ] Submission succeeds without auth errors.
- [ ] A response is returned and matches or clearly contains `OA10_API_OK`.

---

## P0 - OpenAI Browser-Account Lane

### TC-P0-07 - Browser-account lane shows honest setup state

- [ ] In `Options`, select `OpenAI -> ChatGPT Pro/Plus (browser)`.

Expected results:

- [ ] The lane is clearly presented as account-backed/background-owned.
- [ ] The UI does not claim headless login, scraping, or extension-owned OAuth callback handling.
- [ ] On a clean local build with no trusted helper artifacts and no legacy bridge state, the real surfaced state is `helper-missing` or equivalent helper-unavailable guidance.

### TC-P0-08 - Browser-account lane works only when trusted account-backed state exists

- [ ] If trusted helper artifacts or trusted legacy bridge state already exist, validate the browser-account lane and send the smoke prompt `Reply with exactly: OA10_BROWSER_OK` from `Sidepanel`.
- [ ] If no trusted helper/bridge state exists, verify that send remains blocked.

Expected results:

- [ ] Ready browser-account state, when available, comes from the account-backed/background-owned path.
- [ ] Non-ready browser-account state blocks quick actions and sidepanel send.
- [ ] The UI never asks for a raw API key while `ChatGPT Pro/Plus (browser)` is selected.

---

## P1 - Browser-Account Degraded States And Legacy Bridge

### TC-P1-01 - Vault locked blocks browser-account use

- [ ] Lock the vault.
- [ ] Keep `OpenAI -> ChatGPT Pro/Plus (browser)` selected.
- [ ] Attempt validation or live use.

Expected results:

- [ ] Validation/send is blocked before a live provider call is attempted.
- [ ] UI clearly says the vault must be unlocked first.
- [ ] Popup and sidepanel readiness reflect the same blocked state.

### TC-P1-02 - Helper-missing state is surfaced honestly

- [ ] Use a clean local build/profile without trusted helper artifacts and without trusted legacy bridge state.
- [ ] Open `Options`, `Popup`, and `Sidepanel` on the browser-account lane.

Expected results:

- [ ] The surfaced state is `helper-missing` or clearly equivalent helper-unavailable guidance.
- [ ] The UI does not pretend that browser login can complete inside the extension.
- [ ] Quick actions and `Send` stay blocked while helper support is unavailable.

### TC-P1-03 - Legacy Codex bridge surfaces under OpenAI, not Codex-first UX

- [ ] Use a profile/build where trusted legacy Codex bridge state already exists.
- [ ] Open `Options`, `Popup`, and `Sidepanel`.

Expected results:

- [ ] The product surfaces the usable state through `OpenAI -> ChatGPT Pro/Plus (browser)`.
- [ ] `codex` is treated as legacy/internal compatibility and not as the primary setup route.
- [ ] Popup/sidepanel readiness and guidance stay OpenAI-browser-account-aware.

### TC-P1-04 - Missing or degraded browser-account states stay blocked

- [ ] Reproduce one or more degraded states if feasible: `Account missing`, `Refresh required`, `Revoked`, `Session expired`.
- [ ] Inspect `Options`, `Popup`, and `Sidepanel`.

Expected results:

- [ ] All affected surfaces show a consistent blocked/not-ready state.
- [ ] Guidance points to the correct account-backed recovery path.
- [ ] The UI does not fall back to scraping, headless login, or extension-owned OAuth claims.

### TC-P1-05 - Popup unsupported-tab behavior still works

- [ ] Open `chrome://newtab`.
- [ ] Open `Popup`.

Expected results:

- [ ] Popup shows unsupported/inaccessible tab guidance rather than a broken auth error.
- [ ] Quick actions stay disabled.

---

## P2 - Regression And Safety Checks

### TC-P2-01 - OpenAI lane switching does not corrupt readiness

- [ ] Switch from `OpenAI -> Manually enter API Key` to `OpenAI -> ChatGPT Pro/Plus (browser)` and back.

Expected results:

- [ ] Readiness and guidance update correctly for the selected lane.
- [ ] The UI does not mix API-key-ready state into browser-account state, or vice versa.

### TC-P2-02 - Legacy Codex is not promoted back into first-run docs UX

- [ ] Inspect `Options`, `Popup`, and `Sidepanel` entry points after reload.

Expected results:

- [ ] `OpenAI` remains the primary user-facing surface.
- [ ] Any legacy Codex presence is clearly compatibility-oriented rather than first-run guidance.

### TC-P2-03 - Non-OpenAI providers still behave normally

- [ ] Switch to one known-good non-OpenAI provider already configured in the QA environment, for example `cliproxyapi`, `gemini`, or another provider.
- [ ] Validate/save and exercise one basic action if credentials are available.

Expected results:

- [ ] Non-OpenAI providers still load, save, and validate normally.
- [ ] OpenAI-specific dual-auth copy does not leak into unrelated providers.

### TC-P2-04 - Reload and persistence sanity check

- [ ] Reload the unpacked extension from `chrome://extensions`.
- [ ] Re-open `Options`, `Popup`, and `Sidepanel`.

Expected results:

- [ ] The extension reloads without manifest/runtime errors.
- [ ] Saved non-secret settings still load.
- [ ] The selected OpenAI login method persists as expected.

---

## Cross-Surface Consistency Checks

Run these checks whenever the selected OpenAI login method or browser-account state changes.

- [ ] `Options`, `Popup`, and `Sidepanel` agree on the selected OpenAI login method.
- [ ] Blocked browser-account states never leave popup quick actions or sidepanel send enabled.
- [ ] API-key lane readiness does not leak into browser-account lane copy.
- [ ] Browser-account lane copy does not claim headless login, scraping, or extension-owned OAuth callback handling.
- [ ] If legacy bridge state exists, it is surfaced as `OpenAI + browser-account`, not as Codex-first onboarding.

## QA PASS Exit Criteria

Mark Task 15 as QA PASS only when all of the following are true.

- [ ] All `P0` unified-surface checks pass.
- [ ] At least one real OpenAI API-key prompt succeeds end-to-end in `Sidepanel`.
- [ ] Browser-account behavior is documented honestly for the tested build/profile:
  - [ ] either ready via trusted helper/legacy bridge state, or
  - [ ] correctly blocked with `helper-missing` or other truthful non-ready status.
- [ ] No surface re-promotes `codex` as the primary first-run OpenAI UX.
- [ ] No surface claims headless login, scraping, or extension-owned OAuth callback handling.
- [ ] Any remaining issues are documented with screenshots, repro steps, and severity.

## Suggested QA Result Summary Template

```md
## Task 15 QA Result

- Build: `<commit-or-build-id>`
- Chrome: `<version>`
- Tester: `<name>`
- Date: `<yyyy-mm-dd>`

### Status
- [ ] PASS
- [ ] FAIL
- [ ] PASS WITH KNOWN ISSUES

### Coverage
- [ ] OpenAI primary surface verified
- [ ] OpenAI API-key lane verified
- [ ] OpenAI browser-account lane verified honestly for this build/profile
- [ ] Legacy Codex bridge behavior checked if available

### Notes
- Browser-account local result: `<helper-missing | ready-via-helper | ready-via-legacy-bridge | other>`
- Key findings:
  - `<finding 1>`
  - `<finding 2>`

### Defects
- `<defect id / summary / severity>`
```
