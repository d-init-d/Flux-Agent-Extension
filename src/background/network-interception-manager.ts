import { DebuggerAdapter } from '@core/browser-controller';
import { ErrorCode, ExtensionError } from '@shared/errors';
import type {
  InterceptNetworkAction,
  MockResponseAction,
  NetworkResourceType,
} from '@shared/types';
import { Logger } from '@shared/utils';

type NetworkRuleAction = InterceptNetworkAction | MockResponseAction;
type NetworkRuleKind = 'continue' | 'block' | 'mock';

type FetchRequestPausedPayload = {
  requestId: string;
  request: {
    url: string;
  };
  resourceType?: string;
};

type MockedResponse = {
  responseCode: number;
  responseHeaders?: Array<{ name: string; value: string }>;
  body: string;
};

type NetworkRule = {
  id: string;
  sessionId: string;
  tabId: number;
  kind: NetworkRuleKind;
  urlPatterns: string[];
  compiledPatterns: RegExp[];
  resourceTypes?: Set<NetworkResourceType>;
  mockedResponse?: MockedResponse;
};

export interface NetworkInterceptionRegistration {
  ruleId: string;
  sessionId: string;
  tabId: number;
  operation: NetworkRuleKind;
  activeRuleCount: number;
  urlPatterns: string[];
}

export interface INetworkInterceptionManager {
  activateSession(sessionId: string, tabId: number | null): void;
  registerAction(
    sessionId: string,
    tabId: number,
    action: NetworkRuleAction,
  ): Promise<NetworkInterceptionRegistration>;
  clearSession(sessionId: string): Promise<void>;
  dispose?(): void;
}

interface NetworkInterceptionManagerOptions {
  debuggerAdapter?: DebuggerAdapter;
  logger?: Logger;
}

const DEFAULT_MOCK_RESPONSE_RESOURCE_TYPES: NetworkResourceType[] = ['XHR', 'Fetch'];
const BLOCKED_RESPONSE_HEADERS = new Set(['set-cookie', 'cookie', 'authorization']);

export class NetworkInterceptionManager implements INetworkInterceptionManager {
  private readonly debuggerAdapter: DebuggerAdapter;
  private readonly logger: Logger;
  private readonly rulesById = new Map<string, NetworkRule>();
  private readonly ruleIdsByTab = new Map<number, string[]>();
  private readonly ruleIdsBySession = new Map<string, Set<string>>();
  private readonly enabledTabs = new Set<number>();
  private readonly activeSessionByTab = new Map<number, string>();
  private readonly removeDebuggerEventListener: () => void;
  private readonly removeDebuggerDetachListener: () => void;

  constructor(options: NetworkInterceptionManagerOptions = {}) {
    this.debuggerAdapter = options.debuggerAdapter ?? new DebuggerAdapter();
    this.logger = options.logger ?? new Logger('FluxSW:NetworkInterceptionManager', 'warn');

    this.removeDebuggerEventListener = this.debuggerAdapter.onEvent((event) => {
      if (event.method !== 'Fetch.requestPaused' || !isFetchRequestPausedPayload(event.params)) {
        return;
      }

      void this.handleRequestPaused(event.tabId, event.params);
    });

    this.removeDebuggerDetachListener = this.debuggerAdapter.onDetach((tabId, reason) => {
      this.logger.debug('Debugger detached; dropping network interception state', { tabId, reason });
      this.dropTabState(tabId);
    });

    chrome.tabs.onRemoved.addListener(this.handleTabRemoved);
  }

  dispose(): void {
    this.removeDebuggerEventListener();
    this.removeDebuggerDetachListener();
    chrome.tabs.onRemoved.removeListener(this.handleTabRemoved);
  }

  activateSession(sessionId: string, tabId: number | null): void {
    const affectedTabIds = new Set<number>();

    for (const [candidateTabId, candidateSessionId] of this.activeSessionByTab.entries()) {
      if (candidateSessionId === sessionId && candidateTabId !== tabId) {
        this.activeSessionByTab.delete(candidateTabId);
        affectedTabIds.add(candidateTabId);
      }
    }

    if (tabId === null) {
      for (const affectedTabId of affectedTabIds) {
        void this.syncFetchPatterns(affectedTabId);
      }
      return;
    }

    this.activeSessionByTab.set(tabId, sessionId);
    affectedTabIds.add(tabId);

    for (const affectedTabId of affectedTabIds) {
      void this.syncFetchPatterns(affectedTabId);
    }
  }

  async registerAction(
    sessionId: string,
    tabId: number,
    action: NetworkRuleAction,
  ): Promise<NetworkInterceptionRegistration> {
    if (!sessionId.trim()) {
      throw new ExtensionError(ErrorCode.SESSION_NOT_FOUND, 'Session id is required', true);
    }

    if (!Number.isInteger(tabId) || tabId <= 0) {
      throw new ExtensionError(ErrorCode.TAB_NOT_FOUND, `Invalid tab id "${tabId}"`, true);
    }

    const rule = this.createRule(sessionId, tabId, action);
    this.removeRuleState(rule.id);

    this.rulesById.set(rule.id, rule);

    const tabRuleIds = this.ruleIdsByTab.get(tabId) ?? [];
    tabRuleIds.push(rule.id);
    this.ruleIdsByTab.set(tabId, tabRuleIds);

    const sessionRuleIds = this.ruleIdsBySession.get(sessionId) ?? new Set<string>();
    sessionRuleIds.add(rule.id);
    this.ruleIdsBySession.set(sessionId, sessionRuleIds);
    this.activeSessionByTab.set(tabId, sessionId);

    await this.syncFetchPatterns(tabId);

    this.logger.debug('Registered network interception rule', {
      sessionId,
      tabId,
      ruleId: rule.id,
      operation: rule.kind,
      urlPatterns: rule.urlPatterns,
    });

    return {
      ruleId: rule.id,
      sessionId,
      tabId,
      operation: rule.kind,
      activeRuleCount: tabRuleIds.length,
      urlPatterns: [...rule.urlPatterns],
    };
  }

  async clearSession(sessionId: string): Promise<void> {
    const ruleIds = Array.from(this.ruleIdsBySession.get(sessionId) ?? []);
    const affectedTabIds = new Set<number>();

    for (const ruleId of ruleIds) {
      const tabId = this.removeRuleState(ruleId);
      if (tabId !== null) {
        affectedTabIds.add(tabId);
      }
    }

    for (const [tabId, activeSessionId] of this.activeSessionByTab.entries()) {
      if (activeSessionId === sessionId) {
        this.activeSessionByTab.delete(tabId);
      }
    }

    for (const tabId of affectedTabIds) {
      await this.syncFetchPatterns(tabId);
    }
  }

  async clearTab(tabId: number): Promise<void> {
    const wasEnabled = this.enabledTabs.has(tabId);
    this.dropTabState(tabId);

    if (wasEnabled) {
      await this.disableFetchIfAttached(tabId);
    }
  }

  private readonly handleTabRemoved: Parameters<typeof chrome.tabs.onRemoved.addListener>[0] = (tabId) => {
    this.logger.debug('Tab removed; dropping network interception state', { tabId });
    this.dropTabState(tabId);
  };

  private async handleRequestPaused(tabId: number, payload: FetchRequestPausedPayload): Promise<void> {
    const rule = this.findMatchingRule(tabId, payload.request.url, payload.resourceType);

    try {
      if (!rule) {
        await this.debuggerAdapter.continueInterceptedRequest(tabId, payload.requestId);
        return;
      }

      if (rule.kind === 'block') {
        await this.debuggerAdapter.failInterceptedRequest(tabId, payload.requestId, 'BlockedByClient');
        return;
      }

      if (rule.kind === 'mock' && rule.mockedResponse) {
        await this.debuggerAdapter.fulfillInterceptedRequest(tabId, payload.requestId, {
          responseCode: rule.mockedResponse.responseCode,
          responseHeaders: rule.mockedResponse.responseHeaders,
          body: rule.mockedResponse.body,
        });
        return;
      }

      await this.debuggerAdapter.continueInterceptedRequest(tabId, payload.requestId);
    } catch (error) {
      this.logger.warn('Failed to resolve paused network request; attempting to continue request', {
        tabId,
        requestId: payload.requestId,
        error,
      });

      try {
        await this.debuggerAdapter.continueInterceptedRequest(tabId, payload.requestId);
      } catch (continueError) {
        this.logger.warn('Failed to continue paused network request after interception error', {
          tabId,
          requestId: payload.requestId,
          error: continueError,
        });
      }
    }
  }

  private async syncFetchPatterns(tabId: number): Promise<void> {
    const patterns = this.buildFetchPatterns(tabId);
    if (patterns.length === 0) {
      await this.disableFetchIfIdle(tabId);
      return;
    }

    await this.debuggerAdapter.enableFetchInterception(tabId, patterns);
    this.enabledTabs.add(tabId);
  }

  private removeRuleState(ruleId: string): number | null {
    const existingRule = this.rulesById.get(ruleId);
    if (!existingRule) {
      return null;
    }

    this.rulesById.delete(ruleId);

    const tabRuleIds = this.ruleIdsByTab.get(existingRule.tabId)?.filter((candidate) => candidate !== ruleId) ?? [];
    if (tabRuleIds.length > 0) {
      this.ruleIdsByTab.set(existingRule.tabId, tabRuleIds);
    } else {
      this.ruleIdsByTab.delete(existingRule.tabId);
    }

    const sessionRuleIds = this.ruleIdsBySession.get(existingRule.sessionId);
    if (sessionRuleIds) {
      sessionRuleIds.delete(ruleId);
      if (sessionRuleIds.size === 0) {
        this.ruleIdsBySession.delete(existingRule.sessionId);
      }
    }

    return existingRule.tabId;
  }

  private dropTabState(tabId: number): void {
    const ruleIds = [...(this.ruleIdsByTab.get(tabId) ?? [])];
    for (const ruleId of ruleIds) {
      this.removeRuleState(ruleId);
    }

    this.ruleIdsByTab.delete(tabId);
    this.enabledTabs.delete(tabId);
    this.activeSessionByTab.delete(tabId);
  }

  private async disableFetchIfIdle(tabId: number): Promise<void> {
    if ((this.ruleIdsByTab.get(tabId)?.length ?? 0) > 0 || !this.enabledTabs.has(tabId)) {
      return;
    }

    this.enabledTabs.delete(tabId);
    await this.disableFetchIfAttached(tabId);
  }

  private async disableFetchIfAttached(tabId: number): Promise<void> {
    if (!this.debuggerAdapter.isAttached(tabId)) {
      return;
    }

    try {
      await this.debuggerAdapter.disableFetchInterception(tabId);
    } catch (error) {
      this.logger.debug('Failed to disable Fetch interception for tab', { tabId, error });
    }
  }

  private findMatchingRule(
    tabId: number,
    url: string,
    resourceType?: string,
  ): NetworkRule | null {
    const activeSessionId = this.activeSessionByTab.get(tabId);
    if (!activeSessionId) {
      return null;
    }

    const ruleIds = this.ruleIdsByTab.get(tabId) ?? [];

    for (let index = ruleIds.length - 1; index >= 0; index -= 1) {
      const rule = this.rulesById.get(ruleIds[index]);
      if (!rule || rule.sessionId !== activeSessionId || !this.matchesRule(rule, url, resourceType)) {
        continue;
      }

      return rule;
    }

    return null;
  }

  private matchesRule(rule: NetworkRule, url: string, resourceType?: string): boolean {
    const matchesUrl = rule.compiledPatterns.some((pattern) => pattern.test(url));
    if (!matchesUrl) {
      return false;
    }

    if (!rule.resourceTypes || rule.resourceTypes.size === 0) {
      return true;
    }

    return typeof resourceType === 'string' && rule.resourceTypes.has(resourceType as NetworkResourceType);
  }

  private createRule(sessionId: string, tabId: number, action: NetworkRuleAction): NetworkRule {
    const compiledPatterns = action.urlPatterns.map((pattern) => this.compilePattern(pattern));
    const resourceTypes = action.resourceTypes?.length
      ? new Set<NetworkResourceType>(action.resourceTypes)
      : undefined;

    if (action.type === 'interceptNetwork') {
      return {
        id: action.id,
        sessionId,
        tabId,
        kind: action.operation,
        urlPatterns: [...action.urlPatterns],
        compiledPatterns,
        resourceTypes,
      };
    }

    return {
      id: action.id,
      sessionId,
      tabId,
      kind: 'mock',
      urlPatterns: [...action.urlPatterns],
      compiledPatterns,
      resourceTypes: resourceTypes ?? new Set<NetworkResourceType>(DEFAULT_MOCK_RESPONSE_RESOURCE_TYPES),
      mockedResponse: {
        responseCode: action.response.status,
        responseHeaders: this.buildResponseHeaders(action),
        body: this.encodeResponseBody(action),
      },
    };
  }

  private buildResponseHeaders(action: MockResponseAction): Array<{ name: string; value: string }> | undefined {
    const responseHeaders = Object.entries(action.response.headers ?? {}).map(([name, value]) => ({ name, value }));
    for (const header of responseHeaders) {
      const normalizedName = header.name.trim().toLowerCase();
      if (
        BLOCKED_RESPONSE_HEADERS.has(normalizedName) ||
        normalizedName.startsWith('proxy-') ||
        normalizedName.startsWith('sec-')
      ) {
        throw new ExtensionError(
          ErrorCode.ACTION_BLOCKED,
          `Mock responses cannot override the sensitive header "${header.name}"`,
          true,
        );
      }
    }

    const hasContentType = responseHeaders.some((header) => header.name.toLowerCase() === 'content-type');

    if (action.response.contentType && !hasContentType) {
      responseHeaders.push({ name: 'Content-Type', value: action.response.contentType });
    }

    return responseHeaders.length > 0 ? responseHeaders : undefined;
  }

  private encodeResponseBody(action: MockResponseAction): string {
    if (action.response.bodyEncoding === 'base64') {
      return action.response.body;
    }

    return encodeUtf8ToBase64(action.response.body);
  }

  private compilePattern(pattern: string): RegExp {
    const trimmed = pattern.trim();
    if (trimmed.length === 0) {
      throw new ExtensionError(ErrorCode.ACTION_INVALID, 'Network interception URL patterns must be non-empty', true);
    }

    if (!/^https?:\/\//i.test(trimmed)) {
      throw new ExtensionError(
        ErrorCode.ACTION_INVALID,
        'Network interception URL patterns must start with http:// or https://',
        true,
      );
    }

    const host = trimmed.replace(/^https?:\/\//i, '').split('/')[0] ?? '';
    if (host.length === 0 || host.includes('*')) {
      throw new ExtensionError(
        ErrorCode.ACTION_INVALID,
        'Network interception URL patterns must target an exact host',
        true,
      );
    }

    const escaped = trimmed.replace(/[|\\{}()[\]^$+?.]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`, 'i');
  }

  private buildFetchPatterns(tabId: number): Array<{
    urlPattern: string;
    requestStage: 'Request';
    resourceType?: string;
  }> {
    const activeSessionId = this.activeSessionByTab.get(tabId);
    if (!activeSessionId) {
      return [];
    }

    const patterns = new Map<string, { urlPattern: string; requestStage: 'Request'; resourceType?: string }>();
    const ruleIds = this.ruleIdsByTab.get(tabId) ?? [];

    for (const ruleId of ruleIds) {
      const rule = this.rulesById.get(ruleId);
      if (!rule || rule.sessionId !== activeSessionId) {
        continue;
      }

      for (const urlPattern of rule.urlPatterns) {
        if (rule.resourceTypes && rule.resourceTypes.size > 0) {
          for (const resourceType of rule.resourceTypes) {
            patterns.set(`${urlPattern}:${resourceType}`, {
              urlPattern,
              resourceType,
              requestStage: 'Request',
            });
          }
          continue;
        }

        patterns.set(urlPattern, {
          urlPattern,
          requestStage: 'Request',
        });
      }
    }

    return Array.from(patterns.values());
  }
}

function isFetchRequestPausedPayload(value: unknown): value is FetchRequestPausedPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const request = candidate.request;
  if (!request || typeof request !== 'object') {
    return false;
  }

  return typeof candidate.requestId === 'string' && typeof (request as Record<string, unknown>).url === 'string';
}

function encodeUtf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}
