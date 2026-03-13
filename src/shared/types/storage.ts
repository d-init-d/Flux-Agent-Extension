import type { AIProviderType, AIMessage } from './ai';
import type { SessionConfig } from './session';
import type { SavedWorkflowCollection } from './workflow';

export type VaultLockState = 'uninitialized' | 'locked' | 'unlocked';
export type ProviderAuthKind = 'api-key' | 'oauth-token' | 'none';

export interface ProviderCredentialRecord {
  version: number;
  provider: AIProviderType;
  authKind: ProviderAuthKind;
  maskedValue: string;
  updatedAt: number;
  validatedAt?: number;
  stale?: boolean;
}

export interface VaultMetadata {
  version: number;
  initialized: boolean;
  credentials: Partial<Record<AIProviderType, ProviderCredentialRecord>>;
  migratedFromLegacyAt?: number;
}

export interface VaultState {
  version: number;
  initialized: boolean;
  lockState: VaultLockState;
  unlockedAt?: number;
  hasLegacySecrets: boolean;
  credentials: Partial<Record<AIProviderType, ProviderCredentialRecord>>;
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
