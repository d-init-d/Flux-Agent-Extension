# Beta Program Kit

Practical kit for `P-06` beta testing coordination. This is the next actionable repo deliverable before the full acceptance target of `10+ testers, feedback collected` can be completed with real humans.

## Scope

- `P-06a` - recruit 10-20 testers with a useful spread of setup types and browsing habits
- `P-06b` - run a small, repeatable set of beta scripts against the current extension surfaces
- `P-06c` - capture feedback in a consistent format and triage it into actionable follow-up work

Use the current implementation as the source of truth.

## Coordinator Checklist

### Before inviting testers

- Prepare a fresh local build with `pnpm build` and load `dist/` via `chrome://extensions`
- Reconfirm baseline repo health with `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`
- Share `README.md`, `SECURITY.md`, and this document with each tester
- Tell testers Flux currently exposes three user surfaces: options, popup, and side panel
- Tell testers provider setup happens in the options page onboarding flow before live quick actions are unlocked
- Tell testers key-based providers currently require re-entering the raw API key when validating or running again; raw keys are cleared after save/test until secure persistence ships
- Ask testers to use non-production accounts and non-sensitive pages only

### Target tester mix

Aim for at least 10 testers total, with overlap kept low across these buckets:

| Bucket | Minimum | Notes |
|---|---:|---|
| Chrome stable users | 6 | Primary target for unpacked extension validation |
| Chromium/Chrome Beta users | 2 | Useful for extension API edge cases |
| New users to Flux | 4 | Best signal for onboarding friction |
| Power users of browser tools | 3 | Better signal for workflow/recording UX |
| OpenAI users | 2 | Covers default provider path |
| Claude/Gemini/OpenRouter users | 3 | Covers alternate provider paths |
| Ollama or custom endpoint users | 1 | Optional but high-value for endpoint validation |

## Recruitment Brief (`P-06a`)

### Ideal tester profile

- Comfortable loading an unpacked Chrome extension
- Willing to test on ordinary sites such as docs, search, demo forms, or internal staging pages
- Uses at least one supported provider: Claude, OpenAI, Gemini, OpenRouter, Ollama, or Custom HTTPS endpoint
- Can spend 20-30 minutes and file at least one structured report, even if the result is "no issue"
- Understands that this beta should avoid passwords, payment flows, and private customer data

### Outreach message template

```text
Subject: Flux Agent beta tester request

Flux Agent is a Manifest V3 Chrome extension for AI-assisted browser automation.

We need beta testers to validate onboarding, provider setup, popup/side panel flows, recording/playback, and workflow export on real pages.

What you need:
- Chrome or Chromium
- 20-30 minutes
- A supported AI provider or local Ollama/custom endpoint
- Willingness to test only on non-sensitive pages and test accounts

What you will do:
- Load the unpacked extension
- Run the beta scripts in `BETA_PROGRAM.md`
- File feedback with the beta issue template

If interested, reply with:
1. Browser/version
2. Provider you plan to use
3. Whether you are new to Flux-style browser automation
```

### Outreach checklist

- Confirm the tester has Chrome/Chromium and can load an unpacked extension
- Assign a tester ID for tracking in a spreadsheet or project board
- Record browser version, provider choice, and tester experience level
- Send the exact build package or branch reference being tested
- Send install steps: `pnpm build` -> `chrome://extensions` -> `Load unpacked` -> select `dist/`
- Send the required scenario IDs to run
- Send the feedback issue template path: `.github/ISSUE_TEMPLATE/beta-feedback.md`
- Ask the tester to attach screenshots or exported recordings when relevant

## Tester Guardrails

- Use test accounts, demo content, and disposable data only
- Do not test on password forms, payment forms, admin consoles, or sensitive customer data
- Do not paste real API keys into screenshots or bug reports
- Prefer reproducible pages over one-off private pages
- If a run appears unsafe or wrong, stop immediately and report the last visible action

## Tester Setup Notes

### Current product realities

- Manifest permissions include `activeTab`, `tabs`, `scripting`, `storage`, `sidePanel`, `debugger`, `cookies`, `webNavigation`, `offscreen`, `notifications`, and `downloads`
- Host permissions are currently `"<all_urls>"`
- The popup quick actions stay in preview mode until onboarding is complete
- The options page is the source of truth for provider setup and capability toggles
- The side panel is the main workspace for chat, recording, playback, workflow save, and export
- Export formats currently include `JSON`, `Playwright`, and `Puppeteer`
- Known repo baseline: CI expects `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`; roadmap notes the current known audit exception is the existing `rollup` advisory chain via `@crxjs/vite-plugin`

### Minimum tester setup

1. Build the extension with `pnpm build`
2. Open `chrome://extensions`
3. Enable Developer mode
4. Click `Load unpacked`
5. Select `dist/`
6. Open the options page and complete onboarding
7. Save and validate a provider connection before attempting live side-panel runs

## Beta Scripts (`P-06b`)

Run at least Scripts 1-5 for every tester. Scripts 6-7 are strongly recommended for testers who reach recording and workflow features.

| ID | Focus | Surface | Script | Expected result |
|---|---|---|---|---|
| 1 | Install + onboarding | Options + popup | Load the extension, open the popup, confirm quick actions are locked, then open guided setup from the popup or options page and finish onboarding. | Onboarding completes, popup no longer shows setup lock state, and no surface crashes. |
| 2 | Provider setup | Options | Choose one provider, save config, run `Test connection`, and note whether the connection succeeds. For OpenAI-compatible providers, note any base URL override used. | Provider settings save cleanly, validation result is clear, and raw API key input clears after save/test. |
| 3 | Popup context | Popup | Open a normal content page, reopen the popup, verify page title/domain/URL render correctly, and inspect the four quick action cards. | Popup reflects the active tab and stays readable without missing text or broken states. |
| 4 | Side panel prompt flow | Side panel | Use the side panel on a safe page and try one simple prompt such as summarize visible content, extract data from a table, or inspect clickable targets. | The side panel accepts input, shows progress/messages, and returns a usable response or a clear failure message. |
| 5 | Capability boundaries | Options + live page | Review toggles such as screenshots, custom scripts, highlight targets, and notifications. Change one low-risk toggle, save, and confirm the change persists after reopening the extension. | Settings persist correctly and the boundaries remain understandable. |
| 6 | Recording + playback | Side panel | Start recording, perform a short 3-5 step flow on a safe page, pause/resume if available, stop, then play the recording back at `1x` or `2x`. | Recording captures steps, playback starts from the saved session, and any failure is surfaced clearly instead of silently breaking. |
| 7 | Export + workflow reuse | Side panel | Export the recorded flow in one format (`JSON`, `Playwright`, or `Puppeteer`), then save the flow as a workflow and reopen it from `Saved workflows`. | Export downloads successfully and the saved workflow is available for later reuse. |

### Scenario notes for coordinators

- Prefer public, low-risk pages with clear structure: docs pages, pricing pages, demo forms, tables, or search results
- Ask at least 3 testers to exercise the popup first-run lock/unlock path
- Ask at least 3 testers to cover recording, playback, and export
- Ask at least 1 tester each to cover OpenAI, Claude, Gemini, and one alternate endpoint path if possible
- If a provider fails because of external credentials, still collect the setup friction as feedback

## Feedback Capture (`P-06c`)

### What every tester should submit

- One issue per bug, broken UX step, or missing expectation
- At least one overall summary report, even if all scripts pass
- Browser version, provider used, and scenario IDs executed
- Reproduction steps and whether the issue is consistent or intermittent
- Screenshot, screen recording, or exported artifact when available

Use `.github/ISSUE_TEMPLATE/beta-feedback.md` for all beta reports.

### Severity guide

| Severity | Meaning | Example |
|---|---|---|
| `P0` | Unsafe or blocking for the beta | Extension crashes, uncontrolled action, cannot complete onboarding |
| `P1` | Core flow broken | Cannot validate provider, side panel send flow fails, playback unusable |
| `P2` | Important but beta can continue | Popup mismatch, export edge case, poor error messaging |
| `P3` | Polish or follow-up | Minor copy issue, layout rough edge, nice-to-have suggestion |

### Area labels

- `area:onboarding`
- `area:options`
- `area:popup`
- `area:sidepanel`
- `area:provider`
- `area:recording`
- `area:playback`
- `area:workflow`
- `area:export`
- `area:security`

### Triage flow

1. Confirm the report includes browser, provider, scenario ID, and repro steps
2. Reproduce on the same branch/build if possible
3. Add severity and area labels
4. Mark duplicates and link to the canonical issue
5. Split true bugs from feature requests or tester education gaps
6. Escalate any unsafe behavior, password-field interaction, payment-flow interaction, or data leakage concern as `P0`
7. Maintain one short beta rollup with counts by severity, provider, and surface area

### Beta exit evidence to collect

- Number of testers invited
- Number of testers who completed Scripts 1-5
- Providers exercised across the beta group
- Count of issues filed by severity and area
- Count of blockers fixed before phase sign-off
- Top 3 recurring friction points

## Completion Mapping

| Roadmap item | Enabled by this kit |
|---|---|
| `P-06a` | Recruitment brief, target profile, outreach template, outreach checklist |
| `P-06b` | Seven structured beta scripts covering onboarding, provider setup, popup, side panel, recording, playback, export, and workflow reuse |
| `P-06c` | Standard feedback requirements, issue template, severity model, area labels, and triage flow |

## Still Requires Human / External Action

- Recruiting and scheduling real testers
- Real browser/manual execution on multiple machines
- Real provider credentials or local model availability
- Filing, deduplicating, and prioritizing issues from actual beta feedback
