# Flux Agent Privacy Policy

Last updated: 2026-03-13
Effective date: 2026-03-13

This policy describes how the Flux Agent Chrome extension handles data.

## What Flux Agent does

Flux Agent is a Chrome extension for AI-assisted browser automation. It provides a popup, side panel, options page, background service worker, and content scripts that can run on pages you choose to use with the extension.

## Data the extension may process

Depending on the feature you use, Flux Agent may process:

- page URLs, titles, visible page context, links, forms, DOM summaries, and frame/tab context
- prompts, chat messages, and automation instructions
- provider configuration such as model choice, endpoint, and masked credential metadata
- encrypted provider credentials that you explicitly store in the local credential vault
- saved workflows, recordings, exports, and action history
- local settings such as theme, language, onboarding state, and runtime toggles
- screenshots when a screenshot-related feature is enabled or explicitly triggered

## Where data is processed

### Local processing

Flux Agent stores extension state locally in Chrome extension storage. This includes settings, onboarding state, provider configuration, saved workflows, and vault metadata.

Stored provider credentials are encrypted at rest in local extension storage. The vault is unlocked with a user passphrase and the unlocked key material remains only in memory for the current browser session.

### Third-party provider processing

If you use an AI-backed feature, Flux Agent may send prompt and page-context data to the provider you configure, such as OpenAI, Anthropic, Google Gemini, OpenRouter, a custom HTTPS endpoint, or a local Ollama server on loopback.

Those providers process data under their own terms and privacy policies.

## Credential handling

- Raw provider credentials entered in the options page are cleared from the UI after save or validation
- Long-lived provider credentials are stored in the encrypted local vault only when you explicitly save them
- Vault metadata may retain masked information such as provider, masked value, and validation timestamps
- Credentials are sent only to the configured provider or endpoint when required to fulfill the feature you requested

## Broad site access

The extension requests `"<all_urls>"` host access because Flux Agent is a general browser automation tool rather than a single-site helper. Content scripts run on pages you choose to use with the extension, in all frames, so automation flows can inspect context and act on the page.

## Data sent off device

Data is sent off device only when a configured provider or remote endpoint is needed to complete the feature you requested.

Examples include:

- your prompt or instruction
- recent conversation context
- selected page context, such as URL, title, visible text, DOM summaries, links, and forms
- screenshots, if screenshot sharing is enabled or a screenshot feature is used

Flux Agent does not claim that all sensitive page data is automatically removed before provider transmission. You should only use the extension on pages and with data you are authorized to process.

## Data sharing and selling

- Flux Agent does not sell user data.
- Flux Agent does not use user data for advertising.
- Flux Agent shares data only with the provider or endpoint you configure when that is necessary to provide the feature you requested.

## Retention

Flux Agent does not operate a publisher-hosted backend for telemetry or cloud sync.

- Local settings, workflows, recordings, and chat/session state remain in extension storage until overwritten, deleted, or the extension is removed
- Encrypted credential vault records remain locally until replaced or deleted
- Vault metadata may remain until a credential is rotated or removed
- Exported files remain wherever you save them on your device
- Third-party providers may retain submitted data under their own policies

## Your controls

You can:

- choose which provider or endpoint to use
- avoid remote providers by using local Ollama where suitable
- keep screenshot sharing off by default
- leave Advanced mode and custom-script execution disabled
- lock the credential vault for the current browser session
- remove stored credentials and workflows from local extension storage
- remove the extension to clear extension-managed local storage from your browser environment

## GDPR-oriented note

For users in the EEA, UK, or similar jurisdictions: most extension state is stored locally on your device, and remote processing happens only through the provider or endpoint you configure to perform the requested feature.

## Children's Privacy

Flux Agent is not directed at children under the age of 13. We do not knowingly collect personal information from children. If you believe a child has provided data through the extension, please contact us and we will promptly delete it.

## International Data Transfers

When you use a third-party AI provider, your data may be processed in countries where that provider operates. By configuring and using a remote provider, you acknowledge that your data will be transferred to and processed by that provider according to that provider's privacy policy.

## Changes to This Policy

We may update this Privacy Policy from time to time. Changes will be reflected in the "Last updated" date at the top. Continued use of the extension after changes constitutes acceptance of the updated policy.

## Contact

- Privacy contact: `d.init.d.contact@gmail.com`
