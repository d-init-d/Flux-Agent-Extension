# Task 08 - Manifest And Auth Wiring Decision

## Decision

`NO-CHANGE`

The current import-based Codex account flow does not require manifest changes, new permissions, extension-owned OAuth redirect handling, or a dedicated auth callback page.

## Evidence

- `src/manifest.json` contains the existing automation permissions and broad host access already used by the shipped product surface.
- `src/core/auth/codex-account-import.ts` only parses imported artifacts locally.
- `src/background/ui-session-runtime.ts` only supports `artifact-import` for the account-backed auth transport.
- `docs/task-03-auth-strategy-adr.md` explicitly says manifest and callback wiring should only be added if the chosen auth path truly requires it.
- `SECURITY.md` keeps secrets background-owned and does not require a new interactive browser auth surface for the current implementation stage.

## Why No Manifest Change Is Needed

### Current Flow Shape

- User imports an auth artifact from an official client.
- The background runtime parses and validates the artifact locally.
- The vault stores encrypted account artifacts and metadata.
- No browser-based login is launched by the extension.
- No redirect URI or callback page is used.

### Not Present In The Current Flow

- `chrome.identity`
- `oauth2`
- extension callback pages
- redirect URI handling
- state or PKCE management
- extension-owned interactive OAuth windows

## Permissions To Keep Unchanged

- Keep the existing `permissions` set in `src/manifest.json` unchanged for this task.
- Keep the existing `host_permissions` unchanged for this task.
- Do not add `identity` or `oauth2` yet.

## Security Rationale

- Import-based auth is local parsing plus secure storage, not extension-initiated OAuth.
- Adding unused auth permissions now would widen the security surface without providing product value.
- Keeping the manifest unchanged preserves a smaller delta while the implementation still uses offline artifact validation.

## Revisit Triggers

Re-open Task 08 only if one of the following becomes true:

- The project adopts an official extension-facing auth flow
- The provider needs extension-owned interactive login or callback handling
- Token exchange or refresh requires `chrome.identity` or a dedicated callback surface
- OpenAI documents a supported extension auth contract

## Task 08 Exit State

- No manifest change is required at the current implementation stage.
- The roadmap can advance to session-management work without expanding extension permissions.
