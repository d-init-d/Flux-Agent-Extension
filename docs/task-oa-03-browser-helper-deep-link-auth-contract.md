# OA-03 - Browser Helper / Deep-Link Auth Contract

## Status

Accepted

## Scope

This document locks the docs-only contract for the `OpenAI + ChatGPT Pro/Plus (browser)` helper/deep-link flow.

It defines:

- who launches the flow and who controls each step
- request and response payload semantics
- provenance validation rules in the background
- user-visible result and error states
- persistence vs memory-only rules
- trust boundaries across UI, background, helper, and vault
- the contract OA-04 and OA-05 must implement later

It does **not** add runtime code, storage code, message types, manifests, or helper integration yet.

## Goals

- keep `OpenAI` as one UX provider surface with a distinct browser-account lane
- keep the background as the only trusted secret owner inside the extension
- allow a helper/deep-link browser login without exposing raw secrets to the UI
- fail closed on provenance mismatch, stale callbacks, or helper absence

## Non-Goals

- headless login
- extension-owned OAuth callback pages
- `chrome.identity` / `oauth2` expansion
- cookie, browser-tab, `localStorage`, or `sessionStorage` scraping
- direct UI ownership of helper payloads or runtime session tokens

## Direction Of Control

### Launch initiator

The launch initiator is the **Options/onboarding UI**, but only as a user-intent surface.

The **background** owns the actual auth attempt.

### Control sequence

1. User selects `OpenAI -> ChatGPT Pro/Plus (browser)` in UI.
2. UI sends a `start browser login` intent to background.
3. Background creates the auth request record (`requestId`, `state`, `nonce`, expiry, provider/auth lane metadata).
4. Background launches the helper/deep-link handoff.
5. Helper drives the official browser login path and returns a callback/deep-link response.
6. Background validates provenance and request binding.
7. Background persists only approved long-lived account material and metadata.
8. Background reports sanitized result state back to UI.

### Hard rule

Control never passes from UI directly to helper for trust decisions.

The UI may trigger the flow, but only the background may:

- generate `state` / `nonce`
- decide whether a callback is valid
- persist any account artifact
- derive readiness from the callback result

## Canonical Auth Attempt Model

Each login attempt is a single background-owned auth request with:

- `requestId`: stable identifier for one extension-issued attempt
- `state`: correlation token for callback binding and replay rejection
- `nonce`: one-time freshness token scoped to the attempt
- `issuedAt`: creation timestamp
- `expiresAt`: hard deadline for accepting a callback
- `provider`: `openai`
- `authMethod`: `browser-account`

Only one active request per profile/provider/auth lane should be considered authoritative. Later attempts invalidate earlier pending attempts.

## Request Payload Contract

The background-to-helper launch payload must contain at least the following fields.

| Field             | Required | Owner      | Meaning                                                                                                           |
| ----------------- | -------- | ---------- | ----------------------------------------------------------------------------------------------------------------- |
| `version`         | yes      | background | Contract version for helper compatibility, starting at `1`                                                        |
| `provider`        | yes      | background | Must be `openai`                                                                                                  |
| `authMethod`      | yes      | background | Must be `browser-account`                                                                                         |
| `requestId`       | yes      | background | Extension-generated ID for this auth attempt                                                                      |
| `state`           | yes      | background | Opaque callback correlation value; unique per attempt                                                             |
| `nonce`           | yes      | background | One-time freshness value; unique per attempt                                                                      |
| `issuedAt`        | yes      | background | Unix epoch ms when request was created                                                                            |
| `expiresAt`       | yes      | background | Unix epoch ms deadline after which callback must be rejected                                                      |
| `returnChannel`   | yes      | background | Logical return route indicating helper must answer via deep-link/callback into background-owned contract handling |
| `interactive`     | yes      | background | Must be `true`; this flow is user-initiated browser login                                                         |
| `requestedScopes` | no       | background | Optional future-facing entitlement hints; helper may ignore                                                       |
| `uiContext`       | no       | background | Non-secret context like `options` or `onboarding` for analytics/copy only                                         |

### Semantics of `requestId`, `state`, and `nonce`

#### `requestId`

- primary operator/debug identifier
- used by UI/background to track one attempt
- may be returned to UI because it is not itself a secret
- must not be treated as sufficient proof of authenticity

#### `state`

- primary callback correlation token
- generated only by background
- must be returned unchanged by helper callback payload
- mismatch means **hard reject**
- a previously consumed `state` must never be accepted again

#### `nonce`

- one-time freshness token bound to the same auth attempt
- intended to detect stale or replayed helper responses even if `state` leaks or repeats unexpectedly
- must be returned unchanged by helper callback payload
- mismatch means **hard reject**

### Request payload rules

- Background is the sole generator of `requestId`, `state`, and `nonce`.
- UI must never invent or override them.
- Helper must treat them as opaque values.
- Helper must not mutate provider/auth lane values.
- If helper cannot honor `version=1`, it should fail through the canonical `helper-missing` or `error` states at integration time; OA-03 only locks the contract, not the transport-specific code path.

## Response Payload Contract

The helper/deep-link callback into the background must resolve to one canonical result envelope.

### Result envelope

| Field             | Required    | Meaning                                                                                |
| ----------------- | ----------- | -------------------------------------------------------------------------------------- |
| `version`         | yes         | Contract version echoed by helper                                                      |
| `provider`        | yes         | Must be `openai`                                                                       |
| `authMethod`      | yes         | Must be `browser-account`                                                              |
| `requestId`       | yes         | Must match the issued request                                                          |
| `state`           | yes         | Must match the issued request exactly                                                  |
| `nonce`           | yes         | Must match the issued request exactly                                                  |
| `result`          | yes         | One of `success`, `cancel`, `error`                                                    |
| `completedAt`     | yes         | Unix epoch ms when helper completed                                                    |
| `helper`          | yes         | Sanitized helper identity metadata used for provenance checks                          |
| `accountArtifact` | conditional | Present only on `success`; minimal long-lived official-client-derived account material |
| `accountMetadata` | conditional | Present on `success` when helper can provide non-secret metadata                       |
| `error`           | conditional | Present on `error` with canonical error code/details                                   |

### `success` result shape

On `result = success`, the payload must include:

- `accountArtifact`: minimal long-lived material that the background may store encrypted if validation passes
- `accountMetadata`: non-secret metadata if available, such as masked account label, plan hint, issued-at hint, or artifact family/version

The payload must **not** be defined as a runtime token delivery channel to the UI. Any short-lived runtime session/token produced later belongs to OA-05 and remains background memory-only.

### `cancel` result shape

On `result = cancel`, the payload contains no account artifact.

Optional detail may include:

- `reason = user-cancelled`
- `reason = helper-window-closed`
- `reason = browser-aborted`

### `error` result shape

On `result = error`, the payload contains:

- `error.code`
- `error.message` (sanitized)
- optional `error.retryable`
- optional `error.detail` (sanitized, no secrets)

## Background Provenance Validation Rules

The background must reject by default. Persistence is allowed only after all required checks pass.

### Mandatory checks

1. **Contract version check**
   - reject if callback version is unsupported
2. **Provider/auth lane check**
   - reject unless `provider=openai` and `authMethod=browser-account`
3. **Outstanding request check**
   - reject if `requestId` is unknown, already finalized, or not currently pending
4. **State binding check**
   - reject if callback `state` does not exactly match the background-issued `state`
5. **Nonce binding check**
   - reject if callback `nonce` does not exactly match the background-issued `nonce`
6. **Expiry check**
   - reject if current time is after `expiresAt`
7. **Single-use check**
   - reject if the request has already been consumed or superseded by a newer attempt
8. **Helper provenance check**
   - reject if helper identity or return-channel provenance does not match the configured trusted helper contract for this phase
9. **Artifact shape check**
   - on `success`, reject if `accountArtifact` is missing, malformed, or contains disallowed fields/classes of material
10. **Sanitization check**
    - reject or scrub any unexpected secret-bearing diagnostic fields before persistence or UI status propagation

### Provenance meaning in this phase

`Provenance` means the background has enough evidence that:

- the response came through the expected helper/deep-link return path
- it claims the expected helper identity/version family
- it is bound to the exact extension-issued auth attempt
- it was not stale, replayed, or obviously cross-request mixed

OA-03 does not lock one concrete OS/transport mechanism. OA-04 may implement the concrete message surface, but it must preserve these checks.

## Canonical Error States

The product must normalize helper/deep-link outcomes into these user-visible states.

| State            | Meaning                                                                     | Persistence effect                                                          |
| ---------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `success`        | Valid callback accepted and long-lived account artifact stored              | Persist encrypted artifact + allowed metadata                               |
| `cancel`         | User or browser helper cancelled before completion                          | Persist nothing secret                                                      |
| `timeout`        | No valid callback before `expiresAt`                                        | Persist nothing secret; pending request cleared                             |
| `stale`          | Callback arrived after expiry or for a superseded/consumed request          | Persist nothing secret                                                      |
| `mismatch`       | `requestId`, `state`, `nonce`, provider, or auth lane mismatched            | Persist nothing secret                                                      |
| `helper-missing` | Background could not launch or contact the required helper/deep-link target | Persist nothing secret                                                      |
| `error`          | Other validated helper/internal failure not covered above                   | Persist nothing secret unless a separate prior valid account remains active |

### Notes by state

#### `success`

- background may persist validated long-lived account material
- UI receives sanitized ready/connected status only

#### `cancel`

- treated as a neutral user outcome, not a broken state
- should not revoke an already-working prior account unless the user explicitly asked to disconnect first

#### `timeout`

- request expires without valid callback
- request must be finalized so late callbacks become `stale`

#### `stale`

- any late or superseded callback
- background must reject and log as stale/replayed attempt

#### `mismatch`

- includes request mismatch, state mismatch, nonce mismatch, provider mismatch, or auth-method mismatch
- should be treated as suspicious and fail closed

#### `helper-missing`

- helper application not installed, launch target unavailable, or deep-link handoff impossible
- should produce remediation copy in UI later, but OA-03 defines only the state contract

## Persistence Rules

### Persisted in vault / durable storage

Allowed durable data after validated `success`:

- encrypted minimal long-lived `accountArtifact`
- encrypted refresh/revalidation material if part of the approved artifact family
- non-secret account metadata such as masked label, artifact family/version, validation timestamp, entitlement/quota summary, and connection status
- audit/debug metadata that contains no raw secrets

### Memory-only

Must remain memory-only:

- pending request `state`
- pending request `nonce`
- active short-lived runtime session/token
- raw helper callback payload prior to validation, except transient handling needed to process the event
- any derived bearer/session token created for live model requests

### Never persist

- cookies
- browser session blobs
- `localStorage` / `sessionStorage` exports
- MFA/anti-bot material
- raw callback URLs if they embed secrets
- raw helper diagnostics that contain secret-bearing fragments

## Trust Boundary

### UI

- may initiate connect/cancel/retry intents
- may display `pending`, `success`, `cancel`, `timeout`, `stale`, `mismatch`, `helper-missing`, `error`
- may receive masked metadata and timestamps
- must never receive raw `accountArtifact`, raw callback payload, refresh material, or runtime token

### Background

- only trusted in-extension owner of auth-attempt state and secrets
- issues `requestId` / `state` / `nonce`
- validates provenance
- decides persistence
- derives sanitized status for UI
- owns runtime token resolution later in OA-05

### Helper

- untrusted for final acceptance decisions
- may open and drive the official browser login path
- may return candidate account material
- must not decide what the extension persists

### Vault

- durable encrypted storage boundary for approved long-lived material only
- never a staging area for unvalidated helper responses
- never a home for short-lived runtime sessions

## Minimal End-To-End Contract

```text
UI -> background: start browser-account login intent
background: create requestId/state/nonce + expiry
background -> helper: launch request envelope
helper -> background: callback result envelope
background: validate provenance + bind response to request
background -> vault: persist approved long-lived artifact only on success
background -> UI: sanitized status/result
```

## Mapping To OA-04

OA-04 should implement storage and message-surface primitives that match this contract without widening trust.

OA-04 should therefore add, at minimum:

- a pending auth-attempt record shape owned by background
- message/result types that carry only sanitized UI-safe status to UI
- vault schema for encrypted browser-account artifact + non-secret metadata
- canonical result/error enums matching this document

OA-04 must **not** expose raw helper payloads or runtime session tokens to the UI just to make integration easier.

## Mapping To OA-05

OA-05 should consume the OA-04 stored artifact and status model to produce one unified OpenAI runtime coordinator.

OA-05 should therefore:

- resolve `openai + api-key` vs `openai + browser-account` in background only
- derive short-lived runtime session/tokens from stored browser-account material only in memory
- gate readiness on this contract's validated states
- treat `stale`, `mismatch`, and provenance failures as hard non-ready states

OA-05 must not redefine the helper/deep-link contract or move acceptance decisions into UI code.

## Final Lock

Until a later ADR changes direction, OA-03 locks the following:

- background owns request creation, validation, and persistence decisions
- helper/deep-link callback acceptance requires `requestId` + `state` + `nonce` binding plus provenance checks
- canonical user-visible states are `success`, `cancel`, `timeout`, `stale`, `mismatch`, `helper-missing`, `error`
- long-lived account artifacts may persist only after validated success
- runtime session/tokens remain memory-only
- UI never receives raw helper secrets
