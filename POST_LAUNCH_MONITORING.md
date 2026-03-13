# Post-Launch Monitoring Plan

Last updated: 2026-03-13

This document is the setup artifact for `P-09`. Flux Agent intentionally does not ship a publisher-hosted telemetry backend, so monitoring is based on explicit user-visible inputs, store feedback, and manual triage.

## Monitoring inputs

- Chrome Web Store review comments and support mail
- GitHub issues, especially beta and release regressions
- Manual reproduction against the released tag/build
- User-supplied screenshots, exported recordings, and console/runtime logs when available

## Daily launch-week checklist

Run this once per day for the first 14 days after release:

1. Check new Chrome Web Store reviews and support mailbox items.
2. Check new GitHub issues and label by severity plus area.
3. Reproduce every `P0` or `P1` report against the release tag.
4. Record whether the issue is provider-specific, site-specific, or global.
5. Update the release rollup with open blocker counts and mitigation status.

## Severity model

| Severity | Meaning | Expected response |
|----------|---------|-------------------|
| `P0` | Unsafe behavior, data leakage, uncontrolled automation, or complete install/startup blocker | Immediate stop-ship / hotfix decision |
| `P1` | Core flow broken: onboarding, provider validation, send flow, playback, export, or side panel unusable | Same-day triage and patch plan |
| `P2` | Important issue with a workaround | Schedule into next patch release |
| `P3` | Polish, copy, or low-impact UX issue | Batch into maintenance work |

## Manual evidence to request from users

- Browser version
- Operating system
- Provider used
- Exact prompt or workflow step
- Page URL/domain if shareable
- Screenshot or screen recording
- Exported recording or workflow JSON when relevant
- Extension console/runtime errors if available

## Log-collection guidance

Flux Agent already keeps structured action/session history in visible extension surfaces. If a user can reproduce a problem:

1. Ask for the exported recording or workflow if one exists.
2. Ask for a screenshot of the side-panel action log and error state.
3. Ask whether Advanced mode or custom scripts were enabled.
4. Reproduce locally with the same provider and page shape before changing code.

## Rollback / hotfix criteria

Prepare an immediate patch or disable launch promotion when any of these are true:

- Reproducible `P0` security/privacy issue
- Provider vault or validation failure across multiple providers
- Side-panel send flow regression on supported Chrome stable
- Recording/playback corruption that breaks saved user workflows
- Store rejection caused by a real manifest/docs mismatch

## Weekly reporting template

Track at least:

- New issues by severity
- Open issues by severity
- Provider distribution of reports
- Surface distribution of reports: onboarding, options, popup, side panel, recording, playback, export, workflow
- Hotfixes shipped or queued

## Current limitation

Because Flux Agent does not ship publisher-hosted telemetry or remote crash reporting, monitoring depends on explicit user reports and manual triage. This is by design and should remain consistent with the privacy policy and store disclosures.
