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

## Provider Auth Notes

- Most providers still use the existing API-key or OAuth-backed setup paths in `Options`.
- `OpenAI` is now the primary product surface for OpenAI-family usage.
- The `OpenAI` surface exposes exactly 2 login methods:
  1. `ChatGPT Pro/Plus (browser)`
  2. `Manually enter API Key`
- `cliproxyapi` remains a first-class API-key provider with explicit endpoint setup and readiness gating across `Options`, `Popup`, and `Sidepanel`.
- `codex` is no longer the primary first-run UX. It remains a legacy/internal compatibility lane that can still back the `OpenAI + ChatGPT Pro/Plus (browser)` runtime through the migration bridge.

## CLIProxyAPI Current Status

- Provider label in-product: `CLIProxyAPI`.
- Auth model: endpoint + API key stored in the background-owned vault.
- Supported endpoint shapes:
  - local loopback: `http://127.0.0.1:8317` or `http://127.0.0.1:8317/v1`
  - hosted: `https://your-domain/v1`
- Endpoint normalization: the setup flow accepts `/v1`, `/v1/chat/completions`, and `/v1/models`, then normalizes them to a stable base URL.
- Readiness rule: Flux only treats CLIProxyAPI as ready after a valid endpoint is saved and `Test connection` succeeds.
- Runtime guard: popup quick actions and sidepanel sends stay blocked when the CLIProxyAPI credential is missing, locked, stale, or not validated yet.

## OpenAI Current Status

- Primary provider label in-product: `OpenAI`.
- Login methods in-product: exactly `ChatGPT Pro/Plus (browser)` and `Manually enter API Key`.
- Browser-account lane ownership: background-owned and account-backed. UI surfaces only consume sanitized status and readiness state.
- Secret boundary: long-lived account artifacts stay encrypted in the vault/background path; normal settings storage keeps masked metadata and health state only.
- Runtime boundary: popup, options, and sidepanel are auth-choice-aware and talk to background messages; they do not persist raw browser-login artifacts or runtime tokens in UI-local state.
- Browser-login implementation boundary: no headless login, no scraping, and no extension-owned OAuth callback handling in this repo/build. See `docs/task-08-manifest-auth-wiring.md` and `docs/task-oa-03-browser-helper-deep-link-auth-contract.md`.
- Helper/deep-link contract exists, but this repo/build still surfaces `helper-missing` unless trusted helper artifacts or the legacy Codex bridge are already present.
- Legacy compatibility: `codex` remains available only as an internal/legacy compatibility path during migration; it should not be documented as the primary setup route.
- Manual QA checklist: `docs/task-15-manual-qa-checklist.md`.

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
- CLIProxyAPI follows the same vault boundary. Its runtime path also requires a valid saved endpoint plus a non-stale validated credential before live requests can proceed.
- OpenAI browser-account follows the same vault boundary, but with helper/deep-link account artifacts and legacy-bridge-compatible account state rather than an API key. If the vault is locked, helper is unavailable, the account is missing, revoked, stale, or refresh-required, browser-account runtime flows stay blocked until the account path is restored.
- `evaluate` and custom scripts stay off by default. They require `Advanced mode` plus the explicit custom-scripts capability, and exported recordings/action logs mark `evaluate` as high risk.
- See `SECURITY.md` for the threat model and current hardening posture.
- See `TESTING.md` for the broader QA strategy and OpenAI dual-auth / legacy-bridge test guidance.
- See `ARCHITECTURE.md` for architecture context.
- See `ROADMAP.md` and `DELIVERY_TRACKER.md` for live delivery status.

Because some docs capture planned architecture, treat the codebase and manifest as the source of truth for what is currently implemented.

## License

MIT
