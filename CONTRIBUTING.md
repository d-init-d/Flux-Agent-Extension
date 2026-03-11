# Contributing

Thanks for contributing to Flux Agent.

This project is under active development. Please align changes with the current codebase, not only with long-range planning docs. If architecture docs and implementation differ, prefer the implementation and update docs in the same change when appropriate.

## Prerequisites

- Node.js 20
- pnpm 10
- Chrome or Chromium for manual extension testing

## Local Setup

Install dependencies:

```bash
pnpm install
```

Run local development:

```bash
pnpm dev
```

Build the extension for Chrome loading:

```bash
pnpm build
```

To test the built extension manually:

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click `Load unpacked`
4. Select `dist/`

The built extension currently exposes these surfaces from `src/manifest.json`:

- side panel: `src/sidepanel/index.html`
- popup: `src/popup/index.html`
- options page: `src/options/index.html`
- background service worker: `src/background/index.ts`
- content script on all frames: `src/content/index.ts`

## Repo Areas

- `src/background/` - service worker runtime and orchestration
- `src/content/` - content-script runtime and DOM actions
- `src/core/` - shared automation, AI client, bridge, controller, and session logic
- `src/sidepanel/` - main side-panel UI
- `src/popup/` - popup UI
- `src/options/` - settings and provider UI
- `src/shared/` - types, storage, errors, security, and utilities
- `src/test/` - test harness, mocks, and shared test helpers

## Common Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Additional useful commands:

```bash
pnpm test:watch
pnpm test:coverage
pnpm test:ui
pnpm format
```

## Development Expectations

- Keep changes focused and easy to review.
- Follow existing file structure and naming conventions.
- Prefer small, production-safe changes over broad refactors.
- Update or add tests when behavior changes.
- If you change manifest permissions, explain why in the PR.
- If you touch security-sensitive behavior, review `SECURITY.md` and mention the risk area in the PR.

## Testing Expectations

Before opening a PR, run at least:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Notes:

- `pnpm format` writes changes locally.
- CI also runs `pnpm format --check`, so formatting must already be clean before push.
- The repo currently uses Vitest with jsdom and Testing Library for automated coverage.
- CI collects coverage with `pnpm test:coverage`; local pre-PR verification can stay on `pnpm test` unless you are debugging coverage specifically.
- If you change popup, side panel, options, manifest, background, or content-script behavior, also test manually in a loaded Chrome build.

## Pull Requests

Please include:

- what changed
- why it changed
- files or areas affected
- commands you ran to verify the change
- any manual Chrome verification steps
- any permission, storage, or security impact

Keep PRs small when possible. If a change is large, split it into logical commits or smaller follow-up PRs.

## Commit Messages

The repository history currently follows short prefixes such as:

- `feat:`
- `fix:`
- `perf:`
- `docs:`
- `chore:`

Please keep commit subjects concise and descriptive.

## CI and Release Awareness

- CI runs on pushes and pull requests targeting `main` and `develop`.
- CI runs separate lint, typecheck, test-with-coverage, and build jobs, then uploads `coverage/` and `dist/` artifacts.
- Release packaging runs from tags matching `v*`.
- Release automation currently runs `pnpm test` and `pnpm build`, then zips `dist/` as `flux-agent-extension-<tag>.zip` and attaches it to a GitHub Release.

## Docs To Check

- `ROADMAP.md` - execution order and milestone tracking
- `DELIVERY_TRACKER.md` - current status snapshot
- `ARCHITECTURE.md` - architecture reference
- `TESTING.md` - QA strategy
- `SECURITY.md` - threat model and secure defaults

If your change updates behavior that these docs describe, update the relevant document in the same PR.
