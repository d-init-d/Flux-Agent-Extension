# Performance Baseline

Last updated: 2026-03-13

This artifact records the current repo-side performance baseline for `P-01`.

## Latest build metrics

Command used:

- `pnpm build`

Observed output:

- `2249` modules transformed
- Largest executable chunk: `dist/assets/index.ts-DOxOOYR0.js` at `263.15 kB` (`70.18 kB` gzip)
- Next largest chunk: `dist/assets/globals-DB2VNw7J.js` at `212.39 kB` (`66.01 kB` gzip)
- Largest HTML entry bundle: `dist/assets/index.html-D-nsNdoP.js` at `129.05 kB` (`38.88 kB` gzip)
- CSS bundle: `dist/assets/globals-DX4tmNwE.css` at `51.79 kB` (`9.23 kB` gzip)

Artifact sizes:

- `dist/` total bytes: `862,613`
- release zip `releases/flux-agent-extension-v0.1.0.zip`: `868,073` bytes

## Current assessment

- Provider lazy-loading and content/runtime chunk splitting are working.
- No single emitted runtime chunk exceeds the roadmap's `500 kB` bundle ceiling.
- The packaged release zip is still above `500 kB`, so `P-01` remains partial.
- No reproducible idle-memory measurement was captured in this repo pass, so the `< 50 MB idle memory` target is still open.

## Remaining work for full `P-01` close

1. Capture a real Chrome idle-memory profile against the unpacked production build.
2. Decide whether the roadmap threshold applies to emitted runtime chunks or the packaged zip.
3. If the packaged zip must be under `500 kB`, continue reducing side-panel/runtime payloads or static asset weight.
