import type { AppManagedAuthStore } from '@shared/types';
import { describe, expect, it } from 'vitest';

import {
  AUTH_STORE_VERSION,
  createDefaultAuthStore,
  createDefaultAuthStoreState,
  hasAuthStoreData,
  normalizeAuthStore,
  toAuthStoreState,
} from '../auth-store';

describe('app-managed auth store helpers', () => {
  it('creates an empty default auth store and state', () => {
    expect(createDefaultAuthStore()).toEqual({
      version: AUTH_STORE_VERSION,
      providers: {},
    });
    expect(createDefaultAuthStoreState()).toEqual({
      version: AUTH_STORE_VERSION,
      providers: {},
    });
  });

  it('normalizes valid durable auth records and drops unsupported secrets or dangerous browser-login fields', () => {
    const normalized = normalizeAuthStore({
      version: 1.9,
      providers: {
        openai: {
          version: 1,
          provider: 'openai',
          providerFamily: 'default',
          updatedAt: 100.9,
          apiKey: {
            version: 1,
            authChoiceId: 'api-key',
            authFamily: 'api-key',
            authKind: 'api-key',
            secret: 'sk-openai-local',
            credential: {
              version: 1,
              provider: 'openai',
              providerFamily: 'default',
              authFamily: 'api-key',
              authKind: 'api-key',
              maskedValue: 'sk-****local',
              updatedAt: 100.2,
              validatedAt: 101.4,
            },
          },
          browserAccount: {
            version: 1,
            authChoiceId: 'browser-account',
            authFamily: 'account-backed',
            authKind: 'account-artifact',
            activeAccountId: 'acct-openai-1',
            credential: {
              version: 1,
              provider: 'openai',
              providerFamily: 'default',
              authFamily: 'account-backed',
              authKind: 'account-artifact',
              maskedValue: 'acct_****1234',
              updatedAt: 105,
            },
            accounts: [
              {
                version: 1,
                provider: 'openai',
                providerFamily: 'default',
                authFamily: 'account-backed',
                accountId: 'acct-openai-1',
                label: 'OpenAI Browser Account',
                status: 'active',
                isActive: true,
                updatedAt: 105,
                validatedAt: 106,
                metadata: {
                  entitlement: {
                    status: 'active',
                    plan: 'plus',
                    features: ['codex'],
                    checkedAt: 107,
                    source: 'validation',
                    rawToken: 'must-be-dropped',
                  },
                  session: {
                    authKind: 'session-token',
                    status: 'active',
                    observedAt: 108,
                    expiresAt: 109,
                    accessToken: 'must-be-dropped',
                  },
                },
              },
            ],
            browserLogin: {
              authMethod: 'browser-account',
              status: 'success',
              updatedAt: 106,
              helper: { id: 'opencode-helper', version: '1.0.0' },
              accountId: 'acct-openai-1',
              accountLabel: 'OpenAI Browser Account',
              requestId: 'should-be-dropped',
              state: 'should-be-dropped',
              nonce: 'should-be-dropped',
            },
            artifacts: {
              'acct-openai-1': {
                accountId: 'acct-openai-1',
                authKind: 'account-artifact',
                value: '{"refresh":"encrypted"}',
                updatedAt: 107,
                filename: 'artifact.json',
                format: 'json',
              },
              'acct-openai-2': {
                accountId: 'acct-openai-2',
                authKind: 'session-token',
                value: 'must-be-dropped',
                updatedAt: 107,
              },
            },
          },
        },
        invalid: {
          version: 1,
          provider: 'invalid',
        },
      },
    });

    expect(normalized).toEqual({
      version: 1,
      providers: {
        openai: {
          version: 1,
          provider: 'openai',
          providerFamily: 'default',
          updatedAt: 100,
          apiKey: {
            version: 1,
            authChoiceId: 'api-key',
            authFamily: 'api-key',
            authKind: 'api-key',
            secret: 'sk-openai-local',
            credential: {
              version: 1,
              provider: 'openai',
              providerFamily: 'default',
              authFamily: 'api-key',
              authKind: 'api-key',
              maskedValue: 'sk-****local',
              updatedAt: 100,
              validatedAt: 101,
              stale: false,
            },
          },
          browserAccount: {
            version: 1,
            authChoiceId: 'browser-account',
            authFamily: 'account-backed',
            authKind: 'account-artifact',
            activeAccountId: 'acct-openai-1',
            credential: {
              version: 1,
              provider: 'openai',
              providerFamily: 'default',
              authFamily: 'account-backed',
              authKind: 'account-artifact',
              maskedValue: 'acct_****1234',
              updatedAt: 105,
              validatedAt: undefined,
              stale: false,
            },
            accounts: [
              {
                version: 1,
                provider: 'openai',
                providerFamily: 'default',
                authFamily: 'account-backed',
                accountId: 'acct-openai-1',
                label: 'OpenAI Browser Account',
                status: 'active',
                isActive: true,
                updatedAt: 105,
                validatedAt: 106,
                maskedIdentifier: undefined,
                credentialKey: undefined,
                lastUsedAt: undefined,
                stale: false,
                metadata: {
                  entitlement: {
                    status: 'active',
                    plan: 'plus',
                    features: ['codex'],
                    checkedAt: 107,
                    source: 'validation',
                  },
                  session: {
                    authKind: 'session-token',
                    status: 'active',
                    observedAt: 108,
                    lastIssuedAt: undefined,
                    expiresAt: 109,
                    refreshAfter: undefined,
                  },
                  lastErrorCode: undefined,
                  lastErrorAt: undefined,
                  quota: undefined,
                  rateLimit: undefined,
                },
              },
            ],
            browserLogin: {
              authMethod: 'browser-account',
              status: 'success',
              updatedAt: 106,
              accountId: 'acct-openai-1',
              accountLabel: 'OpenAI Browser Account',
              helper: { id: 'opencode-helper', version: '1.0.0' },
              lastAttemptAt: undefined,
              lastCompletedAt: undefined,
              lastErrorCode: undefined,
              retryable: false,
            },
            artifacts: {
              'acct-openai-1': {
                accountId: 'acct-openai-1',
                authKind: 'account-artifact',
                value: '{"refresh":"encrypted"}',
                updatedAt: 107,
                filename: 'artifact.json',
                format: 'json',
              },
            },
          },
          migratedFromVaultAt: undefined,
        },
      },
      migratedFromVaultAt: undefined,
    });
  });

  it('creates a sanitized state view without secrets or artifact payloads', () => {
    const store: AppManagedAuthStore = {
      version: AUTH_STORE_VERSION,
      providers: {
        openai: {
          version: 1,
          provider: 'openai',
          providerFamily: 'default',
          updatedAt: 200,
          apiKey: {
            version: 1,
            authChoiceId: 'api-key',
            authFamily: 'api-key',
            authKind: 'api-key',
            secret: 'sk-secret',
            credential: {
              version: 1,
              provider: 'openai',
              providerFamily: 'default',
              authFamily: 'api-key',
              authKind: 'api-key',
              maskedValue: 'sk-****',
              updatedAt: 200,
            },
          },
          browserAccount: {
            version: 1,
            authChoiceId: 'browser-account',
            authFamily: 'account-backed',
            authKind: 'account-artifact',
            activeAccountId: 'acct-openai-1',
            accounts: [
              {
                version: 1,
                provider: 'openai',
                providerFamily: 'default',
                authFamily: 'account-backed',
                accountId: 'acct-openai-1',
                label: 'OpenAI Browser Account',
                status: 'active',
                updatedAt: 200,
              },
            ],
            artifacts: {
              'acct-openai-1': {
                accountId: 'acct-openai-1',
                authKind: 'account-artifact',
                value: 'must-not-leak',
                updatedAt: 200,
              },
            },
          },
        },
      },
    };

    expect(toAuthStoreState(store)).toEqual({
      version: AUTH_STORE_VERSION,
      migratedFromVaultAt: undefined,
      providers: {
        openai: {
          version: 1,
          provider: 'openai',
          providerFamily: 'default',
          updatedAt: 200,
          migratedFromVaultAt: undefined,
          apiKey: {
            authChoiceId: 'api-key',
            authFamily: 'api-key',
            authKind: 'api-key',
            credential: {
              version: 1,
              provider: 'openai',
              providerFamily: 'default',
              authFamily: 'api-key',
              authKind: 'api-key',
              maskedValue: 'sk-****',
              updatedAt: 200,
              validatedAt: undefined,
              stale: false,
            },
          },
          browserAccount: {
            authChoiceId: 'browser-account',
            authFamily: 'account-backed',
            authKind: 'account-artifact',
            accounts: [
              {
                version: 1,
                provider: 'openai',
                providerFamily: 'default',
                authFamily: 'account-backed',
                accountId: 'acct-openai-1',
                label: 'OpenAI Browser Account',
                maskedIdentifier: undefined,
                credentialKey: undefined,
                status: 'active',
                isActive: false,
                updatedAt: 200,
                validatedAt: undefined,
                lastUsedAt: undefined,
                stale: false,
                metadata: undefined,
              },
            ],
            activeAccountId: 'acct-openai-1',
            browserLogin: undefined,
            credential: undefined,
          },
        },
      },
    });
    expect(hasAuthStoreData(store)).toBe(true);
    expect(hasAuthStoreData(createDefaultAuthStore())).toBe(false);
  });

  it('normalizes before projecting to UI-facing state', () => {
    const projected = toAuthStoreState({
      version: AUTH_STORE_VERSION,
      providers: {
        openai: {
          version: 1,
          provider: 'openai',
          providerFamily: 'default',
          updatedAt: 200,
          browserAccount: {
            version: 1,
            authChoiceId: 'browser-account',
            authFamily: 'account-backed',
            authKind: 'account-artifact',
            accounts: [
              {
                version: 1,
                provider: 'openai',
                providerFamily: 'default',
                authFamily: 'account-backed',
                accountId: 'acct-openai-1',
                label: 'OpenAI Browser Account',
                status: 'active',
                updatedAt: 200,
                metadata: {
                  entitlement: { status: 'active', plan: 'plus' },
                  leakedToken: 'must-not-survive',
                },
              },
            ],
            browserLogin: {
              authMethod: 'browser-account',
              status: 'success',
              updatedAt: 201,
              helper: { id: 'helper', version: '1.0.0' },
              requestId: 'must-not-survive',
            },
            artifacts: {
              'acct-openai-1': {
                accountId: 'acct-openai-1',
                authKind: 'account-artifact',
                value: 'must-not-leak',
                updatedAt: 202,
              },
            },
          },
        },
      },
    } as unknown as AppManagedAuthStore);

    expect(projected.providers.openai?.browserAccount).toEqual(
      expect.objectContaining({
        accounts: [
          expect.objectContaining({
            metadata: {
              entitlement: { status: 'active', plan: 'plus' },
              quota: undefined,
              rateLimit: undefined,
              session: undefined,
              lastErrorCode: undefined,
              lastErrorAt: undefined,
            },
          }),
        ],
        browserLogin: expect.objectContaining({
          authMethod: 'browser-account',
          status: 'success',
          helper: { id: 'helper', version: '1.0.0' },
        }),
      }),
    );
    expect(projected.providers.openai?.browserAccount?.browserLogin).not.toHaveProperty('requestId');
  });
});
