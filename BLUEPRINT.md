# AI Browser Controller - Master Blueprint

> **Version:** 1.0.0
> **Last Updated:** 2026-03-18
> **Status:** Planning Phase
> **Codename:** Phantom
> **Goal:** Build a Chrome Extension that rivals Playwright/Comet Browser in automation power, controlled entirely by AI, with zero local setup.

---

## Table of Contents

1. [Vision & Competitive Analysis](#1-vision--competitive-analysis)
2. [Architecture Overview](#2-architecture-overview)
3. [Module Blueprint](#3-module-blueprint)
4. [Implementation Plan with Subagent Assignments](#4-implementation-plan-with-subagent-assignments)
5. [File Structure](#5-file-structure)
6. [Technology Stack](#6-technology-stack)
7. [Quality Gates](#7-quality-gates)
8. [Risk Registry](#8-risk-registry)

---

## 1. Vision & Competitive Analysis

### 1.1 What We're Building

A Chrome Extension where users chat with AI to automate ANY browser task. No local server. No Node.js. No coding. Just install and talk.

### 1.2 Competitive Landscape

| Feature                             | Playwright    | Comet Browser    | Our Extension                                            |
| ----------------------------------- | ------------- | ---------------- | -------------------------------------------------------- |
| **Setup**                           | Node.js + npm | Separate browser | Chrome Extension only                                    |
| **User**                            | Developers    | Power users      | Everyone                                                 |
| **Control**                         | Code          | AI + Code        | AI Chat                                                  |
| **Navigate**                        | ✅            | ✅               | ✅ `chrome.tabs`                                         |
| **Click**                           | ✅            | ✅               | ✅ Content Script + CDP                                  |
| **Fill forms**                      | ✅            | ✅               | ✅ Content Script + CDP                                  |
| **Screenshot**                      | ✅            | ✅               | ✅ `chrome.tabs.captureVisibleTab` + CDP                 |
| **Full page screenshot**            | ✅            | ✅               | ✅ CDP `Page.captureScreenshot`                          |
| **Network intercept**               | ✅            | ✅               | ✅ `chrome.debugger` CDP                                 |
| **Wait for element**                | ✅            | ✅               | ✅ MutationObserver + polling                            |
| **Wait for navigation**             | ✅            | ✅               | ✅ `chrome.webNavigation`                                |
| **Multi-tab**                       | ✅            | ✅               | ✅ `chrome.tabs`                                         |
| **Selectors (CSS/XPath/text/ARIA)** | ✅            | ✅               | ✅ Custom selector engine                                |
| **Auto-wait**                       | ✅            | ⚠️ Partial       | ✅ Custom auto-wait                                      |
| **Retry logic**                     | ⚠️ Manual     | ⚠️               | ✅ Built-in intelligent retry                            |
| **Keyboard simulation**             | ✅            | ✅               | ✅ `KeyboardEvent` + CDP `Input.dispatchKeyEvent`        |
| **Mouse simulation**                | ✅            | ✅               | ✅ `MouseEvent` + CDP `Input.dispatchMouseEvent`         |
| **File upload**                     | ✅            | ⚠️               | ✅ CDP `DOM.setFileInputFiles`                           |
| **PDF generation**                  | ✅            | ✅               | ✅ CDP `Page.printToPDF`                                 |
| **Video recording**                 | ✅            | ⚠️               | ⚠️ Possible via `MediaRecorder`                          |
| **Geolocation mock**                | ✅            | ✅               | ✅ CDP `Emulation.setGeolocationOverride`                |
| **Device emulation**                | ✅            | ✅               | ✅ CDP `Emulation.setDeviceMetricsOverride`              |
| **Cookie management**               | ✅            | ✅               | ✅ `chrome.cookies` + CDP                                |
| **Local storage access**            | ✅            | ✅               | ✅ Content Script                                        |
| **iframe support**                  | ✅            | ⚠️               | ✅ Frame-aware content scripts + targeted bridge routing |
| **Shadow DOM**                      | ✅            | ⚠️               | ✅ `element.shadowRoot` piercing                         |

### 1.3 Our Unique Advantages

| Advantage           | Description                                                    |
| ------------------- | -------------------------------------------------------------- |
| **Zero setup**      | Install extension → done. No Node.js, no terminal.             |
| **AI-first**        | Natural language, not code. "Fill this form" not `page.fill()` |
| **Context-aware**   | AI sees the page, understands layout, adapts to changes        |
| **Self-healing**    | AI retries with different selectors if first attempt fails     |
| **Multi-provider**  | Claude, GPT, Gemini, Ollama — user's choice                    |
| **Visual feedback** | Real-time highlighting of what AI is doing                     |
| **Session memory**  | AI remembers what it did, can undo, can learn patterns         |

---

## 2. Architecture Overview

### 2.1 System Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│ LAYER 5: PRESENTATION                                               │
│ ┌───────────┐ ┌──────────────┐ ┌────────────┐ ┌──────────────────┐ │
│ │  Popup    │ │  Side Panel  │ │  Options   │ │ In-Page Overlay  │ │
│ │ (Quick    │ │ (Main Chat   │ │ (Settings  │ │ (Visual          │ │
│ │  Access)  │ │  Interface)  │ │  & Config) │ │  Feedback)       │ │
│ └─────┬─────┘ └──────┬───────┘ └─────┬──────┘ └────────┬─────────┘ │
│       └──────────────┼───────────────┼─────────────────┘           │
│──────────────────────┼───────────────┼─────────────────────────────│
│ LAYER 4: STATE       │               │                             │
│ ┌────────────────────┴───────────────┴───────────────────────────┐ │
│ │ Zustand Stores: sessionStore, uiStore, settingsStore           │ │
│ │ TanStack Query: AI responses, page context caching             │ │
│ └────────────────────────────────────────────────────────────────┘ │
│──────────────────────────────────────────────────────────────────│
│ LAYER 3: SERVICE WORKER (Background)                              │
│ ┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌──────────────────┐  │
│ │ AI Client│ │ Command  │ │   Browser    │ │    Session       │  │
│ │ Manager  │ │ Parser   │ │  Controller  │ │    Manager       │  │
│ └────┬─────┘ └────┬─────┘ └──────┬───────┘ └──────┬───────────┘  │
│      └────────────┴──────────────┴────────────────┘               │
│                              │                                     │
│      ┌───────────────────────┴───────────────────────┐            │
│      │            ORCHESTRATOR ENGINE                 │            │
│      │  Action Queue · Error Recovery · Rate Limiter  │            │
│      └───────────────────────┬───────────────────────┘            │
│──────────────────────────────┼───────────────────────────────────│
│ LAYER 2: CONTENT SCRIPTS     │                                     │
│ ┌────────────┐ ┌─────────────┴──┐ ┌───────────────┐               │
│ │ DOM Engine │ │ Event Simulator│ │ Visual Engine  │               │
│ │ (Selector, │ │ (Click, Type,  │ │ (Highlight,    │               │
│ │  Inspector)│ │  Keyboard)     │ │  Overlay)      │               │
│ └────────────┘ └────────────────┘ └───────────────┘               │
│──────────────────────────────────────────────────────────────────│
│ LAYER 1: CHROME APIs                                               │
│ ┌─────────┐┌──────────┐┌──────────┐┌────────┐┌─────────────────┐  │
│ │  tabs   ││ scripting ││ debugger ││storage ││ webNavigation   │  │
│ └─────────┘└──────────┘└──────────┘└────────┘└─────────────────┘  │
│──────────────────────────────────────────────────────────────────│
│ LAYER 0: EXTERNAL                                                  │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐               │
│ │  Claude  │ │   GPT    │ │  Gemini  │ │  Ollama  │               │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘               │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Hybrid Automation Strategy

**Key decision: chrome.scripting + chrome.debugger (CDP) hybrid.**

```
┌────────────────────────────────────────────────────────────────┐
│                    AUTOMATION STRATEGY                          │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  PRIMARY: Content Scripts (chrome.scripting)                   │
│  ✅ No "debugging" banner                                     │
│  ✅ Works silently                                            │
│  ✅ Good for: click, fill, extract, scroll, wait              │
│  ❌ Limited: file upload, network intercept, device emulation │
│                                                                │
│  FALLBACK: CDP (chrome.debugger)                               │
│  ✅ Full Playwright-level power                               │
│  ✅ Network intercept, device emulation, PDF, geolocation     │
│  ❌ Shows "Extension is debugging this browser" banner        │
│                                                                │
│  DECISION MATRIX:                                              │
│  ┌──────────────────────────┬───────────┬────────────┐        │
│  │ Action                   │ Primary   │ Fallback   │        │
│  ├──────────────────────────┼───────────┼────────────┤        │
│  │ Click / Hover            │ CS        │ CDP        │        │
│  │ Fill / Type              │ CS        │ CDP        │        │
│  │ Navigate                 │ tabs API  │ CDP        │        │
│  │ Screenshot               │ tabs API  │ CDP (full) │        │
│  │ Extract text             │ CS        │ CDP        │        │
│  │ Wait for element         │ CS        │ CDP        │        │
│  │ File upload              │ CDP       │ -          │        │
│  │ Network intercept        │ CDP       │ webRequest │        │
│  │ Cookie management        │ cookies   │ CDP        │        │
│  │ Geolocation mock         │ CDP       │ -          │        │
│  │ Device emulation         │ CDP       │ -          │        │
│  │ PDF generation           │ CDP       │ -          │        │
│  │ iframe interaction       │ CS(frame) │ CDP        │        │
│  │ Shadow DOM               │ CS        │ CDP        │        │
│  └──────────────────────────┴───────────┴────────────┘        │
│                                                                │
│  CS = Content Script, CDP = Chrome DevTools Protocol           │
└────────────────────────────────────────────────────────────────┘
```

### 2.3 OpenAI Unified Auth Surface (Current)

**Product goal:** keep `OpenAI` as the single primary provider surface for the OpenAI ecosystem, but let users choose one of exactly 2 auth methods:

1. `ChatGPT Pro/Plus (browser)`
2. `Manually enter API Key`

This phase does **not** include headless login and does **not** move to full extension-owned OAuth callback handling. OA-01 locks that contract at the documentation level before runtime/UI work begins.

#### UX shape

- `Provider = OpenAI`
- `Login method = ChatGPT Pro/Plus (browser)`
  - UI-initiated but background-owned helper/deep-link flow
  - account-backed runtime state
  - readiness depends on a background-validated helper/deep-link result plus a healthy account session
- `Login method = Manually enter API Key`
  - existing API-key path
  - readiness depends on saved key + connection validation

#### Internal architecture rule

The UI should treat this as one provider surface, but the background runtime still needs two internal auth lanes. The unified provider label is a UX simplification, not a semantic merge.

| Layer            | Manual API Key                      | ChatGPT Pro/Plus (browser)                                     |
| ---------------- | ----------------------------------- | -------------------------------------------------------------- |
| UI surface       | `OpenAI` + `Manually enter API Key` | `OpenAI` + `ChatGPT Pro/Plus (browser)`                        |
| Vault material   | encrypted API key                   | encrypted long-lived account artifact/minimal refresh material |
| Runtime material | provider API key                    | memory-only account-backed runtime token/session               |
| Primary adapter  | `openai` provider                   | `openai + browser-account` account-backed runtime path         |
| Readiness gate   | key saved + validated               | helper login completed + account validated + session healthy   |

#### Browser helper/deep-link flow

```
Options UI
  -> user selects OpenAI
  -> user selects ChatGPT Pro/Plus (browser)
  -> background launches helper/deep-link flow for the UI-triggered request
  -> helper opens official browser login flow
  -> helper returns callback/deep-link result envelope to background
  -> background validates requestId/state/nonce + provenance before vault persistence
  -> background stores encrypted long-lived state in vault
  -> runtime resolves short-lived session/token in memory only
  -> popup/sidepanel unlock when account-backed OpenAI is healthy
```

#### Why helper/deep-link instead of full extension OAuth

- keeps the current background-owned vault boundary intact
- avoids adding `chrome.identity`, callback pages, PKCE/state handling, and extension-owned browser auth windows in this phase
- keeps room for a future official auth contract without forcing a large auth rewrite now
- better matches the desired OpenCode-like UX without adding headless complexity

#### Model policy

- Model selection must become auth-aware.
- `OpenAI + API key` shows OpenAI platform/API models.
- `OpenAI + browser-account` shows account-backed models supported by the Codex/OpenAI account runtime.
- The UI should stop pretending one static default model works for both auth methods.
- The runtime must reject models incompatible with the selected auth method before a live request is sent.

#### Legacy migration policy

- Existing `codex` users should migrate to `OpenAI + ChatGPT Pro/Plus (browser)` without losing encrypted account state.
- `codex` may remain as an internal or legacy compatibility route during migration, but the destination semantic shape is `openai + browser-account`.
- Once migration is stable, `codex` should no longer be the primary first-run UX surface.

#### Security constraints

- no cookie scraping
- no localStorage/sessionStorage scraping
- no piggybacking on logged-in ChatGPT tabs
- no headless flow in this phase
- no persistence of short-lived runtime session tokens
- no raw helper payloads or tokens exposed to the UI
- no helper/deep-link payload may enter the vault until the background verifies provenance and matches it to an extension-issued request `requestId` / `state` / `nonce`

#### Expected file touchpoints for this phase

- `src/shared/config/provider-registry.ts`
- `src/shared/types/ai.ts`
- `src/shared/types/storage.ts`
- `src/shared/types/messages.ts`
- `src/options/App.tsx`
- `src/options/onboarding/OnboardingFlow.tsx`
- `src/popup/App.tsx`
- `src/sidepanel/App.tsx`
- `src/background/ui-session-runtime.ts`
- `src/background/credential-vault.ts`
- `src/background/codex-account-session-manager.ts`
- new helper/deep-link coordination module under `src/core/auth/` or `src/background/`

#### Delivery order

1. lock ADR and UX contract
2. redesign provider/auth surface for multi-auth-per-provider
3. define helper/deep-link transport
4. expand vault and message contracts
5. unify runtime auth resolution for OpenAI
6. ship the OpenAI auth-choice UX
7. add auth-aware model routing
8. land Codex migration bridge
9. close with tests, docs, and manual QA

### 2.4 OpenCode-Style Auth Store Simplification (Active)

**Product goal:** keep the shipped OpenAI dual-auth surface, but remove the visible vault/passphrase UX so auth feels closer to OpenCode.

#### Target UX shape

- No primary `Initialize vault` / `Unlock vault` / passphrase steps in normal auth setup.
- `OpenAI` still shows exactly:
  1. `ChatGPT Pro/Plus (browser)`
  2. `Manually enter API Key`
- API keys and long-lived browser-account material persist in extension-owned local storage.
- Helper availability stays honest: if no helper exists, the browser-account lane still shows `helper-missing` rather than pretending success.

#### Architectural shift

The current implementation uses a passphrase-backed `CredentialVault`. The next planned simplification replaces that user-facing vault UX with an app-managed auth store that behaves more like OpenCode's local `auth.json` model.

| Layer                    | Current model                                      | Planned model                                              |
| ------------------------ | -------------------------------------------------- | ---------------------------------------------------------- |
| User UX                  | visible vault + passphrase                         | no visible vault/passphrase in primary flow                |
| Durable store            | encrypted vault metadata + encrypted payload store | extension-owned local auth store in `chrome.storage.local` |
| Runtime session material | memory-only                                        | memory-only                                                |
| Secret owner             | background                                         | background                                                 |
| Browser sync             | none for secrets                                   | none for secrets                                           |

#### Chrome extension equivalent of OpenCode auth storage

- OpenCode stores auth persistently in local app data.
- For this extension, the closest equivalent is **extension-owned `chrome.storage.local`**, not `chrome.storage.sync`, not a content-script store, and not a native OS keychain.
- This improves usability, but it is **not** equivalent to a user-held passphrase vault for at-rest protection.

#### Planned auth-store rule

```
Options / Popup / Sidepanel
  -> request auth state or auth actions from background
  -> background reads/writes extension-owned auth store
  -> only masked metadata/status returns to UI

Background runtime
  -> resolves API key or browser-account durable material
  -> derives memory-only runtime session/access token
  -> never exposes raw token/artifact/helper payload to UI
```

This direction is locked by `docs/task-os-01-opencode-style-auth-store-adr.md`.

#### Migration rule

- Add the new auth store first.
- Read-path bridge from new auth store -> old vault.
- New writes go only to the new auth store once the bridge lands.
- Remove vault UX only after migration and regressions are stable.

#### Guardrails

- no `chrome.storage.sync` for secrets
- no cookie/localStorage/sessionStorage scraping
- no raw helper payloads, callback URLs, `state`, or `nonce` in UI-facing data
- no persistence of short-lived runtime/session tokens
- helper/deep-link results must still pass provenance + request binding validation before persistence
- document clearly that this is a convenience-first model, not stronger at-rest security than a passphrase vault
- keep the background as the only trusted owner of durable auth material during and after migration

#### Expected file touchpoints for this phase

- `src/shared/types/storage.ts`
- `src/shared/types/messages.ts`
- `src/background/credential-vault.ts` (transition/shim stage)
- new app-managed auth store module under `src/background/` or `src/shared/`
- `src/background/ui-session-runtime.ts`
- `src/options/App.tsx`
- `src/options/onboarding/OnboardingFlow.tsx`
- `src/popup/App.tsx`
- `src/sidepanel/App.tsx`
- E2E harness/tests under `src/test/e2e/`

#### Delivery order

1. lock ADR and trade-off disclosure
2. redesign durable auth schema
3. lock background-only secret ownership
4. implement vault -> auth-store migration bridge
5. replace vault-lock readiness semantics
6. simplify Options/onboarding/popup/sidepanel UX
7. expand regression and E2E coverage
8. remove legacy vault UX/code after rollout is stable

---

## 3. Module Blueprint

### 3.1 Module Map

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          MODULE DEPENDENCY MAP                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│                        ┌─────────────────┐                              │
│                        │  ORCHESTRATOR   │                              │
│                        │  (Entry Point)  │                              │
│                        └────────┬────────┘                              │
│                                 │                                       │
│              ┌──────────────────┼──────────────────┐                    │
│              │                  │                  │                    │
│              ▼                  ▼                  ▼                    │
│   ┌─────────────────┐ ┌───────────────┐ ┌─────────────────┐           │
│   │  SESSION MGR    │ │  AI CLIENT    │ │ BROWSER CTRL    │           │
│   │                 │ │  MANAGER      │ │                 │           │
│   │ • createSession │ │               │ │ • executeAction │           │
│   │ • buildContext  │ │ • chat()      │ │ • captureScreen │           │
│   │ • undo/redo     │ │ • stream()    │ │ • manageTabs    │           │
│   └────────┬────────┘ └───────┬───────┘ └────────┬────────┘           │
│            │                  │                   │                    │
│            │                  ▼                   ▼                    │
│            │         ┌───────────────┐  ┌─────────────────┐           │
│            │         │ CMD PARSER    │  │ CONTENT BRIDGE  │           │
│            │         │               │  │                 │           │
│            │         │ • parseAI()   │  │ • sendToCS()    │           │
│            │         │ • validate()  │  │ • receiveFromCS │           │
│            │         │ • sanitize()  │  │ • injectScript  │           │
│            │         └───────┬───────┘  └────────┬────────┘           │
│            │                 │                    │                    │
│            │                 ▼                    ▼                    │
│            │         ┌───────────────┐  ┌─────────────────┐           │
│            │         │ ACTION SCHEMA │  │ CONTENT SCRIPTS │           │
│            │         │ (Zod)         │  │                 │           │
│            └─────────┤               │  │ • DOM Engine    │           │
│                      │ • validation  │  │ • Event Sim     │           │
│                      │ • security    │  │ • Visual Engine │           │
│                      └───────────────┘  └─────────────────┘           │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    SHARED / CROSS-CUTTING                        │   │
│  │  Storage · Encryption · Logger · Errors · Protocol · Utils      │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Module Details

#### MODULE 1: AI Client Manager

**Assigned to:** `@sub-tech-lead`

| Aspect         | Detail                                                            |
| -------------- | ----------------------------------------------------------------- |
| **Purpose**    | Communicate with AI providers, manage streaming, handle errors    |
| **Key Files**  | `src/core/ai-client/manager.ts`, `providers/*.ts`, `prompts/*.ts` |
| **Interfaces** | `IAIProvider`, `IAIClientManager` (see ARCHITECTURE.md)           |
| **Providers**  | Claude, GPT-4o, Gemini, Ollama, OpenRouter                        |
| **Features**   | Streaming, token counting, auto-retry, provider fallback          |
| **Security**   | API keys encrypted (AES-256-GCM), never logged                    |
| **Tests**      | Mock fetch, streaming parser tests, error scenarios               |

#### MODULE 2: Command Parser & Validator

**Assigned to:** `@sub-tech-lead` + `@sub-security-auditor`

| Aspect           | Detail                                                              |
| ---------------- | ------------------------------------------------------------------- |
| **Purpose**      | Parse AI JSON responses into validated, safe action sequences       |
| **Key Files**    | `src/core/command-parser/parser.ts`, `validator.ts`, `sanitizer.ts` |
| **Action Types** | 30+ types (see ARCHITECTURE.md ActionType union)                    |
| **Validation**   | Zod schemas for every action type                                   |
| **Security**     | URL blocklist, selector sanitization, sensitivity classification    |
| **Tests**        | Valid/invalid action parsing, injection attempts, edge cases        |

#### MODULE 3: Browser Controller

**Assigned to:** `@sub-tech-lead`

| Aspect           | Detail                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| **Purpose**      | Execute validated actions via chrome APIs (scripting + debugger)                                             |
| **Key Files**    | `src/core/browser-controller/controller.ts`, `tab-manager.ts`, `debugger-adapter.ts`, `scripting-adapter.ts` |
| **Strategy**     | Hybrid: Content Script primary, CDP fallback                                                                 |
| **Features**     | Auto-wait, retry with alternative selectors, action queue                                                    |
| **CDP Commands** | DOM, Input, Page, Network, Emulation, Runtime                                                                |
| **Tests**        | Mock chrome APIs, action execution tests                                                                     |

#### MODULE 4: Content Script Engine

**Assigned to:** `@sub-tech-lead` + `@sub-qa-tester`

| Aspect              | Detail                                                             |
| ------------------- | ------------------------------------------------------------------ |
| **Purpose**         | DOM interaction, event simulation, visual feedback on target pages |
| **Key Files**       | `src/content/dom/*.ts`, `actions/*.ts`, `visual/*.ts`              |
| **Selector Engine** | CSS, XPath, text, ARIA label, placeholder, testId, nearText        |
| **Event Sim**       | MouseEvent, KeyboardEvent, InputEvent, FocusEvent dispatch         |
| **Auto-Wait**       | MutationObserver + polling + requestAnimationFrame                 |
| **Visual**          | Element highlighting, action overlay, progress indicator           |
| **Security**        | Isolated world, input sanitization, PII redaction                  |

#### MODULE 5: Session Manager

**Assigned to:** `@sub-tech-lead`

| Aspect        | Detail                                                               |
| ------------- | -------------------------------------------------------------------- |
| **Purpose**   | Manage conversation sessions, context building, action history       |
| **Key Files** | `src/core/session/manager.ts`, `context-builder.ts`, `history.ts`    |
| **Features**  | Multi-session, pause/resume, undo, context compression               |
| **Context**   | Progressive loading: URL+title → DOM summary → full DOM → screenshot |
| **Storage**   | Conversation history in chrome.storage.local                         |

#### MODULE 6: Orchestrator Engine

**Assigned to:** `@sub-tech-lead`

| Aspect             | Detail                                                                       |
| ------------------ | ---------------------------------------------------------------------------- |
| **Purpose**        | Coordinate all modules: receive user input → AI → parse → execute → feedback |
| **Key Files**      | `src/background/orchestrator.ts`                                             |
| **Features**       | Action queue, priority system, error recovery, rate limiting                 |
| **Error Recovery** | 3-level: retry same → retry alternative → ask user                           |
| **Kill Switch**    | Immediate halt of all operations                                             |

#### MODULE 7: Presentation Layer

**Assigned to:** `@sub-ui-designer`

| Aspect         | Detail                                                          |
| -------------- | --------------------------------------------------------------- |
| **Purpose**    | All user-facing UI: Side Panel, Popup, Options, In-Page Overlay |
| **Tech**       | React 18 + Tailwind CSS + shadcn/ui + Lucide Icons              |
| **Side Panel** | Chat interface, action log, progress bar, quick actions         |
| **Popup**      | Quick access, current page info, recent commands                |
| **Options**    | Provider settings, permissions, appearance, data management     |
| **Overlay**    | Element highlight, action indicator, floating status            |
| **Onboarding** | 4-step flow: Welcome → Connect AI → Permissions → Ready         |
| **a11y**       | WCAG 2.1 AA, keyboard navigation, screen reader support         |

#### MODULE 8: Security Layer

**Assigned to:** `@sub-security-auditor`

| Aspect             | Detail                                                                     |
| ------------------ | -------------------------------------------------------------------------- |
| **Purpose**        | Cross-cutting security: encryption, validation, PII detection              |
| **Key Files**      | `src/shared/storage/encryption.ts`, `src/core/command-parser/sanitizer.ts` |
| **Encryption**     | AES-256-GCM for API keys, PBKDF2 key derivation                            |
| **PII**            | SSN, CC, email, phone, API key pattern detection & redaction               |
| **Prompt Defense** | 5-layer defense (see SECURITY.md)                                          |
| **Audit Log**      | Sensitive operations logged with timestamps                                |

---

## 4. Implementation Plan with Subagent Assignments

### 4.1 Assignment Matrix

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     SUBAGENT ASSIGNMENT MATRIX                                   │
├───────────────────────┬────────────────────────────────────────────────────────┤
│ @sub-tech-lead        │ Core modules, API design, build system, architecture   │
│                       │ Modules: 1, 2, 3, 4, 5, 6                             │
│                       │ Files: src/core/**, src/background/**, src/content/** │
│                       │ Also: manifest.json, vite.config, tsconfig            │
├───────────────────────┼────────────────────────────────────────────────────────┤
│ @sub-ui-designer      │ All UI components, design system, UX flows            │
│                       │ Module: 7                                              │
│                       │ Files: src/sidepanel/**, src/popup/**, src/options/**  │
│                       │ Also: tailwind.config, design tokens, CSS             │
├───────────────────────┼────────────────────────────────────────────────────────┤
│ @sub-security-auditor │ Security layer, threat mitigations, audit             │
│                       │ Module: 8 + review all modules                        │
│                       │ Files: src/shared/storage/encryption.ts               │
│                       │        src/core/command-parser/sanitizer.ts           │
│                       │        src/core/command-parser/validator.ts           │
│                       │ Also: Security review of every PR                     │
├───────────────────────┼────────────────────────────────────────────────────────┤
│ @sub-qa-tester        │ Test suites, CI/CD, quality gates                     │
│                       │ All test files in tests/**                             │
│                       │ Also: vitest.config, playwright.config                │
│                       │ Responsible for: test coverage, E2E, load tests       │
└───────────────────────┴────────────────────────────────────────────────────────┘
```

### 4.2 Per-Task Subagent Delegation

#### PHASE 1: Foundation (Week 1-4)

| Task ID | Task                                     | Primary                 | Support                 | Deliverable                        |
| ------- | ---------------------------------------- | ----------------------- | ----------------------- | ---------------------------------- |
| F-01    | Project scaffolding (Vite + CRXJS + TS)  | `@sub-tech-lead`        | —                       | Build system, manifest.json        |
| F-02    | Design token system & Tailwind config    | `@sub-ui-designer`      | —                       | design-tokens.css, tailwind.config |
| F-03    | Shared types & interfaces                | `@sub-tech-lead`        | `@sub-security-auditor` | src/shared/\*\* types              |
| F-04    | Storage layer + encryption               | `@sub-tech-lead`        | `@sub-security-auditor` | encryption.ts, storage API         |
| F-05    | Message protocol & bridge                | `@sub-tech-lead`        | `@sub-qa-tester`        | Protocol types, bridge impl        |
| F-06    | Error handling framework                 | `@sub-tech-lead`        | —                       | Error codes, ExtensionError        |
| F-07    | Unit test setup (Vitest)                 | `@sub-qa-tester`        | —                       | vitest.config, test helpers        |
| F-08    | CI/CD pipeline (GitHub Actions)          | `@sub-qa-tester`        | —                       | .github/workflows/\*               |
| F-09    | Security controls implementation         | `@sub-security-auditor` | `@sub-tech-lead`        | Sanitizer, validator, PII          |
| F-10    | Base UI components (Button, Input, etc.) | `@sub-ui-designer`      | —                       | src/sidepanel/components/common/\* |

#### PHASE 2: Core Engine (Week 5-10)

| Task ID | Task                                       | Primary                 | Support                 | Deliverable                |
| ------- | ------------------------------------------ | ----------------------- | ----------------------- | -------------------------- |
| C-01    | AI Client: Abstract provider interface     | `@sub-tech-lead`        | —                       | IAIProvider impl           |
| C-02    | AI Client: Claude provider                 | `@sub-tech-lead`        | —                       | claude.ts                  |
| C-03    | AI Client: OpenAI provider                 | `@sub-tech-lead`        | —                       | openai.ts                  |
| C-04    | AI Client: Gemini provider                 | `@sub-tech-lead`        | —                       | gemini.ts                  |
| C-05    | AI Client: Ollama/OpenRouter               | `@sub-tech-lead`        | —                       | ollama.ts, openrouter.ts   |
| C-06    | AI Client: Streaming engine                | `@sub-tech-lead`        | —                       | Stream parsing + buffering |
| C-07    | System prompt engineering                  | `@sub-tech-lead`        | `@sub-security-auditor` | prompts/system.ts          |
| C-08    | Command Parser: JSON parsing               | `@sub-tech-lead`        | —                       | parser.ts                  |
| C-09    | Command Parser: Zod schemas                | `@sub-tech-lead`        | `@sub-security-auditor` | action-schemas.ts          |
| C-10    | Command Parser: Sanitizer                  | `@sub-security-auditor` | `@sub-tech-lead`        | sanitizer.ts               |
| C-11    | Browser Controller: Tab manager            | `@sub-tech-lead`        | —                       | tab-manager.ts             |
| C-12    | Browser Controller: Scripting adapter      | `@sub-tech-lead`        | —                       | scripting-adapter.ts       |
| C-13    | Browser Controller: Debugger (CDP) adapter | `@sub-tech-lead`        | —                       | debugger-adapter.ts        |
| C-14    | Content Script: Selector engine            | `@sub-tech-lead`        | `@sub-qa-tester`        | selector.ts                |
| C-15    | Content Script: Click/hover/focus          | `@sub-tech-lead`        | —                       | click.ts                   |
| C-16    | Content Script: Fill/type/select           | `@sub-tech-lead`        | —                       | fill.ts, type.ts           |
| C-17    | Content Script: Scroll actions             | `@sub-tech-lead`        | —                       | scroll.ts                  |
| C-18    | Content Script: Extract/screenshot         | `@sub-tech-lead`        | —                       | extract.ts                 |
| C-19    | Content Script: DOM inspector              | `@sub-tech-lead`        | —                       | inspector.ts               |
| C-20    | Content Script: Auto-wait engine           | `@sub-tech-lead`        | —                       | MutationObserver + polling |
| C-21    | Session Manager: Core impl                 | `@sub-tech-lead`        | —                       | manager.ts                 |
| C-22    | Session Manager: Context builder           | `@sub-tech-lead`        | `@sub-security-auditor` | context-builder.ts         |
| C-23    | Orchestrator: Action queue + execution     | `@sub-tech-lead`        | —                       | orchestrator.ts            |
| C-24    | Orchestrator: Error recovery               | `@sub-tech-lead`        | —                       | Retry + fallback logic     |
| C-25    | Unit tests for ALL core modules            | `@sub-qa-tester`        | `@sub-tech-lead`        | tests/unit/\*\*            |
| C-26    | Security review of core modules            | `@sub-security-auditor` | —                       | Security findings report   |

#### PHASE 3: UI & Integration (Week 11-14)

| Task ID | Task                                               | Primary                 | Support                 | Deliverable            |
| ------- | -------------------------------------------------- | ----------------------- | ----------------------- | ---------------------- |
| U-01    | Side Panel: Chat container                         | `@sub-ui-designer`      | —                       | ChatContainer.tsx      |
| U-02    | Side Panel: Message bubbles (user/AI/action/error) | `@sub-ui-designer`      | —                       | MessageBubble.tsx      |
| U-03    | Side Panel: Input area + commands                  | `@sub-ui-designer`      | —                       | InputArea.tsx          |
| U-04    | Side Panel: Action log panel                       | `@sub-ui-designer`      | —                       | ActionLogPanel.tsx     |
| U-05    | Side Panel: Action progress/timeline               | `@sub-ui-designer`      | —                       | ActionTimeline.tsx     |
| U-06    | Popup: Quick actions + page info                   | `@sub-ui-designer`      | —                       | Popup App.tsx          |
| U-07    | Options: Provider settings                         | `@sub-ui-designer`      | `@sub-security-auditor` | API key input (secure) |
| U-08    | Options: Permission toggles                        | `@sub-ui-designer`      | —                       | Permission settings    |
| U-09    | Options: Appearance (theme, lang)                  | `@sub-ui-designer`      | —                       | Theme switcher         |
| U-10    | Onboarding: 4-step flow                            | `@sub-ui-designer`      | —                       | Onboarding components  |
| U-11    | In-Page: Element highlight overlay                 | `@sub-ui-designer`      | `@sub-tech-lead`        | highlight.ts           |
| U-12    | In-Page: Action status overlay                     | `@sub-ui-designer`      | `@sub-tech-lead`        | overlay.ts             |
| U-13    | Dark/Light mode                                    | `@sub-ui-designer`      | —                       | Theme system           |
| U-14    | Keyboard shortcuts                                 | `@sub-ui-designer`      | `@sub-tech-lead`        | Shortcut system        |
| U-15    | Integration: Connect UI ↔ Service Worker           | `@sub-tech-lead`        | `@sub-ui-designer`      | Hooks + stores         |
| U-16    | Integration: E2E flow test                         | `@sub-qa-tester`        | All agents              | Full pipeline test     |
| U-17    | Accessibility audit                                | `@sub-ui-designer`      | `@sub-qa-tester`        | WCAG 2.1 AA compliance |
| U-18    | Security audit of UI layer                         | `@sub-security-auditor` | `@sub-ui-designer`      | XSS, injection review  |

#### PHASE 4: Advanced Features (Week 15-18)

| Task ID | Task                             | Primary            | Support                 | Deliverable                            |
| ------- | -------------------------------- | ------------------ | ----------------------- | -------------------------------------- |
| A-01    | CDP: Network interception        | `@sub-tech-lead`   | —                       | Network.\* CDP commands                |
| A-02    | CDP: Device emulation            | `@sub-tech-lead`   | —                       | Emulation.\* commands                  |
| A-03    | CDP: Geolocation mock            | `@sub-tech-lead`   | —                       | setGeolocationOverride                 |
| A-04    | CDP: PDF generation              | `@sub-tech-lead`   | —                       | Page.printToPDF                        |
| A-05    | CDP: File upload                 | `@sub-tech-lead`   | —                       | DOM.setFileInputFiles                  |
| A-06    | Frame-aware iframe support       | `@sub-tech-lead`   | —                       | `all_frames` + targeted bridge routing |
| A-07    | Multi-tab automation             | `@sub-tech-lead`   | —                       | Cross-tab orchestration                |
| A-08    | Action recording (watch & learn) | `@sub-tech-lead`   | `@sub-ui-designer`      | Record user actions                    |
| A-09    | Action playback (macros)         | `@sub-tech-lead`   | `@sub-ui-designer`      | Replay saved sequences                 |
| A-10    | Export actions as script         | `@sub-tech-lead`   | —                       | JSON/Playwright export                 |
| A-11    | Saved workflows (templates)      | `@sub-ui-designer` | `@sub-tech-lead`        | Workflow manager UI                    |
| A-12    | Advanced prompt templates        | `@sub-tech-lead`   | `@sub-security-auditor` | Template library                       |

> Execution note: `A-04` stays in scope, but implementation priority is currently `A-05 -> A-06 -> A-04` because upload and iframe support unlock more core browser-control flows.

#### PHASE 5: Polish & Ship (Week 19-20)

| Task ID | Task                           | Primary                 | Support                 | Deliverable           |
| ------- | ------------------------------ | ----------------------- | ----------------------- | --------------------- |
| P-01    | Performance optimization       | `@sub-tech-lead`        | `@sub-qa-tester`        | Bundle size, memory   |
| P-02    | E2E test suite (50+ scenarios) | `@sub-qa-tester`        | All agents              | tests/e2e/\*\*        |
| P-03    | Penetration testing            | `@sub-security-auditor` | `@sub-qa-tester`        | Security report       |
| P-04    | Chrome Web Store compliance    | `@sub-security-auditor` | —                       | Policy checklist      |
| P-05    | Documentation                  | All agents              | —                       | README, CONTRIBUTING  |
| P-06    | Beta testing with real users   | `@sub-qa-tester`        | All agents              | Bug reports, feedback |
| P-07    | Final security audit           | `@sub-security-auditor` | —                       | Sign-off              |
| P-08    | Chrome Web Store submission    | `@sub-tech-lead`        | `@sub-security-auditor` | Published extension   |

> P-08a asset pack: five store-ready Chrome Web Store screenshots now live in `store-assets/`, with captions and file mapping tracked in `STORE_SCREENSHOTS.md`.

---

## 5. File Structure

```
ai-browser-controller/
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                          # @sub-qa-tester
│   │   ├── release.yml                     # @sub-qa-tester
│   │   └── security-scan.yml              # @sub-security-auditor
│   └── ISSUE_TEMPLATE/
│       ├── bug_report.md                   # @sub-qa-tester
│       └── feature_request.md
│
├── docs/
│   ├── BLUEPRINT.md                        # This file
│   ├── ARCHITECTURE.md                     # @sub-tech-lead
│   ├── DESIGN.md                           # @sub-ui-designer
│   ├── TESTING.md                          # @sub-qa-tester
│   ├── SECURITY.md                         # @sub-security-auditor
│   └── ROADMAP.md                          # All agents
│
├── src/
│   ├── manifest.json                       # @sub-tech-lead + @sub-security-auditor
│   │
│   ├── background/                         # @sub-tech-lead
│   │   ├── index.ts                        #   Entry point
│   │   ├── orchestrator.ts                 #   Main orchestrator
│   │   └── listeners.ts                    #   Chrome event listeners
│   │
│   ├── content/                            # @sub-tech-lead
│   │   ├── index.ts                        #   Entry point
│   │   ├── bridge.ts                       #   Message bridge
│   │   ├── dom/
│   │   │   ├── inspector.ts                #   DOM analysis
│   │   │   ├── selector.ts                 #   Multi-strategy selector
│   │   │   └── mutations.ts                #   MutationObserver
│   │   ├── actions/
│   │   │   ├── click.ts                    #   Click/hover/focus
│   │   │   ├── fill.ts                     #   Fill/type/select
│   │   │   ├── scroll.ts                   #   Scroll actions
│   │   │   ├── extract.ts                  #   Extract text/attributes
│   │   │   ├── keyboard.ts                 #   Keyboard simulation
│   │   │   └── index.ts                    #   Action executor
│   │   └── visual/                         # @sub-ui-designer + @sub-tech-lead
│   │       ├── highlight.ts                #   Element highlighting
│   │       └── overlay.ts                  #   Action overlay
│   │
│   ├── sidepanel/                          # @sub-ui-designer
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── Chat/
│   │   │   │   ├── ChatContainer.tsx
│   │   │   │   ├── MessageList.tsx
│   │   │   │   ├── MessageBubble.tsx
│   │   │   │   ├── InputArea.tsx
│   │   │   │   └── ActionPreview.tsx
│   │   │   ├── ActionLog/
│   │   │   │   ├── ActionLogPanel.tsx
│   │   │   │   ├── ActionItem.tsx
│   │   │   │   └── ActionTimeline.tsx
│   │   │   └── common/
│   │   │       ├── Button.tsx
│   │   │       ├── Input.tsx
│   │   │       ├── Badge.tsx
│   │   │       ├── Card.tsx
│   │   │       ├── Modal.tsx
│   │   │       └── Spinner.tsx
│   │   ├── hooks/
│   │   │   ├── useSession.ts
│   │   │   ├── useChat.ts
│   │   │   ├── useActionLog.ts
│   │   │   └── usePageContext.ts
│   │   └── store/
│   │       ├── sessionStore.ts
│   │       ├── chatStore.ts
│   │       └── uiStore.ts
│   │
│   ├── popup/                              # @sub-ui-designer
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   └── components/
│   │       ├── QuickActions.tsx
│   │       ├── PageInfo.tsx
│   │       └── RecentCommands.tsx
│   │
│   ├── options/                            # @sub-ui-designer + @sub-security-auditor
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   └── components/
│   │       ├── ProviderSettings.tsx
│   │       ├── PermissionSettings.tsx
│   │       ├── AppearanceSettings.tsx
│   │       └── DataSettings.tsx
│   │
│   ├── onboarding/                         # @sub-ui-designer
│   │   ├── index.html
│   │   ├── main.tsx
│   │   └── components/
│   │       ├── Welcome.tsx
│   │       ├── ConnectAI.tsx
│   │       ├── PermissionExplain.tsx
│   │       └── Ready.tsx
│   │
│   ├── core/                               # @sub-tech-lead
│   │   ├── ai-client/
│   │   │   ├── types.ts
│   │   │   ├── interfaces.ts
│   │   │   ├── manager.ts
│   │   │   ├── providers/
│   │   │   │   ├── base.ts
│   │   │   │   ├── claude.ts
│   │   │   │   ├── openai.ts
│   │   │   │   ├── gemini.ts
│   │   │   │   ├── ollama.ts
│   │   │   │   └── openrouter.ts
│   │   │   └── prompts/
│   │   │       ├── system.ts
│   │   │       └── templates.ts
│   │   │
│   │   ├── command-parser/                 # @sub-tech-lead + @sub-security-auditor
│   │   │   ├── types.ts
│   │   │   ├── parser.ts
│   │   │   ├── validator.ts                #   @sub-security-auditor reviews
│   │   │   ├── sanitizer.ts               #   @sub-security-auditor owns
│   │   │   └── schemas/
│   │   │       └── action-schemas.ts
│   │   │
│   │   ├── browser-controller/
│   │   │   ├── types.ts
│   │   │   ├── controller.ts
│   │   │   ├── tab-manager.ts
│   │   │   ├── debugger-adapter.ts
│   │   │   └── scripting-adapter.ts
│   │   │
│   │   ├── bridge/
│   │   │   ├── types.ts
│   │   │   ├── service-worker-bridge.ts
│   │   │   └── content-script-bridge.ts
│   │   │
│   │   └── session/
│   │       ├── types.ts
│   │       ├── manager.ts
│   │       ├── context-builder.ts          #   @sub-security-auditor reviews
│   │       └── history.ts
│   │
│   ├── shared/                             # @sub-tech-lead + @sub-security-auditor
│   │   ├── constants.ts
│   │   ├── utils/
│   │   │   ├── id.ts
│   │   │   ├── retry.ts
│   │   │   ├── timeout.ts
│   │   │   └── logger.ts
│   │   ├── storage/
│   │   │   ├── schema.ts
│   │   │   ├── index.ts
│   │   │   └── encryption.ts              #   @sub-security-auditor owns
│   │   ├── protocol/
│   │   │   └── messages.ts
│   │   ├── errors/
│   │   │   ├── codes.ts
│   │   │   └── handler.ts
│   │   └── security/                       #   @sub-security-auditor owns
│   │       ├── pii-detector.ts
│   │       ├── url-validator.ts
│   │       └── audit-logger.ts
│   │
│   └── assets/
│       ├── icons/
│       │   ├── icon-16.png
│       │   ├── icon-32.png
│       │   ├── icon-48.png
│       │   └── icon-128.png
│       └── styles/
│           ├── globals.css
│           └── design-tokens.css           #   @sub-ui-designer
│
├── tests/                                  # @sub-qa-tester
│   ├── unit/
│   │   ├── ai-client/
│   │   ├── command-parser/
│   │   ├── browser-controller/
│   │   ├── content-scripts/
│   │   └── session/
│   ├── integration/
│   │   ├── bridge.test.ts
│   │   ├── orchestrator.test.ts
│   │   └── storage.test.ts
│   ├── e2e/
│   │   ├── navigation.spec.ts
│   │   ├── form-filling.spec.ts
│   │   ├── click-interaction.spec.ts
│   │   ├── screenshot.spec.ts
│   │   └── multi-tab.spec.ts
│   ├── security/                           # @sub-security-auditor + @sub-qa-tester
│   │   ├── prompt-injection.test.ts
│   │   ├── xss.test.ts
│   │   ├── encryption.test.ts
│   │   └── pii-detection.test.ts
│   ├── fixtures/
│   │   ├── mock-pages/
│   │   ├── mock-ai-responses/
│   │   └── mock-chrome-apis/
│   └── helpers/
│       ├── chrome-mock.ts
│       ├── ai-mock.ts
│       └── dom-mock.ts
│
├── package.json                            # @sub-tech-lead
├── tsconfig.json                           # @sub-tech-lead
├── vite.config.ts                          # @sub-tech-lead
├── tailwind.config.js                      # @sub-ui-designer
├── postcss.config.js                       # @sub-ui-designer
├── vitest.config.ts                        # @sub-qa-tester
├── playwright.config.ts                    # @sub-qa-tester
├── .eslintrc.js                            # @sub-tech-lead
├── .prettierrc                             # @sub-tech-lead
└── .gitignore
```

---

## 6. Technology Stack

| Category     | Technology                 | Version         | Owner                   |
| ------------ | -------------------------- | --------------- | ----------------------- |
| Language     | TypeScript                 | 5.5+            | `@sub-tech-lead`        |
| Build        | Vite + CRXJS               | 5.4+ / 2.0-beta | `@sub-tech-lead`        |
| UI Framework | React                      | 18.3+           | `@sub-ui-designer`      |
| State        | Zustand                    | 4.5+            | `@sub-tech-lead`        |
| Server State | TanStack Query             | 5.0+            | `@sub-tech-lead`        |
| Styling      | Tailwind CSS               | 3.4+            | `@sub-ui-designer`      |
| Components   | shadcn/ui                  | latest          | `@sub-ui-designer`      |
| Icons        | Lucide React               | 0.400+          | `@sub-ui-designer`      |
| Validation   | Zod                        | 3.23+           | `@sub-tech-lead`        |
| IDs          | nanoid                     | 5.0+            | `@sub-tech-lead`        |
| Markdown     | marked + DOMPurify         | latest          | `@sub-security-auditor` |
| Encryption   | Web Crypto API             | native          | `@sub-security-auditor` |
| Unit Test    | Vitest                     | 2.0+            | `@sub-qa-tester`        |
| E2E Test     | Playwright                 | 1.45+           | `@sub-qa-tester`        |
| Linting      | ESLint + typescript-eslint | 9.x / 8.x       | `@sub-tech-lead`        |
| Formatting   | Prettier                   | 3.3+            | `@sub-tech-lead`        |
| Git Hooks    | Husky + lint-staged        | 9.x / 15.x      | `@sub-qa-tester`        |

---

## 7. Quality Gates

### 7.1 Per-PR Gates

| Gate                   | Tool           | Threshold                | Enforced By             |
| ---------------------- | -------------- | ------------------------ | ----------------------- |
| TypeScript compilation | `tsc --noEmit` | 0 errors                 | `@sub-tech-lead`        |
| Lint                   | ESLint         | 0 errors, 0 warnings     | `@sub-tech-lead`        |
| Format                 | Prettier       | All files formatted      | `@sub-tech-lead`        |
| Unit tests             | Vitest         | 100% pass, 80%+ coverage | `@sub-qa-tester`        |
| Bundle size            | Vite build     | < 500KB (gzip)           | `@sub-tech-lead`        |
| Security scan          | npm audit      | 0 high/critical          | `@sub-security-auditor` |

### 7.2 Per-Phase Gates

| Phase   | Gate                                        | Responsible             |
| ------- | ------------------------------------------- | ----------------------- |
| Phase 1 | Build succeeds, all shared types compile    | `@sub-tech-lead`        |
| Phase 2 | Core modules 80%+ unit test coverage        | `@sub-qa-tester`        |
| Phase 3 | Full E2E: user input → AI → action → result | `@sub-qa-tester`        |
| Phase 4 | Security audit passed                       | `@sub-security-auditor` |
| Phase 5 | Chrome Web Store policy compliance          | `@sub-security-auditor` |

---

## 8. Risk Registry

| ID  | Risk                                   | Probability | Impact   | Mitigation                              | Owner                   |
| --- | -------------------------------------- | ----------- | -------- | --------------------------------------- | ----------------------- |
| R1  | AI generates harmful actions           | High        | Critical | 5-layer defense, action whitelist       | `@sub-security-auditor` |
| R2  | Content script blocked by site CSP     | Medium      | High     | Fallback to CDP                         | `@sub-tech-lead`        |
| R3  | chrome.debugger banner annoys users    | High        | Medium   | Use CS by default, CDP only when needed | `@sub-tech-lead`        |
| R4  | AI response parsing fails              | Medium      | Medium   | Robust parser, retry with clarification | `@sub-tech-lead`        |
| R5  | Service Worker killed by Chrome        | High        | Medium   | Keep-alive strategy, state persistence  | `@sub-tech-lead`        |
| R6  | API key leaked in error/log            | Low         | Critical | Encryption, never log keys              | `@sub-security-auditor` |
| R7  | Extension rejected by Chrome Web Store | Medium      | High     | Pre-submission compliance check         | `@sub-security-auditor` |
| R8  | Poor performance on complex pages      | Medium      | Medium   | Progressive context, throttling         | `@sub-tech-lead`        |
| R9  | Cross-origin iframe issues             | Medium      | Medium   | CDP Target.attachToTarget               | `@sub-tech-lead`        |
| R10 | User accidentally triggers purchases   | Medium      | Critical | Confirmation for all payment actions    | `@sub-security-auditor` |

---

## 9. Mandatory Development Workflow

> **This section is NORMATIVE.** Every agent session MUST follow this workflow. No exceptions.
> **Enforcement:** This workflow applies to EVERY phase, EVERY task, EVERY time the user issues a command to the agent.

### 9.1 Phase-Level Planning (MANDATORY FIRST STEP)

When the user instructs the agent to work on a phase or a group of tasks:

1. **READ** this section (§9) and the relevant phase details in ROADMAP.md
2. **CREATE a detailed TodoList** using the `todowrite` tool — break the phase into atomic, sequential tasks
3. **ASSIGN each task** in the todolist to exactly ONE sub-agent (see §9.2)
4. **SHOW the todolist** to the user before starting execution
5. **NEVER start coding** without a todolist in place

> ⚠️ **This is non-negotiable.** If the agent starts working without creating a todolist first, the session is considered invalid.

### 9.2 Per-Task Execution Protocol

For **every task** in the todolist, execute the following steps **strictly in order**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  1. PLAN     → Mark task as `in_progress` in todolist (only ONE at    │
│                 a time). Read relevant files for context.              │
│                                                                        │
│  2. DELEGATE → Call the `task` tool with the assigned `subagent_type`  │
│                 to delegate implementation to the correct sub-agent.   │
│                 The prompt MUST include:                                │
│                   - Exact files to modify/create                       │
│                   - Code patterns to follow (reference files)          │
│                   - Acceptance criteria from ROADMAP.md                │
│                   - Constraint: write FULL code, no placeholders      │
│                                                                        │
│  3. REVIEW   → Main agent reads the sub-agent's output.               │
│                 Verifies: correctness, pattern adherence, no regressions│
│                 If NOT OK → provide feedback, re-delegate to sub-agent │
│                                                                        │
│  4. VERIFY   → Run ALL verification gates (§9.4). Every gate must     │
│                 show exit 0. Paste evidence in the response.           │
│                                                                        │
│  5. PASS     → Only if ALL gates pass:                                │
│                   a) Mark task `completed` in todolist                 │
│                   b) Update DELIVERY_TRACKER.md                        │
│                   c) Update ROADMAP.md task status                     │
│                                                                        │
│  6. COMMIT   → Git commit (task files only) + git push origin main    │
│                                                                        │
│  7. NEXT     → Move to next task. NEVER skip ahead.                   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 9.3 Sub-Agent Assignment Rules

| Sub-Agent               | `subagent_type`        | Assigned Work                                                                                    |
| ----------------------- | ---------------------- | ------------------------------------------------------------------------------------------------ |
| `@sub-tech-lead`        | `sub-tech-lead`        | Core logic, managers, adapters, runtime routing, CDP integration, schemas, types, system prompts |
| `@sub-ui-designer`      | `sub-ui-designer`      | UI components, sidepanel, popup, options page, overlays, CSS/styling                             |
| `@sub-qa-tester`        | `sub-qa-tester`        | Unit tests, integration tests, E2E scenarios, test mocks, coverage                               |
| `@sub-security-auditor` | `sub-security-auditor` | Security audit, action classification, permission checks, vulnerability scans                    |

**Delegation rules:**

- The main agent MUST use the `task` tool with the correct `subagent_type` to delegate work
- The main agent MUST NOT implement tasks directly — it only plans, delegates, reviews, and verifies
- If a task spans multiple sub-agent domains, split it into sub-tasks, one per sub-agent
- The sub-agent's prompt must be self-contained: include file paths, code patterns, acceptance criteria
- If a sub-agent's output is rejected, re-delegate with specific feedback (do NOT fix it yourself)

### 9.4 Verification Gates (All Must Pass)

Every task MUST pass **all** gates before being marked PASS:

| Gate                   | Command                           | Pass Criteria                           |
| ---------------------- | --------------------------------- | --------------------------------------- |
| TypeScript             | `pnpm typecheck`                  | Exit 0, no errors                       |
| Unit Tests (selective) | `pnpm vitest run <changed-files>` | All pass                                |
| Full Test Suite        | `pnpm test`                       | All pass (known flaky tests documented) |
| Build                  | `pnpm build`                      | Exit 0, no errors                       |
| Security Regression    | `pnpm audit --audit-level=high`   | No NEW advisories                       |

**Evidence format** — paste in the response:

```
✅ Gate Results for <TASK-ID>:
- TypeScript:  pnpm typecheck       → Exit 0
- Selective:   pnpm vitest run ...  → X/X passed
- Full Suite:  pnpm test            → X/X passed
- Build:       pnpm build           → Exit 0
- Security:    pnpm audit           → No new advisories
```

### 9.5 Completion Recording

When a task passes ALL gates:

1. **TodoList** — Mark task as `completed` via `todowrite` **immediately** (never batch)
2. **DELIVERY_TRACKER.md** — Add/update row with task ID, commit SHA, test count, status `✅ PASS`
3. **ROADMAP.md** — Update task status in the relevant phase table
4. **Git** — Commit only the task's files with message `feat: implement <TASK-ID> <description>`
5. **Push** — `git push origin main` immediately after commit

### 9.6 TodoList Management Rules

| Rule                             | Detail                                                            |
| -------------------------------- | ----------------------------------------------------------------- |
| **Create BEFORE work**           | Todolist must exist before any code is written                    |
| **One `in_progress` at a time**  | Never have multiple tasks in_progress simultaneously              |
| **Mark complete IMMEDIATELY**    | As soon as a task passes, mark it — never batch completions       |
| **Include sub-agent assignment** | Each todo must note which `@sub-*` agent is responsible           |
| **Update on scope change**       | If scope changes mid-phase, update the todolist before proceeding |
| **Todolist = source of truth**   | If it's not in the todolist, it doesn't get done                  |

### 9.7 Hard Rules

| Rule                             | Enforcement                                                       |
| -------------------------------- | ----------------------------------------------------------------- |
| Never skip a task                | Tasks execute in roadmap/todolist order                           |
| Never mark PASS without evidence | All 5 gates must show exit 0                                      |
| Never batch commits              | One commit per task                                               |
| Never leave code broken          | If 3 failures → revert → escalate                                 |
| Never commit unrelated changes   | Only task-scoped files in each commit                             |
| Sub-agent MUST implement         | Main agent delegates via `task` tool, reviews, does NOT implement |
| Never start without todolist     | Phase-level todolist is mandatory before any execution            |
| Never bypass the delegation step | Every implementation task goes through a sub-agent, no exceptions |

---

## 10. A-03 Geolocation Mock — Implementation Guide

> **Status:** A-03.1 through A-03.9 PASS. A-03.10 remains pending because commit/push requires an explicit user request.
> **Pattern Reference:** Follow `A-02 Device Emulation` implementation exactly.
> **CDP method:** `Emulation.setGeolocationOverride` / `Emulation.clearGeolocationOverride`
> **Sensitivity:** `medium` (same as `emulateDevice`)

### 10.1 What's Already Done (A-03.1)

File `src/shared/types/actions.ts` has been modified:

- `'mockGeolocation'` added to `ActionType` union (line ~48)
- `MockGeolocationAction` interface created (lines 308-313):
  ```ts
  export interface MockGeolocationAction extends BaseAction {
    type: 'mockGeolocation';
    latitude: number;
    longitude: number;
    accuracy?: number;
  }
  ```
- `MockGeolocationAction` added to `Action` union type (line ~349)

### 10.2 Remaining Sub-Tasks (Execute in Order)

#### A-03.2: Sensitivity Classification (`@sub-tech-lead`)

**Status:** PASS

**File:** `src/shared/security/action-classifier.ts`
**Location:** `BASE_SENSITIVITY` object, after `emulateDevice: 'medium'` (line ~76)
**Change:** Add `mockGeolocation: 'medium',`

#### A-03.3: Zod Schema (`@sub-tech-lead`)

**Status:** PASS

**File:** `src/core/command-parser/schemas/action-schemas.ts`
**Changes (3 locations):**

1. Add `'mockGeolocation'` to `ACTION_TYPES` array (after `'mockResponse'`, total becomes **35**)
2. Add schema to `actionSchemas` object (after `mockResponse` entry):
   ```ts
   mockGeolocation: z.object({
     type: z.literal('mockGeolocation'),
     description: z.string().optional(),
     latitude: z.number().min(-90).max(90),
     longitude: z.number().min(-180).max(180),
     accuracy: z.number().positive().optional(),
   }),
   ```
3. Add `actionSchemas.mockGeolocation` to `orderedActionSchemas` array (after `actionSchemas.mockResponse`)

#### A-03.4: System Prompt (`@sub-tech-lead`)

**Status:** PASS

**File:** `src/core/ai-client/prompts/system.ts`
**Changes (3 locations):**

1. Add to `ACTION_REFERENCE` in the Advanced section (after `mockResponse`):
   ```
   - mockGeolocation: Set fake GPS coordinates (latitude, longitude, optional accuracy)
   ```
2. Add to compact prompt action list (line ~217 area)
3. Add `'mockGeolocation'` to `SUPPORTED_ACTION_TYPES` array (after `'mockResponse'`, total becomes **35**)

#### A-03.5: CDP Wrappers (`@sub-tech-lead`)

**Status:** PASS

**File:** `src/core/browser-controller/debugger-adapter.ts`
**Location:** After `setTouchEmulationEnabled` method (line ~281 area)
**Changes:**

1. Add `GeolocationOverrideParams` type:
   ```ts
   export type GeolocationOverrideParams = {
     latitude: number;
     longitude: number;
     accuracy?: number;
   };
   ```
2. Add `setGeolocationOverride(tabId: number, params: GeolocationOverrideParams): Promise<void>` method
   - Calls `Emulation.setGeolocationOverride` CDP command
3. Add `clearGeolocationOverride(tabId: number): Promise<void>` method
   - Calls `Emulation.clearGeolocationOverride` CDP command

#### A-03.6: GeolocationMockManager (`@sub-tech-lead`)

**Status:** PASS

**New File:** `src/background/geolocation-mock-manager.ts`
**Pattern:** Copy structure from `src/background/device-emulation-manager.ts`

Key design:

- Interface `IGeolocationMockManager` with methods: `activateSession`, `applyAction`, `clearSession`, `dispose`
- State tracking: `mockByTab` (Map<number, AppliedGeolocationMock>), `tabIdsBySession`, `activeSessionByTab`
- `applyAction(sessionId, tabId, action: MockGeolocationAction)`:
  - Calls `debuggerAdapter.setGeolocationOverride(tabId, { latitude, longitude, accuracy })`
  - Stores applied state
- `clearSession(sessionId)`:
  - For each tab: calls `debuggerAdapter.clearGeolocationOverride(tabId)`
  - Drops state
- `clearTab(tabId)`:
  - Calls `debuggerAdapter.clearGeolocationOverride(tabId)`
  - Drops tab state
- Listen for `debuggerAdapter.onDetach` and `chrome.tabs.onRemoved` → drop state
- `dispose()` cleans up listeners

#### A-03.7: Runtime Routing (`@sub-tech-lead`)

**Status:** PASS

**File:** `src/background/ui-session-runtime.ts`
**Changes (mirror `DeviceEmulationManager` integration exactly):**

1. **Import** `GeolocationMockManager` and `IGeolocationMockManager` from `./geolocation-mock-manager`
2. **Add** `geolocationMockManager?: IGeolocationMockManager` to `UISessionRuntimeOptions`
3. **Add** `private readonly geolocationMockManager: IGeolocationMockManager` property
4. **Init** in constructor (after device emulation manager init):
   ```ts
   this.geolocationMockManager =
     options.geolocationMockManager ??
     new GeolocationMockManager({
       logger: this.logger.child('GeolocationMockManager'),
       debuggerAdapter: this.debuggerAdapter,
     });
   ```
5. **Route** in `executeAutomationAction` switch:
   ```ts
   case 'mockGeolocation':
     return await this.executeGeolocationMockAction(action, sessionId, tabId);
   ```
6. **Add** `executeGeolocationMockAction` private method (mirror `executeDeviceEmulationAction`)
7. **Cleanup** — add `await this.geolocationMockManager.clearSession(...)` in ALL locations where `deviceEmulationManager.clearSession` is called:
   - `handleSessionAbort`
   - `executeNewTabAction`
   - `executeSwitchTabAction`
   - `executeCloseTabAction`
   - `handleSessionSendMessage`
8. **Add** `'mockGeolocation'` to the automation action type guard in `handleSessionSendMessage` (line ~1317 area, next to `'emulateDevice'`)

#### A-03.8: Tests (`@sub-qa-tester`)

**Status:** PASS

**New File:** `src/background/__tests__/geolocation-mock-manager.test.ts`

- Follow `src/background/__tests__/device-emulation-manager.test.ts` pattern
- Test: apply, clear session, clear tab, debugger detach cleanup, tab remove cleanup

**Update existing test files:**

- `src/core/command-parser/__tests__/action-schemas.test.ts` — change count 34→35, add `mockGeolocation` valid payload test
- `src/core/ai-client/__tests__/prompts.test.ts` — change count 34→35
- `src/core/browser-controller/__tests__/debugger-adapter.test.ts` — add `setGeolocationOverride` and `clearGeolocationOverride` tests
- `src/background/__tests__/ui-session-runtime.test.ts` — add geolocation manager stub, routing test for `mockGeolocation`

#### A-03.9: Verification Gates

**Status:** PASS

Observed results:

- `pnpm typecheck` -> pass
- selective Vitest runs for geolocation manager, action schemas, prompts, debugger adapter, and UI session runtime -> pass
- `pnpm test` -> 65 files passed, 1004 tests passed
- `pnpm build` -> pass
- `pnpm audit --audit-level=high` -> no new advisories; only the known pre-existing `rollup` issues via `@crxjs/vite-plugin`

Run in order:

1. `pnpm typecheck` → exit 0
2. `pnpm vitest run src/background/__tests__/geolocation-mock-manager.test.ts` → all pass
3. `pnpm vitest run src/core/command-parser/__tests__/action-schemas.test.ts` → all pass
4. `pnpm vitest run src/core/browser-controller/__tests__/debugger-adapter.test.ts` → all pass
5. `pnpm vitest run src/background/__tests__/ui-session-runtime.test.ts` → all pass
6. `pnpm test` → all pass
7. `pnpm build` → exit 0
8. `pnpm audit --audit-level=high` → no new advisories

#### A-03.10: Record & Ship

**Status:** Pending explicit user request for git commit/push

1. Update `DELIVERY_TRACKER.md` — mark A-03 and all sub-tasks as `[x]`
2. `git add` only A-03 related files
3. `git commit -m "feat: implement A-03 geolocation mock"`
4. `git push origin main`

### 10.3 Known Context

| Item                          | Value                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Action count before A-03      | 34                                                                                                                |
| Action count after A-03       | 35                                                                                                                |
| Test file count (as of A-02)  | 64                                                                                                                |
| Test count (as of A-02)       | 997                                                                                                               |
| Pre-existing audit advisories | 2 high (rollup via @crxjs/vite-plugin) — not a blocker                                                            |
| Known flaky test              | `src/options/__tests__/App.test.tsx > saves provider configuration...` — occasionally times out, passes on re-run |
| Known stderr noise            | React `act()` warnings from sidepanel tests — cosmetic only                                                       |
| Working tree dirty files      | `BLUEPRINT.md`, `ROADMAP.md` (workflow section additions), `actions.ts` (A-03.1 changes) — all uncommitted        |
| Latest pushed commit          | `7d31cbd` — `feat: implement A-02 device emulation`                                                               |
