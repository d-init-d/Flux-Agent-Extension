# Delivery Tracker

> Last updated: 2026-03-05
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
- [ ] `C-09` Zod schemas for all action types
- [~] `C-10` Command sanitizer (partial shared primitives exist, parser integration pending)
- [ ] `C-10a` URL validation in parser pipeline
- [ ] `C-10b` Selector sanitization in parser pipeline
- [ ] `C-10c` Sensitivity classification wiring
- [ ] `C-11` Tab manager
- [ ] `C-12` Scripting adapter
- [ ] `C-13` Debugger adapter
- [ ] `C-13a` CDP mouse events
- [ ] `C-13b` CDP key events
- [ ] `C-13c` CDP screenshot
- [ ] `C-13d` CDP runtime evaluate
- [ ] `C-13e` CDP DOM commands

### Sprint 2.3

- [~] `C-14` Selector engine baseline (in monolithic content flow)
- [x] `C-14a` CSS resolution baseline
- [x] `C-14b` XPath resolution baseline
- [x] `C-14c` Text/ARIA/placeholder baseline
- [ ] `C-14d` nearText strategy
- [ ] `C-15` Click/hover/focus actions
- [ ] `C-16` Fill/type/select actions
- [ ] `C-16a` React-safe value setter
- [ ] `C-16b` Dropdown handler
- [ ] `C-16c` Checkbox/radio handler
- [ ] `C-17` Scroll actions
- [ ] `C-18` Extract/screenshot actions
- [~] `C-19` DOM inspector baseline
- [~] `C-19a` Visible-element extraction tuning
- [~] `C-19b` Interactive-element detection tuning
- [~] `C-19c` Page summary quality tuning
- [ ] `C-20` Auto-wait engine
- [ ] `C-21` Session manager
- [ ] `C-22` Context builder
- [ ] `C-23` Orchestrator action queue
- [ ] `C-24` Error recovery pipeline
- [ ] `C-25b` Content script tests
- [ ] `C-25c` Browser controller tests
- [ ] `C-25d` Session/orchestrator tests
- [ ] `C-25e` SW-CS integration tests
- [ ] `C-26` Phase-2 security review
- [ ] `C-26a` Prompt injection battery (50+)
- [ ] `C-26b` XSS content script review
- [~] `C-26c` Message security review report

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

Status summary: UI foundation exists; feature UI and end-to-end integration mostly pending.

### Sprint 3.1

- [~] `U-01` Side panel container baseline
- [ ] `U-02` Message bubbles (4 variants)
- [ ] `U-02a` User bubble
- [ ] `U-02b` AI markdown bubble
- [ ] `U-02c` Action progress bubble
- [ ] `U-02d` Error bubble
- [ ] `U-03` Input area + commands
- [ ] `U-03a` Slash command autocomplete
- [ ] `U-03b` Multi-line input
- [ ] `U-03c` Ctrl+Enter send
- [ ] `U-04` Collapsible action log
- [ ] `U-05` Action timeline states
- [~] `U-06` Popup baseline
- [~] `U-13` Theme toggle infra (needs product wiring)
- [ ] `U-15` UI stores to SW integration
- [ ] `U-15a` Session store
- [ ] `U-15b` Chat streaming store
- [ ] `U-15c` Action log store

### Sprint 3.2

- [~] `U-07` Provider settings baseline
- [ ] `U-08` Permission toggles
- [ ] `U-09` Appearance settings
- [ ] `U-10` Onboarding flow
- [ ] `U-10a` Welcome
- [ ] `U-10b` Connect provider
- [ ] `U-10c` Permission explanation
- [ ] `U-10d` Ready/tips
- [~] `U-11` Highlight overlay baseline
- [ ] `U-12` Action status overlay
- [ ] `U-14` Keyboard shortcuts
- [ ] `U-15d` Overlay bridge wiring
- [ ] `U-16` Full E2E pipeline
- [ ] `U-16a` Navigation E2E
- [ ] `U-16b` Form-filling E2E
- [ ] `U-16c` Click E2E
- [ ] `U-16d` Error recovery E2E
- [ ] `U-17` Accessibility audit/fixes
- [ ] `U-18` UI security audit
- [ ] `U-18a` API key input security
- [ ] `U-18b` Markdown rendering security

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

Status summary: Not started.

### Sprint 4.1

- [ ] `A-01` Network interception
- [ ] `A-01a` Fetch.enable interception
- [ ] `A-01b` Mock response injection
- [ ] `A-01c` Request blocking
- [ ] `A-02` Device emulation
- [ ] `A-02a` Device metrics override
- [ ] `A-02b` User-agent override
- [ ] `A-02c` Touch emulation
- [ ] `A-03` Geolocation mock
- [ ] `A-04` PDF generation
- [ ] `A-05` File upload
- [ ] `A-06` iframe support
- [ ] `A-06a` Same-origin iframe
- [ ] `A-06b` Cross-origin iframe
- [ ] `A-07` Multi-tab automation
- [ ] `A-07a` Cross-tab sequencing
- [ ] `A-07b` Tab state sync

### Sprint 4.2

- [ ] `A-08` Action recording
- [ ] `A-08a` Click capture
- [ ] `A-08b` Input capture
- [ ] `A-08c` Navigation capture
- [ ] `A-08d` Recording UI
- [ ] `A-09` Playback
- [ ] `A-09a` Playback engine
- [ ] `A-09b` Playback controls UI
- [ ] `A-10` Script export
- [ ] `A-11` Workflow manager
- [ ] `A-11a` Workflow schema
- [ ] `A-11b` Workflow list UI
- [ ] `A-11c` Workflow CRUD/run
- [ ] `A-12` Advanced prompt templates
- [ ] `A-12a` Extract table template
- [ ] `A-12b` Fill profile template
- [ ] `A-12c` Compare prices template
- [ ] `A-12d` Monitor changes template
- [ ] `A-13` Advanced feature test suite
- [ ] `A-13a` Interception tests
- [ ] `A-13b` Upload tests
- [ ] `A-13c` Recording/playback tests
- [ ] `A-13d` Multi-tab tests
- [ ] `A-14` Advanced security review
- [ ] `A-14a` Intercept security
- [ ] `A-14b` Export security
- [ ] `A-14c` Workflow secret safety

---

## PHASE 5 - Polish & Ship

Status summary: Minimal prep only, ship tasks pending.

### Sprint 5.1

- [~] `P-01` Performance optimization (ongoing, not measured against final targets)
- [ ] `P-01a` Bundle analysis/tree shaking
- [ ] `P-01b` Lazy-load AI providers
- [ ] `P-01c` Content script size optimization
- [x] `P-01d` Service worker keep-alive baseline
- [ ] `P-02` E2E expansion 50+ scenarios
- [ ] `P-02a` Real-site tests
- [ ] `P-02b` SPA tests
- [ ] `P-02c` Edge-case tests
- [ ] `P-02d` Error recovery tests
- [ ] `P-03` Penetration testing
- [ ] `P-03a` Prompt injection pen-test
- [ ] `P-03b` XSS pen-test
- [ ] `P-03c` API key extraction attempts
- [ ] `P-03d` Message fuzzing
- [ ] `P-04` CWS compliance
- [ ] `P-04a` Permission justification
- [ ] `P-04b` Privacy policy
- [ ] `P-04c` Data use disclosure
- [ ] `P-05a` README
- [ ] `P-05b` CONTRIBUTING
- [ ] `P-06` Beta coordination
- [ ] `P-06a` Recruit testers
- [ ] `P-06b` Beta scenarios
- [ ] `P-06c` Feedback triage

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
- [ ] `T-02` Implement `C-09` (Zod schemas + parser integration + tests).
- [ ] `T-03` Implement `C-10` (security sanitization pipeline + tests).
- [ ] `T-04` Address bridge unhandled rejection failures in full test run.
- [ ] `T-05` Fix lint gate (ESLint flat config).
- [ ] `T-06` Raise coverage branch gate to roadmap target.

## Status Legend

- `[x]` PASS
- `[~]` IN_PROGRESS / PARTIAL
- `[ ]` PENDING
