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
import { TabManager } from '@core/browser-controller';
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
  ElementSelector,
  ExecuteActionPayload,
  ExtensionSettings,
  ExtensionMessage,
  ExtensionResponse,
  PageContextPayload,
  ParsedResponse,
  RequestPayloadMap,
  ResponsePayloadMap,
  Session,
  SessionConfig,
  SessionCreateRequest,
  SessionUpdateEventPayload,
} from '@shared/types';
import { generateId, Logger } from '@shared/utils';
import type { ProviderConfig } from '@shared/types';

const DEFAULT_PROVIDER_MODELS: Record<SessionConfig['provider'], string> = {
  claude: 'claude-3-5-sonnet-20241022',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash',
  ollama: 'llama3.2',
  openrouter: 'openai/gpt-4o-mini',
  custom: 'custom-model',
};

const STREAM_CHUNK_INTERVAL_MS = 20;

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
}

interface RuntimeState {
  settings: ExtensionSettings;
  providers: Partial<Record<SessionConfig['provider'], Partial<ProviderConfig>>>;
}

export class UISessionRuntime {
  private readonly sessionManager = new SessionManager();
  private readonly logger: Logger;
  private readonly bridge: IServiceWorkerBridge;
  private readonly aiClientManager: AbortableAIClientManager;
  private readonly parserFactory?: (config: Partial<ParserConfig>) => CommandParser;
  private readonly tabManager: TabManager;
  private readonly orchestrator: ActionOrchestrator;
  private readonly streamControllers = new Map<string, AbortController>();
  private readonly latestActionEntries = new Map<string, ActionLogEventEntry>();
  private activeSessionId: string | null = null;

  constructor(options: UISessionRuntimeOptions) {
    this.bridge = options.bridge;
    this.logger = options.logger.child('UISessionRuntime');
    this.aiClientManager = options.aiClientManager ?? this.createDefaultAIClientManager();
    this.parserFactory = options.parserFactory;
    this.tabManager = options.tabManager ?? new TabManager();
    this.orchestrator = new ActionOrchestrator({
      execute: (action, context) => this.executeAutomationAction(action, context.sessionId),
    });
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
    const session = this.sessionManager.getSession(payload.sessionId);
    return {
      success: true,
      data: { session: session ? this.cloneSession(session) : null },
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
    this.clearLatestActionEntry(payload.sessionId);
    await this.clearHighlights(payload.sessionId);
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

    if (!this.streamControllers.has(sessionId)) {
      return { success: true };
    }

    this.abortStream(sessionId);
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
    this.orchestrator.abort(payload.sessionId);
    this.activeSessionId = payload.sessionId;
    this.setSessionStatus(payload.sessionId, 'running');
    await this.sessionManager.sendMessage(payload.sessionId, payload.message);
    await this.broadcastCurrentSession(payload.sessionId, 'updated');

    const planningEntry = this.createPlanningEntry();
    await this.broadcastActionProgress({
      sessionId: payload.sessionId,
      entry: planningEntry,
    });

    const streamController = new AbortController();
    this.streamControllers.set(payload.sessionId, streamController);
    const streamMessageId = `assistant-${generateId(10)}`;
    let assistantStreamDone = false;

    try {
      const runtimeState = await this.loadRuntimeState();
      await this.collectPageContext(payload.sessionId);

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
      await this.bridge.ensureContentScript(session.targetTabId);
      const payload = await this.bridge.send<undefined, PageContextPayload>(
        session.targetTabId,
        'GET_PAGE_CONTEXT',
        undefined,
      );
      this.sessionManager.setPageContext(sessionId, payload.context);
      session.variables.pageContext = payload.context;
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
    const trimmedContext = context.length > maxContextLength ? context.slice(0, maxContextLength) : context;
    const priorMessages = session.messages.slice(-6, -1).map((message) => ({
      role: message.role,
      content: message.content,
    }));

    return [
      {
        role: 'system',
        content: session.config.systemPrompt?.trim() || getSystemPrompt(),
      },
      ...priorMessages,
      {
        role: 'user',
        content: `${trimmedContext}\n\n## User Request\n${prompt.trim()}`,
      },
    ];
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
      const baseAction = actions[index];
      const action = this.applyDefaultRetries(baseAction, settings);
      const runningEntry = await this.createExecutionEntry(sessionId, action, index + 1, totalSteps, 'running');
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
            progress: Math.max(5, Math.round(((index + 1) / totalSteps) * 100)),
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

        continue;
      }

      await this.collectPageContext(sessionId);
      await this.broadcastActionProgress({
        sessionId,
        entry: {
          ...runningEntry,
          status: 'done',
          progress: Math.round(((index + 1) / totalSteps) * 100),
          detail: this.buildActionCompletedDetail(action, result),
        },
      });
    }
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

    await this.bridge.ensureContentScript(tabId);
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
    );

    return this.mapBridgeResult(action, payload);
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
    const session = sessionId ? this.sessionManager.getSession(sessionId) : null;
    if (session) {
      session.targetTabId = tab.id;
      session.lastActivityAt = Date.now();
    }

    return {
      actionId: action.id,
      success: true,
      duration: Date.now() - startedAt,
      data: { tabId: tab.id, url: tab.url },
    };
  }

  private async executeSwitchTabAction(action: Extract<Action, { type: 'switchTab' }>, sessionId?: string): Promise<ActionResult> {
    const startedAt = Date.now();
    const tabs = await this.tabManager.listTabs();
    const targetTab = tabs[action.tabIndex];
    if (!targetTab) {
      throw new ExtensionError(ErrorCode.TAB_NOT_FOUND, `No tab exists at index ${action.tabIndex}`, true);
    }

    await this.tabManager.switchTab(targetTab.id);
    const session = sessionId ? this.sessionManager.getSession(sessionId) : null;
    if (session) {
      session.targetTabId = targetTab.id;
      session.lastActivityAt = Date.now();
    }

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
      const tabs = await this.tabManager.listTabs();
      const targetTab = tabs[action.tabIndex];
      if (!targetTab) {
        throw new ExtensionError(ErrorCode.TAB_NOT_FOUND, `No tab exists at index ${action.tabIndex}`, true);
      }

      await this.tabManager.closeTab(targetTab.id);
      if (session?.targetTabId === targetTab.id) {
        session.targetTabId = null;
      }
    } else if (session?.targetTabId) {
      await this.tabManager.closeTab(session.targetTabId);
      session.targetTabId = null;
    } else {
      await this.tabManager.closeTab();
    }

    if (session) {
      session.lastActivityAt = Date.now();
    }

    return {
      actionId: action.id,
      success: true,
      duration: Date.now() - startedAt,
    };
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
      await this.bridge.ensureContentScript(tabId);
      this.bridge.sendOneWay(tabId, 'HIGHLIGHT_ELEMENT', { selector, duration: 2500 });
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
      await this.bridge.ensureContentScript(session.targetTabId);
      this.bridge.sendOneWay(session.targetTabId, 'CLEAR_HIGHLIGHTS', undefined);
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
