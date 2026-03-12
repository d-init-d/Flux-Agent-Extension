# Flux Agent Privacy Policy

Last updated: 2026-03-12

This policy describes how the current `v0.1.0` Flux Agent Chrome extension handles data.

## What Flux Agent does

Flux Agent is a Chrome extension for AI-assisted browser automation. It provides a popup, side panel, options page, background service worker, and content scripts that can run on pages you choose to use with the extension.

## Data the extension may process

Depending on the feature you use, Flux Agent may process:

- page URLs, titles, visible page context, links, forms, DOM summaries, and frame/tab context
- prompts, chat messages, and automation instructions
- provider settings such as model choice and endpoint
- saved workflows and recorded actions
- local settings such as theme, language, and runtime toggles
- screenshots when a screenshot-related feature is enabled or triggered
- exported files you explicitly ask the extension to create or download

## Where data is processed

### Local processing
The extension currently stores most of its state locally in Chrome extension storage, including settings, onboarding state, provider metadata, and saved workflows.

### Third-party provider processing
If you use an AI-backed feature, Flux Agent may send relevant prompt and page-context data to the provider you configure, such as OpenAI, Anthropic, Google Gemini, OpenRouter, a custom HTTPS endpoint, or a local Ollama server on loopback.

Those providers process data under their own terms and privacy policies.

## Provider keys

Current options behavior is intentionally limited:

- raw provider API keys are cleared after save or test
- the extension currently retains only masked metadata, such as that a key was entered and when it was updated
- encrypted persistence for raw provider keys is not wired into the current options flow

## Broad site access

The current manifest requests `"<all_urls>"` host access because Flux Agent is designed as a general browser automation tool rather than a single-site extension.

Current implementation facts:

- content scripts are configured on `"<all_urls>"`
- content scripts run in all frames
- the extension can inspect and act on page context during automation flows

## Data sent off device

Data is sent off device only when a configured provider or remote endpoint is needed to complete the feature you requested.

Examples include:

- your prompt or instruction
- recent conversation context
- selected page context, such as URL, title, visible text, DOM summaries, links, and forms
- screenshots, if screenshot sharing is enabled or a screenshot feature is used

Flux Agent does not claim that all sensitive data is fully removed before provider transmission. You should only use the extension on pages and with data you are authorized to process.

## Data sharing and selling

- Flux Agent does not sell user data.
- Flux Agent does not use user data for advertising.
- Flux Agent shares data only with the provider or endpoint you configure when that is necessary to provide the feature you requested.

## Retention

The current reviewed implementation does not include a separate publisher-hosted backend for extension telemetry or cloud sync.

Practical retention rules today:

- masked provider-key metadata remains locally until overwritten or removed
- saved workflows remain locally until deleted or the extension is removed
- exported files remain wherever you save them on your device
- third-party providers may retain submitted data under their own policies

## Your controls

You can currently:

- choose which provider or endpoint to use
- avoid remote providers by using local Ollama where suitable
- keep screenshot sharing off by default
- leave high-risk custom-script execution disabled
- remove the extension to clear extension-managed local storage from your browser environment

## GDPR-oriented note

For users in the EEA, UK, or similar jurisdictions: most extension state is stored locally on your device, and remote processing happens only through the provider or endpoint you configure to perform the requested feature.

## Important implementation caveat

`SECURITY.md` contains some planned controls that are not fully wired into the current live options/runtime flow. For privacy statements, the codebase and manifest are treated as the source of truth.

## Contact

Before Chrome Web Store publication, replace this placeholder with the project owner's real privacy contact.

- Privacy contact: `TODO before Chrome Web Store submission`
