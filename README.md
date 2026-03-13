# Flux Agent

AI-powered Chrome extension for browser automation with natural-language control.

Status: active development (`v0.1.0`). The repo contains a working Manifest V3 extension and supporting project docs, while some roadmap items are still in progress.

## What It Includes

- Chrome Extension surfaces for popup, side panel, and options UI
- Background service worker orchestration and content-script automation runtime
- Natural-language action execution flows backed by provider-based AI client plumbing
- Recording, playback, and export flows for browser actions
- GitHub Actions CI for lint, typecheck, tests with coverage, and production builds
- TypeScript, React, Vite, and Vitest-based development workflow

## Tech Stack

- React 19
- TypeScript 5
- Vite 5 + `@crxjs/vite-plugin`
- Zustand + TanStack Query
- Zod for schema validation
- Vitest + Testing Library for automated tests

## Extension Surfaces

- Popup: `src/popup/index.html` (launcher that opens the side panel and dispatches live quick actions)
- Side panel: `src/sidepanel/index.html`
- Options page: `src/options/index.html` (provider config, credential vault, permissions, appearance)
- Background service worker: `src/background/index.ts`
- Content script: `src/content/index.ts`
- Manifest: `src/manifest.json`

## Permissions

The manifest currently declares these permissions:

- `activeTab`
- `tabs`
- `scripting`
- `storage`
- `sidePanel`
- `debugger`
- `webNavigation`
- `downloads`

Host permissions are currently `"<all_urls>"` because the extension automates and inspects the active page context across sites.

## Prerequisites

- Node.js 20
- pnpm 10
- Chrome or Chromium for local extension loading

## Getting Started

Install dependencies:

```bash
pnpm install
```

Start local development:

```bash
pnpm dev
```

Type-check the project:

```bash
pnpm typecheck
```

Run tests:

```bash
pnpm test
```

Build the extension:

```bash
pnpm build
```

Load the unpacked extension in Chrome:

1. Run `pnpm build`
2. Open `chrome://extensions`
3. Enable Developer mode
4. Click `Load unpacked`
5. Select the `dist/` directory

## Available Scripts

- `pnpm dev` - start the Vite dev server
- `pnpm build` - typecheck and build the extension bundle
- `pnpm preview` - preview the built app bundle locally
- `pnpm typecheck` - run TypeScript without emitting files
- `pnpm lint` - run ESLint on `src/`
- `pnpm format` - format source files with Prettier
- `pnpm test` - run the full Vitest suite
- `pnpm test:watch` - run Vitest in watch mode
- `pnpm test:coverage` - run tests with coverage output
- `pnpm test:ui` - open the Vitest UI

## Project Layout

```text
src/
  background/   service worker runtime and orchestration
  content/      content-script runtime, DOM inspection, action execution
  core/         AI client, parser, bridge, browser controller, session logic
  options/      settings and provider configuration UI
  popup/        popup UI
  sidepanel/    main chat and automation UI
  shared/       shared types, storage, errors, security, utilities
  test/         test setup, mocks, and E2E-style harness tests
```

## Quality Gates

GitHub Actions currently run:

- lint + format check
- typecheck
- tests with coverage
- production build

Release packaging is handled by `.github/workflows/release.yml` on tags matching `v*`.

## Security Notes

- Provider credentials now flow through the background-owned credential vault. Secrets are encrypted at rest, while regular settings storage keeps only masked metadata.
- Unlocking the vault is a per-browser-session action. The unlock state lives in session storage and memory only; options and popup flows do not persist raw provider secrets.
- `evaluate` and custom scripts stay off by default. They require `Advanced mode` plus the explicit custom-scripts capability, and exported recordings/action logs mark `evaluate` as high risk.
- See `SECURITY.md` for the threat model and current hardening posture.
- See `TESTING.md` for the broader QA strategy.
- See `ARCHITECTURE.md` for architecture context.
- See `ROADMAP.md` and `DELIVERY_TRACKER.md` for live delivery status.

Because some docs capture planned architecture, treat the codebase and manifest as the source of truth for what is currently implemented.

## License

MIT
