# Delivery Tracker

> Last updated: 2026-03-11
> Source of truth: `ROADMAP.md`, `BLUEPRINT.md`
> Execution mode: `one-task-at-a-time -> verify -> PASS -> commit -> push`

## Workflow Protocol

1. Pick exactly one task ID.
2. Delegate implementation to the mapped subagent.
3. Run required verification commands.
4. Mark task `PASS` only when all gates pass.
5. Commit and push immediately for backup.
6. Move to next task.

## Global Verification Gates

- TypeScript: `pnpm typecheck`
- Tests (selective): `pnpm vitest run <target>`
- Tests (full): `pnpm test`
- Build: `pnpm build`
- Security baseline: `pnpm audit --audit-level=high`

## PASS Checklist Template

- [ ] Scope matches task ID acceptance criteria.
- [ ] `pnpm typecheck` exits 0.
- [ ] Selective tests for changed module pass.
- [ ] Full test gate passes (no unhandled errors/rejections).
- [ ] `pnpm build` exits 0.
- [ ] No new security regression introduced.
- [ ] Commit created and pushed.

---

## PHASE 1 - Foundation

Status summary: Mostly done, remaining hardening gates on lint and coverage.

### Sprint 1.1

- [x] `F-01` Project bootstrap (Vite + CRXJS + TS)
- [x] `F-01a` tsconfig strict setup
- [x] `F-01b` vite + CRXJS wiring
- [x] `F-01c` MV3 manifest
- [x] `F-01d` pnpm deps/workspace
- [x] `F-02` Design token system
- [x] `F-02a` Light/dark semantic colors
- [x] `F-02b` Typography/spacing/shadows
- [~] `F-02c` Tailwind token extension hardening
- [x] `F-03` Shared interfaces baseline
- [x] `F-03a` Action types
- [x] `F-03b` AI provider interfaces
- [x] `F-03c` Storage schema types
- [x] `F-03d` Message protocol types
- [x] `F-04` Storage encryption layer
- [x] `F-04a` Web Crypto wrappers
- [x] `F-04b` PBKDF2 derivation
- [x] `F-04c` Secure storage wrapper
- [x] `F-06` Error framework
- [x] `F-07` Vitest setup + Chrome mocks
- [x] `F-07a` Vitest config
- [x] `F-07b` Chrome API mock library
- [~] `F-08` CI quality gate hardening
- [~] `F-08a` CI lint/typecheck/test/build alignment
- [x] `F-08b` Release workflow
- [x] `F-09` Security primitives
- [x] `F-09a` HTML/input sanitizer
- [x] `F-09b` URL validator
- [x] `F-09c` PII detector
- [x] `F-10` Base UI components
- [x] `F-10a` Button
- [x] `F-10b` Input
- [x] `F-10c` Card/Badge/Modal/Spinner

### Sprint 1.2

- [x] `F-05` Message protocol implementation
- [x] `F-05a` Service worker bridge
- [x] `F-05b` Content script bridge
- [x] `F-05c` Validation + nonce
- [x] `F-11` Service worker entry
- [x] `F-12` Content script entry
- [x] `F-13` Logger
- [~] `F-14` Coverage hardening to roadmap target
- [x] `F-14a` Encryption tests
- [x] `F-14b` Sanitizer tests
- [x] `F-14c` Message protocol tests
- [x] `F-14d` PII tests

Phase-1 blockers before final close:

- [ ] Migrate ESLint config to v10 flat config and make `pnpm lint` pass.
- [ ] Lift coverage gate (branch coverage >= 80%).
- [ ] Remove full-suite unhandled rejection warnings.

---

## PHASE 2 - Core Engine

Status summary: AI client done, command parser started, execution engine largely pending.

### Sprint 2.1

- [x] `C-01` Base AI provider
- [x] `C-02` Claude provider
- [x] `C-03` OpenAI provider
- [x] `C-04` Gemini provider
- [x] `C-05` Ollama + OpenRouter providers
- [x] `C-06` AI manager
- [x] `C-06a` Streaming parser
- [x] `C-06b` Token counter
- [x] `C-06c` Rate limiter
- [~] `C-07` Prompt engineering integration hardening
- [~] `C-07a` Core system prompt quality loop
- [~] `C-07b` Context injection template hardening
- [ ] `C-07c` Prompt-injection dedicated suite
- [x] `C-25a` AI client tests
- [x] `C-25a1` Provider mock formats
- [x] `C-25a2` Streaming parser tests
- [x] `C-25a3` Retry/fallback tests

### Sprint 2.2

- [x] `C-08` Command parser JSON extraction
- [x] `C-09` Zod schemas for all action types
- [x] `C-10` Command sanitizer (partial shared primitives exist, parser integration pending)
- [x] `C-10a` URL validation in parser pipeline
- [x] `C-10b` Selector sanitization in parser pipeline
- [x] `C-10c` Sensitivity classification wiring
- [x] `C-11` Tab manager
- [x] `C-12` Scripting adapter
- [x] `C-13` Debugger adapter
- [x] `C-13a` CDP mouse events
- [x] `C-13b` CDP key events
- [x] `C-13c` CDP screenshot
- [x] `C-13d` CDP runtime evaluate
- [x] `C-13e` CDP DOM commands

### Sprint 2.3

- [x] `C-14` Selector engine baseline (in monolithic content flow)
- [x] `C-14a` CSS resolution baseline
- [x] `C-14b` XPath resolution baseline
- [x] `C-14c` Text/ARIA/placeholder baseline
- [x] `C-14d` nearText strategy
- [x] `C-15` Click/hover/focus actions
- [x] `C-16` Fill/type/select actions
- [x] `C-16a` React-safe value setter
- [x] `C-16b` Dropdown handler
- [x] `C-16c` Checkbox/radio handler
- [x] `C-17` Scroll actions
- [x] `C-18` Extract/screenshot actions
- [x] `C-19` DOM inspector baseline
- [x] `C-19a` Visible-element extraction tuning
- [x] `C-19b` Interactive-element detection tuning
- [x] `C-19c` Page summary quality tuning
- [x] `C-20` Auto-wait engine
- [x] `C-21` Session manager
- [x] `C-22` Context builder
- [x] `C-23` Orchestrator action queue
- [x] `C-24` Error recovery pipeline
- [x] `C-25b` Content script tests
- [x] `C-25c` Browser controller tests
- [x] `C-25d` Session/orchestrator tests
- [x] `C-25e` SW-CS integration tests
- [x] `C-26` Phase-2 security review
- [x] `C-26a` Prompt injection battery (50+)
- [x] `C-26b` XSS content script review
- [x] `C-26c` Message security review report

Phase-2 execution order locked:

1. `C-09`
2. `C-10` (`C-10a/b/c`)
3. `C-11`
4. `C-12`
5. `C-13` (`C-13a-e`)
6. `C-15` to `C-20`
7. `C-21` to `C-24`
8. `C-25b-e`
9. `C-26`

---

## PHASE 3 - UI & Integration

Status summary: **PHASE 3 COMPLETE.** All UI tasks including E2E pipeline, accessibility, and security are done.

### Sprint 3.1

- [x] `U-01` Side panel container baseline
- [x] `U-02` Message bubbles (4 variants)
- [x] `U-02a` User bubble
- [x] `U-02b` AI markdown bubble
- [x] `U-02c` Action progress bubble
- [x] `U-02d` Error bubble
- [x] `U-03` Input area + commands
- [x] `U-03a` Slash command autocomplete
- [x] `U-03b` Multi-line input
- [x] `U-03c` Ctrl+Enter send
- [x] `U-04` Collapsible action log
- [x] `U-05` Action timeline states
- [x] `U-06` Popup baseline
- [x] `U-13` Theme toggle infra
- [x] `U-15` UI stores to SW integration
- [x] `U-15a` Session store
- [x] `U-15b` Chat streaming store
- [x] `U-15c` Action log store

### Sprint 3.2

- [x] `U-07` Provider settings baseline
- [x] `U-08` Permission toggles
- [x] `U-09` Appearance settings
- [x] `U-10` Onboarding flow
- [x] `U-10a` Welcome
- [x] `U-10b` Connect provider
- [x] `U-10c` Permission explanation
- [x] `U-10d` Ready/tips
- [x] `U-11` Highlight overlay baseline
- [x] `U-12` Action status overlay
- [x] `U-14` Keyboard shortcuts
- [x] `U-15d` Overlay bridge wiring
- [x] `U-16` Full E2E pipeline
- [x] `U-16a` Navigation E2E
- [x] `U-16b` Form-filling E2E
- [x] `U-16c` Click E2E
- [x] `U-16d` Error recovery E2E
- [x] `U-17` Accessibility audit/fixes
- [x] `U-18` UI security audit
- [x] `U-18a` API key input security
- [x] `U-18b` Markdown rendering security

UI-first order:

1. `U-01`, `U-03`, `U-02`, `U-04`, `U-05`
2. `U-06`, `U-13`
3. `U-07`, `U-08`, `U-09`, `U-10`
4. `U-11`, `U-12`, `U-14`
5. `U-15` (`a-d`)
6. `U-17`, `U-18`
7. `U-16`

---

## PHASE 4 - Advanced Features

Status summary: Network interception, device emulation, file upload, iframe routing, PDF generation, multi-tab automation, workflow manager, and advanced prompt templates are complete.

### Sprint 4.1

Execution note: implementation order was `A-05 -> A-06 -> A-04`. All three are complete. A-03 geolocation implementation is done but pending commit (A-03.10).

- [x] `A-01` Network interception
- [x] `A-01a` Fetch.enable interception
- [x] `A-01b` Mock response injection
- [x] `A-01c` Request blocking
- [x] `A-02` Device emulation
- [x] `A-02a` Device metrics override
- [x] `A-02b` User-agent override
- [x] `A-02c` Touch emulation
- [ ] `A-03` Geolocation mock
- [x] `A-03.1` Type definition (`MockGeolocationAction` in `actions.ts`)
- [x] `A-03.2` Sensitivity classification (`mockGeolocation: 'medium'` in `action-classifier.ts`)
- [x] `A-03.3` Zod schema (`action-schemas.ts` — ACTION_TYPES→35, schema, orderedActionSchemas)
- [x] `A-03.4` System prompt update (`system.ts` — ACTION_REFERENCE, compact, SUPPORTED→35)
- [x] `A-03.5` CDP wrappers (`debugger-adapter.ts` — setGeolocationOverride, clearGeolocationOverride)
- [x] `A-03.6` GeolocationMockManager (`src/background/geolocation-mock-manager.ts` — follow DeviceEmulationManager)
- [x] `A-03.7` Runtime routing (`ui-session-runtime.ts` — import, construct, route, cleanup in 5 locations)
- [x] `A-03.8` Unit tests (manager tests, schema count 34→35, CDP wrapper tests, runtime routing tests)
- [x] `A-03.9` Verification gates (typecheck, test, build, audit)
- [ ] `A-03.10` Record completion, commit, push
- [x] `A-04` PDF generation (`savePdf` action — CDP `Page.printToPDF`, `chrome.downloads.download`, 7 unit tests)
- [x] `A-05` File upload (staged sidepanel uploads -> content-script injection)
- [x] `A-06` iframe support (frame-aware bridge routing)
- [x] `A-06a` Frame-aware content script injection (`all_frames` + `match_about_blank`)
- [x] `A-06b` Frame context + selector targeting (`selector.frame`, frame registry, targeted bridge sends)
- [x] `A-07` Multi-tab automation (snapshot-based tab targeting + redacted AI-visible tab mapping)
- [x] `A-07a` Cross-tab sequencing (wait for new-tab readiness + retarget remaining tab after close)
- [x] `A-07b` Tab state sync (session tab snapshot + AI-visible `## Tabs` mapping)

### Sprint 4.2

- [x] `A-08` Action recording
- [x] `A-08a` Click capture
- [x] `A-08b` Input capture
- [x] `A-08c` Navigation capture
- [x] `A-08d` Recording UI
- [x] `A-09` Playback
- [x] `A-09a` Playback engine
- [x] `A-09b` Playback controls UI
- [x] `A-10` Script export
- [x] `A-11` Workflow manager
- [x] `A-11a` Workflow schema
- [x] `A-11b` Workflow list UI
- [x] `A-11c` Workflow CRUD/run
- [x] `A-11 QA` Gate verification + stability pass
- [x] `A-12` Advanced prompt templates
- [x] `A-12a` Extract table template
- [x] `A-12b` Fill profile template
- [x] `A-12c` Compare prices template
- [x] `A-12d` Monitor changes template
- [x] `A-13` Advanced feature test suite
- [x] `A-13a` Interception tests
- [x] `A-13b` Upload tests
- [x] `A-13c` Recording/playback tests
- [x] `A-13d` Multi-tab tests
- [x] `A-14` Advanced security review
- [x] `A-14a` Intercept security
- [x] `A-14b` Export security
- [x] `A-14c` Workflow secret safety

---

## PHASE 5 - Polish & Ship

Status summary: `P-01a`, `P-01b`, `P-01c`, and `P-05a` complete; `P-05b` remains pending, and `P-01` stays in progress pending later performance tasks.

### Sprint 5.1

- [~] `P-01` Performance optimization (ongoing, not measured against final targets)
- [x] `P-01a` Bundle analysis/tree shaking
- [x] `P-01b` Lazy-load AI providers
- [x] `P-01c` Content script size optimization
- [x] `P-01d` Service worker keep-alive baseline
- [x] `P-05a` README
- [ ] `P-05b` CONTRIBUTING
- [ ] `P-02` E2E expansion 50+ scenarios
- [ ] `P-02a` Real-site tests
- [ ] `P-02b` SPA tests
- [ ] `P-02c` Edge-case tests
- [ ] `P-02d` Error recovery tests
- [ ] `P-06` Beta coordination
- [ ] `P-06a` Recruit testers
- [ ] `P-06b` Beta scenarios
- [ ] `P-06c` Feedback triage
- [ ] `P-03` Penetration testing
- [ ] `P-03a` Prompt injection pen-test
- [ ] `P-03b` XSS pen-test
- [ ] `P-03c` API key extraction attempts
- [ ] `P-03d` Message fuzzing
- [ ] `P-04` CWS compliance
- [ ] `P-04a` Permission justification
- [ ] `P-04b` Privacy policy
- [ ] `P-04c` Data use disclosure

### Sprint 5.2

- [ ] `P-07` Final security sign-off
- [ ] `P-08` CWS submission
- [ ] `P-08a` Store listing assets
- [ ] `P-08b` Final package
- [ ] `P-08c` Review response loop
- [ ] `P-09` Post-launch monitoring
- [ ] `P-10` Final regression
- [ ] `P-11` Release sign-off

---

## Immediate Task Queue (Locked)

- [ ] `T-01` Close current `C-08` by commit and push.
- [x] `T-02` Implement `C-09` (Zod schemas + parser integration + tests).
- [x] `T-03` Implement `C-10` (security sanitization pipeline + tests).
- [ ] `T-04` Address bridge unhandled rejection failures in full test run.
- [ ] `T-05` Fix lint gate (ESLint flat config).
- [ ] `T-06` Raise coverage branch gate to roadmap target.

## Status Legend

- `[x]` PASS
- `[~]` IN_PROGRESS / PARTIAL
- `[ ]` PENDING
