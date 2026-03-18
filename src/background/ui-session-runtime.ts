import { SessionManager } from '@core/session';
import type { IServiceWorkerBridge } from '@core/bridge';
import { AIClientManager } from '@core/ai-client/manager';
import { createProvider } from '@core/ai-client/provider-loader';
import { getSystemPrompt } from '@core/ai-client/prompts/system';
import { sanitizeUserMessage } from '@core/ai-client/prompts/templates';
import type { IAIClientManager, IAIProvider } from '@core/ai-client/interfaces';
import { CommandParser } from '@core/command-parser';
import type { ParserConfig } from '@core/command-parser';
import { ActionOrchestrator } from '@core/orchestrator';
import { DebuggerAdapter, type PrintToPDFParams } from '@core/browser-controller/debugger-adapter';
import { TabManager } from '@core/browser-controller/tab-manager';
import {
  DEFAULT_PROVIDER_MODELS,
  PROVIDER_LOOKUP,
  createDefaultProviderConfigs,
  evaluateProviderEndpointPolicy,
  normalizeProviderEndpointConfig,
} from '@shared/config';
import { ErrorCode, ExtensionError } from '@shared/errors';
import { getSavedWorkflows, setSavedWorkflows } from '@shared/storage/workflows';
import { createDefaultOnboardingState, normalizeOnboardingState } from '@shared/storage/onboarding';
import type {
  Action,
  ActionLogEventEntry,
  ActionLogEventStatus,
  ActionProgressEventPayload,
  ActionResult,
  ActionResultPayload,
  AIMessage,
  AIStreamEventPayload,
  BridgeFrameContext,
  BridgeSendTarget,
  ClickAction,
  ElementSelector,
  ExecuteActionPayload,
  ExtensionMessage,
  ExtensionResponse,
  ExtensionSettings,
  FileUploadMetadata,
  OnboardingState,
  FrameContextSummary,
  GetPageContextPayload,
  NavigateAction,
  PageContext,
  PageContextPayload,
  ParsedResponse,
  RecordedClickPayload,
  RecordedInputPayload,
  RecordedNavigationPayload,
  RecordedSessionAction,
  RequestPayloadMap,
  ResponsePayloadMap,
  SavedWorkflow,
  SavedWorkflowSource,
  Session,
  SessionConfig,
  SessionCreateRequest,
  SessionPlaybackSpeed,
  SessionRecordingExportFormat,
  SessionTabSummary,
  SessionUpdateEventPayload,
  SetRecordingStatePayload,
  TabState,
  FillAction,
  ProviderAccountRecord,
  ProviderCredentialRecord,
  VaultState,
} from '@shared/types';
import { generateId, Logger } from '@shared/utils';
import type { ProviderConfig } from '@shared/types';
import {
  NetworkInterceptionManager,
  type INetworkInterceptionManager,
} from './network-interception-manager';
import { DeviceEmulationManager, type IDeviceEmulationManager } from './device-emulation-manager';
import { GeolocationMockManager, type IGeolocationMockManager } from './geolocation-mock-manager';
import { FileUploadManager, type IFileUploadManager } from './file-upload-manager';
import { buildSessionRecordingExportArtifact } from './session-recording-export';
import { CredentialVault } from './credential-vault';
import { importCodexAccountArtifact } from '@core/auth/codex-account-import';
import { CodexAccountSessionManager } from './codex-account-session-manager';

const STREAM_CHUNK_INTERVAL_MS = 20;
const PLAYBACK_SPEEDS: readonly SessionPlaybackSpeed[] = [0.5, 1, 2];
const EVALUATE_RESULT_MAX_CHARS = 16_000;

const DEFAULT_RUNTIME_SETTINGS: ExtensionSettings = {
  language: 'auto',
  theme: 'system',
  defaultProvider: 'openai',
  streamResponses: true,
  includeScreenshotsInContext: false,
  maxContextLength: 128_000,
  defaultTimeout: 30_000,
  autoRetryOnFailure: true,
  maxRetries: 1,
  screenshotOnError: true,
  allowCustomScripts: false,
  allowedDomains: [],
  blockedDomains: [],
  showFloatingBar: true,
  highlightElements: true,
  soundNotifications: false,
  debugMode: false,
  logNetworkRequests: false,
};

const DEFAULT_PROVIDER_CONFIG: Record<SessionConfig['provider'], ProviderConfig> =
  createDefaultProviderConfigs();

function isEvaluateEnabled(settings: ExtensionSettings): boolean {
  return settings.debugMode && settings.allowCustomScripts;
}

function getActionRiskMetadata(action: Action): {
  riskLevel: 'standard' | 'high';
  riskReason?: string;
} {
  if (action.type === 'evaluate') {
    return {
      riskLevel: 'high',
      riskReason: 'Runs arbitrary page script through the debugger runtime.',
    };
  }

  return { riskLevel: 'standard' };
}

type RuntimeHandlerResponse<T extends keyof ResponsePayloadMap> = Promise<
  ExtensionResponse<ResponsePayloadMap[T]>
>;

type AbortableAIClientManager = IAIClientManager & { abort?: () => void };

interface UISessionRuntimeOptions {
  bridge: IServiceWorkerBridge;
  logger: Logger;
  aiClientManager?: AbortableAIClientManager;
  parserFactory?: (config: Partial<ParserConfig>) => CommandParser;
  tabManager?: TabManager;
  networkInterceptionManager?: INetworkInterceptionManager;
  deviceEmulationManager?: IDeviceEmulationManager;
  geolocationMockManager?: IGeolocationMockManager;
  fileUploadManager?: IFileUploadManager;
}

interface RuntimeState {
  settings: ExtensionSettings;
  providers: Partial<Record<SessionConfig['provider'], Partial<ProviderConfig>>>;
  activeProvider: SessionConfig['provider'];
  onboarding: OnboardingState;
  vault: VaultState;
}

interface RegisteredFrame extends BridgeFrameContext {
  title?: string;
  summary?: string;
  interactiveElementCount?: number;
  lastSeenAt: number;
}

type FrameRegistry = Map<number, Map<string, RegisteredFrame>>;

interface PlaybackRunState {
  controller: AbortController;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

export class UISessionRuntime {
  private readonly sessionManager = new SessionManager();
  private readonly logger: Logger;
  private readonly bridge: IServiceWorkerBridge;
  private readonly aiClientManager: AbortableAIClientManager;
  private readonly parserFactory?: (config: Partial<ParserConfig>) => CommandParser;
  private readonly tabManager: TabManager;
  private readonly debuggerAdapter: DebuggerAdapter;
  private readonly credentialVault = new CredentialVault();
  private readonly codexAccountSessionManager: CodexAccountSessionManager;
  private readonly orchestrator: ActionOrchestrator;
  private readonly networkInterceptionManager: INetworkInterceptionManager;
  private readonly deviceEmulationManager: IDeviceEmulationManager;
  private readonly geolocationMockManager: IGeolocationMockManager;
  private readonly fileUploadManager: IFileUploadManager;
  private readonly usesDefaultAIClientManager: boolean;
  private readonly defaultProviderRegistrations = new Map<
    SessionConfig['provider'],
    Promise<void>
  >();
  private readonly registeredDefaultProviders = new Set<SessionConfig['provider']>();
  private readonly frameRegistry: FrameRegistry = new Map();
  private readonly bridgeFrameUnsubscribers: Array<() => void> = [];
  private readonly streamControllers = new Map<string, AbortController>();
  private readonly latestActionEntries = new Map<string, ActionLogEventEntry>();
  private readonly plannedTabSnapshots = new Map<string, SessionTabSummary[]>();
  private readonly recordingNavigationUrls = new Map<string, string | null>();
  private readonly playbackRuns = new Map<string, PlaybackRunState>();
  private activeSessionId: string | null = null;
  private activeRecordingSessionId: string | null = null;

  constructor(options: UISessionRuntimeOptions) {
    this.bridge = options.bridge;
    this.logger = options.logger.child('UISessionRuntime');
    this.usesDefaultAIClientManager = !options.aiClientManager;
    this.aiClientManager = options.aiClientManager ?? this.createDefaultAIClientManager();
    this.parserFactory = options.parserFactory;
    this.tabManager = options.tabManager ?? new TabManager();
    this.debuggerAdapter = new DebuggerAdapter(this.tabManager);
    this.networkInterceptionManager =
      options.networkInterceptionManager ??
      new NetworkInterceptionManager({
        logger: this.logger.child('NetworkInterceptionManager'),
      });
    this.deviceEmulationManager =
      options.deviceEmulationManager ??
      new DeviceEmulationManager({
        logger: this.logger.child('DeviceEmulationManager'),
      });
    this.geolocationMockManager =
      options.geolocationMockManager ??
      new GeolocationMockManager({
        logger: this.logger.child('GeolocationMockManager'),
      });
    this.fileUploadManager =
      options.fileUploadManager ??
      new FileUploadManager({
        logger: this.logger.child('FileUploadManager'),
      });
    this.codexAccountSessionManager = new CodexAccountSessionManager(
      this.credentialVault,
      this.logger,
    );
    this.orchestrator = new ActionOrchestrator({
      execute: (action, context) => this.executeAutomationAction(action, context.sessionId),
    });
    this.registerBridgeFrameEvents();
  }

  private registerBridgeFrameEvents(): void {
    this.bridgeFrameUnsubscribers.push(
      this.bridge.onEvent('PAGE_LOADED', (tabId, frame, payload) => {
        const metadata = this.extractFrameMetadata(payload);
        this.upsertFrame(tabId, {
          ...frame,
          url: metadata.url ?? frame.url,
          origin: metadata.origin ?? frame.origin,
          name: metadata.name ?? frame.name,
          isTop: metadata.isTop ?? frame.isTop,
          title: metadata.title,
          lastSeenAt: Date.now(),
        });
        this.handleRecordedPageLoad(tabId, {
          ...frame,
          url: metadata.url ?? frame.url,
          origin: metadata.origin ?? frame.origin,
          name: metadata.name ?? frame.name,
          isTop: metadata.isTop ?? frame.isTop,
        });
        void this.syncRecordingStateToFrame(tabId, frame);
      }),
    );

    this.bridgeFrameUnsubscribers.push(
      this.bridge.onEvent('PAGE_UNLOAD', (tabId, frame) => {
        this.removeFrame(tabId, frame);
      }),
    );

    this.bridgeFrameUnsubscribers.push(
      this.bridge.onEvent('RECORDED_CLICK', (tabId, frame, payload) => {
        this.handleRecordedClickEvent(tabId, frame, payload);
      }),
    );

    this.bridgeFrameUnsubscribers.push(
      this.bridge.onEvent('RECORDED_INPUT', (tabId, frame, payload) => {
        this.handleRecordedInputEvent(tabId, frame, payload);
      }),
    );

    this.bridgeFrameUnsubscribers.push(
      this.bridge.onEvent('RECORDED_NAVIGATION', (tabId, frame, payload) => {
        this.handleRecordedNavigationEvent(tabId, frame, payload);
      }),
    );
  }

  private extractFrameMetadata(payload: unknown): Partial<RegisteredFrame> {
    if (typeof payload !== 'object' || payload === null) {
      return {};
    }

    const value = payload as Record<string, unknown>;
    return {
      url: typeof value.url === 'string' ? value.url : undefined,
      origin: typeof value.origin === 'string' ? value.origin : undefined,
      name: typeof value.name === 'string' ? value.name : undefined,
      title: typeof value.title === 'string' ? value.title : undefined,
      isTop: typeof value.isTop === 'boolean' ? value.isTop : undefined,
    };
  }

  private upsertFrame(tabId: number, frame: RegisteredFrame): void {
    const bucket = this.getFrameBucket(tabId, true);
    if (!bucket) {
      return;
    }
    bucket.set(this.getFrameRegistryKey(frame), frame);
  }

  private removeFrame(tabId: number, frame: BridgeFrameContext): void {
    const bucket = this.getFrameBucket(tabId, false);
    if (!bucket) {
      return;
    }

    bucket.delete(this.getFrameRegistryKey(frame));

    if (frame.documentId) {
      for (const [key, candidate] of bucket) {
        if (candidate.documentId === frame.documentId) {
          bucket.delete(key);
        }
      }
    }

    if (bucket.size === 0) {
      this.frameRegistry.delete(tabId);
    }
  }

  private getFrameBucket(tabId: number, create: boolean): Map<string, RegisteredFrame> | undefined {
    let bucket = this.frameRegistry.get(tabId);
    if (!bucket && create) {
      bucket = new Map();
      this.frameRegistry.set(tabId, bucket);
    }

    return bucket;
  }

  private getFrameRegistryKey(frame: Pick<BridgeFrameContext, 'frameId' | 'documentId'>): string {
    return frame.documentId ? `doc:${frame.documentId}` : `frame:${frame.frameId}`;
  }

  async handleMessage(
    message: ExtensionMessage,
  ): Promise<ExtensionResponse<ResponsePayloadMap[keyof ResponsePayloadMap]>> {
    switch (message.type) {
      case 'SESSION_LIST':
        return this.handleSessionList();
      case 'SESSION_CREATE':
        return this.handleSessionCreate(message.payload as RequestPayloadMap['SESSION_CREATE']);
      case 'SESSION_GET_STATE':
        return this.handleSessionGetState(
          message.payload as RequestPayloadMap['SESSION_GET_STATE'],
        );
      case 'SESSION_RECORDING_START':
        return this.handleSessionRecordingStart(
          message.payload as RequestPayloadMap['SESSION_RECORDING_START'],
        );
      case 'SESSION_RECORDING_PAUSE':
        return this.handleSessionRecordingPause(
          message.payload as RequestPayloadMap['SESSION_RECORDING_PAUSE'],
        );
      case 'SESSION_RECORDING_RESUME':
        return this.handleSessionRecordingResume(
          message.payload as RequestPayloadMap['SESSION_RECORDING_RESUME'],
        );
      case 'SESSION_RECORDING_STOP':
        return this.handleSessionRecordingStop(
          message.payload as RequestPayloadMap['SESSION_RECORDING_STOP'],
        );
      case 'SESSION_RECORDING_EXPORT':
        return this.handleSessionRecordingExport(
          message.payload as RequestPayloadMap['SESSION_RECORDING_EXPORT'],
        );
      case 'SESSION_PLAYBACK_START':
        return this.handleSessionPlaybackStart(
          message.payload as RequestPayloadMap['SESSION_PLAYBACK_START'],
        );
      case 'SESSION_PLAYBACK_PAUSE':
        return this.handleSessionPlaybackPause(
          message.payload as RequestPayloadMap['SESSION_PLAYBACK_PAUSE'],
        );
      case 'SESSION_PLAYBACK_RESUME':
        return this.handleSessionPlaybackResume(
          message.payload as RequestPayloadMap['SESSION_PLAYBACK_RESUME'],
        );
      case 'SESSION_PLAYBACK_STOP':
        return this.handleSessionPlaybackStop(
          message.payload as RequestPayloadMap['SESSION_PLAYBACK_STOP'],
        );
      case 'SESSION_PLAYBACK_SET_SPEED':
        return this.handleSessionPlaybackSetSpeed(
          message.payload as RequestPayloadMap['SESSION_PLAYBACK_SET_SPEED'],
        );
      case 'WORKFLOW_LIST':
        return this.handleWorkflowList();
      case 'WORKFLOW_CREATE':
        return this.handleWorkflowCreate(message.payload as RequestPayloadMap['WORKFLOW_CREATE']);
      case 'WORKFLOW_UPDATE':
        return this.handleWorkflowUpdate(message.payload as RequestPayloadMap['WORKFLOW_UPDATE']);
      case 'WORKFLOW_DELETE':
        return this.handleWorkflowDelete(message.payload as RequestPayloadMap['WORKFLOW_DELETE']);
      case 'WORKFLOW_RUN':
        return this.handleWorkflowRun(message.payload as RequestPayloadMap['WORKFLOW_RUN']);
      case 'SESSION_START':
        return this.handleSessionStart(message.payload as RequestPayloadMap['SESSION_START']);
      case 'SESSION_PAUSE':
        return this.handleSessionPause(message.payload as RequestPayloadMap['SESSION_PAUSE']);
      case 'SESSION_RESUME':
        return this.handleSessionResume(message.payload as RequestPayloadMap['SESSION_RESUME']);
      case 'SESSION_ABORT':
        return this.handleSessionAbort(message.payload as RequestPayloadMap['SESSION_ABORT']);
      case 'SESSION_SEND_MESSAGE':
        return this.handleSessionSendMessage(
          message.payload as RequestPayloadMap['SESSION_SEND_MESSAGE'],
        );
      case 'SETTINGS_GET':
        return this.handleSettingsGet();
      case 'SETTINGS_UPDATE':
        return this.handleSettingsUpdate(message.payload as RequestPayloadMap['SETTINGS_UPDATE']);
      case 'PROVIDER_SET':
        return this.handleProviderSet(message.payload as RequestPayloadMap['PROVIDER_SET']);
      case 'API_KEY_SET':
        return this.handleApiKeySet(message.payload as RequestPayloadMap['API_KEY_SET']);
      case 'API_KEY_DELETE':
        return this.handleApiKeyDelete(message.payload as RequestPayloadMap['API_KEY_DELETE']);
      case 'API_KEY_VALIDATE':
        return this.handleApiKeyValidate(message.payload as RequestPayloadMap['API_KEY_VALIDATE']);
      case 'ACCOUNT_AUTH_STATUS_GET':
        return this.handleAccountAuthStatusGet(
          message.payload as RequestPayloadMap['ACCOUNT_AUTH_STATUS_GET'],
        );
      case 'ACCOUNT_AUTH_CONNECT_START':
        return this.handleAccountAuthConnectStart(
          message.payload as RequestPayloadMap['ACCOUNT_AUTH_CONNECT_START'],
        );
      case 'ACCOUNT_AUTH_VALIDATE':
        return this.handleAccountAuthValidate(
          message.payload as RequestPayloadMap['ACCOUNT_AUTH_VALIDATE'],
        );
      case 'ACCOUNT_LIST':
        return this.handleAccountList(message.payload as RequestPayloadMap['ACCOUNT_LIST']);
      case 'ACCOUNT_GET':
        return this.handleAccountGet(message.payload as RequestPayloadMap['ACCOUNT_GET']);
      case 'ACCOUNT_ACTIVATE':
        return this.handleAccountActivate(message.payload as RequestPayloadMap['ACCOUNT_ACTIVATE']);
      case 'ACCOUNT_REVOKE':
        return this.handleAccountRevoke(message.payload as RequestPayloadMap['ACCOUNT_REVOKE']);
      case 'ACCOUNT_REMOVE':
        return this.handleAccountRemove(message.payload as RequestPayloadMap['ACCOUNT_REMOVE']);
      case 'ACCOUNT_QUOTA_STATUS_GET':
        return this.handleAccountQuotaStatusGet(
          message.payload as RequestPayloadMap['ACCOUNT_QUOTA_STATUS_GET'],
        );
      case 'ACCOUNT_QUOTA_REFRESH':
        return this.handleAccountQuotaRefresh(
          message.payload as RequestPayloadMap['ACCOUNT_QUOTA_REFRESH'],
        );
      case 'VAULT_INIT':
        return this.handleVaultInit(message.payload as RequestPayloadMap['VAULT_INIT']);
      case 'VAULT_UNLOCK':
        return this.handleVaultUnlock(message.payload as RequestPayloadMap['VAULT_UNLOCK']);
      case 'VAULT_LOCK':
        return this.handleVaultLock();
      case 'VAULT_STATUS_GET':
        return this.handleVaultStatusGet();
      case 'CONTEXT_GET':
        return this.handleContextGet(message.payload as RequestPayloadMap['CONTEXT_GET']);
      case 'ACTION_EXECUTE':
        return this.handleActionExecute(message.payload as RequestPayloadMap['ACTION_EXECUTE']);
      case 'ACTION_EXECUTE_BATCH':
        return this.handleActionExecuteBatch(
          message.payload as RequestPayloadMap['ACTION_EXECUTE_BATCH'],
        );
      case 'ACTION_ABORT':
        return this.handleActionAbort(message.payload as RequestPayloadMap['ACTION_ABORT']);
      default:
        return {
          success: false,
          error: {
            code: 'NOT_IMPLEMENTED',
            message: `Handler for "${message.type}" is not yet implemented`,
          },
        };
    }
  }

  private async handleSessionList(): RuntimeHandlerResponse<'SESSION_LIST'> {
    const sessions = this.sessionManager
      .getActiveSessions()
      .map((session) => this.cloneSession(session))
      .sort((left, right) => right.lastActivityAt - left.lastActivityAt);

    if (!this.activeSessionId && sessions.length > 0) {
      this.activeSessionId = sessions[0].config.id;
    }

    return {
      success: true,
      data: { sessions },
    };
  }

  private async handleSessionCreate(
    payload: SessionCreateRequest,
  ): RuntimeHandlerResponse<'SESSION_CREATE'> {
    const tabId = payload.tabId ?? (await this.getActiveTabId());
    const config = await this.buildSessionConfig(payload.config);
    const session = await this.sessionManager.createSession(config, tabId);
    await this.syncSessionTabState(session.config.id);

    this.activeSessionId = session.config.id;
    await this.broadcastSessionUpdate({
      sessionId: session.config.id,
      session: this.cloneSession(session),
      reason: 'created',
    });

    return {
      success: true,
      data: { session: this.cloneSession(session) },
    };
  }

  private async handleSessionGetState(
    payload: RequestPayloadMap['SESSION_GET_STATE'],
  ): RuntimeHandlerResponse<'SESSION_GET_STATE'> {
    await this.syncSessionTabState(payload.sessionId);
    const session = this.sessionManager.getSession(payload.sessionId);
    return {
      success: true,
      data: { session: session ? this.cloneSession(session) : null },
    };
  }

  private async handleSessionRecordingStart(
    payload: RequestPayloadMap['SESSION_RECORDING_START'],
  ): RuntimeHandlerResponse<'SESSION_RECORDING_START'> {
    const session = this.sessionManager.getSession(payload.sessionId);
    if (!session) {
      throw new ExtensionError(
        ErrorCode.SESSION_NOT_FOUND,
        `Session "${payload.sessionId}" was not found`,
        true,
      );
    }

    if (!session.targetTabId) {
      throw new ExtensionError(
        ErrorCode.TAB_NOT_FOUND,
        'No target tab is available for recording',
        true,
      );
    }

    if (session.playback.status !== 'idle') {
      throw new ExtensionError(
        ErrorCode.ACTION_INVALID,
        'Stop playback before starting recording',
        true,
      );
    }

    if (this.activeRecordingSessionId && this.activeRecordingSessionId !== payload.sessionId) {
      await this.disableSessionRecording(this.activeRecordingSessionId);
    }

    this.sessionManager.startRecording(payload.sessionId);
    this.activeRecordingSessionId = payload.sessionId;
    await this.seedRecordingNavigationUrl(session);

    try {
      await this.enableSessionRecording(session);
    } catch (error) {
      this.sessionManager.stopRecording(payload.sessionId);
      if (this.activeRecordingSessionId === payload.sessionId) {
        this.activeRecordingSessionId = null;
      }
      throw error;
    }

    await this.broadcastCurrentSession(payload.sessionId, 'updated');
    return { success: true };
  }

  private async handleSessionRecordingStop(
    payload: RequestPayloadMap['SESSION_RECORDING_STOP'],
  ): RuntimeHandlerResponse<'SESSION_RECORDING_STOP'> {
    await this.disableSessionRecording(payload.sessionId);
    await this.broadcastCurrentSession(payload.sessionId, 'updated');
    return { success: true };
  }

  private async handleSessionRecordingExport(
    payload: RequestPayloadMap['SESSION_RECORDING_EXPORT'],
  ): RuntimeHandlerResponse<'SESSION_RECORDING_EXPORT'> {
    const session = this.requireSession(payload.sessionId);
    const format = this.normalizeRecordingExportFormat(payload.format);

    if (session.recording.actions.length === 0) {
      throw new ExtensionError(
        ErrorCode.ACTION_INVALID,
        'Recording export requires at least one recorded action',
        true,
      );
    }

    const artifact = buildSessionRecordingExportArtifact(session, format);
    const downloadId = await chrome.downloads.download({
      url: `data:${artifact.mimeType};charset=utf-8,${encodeURIComponent(artifact.content)}`,
      filename: artifact.filename,
      saveAs: false,
    });

    return {
      success: true,
      data: {
        downloadId,
        filename: artifact.filename,
        format: artifact.format,
      },
    };
  }

  private async handleSessionRecordingPause(
    payload: RequestPayloadMap['SESSION_RECORDING_PAUSE'],
  ): RuntimeHandlerResponse<'SESSION_RECORDING_PAUSE'> {
    await this.pauseSessionRecording(payload.sessionId);
    await this.broadcastCurrentSession(payload.sessionId, 'updated');
    return { success: true };
  }

  private async handleSessionRecordingResume(
    payload: RequestPayloadMap['SESSION_RECORDING_RESUME'],
  ): RuntimeHandlerResponse<'SESSION_RECORDING_RESUME'> {
    await this.resumeSessionRecording(payload.sessionId);
    await this.broadcastCurrentSession(payload.sessionId, 'updated');
    return { success: true };
  }

  private async handleSessionPlaybackStart(
    payload: RequestPayloadMap['SESSION_PLAYBACK_START'],
  ): RuntimeHandlerResponse<'SESSION_PLAYBACK_START'> {
    await this.syncSessionTabState(payload.sessionId);
    const session = this.requireSession(payload.sessionId);
    this.assertPlaybackCanStart(session);

    const speed =
      payload.speed !== undefined
        ? this.normalizePlaybackSpeed(payload.speed)
        : session.playback.speed;
    this.stopPlaybackExecution(payload.sessionId);
    this.sessionManager.startPlayback(payload.sessionId, speed);
    await this.broadcastCurrentSession(payload.sessionId, 'updated');

    void this.startPlaybackLoop(payload.sessionId);
    return { success: true };
  }

  private async handleSessionPlaybackPause(
    payload: RequestPayloadMap['SESSION_PLAYBACK_PAUSE'],
  ): RuntimeHandlerResponse<'SESSION_PLAYBACK_PAUSE'> {
    const session = this.requireSession(payload.sessionId);
    if (session.playback.status !== 'playing') {
      throw new ExtensionError(ErrorCode.ACTION_INVALID, 'Playback is not currently playing', true);
    }

    this.sessionManager.pausePlayback(payload.sessionId);
    this.stopPlaybackExecution(payload.sessionId);
    await this.broadcastCurrentSession(payload.sessionId, 'updated');
    return { success: true };
  }

  private async handleSessionPlaybackResume(
    payload: RequestPayloadMap['SESSION_PLAYBACK_RESUME'],
  ): RuntimeHandlerResponse<'SESSION_PLAYBACK_RESUME'> {
    await this.syncSessionTabState(payload.sessionId);
    const session = this.requireSession(payload.sessionId);
    this.assertPlaybackCanResume(session);

    const speed =
      payload.speed !== undefined
        ? this.normalizePlaybackSpeed(payload.speed)
        : session.playback.speed;

    this.stopPlaybackExecution(payload.sessionId);
    this.sessionManager.resumePlayback(payload.sessionId, speed);
    await this.broadcastCurrentSession(payload.sessionId, 'updated');

    void this.startPlaybackLoop(payload.sessionId);
    return { success: true };
  }

  private async handleSessionPlaybackStop(
    payload: RequestPayloadMap['SESSION_PLAYBACK_STOP'],
  ): RuntimeHandlerResponse<'SESSION_PLAYBACK_STOP'> {
    this.requireSession(payload.sessionId);
    this.stopPlaybackExecution(payload.sessionId);
    this.sessionManager.stopPlayback(payload.sessionId);
    await this.broadcastCurrentSession(payload.sessionId, 'updated');
    return { success: true };
  }

  private async handleSessionPlaybackSetSpeed(
    payload: RequestPayloadMap['SESSION_PLAYBACK_SET_SPEED'],
  ): RuntimeHandlerResponse<'SESSION_PLAYBACK_SET_SPEED'> {
    this.requireSession(payload.sessionId);
    this.sessionManager.setPlaybackSpeed(
      payload.sessionId,
      this.normalizePlaybackSpeed(payload.speed),
    );
    await this.broadcastCurrentSession(payload.sessionId, 'updated');
    return { success: true };
  }

  private async handleWorkflowList(): RuntimeHandlerResponse<'WORKFLOW_LIST'> {
    const workflows = (await getSavedWorkflows())
      .map((workflow) => this.cloneWorkflow(workflow))
      .sort((left, right) => right.updatedAt - left.updatedAt);

    return {
      success: true,
      data: { workflows },
    };
  }

  private async handleWorkflowCreate(
    payload: RequestPayloadMap['WORKFLOW_CREATE'],
  ): RuntimeHandlerResponse<'WORKFLOW_CREATE'> {
    const name = this.normalizeWorkflowName(payload.name);
    const actions = this.cloneRecordedActions(payload.actions);
    if (actions.length === 0) {
      throw new ExtensionError(
        ErrorCode.ACTION_INVALID,
        'Workflow requires at least one recorded action',
        true,
      );
    }

    const now = Date.now();
    const workflow: SavedWorkflow = {
      id: generateId(),
      name,
      description: this.normalizeWorkflowDescription(payload.description),
      tags: this.normalizeWorkflowTags(payload.tags),
      actions,
      createdAt: now,
      updatedAt: now,
      source: this.normalizeWorkflowSource(payload.source),
    };

    const workflows = await getSavedWorkflows();
    workflows.unshift(workflow);
    const stored = await setSavedWorkflows(workflows);
    const savedWorkflow =
      stored.items.find(function (item) {
        return item.id === workflow.id;
      }) ?? workflow;

    return {
      success: true,
      data: { workflow: this.cloneWorkflow(savedWorkflow) },
    };
  }

  private async handleWorkflowUpdate(
    payload: RequestPayloadMap['WORKFLOW_UPDATE'],
  ): RuntimeHandlerResponse<'WORKFLOW_UPDATE'> {
    const name = this.normalizeWorkflowName(payload.updates.name);
    const description = this.normalizeWorkflowDescription(payload.updates.description);
    const tags = this.normalizeWorkflowTags(payload.updates.tags);
    const workflows = await getSavedWorkflows();
    const workflow = workflows.find((item) => item.id === payload.workflowId);

    if (!workflow) {
      throw new ExtensionError(
        ErrorCode.ACTION_INVALID,
        `Workflow "${payload.workflowId}" was not found`,
        true,
      );
    }

    workflow.name = name;
    workflow.description = description;
    workflow.tags = tags;
    workflow.updatedAt = Date.now();

    await setSavedWorkflows(workflows);

    return {
      success: true,
      data: { workflow: this.cloneWorkflow(workflow) },
    };
  }

  private async handleWorkflowDelete(
    payload: RequestPayloadMap['WORKFLOW_DELETE'],
  ): RuntimeHandlerResponse<'WORKFLOW_DELETE'> {
    const workflows = await getSavedWorkflows();
    const nextWorkflows = workflows.filter((workflow) => workflow.id !== payload.workflowId);

    if (nextWorkflows.length === workflows.length) {
      throw new ExtensionError(
        ErrorCode.ACTION_INVALID,
        `Workflow "${payload.workflowId}" was not found`,
        true,
      );
    }

    await setSavedWorkflows(nextWorkflows);

    return {
      success: true,
      data: { workflowId: payload.workflowId },
    };
  }

  private async handleWorkflowRun(
    payload: RequestPayloadMap['WORKFLOW_RUN'],
  ): RuntimeHandlerResponse<'WORKFLOW_RUN'> {
    await this.syncSessionTabState(payload.sessionId);
    const session = this.requireSession(payload.sessionId);
    const workflow = await this.getSavedWorkflowById(payload.workflowId);

    if (session.recording.status !== 'idle') {
      throw new ExtensionError(
        ErrorCode.ACTION_INVALID,
        'Stop recording before running a saved workflow',
        true,
      );
    }

    if (session.status === 'running') {
      throw new ExtensionError(
        ErrorCode.ACTION_INVALID,
        'Wait for the current automation run to finish before running a saved workflow',
        true,
      );
    }

    if (!session.targetTabId) {
      throw new ExtensionError(
        ErrorCode.TAB_NOT_FOUND,
        'No target tab is available for workflow playback',
        true,
      );
    }

    this.abortStream(payload.sessionId);
    this.stopPlaybackExecution(payload.sessionId);
    this.sessionManager.stopPlayback(payload.sessionId);
    this.sessionManager.replaceRecordedActions(payload.sessionId, workflow.actions);
    await this.broadcastCurrentSession(payload.sessionId, 'updated');

    const speed =
      payload.speed !== undefined
        ? this.normalizePlaybackSpeed(payload.speed)
        : session.playback.speed;
    this.sessionManager.startPlayback(payload.sessionId, speed);
    await this.broadcastCurrentSession(payload.sessionId, 'updated');

    void this.startPlaybackLoop(payload.sessionId);

    return {
      success: true,
      data: {
        workflow: this.cloneWorkflow(workflow),
        session: this.cloneSession(this.requireSession(payload.sessionId)),
      },
    };
  }

  private async handleSessionStart(
    payload: RequestPayloadMap['SESSION_START'],
  ): RuntimeHandlerResponse<'SESSION_START'> {
    await this.sessionManager.start(payload.sessionId, payload.prompt);
    await this.broadcastCurrentSession(payload.sessionId, 'updated');
    return { success: true };
  }

  private async handleSessionPause(
    payload: RequestPayloadMap['SESSION_PAUSE'],
  ): RuntimeHandlerResponse<'SESSION_PAUSE'> {
    this.sessionManager.pause(payload.sessionId);
    await this.broadcastCurrentSession(payload.sessionId, 'updated');
    return { success: true };
  }

  private async handleSessionResume(
    payload: RequestPayloadMap['SESSION_RESUME'],
  ): RuntimeHandlerResponse<'SESSION_RESUME'> {
    this.sessionManager.resume(payload.sessionId);
    await this.broadcastCurrentSession(payload.sessionId, 'updated');
    return { success: true };
  }

  private async handleSessionAbort(
    payload: RequestPayloadMap['SESSION_ABORT'],
  ): RuntimeHandlerResponse<'SESSION_ABORT'> {
    this.abortStream(payload.sessionId);
    this.stopPlaybackExecution(payload.sessionId);
    this.clearLatestActionEntry(payload.sessionId);
    await this.clearHighlights(payload.sessionId);
    await this.networkInterceptionManager.clearSession(payload.sessionId);
    await this.deviceEmulationManager.clearSession(payload.sessionId);
    await this.geolocationMockManager.clearSession(payload.sessionId);
    this.fileUploadManager.clearSession(payload.sessionId);
    this.plannedTabSnapshots.delete(payload.sessionId);
    await this.disableSessionRecording(payload.sessionId);
    this.sessionManager.abort(payload.sessionId);

    if (this.activeSessionId === payload.sessionId) {
      this.activeSessionId = this.sessionManager.getActiveSessions()[0]?.config.id ?? null;
    }

    await this.broadcastSessionUpdate({
      sessionId: payload.sessionId,
      session: null,
      reason: 'deleted',
    });

    return { success: true };
  }

  private async handleActionAbort(
    payload: RequestPayloadMap['ACTION_ABORT'],
  ): RuntimeHandlerResponse<'ACTION_ABORT'> {
    const sessionId = payload.sessionId ?? this.activeSessionId;
    if (!sessionId) {
      return { success: true };
    }

    const playbackSession = this.sessionManager.getSession(sessionId);
    const hadPlayback = playbackSession?.playback.status !== 'idle';
    const hadStream = this.streamControllers.has(sessionId);

    if (!hadPlayback && !hadStream) {
      return { success: true };
    }

    this.abortStream(sessionId);
    if (hadPlayback) {
      this.stopPlaybackExecution(sessionId);
      this.sessionManager.stopPlayback(sessionId);
      await this.broadcastCurrentSession(sessionId, 'updated');
    }

    const latestAction = this.latestActionEntries.get(sessionId);
    if (latestAction) {
      await this.broadcastActionProgress({
        sessionId,
        entry: {
          ...latestAction,
          status: 'failed',
          progress: latestAction.progress,
          errorCode: 'ABORTED',
          detail: 'Execution stopped before completion.',
        },
      });
    }

    await this.clearHighlights(sessionId);
    return { success: true };
  }

  private async handleSettingsGet(): RuntimeHandlerResponse<'SETTINGS_GET'> {
    const runtimeState = await this.loadRuntimeState();

    return {
      success: true,
      data: {
        settings: runtimeState.settings,
        providers: runtimeState.providers,
        activeProvider: runtimeState.activeProvider,
        onboarding: runtimeState.onboarding,
        vault: runtimeState.vault,
      },
    };
  }

  private async handleSettingsUpdate(
    payload: RequestPayloadMap['SETTINGS_UPDATE'],
  ): RuntimeHandlerResponse<'SETTINGS_UPDATE'> {
    const runtimeState = await this.loadRuntimeState();
    const nextSettings: ExtensionSettings = {
      ...runtimeState.settings,
      ...payload.settings,
    };

    await chrome.storage.local.set({ settings: nextSettings });
    return { success: true };
  }

  private async handleProviderSet(
    payload: RequestPayloadMap['PROVIDER_SET'],
  ): RuntimeHandlerResponse<'PROVIDER_SET'> {
    const runtimeState = await this.loadRuntimeState();
    const nextProviderConfig = this.enforceProviderEndpointPolicy(payload.provider, payload.config);
    const currentConfig = this.resolveProviderConfig(payload.provider, runtimeState);
    const configChanged = !this.providerConfigsEqual(currentConfig, nextProviderConfig);
    const nextProviders = {
      ...runtimeState.providers,
      [payload.provider]: nextProviderConfig,
    };
    const providerDefinition = PROVIDER_LOOKUP[payload.provider];
    const nextSettings = payload.makeDefault
      ? { ...runtimeState.settings, defaultProvider: payload.provider }
      : runtimeState.settings;
    const shouldResetOnboarding =
      configChanged || runtimeState.onboarding.configuredProvider !== payload.provider;
    const nextOnboarding: OnboardingState = shouldResetOnboarding
      ? {
          ...runtimeState.onboarding,
          completed: false,
          completedAt: undefined,
          lastStep: Math.min(runtimeState.onboarding.lastStep, 1),
          configuredProvider: payload.provider,
          validatedProvider:
            configChanged && runtimeState.onboarding.validatedProvider === payload.provider
              ? undefined
              : runtimeState.onboarding.validatedProvider,
          providerReady: providerDefinition.requiresCredential
            ? !configChanged && runtimeState.onboarding.validatedProvider === payload.provider
            : true,
        }
      : runtimeState.onboarding;

    if (configChanged) {
      await this.credentialVault.markCredentialStale(payload.provider);
    }
    await chrome.storage.local.set({
      providers: nextProviders,
      activeProvider: payload.provider,
      settings: nextSettings,
      onboarding: nextOnboarding,
    });

    return {
        success: true,
        data: {
          activeProvider: payload.provider,
          providerConfig: nextProviderConfig,
        },
      };
  }

  private async handleVaultInit(
    payload: RequestPayloadMap['VAULT_INIT'],
  ): RuntimeHandlerResponse<'VAULT_INIT'> {
    const vault = await this.credentialVault.init(payload.passphrase);
    return { success: true, data: { vault } };
  }

  private async handleVaultUnlock(
    payload: RequestPayloadMap['VAULT_UNLOCK'],
  ): RuntimeHandlerResponse<'VAULT_UNLOCK'> {
    const vault = await this.credentialVault.unlock(payload.passphrase);
    return { success: true, data: { vault } };
  }

  private async handleVaultLock(): RuntimeHandlerResponse<'VAULT_LOCK'> {
    const vault = await this.credentialVault.lock();
    return { success: true, data: { vault } };
  }

  private async handleVaultStatusGet(): RuntimeHandlerResponse<'VAULT_STATUS_GET'> {
    const vault = await this.credentialVault.getState();
    return { success: true, data: { vault } };
  }

  private async handleApiKeySet(
    payload: RequestPayloadMap['API_KEY_SET'],
  ): RuntimeHandlerResponse<'API_KEY_SET'> {
    const authKind =
      payload.authKind ??
      (payload.provider === 'copilot'
        ? 'oauth-token'
        : payload.provider === 'codex'
          ? 'account-artifact'
          : 'api-key');
    let record = await this.credentialVault.setCredential(
      payload.provider,
      payload.apiKey,
      authKind,
      payload.maskedValue,
    );

    if (payload.validate) {
      const runtimeState = await this.loadRuntimeState();
      const providerConfig = this.enforceProviderEndpointPolicy(
        payload.provider,
        this.resolveProviderConfig(payload.provider, runtimeState),
      );
      const valid = await this.credentialVault.validateCredential(
        payload.provider,
        providerConfig,
        payload.apiKey,
      );

      if (!valid) {
        throw new ExtensionError(
          ErrorCode.AI_INVALID_KEY,
          `${payload.provider} credential could not be validated`,
          true,
        );
      }

      record = (await this.credentialVault.markValidated(payload.provider)) ?? record;
    }

    return {
      success: true,
      data: {
        record,
        vault: await this.credentialVault.getState(),
      },
    };
  }

  private async handleApiKeyDelete(
    payload: RequestPayloadMap['API_KEY_DELETE'],
  ): RuntimeHandlerResponse<'API_KEY_DELETE'> {
    const vault = await this.credentialVault.deleteCredential(payload.provider);
    return { success: true, data: { vault } };
  }

  private async handleApiKeyValidate(
    payload: RequestPayloadMap['API_KEY_VALIDATE'],
  ): RuntimeHandlerResponse<'API_KEY_VALIDATE'> {
    if (this.supportsAccountBackedAuth(payload.provider)) {
      const snapshot = await this.getAccountSurfaceSnapshot(payload.provider);
      if (snapshot.vault.lockState !== 'unlocked') {
        throw new ExtensionError(
          ErrorCode.AI_INVALID_KEY,
          'Unlock the vault before validating an imported account-backed provider.',
          true,
        );
      }

      const targetAccount =
        snapshot.accounts.find((account) => account.accountId === snapshot.activeAccountId) ??
        snapshot.accounts[0];

      if (!targetAccount) {
        return {
          success: true,
          data: {
            valid: false,
            record: snapshot.credential,
            vault: snapshot.vault,
          },
        };
      }

      const validation = await this.handleAccountAuthValidate({
        provider: payload.provider,
        accountId: targetAccount.accountId,
      });
      if (!validation.success || !validation.data) {
        return {
          success: false,
          error: validation.error ?? {
            code: 'ACCOUNT_AUTH_VALIDATE_FAILED',
            message: 'Account-backed validation failed unexpectedly.',
          },
        };
      }

      return {
        success: true,
        data: {
          valid: validation.data.valid,
          record: validation.data.vault.credentials[payload.provider],
          vault: validation.data.vault,
        },
      };
    }

    const runtimeState = await this.loadRuntimeState();
    const providerConfig = payload.config
      ? this.enforceProviderEndpointPolicy(payload.provider, {
          ...this.resolveProviderConfig(payload.provider, runtimeState),
          ...payload.config,
        })
      : this.resolveProviderConfig(payload.provider, runtimeState);
    const valid = await this.credentialVault.validateCredential(
      payload.provider,
      providerConfig,
      payload.apiKey,
    );
    let record: ProviderCredentialRecord | undefined =
      runtimeState.vault.credentials[payload.provider];

    if (valid && !payload.apiKey) {
      record = (await this.credentialVault.markValidated(payload.provider)) ?? record;
    }

    return {
      success: true,
      data: {
        valid,
        record,
        vault: await this.credentialVault.getState(),
      },
    };
  }

  private async handleAccountAuthStatusGet(
    payload: RequestPayloadMap['ACCOUNT_AUTH_STATUS_GET'],
  ): RuntimeHandlerResponse<'ACCOUNT_AUTH_STATUS_GET'> {
    if (!this.supportsAccountBackedAuth(payload.provider)) {
      return this.createUnsupportedAccountProviderResponse(
        'ACCOUNT_AUTH_STATUS_GET',
        payload.provider,
      );
    }

    const snapshot = await this.getAccountSurfaceSnapshot(payload.provider);
    const status =
      snapshot.vault.lockState !== 'unlocked'
        ? 'vault-locked'
        : snapshot.accounts.length > 0
          ? 'ready'
          : snapshot.credential
            ? 'ready'
            : 'needs-auth';

    return {
      success: true,
      data: {
        provider: payload.provider,
        authFamily: 'account-backed',
        status,
        availableTransports: ['artifact-import'],
        credential: snapshot.credential,
        accounts: snapshot.accounts,
        activeAccountId: snapshot.activeAccountId,
        vault: snapshot.vault,
      },
    };
  }

  private async handleAccountAuthConnectStart(
    payload: RequestPayloadMap['ACCOUNT_AUTH_CONNECT_START'],
  ): RuntimeHandlerResponse<'ACCOUNT_AUTH_CONNECT_START'> {
    if (!this.supportsAccountBackedAuth(payload.provider)) {
      return this.createUnsupportedAccountProviderResponse(
        'ACCOUNT_AUTH_CONNECT_START',
        payload.provider,
      );
    }

    this.assertAccountArtifactTransport(payload.transport);
    if (!payload.artifact) {
      throw new ExtensionError(
        ErrorCode.AI_INVALID_KEY,
        'Codex account import requires an auth artifact payload',
        true,
      );
    }

    const imported = await importCodexAccountArtifact(payload.artifact, { label: payload.label });
    const existingAccount = await this.credentialVault.getAccount(
      payload.provider,
      imported.derived.accountId,
    );
    const vault = await this.credentialVault.getState();
    const isActive = existingAccount?.isActive ?? !vault.activeAccounts[payload.provider];

    await this.credentialVault.saveAccount(payload.provider, {
      accountId: imported.derived.accountId,
      label: imported.derived.label,
      maskedIdentifier: imported.derived.maskedIdentifier,
      credentialMaskedValue: imported.derived.credentialMaskedValue,
      status: isActive ? 'active' : 'available',
      isActive,
      stale: false,
      metadata: imported.metadata,
      artifact: {
        authKind: imported.authKind,
        value: imported.storageValue,
        filename: payload.artifact.filename,
        format: imported.storageFormat,
      },
    });

    return {
      success: true,
      data: {
        provider: payload.provider,
        transport: payload.transport,
        accepted: true,
        nextStep: 'validate',
        message: `Imported ${imported.derived.label}. Run validation to confirm the persisted auth state.`,
      },
    };
  }

  private async handleAccountAuthValidate(
    payload: RequestPayloadMap['ACCOUNT_AUTH_VALIDATE'],
  ): RuntimeHandlerResponse<'ACCOUNT_AUTH_VALIDATE'> {
    if (!this.supportsAccountBackedAuth(payload.provider)) {
      return this.createUnsupportedAccountProviderResponse(
        'ACCOUNT_AUTH_VALIDATE',
        payload.provider,
      );
    }

    const checkedAt = Date.now();
    let imported = payload.artifact
      ? await importCodexAccountArtifact(payload.artifact)
      : undefined;
    if (payload.transport) {
      this.assertAccountArtifactTransport(payload.transport);
    }

    const targetAccountId = payload.accountId ?? imported?.derived.accountId;
    if (!targetAccountId) {
      throw new ExtensionError(
        ErrorCode.ACTION_INVALID,
        'Codex account validation requires an accountId or auth artifact',
        true,
      );
    }

    const existingAccount = await this.credentialVault.getAccount(
      payload.provider,
      targetAccountId,
    );
    if (!existingAccount && !imported) {
      throw new ExtensionError(
        ErrorCode.ACTION_INVALID,
        `Account "${targetAccountId}" was not found`,
        true,
      );
    }

    if (!imported) {
      const storedArtifact = await this.credentialVault.getAccountArtifact(
        payload.provider,
        targetAccountId,
      );
      if (!storedArtifact) {
        throw new ExtensionError(
          ErrorCode.AI_INVALID_KEY,
          `No stored auth artifact was found for account "${targetAccountId}"`,
          true,
        );
      }

      imported = await importCodexAccountArtifact({
        format: storedArtifact.format ?? 'unknown',
        value: storedArtifact.value,
        filename: storedArtifact.filename,
      });
    }

    if (payload.accountId && imported.derived.accountId !== payload.accountId) {
      throw new ExtensionError(
        ErrorCode.AI_INVALID_KEY,
        'The imported auth artifact does not match the requested accountId',
        true,
      );
    }

    await this.credentialVault.saveAccount(payload.provider, {
      accountId: imported.derived.accountId,
      label: existingAccount?.label ?? imported.derived.label,
      maskedIdentifier: imported.derived.maskedIdentifier,
      credentialMaskedValue: imported.derived.credentialMaskedValue,
      status: existingAccount?.isActive
        ? 'active'
        : existingAccount?.status === 'revoked'
          ? 'needs-auth'
          : 'available',
      isActive: existingAccount?.isActive ?? false,
      validatedAt: checkedAt,
      stale: false,
      metadata: {
        ...(existingAccount?.metadata ? { ...existingAccount.metadata } : {}),
        ...(imported.metadata ? { ...imported.metadata } : {}),
        lastErrorAt: undefined,
        lastErrorCode: undefined,
      },
      artifact: payload.artifact
        ? {
            authKind: imported.authKind,
            value: imported.storageValue,
            filename: payload.artifact.filename,
            format: imported.storageFormat,
          }
        : undefined,
    });
    await this.credentialVault.markValidated(payload.provider);

    const sessionSnapshot = await this.codexAccountSessionManager.ensureSession({
      accountId: imported.derived.accountId,
      purpose: 'validate',
      forceRefresh: payload.forceRefresh,
    });

    return {
      success: true,
      data: {
        provider: payload.provider,
        valid: true,
        account: this.cloneAccountRecord(sessionSnapshot.account),
        checkedAt,
        message: `Validated artifact shape for ${sessionSnapshot.account.label}. ${sessionSnapshot.message}`,
        vault: await this.credentialVault.getState(),
      },
    };
  }

  private async handleAccountList(
    payload: RequestPayloadMap['ACCOUNT_LIST'],
  ): RuntimeHandlerResponse<'ACCOUNT_LIST'> {
    if (!this.supportsAccountBackedAuth(payload.provider)) {
      return this.createUnsupportedAccountProviderResponse('ACCOUNT_LIST', payload.provider);
    }

    const snapshot = await this.getAccountSurfaceSnapshot(payload.provider);
    return {
      success: true,
      data: {
        provider: payload.provider,
        accounts: snapshot.accounts,
        activeAccountId: snapshot.activeAccountId,
      },
    };
  }

  private async handleAccountGet(
    payload: RequestPayloadMap['ACCOUNT_GET'],
  ): RuntimeHandlerResponse<'ACCOUNT_GET'> {
    if (!this.supportsAccountBackedAuth(payload.provider)) {
      return this.createUnsupportedAccountProviderResponse('ACCOUNT_GET', payload.provider);
    }

    const [vault, account] = await Promise.all([
      this.credentialVault.getState(),
      this.credentialVault.getAccount(payload.provider, payload.accountId),
    ]);
    return {
      success: true,
      data: {
        provider: payload.provider,
        account: account ? this.cloneAccountRecord(account) : null,
        activeAccountId: vault.activeAccounts[payload.provider],
      },
    };
  }

  private async handleAccountActivate(
    payload: RequestPayloadMap['ACCOUNT_ACTIVATE'],
  ): RuntimeHandlerResponse<'ACCOUNT_ACTIVATE'> {
    if (!this.supportsAccountBackedAuth(payload.provider)) {
      return this.createUnsupportedAccountProviderResponse('ACCOUNT_ACTIVATE', payload.provider);
    }
    const activated = await this.credentialVault.activateAccount(
      payload.provider,
      payload.accountId,
    );
    const vault = await this.credentialVault.getState();

    return {
      success: true,
      data: {
        provider: payload.provider,
        accountId: activated.accountId,
        activeAccountId: vault.activeAccounts[payload.provider],
      },
    };
  }

  private async handleAccountRevoke(
    payload: RequestPayloadMap['ACCOUNT_REVOKE'],
  ): RuntimeHandlerResponse<'ACCOUNT_REVOKE'> {
    if (!this.supportsAccountBackedAuth(payload.provider)) {
      return this.createUnsupportedAccountProviderResponse('ACCOUNT_REVOKE', payload.provider);
    }
    const revoked = await this.credentialVault.revokeAccount(payload.provider, payload.accountId, {
      revokeCredential: payload.revokeCredential,
    });

    return {
      success: true,
      data: {
        provider: payload.provider,
        accountId: payload.accountId,
        revoked: Boolean(revoked),
      },
    };
  }

  private async handleAccountRemove(
    payload: RequestPayloadMap['ACCOUNT_REMOVE'],
  ): RuntimeHandlerResponse<'ACCOUNT_REMOVE'> {
    if (!this.supportsAccountBackedAuth(payload.provider)) {
      return this.createUnsupportedAccountProviderResponse('ACCOUNT_REMOVE', payload.provider);
    }
    const removed = await this.credentialVault.removeAccount(payload.provider, payload.accountId);

    return {
      success: true,
      data: {
        provider: payload.provider,
        accountId: payload.accountId,
        removed,
      },
    };
  }

  private async handleAccountQuotaStatusGet(
    payload: RequestPayloadMap['ACCOUNT_QUOTA_STATUS_GET'],
  ): RuntimeHandlerResponse<'ACCOUNT_QUOTA_STATUS_GET'> {
    if (!this.supportsAccountBackedAuth(payload.provider)) {
      return this.createUnsupportedAccountProviderResponse(
        'ACCOUNT_QUOTA_STATUS_GET',
        payload.provider,
      );
    }

    const vault = await this.credentialVault.getState();
    const accountId = payload.accountId ?? vault.activeAccounts[payload.provider];
    const quota = accountId
      ? await this.credentialVault.getQuotaMetadata(payload.provider, accountId)
      : undefined;

    return {
      success: true,
      data: {
        provider: payload.provider,
        accountId,
        quota,
      },
    };
  }

  private async handleAccountQuotaRefresh(
    payload: RequestPayloadMap['ACCOUNT_QUOTA_REFRESH'],
  ): RuntimeHandlerResponse<'ACCOUNT_QUOTA_REFRESH'> {
    if (!this.supportsAccountBackedAuth(payload.provider)) {
      return this.createUnsupportedAccountProviderResponse(
        'ACCOUNT_QUOTA_REFRESH',
        payload.provider,
      );
    }
    const vault = await this.credentialVault.getState();
    const accountId = payload.accountId ?? vault.activeAccounts[payload.provider];
    if (accountId) {
      await this.codexAccountSessionManager.ensureSession({
        accountId,
        purpose: 'quota-refresh',
      });
    }
    const quota = accountId
      ? await this.credentialVault.getQuotaMetadata(payload.provider, accountId)
      : undefined;

    return {
      success: true,
      data: {
        provider: payload.provider,
        accountId,
        quota,
        refreshedAt: Date.now(),
      },
    };
  }

  private async handleContextGet(
    payload: RequestPayloadMap['CONTEXT_GET'],
  ): RuntimeHandlerResponse<'CONTEXT_GET'> {
    const tabId = payload.tabId ?? (await this.getActiveTabId());
    const target = this.resolveFrameTarget(tabId);
    await this.bridge.ensureContentScript(tabId, target);
    const response = await this.bridge.send<GetPageContextPayload, PageContextPayload>(
      tabId,
      'GET_PAGE_CONTEXT',
      { includeChildFrames: true },
      target,
    );
    const context = this.attachChildFrameSummaries(tabId, response.context);
    this.cacheFrameContext(tabId, context);

    return {
      success: true,
      data: { context },
    };
  }

  private async handleActionExecute(
    payload: RequestPayloadMap['ACTION_EXECUTE'],
  ): RuntimeHandlerResponse<'ACTION_EXECUTE'> {
    const result = await this.executeAutomationAction(payload.action, payload.sessionId);
    return { success: true, data: { result } };
  }

  private async handleActionExecuteBatch(
    payload: RequestPayloadMap['ACTION_EXECUTE_BATCH'],
  ): RuntimeHandlerResponse<'ACTION_EXECUTE_BATCH'> {
    const results: ActionResult[] = [];

    for (const action of payload.actions) {
      results.push(await this.executeAutomationAction(action, payload.sessionId));
    }

    return {
      success: true,
      data: { results },
    };
  }
  private async handleSessionSendMessage(
    payload: RequestPayloadMap['SESSION_SEND_MESSAGE'],
  ): RuntimeHandlerResponse<'SESSION_SEND_MESSAGE'> {
    this.abortStream(payload.sessionId);
    this.stopPlaybackExecution(payload.sessionId);
    const playbackSession = this.sessionManager.getSession(payload.sessionId);
    if (playbackSession && playbackSession.playback.status !== 'idle') {
      this.sessionManager.stopPlayback(payload.sessionId);
    }
    this.orchestrator.abort(payload.sessionId);
    this.activeSessionId = payload.sessionId;
    this.setSessionStatus(payload.sessionId, 'running');
    this.networkInterceptionManager.activateSession(
      payload.sessionId,
      this.sessionManager.getSession(payload.sessionId)?.targetTabId ?? null,
    );
    this.deviceEmulationManager.activateSession(
      payload.sessionId,
      this.sessionManager.getSession(payload.sessionId)?.targetTabId ?? null,
    );
    this.geolocationMockManager.activateSession(
      payload.sessionId,
      this.sessionManager.getSession(payload.sessionId)?.targetTabId ?? null,
    );
    const planningEntry = this.createPlanningEntry();
    const streamController = new AbortController();
    this.streamControllers.set(payload.sessionId, streamController);
    const streamMessageId = `assistant-${generateId(10)}`;
    let assistantStreamDone = false;

    try {
      if (payload.uploads && payload.uploads.length > 0) {
        this.fileUploadManager.stageUploads(payload.sessionId, payload.uploads);
      }

      await this.sessionManager.sendMessage(payload.sessionId, payload.message);
      await this.broadcastCurrentSession(payload.sessionId, 'updated');
      await this.broadcastActionProgress({
        sessionId: payload.sessionId,
        entry: planningEntry,
      });

      const runtimeState = await this.loadRuntimeState();
      await this.syncSessionTabState(payload.sessionId);
      await this.collectPageContext(payload.sessionId);
      await this.syncSessionTabState(payload.sessionId);

      const aiMessages = await this.buildAIRequestMessages(
        payload.sessionId,
        payload.message,
        runtimeState.settings.maxContextLength,
      );

      const responseText = await this.streamAIResponse(
        payload.sessionId,
        streamMessageId,
        aiMessages,
        runtimeState,
        streamController.signal,
      );
      assistantStreamDone = true;

      const parser = this.createParser(runtimeState.settings);
      const parsed = parser.parse(responseText);
      const assistantMessage = this.buildAssistantDisplayMessage(parsed);

      this.sessionManager.addAIResponse(payload.sessionId, assistantMessage);
      await this.broadcastCurrentSession(payload.sessionId, 'updated');

      if (parsed.actions.length === 0) {
        this.setSessionStatus(payload.sessionId, 'idle');
        await this.broadcastCurrentSession(payload.sessionId, 'updated');
        await this.broadcastActionProgress({
          sessionId: payload.sessionId,
          entry: {
            ...planningEntry,
            status: 'done',
            progress: 100,
            currentStep: 1,
            totalSteps: 1,
            detail: assistantMessage,
          },
        });

        return { success: true };
      }

      await this.broadcastActionProgress({
        sessionId: payload.sessionId,
        entry: {
          ...planningEntry,
          status: 'done',
          progress: 20,
          currentStep: 1,
          totalSteps: Math.max(parsed.actions.length + 1, 2),
          detail: `Generated ${parsed.actions.length} action(s) from the AI plan.`,
        },
      });

      await this.executeParsedActions(payload.sessionId, parsed.actions, runtimeState.settings);
      this.setSessionStatus(payload.sessionId, 'idle');
      await this.broadcastCurrentSession(payload.sessionId, 'updated');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Streaming failed unexpectedly';

      if (!assistantStreamDone) {
        await this.broadcastAIStream({
          sessionId: payload.sessionId,
          messageId: streamMessageId,
          delta: '',
          done: true,
          error: message,
        });
      }

      this.recordSessionError(payload.sessionId, message);
      await this.broadcastCurrentSession(payload.sessionId, 'updated');
      await this.broadcastActionProgress({
        sessionId: payload.sessionId,
        entry: {
          ...planningEntry,
          status: 'failed',
          errorCode: ErrorCode.ACTION_FAILED,
          detail: message,
        },
      });

      return {
        success: false,
        error: {
          code: ErrorCode.ACTION_FAILED,
          message,
        },
      };
    } finally {
      this.streamControllers.delete(payload.sessionId);
      await this.clearHighlights(payload.sessionId);
    }

    return { success: true };
  }

  private async buildSessionConfig(
    requested: SessionCreateRequest['config'],
  ): Promise<SessionConfig> {
    const stored = await chrome.storage.local.get({
      settings: { defaultProvider: 'openai' },
      providers: {},
    });

    const rawSettings = stored.settings as
      | { defaultProvider?: SessionConfig['provider'] }
      | undefined;
    const rawProviders = stored.providers as
      | Partial<Record<SessionConfig['provider'], Partial<ProviderConfig>>>
      | undefined;
    const provider = requested.provider ?? rawSettings?.defaultProvider ?? 'openai';
    const configuredModel = rawProviders?.[provider]?.model;
    const model =
      requested.model ??
      (typeof configuredModel === 'string' && configuredModel.trim().length > 0
        ? configuredModel
        : DEFAULT_PROVIDER_MODELS[provider]);

    return {
      id: generateId(12),
      provider,
      model,
      name: requested.name,
      systemPrompt: requested.systemPrompt,
      maxTurns: requested.maxTurns,
      timeout: requested.timeout,
    };
  }

  private async getActiveTabId(): Promise<number> {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0]?.id ?? 1;
  }

  private async broadcastCurrentSession(
    sessionId: string,
    reason: SessionUpdateEventPayload['reason'],
  ): Promise<void> {
    const session = this.sessionManager.getSession(sessionId);
    await this.broadcastSessionUpdate({
      sessionId,
      session: session ? this.cloneSession(session) : null,
      reason,
    });
  }

  private async broadcastSessionUpdate(payload: SessionUpdateEventPayload): Promise<void> {
    await this.broadcast('EVENT_SESSION_UPDATE', payload);
  }

  private async broadcastActionProgress(payload: ActionProgressEventPayload): Promise<void> {
    if (payload.entry.status === 'done' || payload.entry.status === 'failed') {
      this.latestActionEntries.delete(payload.sessionId);
    } else {
      this.latestActionEntries.set(payload.sessionId, payload.entry);
    }
    await this.broadcast('EVENT_ACTION_PROGRESS', payload);
  }

  private async broadcastAIStream(payload: AIStreamEventPayload): Promise<void> {
    await this.broadcast('EVENT_AI_STREAM', payload);
  }

  private async broadcast<T extends keyof RequestPayloadMap>(
    type: T,
    payload: RequestPayloadMap[T],
  ): Promise<void> {
    try {
      await chrome.runtime.sendMessage({
        id: generateId(),
        channel: 'sidePanel',
        type,
        payload,
        timestamp: Date.now(),
      } satisfies ExtensionMessage<RequestPayloadMap[T]>);
    } catch (error) {
      this.logger.debug(`Broadcast skipped for ${type}`, error);
    }
  }

  private async enableSessionRecording(session: Session): Promise<void> {
    if (!session.targetTabId) {
      return;
    }

    await this.bridge.ensureContentScript(session.targetTabId);
    await this.setRecordingStateForTab(session.targetTabId, true);
  }

  private async disableSessionRecording(sessionId: string): Promise<void> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      if (this.activeRecordingSessionId === sessionId) {
        this.activeRecordingSessionId = null;
      }
      return;
    }

    this.sessionManager.stopRecording(sessionId);
    if (session.targetTabId) {
      await this.setRecordingStateForTab(session.targetTabId, false);
    }

    if (this.activeRecordingSessionId === sessionId) {
      this.activeRecordingSessionId = null;
    }

    this.recordingNavigationUrls.delete(sessionId);
  }

  private async pauseSessionRecording(sessionId: string): Promise<void> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      throw new ExtensionError(
        ErrorCode.SESSION_NOT_FOUND,
        `Session "${sessionId}" was not found`,
        true,
      );
    }

    if (session.recording.status !== 'recording') {
      throw new ExtensionError(ErrorCode.ACTION_INVALID, 'Recording is not active', true);
    }

    this.sessionManager.pauseRecording(sessionId);
    if (session.targetTabId) {
      await this.setRecordingStateForTab(session.targetTabId, false);
    }

    this.activeRecordingSessionId = sessionId;
  }

  private async resumeSessionRecording(sessionId: string): Promise<void> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      throw new ExtensionError(
        ErrorCode.SESSION_NOT_FOUND,
        `Session "${sessionId}" was not found`,
        true,
      );
    }

    if (session.recording.status !== 'paused') {
      throw new ExtensionError(ErrorCode.ACTION_INVALID, 'Recording is not paused', true);
    }

    if (session.playback.status !== 'idle') {
      throw new ExtensionError(
        ErrorCode.ACTION_INVALID,
        'Stop playback before resuming recording',
        true,
      );
    }

    if (!session.targetTabId) {
      throw new ExtensionError(
        ErrorCode.TAB_NOT_FOUND,
        'No target tab is available for recording',
        true,
      );
    }

    await this.seedRecordingNavigationUrl(session);
    this.sessionManager.resumeRecording(sessionId);

    try {
      await this.enableSessionRecording(session);
    } catch (error) {
      this.sessionManager.pauseRecording(sessionId);
      throw error;
    }

    this.activeRecordingSessionId = sessionId;
  }

  private async setRecordingStateForTab(tabId: number, active: boolean): Promise<void> {
    const targets = this.listRecordingTargets(tabId);
    const payload: SetRecordingStatePayload = { active };

    for (const target of targets) {
      this.bridge.sendOneWay(tabId, 'SET_RECORDING_STATE', payload, target);
    }
  }

  private listRecordingTargets(tabId: number): BridgeSendTarget[] {
    const frames = Array.from(this.getFrameBucket(tabId, false)?.values() ?? []);
    if (frames.length === 0) {
      return [{ frameId: 0 }];
    }

    const deduped = new Map<string, BridgeSendTarget>();
    for (const frame of frames) {
      const target: BridgeSendTarget = frame.documentId
        ? { frameId: frame.frameId, documentId: frame.documentId }
        : { frameId: frame.frameId };
      const key = target.documentId ?? `frame:${target.frameId ?? 0}`;
      deduped.set(key, target);
    }

    if (
      !deduped.has('frame:0') &&
      !Array.from(deduped.values()).some((target) => target.frameId === 0)
    ) {
      deduped.set('frame:0', { frameId: 0 });
    }

    return Array.from(deduped.values());
  }

  private async syncRecordingStateToFrame(tabId: number, frame: BridgeFrameContext): Promise<void> {
    const sessionId = this.activeRecordingSessionId;
    if (!sessionId) {
      return;
    }

    const session = this.sessionManager.getSession(sessionId);
    if (!session || session.targetTabId !== tabId || session.recording.status !== 'recording') {
      return;
    }

    const target: BridgeSendTarget = frame.documentId
      ? { frameId: frame.frameId, documentId: frame.documentId }
      : { frameId: frame.frameId };
    this.bridge.sendOneWay(tabId, 'SET_RECORDING_STATE', { active: true }, target);
  }

  private handleRecordedClickEvent(
    tabId: number,
    frame: BridgeFrameContext,
    payload: unknown,
  ): void {
    const sessionId = this.activeRecordingSessionId;
    if (!sessionId) {
      return;
    }

    const session = this.sessionManager.getSession(sessionId);
    if (!session || session.targetTabId !== tabId || session.recording.status !== 'recording') {
      return;
    }

    const action = this.extractRecordedClickAction(payload, frame);
    if (!action) {
      return;
    }

    this.sessionManager.appendRecordedAction(sessionId, {
      action,
      timestamp: Date.now(),
    });

    void this.broadcastCurrentSession(sessionId, 'updated');
  }

  private handleRecordedInputEvent(
    tabId: number,
    frame: BridgeFrameContext,
    payload: unknown,
  ): void {
    const sessionId = this.activeRecordingSessionId;
    if (!sessionId) {
      return;
    }

    const session = this.sessionManager.getSession(sessionId);
    if (!session || session.targetTabId !== tabId || session.recording.status !== 'recording') {
      return;
    }

    const action = this.extractRecordedInputAction(payload, frame);
    if (!action) {
      return;
    }

    this.sessionManager.appendRecordedAction(sessionId, {
      action,
      timestamp: Date.now(),
    });

    void this.broadcastCurrentSession(sessionId, 'updated');
  }

  private handleRecordedNavigationEvent(
    tabId: number,
    frame: BridgeFrameContext,
    payload: unknown,
  ): void {
    if (!frame.isTop) {
      return;
    }

    const action = this.extractRecordedNavigationAction(payload);
    if (!action) {
      return;
    }

    this.appendRecordedNavigationAction(tabId, frame, action);
  }

  private handleRecordedPageLoad(tabId: number, frame: BridgeFrameContext): void {
    if (!frame.isTop || typeof frame.url !== 'string' || frame.url.length === 0) {
      return;
    }

    this.appendRecordedNavigationAction(tabId, frame, {
      id: `recorded-navigation-load-${generateId(10)}`,
      type: 'navigate',
      url: frame.url,
    });
  }

  private extractRecordedClickAction(
    payload: unknown,
    frame: BridgeFrameContext,
  ): ClickAction | null {
    if (typeof payload !== 'object' || payload === null) {
      return null;
    }

    const recordedPayload = payload as Partial<RecordedClickPayload>;
    const action = recordedPayload.action;
    if (!action || action.type !== 'click' || !action.selector) {
      return null;
    }

    const selector = this.attachFrameTargetToSelector(action.selector, frame);
    return {
      ...action,
      selector,
    };
  }

  private extractRecordedInputAction(
    payload: unknown,
    frame: BridgeFrameContext,
  ): FillAction | null {
    if (typeof payload !== 'object' || payload === null) {
      return null;
    }

    const recordedPayload = payload as Partial<RecordedInputPayload>;
    const action = recordedPayload.action;
    if (!action || action.type !== 'fill' || !action.selector || typeof action.value !== 'string') {
      return null;
    }

    const selector = this.attachFrameTargetToSelector(action.selector, frame);
    return {
      ...action,
      selector,
    };
  }

  private extractRecordedNavigationAction(payload: unknown): NavigateAction | null {
    if (typeof payload !== 'object' || payload === null) {
      return null;
    }

    const recordedPayload = payload as Partial<RecordedNavigationPayload>;
    const action = recordedPayload.action;
    if (
      !action ||
      action.type !== 'navigate' ||
      typeof action.url !== 'string' ||
      action.url.length === 0
    ) {
      return null;
    }

    return action;
  }

  private appendRecordedNavigationAction(
    tabId: number,
    frame: BridgeFrameContext,
    action: NavigateAction,
  ): void {
    const sessionId = this.activeRecordingSessionId;
    if (!sessionId) {
      return;
    }

    const session = this.sessionManager.getSession(sessionId);
    if (!session || session.targetTabId !== tabId || session.recording.status !== 'recording') {
      return;
    }

    if (!frame.isTop) {
      return;
    }

    const normalizedUrl = action.url.trim();
    if (normalizedUrl.length === 0) {
      return;
    }

    const previousUrl = this.recordingNavigationUrls.get(sessionId) ?? null;
    if (previousUrl === normalizedUrl) {
      return;
    }

    this.recordingNavigationUrls.set(sessionId, normalizedUrl);
    this.sessionManager.appendRecordedAction(sessionId, {
      action: {
        ...action,
        url: normalizedUrl,
      },
      timestamp: Date.now(),
    });

    void this.broadcastCurrentSession(sessionId, 'updated');
  }

  private async seedRecordingNavigationUrl(session: Session): Promise<void> {
    const tabId = session.targetTabId;
    if (!tabId) {
      this.recordingNavigationUrls.set(session.config.id, null);
      return;
    }

    const frameUrl = Array.from(this.getFrameBucket(tabId, false)?.values() ?? []).find(
      (frame) => frame.isTop,
    )?.url;
    if (typeof frameUrl === 'string' && frameUrl.length > 0) {
      this.recordingNavigationUrls.set(session.config.id, frameUrl);
      return;
    }

    try {
      const tab = await chrome.tabs.get(tabId);
      this.recordingNavigationUrls.set(session.config.id, tab.url ?? null);
    } catch {
      this.recordingNavigationUrls.set(session.config.id, null);
    }
  }

  private attachFrameTargetToSelector(
    selector: ElementSelector,
    frame: BridgeFrameContext,
  ): ElementSelector {
    if (selector.frame || frame.isTop) {
      return selector;
    }

    return {
      ...selector,
      frame: frame.documentId
        ? { mode: 'documentId', documentId: frame.documentId }
        : { mode: 'frameId', frameId: frame.frameId },
    };
  }

  private createDefaultAIClientManager(): AbortableAIClientManager {
    return new AIClientManager();
  }

  private async ensureDefaultProviderRegistered(type: SessionConfig['provider']): Promise<void> {
    if (!this.usesDefaultAIClientManager || this.registeredDefaultProviders.has(type)) {
      return;
    }

    const existingRegistration = this.defaultProviderRegistrations.get(type);
    if (existingRegistration) {
      await existingRegistration;
      return;
    }

    const registration = this.registerDefaultProvider(type);
    this.defaultProviderRegistrations.set(type, registration);

    try {
      await registration;
      this.registeredDefaultProviders.add(type);
    } finally {
      this.defaultProviderRegistrations.delete(type);
    }
  }

  private async registerDefaultProvider(type: SessionConfig['provider']): Promise<void> {
    const provider =
      type === 'custom' ? await this.createCustomProvider() : await createProvider(type);
    this.aiClientManager.registerProvider(provider);
  }

  private async createCustomProvider(): Promise<IAIProvider> {
    const { OpenAIProvider } = await import('@core/ai-client/providers/openai');

    class CustomOpenAICompatibleProvider extends OpenAIProvider {
      override readonly name = 'custom' as const;
    }

    return new CustomOpenAICompatibleProvider();
  }

  private async loadRuntimeState(): Promise<RuntimeState> {
    const [stored, vault] = await Promise.all([
      chrome.storage.local.get({
        settings: DEFAULT_RUNTIME_SETTINGS,
        providers: {},
        activeProvider: DEFAULT_RUNTIME_SETTINGS.defaultProvider,
        onboarding: createDefaultOnboardingState(),
      }),
      this.credentialVault.getState(),
    ]);

    const settings = {
      ...DEFAULT_RUNTIME_SETTINGS,
      ...(stored.settings as Partial<ExtensionSettings> | undefined),
    };
    const activeProvider =
      typeof stored.activeProvider === 'string'
        ? (stored.activeProvider as SessionConfig['provider'])
        : settings.defaultProvider;

    return {
      settings,
      providers:
        (stored.providers as
          | Partial<Record<SessionConfig['provider'], Partial<ProviderConfig>>>
          | undefined) ?? {},
      activeProvider,
      onboarding: normalizeOnboardingState(stored.onboarding),
      vault,
    };
  }

  private supportsAccountBackedAuth(provider: SessionConfig['provider']): boolean {
    return PROVIDER_LOOKUP[provider].authFamily === 'account-backed';
  }

  private assertAccountArtifactTransport(
    transport: RequestPayloadMap['ACCOUNT_AUTH_CONNECT_START']['transport'],
  ): void {
    if (transport !== 'artifact-import') {
      throw new ExtensionError(
        ErrorCode.ACTION_INVALID,
        `Unsupported account auth transport "${transport}"`,
        true,
      );
    }
  }

  private async getAccountSurfaceSnapshot(provider: SessionConfig['provider']): Promise<{
    vault: VaultState;
    credential?: ProviderCredentialRecord;
    accounts: ProviderAccountRecord[];
    activeAccountId?: string;
  }> {
    const [vault, accounts] = await Promise.all([
      this.credentialVault.getState(),
      this.credentialVault.listAccounts(provider),
    ]);

    return {
      vault,
      credential: vault.credentials[provider],
      accounts: accounts.map((account) => this.cloneAccountRecord(account)),
      activeAccountId: vault.activeAccounts[provider],
    };
  }

  private cloneAccountRecord(account: ProviderAccountRecord): ProviderAccountRecord {
    return {
      ...account,
      metadata: account.metadata
        ? {
            ...account.metadata,
            quota: account.metadata.quota ? { ...account.metadata.quota } : undefined,
            rateLimit: account.metadata.rateLimit ? { ...account.metadata.rateLimit } : undefined,
            entitlement: account.metadata.entitlement
              ? { ...account.metadata.entitlement }
              : undefined,
            session: account.metadata.session ? { ...account.metadata.session } : undefined,
          }
        : undefined,
    };
  }

  private createNotImplementedResponse<T extends keyof ResponsePayloadMap>(
    type: T,
    message: string,
    details?: unknown,
  ): ExtensionResponse<ResponsePayloadMap[T]> {
    return {
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message,
        details: {
          type,
          ...((details && typeof details === 'object' ? details : { details }) as Record<
            string,
            unknown
          >),
        },
      },
    };
  }

  private createUnsupportedAccountProviderResponse<T extends keyof ResponsePayloadMap>(
    type: T,
    provider: SessionConfig['provider'],
  ): ExtensionResponse<ResponsePayloadMap[T]> {
    return {
      success: false,
      error: {
        code: 'UNSUPPORTED_PROVIDER_AUTH_FAMILY',
        message: `Provider ${provider} does not use account-backed auth messaging.`,
        details: {
          type,
          provider,
        },
      },
    };
  }

  private createParser(settings: ExtensionSettings): CommandParser {
    if (this.parserFactory) {
      return this.parserFactory({
        strictMode: true,
        allowEvaluate: isEvaluateEnabled(settings),
        allowedDomains: settings.allowedDomains,
      });
    }

    return new CommandParser({
      strictMode: true,
      allowEvaluate: isEvaluateEnabled(settings),
      allowedDomains: settings.allowedDomains,
    });
  }

  private async collectPageContext(sessionId: string): Promise<void> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session?.targetTabId) {
      return;
    }

    try {
      const target = this.resolveFrameTarget(session.targetTabId);
      await this.bridge.ensureContentScript(session.targetTabId, target);
      const payload = await this.bridge.send<GetPageContextPayload, PageContextPayload>(
        session.targetTabId,
        'GET_PAGE_CONTEXT',
        { includeChildFrames: true },
        target,
      );
      const context = this.attachChildFrameSummaries(session.targetTabId, payload.context);
      this.cacheFrameContext(session.targetTabId, context);
      this.sessionManager.setPageContext(sessionId, context);
      session.variables.pageContext = context;
    } catch (error) {
      this.logger.debug(`Unable to refresh page context for session ${sessionId}`, error);
    }
  }

  private async buildAIRequestMessages(
    sessionId: string,
    prompt: string,
    maxContextLength: number,
  ): Promise<AIMessage[]> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      throw new ExtensionError(
        ErrorCode.SESSION_NOT_FOUND,
        `Session "${sessionId}" was not found`,
        true,
      );
    }

    const context = await this.sessionManager.buildContext(sessionId);
    this.plannedTabSnapshots.set(
      sessionId,
      session.tabSnapshot.map((tab) => ({ ...tab })),
    );
    const trimmedContext =
      context.length > maxContextLength ? context.slice(0, maxContextLength) : context;
    const uploadMetadata = this.fileUploadManager.listMetadata(sessionId);
    const priorMessages = session.messages.slice(-6, -1).map((message) => ({
      role: message.role,
      content: message.content,
    }));
    const availableUploadsBlock = this.buildAvailableUploadsBlock(uploadMetadata);

    return [
      {
        role: 'system',
        content: session.config.systemPrompt?.trim() || getSystemPrompt(),
      },
      ...priorMessages,
      {
        role: 'user',
        content: [
          trimmedContext,
          availableUploadsBlock,
          `<user_request>\n## User Request\n${sanitizeUserMessage(prompt.trim())}\n</user_request>`,
        ]
          .filter((value) => value.length > 0)
          .join('\n\n'),
      },
    ];
  }

  private buildAvailableUploadsBlock(uploads: FileUploadMetadata[]): string {
    if (uploads.length === 0) {
      return '';
    }

    return [
      '## Available Uploads',
      'Use the `uploadFile` action with fileIds from this list when interacting with `<input type="file">` fields.',
      ...uploads.map(
        (upload) =>
          `- id=${upload.id} name="${upload.name}" mimeType="${upload.mimeType || 'application/octet-stream'}" size=${upload.size} lastModified=${upload.lastModified}`,
      ),
    ].join('\n');
  }

  private async streamAIResponse(
    sessionId: string,
    messageId: string,
    messages: AIMessage[],
    runtimeState: RuntimeState,
    signal: AbortSignal,
  ): Promise<string> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      throw new ExtensionError(
        ErrorCode.SESSION_NOT_FOUND,
        `Session "${sessionId}" was not found`,
        true,
      );
    }

    const providerConfig = this.resolveProviderConfig(session.config.provider, runtimeState);
    const providerCredential = await this.resolveProviderCredential(
      session.config.provider,
      runtimeState,
    );
    await this.ensureDefaultProviderRegistered(session.config.provider);
    await this.aiClientManager.switchProvider(session.config.provider, {
      provider: session.config.provider,
      model: session.config.model,
      apiKey: providerCredential,
      baseUrl: providerConfig.customEndpoint?.trim() || undefined,
      maxTokens: providerConfig.maxTokens,
      temperature: providerConfig.temperature,
      systemPrompt: session.config.systemPrompt,
    });

    let responseText = '';
    for await (const chunk of this.aiClientManager.chat(messages, {
      signal,
      timeout: session.config.timeout ?? runtimeState.settings.defaultTimeout,
      maxRetries: 0,
    })) {
      if (signal.aborted) {
        throw new ExtensionError(ErrorCode.ABORTED, 'Execution aborted', false);
      }

      if (chunk.type === 'error') {
        throw (
          chunk.error ??
          new ExtensionError(ErrorCode.AI_API_ERROR, 'AI provider returned an error chunk', true)
        );
      }

      if (chunk.type !== 'text' || !chunk.content) {
        continue;
      }

      responseText += chunk.content;
      await this.broadcastAIStream({
        sessionId,
        messageId,
        delta: chunk.content,
        done: false,
      });

      if (runtimeState.settings.streamResponses) {
        await this.delay(STREAM_CHUNK_INTERVAL_MS);
      }
    }

    await this.broadcastAIStream({
      sessionId,
      messageId,
      delta: '',
      done: true,
    });

    if (responseText.trim().length === 0) {
      throw new ExtensionError(ErrorCode.AI_PARSE_ERROR, 'AI returned an empty plan', true);
    }

    return responseText;
  }

  private async executeParsedActions(
    sessionId: string,
    actions: Action[],
    settings: ExtensionSettings,
  ): Promise<void> {
    const totalSteps = actions.length;

    for (let index = 0; index < actions.length; index += 1) {
      await this.executeActionWithProgress(
        sessionId,
        actions[index],
        index + 1,
        totalSteps,
        settings,
      );
    }
  }

  private async executeActionWithProgress(
    sessionId: string,
    baseAction: Action,
    currentStep: number,
    totalSteps: number,
    settings: ExtensionSettings,
  ): Promise<ActionResult> {
    const action = this.applyDefaultRetries(baseAction, settings);
    const runningEntry = await this.createExecutionEntry(
      sessionId,
      action,
      currentStep,
      totalSteps,
      'running',
    );
    await this.broadcastActionProgress({ sessionId, entry: runningEntry });

    const result = await this.orchestrator.executeAction(action, { sessionId });
    this.storeActionResult(sessionId, action, result);
    await this.broadcastCurrentSession(sessionId, 'updated');

    if (!result.success) {
      await this.broadcastActionProgress({
        sessionId,
        entry: {
          ...runningEntry,
          status: 'failed',
          progress: Math.max(5, Math.round((currentStep / totalSteps) * 100)),
          errorCode: result.error?.code,
          detail: this.buildActionFailureDetail(action, result),
        },
      });

      if (!action.optional) {
        throw new ExtensionError(
          (result.error?.code as ErrorCode | undefined) ?? ErrorCode.ACTION_FAILED,
          result.error?.message ?? `Action "${action.type}" failed`,
          result.error?.recoverable ?? true,
        );
      }

      return result;
    }

    await this.collectPageContext(sessionId);
    await this.syncSessionTabState(sessionId);
    await this.broadcastActionProgress({
      sessionId,
      entry: {
        ...runningEntry,
        status: 'done',
        progress: Math.round((currentStep / totalSteps) * 100),
        detail: this.buildActionCompletedDetail(action, result),
      },
    });

    return result;
  }

  private async createExecutionEntry(
    sessionId: string,
    action: Action,
    currentStep: number,
    totalSteps: number,
    status: ActionLogEventStatus,
  ): Promise<ActionLogEventEntry> {
    const session = this.sessionManager.getSession(sessionId);
    const selector = 'selector' in action ? action.selector : undefined;

    if (status === 'running' && session?.targetTabId && selector) {
      await this.highlightTarget(session.targetTabId, selector);
    }

    const riskMetadata = getActionRiskMetadata(action);

    return {
      id: `action-${generateId(10)}`,
      actionId: action.id,
      title: this.buildActionTitle(action),
      detail: this.buildActionRunningDetail(action),
      timestamp: Date.now(),
      status,
      progress: Math.max(5, Math.round(((currentStep - 1) / Math.max(totalSteps, 1)) * 100)),
      currentStep,
      totalSteps,
      selector,
      ...riskMetadata,
    };
  }

  private cacheFrameContext(tabId: number, context: PageContext): void {
    const bucket = this.getFrameBucket(tabId, true);
    if (!bucket) {
      return;
    }
    bucket.set(this.getFrameRegistryKey(context.frame), {
      ...context.frame,
      title: context.title,
      summary: context.summary,
      interactiveElementCount: context.interactiveElements.length,
      lastSeenAt: Date.now(),
    });
  }

  private attachChildFrameSummaries(tabId: number, context: PageContext): PageContext {
    if (!context.frame.isTop) {
      return context;
    }

    const registryFrames = Array.from(this.getFrameBucket(tabId, false)?.values() ?? []).filter(
      (frame) => !frame.isTop,
    );

    const existingByUrl = new Map(
      (context.childFrames ?? []).map((entry) => [entry.frame.url, entry] as const),
    );

    const childFrames: FrameContextSummary[] = [];
    for (const frame of registryFrames) {
      const existing = existingByUrl.get(frame.url);
      childFrames.push({
        frame: {
          frameId: frame.frameId,
          documentId: frame.documentId,
          parentFrameId: frame.parentFrameId,
          url: frame.url,
          origin: frame.origin,
          name: frame.name,
          isTop: false,
        },
        title: frame.title ?? existing?.title,
        summary: frame.summary ?? existing?.summary,
        interactiveElementCount: frame.interactiveElementCount ?? existing?.interactiveElementCount,
      });
      existingByUrl.delete(frame.url);
    }

    childFrames.push(...existingByUrl.values());

    return {
      ...context,
      childFrames,
    };
  }

  private resolveFrameTarget(
    tabId: number,
    selector?: ElementSelector,
  ): BridgeSendTarget | undefined {
    const frameTarget = selector?.frame;
    if (!frameTarget || frameTarget.mode === undefined || frameTarget.mode === 'main') {
      return { frameId: 0 };
    }

    if (frameTarget.mode === 'frameId' && frameTarget.frameId !== undefined) {
      return { frameId: frameTarget.frameId };
    }

    if (frameTarget.mode === 'documentId' && frameTarget.documentId) {
      return { documentId: frameTarget.documentId };
    }

    const frames = Array.from(this.getFrameBucket(tabId, false)?.values() ?? []);
    if (frameTarget.mode === 'url' && frameTarget.urlPattern) {
      const urlPattern = frameTarget.urlPattern;
      const match = frames.find((frame) => this.matchesUrlPattern(frame.url, urlPattern));
      return match ? { frameId: match.frameId, documentId: match.documentId } : { frameId: 0 };
    }

    if (frameTarget.mode === 'auto') {
      const childFrames = frames.filter((frame) => !frame.isTop);
      if (childFrames.length === 1) {
        return { frameId: childFrames[0].frameId, documentId: childFrames[0].documentId };
      }
    }

    return { frameId: 0 };
  }

  private matchesUrlPattern(url: string, pattern: string): boolean {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    try {
      return new RegExp(`^${escaped}$`, 'i').test(url);
    } catch {
      return url.includes(pattern.replace(/\*/g, ''));
    }
  }

  private createPlanningEntry(): ActionLogEventEntry {
    return {
      id: `action-${generateId(10)}`,
      actionId: `planning-${generateId(8)}`,
      title: 'Planning automation steps',
      detail: 'Collecting page context and generating an executable AI plan.',
      timestamp: Date.now(),
      status: 'running',
      progress: 5,
      currentStep: 0,
      totalSteps: 1,
    };
  }

  private async startPlaybackLoop(sessionId: string): Promise<void> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return;
    }

    const playbackRun: PlaybackRunState = {
      controller: new AbortController(),
      timeoutId: null,
    };
    this.playbackRuns.set(sessionId, playbackRun);

    try {
      const runtimeState = await this.loadRuntimeState();
      const actions = session.recording.actions;
      const totalSteps = actions.length;

      for (let index = session.playback.nextActionIndex; index < totalSteps; index += 1) {
        const currentSession = this.sessionManager.getSession(sessionId);
        if (!currentSession || currentSession.playback.status !== 'playing') {
          return;
        }

        const delayMs = this.getPlaybackDelayMs(actions, index, currentSession.playback.speed);
        if (delayMs > 0) {
          await this.waitForPlaybackDelay(sessionId, delayMs);
        }

        const sessionAfterDelay = this.sessionManager.getSession(sessionId);
        if (!sessionAfterDelay || sessionAfterDelay.playback.status !== 'playing') {
          return;
        }

        const recordedAction = actions[index];
        await this.executeActionWithProgress(
          sessionId,
          recordedAction.action,
          index + 1,
          totalSteps,
          runtimeState.settings,
        );

        const sessionAfterAction = this.sessionManager.getSession(sessionId);
        if (!sessionAfterAction) {
          return;
        }

        if (
          sessionAfterAction.playback.status === 'idle' &&
          sessionAfterAction.playback.startedAt === null
        ) {
          return;
        }

        this.sessionManager.markPlaybackActionCompleted(sessionId, index + 1);
        await this.broadcastCurrentSession(sessionId, 'updated');

        if (sessionAfterAction.playback.status !== 'playing') {
          return;
        }
      }

      const completedSession = this.sessionManager.getSession(sessionId);
      if (completedSession?.playback.status === 'playing') {
        this.sessionManager.completePlayback(sessionId);
        await this.broadcastCurrentSession(sessionId, 'updated');
      }
    } catch (error) {
      if (this.isPlaybackCancellation(sessionId, error)) {
        return;
      }

      const playbackSession = this.sessionManager.getSession(sessionId);
      if (!playbackSession) {
        return;
      }

      const nextAction =
        playbackSession.recording.actions[playbackSession.playback.nextActionIndex];
      const message = error instanceof Error ? error.message : 'Playback failed unexpectedly';
      this.sessionManager.pausePlayback(sessionId);
      this.sessionManager.setPlaybackError(sessionId, {
        message,
        actionId: nextAction?.action.id,
        actionType: nextAction?.action.type,
      });
      this.recordSessionError(sessionId, message);
      await this.broadcastCurrentSession(sessionId, 'updated');
    } finally {
      this.clearPlaybackRun(sessionId, playbackRun);
    }
  }

  private getPlaybackDelayMs(
    actions: Session['recording']['actions'],
    index: number,
    speed: SessionPlaybackSpeed,
  ): number {
    if (index <= 0) {
      return 0;
    }

    const previous = actions[index - 1];
    const current = actions[index];
    const recordedDelayMs = Math.max(0, current.timestamp - previous.timestamp);
    return Math.round(recordedDelayMs / speed);
  }

  private async waitForPlaybackDelay(sessionId: string, timeoutMs: number): Promise<void> {
    const playbackRun = this.playbackRuns.get(sessionId);
    if (!playbackRun) {
      throw new ExtensionError(ErrorCode.ABORTED, 'Playback delay cancelled', false);
    }

    if (playbackRun.controller.signal.aborted) {
      throw new ExtensionError(ErrorCode.ABORTED, 'Playback delay cancelled', false);
    }

    await new Promise<void>((resolve, reject) => {
      const handleAbort = (): void => {
        if (playbackRun.timeoutId !== null) {
          clearTimeout(playbackRun.timeoutId);
          playbackRun.timeoutId = null;
        }
        playbackRun.controller.signal.removeEventListener('abort', handleAbort);
        reject(new ExtensionError(ErrorCode.ABORTED, 'Playback delay cancelled', false));
      };

      playbackRun.controller.signal.addEventListener('abort', handleAbort, { once: true });
      playbackRun.timeoutId = setTimeout(() => {
        playbackRun.timeoutId = null;
        playbackRun.controller.signal.removeEventListener('abort', handleAbort);
        resolve();
      }, timeoutMs);
    });
  }

  private stopPlaybackExecution(sessionId: string): void {
    const playbackRun = this.playbackRuns.get(sessionId);
    if (!playbackRun) {
      return;
    }

    if (playbackRun.timeoutId !== null) {
      clearTimeout(playbackRun.timeoutId);
      playbackRun.timeoutId = null;
    }

    playbackRun.controller.abort();
    this.playbackRuns.delete(sessionId);
  }

  private clearPlaybackRun(sessionId: string, playbackRun: PlaybackRunState): void {
    const current = this.playbackRuns.get(sessionId);
    if (current !== playbackRun) {
      return;
    }

    if (playbackRun.timeoutId !== null) {
      clearTimeout(playbackRun.timeoutId);
      playbackRun.timeoutId = null;
    }

    this.playbackRuns.delete(sessionId);
  }

  private isPlaybackCancellation(sessionId: string, error: unknown): boolean {
    if (!ExtensionError.isExtensionError(error) || error.code !== ErrorCode.ABORTED) {
      return false;
    }

    const session = this.sessionManager.getSession(sessionId);
    return !session || session.playback.status !== 'playing';
  }

  private normalizePlaybackSpeed(speed: number | undefined): SessionPlaybackSpeed {
    if (speed === undefined) {
      return 1;
    }

    if ((PLAYBACK_SPEEDS as readonly number[]).includes(speed)) {
      return speed as SessionPlaybackSpeed;
    }

    throw new ExtensionError(
      ErrorCode.ACTION_INVALID,
      `Unsupported playback speed "${String(speed)}". Allowed values: ${PLAYBACK_SPEEDS.join(', ')}`,
      true,
    );
  }

  private normalizeRecordingExportFormat(
    format: SessionRecordingExportFormat,
  ): SessionRecordingExportFormat {
    if (format === 'json' || format === 'playwright' || format === 'puppeteer') {
      return format;
    }

    throw new ExtensionError(
      ErrorCode.ACTION_INVALID,
      `Unsupported recording export format "${String(format)}"`,
      true,
    );
  }

  private assertPlaybackCanStart(session: Session): void {
    if (session.recording.actions.length === 0) {
      throw new ExtensionError(
        ErrorCode.ACTION_INVALID,
        'Playback requires at least one recorded action',
        true,
      );
    }

    if (!session.targetTabId) {
      throw new ExtensionError(
        ErrorCode.TAB_NOT_FOUND,
        'No target tab is available for playback',
        true,
      );
    }

    if (session.recording.status !== 'idle') {
      throw new ExtensionError(
        ErrorCode.ACTION_INVALID,
        'Stop recording before starting playback',
        true,
      );
    }

    if (session.playback.status === 'playing') {
      throw new ExtensionError(ErrorCode.ACTION_INVALID, 'Playback is already running', true);
    }

    if (session.status === 'running') {
      throw new ExtensionError(
        ErrorCode.ACTION_INVALID,
        'Wait for the current automation run to finish before starting playback',
        true,
      );
    }
  }

  private assertPlaybackCanResume(session: Session): void {
    if (session.recording.actions.length === 0) {
      throw new ExtensionError(
        ErrorCode.ACTION_INVALID,
        'Playback requires at least one recorded action',
        true,
      );
    }

    if (!session.targetTabId) {
      throw new ExtensionError(
        ErrorCode.TAB_NOT_FOUND,
        'No target tab is available for playback',
        true,
      );
    }

    if (session.recording.status !== 'idle') {
      throw new ExtensionError(
        ErrorCode.ACTION_INVALID,
        'Stop recording before resuming playback',
        true,
      );
    }

    if (session.playback.status === 'playing') {
      throw new ExtensionError(ErrorCode.ACTION_INVALID, 'Playback is already running', true);
    }

    if (session.playback.status !== 'paused') {
      throw new ExtensionError(ErrorCode.ACTION_INVALID, 'Playback is not paused', true);
    }

    if (session.playback.nextActionIndex >= session.recording.actions.length) {
      throw new ExtensionError(ErrorCode.ACTION_INVALID, 'Playback has already completed', true);
    }

    if (session.status === 'running') {
      throw new ExtensionError(
        ErrorCode.ACTION_INVALID,
        'Wait for the current automation run to finish before resuming playback',
        true,
      );
    }
  }

  private async getSavedWorkflowById(workflowId: string): Promise<SavedWorkflow> {
    const workflows = await getSavedWorkflows();
    const workflow = workflows.find((item) => item.id === workflowId);

    if (!workflow) {
      throw new ExtensionError(
        ErrorCode.ACTION_INVALID,
        `Workflow "${workflowId}" was not found`,
        true,
      );
    }

    return workflow;
  }

  private normalizeWorkflowName(value: string): string {
    const normalized = value.trim();
    if (!normalized) {
      throw new ExtensionError(ErrorCode.ACTION_INVALID, 'Workflow name is required.', true);
    }

    return normalized;
  }

  private normalizeWorkflowDescription(value: string | undefined): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  private normalizeWorkflowTags(tags: string[]): string[] {
    return Array.from(new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0)));
  }

  private normalizeWorkflowSource(
    source: SavedWorkflowSource | undefined,
  ): SavedWorkflowSource | undefined {
    if (!source) {
      return undefined;
    }

    const sessionId = source.sessionId?.trim();
    const sessionName = source.sessionName?.trim();
    const recordedAt =
      typeof source.recordedAt === 'number' && Number.isFinite(source.recordedAt)
        ? Math.trunc(source.recordedAt)
        : undefined;

    if (!sessionId && !sessionName && recordedAt === undefined) {
      return undefined;
    }

    return {
      sessionId: sessionId || undefined,
      sessionName: sessionName || undefined,
      recordedAt,
    };
  }

  private cloneRecordedActions(actions: RecordedSessionAction[]): RecordedSessionAction[] {
    return JSON.parse(JSON.stringify(actions)) as RecordedSessionAction[];
  }

  private cloneWorkflow(workflow: SavedWorkflow): SavedWorkflow {
    return JSON.parse(JSON.stringify(workflow)) as SavedWorkflow;
  }

  private requireSession(sessionId: string): Session {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      throw new ExtensionError(
        ErrorCode.SESSION_NOT_FOUND,
        `Session "${sessionId}" was not found`,
        true,
      );
    }

    return session;
  }

  private async executeAutomationAction(action: Action, sessionId?: string): Promise<ActionResult> {
    const session = sessionId ? this.sessionManager.getSession(sessionId) : null;
    const tabId = session?.targetTabId ?? null;

    try {
      switch (action.type) {
        case 'navigate':
          return await this.executeNavigateAction(action, tabId);
        case 'goBack':
          return await this.executeHistoryAction(action, tabId, 'back');
        case 'goForward':
          return await this.executeHistoryAction(action, tabId, 'forward');
        case 'reload':
          return await this.executeReloadAction(action, tabId);
        case 'newTab':
          return await this.executeNewTabAction(action, sessionId);
        case 'switchTab':
          return await this.executeSwitchTabAction(action, sessionId);
        case 'closeTab':
          return await this.executeCloseTabAction(action, sessionId);
        case 'emulateDevice':
          return await this.executeDeviceEmulationAction(action, sessionId, tabId);
        case 'mockGeolocation':
          return await this.executeGeolocationMockAction(action, sessionId, tabId);
        case 'interceptNetwork':
        case 'mockResponse':
          return await this.executeNetworkInterceptionAction(action, sessionId, tabId);
        case 'uploadFile':
          return await this.executeUploadFileAction(action, sessionId, tabId);
        case 'press':
          return await this.executePressAction(action, sessionId, tabId);
        case 'hotkey':
          return await this.executeHotkeyAction(action, tabId);
        case 'evaluate':
          return await this.executeEvaluateAction(action, sessionId, tabId);
        case 'savePdf':
          return await this.executeSavePdfAction(action, tabId);
        default:
          return await this.executeDomAction(action, sessionId, tabId);
      }
    } finally {
      if (sessionId) {
        await this.clearHighlights(sessionId);
      }
    }
  }

  private async executeDomAction(
    action: Action,
    sessionId: string | undefined,
    tabId: number | null,
  ): Promise<ActionResult> {
    const resolvedTabId = tabId ?? (await this.getActiveTabId());
    const target = this.resolveFrameTarget(
      resolvedTabId,
      'selector' in action ? action.selector : undefined,
    );
    await this.bridge.ensureContentScript(resolvedTabId, target);
    const payload = await this.bridge.send<ExecuteActionPayload, ActionResultPayload>(
      resolvedTabId,
      'EXECUTE_ACTION',
      {
        action,
        context: {
          variables: sessionId ? (this.sessionManager.getSession(sessionId)?.variables ?? {}) : {},
        },
      },
      target,
    );

    return this.mapBridgeResult(action, payload);
  }

  private async executeUploadFileAction(
    action: Extract<Action, { type: 'uploadFile' }>,
    sessionId: string | undefined,
    tabId: number | null,
  ): Promise<ActionResult> {
    if (!sessionId || !tabId) {
      throw new ExtensionError(
        ErrorCode.TAB_NOT_FOUND,
        'No target tab is available for file upload',
        true,
      );
    }

    const target = this.resolveFrameTarget(tabId, action.selector);
    await this.bridge.ensureContentScript(tabId, target);
    const payload = await this.bridge.send<ExecuteActionPayload, ActionResultPayload>(
      tabId,
      'EXECUTE_ACTION',
      {
        action,
        context: {
          variables: this.sessionManager.getSession(sessionId)?.variables ?? {},
          uploads: this.fileUploadManager.resolveUploads(sessionId, action.fileIds),
        },
      },
      target,
    );

    return this.mapBridgeResult(action, payload);
  }

  private async executeNetworkInterceptionAction(
    action: Extract<Action, { type: 'interceptNetwork' | 'mockResponse' }>,
    sessionId: string | undefined,
    tabId: number | null,
  ): Promise<ActionResult> {
    if (!sessionId) {
      throw new ExtensionError(
        ErrorCode.SESSION_NOT_FOUND,
        'No active session available for network interception',
        true,
      );
    }

    if (!tabId) {
      throw new ExtensionError(
        ErrorCode.TAB_NOT_FOUND,
        'No target tab is available for network interception',
        true,
      );
    }

    const startedAt = Date.now();
    const registration = await this.networkInterceptionManager.registerAction(
      sessionId,
      tabId,
      action,
    );
    return {
      actionId: action.id,
      success: true,
      duration: Date.now() - startedAt,
      data: registration,
    };
  }

  private async executeDeviceEmulationAction(
    action: Extract<Action, { type: 'emulateDevice' }>,
    sessionId: string | undefined,
    tabId: number | null,
  ): Promise<ActionResult> {
    if (!sessionId) {
      throw new ExtensionError(
        ErrorCode.SESSION_NOT_FOUND,
        'No active session available for device emulation',
        true,
      );
    }

    if (!tabId) {
      throw new ExtensionError(
        ErrorCode.TAB_NOT_FOUND,
        'No target tab is available for device emulation',
        true,
      );
    }

    const startedAt = Date.now();
    const applied = await this.deviceEmulationManager.applyAction(sessionId, tabId, action);
    return {
      actionId: action.id,
      success: true,
      duration: Date.now() - startedAt,
      data: applied,
    };
  }

  private async executeGeolocationMockAction(
    action: Extract<Action, { type: 'mockGeolocation' }>,
    sessionId: string | undefined,
    tabId: number | null,
  ): Promise<ActionResult> {
    if (!sessionId) {
      throw new ExtensionError(
        ErrorCode.SESSION_NOT_FOUND,
        'No active session available for geolocation mocking',
        true,
      );
    }

    if (!tabId) {
      throw new ExtensionError(
        ErrorCode.TAB_NOT_FOUND,
        'No target tab is available for geolocation mocking',
        true,
      );
    }

    const startedAt = Date.now();
    const applied = await this.geolocationMockManager.applyAction(sessionId, tabId, action);
    return {
      actionId: action.id,
      success: true,
      duration: Date.now() - startedAt,
      data: applied,
    };
  }

  private async executeSavePdfAction(
    action: Extract<Action, { type: 'savePdf' }>,
    tabId: number | null,
  ): Promise<ActionResult> {
    if (!tabId) {
      throw new ExtensionError(
        ErrorCode.TAB_NOT_FOUND,
        'No active tab available for PDF generation',
        true,
      );
    }

    const startedAt = Date.now();
    const debugger_ = new DebuggerAdapter(this.tabManager);

    try {
      const pdfParams: PrintToPDFParams = {};
      if (action.landscape !== undefined) pdfParams.landscape = action.landscape;
      if (action.printBackground !== undefined) pdfParams.printBackground = action.printBackground;
      if (action.scale !== undefined) pdfParams.scale = action.scale;
      if (action.paperWidth !== undefined) pdfParams.paperWidth = action.paperWidth;
      if (action.paperHeight !== undefined) pdfParams.paperHeight = action.paperHeight;
      if (action.marginTop !== undefined) pdfParams.marginTop = action.marginTop;
      if (action.marginRight !== undefined) pdfParams.marginRight = action.marginRight;
      if (action.marginBottom !== undefined) pdfParams.marginBottom = action.marginBottom;
      if (action.marginLeft !== undefined) pdfParams.marginLeft = action.marginLeft;
      if (action.pageRanges !== undefined) pdfParams.pageRanges = action.pageRanges;
      if (action.headerTemplate !== undefined) pdfParams.headerTemplate = action.headerTemplate;
      if (action.footerTemplate !== undefined) pdfParams.footerTemplate = action.footerTemplate;
      if (action.displayHeaderFooter !== undefined)
        pdfParams.displayHeaderFooter = action.displayHeaderFooter;
      if (action.preferCSSPageSize !== undefined)
        pdfParams.preferCSSPageSize = action.preferCSSPageSize;

      const base64Data = await debugger_.printToPDF(tabId, pdfParams);
      const dataUrl = `data:application/pdf;base64,${base64Data}`;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = action.filename ?? `page-${timestamp}.pdf`;

      const downloadId = await chrome.downloads.download({
        url: dataUrl,
        filename,
        saveAs: false,
      });

      return {
        actionId: action.id,
        success: true,
        duration: Date.now() - startedAt,
        data: { downloadId, filename },
      };
    } finally {
      await debugger_.detach(tabId).catch(() => {});
    }
  }

  private async executePressAction(
    action: Extract<Action, { type: 'press' }>,
    sessionId: string | undefined,
    tabId: number | null,
  ): Promise<ActionResult> {
    const resolvedTabId = tabId ?? (await this.getActiveTabId());
    const startedAt = Date.now();

    if (action.selector) {
      const focusResult = await this.executeDomAction(
        {
          id: `${action.id}-focus`,
          type: 'focus',
          selector: action.selector,
        },
        sessionId,
        resolvedTabId,
      );

      if (!focusResult.success) {
        throw new ExtensionError(
          ErrorCode.ELEMENT_NOT_INTERACTIVE,
          focusResult.error?.message ?? 'Unable to focus the target before key input',
          true,
        );
      }
    }

    try {
      await this.dispatchKeyPressSequence(resolvedTabId, [action.key]);
      return {
        actionId: action.id,
        success: true,
        duration: Date.now() - startedAt,
        data: { key: action.key },
      };
    } finally {
      await this.debuggerAdapter.detach(resolvedTabId).catch(() => {});
    }
  }

  private async executeHotkeyAction(
    action: Extract<Action, { type: 'hotkey' }>,
    tabId: number | null,
  ): Promise<ActionResult> {
    const resolvedTabId = tabId ?? (await this.getActiveTabId());
    const startedAt = Date.now();

    try {
      await this.dispatchKeyPressSequence(resolvedTabId, action.keys);
      return {
        actionId: action.id,
        success: true,
        duration: Date.now() - startedAt,
        data: { keys: action.keys },
      };
    } finally {
      await this.debuggerAdapter.detach(resolvedTabId).catch(() => {});
    }
  }

  private async executeEvaluateAction(
    action: Extract<Action, { type: 'evaluate' }>,
    sessionId: string | undefined,
    tabId: number | null,
  ): Promise<ActionResult> {
    const runtimeState = await this.loadRuntimeState();
    if (!isEvaluateEnabled(runtimeState.settings)) {
      throw new ExtensionError(
        ErrorCode.SCRIPT_BLOCKED,
        'Advanced mode and custom scripts must both be enabled before running evaluate.',
        true,
      );
    }

    const resolvedTabId = tabId ?? (await this.getActiveTabId());
    const startedAt = Date.now();
    const expression = this.buildEvaluateExpression(action.script, action.args ?? []);
    const evaluation = await this.debuggerAdapter.evaluate(resolvedTabId, expression, {
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
      silent: true,
    });

    if (evaluation.exceptionDetails) {
      throw new ExtensionError(
        ErrorCode.ACTION_FAILED,
        'Evaluate action failed to complete.',
        true,
        evaluation.exceptionDetails,
      );
    }

    const data = this.normalizeEvaluateResult(this.extractEvaluateValue(evaluation.result));
    this.logger.warn('High-risk evaluate action executed', {
      sessionId: sessionId ?? null,
      actionId: action.id,
    });

    return {
      actionId: action.id,
      success: true,
      duration: Date.now() - startedAt,
      data,
    };
  }

  private async dispatchKeyPressSequence(tabId: number, keys: string[]): Promise<void> {
    if (keys.length === 0) {
      throw new ExtensionError(
        ErrorCode.ACTION_INVALID,
        'Keyboard action requires at least one key',
        true,
      );
    }

    const normalizedKeys = keys.map((key) => this.normalizeKeyboardKey(key));
    const modifiers = normalizedKeys.filter((key) => key.modifierBit !== undefined);
    const primary = normalizedKeys[normalizedKeys.length - 1];
    let modifierMask = 0;

    for (const modifier of modifiers.slice(0, Math.max(0, normalizedKeys.length - 1))) {
      modifierMask |= modifier.modifierBit ?? 0;
      await this.debuggerAdapter.dispatchKeyEvent(tabId, {
        type: 'rawKeyDown',
        key: modifier.key,
        code: modifier.code,
        windowsVirtualKeyCode: modifier.windowsVirtualKeyCode,
        nativeVirtualKeyCode: modifier.windowsVirtualKeyCode,
        modifiers: modifierMask,
      });
    }

    await this.debuggerAdapter.dispatchKeyEvent(tabId, {
      type: primary.text ? 'keyDown' : 'rawKeyDown',
      key: primary.key,
      code: primary.code,
      text: primary.text,
      unmodifiedText: primary.text,
      windowsVirtualKeyCode: primary.windowsVirtualKeyCode,
      nativeVirtualKeyCode: primary.windowsVirtualKeyCode,
      modifiers: modifierMask,
    });

    if (primary.text) {
      await this.debuggerAdapter.dispatchKeyEvent(tabId, {
        type: 'char',
        key: primary.key,
        code: primary.code,
        text: primary.text,
        unmodifiedText: primary.text,
        windowsVirtualKeyCode: primary.windowsVirtualKeyCode,
        nativeVirtualKeyCode: primary.windowsVirtualKeyCode,
        modifiers: modifierMask,
      });
    }

    await this.debuggerAdapter.dispatchKeyEvent(tabId, {
      type: 'keyUp',
      key: primary.key,
      code: primary.code,
      windowsVirtualKeyCode: primary.windowsVirtualKeyCode,
      nativeVirtualKeyCode: primary.windowsVirtualKeyCode,
      modifiers: modifierMask,
    });

    for (const modifier of modifiers.slice(0, Math.max(0, normalizedKeys.length - 1)).reverse()) {
      await this.debuggerAdapter.dispatchKeyEvent(tabId, {
        type: 'keyUp',
        key: modifier.key,
        code: modifier.code,
        windowsVirtualKeyCode: modifier.windowsVirtualKeyCode,
        nativeVirtualKeyCode: modifier.windowsVirtualKeyCode,
        modifiers: modifierMask,
      });
      modifierMask &= ~(modifier.modifierBit ?? 0);
    }
  }

  private normalizeKeyboardKey(key: string): {
    key: string;
    code: string;
    text?: string;
    windowsVirtualKeyCode: number;
    modifierBit?: number;
  } {
    const normalized = key.trim();
    const lower = normalized.toLowerCase();

    switch (lower) {
      case 'control':
      case 'ctrl':
        return { key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifierBit: 2 };
      case 'shift':
        return { key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, modifierBit: 8 };
      case 'alt':
      case 'option':
        return { key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifierBit: 1 };
      case 'meta':
      case 'cmd':
      case 'command':
        return { key: 'Meta', code: 'MetaLeft', windowsVirtualKeyCode: 91, modifierBit: 4 };
      case 'enter':
        return { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 };
      case 'tab':
        return { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 };
      case 'escape':
      case 'esc':
        return { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 };
      case 'space':
        return { key: ' ', code: 'Space', text: ' ', windowsVirtualKeyCode: 32 };
      case 'backspace':
        return { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 };
      case 'delete':
        return { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 };
      default:
        if (normalized.length === 1) {
          const text = normalized;
          return {
            key: text,
            code: `Key${text.toUpperCase()}`,
            text,
            windowsVirtualKeyCode: text.toUpperCase().charCodeAt(0),
          };
        }

        return {
          key: normalized,
          code: normalized,
          windowsVirtualKeyCode: normalized.charCodeAt(0),
        };
    }
  }

  private buildEvaluateExpression(script: string, args: unknown[]): string {
    return `(() => {
      const __fluxArgs = ${JSON.stringify(args)};
      const __fluxUserScript = async (...args) => {
${script}
      };
      return __fluxUserScript(...__fluxArgs);
    })()`;
  }

  private extractEvaluateValue(result: Record<string, unknown>): unknown {
    if ('value' in result) {
      return result.value;
    }

    if ('unserializableValue' in result) {
      return result.unserializableValue;
    }

    if ('description' in result) {
      return result.description;
    }

    return null;
  }

  private normalizeEvaluateResult(value: unknown): unknown {
    const safeValue = JSON.parse(
      JSON.stringify(value ?? null, (_key, currentValue: unknown) => {
        if (typeof currentValue === 'bigint') {
          return currentValue.toString();
        }

        if (currentValue instanceof Error) {
          return { message: currentValue.message };
        }

        return currentValue;
      }),
    ) as unknown;
    const serialized = JSON.stringify(safeValue);

    if (serialized && serialized.length > EVALUATE_RESULT_MAX_CHARS) {
      return {
        truncated: true,
        preview: serialized.slice(0, EVALUATE_RESULT_MAX_CHARS),
        size: serialized.length,
      };
    }

    return safeValue;
  }
  private async executeNavigateAction(
    action: Extract<Action, { type: 'navigate' }>,
    tabId: number | null,
  ): Promise<ActionResult> {
    if (!tabId) {
      throw new ExtensionError(
        ErrorCode.TAB_NOT_FOUND,
        'No active tab available for navigation',
        true,
      );
    }

    const startedAt = Date.now();
    await chrome.tabs.update(tabId, { url: action.url });
    await this.waitForTabReady(
      tabId,
      action.waitUntil ?? 'load',
      action.timeout ?? DEFAULT_RUNTIME_SETTINGS.defaultTimeout,
    );
    return {
      actionId: action.id,
      success: true,
      duration: Date.now() - startedAt,
      data: { url: action.url, tabId },
    };
  }

  private async executeHistoryAction(
    action: Extract<Action, { type: 'goBack' | 'goForward' }>,
    tabId: number | null,
    direction: 'back' | 'forward',
  ): Promise<ActionResult> {
    if (!tabId) {
      throw new ExtensionError(
        ErrorCode.TAB_NOT_FOUND,
        'No active tab available for history navigation',
        true,
      );
    }

    const startedAt = Date.now();
    if (direction === 'back' && typeof chrome.tabs.goBack === 'function') {
      await chrome.tabs.goBack(tabId);
    } else if (direction === 'forward' && typeof chrome.tabs.goForward === 'function') {
      await chrome.tabs.goForward(tabId);
    } else {
      throw new ExtensionError(
        ErrorCode.NAVIGATION_FAILED,
        `Browser history ${direction} is not supported in this environment`,
        false,
      );
    }

    return {
      actionId: action.id,
      success: true,
      duration: Date.now() - startedAt,
    };
  }

  private async executeReloadAction(
    action: Extract<Action, { type: 'reload' }>,
    tabId: number | null,
  ): Promise<ActionResult> {
    if (!tabId) {
      throw new ExtensionError(ErrorCode.TAB_NOT_FOUND, 'No active tab available for reload', true);
    }

    const startedAt = Date.now();
    await chrome.tabs.reload(tabId, { bypassCache: action.hardReload === true });
    return {
      actionId: action.id,
      success: true,
      duration: Date.now() - startedAt,
    };
  }

  private async waitForTabReady(
    tabId: number,
    waitUntil: 'load' | 'domContentLoaded' | 'networkIdle',
    timeoutMs: number,
  ): Promise<void> {
    const navigationApi = chrome.webNavigation;
    const tabsApi = chrome.tabs;

    const currentTab = await this.safeGetTab(tabId);
    if (this.isTabReadyForWaitUntil(currentTab, waitUntil)) {
      if (waitUntil === 'networkIdle') {
        await this.delay(300);
      }
      return;
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

      const finish = (callback: () => void): void => {
        if (settled) {
          return;
        }

        settled = true;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }

        tabsApi.onUpdated.removeListener(handleTabUpdated);
        tabsApi.onRemoved.removeListener(handleTabRemoved);

        // Chrome webNavigation event types have a known @types/chrome mismatch
        // between addListener(cb, filter?) and removeListener(cb). The runtime
        // behaviour is identical — removeListener accepts the same callback ref.
        // We work around it by extracting the concrete listener type.
        type DomContentLoadedListener = Parameters<
          typeof chrome.webNavigation.onDOMContentLoaded.removeListener
        >[0];
        type CompletedListener = Parameters<
          typeof chrome.webNavigation.onCompleted.removeListener
        >[0];
        type ErrorOccurredListener = Parameters<
          typeof chrome.webNavigation.onErrorOccurred.removeListener
        >[0];

        navigationApi?.onDOMContentLoaded.removeListener(
          handleDomContentLoaded as unknown as DomContentLoadedListener,
        );
        navigationApi?.onCompleted.removeListener(
          handleNavigationCompleted as unknown as CompletedListener,
        );
        navigationApi?.onErrorOccurred.removeListener(
          handleNavigationError as unknown as ErrorOccurredListener,
        );
        callback();
      };

      const resolveReady = (): void => {
        if (waitUntil === 'networkIdle') {
          void this.delay(300).then(() => finish(resolve), reject);
          return;
        }

        finish(resolve);
      };

      const handleTabUpdated: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] = (
        updatedTabId,
        changeInfo,
        tab,
      ) => {
        if (updatedTabId !== tabId) {
          return;
        }

        if (this.isTabReadyForWaitUntil(tab, waitUntil) || changeInfo.status === 'complete') {
          resolveReady();
        }
      };

      const handleTabRemoved: Parameters<typeof chrome.tabs.onRemoved.addListener>[0] = (
        removedTabId,
      ) => {
        if (removedTabId !== tabId) {
          return;
        }

        finish(() => {
          reject(
            new ExtensionError(
              ErrorCode.TAB_CLOSED,
              `Tab ${tabId} was closed during navigation`,
              true,
            ),
          );
        });
      };

      const handleDomContentLoaded: Parameters<
        typeof chrome.webNavigation.onDOMContentLoaded.addListener
      >[0] = (details) => {
        if (details.tabId !== tabId || details.frameId !== 0) {
          return;
        }

        if (waitUntil === 'domContentLoaded') {
          resolveReady();
        }
      };

      const handleNavigationCompleted: Parameters<
        typeof chrome.webNavigation.onCompleted.addListener
      >[0] = (details) => {
        if (details.tabId !== tabId || details.frameId !== 0) {
          return;
        }

        resolveReady();
      };

      const handleNavigationError: Parameters<
        typeof chrome.webNavigation.onErrorOccurred.addListener
      >[0] = (details) => {
        if (details.tabId !== tabId || details.frameId !== 0) {
          return;
        }

        finish(() => {
          reject(new ExtensionError(ErrorCode.NAVIGATION_FAILED, details.error, true));
        });
      };

      tabsApi.onUpdated.addListener(handleTabUpdated);
      tabsApi.onRemoved.addListener(handleTabRemoved);
      navigationApi?.onDOMContentLoaded.addListener(handleDomContentLoaded);
      navigationApi?.onCompleted.addListener(handleNavigationCompleted);
      navigationApi?.onErrorOccurred.addListener(handleNavigationError);

      timeoutHandle = setTimeout(() => {
        finish(() => {
          reject(
            new ExtensionError(
              ErrorCode.NAVIGATION_FAILED,
              `Timed out waiting for tab ${tabId} to reach ${waitUntil}`,
              true,
            ),
          );
        });
      }, timeoutMs);

      void this.safeGetTab(tabId)
        .then((tab) => {
          if (this.isTabReadyForWaitUntil(tab, waitUntil)) {
            resolveReady();
          }
        })
        .catch((error) => {
          finish(() => {
            reject(error);
          });
        });
    });
  }

  private isTabReadyForWaitUntil(
    tab: chrome.tabs.Tab | null,
    waitUntil: 'load' | 'domContentLoaded' | 'networkIdle',
  ): boolean {
    return Boolean(tab && waitUntil !== 'domContentLoaded' && tab.status === 'complete');
  }

  private async safeGetTab(tabId: number): Promise<chrome.tabs.Tab | null> {
    try {
      return await chrome.tabs.get(tabId);
    } catch (error) {
      if (ExtensionError.isExtensionError(error)) {
        throw error;
      }

      throw new ExtensionError(
        ErrorCode.TAB_NOT_FOUND,
        `Tab ${tabId} was not found while waiting for navigation`,
        true,
      );
    }
  }

  private async executeNewTabAction(
    action: Extract<Action, { type: 'newTab' }>,
    sessionId?: string,
  ): Promise<ActionResult> {
    const startedAt = Date.now();
    const tab = await this.tabManager.createTab(action.url, action.active ?? true);
    if (action.url) {
      await this.waitForTabReady(
        tab.id,
        'load',
        action.timeout ?? DEFAULT_RUNTIME_SETTINGS.defaultTimeout,
      );
    }

    const resolvedTab = await this.safeGetTab(tab.id);
    const session = sessionId ? this.sessionManager.getSession(sessionId) : null;
    if (session) {
      await this.setSessionTargetTab(session, tab.id);
      await this.syncSessionTabState(session.config.id);
    }

    return {
      actionId: action.id,
      success: true,
      duration: Date.now() - startedAt,
      data: { tabId: tab.id, url: resolvedTab?.url ?? tab.url },
    };
  }

  private async executeSwitchTabAction(
    action: Extract<Action, { type: 'switchTab' }>,
    sessionId?: string,
  ): Promise<ActionResult> {
    const startedAt = Date.now();
    const session = this.requireSessionForSnapshotAction(sessionId, action.type);
    const targetTab = await this.resolveTabFromPlannedSnapshot(session, action.tabIndex);

    await this.tabManager.switchTab(targetTab.id);
    await this.setSessionTargetTab(session, targetTab.id);
    await this.syncSessionTabState(session.config.id);

    return {
      actionId: action.id,
      success: true,
      duration: Date.now() - startedAt,
      data: { tabId: targetTab.id, url: targetTab.url },
    };
  }

  private async executeCloseTabAction(
    action: Extract<Action, { type: 'closeTab' }>,
    sessionId?: string,
  ): Promise<ActionResult> {
    const startedAt = Date.now();
    const session = sessionId ? this.sessionManager.getSession(sessionId) : null;

    if (typeof action.tabIndex === 'number') {
      const resolvedSession = this.requireSessionForSnapshotAction(sessionId, action.type);
      const targetTab = await this.resolveTabFromPlannedSnapshot(resolvedSession, action.tabIndex);
      const tabs = await this.listOrderedTabs();

      await this.tabManager.closeTab(targetTab.id);
      if (resolvedSession.targetTabId === targetTab.id) {
        const remainingTabId = this.resolveNextSessionTabId(tabs, targetTab.id);
        await this.setSessionTargetTab(resolvedSession, remainingTabId);
      }
    } else if (session?.targetTabId) {
      const tabs = await this.listOrderedTabs();
      await this.tabManager.closeTab(session.targetTabId);
      const remainingTabId = this.resolveNextSessionTabId(tabs, session.targetTabId);
      await this.setSessionTargetTab(session, remainingTabId);
    } else {
      await this.tabManager.closeTab();
    }

    if (session) {
      session.lastActivityAt = Date.now();
      await this.syncSessionTabState(session.config.id);
    }

    return {
      actionId: action.id,
      success: true,
      duration: Date.now() - startedAt,
    };
  }

  private resolveNextSessionTabId(tabs: TabState[], closedTabId: number): number | null {
    const remainingTabs = tabs.filter((tab) => tab.id !== closedTabId);
    if (remainingTabs.length === 0) {
      return null;
    }

    const activeTab = remainingTabs.find((tab) => tab.isActive);
    if (activeTab) {
      return activeTab.id;
    }

    const closedTabIndex = tabs.findIndex((tab) => tab.id === closedTabId);
    const nextTab =
      remainingTabs[closedTabIndex] ?? remainingTabs[closedTabIndex - 1] ?? remainingTabs[0];

    return nextTab.id;
  }

  private async listOrderedTabs(): Promise<TabState[]> {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    return tabs
      .filter((tab) => tab.id !== undefined)
      .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
      .map((tab) => this.tabManager.mapChromeTab(tab));
  }

  private requireSessionForSnapshotAction(
    sessionId: string | undefined,
    actionType: 'switchTab' | 'closeTab',
  ): Session {
    if (!sessionId) {
      throw new ExtensionError(
        ErrorCode.SESSION_NOT_FOUND,
        `${actionType} requires an active session snapshot`,
        true,
      );
    }

    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      throw new ExtensionError(
        ErrorCode.SESSION_NOT_FOUND,
        `Session "${sessionId}" was not found for ${actionType}`,
        true,
      );
    }

    return session;
  }

  private async resolveTabFromPlannedSnapshot(
    session: Session,
    tabIndex: number,
  ): Promise<TabState> {
    const snapshot = this.plannedTabSnapshots.get(session.config.id) ?? session.tabSnapshot;
    const plannedTab = snapshot.find((tab) => tab.tabIndex === tabIndex);
    if (!plannedTab) {
      throw new ExtensionError(
        ErrorCode.TAB_NOT_FOUND,
        `No tab exists at snapshot index ${tabIndex}`,
        true,
      );
    }

    try {
      return await this.tabManager.getTab(plannedTab.id);
    } catch (error) {
      if (ExtensionError.isExtensionError(error)) {
        throw new ExtensionError(
          ErrorCode.TAB_NOT_FOUND,
          `Tab at snapshot index ${tabIndex} is no longer available`,
          true,
        );
      }

      throw error;
    }
  }

  private async syncSessionTabState(sessionId: string): Promise<void> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return;
    }

    try {
      const tabs = await this.listOrderedTabs();
      const targetTabId = this.resolveSynchronizedTargetTabId(tabs, session.targetTabId);
      if (targetTabId !== session.targetTabId) {
        await this.setSessionTargetTab(session, targetTabId);
      }

      session.tabSnapshot = tabs.map(
        (tab, tabIndex): SessionTabSummary => ({
          tabIndex,
          id: tab.id,
          url: tab.url,
          title: tab.title,
          status: tab.status,
          isActive: tab.isActive,
          isTarget: tab.id === session.targetTabId,
        }),
      );
    } catch (error) {
      this.logger.debug(`Unable to synchronize tab state for session ${sessionId}`, error);
    }
  }

  private resolveSynchronizedTargetTabId(
    tabs: TabState[],
    targetTabId: number | null,
  ): number | null {
    if (tabs.length === 0) {
      return null;
    }

    if (targetTabId !== null && tabs.some((tab) => tab.id === targetTabId)) {
      return targetTabId;
    }

    return tabs.find((tab) => tab.isActive)?.id ?? tabs[0].id;
  }

  private async setSessionTargetTab(session: Session, nextTabId: number | null): Promise<void> {
    if (session.targetTabId === nextTabId) {
      return;
    }

    if (session.targetTabId !== null) {
      await this.networkInterceptionManager.clearSession(session.config.id);
      await this.deviceEmulationManager.clearSession(session.config.id);
      await this.geolocationMockManager.clearSession(session.config.id);
    }

    session.targetTabId = nextTabId;
    session.lastActivityAt = Date.now();
    this.networkInterceptionManager.activateSession(session.config.id, nextTabId);
    this.deviceEmulationManager.activateSession(session.config.id, nextTabId);
    this.geolocationMockManager.activateSession(session.config.id, nextTabId);
  }

  private mapBridgeResult(
    action: Action,
    payload: ActionResultPayload | ActionResult | { result?: ActionResult },
  ): ActionResult {
    if ('result' in payload && payload.result) {
      return payload.result;
    }

    const error = 'error' in payload ? payload.error : undefined;

    return {
      actionId: ('actionId' in payload ? payload.actionId : undefined) ?? action.id,
      success: ('success' in payload ? payload.success : undefined) ?? false,
      data: 'data' in payload ? payload.data : undefined,
      duration: ('duration' in payload ? payload.duration : undefined) ?? 0,
      error: error
        ? {
            code: error.code,
            message: error.message,
            recoverable:
              'recoverable' in error && typeof error.recoverable === 'boolean'
                ? error.recoverable
                : error.code !== ErrorCode.ABORTED,
          }
        : undefined,
    };
  }

  private resolveProviderConfig(
    provider: SessionConfig['provider'],
    runtimeState: RuntimeState,
  ): ProviderConfig {
    return this.enforceProviderEndpointPolicy(
      provider,
      {
      ...DEFAULT_PROVIDER_CONFIG[provider],
      ...(runtimeState.providers[provider] ?? {}),
      },
      true,
    );
  }

  private enforceProviderEndpointPolicy(
    provider: SessionConfig['provider'],
    config: ProviderConfig,
    allowEmpty = false,
  ): ProviderConfig {
    const providerDefinition = PROVIDER_LOOKUP[provider];
    if (!providerDefinition.supportsEndpoint) {
      return config;
    }

    if (allowEmpty && !config.customEndpoint?.trim()) {
      return {
        ...config,
        customEndpoint: undefined,
      };
    }

    const endpointPolicy = evaluateProviderEndpointPolicy(provider, config.customEndpoint);
    if (!endpointPolicy.valid) {
      throw new ExtensionError(
        ErrorCode.AI_INVALID_KEY,
        endpointPolicy.errorMessage ?? 'Provider endpoint is invalid.',
        true,
      );
    }

    return normalizeProviderEndpointConfig(provider, config);
  }

  private providerConfigsEqual(left: ProviderConfig, right: ProviderConfig): boolean {
    const normalizeHeaders = (headers: ProviderConfig['customHeaders']): string =>
      JSON.stringify(
        Object.entries(headers ?? {}).sort(([leftKey], [rightKey]) =>
          leftKey.localeCompare(rightKey),
        ),
      );

    return (
      left.enabled === right.enabled &&
      left.model === right.model &&
      left.maxTokens === right.maxTokens &&
      left.temperature === right.temperature &&
      (left.customEndpoint ?? '') === (right.customEndpoint ?? '') &&
      normalizeHeaders(left.customHeaders) === normalizeHeaders(right.customHeaders)
    );
  }

  private async resolveProviderCredential(
    provider: SessionConfig['provider'],
    runtimeState: RuntimeState,
  ): Promise<string | undefined> {
    const providerDefinition = PROVIDER_LOOKUP[provider];
    if (!providerDefinition.requiresCredential) {
      return undefined;
    }

    if (runtimeState.vault.lockState !== 'unlocked') {
      throw new ExtensionError(
        ErrorCode.AI_INVALID_KEY,
        `Vault is ${runtimeState.vault.lockState}. Unlock it before using ${providerDefinition.label}.`,
        true,
      );
    }

    if (provider === 'codex') {
      const activeAccountId = runtimeState.vault.activeAccounts.codex;
      if (!activeAccountId) {
        throw new ExtensionError(
          ErrorCode.AI_INVALID_KEY,
          'No active Codex account is selected. Import an official auth artifact and activate the account before chatting.',
          false,
        );
      }

      const runtimeSession =
        await this.codexAccountSessionManager.getRuntimeSessionMaterial(activeAccountId);
      return runtimeSession.accessToken;
    }

    const credential = await this.credentialVault.getCredential(provider);
    if (!credential) {
      throw new ExtensionError(
        ErrorCode.AI_INVALID_KEY,
        `No credential is stored for ${providerDefinition.label}.`,
        true,
      );
    }

    return credential;
  }

  private applyDefaultRetries(action: Action, settings: ExtensionSettings): Action {
    if (action.retries !== undefined || !settings.autoRetryOnFailure) {
      return action;
    }

    return {
      ...action,
      retries: settings.maxRetries,
    };
  }

  private storeActionResult(sessionId: string, action: Action, result: ActionResult): void {
    this.sessionManager.pushActionRecord(sessionId, {
      action,
      result,
      timestamp: Date.now(),
      ...getActionRiskMetadata(action),
    });

    if (!result.success) {
      return;
    }

    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return;
    }

    if (
      'outputVariable' in action &&
      typeof action.outputVariable === 'string' &&
      action.outputVariable.length > 0
    ) {
      session.variables[action.outputVariable] = result.data ?? null;
    }
  }

  private setSessionStatus(sessionId: string, status: Session['status']): void {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return;
    }

    session.status = status;
    session.lastActivityAt = Date.now();
  }

  private recordSessionError(sessionId: string, message: string): void {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return;
    }

    session.status = 'error';
    session.errorCount += 1;
    session.lastActivityAt = Date.now();
    session.lastError = {
      message,
      timestamp: Date.now(),
    };
  }

  private buildAssistantDisplayMessage(parsed: ParsedResponse): string {
    if (parsed.needsMoreInfo?.question) {
      return parsed.needsMoreInfo.question;
    }

    if (parsed.summary?.trim()) {
      return parsed.summary.trim();
    }

    if (parsed.actions.length === 0) {
      return 'The AI plan did not contain executable actions.';
    }

    return parsed.actions
      .map(
        (action, index) =>
          `${index + 1}. ${action.description?.trim() || this.buildActionTitle(action)}`,
      )
      .join('\n');
  }

  private buildActionTitle(action: Action): string {
    return action.description?.trim() || `Execute ${action.type}`;
  }

  private buildActionRunningDetail(action: Action): string {
    if ('selector' in action && action.selector) {
      return `Targeting ${this.formatSelector(action.selector)} before execution.`;
    }

    switch (action.type) {
      case 'navigate':
      case 'newTab':
        return `Opening ${action.url ?? 'a new page'} in the target tab.`;
      case 'switchTab':
        return `Switching to tab index ${action.tabIndex}.`;
      case 'closeTab':
        return typeof action.tabIndex === 'number'
          ? `Closing tab index ${action.tabIndex}.`
          : 'Closing the active session tab.';
      case 'emulateDevice':
        return `Applying the ${action.preset} device preset in ${action.orientation ?? 'portrait'} mode.`;
      case 'mockGeolocation':
        return `Mocking geolocation to latitude ${action.latitude}, longitude ${action.longitude}${typeof action.accuracy === 'number' ? ` with ${action.accuracy}m accuracy` : ''}.`;
      case 'uploadFile':
        return `Uploading ${action.fileIds.length} staged file(s) into the selected file input.`;
      case 'interceptNetwork':
        return `Intercepting matching requests (${action.operation}) for ${action.urlPatterns.join(', ')}.`;
      case 'mockResponse':
        return `Mocking matching requests for ${action.urlPatterns.join(', ')}.`;
      case 'savePdf':
        return `Generating PDF${action.filename ? ` as ${action.filename}` : ''} and downloading.`;
      default:
        return `Running ${action.type}.`;
    }
  }

  private buildActionCompletedDetail(action: Action, result: ActionResult): string {
    if (result.data !== undefined && result.data !== null) {
      return `Completed ${action.type} successfully.`;
    }

    return `Completed ${action.type} in ${result.duration}ms.`;
  }

  private buildActionFailureDetail(action: Action, result: ActionResult): string {
    return result.error?.message ?? `Action ${action.type} failed.`;
  }

  private formatSelector(selector: ElementSelector): string {
    if (selector.testId) {
      return `[data-testid="${selector.testId}"]`;
    }
    if (selector.ariaLabel) {
      return `[aria-label="${selector.ariaLabel}"]`;
    }
    if (selector.role && selector.textExact) {
      return `${selector.role} "${selector.textExact}"`;
    }
    if (selector.textExact) {
      return `text "${selector.textExact}"`;
    }
    if (selector.text) {
      return `text containing "${selector.text}"`;
    }
    if (selector.placeholder) {
      return `placeholder "${selector.placeholder}"`;
    }
    if (selector.css) {
      return selector.css;
    }
    if (selector.xpath) {
      return `xpath ${selector.xpath}`;
    }
    return 'the resolved target element';
  }

  private async highlightTarget(tabId: number, selector: ElementSelector): Promise<void> {
    try {
      const target = this.resolveFrameTarget(tabId, selector);
      await this.bridge.ensureContentScript(tabId, target);
      this.bridge.sendOneWay(tabId, 'HIGHLIGHT_ELEMENT', { selector, duration: 2500 }, target);
    } catch (error) {
      this.logger.warn(`Failed to highlight target in tab ${tabId}`, error);
    }
  }

  private async clearHighlights(sessionId: string): Promise<void> {
    const session = this.sessionManager.getSession(sessionId);
    if (session?.targetTabId === null || session?.targetTabId === undefined) {
      return;
    }

    try {
      await this.bridge.ensureContentScript(session.targetTabId, { frameId: 0 });
      this.bridge.sendOneWay(session.targetTabId, 'CLEAR_HIGHLIGHTS', undefined, { frameId: 0 });
    } catch (error) {
      this.logger.debug(`Failed to clear highlights for session ${sessionId}`, error);
    }
  }

  private abortStream(sessionId: string): void {
    const controller = this.streamControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.streamControllers.delete(sessionId);
    }

    this.aiClientManager.abort?.();
  }

  private clearLatestActionEntry(sessionId: string): void {
    this.latestActionEntries.delete(sessionId);
  }

  private cloneSession(session: Session): Session {
    return JSON.parse(JSON.stringify(session)) as Session;
  }

  private delay(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, timeoutMs);
    });
  }
}

export function formatActionTimeLabel(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function mapActionStatusToBubbleStatus(
  status: ActionLogEventStatus,
): 'running' | 'completed' | 'failed' {
  if (status === 'done') {
    return 'completed';
  }

  if (status === 'failed') {
    return 'failed';
  }

  return 'running';
}
