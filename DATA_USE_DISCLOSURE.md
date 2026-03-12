# Flux Agent — Data Use Disclosure

Last updated: 2026-03-12

This document describes how Flux Agent collects, uses, and shares user data, in accordance with Chrome Web Store data disclosure requirements.

## Summary

| Question | Answer |
|----------|--------|
| Sold to third parties | No |
| Used for personalized advertising | No |
| Used for credit, lending, or insurance decisions | No |
| Used to train publisher AI/ML models | No |
| Shared outside the extension | Only to the user-configured AI provider, to fulfill the requested feature |
| Remote data transfer | Yes, when using a remote AI provider |

## Data categories

### Website content
- Includes: page URL, title, visible text/context, DOM summaries, links, forms, frame/tab context, and optional screenshots.
- Purpose: understand the current page and execute the requested automation.
- Storage/transfer: processed locally; sent to the configured AI provider when needed for inference.
- Retention: session/runtime dependent locally; provider policy if sent remotely.
- Not sold, not used for advertising or model training.

### User prompts and chat content
- Includes: prompts, instructions, chat messages, and recent message context.
- Purpose: generate plans, responses, and automation steps.
- Storage/transfer: local runtime/session state; sent to the configured AI provider when needed.
- Retention: session/runtime dependent locally; provider policy if sent remotely.
- Not sold, not used for advertising or model training.

### Settings and configuration
- Includes: theme, language, provider choice, model, endpoint, onboarding state, and capability toggles.
- Purpose: configure and persist the extension experience.
- Storage/transfer: stored locally in extension storage; endpoint values are used when making provider requests.
- Retention: until changed, cleared, or extension removal.
- Not sold, not used for advertising or model training.

### Provider authentication material
- Includes: raw provider API keys entered by the user and masked metadata retained after save/test.
- Purpose: authenticate requests to the chosen provider.
- Storage/transfer: raw key is used transiently during save/test/validation; masked metadata is stored locally.
- Retention: raw key is cleared after save/test in the current options flow; masked metadata remains until overwritten or removed.
- Not sold, not used for advertising or model training.

### Saved workflows and exports
- Includes: recorded workflow steps, saved workflow metadata, PDFs, and exported artifacts.
- Purpose: let users save, replay, export, and download results.
- Storage/transfer: saved locally in extension storage or the local Downloads path.
- Retention: until deleted locally or extension removal.
- Not sold, not used for advertising or model training.

## Third-party recipients

Depending on user configuration, data may be sent to:

- OpenAI
- Anthropic
- Google Gemini
- OpenRouter
- a user-specified custom HTTPS endpoint
- a local Ollama server on loopback

## Permissions

The following manifest permissions support core extension functionality:

| Permission | Purpose |
|------------|---------|
| `<all_urls>` | General browser automation across any website |
| `cookies` | Cookie management for automation workflows |
| `offscreen` | Background processing for long-running tasks |
| `notifications` | User notifications for task completion |
| `debugger` | Chrome DevTools Protocol access for device emulation, network interception, and geolocation mocking |
| `storage` | Local settings and workflow persistence |
| `tabs` | Tab management and navigation |
| `activeTab` | Access to the currently active tab for automation |
