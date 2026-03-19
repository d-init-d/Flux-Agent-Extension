import type { AIProviderFamily, AIProviderType, AIMessage } from './ai';
import type { SessionConfig } from './session';
import type { SavedWorkflowCollection } from './workflow';

export type VaultLockState = 'uninitialized' | 'locked' | 'unlocked';
export type ProviderAuthFamily = 'api-key' | 'oauth-token' | 'account-backed' | 'none';
export type ProviderAuthKind =
  | 'api-key'
  | 'oauth-token'
  | 'account-artifact'
  | 'session-token'
  | 'none';

export type ProviderAccountStatus =
  | 'active'
  | 'available'
  | 'needs-auth'
  | 'revoked'
  | 'error'
  | 'unknown';

export type ProviderEntitlementStatus = 'active' | 'inactive' | 'limited' | 'unknown';
export type ProviderStateScope = 'provider' | 'account' | 'session';
export type ProviderQuotaUnit = 'requests' | 'tokens' | 'credits' | 'unknown';
export type ProviderQuotaPeriod = 'minute' | 'hour' | 'day' | 'month' | 'lifetime' | 'unknown';
export type ProviderSessionStatus = 'active' | 'refresh-required' | 'expired' | 'revoked' | 'unknown';
export type BrowserLoginUiContext = 'options' | 'onboarding' | 'unknown';
export type BrowserLoginResultStatus =
  | 'success'
  | 'cancel'
  | 'timeout'
  | 'stale'
  | 'mismatch'
  | 'helper-missing'
  | 'error';
export type BrowserLoginSurfaceStatus = 'idle' | 'pending' | BrowserLoginResultStatus;
export type AppManagedAuthStoreAuthChoiceId =
  | 'api-key'
  | 'browser-account'
  | 'oauth-token'
  | 'account-artifact';

export interface BrowserLoginHelperSummary {
  id?: string;
  version?: string;
}

export interface BrowserLoginPendingState {
  requestId: string;
  issuedAt: number;
  expiresAt: number;
  uiContext?: BrowserLoginUiContext;
}

export interface ProviderBrowserLoginMetadata {
  authMethod: 'browser-account';
  status: Exclude<BrowserLoginSurfaceStatus, 'pending'>;
  updatedAt: number;
  lastAttemptAt?: number;
  lastCompletedAt?: number;
  accountId?: string;
  accountLabel?: string;
  lastErrorCode?: string;
  retryable?: boolean;
  helper?: BrowserLoginHelperSummary;
}

export interface ProviderBrowserLoginState
  extends Omit<ProviderBrowserLoginMetadata, 'status'> {
  status: BrowserLoginSurfaceStatus;
  pending?: BrowserLoginPendingState;
}

export interface ApiKeyAuthStoreRecord {
  version: number;
  authChoiceId: 'api-key';
  authFamily: Extract<ProviderAuthFamily, 'api-key'>;
  authKind: Extract<ProviderAuthKind, 'api-key'>;
  secret: string;
  credential: ProviderCredentialRecord;
}

export interface BrowserAccountArtifactStoreRecord {
  accountId: string;
  authKind: Extract<ProviderAuthKind, 'account-artifact'>;
  value: string;
  updatedAt: number;
  filename?: string;
  format?: 'json' | 'text' | 'unknown';
}

export interface BrowserAccountAuthStoreRecord {
  version: number;
  authChoiceId: 'browser-account';
  authFamily: Extract<ProviderAuthFamily, 'account-backed'>;
  authKind: Extract<ProviderAuthKind, 'account-artifact'>;
  credential?: ProviderCredentialRecord;
  accounts: ProviderAccountRecord[];
  activeAccountId?: string;
  browserLogin?: ProviderBrowserLoginMetadata;
  artifacts: Record<string, BrowserAccountArtifactStoreRecord>;
}

export type ProviderAuthStoreRecord = ApiKeyAuthStoreRecord | BrowserAccountAuthStoreRecord;

export interface ProviderAuthStore {
  version: number;
  provider: AIProviderType;
  providerFamily?: AIProviderFamily;
  updatedAt: number;
  apiKey?: ApiKeyAuthStoreRecord;
  browserAccount?: BrowserAccountAuthStoreRecord;
  migratedFromVaultAt?: number;
}

export interface AppManagedAuthStore {
  version: number;
  providers: Partial<Record<AIProviderType, ProviderAuthStore>>;
  migratedFromVaultAt?: number;
}

export interface ApiKeyAuthStoreState {
  authChoiceId: 'api-key';
  authFamily: Extract<ProviderAuthFamily, 'api-key'>;
  authKind: Extract<ProviderAuthKind, 'api-key'>;
  credential: ProviderCredentialRecord;
}

export interface BrowserAccountAuthStoreState {
  authChoiceId: 'browser-account';
  authFamily: Extract<ProviderAuthFamily, 'account-backed'>;
  authKind: Extract<ProviderAuthKind, 'account-artifact'>;
  credential?: ProviderCredentialRecord;
  accounts: ProviderAccountRecord[];
  activeAccountId?: string;
  browserLogin?: ProviderBrowserLoginState;
}

export interface ProviderAuthStoreState {
  version: number;
  provider: AIProviderType;
  providerFamily?: AIProviderFamily;
  updatedAt: number;
  apiKey?: ApiKeyAuthStoreState;
  browserAccount?: BrowserAccountAuthStoreState;
  migratedFromVaultAt?: number;
}

export interface AppManagedAuthStoreState {
  version: number;
  providers: Partial<Record<AIProviderType, ProviderAuthStoreState>>;
  migratedFromVaultAt?: number;
}

export interface ProviderCredentialRecord {
  version: number;
  provider: AIProviderType;
  providerFamily?: AIProviderFamily;
  authFamily: ProviderAuthFamily;
  authKind: ProviderAuthKind;
  maskedValue: string;
  updatedAt: number;
  validatedAt?: number;
  stale?: boolean;
}

export interface ProviderQuotaState {
  scope: ProviderStateScope;
  unit: ProviderQuotaUnit;
  period: ProviderQuotaPeriod;
  used?: number;
  limit?: number;
  remaining?: number;
  observedAt: number;
}

export interface ProviderRateLimitState {
  scope: ProviderStateScope;
  limit?: number;
  remaining?: number;
  resetAt?: number;
  retryAfterSeconds?: number;
  windowMs?: number;
  observedAt: number;
}

export interface ProviderEntitlementState {
  status: ProviderEntitlementStatus;
  plan?: string;
  features?: string[];
  checkedAt?: number;
  source?: 'manual-import' | 'validation' | 'runtime-session' | 'unknown';
}

export interface ProviderSessionMetadata {
  authKind: Extract<ProviderAuthKind, 'session-token'>;
  status: ProviderSessionStatus;
  observedAt: number;
  lastIssuedAt?: number;
  expiresAt?: number;
  refreshAfter?: number;
}

export interface ProviderAccountMetadata {
  quota?: ProviderQuotaState;
  rateLimit?: ProviderRateLimitState;
  entitlement?: ProviderEntitlementState;
  session?: ProviderSessionMetadata;
  lastErrorCode?: string;
  lastErrorAt?: number;
}

export interface ProviderAccountRecord {
  version: number;
  provider: AIProviderType;
  providerFamily: AIProviderFamily;
  authFamily: Extract<ProviderAuthFamily, 'account-backed'>;
  accountId: string;
  label: string;
  maskedIdentifier?: string;
  credentialKey?: string;
  status: ProviderAccountStatus;
  isActive?: boolean;
  updatedAt: number;
  validatedAt?: number;
  lastUsedAt?: number;
  stale?: boolean;
  metadata?: ProviderAccountMetadata;
}

export interface VaultMetadata {
  version: number;
  initialized: boolean;
  credentials: Partial<Record<AIProviderType, ProviderCredentialRecord>>;
  accounts: Partial<Record<AIProviderType, ProviderAccountRecord[]>>;
  activeAccounts: Partial<Record<AIProviderType, string>>;
  browserLogins?: Partial<Record<AIProviderType, ProviderBrowserLoginMetadata>>;
  migratedFromLegacyAt?: number;
}

export interface VaultState {
  version: number;
  initialized: boolean;
  lockState: VaultLockState;
  unlockedAt?: number;
  hasLegacySecrets: boolean;
  credentials: Partial<Record<AIProviderType, ProviderCredentialRecord>>;
  accounts: Partial<Record<AIProviderType, ProviderAccountRecord[]>>;
  activeAccounts: Partial<Record<AIProviderType, string>>;
  browserLogins?: Partial<Record<AIProviderType, ProviderBrowserLoginState>>;
}

/**
 * Extension settings stored in chrome.storage.local
 */
export interface StorageSchema {
  // Settings
  settings: ExtensionSettings;

  // Onboarding
  onboarding: OnboardingState;

  // AI Provider configurations
  providers: Record<AIProviderType, ProviderConfig>;

  // Active provider
  activeProvider: AIProviderType;

  // Credential vault metadata. Ciphertext is stored separately by SecureStorage.
  vault: VaultMetadata;

  // Planned app-managed auth store metadata and durable auth material.
  authStore?: AppManagedAuthStore;

  // Conversation history (per session)
  conversationHistory: Record<string, AIMessage[]>;

  // Session configs
  savedSessions: SessionConfig[];

  // Saved workflows
  savedWorkflows: SavedWorkflowCollection;

  // Usage statistics
  usage: UsageStats;

  // Extension state
  extensionState: {
    lastActiveTab: number;
    sidePanelOpen: boolean;
    lastSession: string | null;
  };
}

/**
 * Extension settings
 */
export interface ExtensionSettings {
  // General
  language: 'en' | 'vi' | 'auto';
  theme: 'light' | 'dark' | 'system';

  // AI Settings
  defaultProvider: AIProviderType;
  streamResponses: boolean;
  includeScreenshotsInContext: boolean;
  maxContextLength: number;

  // Execution
  defaultTimeout: number;
  autoRetryOnFailure: boolean;
  maxRetries: number;
  screenshotOnError: boolean;

  // Security
  allowCustomScripts: boolean;
  allowedDomains: string[]; // Empty = all domains
  blockedDomains: string[];

  // UI
  showFloatingBar: boolean;
  highlightElements: boolean;
  soundNotifications: boolean;

  // Debug
  debugMode: boolean;
  logNetworkRequests: boolean;
}

export interface OnboardingState {
  version: number;
  completed: boolean;
  lastStep: number;
  completedAt?: number;
  providerReady?: boolean;
  configuredProvider?: AIProviderType;
  validatedProvider?: AIProviderType;
  resumeRequestedAt?: number;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  enabled: boolean;
  authChoiceId?: string;
  model: string;
  maxTokens: number;
  temperature: number;
  customEndpoint?: string;
  customHeaders?: Record<string, string>;
}

/**
 * Usage statistics
 */
export interface UsageStats {
  totalSessions: number;
  totalActions: number;
  totalTokensUsed: Record<AIProviderType, number>;
  lastUsed: number;
  actionsPerDay: Record<string, number>; // ISO date -> count
}
