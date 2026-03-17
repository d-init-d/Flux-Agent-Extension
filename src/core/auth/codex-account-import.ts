import { z } from 'zod';

import { ErrorCode, ExtensionError } from '@shared/errors';
import type { AccountAuthArtifactImportPayload, ProviderAccountMetadata } from '@shared/types';

const SUPPORTED_AUTH_MODES = new Set(['chatgpt']);

export const SUPPORTED_CODEX_AUTH_FIELDS = [
  'auth_mode',
  'last_refresh',
  'tokens.access_token',
  'tokens.id_token',
  'tokens.refresh_token',
  'tokens.account_id',
] as const;

const officialAuthJsonSchema = z.object({
  auth_mode: z.string().optional(),
  last_refresh: z.union([z.string(), z.number(), z.date()]).optional(),
  tokens: z
    .object({
      access_token: z.string().trim().min(1).optional(),
      id_token: z.string().trim().min(1).optional(),
      refresh_token: z.string().trim().min(1).optional(),
      account_id: z.string().trim().min(1).optional(),
    })
    .optional(),
});

const flatTokenBundleSchema = z.object({
  auth_mode: z.string().optional(),
  last_refresh: z.union([z.string(), z.number(), z.date()]).optional(),
  access_token: z.string().trim().min(1).optional(),
  id_token: z.string().trim().min(1).optional(),
  refresh_token: z.string().trim().min(1).optional(),
  account_id: z.string().trim().min(1).optional(),
});

type ParsedArtifactSource = 'official-auth-json' | 'flat-json' | 'text-bundle';

export interface ImportedCodexAccountArtifact {
  authKind: 'account-artifact';
  source: ParsedArtifactSource;
  storageFormat: 'json' | 'text';
  storageValue: string;
  supportedFields: readonly string[];
  authMode?: 'chatgpt';
  lastRefreshAt?: number;
  tokens: {
    accessToken?: string;
    idToken: string;
    refreshToken: string;
    accountId?: string;
  };
  identity: {
    email?: string;
    plan?: string;
    chatgptUserId?: string;
    chatgptAccountId?: string;
  };
  derived: {
    accountId: string;
    label: string;
    maskedIdentifier?: string;
    credentialMaskedValue: string;
  };
  metadata: ProviderAccountMetadata;
}

type ParsedTokenBundle = {
  source: ParsedArtifactSource;
  storageFormat: 'json' | 'text';
  storageValue: string;
  authMode?: string;
  lastRefreshAt?: number;
  accessToken?: string;
  idToken?: string;
  refreshToken?: string;
  accountId?: string;
};

type ParsedIdTokenClaims = {
  email?: string;
  plan?: string;
  chatgptUserId?: string;
  chatgptAccountId?: string;
};

export async function importCodexAccountArtifact(
  artifact: AccountAuthArtifactImportPayload,
  options?: { label?: string },
): Promise<ImportedCodexAccountArtifact> {
  const parsedBundle = parseArtifactBundle(artifact);

  if (parsedBundle.authMode && !SUPPORTED_AUTH_MODES.has(parsedBundle.authMode)) {
    throw new ExtensionError(
      ErrorCode.AI_INVALID_KEY,
      `Unsupported Codex auth mode "${parsedBundle.authMode}". Only chatgpt auth artifacts are supported.`,
      true,
    );
  }

  const refreshToken = parsedBundle.refreshToken?.trim();
  const idToken = parsedBundle.idToken?.trim();
  if (!refreshToken || !idToken) {
    throw new ExtensionError(
      ErrorCode.AI_INVALID_KEY,
      'Unsupported Codex auth artifact. Baseline import requires refresh_token and id_token from an official Codex auth.json or equivalent text bundle.',
      true,
      {
        supportedFields: [...SUPPORTED_CODEX_AUTH_FIELDS],
      },
    );
  }

  const claims = parseIdTokenClaims(idToken);
  const accountId = await deriveAccountId({
    explicitAccountId: parsedBundle.accountId,
    chatgptAccountId: claims.chatgptAccountId,
    chatgptUserId: claims.chatgptUserId,
    email: claims.email,
    refreshToken,
  });
  const maskedIdentifier = deriveMaskedIdentifier(claims.email, parsedBundle.accountId, accountId);
  const label = buildAccountLabel(options?.label, claims.plan, maskedIdentifier, accountId);
  const credentialMaskedValue = buildCredentialMaskedValue(maskedIdentifier, accountId);
  const now = Date.now();

  return {
    authKind: 'account-artifact',
    source: parsedBundle.source,
    storageFormat: parsedBundle.storageFormat,
    storageValue: parsedBundle.storageValue,
    supportedFields: SUPPORTED_CODEX_AUTH_FIELDS,
    authMode: parsedBundle.authMode === 'chatgpt' ? 'chatgpt' : undefined,
    lastRefreshAt: parsedBundle.lastRefreshAt,
    tokens: {
      accessToken: parsedBundle.accessToken?.trim() || undefined,
      idToken,
      refreshToken,
      accountId: parsedBundle.accountId?.trim() || undefined,
    },
    identity: {
      email: claims.email,
      plan: claims.plan,
      chatgptUserId: claims.chatgptUserId,
      chatgptAccountId: claims.chatgptAccountId,
    },
    derived: {
      accountId,
      label,
      maskedIdentifier,
      credentialMaskedValue,
    },
    metadata: {
      entitlement:
        claims.plan || claims.chatgptAccountId || claims.chatgptUserId
          ? {
              status: claims.plan ? 'active' : 'unknown',
              plan: claims.plan,
              checkedAt: now,
              source: 'manual-import',
            }
          : undefined,
      lastErrorAt: undefined,
      lastErrorCode: undefined,
    },
  };
}

function parseArtifactBundle(artifact: AccountAuthArtifactImportPayload): ParsedTokenBundle {
  const rawValue = artifact.value?.trim();
  if (!rawValue) {
    throw new ExtensionError(ErrorCode.AI_INVALID_KEY, 'Auth artifact is required', true);
  }

  const shouldParseJson = artifact.format === 'json' || rawValue.startsWith('{');
  if (shouldParseJson) {
    try {
      const candidate = JSON.parse(rawValue) as unknown;
      const officialParsed = officialAuthJsonSchema.safeParse(candidate);
      if (officialParsed.success && officialParsed.data.tokens) {
        return {
          source: 'official-auth-json',
          storageFormat: 'json',
          storageValue: rawValue,
          authMode: officialParsed.data.auth_mode,
          lastRefreshAt: normalizeTimestamp(officialParsed.data.last_refresh),
          accessToken: officialParsed.data.tokens.access_token,
          idToken: officialParsed.data.tokens.id_token,
          refreshToken: officialParsed.data.tokens.refresh_token,
          accountId: officialParsed.data.tokens.account_id,
        };
      }

      const flatParsed = flatTokenBundleSchema.safeParse(candidate);
      if (flatParsed.success) {
        return {
          source: 'flat-json',
          storageFormat: 'json',
          storageValue: rawValue,
          authMode: flatParsed.data.auth_mode,
          lastRefreshAt: normalizeTimestamp(flatParsed.data.last_refresh),
          accessToken: flatParsed.data.access_token,
          idToken: flatParsed.data.id_token,
          refreshToken: flatParsed.data.refresh_token,
          accountId: flatParsed.data.account_id,
        };
      }
    } catch {
      if (artifact.format === 'json') {
        throw new ExtensionError(
          ErrorCode.AI_INVALID_KEY,
          'Auth artifact JSON could not be parsed',
          true,
        );
      }
    }
  }

  const textBundle = parseTextTokenBundle(rawValue);
  return {
    source: 'text-bundle',
    storageFormat: artifact.format === 'json' ? 'json' : 'text',
    storageValue: rawValue,
    ...textBundle,
  };
}

function parseTextTokenBundle(value: string): Omit<ParsedTokenBundle, 'source' | 'storageFormat' | 'storageValue'> {
  const lines = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  const entries: Record<string, string> = {};
  for (const line of lines) {
    const separatorIndex = getFirstSeparatorIndex(line);
    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalizeTextKey(line.slice(0, separatorIndex));
    const valuePart = line.slice(separatorIndex + 1).trim();
    if (!key || !valuePart) {
      continue;
    }

    entries[key] = stripWrappingQuotes(valuePart);
  }

  return {
    authMode: entries.auth_mode,
    lastRefreshAt: normalizeTimestamp(entries.last_refresh),
    accessToken: entries.access_token,
    idToken: entries.id_token,
    refreshToken: entries.refresh_token,
    accountId: entries.account_id,
  };
}

function parseIdTokenClaims(idToken: string): ParsedIdTokenClaims {
  const parts = idToken.split('.');
  if (parts.length !== 3 || !parts[1]) {
    throw new ExtensionError(
      ErrorCode.AI_INVALID_KEY,
      'The imported id_token is not a valid JWT',
      true,
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(base64UrlDecode(parts[1])) as Record<string, unknown>;
  } catch {
    throw new ExtensionError(
      ErrorCode.AI_INVALID_KEY,
      'The imported id_token payload could not be decoded',
      true,
    );
  }

  const profile = asRecord(payload['https://api.openai.com/profile']);
  const auth = asRecord(payload['https://api.openai.com/auth']);
  const email = asOptionalString(payload.email) ?? asOptionalString(profile?.email);
  const rawPlan = asOptionalString(auth?.chatgpt_plan_type);

  return {
    email: email?.toLowerCase(),
    plan: rawPlan ? normalizePlan(rawPlan) : undefined,
    chatgptUserId: asOptionalString(auth?.chatgpt_user_id) ?? asOptionalString(auth?.user_id),
    chatgptAccountId: asOptionalString(auth?.chatgpt_account_id),
  };
}

async function deriveAccountId(input: {
  explicitAccountId?: string;
  chatgptAccountId?: string;
  chatgptUserId?: string;
  email?: string;
  refreshToken: string;
}): Promise<string> {
  const directId =
    normalizeAccountIdCandidate(input.explicitAccountId) ??
    normalizeAccountIdCandidate(input.chatgptAccountId);
  if (directId) {
    return directId;
  }

  const seed = input.chatgptUserId ?? input.email ?? input.refreshToken;
  return `acct_${(await sha256Hex(seed)).slice(0, 16)}`;
}

function deriveMaskedIdentifier(
  email: string | undefined,
  explicitAccountId: string | undefined,
  derivedAccountId: string,
): string | undefined {
  if (email) {
    return maskEmail(email);
  }

  const candidate = explicitAccountId?.trim() || derivedAccountId;
  return candidate ? maskOpaqueValue(candidate) : undefined;
}

function buildAccountLabel(
  explicitLabel: string | undefined,
  plan: string | undefined,
  maskedIdentifier: string | undefined,
  accountId: string,
): string {
  const trimmedLabel = explicitLabel?.trim();
  if (trimmedLabel) {
    return trimmedLabel;
  }

  const baseLabel = plan ? `ChatGPT ${plan} account` : 'ChatGPT account';
  return maskedIdentifier ? `${baseLabel} (${maskedIdentifier})` : `${baseLabel} (${maskOpaqueValue(accountId)})`;
}

function buildCredentialMaskedValue(maskedIdentifier: string | undefined, accountId: string): string {
  return maskedIdentifier ? `chatgpt:${maskedIdentifier}` : `acct_****${accountId.slice(-4)}`;
}

function normalizePlan(value: string): string {
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'free':
      return 'Free';
    case 'go':
      return 'Go';
    case 'plus':
      return 'Plus';
    case 'pro':
      return 'Pro';
    case 'team':
      return 'Team';
    case 'business':
      return 'Business';
    case 'enterprise':
      return 'Enterprise';
    case 'education':
    case 'edu':
      return 'Edu';
    default:
      return value.trim();
  }
}

function normalizeTextKey(value: string): string {
  return value.trim().toLowerCase().replace(/^tokens\./u, '').replace(/\s+/gu, '_');
}

function getFirstSeparatorIndex(value: string): number {
  const equalsIndex = value.indexOf('=');
  const colonIndex = value.indexOf(':');
  if (equalsIndex === -1) {
    return colonIndex;
  }
  if (colonIndex === -1) {
    return equalsIndex;
  }
  return Math.min(equalsIndex, colonIndex);
}

function stripWrappingQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
      return value.slice(1, -1);
    }
  }

  return value;
}

function normalizeTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.getTime();
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function normalizeAccountIdCandidate(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/[^a-zA-Z0-9:_-]/gu, '_').slice(0, 80);
}

function maskEmail(email: string): string {
  const [localPart, domain] = email.split('@');
  if (!localPart || !domain) {
    return maskOpaqueValue(email);
  }

  const safeLocal = localPart.length <= 2 ? `${localPart[0] ?? '*'}*` : `${localPart.slice(0, 2)}***`;
  return `${safeLocal}@${domain}`;
}

function maskOpaqueValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) {
    return '****';
  }

  return `${trimmed.slice(0, 4)}****${trimmed.slice(-4)}`;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/gu, '+').replace(/_/gu, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');

  const decoder = globalThis.atob;
  if (typeof decoder === 'function') {
    return decodeUtf8Binary(decoder.call(globalThis, padded));
  }

  throw new Error('No base64 decoder available');
}

function decodeUtf8Binary(binary: string): string {
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (chunk) => chunk.toString(16).padStart(2, '0')).join('');
}
