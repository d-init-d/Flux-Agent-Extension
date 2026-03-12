# Flux Agent Privacy Policy

Last updated: 2026-03-12  
Effective date: 2026-03-12

This policy describes how the Flux Agent Chrome extension handles data.

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
The extension stores all settings and state locally in Chrome extension storage, including settings, onboarding state, provider metadata, and saved workflows.

### Third-party provider processing
If you use an AI-backed feature, Flux Agent may send relevant prompt and page-context data to the provider you configure, such as OpenAI, Anthropic, Google Gemini, OpenRouter, a custom HTTPS endpoint, or a local Ollama server on loopback.

Those providers process data under their own terms and privacy policies.

## API Key Handling

- Raw API keys entered in the Options page are used only for authentication and cleared from the UI after save or validation
- Only masked metadata (e.g., that a key was configured and when) is stored locally
- Keys are never transmitted to any party other than the configured provider

## Broad site access

The extension requests `"<all_urls>"` host access because Flux Agent is designed as a general browser automation tool rather than a single-site extension. Content scripts are configured on `"<all_urls>"`, run in all frames, and can inspect and act on page context during automation flows.

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

Flux Agent does not operate a publisher-hosted backend for extension telemetry or cloud sync.

- Masked provider-key metadata remains locally until overwritten or removed
- Saved workflows remain locally until deleted or the extension is removed
- Exported files remain wherever you save them on your device
- Third-party providers may retain submitted data under their own policies

## Your controls

You can:

- Choose which provider or endpoint to use
- Avoid remote providers by using local Ollama where suitable
- Keep screenshot sharing off by default
- Leave high-risk custom-script execution disabled
- Remove the extension to clear extension-managed local storage from your browser environment

## GDPR-oriented note

For users in the EEA, UK, or similar jurisdictions: most extension state is stored locally on your device, and remote processing happens only through the provider or endpoint you configure to perform the requested feature.

## Children's Privacy

Flux Agent is not directed at children under the age of 13. We do not knowingly collect personal information from children. If you believe a child has provided data through the extension, please contact us and we will promptly delete it.

## International Data Transfers

When you use a third-party AI provider, your data may be processed in countries where that provider operates. By configuring and using a remote provider, you acknowledge that your data will be transferred to and processed by that provider according to their privacy policy.

## Changes to This Policy

We may update this Privacy Policy from time to time. Changes will be reflected in the "Last updated" date at the top. Continued use of the extension after changes constitutes acceptance of the updated policy.

## Contact

- Privacy contact: `privacy@fluxagent.dev`
