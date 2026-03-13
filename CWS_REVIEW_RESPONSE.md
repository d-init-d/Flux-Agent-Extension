# Chrome Web Store Review Response Runbook

Last updated: 2026-03-13

This document is the repo-side artifact for `P-08c`. It prepares the review-response loop even though the actual submission and reviewer conversation still require Chrome Web Store access.

## Reviewer-facing evidence pack

Have these files ready before replying to a reviewer:

- [README.md](/D:/OpenCode_Sanbox/Flux%20Agent%20Extension/README.md)
- [PERMISSIONS.md](/D:/OpenCode_Sanbox/Flux%20Agent%20Extension/PERMISSIONS.md)
- [PRIVACY_POLICY.md](/D:/OpenCode_Sanbox/Flux%20Agent%20Extension/PRIVACY_POLICY.md)
- [DATA_USE_DISCLOSURE.md](/D:/OpenCode_Sanbox/Flux%20Agent%20Extension/DATA_USE_DISCLOSURE.md)
- [SECURITY.md](/D:/OpenCode_Sanbox/Flux%20Agent%20Extension/SECURITY.md)
- [SECURITY_SIGNOFF.md](/D:/OpenCode_Sanbox/Flux%20Agent%20Extension/SECURITY_SIGNOFF.md)
- [STORE_LISTING.md](/D:/OpenCode_Sanbox/Flux%20Agent%20Extension/STORE_LISTING.md)
- [STORE_SCREENSHOTS.md](/D:/OpenCode_Sanbox/Flux%20Agent%20Extension/STORE_SCREENSHOTS.md)

## Common reviewer questions

### Why do you need `"<all_urls>"`?

Flux Agent is a general browser automation extension, not a single-site helper. The user explicitly chooses the page to automate. Content scripts and runtime inspection must work across arbitrary sites and frames to deliver the product's stated behavior.

### Why do you need `debugger`?

`debugger` is used for Chrome DevTools Protocol-backed execution paths such as keyboard/input reliability, runtime evaluation, PDF generation, and other advanced automation flows. These paths are visible to the user through the side panel and action log; the extension does not claim hidden autonomous background control.

### How are credentials handled?

Provider credentials are stored through an encrypted local vault. The vault is initialized and unlocked with a user passphrase, credential metadata is masked, and unlocked key material is kept in memory only for the current browser session.

### Do you collect telemetry or sell user data?

No. Flux Agent does not operate a publisher-hosted telemetry backend, does not sell user data, and does not use user data for advertising.

## Response template

```text
Hello Chrome Web Store Review Team,

Thank you for the review. Flux Agent is a user-visible browser automation extension with three primary surfaces: popup, side panel, and options.

Relevant clarifications:
- Host access `"<all_urls>"` is required because the extension automates arbitrary user-selected sites rather than a fixed domain.
- `debugger` is required for Chrome DevTools Protocol-backed automation features such as reliable keyboard/input control, runtime evaluation, and PDF/export flows.
- Provider credentials are stored through an encrypted local vault and are not used for advertising, analytics, or resale.
- Flux Agent does not operate a publisher-hosted telemetry backend.

Supporting repo artifacts:
- Permission justification: `PERMISSIONS.md`
- Privacy policy: `PRIVACY_POLICY.md`
- Data disclosure: `DATA_USE_DISCLOSURE.md`
- Security hardening/sign-off: `SECURITY.md`, `SECURITY_SIGNOFF.md`

If you need a screencast or a more specific feature walkthrough, we can provide one for the exact permission or flow in question.
```

## Review-loop checklist

1. Reproduce the reviewer concern against the tagged build.
2. Attach the exact evidence file or screenshot that answers the concern.
3. If the concern reveals a real mismatch, fix code/docs first, then reply.
4. Keep one response thread per reviewer question so evidence stays traceable.
5. Record the outcome in [DELIVERY_TRACKER.md](/D:/OpenCode_Sanbox/Flux%20Agent%20Extension/DELIVERY_TRACKER.md).

## Current limitation

Actual submission, reviewer replies, and approval state still require Chrome Web Store publisher access. This file closes the repo-side preparation only.
