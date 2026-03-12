# Flux Agent Permission Justification

Source of truth for this document is the current codebase, especially `src/manifest.json`, `README.md`, `SECURITY.md`, `src/options/App.tsx`, `src/background/index.ts`, `src/background/ui-session-runtime.ts`, and `src/content/index.ts`.

## Current scope

Flux Agent is a general browser automation extension with these shipped surfaces:

- popup
- side panel
- options page
- background service worker
- content scripts on `"<all_urls>"`, all frames, `match_about_blank: true`

Its single purpose is AI-assisted automation on the page the user is working with.

## Permission-by-permission justification

### `activeTab`
- Supports user-initiated work against the current tab from popup and shortcut flows.
- Fits the extension's active-page automation model.
- Overlaps with `tabs`, but is still consistent with the current UX.

### `tabs`
- Used to query the active tab, read tab state, navigate, reload, switch, and track tab lifecycle.
- Code paths use `chrome.tabs.query/get/update/reload` and tab event listeners.
- Required for current page targeting and multi-tab automation state.

### `scripting`
- Used to inject or install runtime page logic.
- Current code uses `chrome.scripting.executeScript` for content-script/page-tracker related work.
- Required for DOM inspection, highlights, and action execution.

### `storage`
- Used for settings, onboarding state, provider configs, and saved workflows.
- Current code uses `chrome.storage.local` and some `chrome.storage.session` cleanup.
- Important caveat: raw provider API keys are not durably persisted in the current options flow; only masked metadata is kept after save/test.

### `sidePanel`
- Required because the side panel is a primary product surface.
- Current code opens it through `chrome.sidePanel.open` from the keyboard shortcut flow.

### `debugger`
- Used for advanced Chrome DevTools Protocol automation.
- Current code attaches to tabs and uses CDP-backed commands, including PDF generation/export-related flows.
- This is the highest-risk permission in the manifest and needs explicit reviewer explanation.

### `cookies`
- Declared in the manifest, but no direct production `chrome.cookies` usage was found outside test mocks during this review.
- Current user-facing behavior does not clearly depend on this permission.
- This is a CWS review risk and should be re-checked before submission.

### `webNavigation`
- Used to track committed loads and wait for navigation milestones.
- Current code uses `onCommitted`, `onDOMContentLoaded`, `onCompleted`, and `onErrorOccurred`.
- Required for reliable navigation-aware automation.

### `offscreen`
- Declared in the manifest, but no direct production `chrome.offscreen` usage was found during this review.
- Not currently tied to an obvious shipped user-facing behavior.
- Another review-risk permission if left as-is.

### `notifications`
- Declared for alert-style behavior, but no direct production `chrome.notifications` usage was found outside test mocks.
- Options include related alert/sound settings, but Chrome notification API wiring is not evident in current runtime code.

### `downloads`
- Used to save PDFs and exported artifacts to the user's device.
- Current code uses `chrome.downloads.download` in export/save flows.

## Host permissions

### `"<all_urls>"`
- Required because Flux is designed as a cross-site browser automation assistant, not a single-site helper.
- Current content scripts match `"<all_urls>"` and run in all frames.
- This broad scope is consistent with the product, but it must be clearly disclosed to Chrome Web Store reviewers and users.

## Current controls that reduce risk

- API-key fields are cleared after save/test.
- Only masked API-key metadata is retained in options today.
- `includeScreenshotsInContext` defaults to off.
- `allowCustomScripts` defaults to off and requires an explicit acknowledgement before saving.

## Repo-specific caveats encoded here

- The manifest is broader than the narrowest possible permission set.
- `cookies`, `offscreen`, and `notifications` are currently declared without clear production usage found in this review.
- `host_permissions` is currently hard-coded to `"<all_urls>"`; there is no optional-host-permission flow in the live manifest.
- Security docs describe stronger future controls than the current live options flow provides, especially around provider-key persistence.
