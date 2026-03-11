import { ErrorCode } from '@shared/errors';
import type { Action, ActionResult, PageContext, SessionConfig } from '@shared/types';
import { ActionOrchestrator } from '@core/orchestrator';
import { SessionManager } from '../manager';

function createPageContext(): PageContext {
  return {
    url: 'https://example.com/checkout',
    title: 'Checkout',
    summary: 'Checkout form with email and place order button.',
    frame: {
      frameId: 0,
      parentFrameId: null,
      url: 'https://example.com/checkout',
      origin: 'https://example.com',
      isTop: true,
    },
    interactiveElements: [
      {
        index: 1,
        tag: 'input',
        text: '',
        selector: '#email',
        type: 'email',
        role: 'textbox',
        placeholder: 'Email',
        ariaLabel: 'Email',
        isVisible: true,
        isEnabled: true,
      },
      {
        index: 2,
        tag: 'button',
        text: 'Place order',
        selector: '#place-order',
        type: null,
        role: 'button',
        placeholder: null,
        ariaLabel: 'Place order',
        isVisible: true,
        isEnabled: true,
      },
    ],
    headings: [{ level: 1, text: 'Checkout' }],
    links: [],
    forms: [{ action: '/order', method: 'post', fields: ['email'] }],
    viewport: {
      width: 1280,
      height: 720,
      scrollX: 0,
      scrollY: 0,
      scrollHeight: 1600,
    },
  };
}

describe('Session + Orchestrator flow', () => {
  it('runs action flow and persists execution history into session context', async () => {
    const sessionManager = new SessionManager();

    const config: SessionConfig = {
      id: 'session-flow-1',
      name: 'Checkout flow',
      provider: 'openai',
      model: 'gpt-4o-mini',
    };

    await sessionManager.createSession(config, 1);
    await sessionManager.start(config.id, 'Fill checkout form and submit');
    sessionManager.setPageContext(config.id, createPageContext());

    const action: Action = {
      id: 'action-click-submit',
      type: 'click',
      selector: { strategy: 'css', value: '#place-order' },
      retries: 1,
    };

    let attempts = 0;
    const orchestrator = new ActionOrchestrator({
      execute: vi.fn(async (): Promise<ActionResult> => {
        attempts += 1;
        if (attempts === 1) {
          return {
            actionId: action.id,
            success: false,
            duration: 9,
            error: {
              code: ErrorCode.ELEMENT_NOT_FOUND,
              message: 'button is not ready yet',
              recoverable: true,
            },
          };
        }

        return {
          actionId: action.id,
          success: true,
          duration: 14,
          data: { clicked: true },
        };
      }),
    });

    const result = await orchestrator.executeAction(action, {
      sessionId: config.id,
    });

    expect(result.success).toBe(true);
    expect(attempts).toBe(2);

    sessionManager.pushActionRecord(config.id, {
      action,
      result,
      timestamp: Date.now(),
    });
    sessionManager.addAIResponse(config.id, 'Order button clicked successfully.');

    const history = sessionManager.getHistory(config.id);
    expect(history).toHaveLength(1);
    expect(history[0]?.action.id).toBe(action.id);
    expect(history[0]?.result.success).toBe(true);

    const context = await sessionManager.buildContext(config.id);
    expect(context).toContain('## Page Context');
    expect(context).toContain('Checkout');
    expect(context).toContain('## Action History');
    expect(context).toContain('action-click-submit');
    expect(context).toContain('## Recent Messages');
    expect(context).toContain('Order button clicked successfully.');
  });
});
