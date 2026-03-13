# E2E Scenario Matrix

Last updated: 2026-03-13

This matrix tracks the deterministic end-to-end scenario count used to close `P-02`.

## Totals by suite

| Suite | Scenario count |
|------|---------------:|
| `src/test/e2e/full-pipeline.test.tsx` | 14 |
| `src/test/e2e/p-02a-real-sites.test.tsx` | 3 |
| `src/test/e2e/p-02b-spa-sites.test.tsx` | 3 |
| `src/test/e2e/p-02c-edge-cases.test.tsx` | 3 |
| `src/test/e2e/p-02d-error-recovery.test.tsx` | 3 |
| `src/test/e2e/p-02e-scenario-matrix.test.tsx` | 24 |
| **Total** | **50** |

## Scenario inventory

| Suite | Scenario ID | Focus |
|------|-------------|-------|
| `full-pipeline` | `U-16a` | Navigate the current tab and update the UI |
| `full-pipeline` | `U-16b` | Fill a form field and update the UI |
| `full-pipeline` | `U-16c` | Click an element and update the UI |
| `full-pipeline` | `U-16d` | Recover from a retryable pipeline failure |
| `full-pipeline` | `A-08a` | Record click-input-pause-resume-stop flow |
| `full-pipeline` | `A-08b` | Record navigation only while recording is active |
| `full-pipeline` | `A-09a` | Replay recorded actions with timing and pause/resume |
| `full-pipeline` | `A-09b` | Stop playback from the UI |
| `full-pipeline` | `U-16e` | Halt after an unrecoverable pipeline failure |
| `full-pipeline` | `A-08c` | Ignore malformed recording events until valid input arrives |
| `full-pipeline` | `A-09c` | Fail playback safely when the target tab is missing |
| `full-pipeline` | `A-09d` | Pause playback on unrecoverable failure |
| `full-pipeline` | `A-10a` | Export JSON recording in order |
| `full-pipeline` | `A-10b` | Export escaped Playwright script |
| `p-02a` | `P-02a-1` | Google-style search to result |
| `p-02a` | `P-02a-2` | Amazon-style search, open product, add to cart |
| `p-02a` | `P-02a-3` | GitHub-style repo navigation and Issues tab |
| `p-02b` | `P-02b-1` | React-style route transition |
| `p-02b` | `P-02b-2` | Vue-style filter refinement |
| `p-02b` | `P-02b-3` | Angular-style wizard flow |
| `p-02c` | `P-02c-1` | Slow page-context fetch remains stable |
| `p-02c` | `P-02c-2` | Large page context is trimmed safely |
| `p-02c` | `P-02c-3` | Page-context collection failure degrades gracefully |
| `p-02d` | `P-02d-1` | Retry recoverable failure and continue |
| `p-02d` | `P-02d-2` | Stop after unrecoverable failure |
| `p-02d` | `P-02d-3` | Continue after optional-action failure |
| `p-02e` | `P-02e-01` | Support queue urgent filter |
| `p-02e` | `P-02e-02` | Billing contact update |
| `p-02e` | `P-02e-03` | Release-note filter and details |
| `p-02e` | `P-02e-04` | Inventory audit lookup and save |
| `p-02e` | `P-02e-05` | Team-directory search |
| `p-02e` | `P-02e-06` | Incident owner update |
| `p-02e` | `P-02e-07` | Campaign audience change |
| `p-02e` | `P-02e-08` | QA checklist note save |
| `p-02e` | `P-02e-09` | Dashboard comparison filter |
| `p-02e` | `P-02e-10` | Profile nickname save |
| `p-02e` | `P-02e-11` | Vendor search and details |
| `p-02e` | `P-02e-12` | Launch approver save |
| `p-02e` | `P-02e-13` | Feedback board filter |
| `p-02e` | `P-02e-14` | Deployment notes save |
| `p-02e` | `P-02e-15` | Roadmap search and details |
| `p-02e` | `P-02e-16` | Compliance retention save |
| `p-02e` | `P-02e-17` | Feature-flag audience apply |
| `p-02e` | `P-02e-18` | Bug-board playback-failure search |
| `p-02e` | `P-02e-19` | Workflow title save |
| `p-02e` | `P-02e-20` | Account verification note save |
| `p-02e` | `P-02e-21` | Documentation filter and details |
| `p-02e` | `P-02e-22` | Project handoff owner save |
| `p-02e` | `P-02e-23` | Training portal search |
| `p-02e` | `P-02e-24` | Change-review note save |

## Maintenance note

When a deterministic E2E scenario is added, removed, or renamed, update this file in the same change.
