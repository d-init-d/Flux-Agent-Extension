import { SessionManager } from '@core/session';
import type { ServiceWorkerBridge } from '@core/bridge';
import type {
  ActionLogEventEntry,
  ActionLogEventStatus,
  ActionProgressEventPayload,
  AIStreamEventPayload,
  ElementSelector,
  ExtensionMessage,
  ExtensionResponse,
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

type RuntimeHandlerResponse<T extends keyof ResponsePayloadMap> = Promise<ExtensionResponse<ResponsePayloadMap[T]>>;

interface UISessionRuntimeOptions {
  bridge: ServiceWorkerBridge;
  logger: Logger;
}

export class UISessionRuntime {
  private readonly sessionManager = new SessionManager();
  private readonly logger: Logger;
  private readonly bridge: ServiceWorkerBridge;
  private readonly streamControllers = new Map<string, AbortController>();
  private readonly latestActionEntries = new Map<string, ActionLogEventEntry>();
  private activeSessionId: string | null = null;

  constructor(options: UISessionRuntimeOptions) {
    this.bridge = options.bridge;
    this.logger = options.logger.child('UISessionRuntime');
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
    this.activeSessionId = payload.sessionId;
    await this.sessionManager.sendMessage(payload.sessionId, payload.message);
    await this.broadcastCurrentSession(payload.sessionId, 'updated');

    const actionEntry = await this.createRunningActionEntry(payload.sessionId, payload.message);
    await this.broadcastActionProgress({
      sessionId: payload.sessionId,
      entry: actionEntry,
    });

    const streamController = new AbortController();
    this.streamControllers.set(payload.sessionId, streamController);

    const responseText = this.buildAssistantResponse(payload.message);
    const streamMessageId = `assistant-${generateId(10)}`;

    try {
      await this.streamAssistantResponse(payload.sessionId, streamMessageId, responseText, streamController.signal);
      this.sessionManager.addAIResponse(payload.sessionId, responseText);
      await this.broadcastCurrentSession(payload.sessionId, 'updated');
      await this.broadcastActionProgress({
        sessionId: payload.sessionId,
        entry: {
          ...actionEntry,
          status: 'done',
          progress: 100,
          currentStep: actionEntry.totalSteps,
          detail: this.buildCompletedActionDetail(payload.message),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Streaming failed unexpectedly';
      await this.broadcastAIStream({
        sessionId: payload.sessionId,
        messageId: streamMessageId,
        delta: '',
        done: true,
        error: message,
      });
      await this.broadcastActionProgress({
        sessionId: payload.sessionId,
        entry: {
          ...actionEntry,
          status: 'failed',
          errorCode: 'STREAM_FAILED',
          detail: message,
        },
      });

      return {
        success: false,
        error: {
          code: 'STREAM_FAILED',
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

  private async streamAssistantResponse(
    sessionId: string,
    messageId: string,
    text: string,
    signal: AbortSignal,
  ): Promise<void> {
    const chunks = this.chunkText(text);
    for (const chunk of chunks) {
      if (signal.aborted) {
        throw new Error('Execution aborted');
      }

      await this.broadcastAIStream({
        sessionId,
        messageId,
        delta: chunk,
        done: false,
      });
      await this.delay(STREAM_CHUNK_INTERVAL_MS);
    }

    await this.broadcastAIStream({
      sessionId,
      messageId,
      delta: '',
      done: true,
    });
  }

  private async createRunningActionEntry(
    sessionId: string,
    prompt: string,
  ): Promise<ActionLogEventEntry> {
    const selector = this.extractTargetSelector(prompt);
    const session = this.sessionManager.getSession(sessionId);
    const tabId = session?.targetTabId ?? null;
    const title = this.buildActionTitle(prompt);
    const detail = this.buildRunningActionDetail(prompt);

    const entry: ActionLogEventEntry = {
      id: `action-${generateId(10)}`,
      actionId: `generated-${generateId(8)}`,
      title,
      detail,
      timestamp: Date.now(),
      status: 'running',
      progress: 35,
      currentStep: 1,
      totalSteps: 3,
      selector,
    };

    if (tabId !== null && selector) {
      await this.highlightTarget(tabId, selector);
    }

    return entry;
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
  }

  private clearLatestActionEntry(sessionId: string): void {
    this.latestActionEntries.delete(sessionId);
  }

  private cloneSession(session: Session): Session {
    return JSON.parse(JSON.stringify(session)) as Session;
  }

  private chunkText(text: string): string[] {
    const words = text.split(/(\s+)/).filter((token) => token.length > 0);
    return words.length > 0 ? words : [text];
  }

  private buildAssistantResponse(prompt: string): string {
    const normalized = prompt.trim();
    if (normalized.startsWith('/screenshot')) {
      return 'I am preparing a screenshot workflow for the active tab. I will capture the current page and return the result in the next integration tasks.';
    }

    if (normalized.startsWith('/extract')) {
      return 'I am scanning the active page and preparing a structured extraction plan. The side panel stream is now wired, so you can see this response arrive in real time.';
    }

    if (normalized.startsWith('/settings')) {
      return 'I can route you to the extension settings flow. Session state, chat streaming, and action progress are now connected to the service worker.';
    }

    return `I received: ${normalized}. The service worker session runtime is active, streaming this reply chunk by chunk, and mirroring execution progress into the action log.`;
  }

  private buildActionTitle(prompt: string): string {
    const normalized = prompt.trim().toLowerCase();
    if (normalized.startsWith('/screenshot')) {
      return 'Preparing screenshot capture';
    }
    if (normalized.startsWith('/extract')) {
      return 'Preparing extraction workflow';
    }
    if (normalized.includes('click')) {
      return 'Preparing click target';
    }
    if (normalized.includes('fill') || normalized.includes('type')) {
      return 'Preparing input target';
    }
    return 'Preparing automation response';
  }

  private buildRunningActionDetail(prompt: string): string {
    const selector = this.extractTargetSelector(prompt);
    if (selector?.textExact) {
      return `Highlighting the element matching "${selector.textExact}" before the next execution step.`;
    }
    if (selector?.text) {
      return `Highlighting the element related to "${selector.text}" before execution continues.`;
    }
    return 'Publishing action progress to the side panel while the response stream is generated.';
  }

  private buildCompletedActionDetail(prompt: string): string {
    const normalized = prompt.trim();
    return `Progress sync finished for: ${normalized}.`;
  }

  private extractTargetSelector(prompt: string): ElementSelector | undefined {
    const quotedMatch = prompt.match(/"([^"]+)"|'([^']+)'/);
    const targetText = quotedMatch?.[1] ?? quotedMatch?.[2];
    if (!targetText) {
      return undefined;
    }

    const normalizedPrompt = prompt.toLowerCase();
    if (normalizedPrompt.includes('button')) {
      return { role: 'button', textExact: targetText };
    }

    if (normalizedPrompt.includes('link')) {
      return { role: 'link', textExact: targetText };
    }

    if (normalizedPrompt.includes('field') || normalizedPrompt.includes('input')) {
      return { placeholder: targetText };
    }

    return { textExact: targetText };
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
