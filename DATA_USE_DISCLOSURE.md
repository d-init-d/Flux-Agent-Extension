# Flux Agent - Data Use Disclosure

Last updated: 2026-03-13

This document describes how Flux Agent collects, uses, and shares user data in line with Chrome Web Store disclosure expectations.

## Summary

| Question | Answer |
|----------|--------|
| Sold to third parties | No |
| Used for personalized advertising | No |
| Used for credit, lending, or insurance decisions | No |
| Used to train publisher AI/ML models | No |
| Shared outside the extension | Only to the user-configured AI provider or endpoint, to fulfill the requested feature |
| Remote data transfer | Yes, when using a remote AI provider or custom endpoint |

## Data categories

### Website content

- Includes: page URL, title, visible text/context, DOM summaries, links, forms, frame/tab context, and optional screenshots.
- Purpose: understand the current page and execute the requested automation.
- Storage/transfer: processed locally; sent to the configured AI provider when needed for inference.
- Retention: local runtime/session dependent; provider policy if sent remotely.
- Not sold, not used for advertising or publisher-model training.

### User prompts and chat content

- Includes: prompts, instructions, chat messages, and recent conversation context.
- Purpose: generate plans, responses, and automation steps.
- Storage/transfer: local runtime/session state; sent to the configured AI provider when needed.
- Retention: local runtime/session dependent; provider policy if sent remotely.
- Not sold, not used for advertising or publisher-model training.

### Settings and configuration

- Includes: theme, language, provider choice, model, endpoint, onboarding state, and capability toggles.
- Purpose: configure and persist the extension experience.
- Storage/transfer: stored locally in extension storage; endpoint values are used when making provider requests.
- Retention: until changed, cleared, or extension removal.
- Not sold, not used for advertising or publisher-model training.

### Provider authentication material

- Includes: raw provider API keys or OAuth tokens entered by the user, plus masked vault metadata retained after save/validation.
- Purpose: authenticate requests to the chosen provider.
- Storage/transfer: raw credentials can be used transiently during save/test flows; when explicitly stored, credentials are kept in the encrypted local vault and sent only to the configured provider when required.
- Retention: encrypted vault records remain until overwritten or removed; masked metadata remains until overwritten or removed.
- Not sold, not used for advertising or publisher-model training.

### Saved workflows and exports

- Includes: recorded workflow steps, saved workflow metadata, PDFs, and exported artifacts.
- Purpose: let users save, replay, export, and download results.
- Storage/transfer: stored locally in extension storage or the local Downloads path.
- Retention: until deleted locally or extension removal.
- Not sold, not used for advertising or publisher-model training.

## Third-party recipients

Depending on user configuration, data may be sent to:

- OpenAI
- Anthropic
- Google Gemini
- OpenRouter
- a user-specified custom HTTPS endpoint
- a local Ollama server on loopback

## Permissions

The current manifest permissions support core extension functionality:

| Permission | Purpose |
|------------|---------|
| `<all_urls>` | General browser automation across user-selected websites |
| `activeTab` | Current-tab access for user-initiated popup and shortcut flows |
| `tabs` | Tab management, navigation, multi-tab state, and popup context |
| `scripting` | Content/runtime injection and page automation helpers |
| `storage` | Local settings, workflows, session state, and encrypted vault metadata |
| `sidePanel` | Primary workspace for chat, action logs, and execution control |
| `debugger` | Chrome DevTools Protocol access for advanced automation paths |
| `webNavigation` | Navigation-aware orchestration and load milestone tracking |
| `downloads` | Saving exported artifacts and PDFs to the local device |
