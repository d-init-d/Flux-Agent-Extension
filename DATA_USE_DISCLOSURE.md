# Flux Agent Data Use Disclosure

This document is a Chrome Web Store prep artifact. It maps the current implementation to likely CWS data-use answers; it is not the submitted form itself.

## High-level answers

- Sold to third parties: No
- Used for personalized advertising: No
- Used for credit, lending, or insurance decisions: No
- Used to train publisher-owned generalized AI/ML models: No current evidence in this repo
- Shared outside the extension only to provide the user-requested feature: Yes
- Remote transfer can happen: Yes, when the user configures and uses a remote AI provider or custom endpoint

## Data categories

### Website content
- Includes: page URL, title, visible text/context, DOM summaries, links, forms, frame/tab context, and optional screenshots.
- Purpose: understand the current page and execute the requested automation.
- Storage/transfer: processed locally; sent to the configured AI provider when needed for inference.
- Retention: session/runtime dependent locally; provider policy if sent remotely.
- Sold/ads/training: no / no / no publisher evidence.

### User prompts and chat content
- Includes: prompts, instructions, chat messages, and recent message context.
- Purpose: generate plans, responses, and automation steps.
- Storage/transfer: local runtime/session state; sent to the configured AI provider when needed.
- Retention: session/runtime dependent locally; provider policy if sent remotely.
- Sold/ads/training: no / no / no publisher evidence.

### Settings and configuration
- Includes: theme, language, provider choice, model, endpoint, onboarding state, and capability toggles.
- Purpose: configure and persist the extension experience.
- Storage/transfer: stored locally in extension storage; endpoint values are used when making provider requests.
- Retention: until changed, cleared, or extension removal.
- Sold/ads/training: no / no / no.

### Provider authentication material
- Includes: raw provider API keys entered by the user and masked metadata retained after save/test.
- Purpose: authenticate requests to the chosen provider.
- Storage/transfer: raw key is used transiently during save/test/validation; masked metadata is stored locally.
- Retention: raw key is cleared after save/test in the current options flow; masked metadata remains until overwritten or removed.
- Sold/ads/training: no / no / no.
- Caveat: encrypted key persistence exists in the repo as a capability, but is not wired into the current options flow.

### Saved workflows and exports
- Includes: recorded workflow steps, saved workflow metadata, PDFs, and exported artifacts.
- Purpose: let users save, replay, export, and download results.
- Storage/transfer: saved locally in extension storage or the local Downloads path.
- Retention: until deleted locally or extension removal.
- Sold/ads/training: no / no / no.

## Third-party recipients

Depending on user configuration, data may be sent to:

- OpenAI
- Anthropic
- Google Gemini
- OpenRouter
- a user-specified custom HTTPS endpoint
- a local Ollama server on loopback

The reviewed repo does not show a separate publisher-hosted cloud relay.

## Permissions with disclosure relevance

These manifest permissions matter for CWS review, but their production data use is weak or absent in the current code review:

- `cookies`
- `offscreen`
- `notifications`

This document does not over-claim collection for those areas. They should still be reviewed before submission because the permissions are present.

## Repo-specific caveats carried into this disclosure

- `host_permissions` is currently `"<all_urls>"`.
- Content scripts are configured for all URLs and all frames.
- Raw provider keys are not durably stored by the current options save/test path; masked metadata is.
- Some security/privacy controls described elsewhere in the repo are planned rather than fully live.
