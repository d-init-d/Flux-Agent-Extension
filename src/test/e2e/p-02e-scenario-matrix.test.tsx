import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IServiceWorkerBridge } from '@core/bridge';
import { AIClientManager } from '@core/ai-client';
import type { IAIProvider } from '@core/ai-client';
import type {
  Action,
  ActionResult,
  AIMessage,
  AIModelConfig,
  AIRequestOptions,
  AIStreamChunk,
  ExtensionMessage,
  ExtensionResponse,
  PageContext,
  RequestPayloadMap,
  ResponsePayloadMap,
} from '@shared/types';
import { UISessionRuntime } from '../../background/ui-session-runtime';
import { App } from '../../sidepanel/App';
import { resetActionLogStore } from '../../sidepanel/store/actionLogStore';
import { resetChatStore } from '../../sidepanel/store/chatStore';
import { resetSessionStore } from '../../sidepanel/store/sessionStore';
import { ThemeProvider } from '../../ui/theme';
import { Logger } from '@shared/utils';

const extensionListeners = new Set<(message: ExtensionMessage) => void>();
const pendingExtensionRequests = new Set<Promise<unknown>>();
let activeRuntime: UISessionRuntime | null = null;

interface MatrixScenario {
  id: string;
  prompt: string;
  summary: string;
  pageContext: PageContext;
  actions: Action[];
  expectedExecutedActions: Array<Pick<Action, 'id' | 'type'>>;
  expectedActionLogEntries: string[];
}

function createExtensionMessage<T extends keyof RequestPayloadMap>(
  type: T,
  payload: RequestPayloadMap[T],
): ExtensionMessage<RequestPayloadMap[T]> {
  return {
    id: `msg-${type}-${Date.now()}`,
    channel: 'sidePanel',
    type,
    payload,
    timestamp: Date.now(),
  };
}

vi.mock('../../sidepanel/lib/extension-client', () => ({
  sendExtensionRequest: async <T extends keyof RequestPayloadMap>(
    type: T,
    payload: RequestPayloadMap[T],
  ): Promise<ResponsePayloadMap[T]> => {
    if (!activeRuntime) {
      throw new Error('Runtime is not initialized for E2E test');
    }

    const request = activeRuntime.handleMessage(createExtensionMessage(type, payload)) as Promise<
      ExtensionResponse<ResponsePayloadMap[T]>
    >;

    pendingExtensionRequests.add(request);
    const response = await request.finally(() => {
      pendingExtensionRequests.delete(request);
    });

    if (!response.success) {
      throw new Error(response.error?.message ?? `Extension request ${type} failed`);
    }

    return response.data as ResponsePayloadMap[T];
  },
  subscribeToExtensionEvents: (handler: (message: ExtensionMessage) => void) => {
    extensionListeners.add(handler);
    return () => {
      extensionListeners.delete(handler);
    };
  },
}));

class MockProvider implements IAIProvider {
  readonly name = 'openai' as const;
  readonly supportsVision = false;
  readonly supportsStreaming = true;
  readonly supportsFunctionCalling = false;

  constructor(private readonly responseText: string) {}

  async initialize(_config: AIModelConfig): Promise<void> {
    return undefined;
  }

  async *chat(
    _messages: AIMessage[],
    _options?: AIRequestOptions,
  ): AsyncGenerator<AIStreamChunk, void, unknown> {
    const midpoint = Math.max(1, Math.floor(this.responseText.length / 2));
    yield { type: 'text', content: this.responseText.slice(0, midpoint) };
    yield { type: 'text', content: this.responseText.slice(midpoint) };
  }

  async validateApiKey(_apiKey: string): Promise<boolean> {
    return true;
  }

  abort(): void {
    // no-op
  }
}

function createAIManager(responseText: string): AIClientManager {
  const manager = new AIClientManager({ autoFallback: false });
  manager.registerProvider(new MockProvider(responseText));
  return manager;
}

function createBridge(
  pageContext: PageContext,
  actionHandler: (action: Action) => Promise<ActionResult>,
): IServiceWorkerBridge {
  const send = vi.fn(async (_tabId: number, type: string, payload: unknown) => {
    if (type === 'GET_PAGE_CONTEXT') {
      return { context: pageContext };
    }

    if (type === 'EXECUTE_ACTION') {
      const request = payload as RequestPayloadMap['ACTION_EXECUTE'];
      return { result: await actionHandler(request.action) };
    }

    throw new Error(`Unexpected bridge command: ${type}`);
  });

  return {
    send,
    ensureContentScript: vi.fn(async () => undefined),
    sendOneWay: vi.fn(),
    onEvent: vi.fn(() => () => undefined),
    isReady: vi.fn(async () => true),
  } as unknown as IServiceWorkerBridge;
}

async function flushExtensionRequests(): Promise<void> {
  while (pendingExtensionRequests.size > 0) {
    const pending = [...pendingExtensionRequests];
    await Promise.allSettled(pending);
  }
}

async function settleAsyncSideEffects(iterations: number = 1): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await act(async () => {
      await flushExtensionRequests();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function renderApp(): Promise<void> {
  await act(async () => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );
  });

  await settleAsyncSideEffects(3);
  await waitFor(() => {
    expect(screen.getByRole('combobox', { name: 'Active session' })).not.toHaveValue('');
  });
}

async function openActionLog(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Expand action log' }));
}

async function sendPrompt(user: ReturnType<typeof userEvent.setup>, prompt: string): Promise<void> {
  fireEvent.change(screen.getByRole('textbox', { name: 'Message input' }), {
    target: { value: prompt },
  });
  await user.click(screen.getByRole('button', { name: 'Send' }));
  await settleAsyncSideEffects(2);
}

function createSettings() {
  return {
    language: 'auto',
    theme: 'system',
    defaultProvider: 'openai',
    streamResponses: false,
    includeScreenshotsInContext: false,
    maxContextLength: 32_000,
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
}

function createPageContext(base: Partial<PageContext>): PageContext {
  return {
    url: base.url ?? 'https://example.com/workspace',
    title: base.title ?? 'Flux Workspace',
    summary: base.summary ?? 'Structured page context for deterministic E2E coverage.',
    frame: base.frame ?? {
      frameId: 0,
      parentFrameId: null,
      url: base.url ?? 'https://example.com/workspace',
      origin: new URL(base.url ?? 'https://example.com/workspace').origin,
      name: 'main',
      isTop: true,
    },
    interactiveElements: base.interactiveElements ?? [],
    headings: base.headings ?? [],
    links: base.links ?? [],
    forms: base.forms ?? [],
    viewport: base.viewport ?? {
      width: 1440,
      height: 900,
      scrollX: 0,
      scrollY: 0,
      scrollHeight: 2400,
    },
  };
}

function createInput(
  index: number,
  ariaLabel: string,
  placeholder: string,
  type: string = 'text',
): NonNullable<PageContext['interactiveElements']>[number] {
  return {
    index,
    tag: 'input',
    text: '',
    type,
    role: type === 'search' ? 'searchbox' : 'textbox',
    placeholder,
    ariaLabel,
    isVisible: true,
    isEnabled: true,
    boundingBox: { x: 40, y: 32 * index, width: 320, height: 40 },
  };
}

function createButton(
  index: number,
  label: string,
  ariaLabel: string = label,
): NonNullable<PageContext['interactiveElements']>[number] {
  return {
    index,
    tag: 'button',
    text: label,
    type: 'button',
    role: 'button',
    placeholder: undefined,
    ariaLabel,
    isVisible: true,
    isEnabled: true,
    boundingBox: { x: 420, y: 32 * index, width: 180, height: 40 },
  };
}

function createLink(index: number, label: string): NonNullable<PageContext['interactiveElements']>[number] {
  return {
    index,
    tag: 'a',
    text: label,
    type: undefined,
    role: 'link',
    placeholder: undefined,
    ariaLabel: label,
    isVisible: true,
    isEnabled: true,
    boundingBox: { x: 640, y: 32 * index, width: 240, height: 24 },
  };
}

function createScenario(
  id: string,
  prompt: string,
  summary: string,
  pageTitle: string,
  pageUrl: string,
  actions: Action[],
): MatrixScenario {
  return {
    id,
    prompt,
    summary,
    pageContext: createPageContext({
      url: pageUrl,
      title: pageTitle,
      summary,
      interactiveElements: [
        createInput(1, 'Primary field', 'Primary field'),
        createInput(2, 'Secondary field', 'Secondary field'),
        createButton(3, 'Apply'),
        createButton(4, 'Save changes'),
        createButton(5, 'Confirm'),
        createLink(6, 'Open details'),
      ],
      headings: [{ level: 1, text: pageTitle }],
    }),
    actions,
    expectedExecutedActions: actions.map((action) => ({ id: action.id, type: action.type })),
    expectedActionLogEntries: actions.map((action) => action.description ?? action.id),
  };
}

const scenarios: MatrixScenario[] = [
  createScenario(
    'P-02e-01',
    'Open the support queue filters and apply the urgent-only view',
    'Support operations page applies an urgency filter through a deterministic fill-and-click flow.',
    'Support Queue',
    'https://example.com/support/queue',
    [
      {
        id: 'support-fill-priority',
        type: 'fill',
        selector: { ariaLabel: 'Primary field' },
        value: 'Urgent',
        description: 'Fill the priority filter',
      },
      {
        id: 'support-apply-priority',
        type: 'click',
        selector: { role: 'button', textExact: 'Apply' },
        description: 'Apply the urgent-only filter',
      },
    ],
  ),
  createScenario(
    'P-02e-02',
    'Update the billing contact email and save changes',
    'Billing settings page updates a contact field and persists the change.',
    'Billing Settings',
    'https://example.com/settings/billing',
    [
      {
        id: 'billing-fill-email',
        type: 'fill',
        selector: { ariaLabel: 'Primary field' },
        value: 'billing@example.com',
        description: 'Fill the billing contact email',
      },
      {
        id: 'billing-save-email',
        type: 'click',
        selector: { role: 'button', textExact: 'Save changes' },
        description: 'Save the billing settings',
      },
    ],
  ),
  createScenario(
    'P-02e-03',
    'Filter the release notes for security fixes and open details',
    'Release notes page filters content and opens a detailed result entry.',
    'Release Notes',
    'https://example.com/releases',
    [
      {
        id: 'releases-fill-filter',
        type: 'fill',
        selector: { ariaLabel: 'Primary field' },
        value: 'Security fixes',
        description: 'Fill the release-note filter',
      },
      {
        id: 'releases-apply-filter',
        type: 'click',
        selector: { role: 'button', textExact: 'Apply' },
        description: 'Apply the release-note filter',
      },
      {
        id: 'releases-open-details',
        type: 'click',
        selector: { role: 'link', textExact: 'Open details' },
        description: 'Open the filtered release details',
      },
    ],
  ),
  createScenario(
    'P-02e-04',
    'Set the warehouse lookup to SKU-4401 and save the item audit',
    'Inventory audit page runs a search and saves the target record update.',
    'Inventory Audit',
    'https://example.com/inventory/audit',
    [
      {
        id: 'inventory-fill-sku',
        type: 'fill',
        selector: { ariaLabel: 'Primary field' },
        value: 'SKU-4401',
        description: 'Fill the SKU lookup field',
      },
      {
        id: 'inventory-apply-sku',
        type: 'click',
        selector: { role: 'button', textExact: 'Apply' },
        description: 'Run the SKU lookup',
      },
      {
        id: 'inventory-save-audit',
        type: 'click',
        selector: { role: 'button', textExact: 'Save changes' },
        description: 'Save the inventory audit entry',
      },
    ],
  ),
  createScenario(
    'P-02e-05',
    'Search the team directory for Riley Chen and open details',
    'Team directory page searches for a person and opens the profile card.',
    'Team Directory',
    'https://example.com/people',
    [
      {
        id: 'directory-fill-name',
        type: 'fill',
        selector: { ariaLabel: 'Primary field' },
        value: 'Riley Chen',
        description: 'Fill the team-directory search field',
      },
      {
        id: 'directory-apply-name',
        type: 'click',
        selector: { role: 'button', textExact: 'Apply' },
        description: 'Run the team-directory search',
      },
      {
        id: 'directory-open-profile',
        type: 'click',
        selector: { role: 'link', textExact: 'Open details' },
        description: 'Open the matching team profile',
      },
    ],
  ),
  createScenario(
    'P-02e-06',
    'Update the incident owner to Morgan Diaz and save changes',
    'Incident-management page updates the owner field and persists it.',
    'Incident Detail',
    'https://example.com/incidents/42',
    [
      {
        id: 'incident-fill-owner',
        type: 'fill',
        selector: { ariaLabel: 'Primary field' },
        value: 'Morgan Diaz',
        description: 'Fill the incident owner field',
      },
      {
        id: 'incident-save-owner',
        type: 'click',
        selector: { role: 'button', textExact: 'Save changes' },
        description: 'Save the incident owner update',
      },
    ],
  ),
  createScenario(
    'P-02e-07',
    'Use the marketing campaign form to set the audience to enterprise buyers and apply it',
    'Campaign planner updates an audience segment through a deterministic form flow.',
    'Campaign Planner',
    'https://example.com/marketing/campaigns',
    [
      {
        id: 'campaign-fill-audience',
        type: 'fill',
        selector: { ariaLabel: 'Primary field' },
        value: 'Enterprise buyers',
        description: 'Fill the campaign audience field',
      },
      {
        id: 'campaign-apply-audience',
        type: 'click',
        selector: { role: 'button', textExact: 'Apply' },
        description: 'Apply the audience update',
      },
    ],
  ),
  createScenario(
    'P-02e-08',
    'Edit the QA checklist item and save the change',
    'QA checklist page edits a note field and saves the update.',
    'QA Checklist',
    'https://example.com/qa/checklist',
    [
      {
        id: 'qa-fill-note',
        type: 'fill',
        selector: { ariaLabel: 'Secondary field' },
        value: 'Regression run completed',
        description: 'Fill the QA checklist note',
      },
      {
        id: 'qa-save-note',
        type: 'click',
        selector: { role: 'button', textExact: 'Save changes' },
        description: 'Save the QA checklist update',
      },
    ],
  ),
  createScenario(
    'P-02e-09',
    'Set the dashboard comparison mode to this quarter and apply it',
    'Analytics dashboard updates a comparison filter and refreshes the view.',
    'Analytics Dashboard',
    'https://example.com/analytics/dashboard',
    [
      {
        id: 'analytics-fill-comparison',
        type: 'fill',
        selector: { ariaLabel: 'Primary field' },
        value: 'This quarter',
        description: 'Fill the dashboard comparison mode',
      },
      {
        id: 'analytics-apply-comparison',
        type: 'click',
        selector: { role: 'button', textExact: 'Apply' },
        description: 'Apply the dashboard comparison mode',
      },
    ],
  ),
  createScenario(
    'P-02e-10',
    'Update the profile nickname to Flux Ops and save changes',
    'Profile settings page updates a nickname field and persists it.',
    'Profile Settings',
    'https://example.com/profile/settings',
    [
      {
        id: 'profile-fill-nickname',
        type: 'fill',
        selector: { ariaLabel: 'Primary field' },
        value: 'Flux Ops',
        description: 'Fill the profile nickname field',
      },
      {
        id: 'profile-save-nickname',
        type: 'click',
        selector: { role: 'button', textExact: 'Save changes' },
        description: 'Save the profile nickname',
      },
    ],
  ),
  createScenario(
    'P-02e-11',
    'Search the vendor list for Northwind Logistics and open details',
    'Vendor-management page searches and opens a vendor detail view.',
    'Vendor Directory',
    'https://example.com/vendors',
    [
      {
        id: 'vendors-fill-search',
        type: 'fill',
        selector: { ariaLabel: 'Primary field' },
        value: 'Northwind Logistics',
        description: 'Fill the vendor search field',
      },
      {
        id: 'vendors-apply-search',
        type: 'click',
        selector: { role: 'button', textExact: 'Apply' },
        description: 'Run the vendor search',
      },
      {
        id: 'vendors-open-details',
        type: 'click',
        selector: { role: 'link', textExact: 'Open details' },
        description: 'Open the vendor details',
      },
    ],
  ),
  createScenario(
    'P-02e-12',
    'Update the launch checklist approver to Jamie Rivera and save it',
    'Launch checklist page updates an approver assignment and saves it.',
    'Launch Checklist',
    'https://example.com/releases/checklist',
    [
      {
        id: 'launch-fill-approver',
        type: 'fill',
        selector: { ariaLabel: 'Primary field' },
        value: 'Jamie Rivera',
        description: 'Fill the launch approver field',
      },
      {
        id: 'launch-save-approver',
        type: 'click',
        selector: { role: 'button', textExact: 'Save changes' },
        description: 'Save the launch approver assignment',
      },
    ],
  ),
  createScenario(
    'P-02e-13',
    'Filter the customer feedback board for onboarding issues and open details',
    'Customer feedback board filters issues and opens the first matching detail view.',
    'Customer Feedback',
    'https://example.com/feedback/board',
    [
      {
        id: 'feedback-fill-filter',
        type: 'fill',
        selector: { ariaLabel: 'Primary field' },
        value: 'Onboarding issues',
        description: 'Fill the feedback filter',
      },
      {
        id: 'feedback-apply-filter',
        type: 'click',
        selector: { role: 'button', textExact: 'Apply' },
        description: 'Apply the feedback filter',
      },
      {
        id: 'feedback-open-details',
        type: 'click',
        selector: { role: 'link', textExact: 'Open details' },
        description: 'Open the filtered feedback entry',
      },
    ],
  ),
  createScenario(
    'P-02e-14',
    'Change the deployment notes field to Canary passed and save changes',
    'Deployment notes page edits a text field and persists the release note.',
    'Deployment Notes',
    'https://example.com/deployments/notes',
    [
      {
        id: 'deployments-fill-notes',
        type: 'fill',
        selector: { ariaLabel: 'Secondary field' },
        value: 'Canary passed',
        description: 'Fill the deployment notes field',
      },
      {
        id: 'deployments-save-notes',
        type: 'click',
        selector: { role: 'button', textExact: 'Save changes' },
        description: 'Save the deployment notes',
      },
    ],
  ),
  createScenario(
    'P-02e-15',
    'Search the roadmap board for phase 5 and open details',
    'Roadmap board searches for a specific delivery slice and opens its detail page.',
    'Roadmap Board',
    'https://example.com/roadmap',
    [
      {
        id: 'roadmap-fill-search',
        type: 'fill',
        selector: { ariaLabel: 'Primary field' },
        value: 'Phase 5',
        description: 'Fill the roadmap search field',
      },
      {
        id: 'roadmap-apply-search',
        type: 'click',
        selector: { role: 'button', textExact: 'Apply' },
        description: 'Run the roadmap search',
      },
      {
        id: 'roadmap-open-details',
        type: 'click',
        selector: { role: 'link', textExact: 'Open details' },
        description: 'Open the roadmap details',
      },
    ],
  ),
  createScenario(
    'P-02e-16',
    'Set the retention policy field to 30 days and save it',
    'Compliance settings page updates a retention field and saves the policy change.',
    'Compliance Settings',
    'https://example.com/compliance/settings',
    [
      {
        id: 'compliance-fill-retention',
        type: 'fill',
        selector: { ariaLabel: 'Primary field' },
        value: '30 days',
        description: 'Fill the retention policy field',
      },
      {
        id: 'compliance-save-retention',
        type: 'click',
        selector: { role: 'button', textExact: 'Save changes' },
        description: 'Save the retention policy update',
      },
    ],
  ),
  createScenario(
    'P-02e-17',
    'Edit the feature flag rollout audience to beta users and apply it',
    'Feature-flag console updates a rollout audience filter and applies the change.',
    'Feature Flags',
    'https://example.com/flags',
    [
      {
        id: 'flags-fill-audience',
        type: 'fill',
        selector: { ariaLabel: 'Primary field' },
        value: 'Beta users',
        description: 'Fill the rollout audience field',
      },
      {
        id: 'flags-apply-audience',
        type: 'click',
        selector: { role: 'button', textExact: 'Apply' },
        description: 'Apply the rollout audience update',
      },
    ],
  ),
  createScenario(
    'P-02e-18',
    'Search the bug board for playback failures and open details',
    'Bug board searches a failure theme and opens the first matching issue detail.',
    'Bug Board',
    'https://example.com/bugs',
    [
      {
        id: 'bugs-fill-search',
        type: 'fill',
        selector: { ariaLabel: 'Primary field' },
        value: 'Playback failures',
        description: 'Fill the bug-board search field',
      },
      {
        id: 'bugs-apply-search',
        type: 'click',
        selector: { role: 'button', textExact: 'Apply' },
        description: 'Run the bug-board search',
      },
      {
        id: 'bugs-open-details',
        type: 'click',
        selector: { role: 'link', textExact: 'Open details' },
        description: 'Open the playback-failure details',
      },
    ],
  ),
  createScenario(
    'P-02e-19',
    'Update the workflow title to Weekly capture and save changes',
    'Workflow settings page updates a title field and persists it.',
    'Workflow Settings',
    'https://example.com/workflows/settings',
    [
      {
        id: 'workflow-fill-title',
        type: 'fill',
        selector: { ariaLabel: 'Primary field' },
        value: 'Weekly capture',
        description: 'Fill the workflow title field',
      },
      {
        id: 'workflow-save-title',
        type: 'click',
        selector: { role: 'button', textExact: 'Save changes' },
        description: 'Save the workflow title',
      },
    ],
  ),
  createScenario(
    'P-02e-20',
    'Set the account verification note to Manual review complete and save it',
    'Account review page updates a note field and saves the state change.',
    'Account Verification',
    'https://example.com/accounts/review',
    [
      {
        id: 'accounts-fill-note',
        type: 'fill',
        selector: { ariaLabel: 'Secondary field' },
        value: 'Manual review complete',
        description: 'Fill the account verification note',
      },
      {
        id: 'accounts-save-note',
        type: 'click',
        selector: { role: 'button', textExact: 'Save changes' },
        description: 'Save the account verification note',
      },
    ],
  ),
  createScenario(
    'P-02e-21',
    'Filter the documentation site for security guidance and open details',
    'Documentation hub filters guides and opens the selected document detail view.',
    'Documentation Hub',
    'https://example.com/docs',
    [
      {
        id: 'docs-fill-filter',
        type: 'fill',
        selector: { ariaLabel: 'Primary field' },
        value: 'Security guidance',
        description: 'Fill the documentation filter',
      },
      {
        id: 'docs-apply-filter',
        type: 'click',
        selector: { role: 'button', textExact: 'Apply' },
        description: 'Apply the documentation filter',
      },
      {
        id: 'docs-open-details',
        type: 'click',
        selector: { role: 'link', textExact: 'Open details' },
        description: 'Open the selected documentation detail',
      },
    ],
  ),
  createScenario(
    'P-02e-22',
    'Update the handoff owner to Priya Singh and save changes',
    'Project handoff page updates an owner field and saves it.',
    'Project Handoff',
    'https://example.com/projects/handoff',
    [
      {
        id: 'handoff-fill-owner',
        type: 'fill',
        selector: { ariaLabel: 'Primary field' },
        value: 'Priya Singh',
        description: 'Fill the handoff owner field',
      },
      {
        id: 'handoff-save-owner',
        type: 'click',
        selector: { role: 'button', textExact: 'Save changes' },
        description: 'Save the handoff owner',
      },
    ],
  ),
  createScenario(
    'P-02e-23',
    'Search the training portal for onboarding runbook and open details',
    'Training portal searches a course title and opens the matching runbook detail.',
    'Training Portal',
    'https://example.com/training',
    [
      {
        id: 'training-fill-search',
        type: 'fill',
        selector: { ariaLabel: 'Primary field' },
        value: 'Onboarding runbook',
        description: 'Fill the training-portal search field',
      },
      {
        id: 'training-apply-search',
        type: 'click',
        selector: { role: 'button', textExact: 'Apply' },
        description: 'Run the training-portal search',
      },
      {
        id: 'training-open-details',
        type: 'click',
        selector: { role: 'link', textExact: 'Open details' },
        description: 'Open the onboarding runbook details',
      },
    ],
  ),
  createScenario(
    'P-02e-24',
    'Set the change review note to Ready for sign-off and save it',
    'Change-review page updates a sign-off note and saves the review state.',
    'Change Review',
    'https://example.com/changes/review',
    [
      {
        id: 'changes-fill-note',
        type: 'fill',
        selector: { ariaLabel: 'Secondary field' },
        value: 'Ready for sign-off',
        description: 'Fill the change review note',
      },
      {
        id: 'changes-save-note',
        type: 'click',
        selector: { role: 'button', textExact: 'Save changes' },
        description: 'Save the change review note',
      },
    ],
  ),
];

async function runScenario(scenario: MatrixScenario): Promise<void> {
  const user = userEvent.setup();
  const actionHandler = vi.fn(
    async (action: Action): Promise<ActionResult> => ({
      actionId: action.id,
      success: true,
      duration: 8,
      data: { executed: true, type: action.type },
    }),
  );

  activeRuntime = new UISessionRuntime({
    bridge: createBridge(scenario.pageContext, actionHandler),
    logger: new Logger('FluxSW:p-02e-e2e', 'debug'),
    aiClientManager: createAIManager(
      JSON.stringify({
        summary: scenario.summary,
        actions: scenario.actions,
      }),
    ),
  });

  await renderApp();
  await sendPrompt(user, scenario.prompt);

  await waitFor(() => {
    expect(actionHandler).toHaveBeenCalledTimes(scenario.expectedExecutedActions.length);
  });

  expect(
    actionHandler.mock.calls.map(([action]) => ({ id: action.id, type: action.type })),
  ).toEqual(scenario.expectedExecutedActions);
  expect(await screen.findByText(scenario.prompt)).toBeInTheDocument();
  expect(await screen.findByText(scenario.summary)).toBeInTheDocument();

  await openActionLog(user);
  for (const entry of scenario.expectedActionLogEntries) {
    expect(await screen.findByText(entry)).toBeInTheDocument();
  }
}

describe('P-02e scenario-matrix E2E expansion', () => {
  let originalConsoleError: typeof console.error;

  beforeEach(async () => {
    originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      const message = typeof args[0] === 'string' ? args[0] : '';
      if (message.includes('inside a test was not wrapped in act')) {
        return;
      }
      originalConsoleError.call(console, ...args);
    };

    extensionListeners.clear();
    pendingExtensionRequests.clear();
    activeRuntime = null;

    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(async (message: unknown) => {
      const event = message as ExtensionMessage;
      if (event?.type?.startsWith('EVENT_')) {
        act(() => {
          for (const listener of extensionListeners) {
            listener(event);
          }
        });
      }

      return undefined;
    });

    await chrome.storage.local.set({
      settings: createSettings(),
      providers: {
        openai: {
          enabled: true,
          model: 'gpt-4o-mini',
          maxTokens: 4096,
          temperature: 0.2,
        },
      },
    });
  });

  afterEach(() => {
    console.error = originalConsoleError;
    activeRuntime = null;
    extensionListeners.clear();
    pendingExtensionRequests.clear();
    cleanup();
    act(() => {
      resetSessionStore();
      resetChatStore();
      resetActionLogStore();
    });
  });

  it.each(scenarios)('$id covers $prompt', async (scenario) => {
    await runScenario(scenario);
  });
});
