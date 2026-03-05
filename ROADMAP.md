# AI Browser Controller - Detailed Roadmap

> **Version:** 1.0.0
> **Last Updated:** 2026-03-05
> **Timeline:** 20 weeks (5 phases)
> **Target Release:** v1.0.0 Chrome Web Store

---

## Timeline Overview

```
Week  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20
      ├──────────────┤                                              PHASE 1: Foundation
                     ├─────────────────────────┤                    PHASE 2: Core Engine
                                                ├──────────────┤    PHASE 3: UI & Integration
                                                               ├──────────────┤  PHASE 4: Advanced
                                                                              ├──────┤  PHASE 5: Ship
```

---

## PHASE 1: Foundation (Week 1-4)

**Goal:** Working build system, shared infrastructure, security primitives.
**Exit Criteria:** `pnpm build` produces loadable extension, all shared types compile, tests run.

---

### Sprint 1.1 (Week 1-2): Project Bootstrap

#### `@sub-tech-lead` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| F-01 | Initialize project with Vite + CRXJS + TypeScript | 4h | — | `pnpm dev` starts, HMR works |
| F-01a | Configure tsconfig.json (strict mode, paths) | 1h | F-01 | `tsc --noEmit` passes |
| F-01b | Configure vite.config.ts with CRXJS plugin | 2h | F-01 | Extension loads in Chrome |
| F-01c | Create manifest.json (MV3, permissions) | 2h | F-01 | Chrome accepts manifest |
| F-01d | Setup pnpm workspace, install dependencies | 1h | F-01 | All deps install cleanly |
| F-03 | Define shared TypeScript interfaces | 8h | F-01 | All core types in src/shared/ |
| F-03a | Action types & ElementSelector | 3h | — | All 30+ action types defined |
| F-03b | AI provider interfaces | 2h | — | IAIProvider, IAIClientManager |
| F-03c | Storage schema types | 2h | — | StorageSchema, ExtensionSettings |
| F-03d | Message protocol types | 1h | — | ExtensionMessage, ExtensionResponse |
| F-06 | Error handling framework | 4h | F-03 | ErrorCode enum, ExtensionError class |

#### `@sub-ui-designer` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| F-02 | Design token CSS variables | 4h | — | design-tokens.css with all tokens |
| F-02a | Color palette (light + dark) | 2h | — | 13 semantic color tokens per theme |
| F-02b | Typography, spacing, shadows | 1h | — | Font scale, 4px spacing grid |
| F-02c | Tailwind config with custom tokens | 1h | F-02a | tailwind.config.js extends tokens |
| F-10 | Base UI component library | 8h | F-02 | Button, Input, Badge, Card, Modal, Spinner |
| F-10a | Button component (variants, sizes, states) | 2h | F-02 | Primary, secondary, ghost, danger |
| F-10b | Input component (text, password toggle) | 2h | F-02 | States: default, focus, error, disabled |
| F-10c | Card, Badge, Modal, Spinner | 4h | F-02 | All with dark mode support |

#### `@sub-qa-tester` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| F-07 | Vitest setup with Chrome API mocks | 4h | F-01 | `pnpm test` runs, mock chrome.* works |
| F-07a | vitest.config.ts with JSDOM | 1h | F-01 | Config loads cleanly |
| F-07b | Chrome API mock library | 3h | F-01 | chrome.tabs, storage, scripting mocked |
| F-08 | GitHub Actions CI pipeline | 3h | F-07 | CI runs on PR: lint + type-check + test |
| F-08a | ci.yml (lint, tsc, test, build) | 2h | — | Green pipeline on main |
| F-08b | release.yml (build + package .zip) | 1h | — | Produces extension .zip artifact |

#### `@sub-security-auditor` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| F-04 | Storage encryption (AES-256-GCM) | 6h | F-03 | API keys encrypted/decrypted correctly |
| F-04a | Web Crypto API wrapper | 3h | — | encrypt(), decrypt() functions |
| F-04b | PBKDF2 key derivation | 2h | — | 310k iterations, random salt |
| F-04c | Secure storage wrapper | 1h | F-04a | get/set with auto-encrypt |
| F-09 | Security primitives | 6h | F-03 | Sanitizer, URL validator, PII detector |
| F-09a | Input sanitizer (HTML strip, escape) | 2h | — | Strips all HTML/script tags |
| F-09b | URL validator (blocklist, scheme check) | 2h | — | Rejects javascript:, chrome://, etc. |
| F-09c | PII detector (SSN, CC, email, phone) | 2h | — | Detects and redacts 5 PII types |

### Sprint 1.2 (Week 3-4): Message Bridge & Integration

#### `@sub-tech-lead` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| F-05 | Message protocol implementation | 8h | F-03 | SW ↔ CS bidirectional messaging |
| F-05a | Service Worker bridge | 3h | F-03d | Send/receive with type safety |
| F-05b | Content Script bridge | 3h | F-03d | Receive/respond with validation |
| F-05c | Message validation + nonce | 2h | F-05a | Reject invalid/replayed messages |
| F-11 | Service Worker entry point | 4h | F-05 | Boots cleanly, listeners registered |
| F-12 | Content Script entry point | 4h | F-05 | Injects on page load, bridge ready |
| F-13 | Logging framework | 2h | — | Logger with levels, no sensitive data |

#### `@sub-qa-tester` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| F-14 | Unit tests for Sprint 1 deliverables | 8h | All F-* | 80%+ coverage on shared/ |
| F-14a | Encryption tests | 2h | F-04 | Encrypt/decrypt round-trip, wrong key fails |
| F-14b | Sanitizer tests | 2h | F-09 | XSS payloads blocked, clean input passes |
| F-14c | Message protocol tests | 2h | F-05 | Valid messages pass, invalid rejected |
| F-14d | PII detection tests | 2h | F-09c | All PII types detected + redacted |

### Phase 1 Milestone Checklist

```
□ pnpm dev starts extension with HMR
□ pnpm build produces loadable .zip
□ pnpm test runs with 80%+ coverage
□ CI pipeline green on main branch
□ All shared types compile (tsc --noEmit = 0 errors)
□ SW ↔ CS message bridge working (verified in test)
□ API key encryption working (round-trip test)
□ Base UI components rendered in Side Panel shell
□ Security primitives tested (sanitizer, PII, URL validator)
```

---

## PHASE 2: Core Engine (Week 5-10)

**Goal:** AI can receive commands, generate actions, and execute them on web pages.
**Exit Criteria:** User types "Go to google.com and search for cats" → AI navigates, types, clicks.

---

### Sprint 2.1 (Week 5-6): AI Client

#### `@sub-tech-lead` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| C-01 | Base AI provider abstract class | 4h | F-03 | BaseProvider with common logic |
| C-02 | Claude provider | 6h | C-01 | Streaming chat with Claude API |
| C-03 | OpenAI provider | 4h | C-01 | Streaming chat with GPT-4o |
| C-04 | Gemini provider | 4h | C-01 | Streaming chat with Gemini API |
| C-05 | Ollama + OpenRouter providers | 4h | C-01 | Local model + OpenRouter support |
| C-06 | AI Client Manager | 6h | C-01~05 | Provider switching, fallback, retry |
| C-06a | Streaming parser (SSE/JSON chunks) | 3h | — | Handles all provider stream formats |
| C-06b | Token counter (estimate) | 1h | — | Approximate token count per provider |
| C-06c | Rate limiter | 2h | — | Respects provider rate limits |

#### `@sub-tech-lead` + `@sub-security-auditor` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| C-07 | System prompt engineering | 6h | C-01 | Produces valid JSON actions consistently |
| C-07a | Core system prompt | 3h | — | AI returns structured JSON |
| C-07b | Context injection template | 2h | — | Page content safely delimited |
| C-07c | Prompt injection test suite | 1h | C-07a | 20+ injection attempts all blocked |

#### `@sub-qa-tester` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| C-25a | AI Client unit tests | 8h | C-01~06 | All providers tested with mocks |
| C-25a1 | Mock fetch for each provider format | 3h | — | Realistic mock responses |
| C-25a2 | Streaming parser tests | 2h | — | Partial chunks, errors handled |
| C-25a3 | Error/retry/fallback tests | 3h | — | Rate limit → retry, fail → fallback |

### Sprint 2.2 (Week 7-8): Command Parser + Browser Controller

#### `@sub-tech-lead` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| C-08 | Command Parser: JSON extraction | 4h | C-07 | Extracts actions from AI response |
| C-09 | Zod schemas for all 30+ action types | 8h | F-03a | Every ActionType has Zod schema |
| C-11 | Tab Manager | 4h | F-03 | Create, close, switch, list tabs |
| C-12 | Scripting Adapter (chrome.scripting) | 8h | F-05 | Execute scripts in tabs |
| C-13 | Debugger Adapter (CDP) | 12h | F-03 | Attach, send CDP commands, detach |
| C-13a | CDP: Input.dispatchMouseEvent | 3h | C-13 | Click, hover, drag simulation |
| C-13b | CDP: Input.dispatchKeyEvent | 3h | C-13 | Typing, shortcuts simulation |
| C-13c | CDP: Page.captureScreenshot | 2h | C-13 | Full page screenshot |
| C-13d | CDP: Runtime.evaluate | 2h | C-13 | Execute JS in page context |
| C-13e | CDP: DOM.* commands | 2h | C-13 | Query, modify DOM via CDP |

#### `@sub-security-auditor` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| C-10 | Command sanitizer | 6h | C-09 | All action payloads sanitized |
| C-10a | URL validation for navigate actions | 2h | — | Blocks javascript:, data:, chrome:// |
| C-10b | Selector sanitization | 2h | — | No script injection via selectors |
| C-10c | Sensitivity classification | 2h | — | Each action classified SAFE→BLOCKED |

### Sprint 2.3 (Week 9-10): Content Scripts + Orchestrator

#### `@sub-tech-lead` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| C-14 | Selector Engine (multi-strategy) | 8h | F-12 | CSS, XPath, text, ARIA, placeholder, nearText |
| C-14a | CSS selector resolution | 1h | — | querySelector with nth |
| C-14b | XPath resolution | 1h | — | document.evaluate |
| C-14c | Text/ARIA/placeholder resolution | 3h | — | Fuzzy text match, role query |
| C-14d | nearText (proximity selector) | 3h | — | Find element near given text |
| C-15 | Click/hover/focus actions | 4h | C-14 | Dispatch MouseEvent correctly |
| C-16 | Fill/type/select actions | 6h | C-14 | React-compatible input simulation |
| C-16a | React-safe value setter | 3h | — | Override React's synthetic events |
| C-16b | Select dropdown handler | 2h | — | Works with native + custom selects |
| C-16c | Checkbox/radio handler | 1h | — | Check, uncheck with events |
| C-17 | Scroll actions | 2h | C-14 | scrollIntoView, scrollBy |
| C-18 | Extract/screenshot | 4h | C-14 | Get text, attributes, screenshot |
| C-19 | DOM Inspector (context builder) | 6h | C-14 | Summarize page DOM for AI |
| C-19a | Visible element extraction | 3h | — | Only elements in viewport |
| C-19b | Interactive element detection | 2h | — | Buttons, links, inputs, selects |
| C-19c | Page summary generation | 1h | — | Compact text summary |
| C-20 | Auto-wait engine | 4h | C-14 | Wait for element, navigation, network idle |
| C-21 | Session Manager | 6h | C-06 | Create, pause, resume, abort sessions |
| C-22 | Context Builder | 6h | C-19 | Build AI context from page state |
| C-23 | Orchestrator: Action queue | 8h | ALL | Receive actions → execute in order |
| C-24 | Error recovery pipeline | 4h | C-23 | Retry → alternative → ask user |

#### `@sub-qa-tester` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| C-25b | Content Script unit tests | 12h | C-14~C-20 | Selector, actions, auto-wait tested |
| C-25c | Browser Controller tests | 8h | C-11~C-13 | Tab manager, adapters tested |
| C-25d | Session + Orchestrator tests | 6h | C-21~C-24 | Full action flow tested |
| C-25e | Integration test: SW ↔ CS round-trip | 4h | ALL | Message → action → result verified |

#### `@sub-security-auditor` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| C-26 | Security review of Phase 2 code | 8h | ALL | No security issues in core modules |
| C-26a | Prompt injection test battery | 4h | C-07 | 50+ injection scenarios tested |
| C-26b | XSS review of content scripts | 2h | C-14~C-18 | No innerHTML with user data |
| C-26c | Message protocol security review | 2h | F-05 | Origin validation, replay protection |

### Phase 2 Milestone Checklist

```
□ AI streams response from all 5 providers
□ Command parser extracts valid actions from AI response
□ Content script clicks, fills, types on real websites
□ Selector engine finds elements via CSS, text, ARIA
□ Auto-wait works for dynamic content (SPA pages)
□ Screenshot captured via tabs API + CDP
□ Orchestrator executes action sequence with error recovery
□ 80%+ unit test coverage on all core modules
□ Security review passed (prompt injection, XSS, message security)
□ DEMO: "Go to google.com and search for cats" works end-to-end
```

---

## PHASE 3: UI & Integration (Week 11-14)

**Goal:** Full user-facing UI, connected to core engine, ready for human testing.
**Exit Criteria:** Non-technical user can install, configure, and run a multi-step automation task.

---

### Sprint 3.1 (Week 11-12): Side Panel + Popup

#### `@sub-ui-designer` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| U-01 | Side Panel: ChatContainer + layout | 6h | F-10 | Header, chat area, input, responsive |
| U-02 | Message bubbles: user, AI, action, error | 8h | U-01 | 4 variants with animations |
| U-02a | User message bubble | 2h | — | Right-aligned, timestamp |
| U-02b | AI message bubble with markdown | 3h | — | Markdown rendering, action buttons |
| U-02c | Action status bubble (progress) | 2h | — | Progress bar, step counter, cancel |
| U-02d | Error bubble with recovery options | 1h | — | Retry, alternative, report |
| U-03 | Input area with commands | 4h | U-01 | Text input, send button, / commands |
| U-03a | Slash command autocomplete | 2h | — | /screenshot, /extract, /settings |
| U-03b | Multi-line input support | 1h | — | Shift+Enter for newline |
| U-03c | Send via Ctrl+Enter | 1h | — | Keyboard shortcut working |
| U-04 | Action log panel (collapsible) | 4h | U-01 | Timeline of executed actions |
| U-05 | Action timeline with statuses | 3h | U-04 | Pending/running/done/failed icons |
| U-06 | Popup: Quick actions + page info | 6h | F-10 | 360x480, current page, 4 quick actions |
| U-13 | Dark/Light mode toggle | 3h | F-02 | System/light/dark, persists |

#### `@sub-tech-lead` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| U-15 | Connect UI stores ↔ Service Worker | 8h | U-01, C-23 | useSession, useChat hooks work |
| U-15a | Session store (Zustand) | 3h | — | Create/list/switch sessions |
| U-15b | Chat store + message streaming | 3h | — | Real-time AI response display |
| U-15c | Action log store + events | 2h | — | Action progress updates in UI |

### Sprint 3.2 (Week 13-14): Options, Onboarding, Overlays

#### `@sub-ui-designer` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| U-07 | Options: Provider settings | 4h | F-10 | Provider dropdown, API key (masked), test button |
| U-08 | Options: Permission toggles | 3h | U-07 | Toggle switches for each capability |
| U-09 | Options: Appearance settings | 2h | U-07 | Theme, language selection |
| U-10 | Onboarding: 4-step flow | 8h | F-10 | Welcome → Connect → Permissions → Ready |
| U-10a | Welcome screen | 1h | — | Logo, features list, CTA |
| U-10b | Connect AI provider | 3h | — | Provider select, key input, test |
| U-10c | Permission explanation | 2h | — | CAN do / CANNOT do lists |
| U-10d | Ready + quick tips | 2h | — | Shortcut info, first command |
| U-11 | In-Page: Element highlight | 4h | — | Pulsing border around target element |
| U-12 | In-Page: Action status overlay | 4h | — | Floating card showing current action |
| U-17 | Accessibility audit + fixes | 6h | ALL UI | WCAG 2.1 AA compliance |

#### `@sub-tech-lead` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| U-14 | Keyboard shortcuts system | 3h | — | Ctrl+Shift+Y (panel), Escape (stop) |
| U-15d | Connect overlay to content bridge | 4h | U-11 | Highlight element when AI targets it |

#### `@sub-qa-tester` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| U-16 | E2E test: Full pipeline | 12h | ALL | User → AI → action → result → UI update |
| U-16a | Navigation E2E test | 3h | — | "Go to X" → page navigates |
| U-16b | Form filling E2E test | 3h | — | "Fill this form" → fields populated |
| U-16c | Click interaction E2E | 3h | — | "Click login" → button clicked |
| U-16d | Error recovery E2E | 3h | — | Element not found → retry → success |

#### `@sub-security-auditor` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| U-18 | Security audit of UI layer | 4h | ALL UI | No XSS, secure API key display |
| U-18a | API key input security | 2h | U-07 | Never in DOM, masked, copy-proof |
| U-18b | Markdown rendering security | 2h | U-02b | DOMPurify strict config |

### Phase 3 Milestone Checklist

```
□ Side Panel fully functional (chat, actions, progress)
□ Popup shows page info + quick actions
□ Options page configures provider + settings
□ Onboarding flow works for first-time users
□ In-page overlay highlights target elements
□ Dark mode / Light mode works correctly
□ Keyboard shortcuts functional
□ E2E tests pass: navigate, fill, click, error recovery
□ Accessibility audit passed (WCAG 2.1 AA)
□ Security audit passed for UI layer
□ DEMO: Non-technical user can complete "search Amazon for laptops"
```

---

## PHASE 4: Advanced Features (Week 15-18)

**Goal:** Playwright-level capabilities via CDP, recording/playback, workflows.
**Exit Criteria:** Extension handles file upload, network intercept, PDF, geolocation, iframe.

---

### Sprint 4.1 (Week 15-16): Advanced CDP Features

#### `@sub-tech-lead` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| A-01 | Network interception | 8h | C-13 | Intercept requests, modify responses |
| A-01a | Fetch.enable + requestPaused | 4h | — | Intercept matching URL patterns |
| A-01b | Mock response injection | 2h | — | Return custom response body |
| A-01c | Request blocking | 2h | — | Block specific URLs (ads, trackers) |
| A-02 | Device emulation | 4h | C-13 | Mobile viewport, user agent, touch |
| A-02a | Emulation.setDeviceMetricsOverride | 2h | — | iPhone, Pixel, iPad presets |
| A-02b | Emulation.setUserAgentOverride | 1h | — | Match device user agent |
| A-02c | Emulation.setTouchEmulationEnabled | 1h | — | Touch events for mobile |
| A-03 | Geolocation mock | 2h | C-13 | Set fake GPS coordinates |
| A-04 | PDF generation | 3h | C-13 | Save page as PDF |
| A-05 | File upload | 4h | C-13 | Handle file input elements |
| A-06 | iframe support | 6h | C-13 | Navigate into iframes, interact |
| A-06a | Same-origin iframe via CS | 2h | — | contentWindow access |
| A-06b | Cross-origin iframe via CDP | 4h | — | Target.attachToTarget |
| A-07 | Multi-tab automation | 6h | C-11 | Orchestrate actions across tabs |
| A-07a | Cross-tab action sequencing | 3h | — | "Open new tab, go to X, then..." |
| A-07b | Tab state synchronization | 3h | — | Know which tab has what page |

### Sprint 4.2 (Week 17-18): Recording & Workflows

#### `@sub-tech-lead` + `@sub-ui-designer` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| A-08 | Action recording | 12h | C-14 | Record user clicks/types as actions |
| A-08a | Click event capture | 3h | — | Record element selector + position |
| A-08b | Input event capture | 3h | — | Record typed values |
| A-08c | Navigation event capture | 2h | — | Record URL changes |
| A-08d | Recording UI (start/stop/pause) | 4h | — | Red indicator, controls `@sub-ui-designer` |
| A-09 | Action playback (macros) | 6h | A-08 | Replay recorded action sequence |
| A-09a | Playback engine with timing | 3h | — | Execute actions with delays |
| A-09b | Playback controls UI | 3h | — | Play/pause/speed `@sub-ui-designer` |
| A-10 | Export actions as script | 4h | A-08 | Export JSON, Playwright, Puppeteer format |
| A-11 | Saved workflows manager | 8h | A-08 | Save, name, organize, share workflows |
| A-11a | Workflow storage schema | 2h | — | Name, description, actions, tags |
| A-11b | Workflow list UI | 3h | — | Grid/list view `@sub-ui-designer` |
| A-11c | Workflow run/edit/delete | 3h | — | Full CRUD operations |
| A-12 | Advanced prompt templates | 4h | C-07 | Templates for common tasks |
| A-12a | "Extract table data" template | 1h | — | Optimized for data extraction |
| A-12b | "Fill form from profile" template | 1h | — | Use saved user profile data |
| A-12c | "Compare prices" template | 1h | — | Multi-tab price comparison |
| A-12d | "Monitor page changes" template | 1h | — | Periodic check + alert |

#### `@sub-qa-tester` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| A-13 | Advanced feature tests | 12h | A-01~A-12 | All advanced features tested |
| A-13a | Network interception tests | 3h | A-01 | Intercept, modify, block verified |
| A-13b | File upload tests | 2h | A-05 | File reaches server correctly |
| A-13c | Recording/playback tests | 4h | A-08,A-09 | Record → playback matches |
| A-13d | Multi-tab tests | 3h | A-07 | Cross-tab orchestration works |

#### `@sub-security-auditor` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| A-14 | Security review: Advanced features | 6h | ALL A-* | No new attack vectors |
| A-14a | Network intercept security | 2h | A-01 | Can't be used for credential theft |
| A-14b | Script export security | 2h | A-10 | No sensitive data in exports |
| A-14c | Workflow storage security | 2h | A-11 | Workflows can't contain secrets |

### Phase 4 Milestone Checklist

```
□ Network interception working (block ads, mock APIs)
□ Device emulation working (iPhone, Pixel presets)
□ Geolocation mock working
□ PDF generation working
□ File upload working via CDP
□ iframe interaction working (same + cross origin)
□ Multi-tab automation working
□ Action recording captures user actions accurately
□ Action playback replays with correct timing
□ Export to JSON/Playwright format working
□ Workflow manager: save, load, run, delete
□ Security review passed for all advanced features
□ DEMO: Record filling a form → replay on different site
```

---

## PHASE 5: Polish & Ship (Week 19-20)

**Goal:** Production-ready, tested, secure, Chrome Web Store approved.
**Exit Criteria:** v1.0.0 published on Chrome Web Store.

---

### Sprint 5.1 (Week 19): Hardening

#### `@sub-tech-lead` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| P-01 | Performance optimization | 8h | ALL | < 500KB bundle, < 50MB idle memory |
| P-01a | Bundle analysis + tree shaking | 3h | — | Remove unused code |
| P-01b | Lazy load AI providers | 2h | — | Only load active provider |
| P-01c | Content script size optimization | 2h | — | Minimal CS payload |
| P-01d | Service Worker keep-alive strategy | 1h | — | SW doesn't die mid-task |
| P-05a | README.md | 4h | — | Installation, usage, features |
| P-05b | CONTRIBUTING.md | 2h | — | Dev setup, PR process |

#### `@sub-qa-tester` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| P-02 | E2E test suite expansion | 16h | ALL | 50+ E2E scenarios |
| P-02a | Real-world site tests (Google, Amazon, GitHub) | 6h | — | Major sites work correctly |
| P-02b | SPA tests (React, Vue, Angular apps) | 4h | — | SPA navigation + interaction |
| P-02c | Edge case tests (slow net, large DOM) | 3h | — | Graceful degradation |
| P-02d | Error recovery tests | 3h | — | All error paths tested |
| P-06 | Beta testing coordination | 8h | ALL | 10+ testers, feedback collected |
| P-06a | Beta tester recruitment | 2h | — | 10-20 diverse testers |
| P-06b | Test scenarios for beta | 2h | — | Structured test scripts |
| P-06c | Feedback collection + triage | 4h | — | Issues filed, prioritized |

#### `@sub-security-auditor` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| P-03 | Penetration testing | 8h | ALL | No critical/high findings |
| P-03a | Prompt injection pen test | 3h | — | 100+ injection attempts blocked |
| P-03b | XSS pen test across 20 sites | 2h | — | No XSS in any site context |
| P-03c | API key extraction attempts | 2h | — | Keys not extractable |
| P-03d | Message protocol fuzzing | 1h | — | No crashes from malformed messages |
| P-04 | Chrome Web Store compliance | 4h | — | All policies satisfied |
| P-04a | Permission justification document | 2h | — | Each permission explained |
| P-04b | Privacy policy | 1h | — | GDPR-compliant privacy policy |
| P-04c | Data use disclosure | 1h | — | CWS data use form completed |

### Sprint 5.2 (Week 20): Launch

#### `@sub-tech-lead` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| P-08 | Chrome Web Store submission | 4h | P-03, P-04 | Extension submitted + approved |
| P-08a | Store listing (screenshots, description) | 2h | — | 5 screenshots, compelling copy |
| P-08b | Build final release package | 1h | — | Versioned, signed .zip |
| P-08c | Submit + respond to review | 1h | — | Address any review feedback |
| P-09 | Post-launch monitoring setup | 2h | — | Error tracking, crash reporting |

#### `@sub-qa-tester` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| P-10 | Final regression test | 4h | ALL | All existing tests green |
| P-11 | Release sign-off document | 2h | P-10 | All quality gates passed |

#### `@sub-security-auditor` Tasks

| ID | Task | Est. Hours | Depends On | Acceptance Criteria |
|----|------|-----------|------------|---------------------|
| P-07 | Final security sign-off | 2h | P-03 | No open critical/high findings |

### Phase 5 Milestone Checklist

```
□ Bundle size < 500KB gzipped
□ Memory usage < 50MB idle, < 150MB active
□ 50+ E2E tests passing
□ Penetration test passed (0 critical, 0 high findings)
□ Beta testing completed (10+ users, major bugs fixed)
□ Chrome Web Store policies compliance verified
□ Privacy policy published
□ README + CONTRIBUTING documentation complete
□ Final regression test passed
□ Security sign-off obtained
□ Chrome Web Store submission approved
□ v1.0.0 RELEASED
```

---

## Post-Launch Roadmap (v1.1+)

| Version | Timeline | Features | Owner |
|---------|----------|----------|-------|
| v1.1 | Week 21-24 | User profiles, form auto-fill from saved data | `@sub-tech-lead` |
| v1.2 | Week 25-28 | Cloud sync (conversations, workflows) | `@sub-tech-lead` |
| v1.3 | Week 29-32 | Visual mode: AI sees screenshots, not just DOM | `@sub-tech-lead` |
| v1.4 | Week 33-36 | Marketplace: Share workflows publicly | `@sub-tech-lead` + `@sub-ui-designer` |
| v2.0 | Week 37-44 | Multi-browser support (Firefox, Edge extensions) | `@sub-tech-lead` |

---

## Summary Statistics

| Metric | Value |
|--------|-------|
| Total Tasks | ~100 |
| Total Estimated Hours | ~450h |
| Phases | 5 |
| Sprints | 10 |
| Weeks | 20 |
| Files to Create | ~100+ |
| Test Coverage Target | 80%+ |
| E2E Scenarios | 50+ |
| Security Test Cases | 100+ |

### Hours by Subagent

| Subagent | Estimated Hours | % of Total |
|----------|----------------|------------|
| `@sub-tech-lead` | ~250h | 56% |
| `@sub-ui-designer` | ~90h | 20% |
| `@sub-qa-tester` | ~70h | 16% |
| `@sub-security-auditor` | ~40h | 9% |
