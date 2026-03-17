# Task 15 - Manual QA Checklist For Account-Backed Codex Provider

## Purpose

This checklist is for a manual tester using a real ChatGPT Plus account with Codex access to validate the new account-backed provider flow in the unpacked Chrome extension build.

## Test Scope

- Provider under test: `ChatGPT Plus / Codex (Experimental)`
- Surfaces under test: `Options`, `Popup`, `Sidepanel`
- Focus: real account import, validation, prompt send, account lifecycle, degraded-state handling, and regression safety

## Tester Preconditions

Complete all items before starting.

- [ ] Use a Chrome profile dedicated to QA, or a clean profile with no old Flux extension state that could mask failures.
- [ ] Confirm the unpacked extension build is loaded from the latest local `dist/` output in `chrome://extensions`.
- [ ] Confirm the extension is enabled and the side panel permission is granted if Chrome prompts for it.
- [ ] Confirm the extension `Options`, `Popup`, and `Sidepanel` all open successfully after loading the unpacked build.
- [ ] Confirm the vault is initialized and you know the unlock passphrase or flow needed for the session.
- [ ] Prepare one valid official Codex auth artifact exported from a real ChatGPT account session.
- [ ] Confirm the artifact belongs to the tester account intended for this pass and is not already revoked.
- [ ] Confirm the ChatGPT account is on a plan that includes ChatGPT Plus and real Codex access.
- [ ] Prepare a second valid artifact for the same org/user set or a second eligible account if account-switch coverage will be executed.
- [ ] Start with at least one normal `https://` page open in an active tab so popup quick actions have accessible page context.
- [ ] Keep one inaccessible tab scenario ready for negative tests, for example `chrome://newtab`.
- [ ] Do not run this checklist in Incognito unless the extension was explicitly allowed there as part of the build under test.

## Evidence To Capture

Capture lightweight evidence for every failed check and for every P0/P1 pass.

- [ ] Screenshot the key success state for import, validation, popup, and sidepanel send.
- [ ] Screenshot any error or degraded-state banner exactly as shown.
- [ ] Record the artifact/account label used in the run, but never paste raw tokens or raw artifact JSON into the QA report.
- [ ] Record Chrome version, extension build source, date/time, and whether the vault was locked or unlocked at the start.

## Test Data

Use these labels consistently so results are easy to compare.

- Primary account label: `Codex Primary QA`
- Secondary account label: `Codex Backup QA`
- Smoke prompt: `Reply with exactly: TASK15_OK`
- Quick-action page: any stable public `https://` page with readable text content

## Priority Legend

- `P0` - ship blocker; must pass
- `P1` - core functional coverage; should pass for release
- `P2` - regression and resilience coverage; should pass before sign-off

---

## P0 - Core Happy Path

### TC-P0-01 - Load unpacked build and open all product surfaces

- [ ] Open `chrome://extensions` and verify the unpacked Flux build is enabled.
- [ ] Open extension `Options`.
- [ ] Open extension `Popup`.
- [ ] Open extension `Sidepanel`.

Expected results:

- [ ] No Chrome load errors are shown for the unpacked build.
- [ ] `Options`, `Popup`, and `Sidepanel` all render without blank screens or crash loops.
- [ ] No obvious missing assets, broken layout, or fatal permission prompt blocks the flow.

### TC-P0-02 - Import a valid Codex account artifact

- [ ] In `Options`, select provider `codex`.
- [ ] Enter account label `Codex Primary QA`.
- [ ] Paste a valid official auth artifact into the artifact field.
- [ ] Click `Import and connect`.

Expected results:

- [ ] Import completes without exposing raw artifact contents after submission.
- [ ] The artifact textarea is cleared immediately after import.
- [ ] The imported account appears in the account list.
- [ ] The account shows as the active Codex account when it is the only imported account.
- [ ] No raw token, refresh token, or full artifact body is visible anywhere in the UI.

### TC-P0-03 - Validate the imported account

- [ ] In `Options`, click `Test connection` or `Validate account` for `Codex Primary QA`.

Expected results:

- [ ] Validation completes against the account-backed flow, not an API-key flow.
- [ ] A success message confirms the artifact shape validated for the imported account.
- [ ] Provider state no longer shows `Account missing`.
- [ ] If the artifact is fresh, the provider is usable without requiring a re-import.

### TC-P0-04 - Popup quick action starts from an accessible web tab

- [ ] Activate a normal `https://` page.
- [ ] Open the extension `Popup`.
- [ ] Confirm the current page is recognized.
- [ ] Click one quick action, preferably `Summarize page`.

Expected results:

- [ ] Popup shows the active page title and URL context.
- [ ] Popup indicates the page is `Ready for quick actions` or equivalent live-ready state.
- [ ] Quick action buttons are enabled.
- [ ] Starting a quick action opens or reuses a sidepanel session instead of failing silently.
- [ ] No account-missing or vault-locked blocker appears for a valid, unlocked account.

### TC-P0-05 - Sidepanel sends a prompt with the active Codex account

- [ ] Open the `Sidepanel` with Codex still selected.
- [ ] Send the smoke prompt: `Reply with exactly: TASK15_OK`.

Expected results:

- [ ] The `Send` button is enabled before submit.
- [ ] Message submission succeeds without auth errors.
- [ ] A response is returned from the Codex-backed session.
- [ ] The returned content matches or clearly contains `TASK15_OK`.
- [ ] The session stays usable for another prompt after the first response finishes.

### TC-P0-06 - Import and switch to a second Codex account

- [ ] Import a second valid artifact using label `Codex Backup QA`.
- [ ] In the Codex account list, activate `Codex Backup QA`.
- [ ] Re-open `Popup` or refresh `Sidepanel` state if needed.
- [ ] Send the smoke prompt again from `Sidepanel`.

Expected results:

- [ ] The second account imports successfully and appears in the list.
- [ ] Activating the second account shows a clear success message.
- [ ] The newly active account is marked active in `Options`.
- [ ] Popup/sidepanel picks up the active-account change without requiring extension reload.
- [ ] Prompt send still succeeds after the account switch.

### TC-P0-07 - Revoke and remove imported accounts

- [ ] Revoke `Codex Backup QA` from `Options`.
- [ ] Remove `Codex Primary QA` from `Options`.

Expected results:

- [ ] Revoke action shows a success message and the revoked account is visibly no longer healthy for use.
- [ ] Remove action deletes the selected imported account from the local vault-backed store.
- [ ] Removed accounts no longer appear in the account list.
- [ ] If the active account was removed or revoked, Codex falls back to a blocked/not-ready state instead of using stale credentials silently.

---

## P1 - Failure And Degraded Paths

### TC-P1-01 - Vault locked blocks account-backed validation

- [ ] Lock the vault.
- [ ] In `Options`, keep provider set to `codex` and attempt `Test connection`.

Expected results:

- [ ] Validation is blocked before any provider call is attempted.
- [ ] UI clearly says the vault must be unlocked before validating the imported account-backed provider.
- [ ] Existing account guidance remains visible; the screen does not collapse into a generic error.

### TC-P1-02 - Popup shows vault locked guidance

- [ ] With the vault still locked, open `Popup` on a normal `https://` page.

Expected results:

- [ ] Popup shows `Vault locked` or equivalent state.
- [ ] Popup guidance tells the tester to unlock the vault in `Options` and validate again if needed.
- [ ] Quick action buttons are disabled while the vault is locked.

### TC-P1-03 - Missing account state

- [ ] Remove all imported Codex accounts, or use a clean profile with no imported Codex account.
- [ ] Open `Options`, `Popup`, and `Sidepanel` with provider `codex` selected.

Expected results:

- [ ] `Options` clearly says no imported account is available yet.
- [ ] `Popup` shows `Account missing` and explains that an official artifact must be imported in `Options`.
- [ ] `Sidepanel` does not allow sending a prompt while the account is missing.

### TC-P1-04 - Refresh-required artifact state

- [ ] Use an artifact/account state known to be expired enough to require re-import, or reproduce with a stale QA artifact.
- [ ] Open `Options`, `Popup`, and `Sidepanel`.

Expected results:

- [ ] The account or provider state is surfaced as `Refresh required`.
- [ ] Guidance tells the tester to re-import a fresh official artifact and validate again.
- [ ] Popup quick actions are disabled while refresh is required.
- [ ] Sidepanel `Send` is disabled while refresh is required.

### TC-P1-05 - Revoked account state

- [ ] Revoke an imported Codex account in `Options`.
- [ ] Re-open `Popup` and `Sidepanel`.

Expected results:

- [ ] The revoked account is clearly marked unusable.
- [ ] Guidance tells the tester to remove it or import a fresh official artifact.
- [ ] Prompt send and quick actions remain blocked for the revoked account.

### TC-P1-06 - Stale health metadata does not look healthy

- [ ] After a refresh-required or revoked scenario, inspect `Options`, `Popup`, and `Sidepanel` state.

Expected results:

- [ ] No surface claims Codex is ready when the stored session/account metadata is stale.
- [ ] The degraded-state label is consistent across surfaces.
- [ ] The user is steered toward re-import/validate rather than being allowed into a broken send flow.

### TC-P1-07 - Session expired during use

- [ ] Start from a previously working imported account.
- [ ] Force session expiry outside the extension if feasible, or use an artifact known to have expired since import.
- [ ] Attempt another prompt send from the `Sidepanel`.

Expected results:

- [ ] The send flow fails with a clear re-auth or refresh message.
- [ ] The extension does not keep retrying indefinitely.
- [ ] The session remains recoverable by re-importing a fresh official artifact.

### TC-P1-08 - No accessible active tab

- [ ] Put Chrome in a state where the popup cannot read the active tab, or reproduce from a tab/context where access is denied.
- [ ] Open `Popup`.

Expected results:

- [ ] Popup shows `Active tab unavailable` or equivalent state.
- [ ] Quick actions are disabled.
- [ ] The error explains that quick actions need an accessible active tab.

### TC-P1-09 - Chrome internal page / `chrome://newtab`

- [ ] Open `chrome://newtab`.
- [ ] Open the extension `Popup`.

Expected results:

- [ ] Popup shows the page as unsupported rather than broken.
- [ ] Guidance explains that quick actions only run on normal `http/https` website tabs.
- [ ] Quick actions are disabled.

---

## P2 - Regression And Safety Checks

### TC-P2-01 - Other providers still work

- [ ] Switch from `codex` to at least one existing key-based provider already configured in the QA environment, for example `openai`, `gemini`, or another known-good provider.
- [ ] Validate/save that provider.
- [ ] Open `Popup` and `Sidepanel` and exercise one basic action if credentials are available.

Expected results:

- [ ] Non-Codex providers still load, save, and validate normally.
- [ ] Their flows do not show Codex-only account-backed messaging.
- [ ] Existing provider behavior is not regressed by the new Codex wiring.

### TC-P2-02 - Unpacked build remains loadable after state changes

- [ ] After running several Codex import/revoke/remove operations, reload the unpacked extension from `chrome://extensions`.
- [ ] Re-open `Options`, `Popup`, and `Sidepanel`.

Expected results:

- [ ] The extension still reloads without manifest/runtime errors.
- [ ] Previously saved non-secret settings still load.
- [ ] Expected account-backed state is restored correctly from storage and vault status.

### TC-P2-03 - Options save path still works

- [ ] Change a normal options setting unrelated to Codex account auth.
- [ ] Save settings.
- [ ] Reload the options page.

Expected results:

- [ ] Settings save successfully.
- [ ] The save path is not blocked by Codex account-backed changes.
- [ ] Reloaded settings match what was saved.

### TC-P2-04 - Theme controls still work

- [ ] Change theme selection in a supported surface, for example `Popup`.
- [ ] Close and reopen that surface.

Expected results:

- [ ] Theme change applies immediately.
- [ ] The chosen theme persists after reopening.
- [ ] Codex provider changes do not reset or break theme handling.

### TC-P2-05 - Permissions and surface access are not unintentionally broken

- [ ] Confirm popup can still inspect a normal active tab.
- [ ] Confirm sidepanel still opens.
- [ ] Confirm options still open from extension entry points.

Expected results:

- [ ] No newly broken permission prompts appear during standard use.
- [ ] Existing surface entry points remain functional.
- [ ] The build behaves like a normal unpacked Chrome extension.

---

## Cross-Surface Consistency Checks

Run these checks whenever a Codex state changes.

- [ ] `Options`, `Popup`, and `Sidepanel` agree on the same active-account health state.
- [ ] A state change in `Options` is reflected in `Popup` and `Sidepanel` without requiring a browser restart.
- [ ] Blocked states never leave a send button or quick action enabled by mistake.
- [ ] Guidance always points back to the right recovery action: unlock vault, import artifact, validate account, re-import fresh artifact, revoke/remove stale account.

## QA PASS Exit Criteria

Mark Task 15 as QA PASS only when all of the following are true.

- [ ] All `P0` cases pass.
- [ ] All `P1` degraded-state cases pass, or any failure has an approved blocker disposition recorded by engineering.
- [ ] No `P2` regression reveals a break in non-Codex providers, unpacked loading, options save, theme persistence, or permissions behavior.
- [ ] At least one real prompt succeeds end-to-end in the `Sidepanel` using a real imported Codex account.
- [ ] At least one popup quick action successfully launches work from a normal `https://` tab.
- [ ] Account switch, revoke, and remove flows all behave predictably with clear user-facing results.
- [ ] No raw artifact body or raw token material is exposed anywhere in the UI during the test pass.
- [ ] Any remaining issues are documented with screenshots, exact repro steps, and severity.

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
- [ ] P0 completed
- [ ] P1 completed
- [ ] P2 completed

### Notes
- Active account used: `<masked-email-or-label>`
- Secondary account used: `<masked-email-or-label>`
- Key findings:
  - `<finding 1>`
  - `<finding 2>`

### Defects
- `<defect id / summary / severity>`
```
