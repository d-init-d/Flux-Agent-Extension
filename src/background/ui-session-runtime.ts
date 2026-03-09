import { SessionManager } from '@core/session';
import type { IServiceWorkerBridge } from '@core/bridge';
import {
  AIClientManager,
  ClaudeProvider,
  GeminiProvider,
  getSystemPrompt,
  OllamaProvider,
  OpenAIProvider,
  OpenRouterProvider,
} from '@core/ai-client';
import type { IAIClientManager } from '@core/ai-client';
import { CommandParser } from '@core/command-parser';
import type { ParserConfig } from '@core/command-parser';
import { ActionOrchestrator } from '@core/orchestrator';
import { TabManager, DebuggerAdapter } from '@core/browser-controller';
import type { PrintToPDFParams } from '@core/browser-controller';
import { ErrorCode, ExtensionError } from '@shared/errors';
import type {
  Action,
  ActionLogEventEntry,
  ActionLogEventStatus,
  ActionResult,
  AIMessage,
  ActionProgressEventPayload,
  ActionResultPayload,
  AIStreamEventPayload,
  BridgeFrameContext,
    BridgeSendTarget,
    ClickAction,
    ElementSelector,
    ExecuteActionPayload,
    ExtensionSettings,
    FillAction,
    NavigateAction,
    ExtensionMessage,
    ExtensionResponse,
  FileUploadMetadata,
  FrameContextSummary,
  GetPageContextPayload,
  PageContext,
  PageContextPayload,
    ParsedResponse,
    RequestPayloadMap,
    RecordedClickPayload,
    RecordedInputPayload,
    RecordedNavigationPayload,
  ResponsePayloadMap,
  Session,
  SessionConfig,
  SessionPlaybackSpeed,
  SetRecordingStatePayload,
  SessionTabSummary,
  SessionCreateRequest,
  SessionUpdateEventPayload,
  TabState,
} from '@shared/types';
import { generateId, Logger } from '@shared/utils';
import type { ProviderConfig } from '@shared/types';
import {
  NetworkInterceptionManager,
  type INetworkInterceptionManager,
} from './network-interception-manager';
import {
  DeviceEmulationManager,
  type IDeviceEmulationManager,
} from './device-emulation-manager';
import {
  GeolocationMockManager,
  type IGeolocationMockManager,
} from './geolocation-mock-manager';
import { FileUploadManager, type IFileUploadManager } from './file-upload-manager';

const DEFAULT_PROVIDER_MODELS: Record<SessionConfig['provider'], string> = {
  claude: 'claude-3-5-sonnet-20241022',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash',
  ollama: 'llama3.2',
  openrouter: 'openai/gpt-4o-mini',
  custom: 'custom-model',
};

const STREAM_CHUNK_INTERVAL_MS = 20;
const PLAYBACK_SPEEDS: readonly SessionPlaybackSpeed[] = [0.5, 1, 2];

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

const DEFAULT_PROVIDER_CONFIG: Record<SessionConfig['provider'], ProviderConfig> = {
  claude: { enabled: true, model: DEFAULT_PROVIDER_MODELS.claude, maxTokens: 4096, temperature: 0.2 },
  openai: { enabled: true, model: DEFAULT_PROVIDER_MODELS.openai, maxTokens: 4096, temperature: 0.2 },
  gemini: { enabled: true, model: DEFAULT_PROVIDER_MODELS.gemini, maxTokens: 4096, temperature: 0.2 },
  ollama: { enabled: true, model: DEFAULT_PROVIDER_MODELS.ollama, maxTokens: 4096, temperature: 0.2 },
  openrouter: { enabled: true, model: DEFAULT_PROVIDER_MODELS.openrouter, maxTokens: 4096, temperature: 0.2 },
  custom: { enabled: true, model: DEFAULT_PROVIDER_MODELS.custom, maxTokens: 4096, temperature: 0.2 },
};

type RuntimeHandlerResponse<T extends keyof ResponsePayloadMap> = Promise<ExtensionResponse<ResponsePayloadMap[T]>>;

type AbortableAIClientManager = IAIClientManager & { abort?: () => void };

class CustomOpenAICompatibleProvider extends OpenAIProvider {
  override readonly name = 'custom' as const;
}

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
  private readonly orchestrator: ActionOrchestrator;
  private readonly networkInterceptionManager: INetworkInterceptionManager;
  private readonly deviceEmulationManager: IDeviceEmulationManager;
  private readonly geolocationMockManager: IGeolocationMockManager;
  private readonly fileUploadManager: IFileUploadManager;
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
    this.aiClientManager = options.aiClientManager ?? this.createDefaultAIClientManager();
    this.parserFactory = options.parserFactory;
    this.tabManager = options.tabManager ?? new TabManager();
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
        return this.handleSessionGetState(message.payload as RequestPayloadMap['SESSION_GET_STATE']);
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
      case 'SESSION_START':
        return this.handleSessionStart(message.payload as RequestPayloadMap['SESSION_START']);
      case 'SESSION_PAUSE':
        return this.handleSessionPause(message.payload as RequestPayloadMap['SESSION_PAUSE']);
      case 'SESSION_RESUME':
        return this.handleSessionResume(message.payload as RequestPayloadMap['SESSION_RESUME']);
      case 'SESSION_ABORT':
        return this.handleSessionAbort(message.payload as RequestPayloadMap['SESSION_ABORT']);
      case 'SESSION_SEND_MESSAGE':
        return this.handleSessionSendMessage(message.payload as RequestPayloadMap['SESSION_SEND_MESSAGE']);
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
      throw new ExtensionError(ErrorCode.SESSION_NOT_FOUND, `Session "${payload.sessionId}" was not found`, true);
    }

    if (!session.targetTabId) {
      throw new ExtensionError(ErrorCode.TAB_NOT_FOUND, 'No target tab is available for recording', true);
    }

    if (session.playback.status !== 'idle') {
      throw new ExtensionError(ErrorCode.ACTION_INVALID, 'Stop playback before starting recording', true);
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

    const speed = payload.speed !== undefined
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

    const speed = payload.speed !== undefined
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
    this.sessionManager.setPlaybackSpeed(payload.sessionId, this.normalizePlaybackSpeed(payload.speed));
    await this.broadcastCurrentSession(payload.sessionId, 'updated');
    return { success: true };
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

    const rawSettings = stored.settings as { defaultProvider?: SessionConfig['provider'] } | undefined;
    const rawProviders = stored.providers as Partial<Record<SessionConfig['provider'], Partial<ProviderConfig>>> | undefined;
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

  private async broadcastCurrentSession(sessionId: string, reason: SessionUpdateEventPayload['reason']): Promise<void> {
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
      throw new ExtensionError(ErrorCode.SESSION_NOT_FOUND, `Session "${sessionId}" was not found`, true);
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
      throw new ExtensionError(ErrorCode.SESSION_NOT_FOUND, `Session "${sessionId}" was not found`, true);
    }

    if (session.recording.status !== 'paused') {
      throw new ExtensionError(ErrorCode.ACTION_INVALID, 'Recording is not paused', true);
    }

    if (session.playback.status !== 'idle') {
      throw new ExtensionError(ErrorCode.ACTION_INVALID, 'Stop playback before resuming recording', true);
    }

    if (!session.targetTabId) {
      throw new ExtensionError(ErrorCode.TAB_NOT_FOUND, 'No target tab is available for recording', true);
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

    if (!deduped.has('frame:0') && !Array.from(deduped.values()).some((target) => target.frameId === 0)) {
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
    if (!action || action.type !== 'navigate' || typeof action.url !== 'string' || action.url.length === 0) {
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
    const manager = new AIClientManager();
    manager.registerProvider(new ClaudeProvider());
    manager.registerProvider(new OpenAIProvider());
    manager.registerProvider(new GeminiProvider());
    manager.registerProvider(new OllamaProvider());
    manager.registerProvider(new OpenRouterProvider());
    manager.registerProvider(new CustomOpenAICompatibleProvider());
    return manager;
  }

  private async loadRuntimeState(): Promise<RuntimeState> {
    const stored = await chrome.storage.local.get({
      settings: DEFAULT_RUNTIME_SETTINGS,
      providers: {},
    });

    return {
      settings: {
        ...DEFAULT_RUNTIME_SETTINGS,
        ...(stored.settings as Partial<ExtensionSettings> | undefined),
      },
      providers:
        (stored.providers as Partial<Record<SessionConfig['provider'], Partial<ProviderConfig>>> | undefined) ?? {},
    };
  }

  private createParser(settings: ExtensionSettings): CommandParser {
    if (this.parserFactory) {
      return this.parserFactory({
        strictMode: true,
        allowEvaluate: settings.allowCustomScripts,
        allowedDomains: settings.allowedDomains,
      });
    }

    return new CommandParser({
      strictMode: true,
      allowEvaluate: settings.allowCustomScripts,
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
      throw new ExtensionError(ErrorCode.SESSION_NOT_FOUND, `Session "${sessionId}" was not found`, true);
    }

    const context = await this.sessionManager.buildContext(sessionId);
    this.plannedTabSnapshots.set(
      sessionId,
      session.tabSnapshot.map((tab) => ({ ...tab })),
    );
    const trimmedContext = context.length > maxContextLength ? context.slice(0, maxContextLength) : context;
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
        content: [trimmedContext, availableUploadsBlock, `## User Request\n${prompt.trim()}`]
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
      throw new ExtensionError(ErrorCode.SESSION_NOT_FOUND, `Session "${sessionId}" was not found`, true);
    }

    const providerConfig = this.resolveProviderConfig(session.config.provider, runtimeState);
    await this.aiClientManager.switchProvider(session.config.provider, {
      provider: session.config.provider,
      model: session.config.model,
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
        throw chunk.error ?? new ExtensionError(ErrorCode.AI_API_ERROR, 'AI provider returned an error chunk', true);
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
      await this.executeActionWithProgress(sessionId, actions[index], index + 1, totalSteps, settings);
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
    const runningEntry = await this.createExecutionEntry(sessionId, action, currentStep, totalSteps, 'running');
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

  private resolveFrameTarget(tabId: number, selector?: ElementSelector): BridgeSendTarget | undefined {
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
      const match = frames.find((frame) => this.matchesUrlPattern(frame.url, frameTarget.urlPattern!));
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

        if (sessionAfterAction.playback.status === 'idle' && sessionAfterAction.playback.startedAt === null) {
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

      const nextAction = playbackSession.recording.actions[playbackSession.playback.nextActionIndex];
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

  private assertPlaybackCanStart(session: Session): void {
    if (session.recording.actions.length === 0) {
      throw new ExtensionError(ErrorCode.ACTION_INVALID, 'Playback requires at least one recorded action', true);
    }

    if (!session.targetTabId) {
      throw new ExtensionError(ErrorCode.TAB_NOT_FOUND, 'No target tab is available for playback', true);
    }

    if (session.recording.status !== 'idle') {
      throw new ExtensionError(ErrorCode.ACTION_INVALID, 'Stop recording before starting playback', true);
    }

    if (session.playback.status === 'playing') {
      throw new ExtensionError(ErrorCode.ACTION_INVALID, 'Playback is already running', true);
    }

    if (session.status === 'running') {
      throw new ExtensionError(ErrorCode.ACTION_INVALID, 'Wait for the current automation run to finish before starting playback', true);
    }
  }

  private assertPlaybackCanResume(session: Session): void {
    if (session.recording.actions.length === 0) {
      throw new ExtensionError(ErrorCode.ACTION_INVALID, 'Playback requires at least one recorded action', true);
    }

    if (!session.targetTabId) {
      throw new ExtensionError(ErrorCode.TAB_NOT_FOUND, 'No target tab is available for playback', true);
    }

    if (session.recording.status !== 'idle') {
      throw new ExtensionError(ErrorCode.ACTION_INVALID, 'Stop recording before resuming playback', true);
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
      throw new ExtensionError(ErrorCode.ACTION_INVALID, 'Wait for the current automation run to finish before resuming playback', true);
    }
  }

  private requireSession(sessionId: string): Session {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      throw new ExtensionError(ErrorCode.SESSION_NOT_FOUND, `Session "${sessionId}" was not found`, true);
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

  private async executeDomAction(action: Action, sessionId: string | undefined, tabId: number | null): Promise<ActionResult> {
    if (!sessionId || !tabId) {
      throw new ExtensionError(ErrorCode.TAB_NOT_FOUND, 'No target tab is available for DOM execution', true);
    }

    const target = this.resolveFrameTarget(tabId, 'selector' in action ? action.selector : undefined);
    await this.bridge.ensureContentScript(tabId, target);
    const payload = await this.bridge.send<
      ExecuteActionPayload,
      ActionResultPayload
    >(
      tabId,
      'EXECUTE_ACTION',
      {
        action,
        context: {
          variables: this.sessionManager.getSession(sessionId)?.variables ?? {},
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
      throw new ExtensionError(ErrorCode.TAB_NOT_FOUND, 'No target tab is available for file upload', true);
    }

    const target = this.resolveFrameTarget(tabId, action.selector);
    await this.bridge.ensureContentScript(tabId, target);
    const payload = await this.bridge.send<ExecuteActionPayload, ActionResultPayload>(tabId, 'EXECUTE_ACTION', {
      action,
      context: {
        variables: this.sessionManager.getSession(sessionId)?.variables ?? {},
        uploads: this.fileUploadManager.resolveUploads(sessionId, action.fileIds),
      },
    }, target);

    return this.mapBridgeResult(action, payload);
  }

  private async executeNetworkInterceptionAction(
    action: Extract<Action, { type: 'interceptNetwork' | 'mockResponse' }>,
    sessionId: string | undefined,
    tabId: number | null,
  ): Promise<ActionResult> {
    if (!sessionId) {
      throw new ExtensionError(ErrorCode.SESSION_NOT_FOUND, 'No active session available for network interception', true);
    }

    if (!tabId) {
      throw new ExtensionError(ErrorCode.TAB_NOT_FOUND, 'No target tab is available for network interception', true);
    }

    const startedAt = Date.now();
    const registration = await this.networkInterceptionManager.registerAction(sessionId, tabId, action);
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
      throw new ExtensionError(ErrorCode.SESSION_NOT_FOUND, 'No active session available for device emulation', true);
    }

    if (!tabId) {
      throw new ExtensionError(ErrorCode.TAB_NOT_FOUND, 'No target tab is available for device emulation', true);
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
      throw new ExtensionError(ErrorCode.SESSION_NOT_FOUND, 'No active session available for geolocation mocking', true);
    }

    if (!tabId) {
      throw new ExtensionError(ErrorCode.TAB_NOT_FOUND, 'No target tab is available for geolocation mocking', true);
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
      throw new ExtensionError(ErrorCode.TAB_NOT_FOUND, 'No active tab available for PDF generation', true);
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
      if (action.displayHeaderFooter !== undefined) pdfParams.displayHeaderFooter = action.displayHeaderFooter;
      if (action.preferCSSPageSize !== undefined) pdfParams.preferCSSPageSize = action.preferCSSPageSize;

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

  private async executeNavigateAction(action: Extract<Action, { type: 'navigate' }>, tabId: number | null): Promise<ActionResult> {
    if (!tabId) {
      throw new ExtensionError(ErrorCode.TAB_NOT_FOUND, 'No active tab available for navigation', true);
    }

    const startedAt = Date.now();
    await chrome.tabs.update(tabId, { url: action.url });
    await this.waitForTabReady(tabId, action.waitUntil ?? 'load', action.timeout ?? DEFAULT_RUNTIME_SETTINGS.defaultTimeout);
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
      throw new ExtensionError(ErrorCode.TAB_NOT_FOUND, 'No active tab available for history navigation', true);
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

  private async executeReloadAction(action: Extract<Action, { type: 'reload' }>, tabId: number | null): Promise<ActionResult> {
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
        type DomContentLoadedListener = Parameters<typeof chrome.webNavigation.onDOMContentLoaded.removeListener>[0];
        type CompletedListener = Parameters<typeof chrome.webNavigation.onCompleted.removeListener>[0];
        type ErrorOccurredListener = Parameters<typeof chrome.webNavigation.onErrorOccurred.removeListener>[0];

        navigationApi?.onDOMContentLoaded.removeListener(handleDomContentLoaded as unknown as DomContentLoadedListener);
        navigationApi?.onCompleted.removeListener(handleNavigationCompleted as unknown as CompletedListener);
        navigationApi?.onErrorOccurred.removeListener(handleNavigationError as unknown as ErrorOccurredListener);
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

      const handleTabRemoved: Parameters<typeof chrome.tabs.onRemoved.addListener>[0] = (removedTabId) => {
        if (removedTabId !== tabId) {
          return;
        }

        finish(() => {
          reject(new ExtensionError(ErrorCode.TAB_CLOSED, `Tab ${tabId} was closed during navigation`, true));
        });
      };

      const handleDomContentLoaded: Parameters<typeof chrome.webNavigation.onDOMContentLoaded.addListener>[0] = (details) => {
        if (details.tabId !== tabId || details.frameId !== 0) {
          return;
        }

        if (waitUntil === 'domContentLoaded') {
          resolveReady();
        }
      };

      const handleNavigationCompleted: Parameters<typeof chrome.webNavigation.onCompleted.addListener>[0] = (details) => {
        if (details.tabId !== tabId || details.frameId !== 0) {
          return;
        }

        resolveReady();
      };

      const handleNavigationError: Parameters<typeof chrome.webNavigation.onErrorOccurred.addListener>[0] = (details) => {
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
          reject(new ExtensionError(
            ErrorCode.NAVIGATION_FAILED,
            `Timed out waiting for tab ${tabId} to reach ${waitUntil}`,
            true,
          ));
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

  private async executeNewTabAction(action: Extract<Action, { type: 'newTab' }>, sessionId?: string): Promise<ActionResult> {
    const startedAt = Date.now();
    const tab = await this.tabManager.createTab(action.url, action.active ?? true);
    if (action.url) {
      await this.waitForTabReady(tab.id, 'load', action.timeout ?? DEFAULT_RUNTIME_SETTINGS.defaultTimeout);
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

  private async executeSwitchTabAction(action: Extract<Action, { type: 'switchTab' }>, sessionId?: string): Promise<ActionResult> {
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

  private async executeCloseTabAction(action: Extract<Action, { type: 'closeTab' }>, sessionId?: string): Promise<ActionResult> {
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
    const nextTab = remainingTabs[closedTabIndex] ?? remainingTabs[closedTabIndex - 1] ?? remainingTabs[0];

    return nextTab.id;
  }

  private async listOrderedTabs(): Promise<TabState[]> {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    return tabs
      .filter((tab) => tab.id !== undefined)
      .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
      .map((tab) => this.tabManager.mapChromeTab(tab));
  }

  private requireSessionForSnapshotAction(sessionId: string | undefined, actionType: 'switchTab' | 'closeTab'): Session {
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

  private async resolveTabFromPlannedSnapshot(session: Session, tabIndex: number): Promise<TabState> {
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

      session.tabSnapshot = tabs.map((tab, tabIndex): SessionTabSummary => ({
        tabIndex,
        id: tab.id,
        url: tab.url,
        title: tab.title,
        status: tab.status,
        isActive: tab.isActive,
        isTarget: tab.id === session.targetTabId,
      }));
    } catch (error) {
      this.logger.debug(`Unable to synchronize tab state for session ${sessionId}`, error);
    }
  }

  private resolveSynchronizedTargetTabId(tabs: TabState[], targetTabId: number | null): number | null {
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
    return {
      ...DEFAULT_PROVIDER_CONFIG[provider],
      ...(runtimeState.providers[provider] ?? {}),
    };
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
    });

    if (!result.success) {
      return;
    }

    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return;
    }

    if ('outputVariable' in action && typeof action.outputVariable === 'string' && action.outputVariable.length > 0) {
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
      .map((action, index) => `${index + 1}. ${action.description?.trim() || this.buildActionTitle(action)}`)
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
