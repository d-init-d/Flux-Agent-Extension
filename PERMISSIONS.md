# Flux Agent Permission Justification

Source of truth for this document is the current codebase, especially [src/manifest.json](/D:/OpenCode_Sanbox/Flux%20Agent%20Extension/src/manifest.json), [src/background/index.ts](/D:/OpenCode_Sanbox/Flux%20Agent%20Extension/src/background/index.ts), [src/background/ui-session-runtime.ts](/D:/OpenCode_Sanbox/Flux%20Agent%20Extension/src/background/ui-session-runtime.ts), [src/content/index.ts](/D:/OpenCode_Sanbox/Flux%20Agent%20Extension/src/content/index.ts), and [src/options/App.tsx](/D:/OpenCode_Sanbox/Flux%20Agent%20Extension/src/options/App.tsx).

## Current product surface

Flux Agent currently ships these visible extension surfaces:

- Popup launcher for page context and quick actions
- Side panel workspace for chat, action logs, recording, playback, workflows, and exports
- Options page for onboarding, provider setup, capability toggles, and the credential vault
- Background service worker plus content scripts on `"<all_urls>"`, all frames, `match_about_blank: true`

## Permission-by-permission justification

### `activeTab`

- Used for user-initiated popup and shortcut flows against the current page.
- Matches the extension's explicit "work on the page I am viewing" model.

### `tabs`

- Used to query the active tab, inspect tab state, navigate, reload, switch, and track tab lifecycle.
- Required for side-panel sessions, multi-tab automation, popup context, and playback.

### `scripting`

- Used to inject page logic and runtime helpers.
- Required for DOM inspection, overlay/highlight behavior, and some execution flows.

### `storage`

- Used for onboarding state, settings, provider configuration, saved workflows, conversation/session state, and vault metadata.
- Long-lived provider credentials are stored through the encrypted credential vault instead of plain extension storage.

### `sidePanel`

- Required because the side panel is the primary workspace for live execution.
- Current code opens and targets the side panel as a first-class surface.

### `debugger`

- Used for Chrome DevTools Protocol-backed automation paths such as keyboard/input reliability, runtime evaluation, PDF generation, device emulation, and advanced execution flows.
- This remains the highest-risk permission and must be justified clearly to Chrome Web Store reviewers.

### `webNavigation`

- Used to observe navigation milestones and keep runtime/session state aligned with real tab loads.
- Required for reliable navigation-aware automation and retries.

### `downloads`

- Used to save exported recordings, generated scripts, PDFs, and other user-requested artifacts to the local device.

## Host permissions

### `"<all_urls>"`

- Required because Flux Agent is designed as a cross-site browser automation assistant, not a single-site helper.
- Content scripts run on arbitrary user-selected pages and in frames so the runtime can inspect context and execute requested actions.
- This broad scope is intentional and must be disclosed clearly in the Chrome Web Store listing and privacy documents.

## Current risk controls

- Provider credentials are stored through an encrypted vault and unlocked only for the active browser session.
- `allowCustomScripts` is gated behind Advanced mode and explicit acknowledgement.
- Screenshot context sharing defaults to off.
- Runs remain visible through the popup, side panel, and in-session action history instead of hidden background automation.

## Reviewer-facing summary

Flux Agent requests only the permissions currently present in the live manifest:

- `activeTab`
- `tabs`
- `scripting`
- `storage`
- `sidePanel`
- `debugger`
- `webNavigation`
- `downloads`
- host permission `"<all_urls>"`

There are no extra `cookies`, `offscreen`, or `notifications` permissions in the current manifest.
