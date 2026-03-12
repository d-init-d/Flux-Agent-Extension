# Flux Agent Store Screenshot Shot List

## Asset Goal

Prepare five Chrome Web Store screenshots that map directly to live product surfaces and avoid placeholder marketing claims.

## Screenshot 1 - Popup locked state

- Surface: `popup`
- Purpose: show the guided-setup gate before first live use
- Recommended framing: include the current-page card, guided setup callout, disabled quick actions, and footer status
- Suggested caption: `Start with guided setup before live quick actions unlock.`
- Capture notes: use a realistic active-tab title and URL; keep the disabled quick-action grid visible so the lock state is obvious

## Screenshot 2 - Popup unlocked quick actions

- Surface: `popup`
- Purpose: show the compact command center after onboarding is complete
- Recommended framing: include live tab context plus all four quick actions
- Suggested caption: `Review the current page and launch quick actions from the popup.`
- Capture notes: use a tab with a clean, recognizable title and domain; ensure the footer reads as live tab context rather than guided setup required

## Screenshot 3 - Side panel workspace

- Surface: `sidepanel`
- Purpose: establish the main product surface for chat plus action visibility
- Recommended framing: show header, active session picker, conversation area with a real prompt/response, expanded action log, and input composer
- Suggested caption: `Run browser tasks from chat and follow each step in the action log.`
- Capture notes: seed a believable prompt and a short streamed-style response; expand the log so executed steps are visible without zooming

## Screenshot 4 - Recording, playback, export, and workflows

- Surface: `sidepanel`
- Purpose: prove reusable workflow tooling without inventing features
- Recommended framing: focus on the recording and playback control cards with a captured session, export format selector, Save workflow button, and either the Saved workflows modal or a completed recording state
- Suggested caption: `Capture a session, replay it, export it, or save it as a reusable workflow.`
- Capture notes: use a session with multiple actions so progress, playback state, and workflow affordances all read clearly in one shot

## Screenshot 5 - Options control surface

- Surface: `options`
- Purpose: show provider setup and capability boundaries in the same settings workspace
- Recommended framing: include provider settings, permission toggles, and appearance settings in one full-page composition
- Suggested caption: `Configure providers, review permissions, and tune appearance from one control surface.`
- Capture notes: use a provider that shows model plus API-key metadata, keep at least one saved-state message visible, and include permission cards so capability boundaries are legible

## Staging Guidance

- Use realistic but non-sensitive sample data for provider names, domains, prompts, workflow names, and timestamps.
- Prefer light theme unless the final asset set intentionally mixes themes across shots.
- Keep Chrome frame and extension context visible enough that reviewers can tell each screenshot is from the shipped surfaces.
- Avoid blank or empty states unless the screenshot is explicitly about onboarding lock behavior.
- Keep captions short enough to fit cleanly in Chrome Web Store image metadata and internal asset tracking.

## P-08a Deliverables

- Captured five final PNG screenshots at store-ready `1280x800` dimensions.
- Recorded the final asset paths so the listing package can reference them directly.
- Kept the shot list and captions aligned with the current title and short description draft.

## Demo Capture Routes

- Popup locked: `src/popup/index.html?demo=popup-locked`
- Popup unlocked: `src/popup/index.html?demo=popup-unlocked`
- Side panel workspace: `src/sidepanel/index.html?demo=sidepanel-workspace`
- Side panel workflows: `src/sidepanel/index.html?demo=sidepanel-workflows`
- Options control surface: `src/options/index.html?demo=options-control-surface`

## Final Asset Paths

- `store-assets/p-08a-popup-locked.png`
- `store-assets/p-08a-popup-unlocked.png`
- `store-assets/p-08a-sidepanel-workspace.png`
- `store-assets/p-08a-sidepanel-workflows.png`
- `store-assets/p-08a-options-control-surface.png`

## Capture Notes

- Demo mode only activates when the `demo` query parameter is present; shipped extension surfaces still use the normal runtime.
- The popup shots should be centered on a neutral browser-like stage during capture so the fixed `360x480` surface reads clearly inside a `1280x800` asset.
- For the workspace shot, expand the action log before capture.
- For the workflows shot, open `Saved workflows` before capture.
- For the options shot, save the permission profile during capture so the success message is visible.
