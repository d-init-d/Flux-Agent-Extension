import type { Action, ElementSelector } from './actions';
import type { ActionResult, PageContext } from './browser';
import type { AIProviderType } from './ai';
import type {
  RecordedSessionAction,
  SessionConfig,
  Session,
  SessionRecordingExportFormat,
} from './session';
import type {
  ExtensionSettings,
  OnboardingState,
  ProviderAccountRecord,
  ProviderConfig,
  ProviderCredentialRecord,
  ProviderQuotaState,
  VaultState,
} from './storage';
import type { SerializedFileUpload } from './uploads';
import type { SavedWorkflow, SavedWorkflowSource } from './workflow';
import type { ContextBuilderOptions } from '../../core/session/interfaces';
import { EXTENSION_MESSAGE_CHANNELS, EXTENSION_MESSAGE_TYPES } from '@shared/config';

/**
 * Message channels
 */
export type MessageChannel = (typeof EXTENSION_MESSAGE_CHANNELS)[number];

/**
 * All message types in the extension
 */
export type ExtensionMessageType = (typeof EXTENSION_MESSAGE_TYPES)[number];

/**
 * Base message structure
 */
export interface ExtensionMessage<T = unknown> {
  id: string;
  channel: MessageChannel;
  type: ExtensionMessageType;
  payload: T;
  timestamp: number;
}

/**
 * Response wrapper
 */
export interface ExtensionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ============================================================================
// Request/Response types for each message
// ============================================================================

export interface SessionCreateRequest {
  config: Omit<SessionConfig, 'id'>;
  tabId?: number;
}

export interface SessionCreateResponse {
  session: Session;
}

export type SessionUpdateReason = 'created' | 'updated' | 'deleted';

export interface SessionUpdateEventPayload {
  sessionId: string;
  session: Session | null;
  reason: SessionUpdateReason;
}

export type ActionLogEventStatus = 'pending' | 'running' | 'done' | 'failed';

export interface ActionLogEventEntry {
  id: string;
  actionId?: string;
  title: string;
  detail: string;
  timestamp: number;
  status: ActionLogEventStatus;
  progress: number;
  currentStep: number;
  totalSteps: number;
  selector?: ElementSelector;
  errorCode?: string;
  riskLevel?: 'standard' | 'high';
  riskReason?: string;
}

export interface ActionProgressEventPayload {
  sessionId: string;
  entry: ActionLogEventEntry;
}

export interface AIStreamEventPayload {
  sessionId: string;
  messageId: string;
  delta: string;
  done: boolean;
  error?: string;
}

export interface SessionStartRequest {
  sessionId: string;
  prompt?: string;
}

export interface SessionPlaybackControlRequest {
  sessionId: string;
}

export interface SessionPlaybackStartRequest extends SessionPlaybackControlRequest {
  speed?: number;
}

export interface SessionPlaybackResumeRequest extends SessionPlaybackControlRequest {
  speed?: number;
}

export interface SessionPlaybackSetSpeedRequest extends SessionPlaybackControlRequest {
  speed: number;
}

export interface SessionRecordingExportRequest {
  sessionId: string;
  format: SessionRecordingExportFormat;
}

export interface SessionRecordingExportResponse {
  downloadId: number;
  filename: string;
  format: SessionRecordingExportFormat;
}

export interface WorkflowListResponse {
  workflows: SavedWorkflow[];
}

export interface WorkflowCreateRequest {
  name: string;
  description?: string;
  tags: string[];
  actions: RecordedSessionAction[];
  source?: SavedWorkflowSource;
}

export interface WorkflowCreateResponse {
  workflow: SavedWorkflow;
}

export interface WorkflowUpdateRequest {
  workflowId: string;
  updates: {
    name: string;
    description?: string;
    tags: string[];
  };
}

export interface WorkflowUpdateResponse {
  workflow: SavedWorkflow;
}

export interface WorkflowDeleteRequest {
  workflowId: string;
}

export interface WorkflowDeleteResponse {
  workflowId: string;
}

export interface WorkflowRunRequest {
  workflowId: string;
  sessionId: string;
  speed?: 0.5 | 1 | 2;
}

export interface WorkflowRunResponse {
  workflow: SavedWorkflow;
  session: Session;
}

export interface SessionSendMessageRequest {
  sessionId: string;
  message: string;
  uploads?: SerializedFileUpload[];
}

export interface ActionExecuteRequest {
  sessionId?: string;
  action: Action;
}

export interface ActionExecuteResponse {
  result: ActionResult;
}

export interface SettingsGetResponse {
  settings: ExtensionSettings;
  providers: Partial<Record<AIProviderType, Partial<ProviderConfig>>>;
  activeProvider: AIProviderType;
  onboarding: OnboardingState;
  vault: VaultState;
}

export interface SettingsUpdateRequest {
  settings: Partial<ExtensionSettings>;
}

export interface ProviderSetRequest {
  provider: AIProviderType;
  config: ProviderConfig;
  makeDefault?: boolean;
}

export interface ProviderSetResponse {
  activeProvider: AIProviderType;
  providerConfig: ProviderConfig;
}

export interface VaultPassphraseRequest {
  passphrase: string;
}

export interface VaultStatusResponse {
  vault: VaultState;
}

export interface ApiKeySetRequest {
  provider: AIProviderType;
  apiKey: string;
  authKind?: ProviderCredentialRecord['authKind'];
  validate?: boolean;
  maskedValue?: string;
}

export interface ApiKeyDeleteRequest {
  provider: AIProviderType;
}

export interface ApiKeySetResponse {
  record: ProviderCredentialRecord;
  vault: VaultState;
}

export interface ApiKeyValidateRequest {
  provider: AIProviderType;
  apiKey?: string;
  authKind?: ProviderCredentialRecord['authKind'];
  config?: ProviderConfig;
}

export interface ApiKeyValidateResponse {
  valid: boolean;
  record?: ProviderCredentialRecord;
  vault: VaultState;
}

export type AccountAuthTransport = 'artifact-import';

export type AccountAuthSurfaceStatus =
  | 'ready'
  | 'needs-auth'
  | 'vault-locked'
  | 'not-supported';

export interface AccountAuthArtifactImportPayload {
  format: 'json' | 'text' | 'unknown';
  value: string;
  filename?: string;
}

export interface AccountAuthStatusGetRequest {
  provider: AIProviderType;
}

export interface AccountAuthStatusGetResponse {
  provider: AIProviderType;
  authFamily: 'account-backed';
  status: AccountAuthSurfaceStatus;
  availableTransports: AccountAuthTransport[];
  credential?: ProviderCredentialRecord;
  accounts: ProviderAccountRecord[];
  activeAccountId?: string;
  vault: VaultState;
}

export interface AccountAuthConnectStartRequest {
  provider: AIProviderType;
  transport: AccountAuthTransport;
  artifact?: AccountAuthArtifactImportPayload;
  label?: string;
}

export interface AccountAuthConnectStartResponse {
  provider: AIProviderType;
  transport: AccountAuthTransport;
  accepted: boolean;
  nextStep: 'validate' | 'manual-action';
  message: string;
}

export interface AccountAuthValidateRequest {
  provider: AIProviderType;
  accountId?: string;
  transport?: AccountAuthTransport;
  artifact?: AccountAuthArtifactImportPayload;
  forceRefresh?: boolean;
}

export interface AccountAuthValidateResponse {
  provider: AIProviderType;
  valid: boolean;
  account?: ProviderAccountRecord;
  checkedAt: number;
  message?: string;
  vault: VaultState;
}

export interface AccountListRequest {
  provider: AIProviderType;
}

export interface AccountListResponse {
  provider: AIProviderType;
  accounts: ProviderAccountRecord[];
  activeAccountId?: string;
}

export interface AccountGetRequest {
  provider: AIProviderType;
  accountId: string;
}

export interface AccountGetResponse {
  provider: AIProviderType;
  account: ProviderAccountRecord | null;
  activeAccountId?: string;
}

export interface AccountActivateRequest {
  provider: AIProviderType;
  accountId: string;
}

export interface AccountActivateResponse {
  provider: AIProviderType;
  accountId: string;
  activeAccountId?: string;
}

export interface AccountRevokeRequest {
  provider: AIProviderType;
  accountId: string;
  revokeCredential?: boolean;
}

export interface AccountRevokeResponse {
  provider: AIProviderType;
  accountId: string;
  revoked: boolean;
}

export interface AccountRemoveRequest {
  provider: AIProviderType;
  accountId: string;
}

export interface AccountRemoveResponse {
  provider: AIProviderType;
  accountId: string;
  removed: boolean;
}

export interface AccountQuotaStatusGetRequest {
  provider: AIProviderType;
  accountId?: string;
}

export interface AccountQuotaStatusGetResponse {
  provider: AIProviderType;
  accountId?: string;
  quota?: ProviderQuotaState;
}

export interface AccountQuotaRefreshRequest {
  provider: AIProviderType;
  accountId?: string;
}

export interface AccountQuotaRefreshResponse {
  provider: AIProviderType;
  accountId?: string;
  quota?: ProviderQuotaState;
  refreshedAt: number;
}

export interface ContextGetRequest {
  tabId?: number;
  options?: ContextBuilderOptions;
}

export interface ContextGetResponse {
  context: PageContext;
}

/**
 * Type-safe message sender interface
 */
export interface MessageSender {
  <T extends ExtensionMessageType>(
    type: T,
    payload: RequestPayloadMap[T],
  ): Promise<ResponsePayloadMap[T]>;
}

/**
 * Type maps for request payloads
 */
export interface RequestPayloadMap {
  SESSION_CREATE: SessionCreateRequest;
  SESSION_START: SessionStartRequest;
  SESSION_PAUSE: { sessionId: string };
  SESSION_RESUME: { sessionId: string };
  SESSION_ABORT: { sessionId: string };
  SESSION_SEND_MESSAGE: SessionSendMessageRequest;
  SESSION_GET_STATE: { sessionId: string };
  SESSION_LIST: void;
  SESSION_RECORDING_START: { sessionId: string };
  SESSION_RECORDING_PAUSE: { sessionId: string };
  SESSION_RECORDING_RESUME: { sessionId: string };
  SESSION_RECORDING_STOP: { sessionId: string };
  SESSION_RECORDING_EXPORT: SessionRecordingExportRequest;
  SESSION_PLAYBACK_START: SessionPlaybackStartRequest;
  SESSION_PLAYBACK_PAUSE: SessionPlaybackControlRequest;
  SESSION_PLAYBACK_RESUME: SessionPlaybackResumeRequest;
  SESSION_PLAYBACK_STOP: SessionPlaybackControlRequest;
  SESSION_PLAYBACK_SET_SPEED: SessionPlaybackSetSpeedRequest;
  WORKFLOW_LIST: void;
  WORKFLOW_CREATE: WorkflowCreateRequest;
  WORKFLOW_UPDATE: WorkflowUpdateRequest;
  WORKFLOW_DELETE: WorkflowDeleteRequest;
  WORKFLOW_RUN: WorkflowRunRequest;
  ACTION_EXECUTE: ActionExecuteRequest;
  ACTION_EXECUTE_BATCH: { sessionId?: string; actions: Action[] };
  ACTION_ABORT: { sessionId?: string };
  ACTION_UNDO: { sessionId: string; steps?: number };
  TAB_ATTACH: { tabId: number };
  TAB_DETACH: { tabId: number };
  TAB_GET_STATE: { tabId?: number };
  TAB_CAPTURE: { tabId?: number };
  SETTINGS_GET: void;
  SETTINGS_UPDATE: SettingsUpdateRequest;
  PROVIDER_SET: ProviderSetRequest;
  API_KEY_SET: ApiKeySetRequest;
  API_KEY_DELETE: ApiKeyDeleteRequest;
  API_KEY_VALIDATE: ApiKeyValidateRequest;
  ACCOUNT_AUTH_STATUS_GET: AccountAuthStatusGetRequest;
  ACCOUNT_AUTH_CONNECT_START: AccountAuthConnectStartRequest;
  ACCOUNT_AUTH_VALIDATE: AccountAuthValidateRequest;
  ACCOUNT_LIST: AccountListRequest;
  ACCOUNT_GET: AccountGetRequest;
  ACCOUNT_ACTIVATE: AccountActivateRequest;
  ACCOUNT_REVOKE: AccountRevokeRequest;
  ACCOUNT_REMOVE: AccountRemoveRequest;
  ACCOUNT_QUOTA_STATUS_GET: AccountQuotaStatusGetRequest;
  ACCOUNT_QUOTA_REFRESH: AccountQuotaRefreshRequest;
  VAULT_INIT: VaultPassphraseRequest;
  VAULT_UNLOCK: VaultPassphraseRequest;
  VAULT_LOCK: void;
  VAULT_STATUS_GET: void;
  CONTEXT_GET: ContextGetRequest;
  CONTEXT_UPDATE: { tabId: number };
  EVENT_SESSION_UPDATE: SessionUpdateEventPayload;
  EVENT_ACTION_PROGRESS: ActionProgressEventPayload;
  EVENT_AI_STREAM: AIStreamEventPayload;
  EVENT_ERROR: { code: string; message: string };
}

/**
 * Type maps for response payloads
 */
export interface ResponsePayloadMap {
  SESSION_CREATE: SessionCreateResponse;
  SESSION_START: void;
  SESSION_PAUSE: void;
  SESSION_RESUME: void;
  SESSION_ABORT: void;
  SESSION_SEND_MESSAGE: void;
  SESSION_GET_STATE: { session: Session | null };
  SESSION_LIST: { sessions: Session[] };
  SESSION_RECORDING_START: void;
  SESSION_RECORDING_PAUSE: void;
  SESSION_RECORDING_RESUME: void;
  SESSION_RECORDING_STOP: void;
  SESSION_RECORDING_EXPORT: SessionRecordingExportResponse;
  SESSION_PLAYBACK_START: void;
  SESSION_PLAYBACK_PAUSE: void;
  SESSION_PLAYBACK_RESUME: void;
  SESSION_PLAYBACK_STOP: void;
  SESSION_PLAYBACK_SET_SPEED: void;
  WORKFLOW_LIST: WorkflowListResponse;
  WORKFLOW_CREATE: WorkflowCreateResponse;
  WORKFLOW_UPDATE: WorkflowUpdateResponse;
  WORKFLOW_DELETE: WorkflowDeleteResponse;
  WORKFLOW_RUN: WorkflowRunResponse;
  ACTION_EXECUTE: ActionExecuteResponse;
  ACTION_EXECUTE_BATCH: { results: ActionResult[] };
  ACTION_ABORT: void;
  ACTION_UNDO: void;
  TAB_ATTACH: void;
  TAB_DETACH: void;
  TAB_GET_STATE: { state: Record<string, unknown> | null };
  TAB_CAPTURE: { screenshot: string };
  SETTINGS_GET: SettingsGetResponse;
  SETTINGS_UPDATE: void;
  PROVIDER_SET: ProviderSetResponse;
  API_KEY_SET: ApiKeySetResponse;
  API_KEY_DELETE: VaultStatusResponse;
  API_KEY_VALIDATE: ApiKeyValidateResponse;
  ACCOUNT_AUTH_STATUS_GET: AccountAuthStatusGetResponse;
  ACCOUNT_AUTH_CONNECT_START: AccountAuthConnectStartResponse;
  ACCOUNT_AUTH_VALIDATE: AccountAuthValidateResponse;
  ACCOUNT_LIST: AccountListResponse;
  ACCOUNT_GET: AccountGetResponse;
  ACCOUNT_ACTIVATE: AccountActivateResponse;
  ACCOUNT_REVOKE: AccountRevokeResponse;
  ACCOUNT_REMOVE: AccountRemoveResponse;
  ACCOUNT_QUOTA_STATUS_GET: AccountQuotaStatusGetResponse;
  ACCOUNT_QUOTA_REFRESH: AccountQuotaRefreshResponse;
  VAULT_INIT: VaultStatusResponse;
  VAULT_UNLOCK: VaultStatusResponse;
  VAULT_LOCK: VaultStatusResponse;
  VAULT_STATUS_GET: VaultStatusResponse;
  CONTEXT_GET: ContextGetResponse;
  CONTEXT_UPDATE: void;
  EVENT_SESSION_UPDATE: void;
  EVENT_ACTION_PROGRESS: void;
  EVENT_AI_STREAM: void;
  EVENT_ERROR: void;
}
