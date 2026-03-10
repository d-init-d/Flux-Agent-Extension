import {
  buildConfirmationPrompt,
  buildContinuationPrompt,
  buildEnrichedUserMessage,
  buildErrorRecoveryBlock,
  buildExtractTableDataPrompt,
  buildPageContextBlock,
  buildSessionContextBlock,
  formatSelector,
} from '../prompts/templates';
import { getCompactSystemPrompt, getSystemPrompt, SUPPORTED_ACTION_TYPES } from '../prompts/system';

describe('ai-client prompts', () => {
  describe('system prompt', () => {
    it('includes all major sections in full prompt', () => {
      const prompt = getSystemPrompt();

      expect(prompt).toContain('You are Flux Agent');
      expect(prompt).toContain('## Reasoning Guidelines');
      expect(prompt).toContain('## Available Actions');
      expect(prompt).toContain('## Response Format');
      expect(prompt).toContain('## Safety & Sensitivity Rules');
    });

    it('compact prompt is shorter than full prompt', () => {
      const full = getSystemPrompt();
      const compact = getCompactSystemPrompt();

      expect(compact.length).toBeLessThan(full.length);
      expect(compact).toContain('Available action types:');
    });

    it('exports supported action types list', () => {
      expect(SUPPORTED_ACTION_TYPES.length).toBe(34);
      expect(SUPPORTED_ACTION_TYPES).toContain('navigate');
      expect(SUPPORTED_ACTION_TYPES).toContain('click');
      expect(SUPPORTED_ACTION_TYPES).toContain('fullPageScreenshot');
      expect(SUPPORTED_ACTION_TYPES).toContain('emulateDevice');
      expect(SUPPORTED_ACTION_TYPES).toContain('mockResponse');
    });
  });

  describe('template blocks', () => {
    it('buildPageContextBlock includes URL, title, viewport, dom summary, and visible text', () => {
      const block = buildPageContextBlock({
        url: 'https://example.com/login',
        title: 'Login',
        viewport: { width: 1280, height: 720 },
        domSummary: '- button: Sign in',
        visibleText: 'Please sign in to continue',
      });

      expect(block).toContain('**URL**: https://example.com/login');
      expect(block).toContain('**Title**: Login');
      expect(block).toContain('**Viewport**: 1280×720');
      expect(block).toContain('### Interactive Elements');
      expect(block).toContain('- button: Sign in');
      expect(block).toContain('### Visible Text');
      expect(block).toContain('Please sign in to continue');
    });

    it('truncates very long visible text in page context', () => {
      const longText = 'a'.repeat(2100);
      const block = buildPageContextBlock({
        url: 'https://example.com',
        title: 'Example',
        visibleText: longText,
      });

      expect(block).toContain('... (truncated)');
      expect(block.length).toBeLessThan(2300);
    });

    it('buildSessionContextBlock includes latest actions and truncates action data', () => {
      const block = buildSessionContextBlock({
        sessionId: 'session-1',
        turnCount: 4,
        goal: 'Complete checkout',
        recentActions: [
          {
            type: 'click',
            success: true,
            description: 'Clicked checkout button',
            durationMs: 250,
          },
          {
            type: 'extract',
            success: true,
            description: 'Extracted order total',
            data: 'x'.repeat(250),
          },
        ],
      });

      expect(block).toContain('## Session Context');
      expect(block).toContain('**Session**: session-1');
      expect(block).toContain('**Turn**: 4');
      expect(block).toContain('**Goal**: Complete checkout');
      expect(block).toContain('✓ `click`: Clicked checkout button (250ms)');
      expect(block).toContain('→ Data:');
      expect(block).toContain('...');
    });

    it('buildErrorRecoveryBlock includes failed action JSON and suggestions', () => {
      const block = buildErrorRecoveryBlock({
        failedAction: {
          type: 'click',
          params: { selector: { text: 'Submit' } },
          description: 'Click submit',
        },
        errorMessage: 'Element not found',
        retryCount: 2,
        suggestions: ['Try ariaLabel selector', 'Wait for element visibility'],
      });

      expect(block).toContain('## Action Failed — Recovery Needed');
      expect(block).toContain('failed after 2 attempt(s)');
      expect(block).toContain('Element not found');
      expect(block).toContain('Try ariaLabel selector');
      expect(block).toContain('Wait for element visibility');
    });

    it('buildEnrichedUserMessage joins context blocks with --- separator', () => {
      const enriched = buildEnrichedUserMessage(
        'Please continue',
        {
          url: 'https://example.com',
          title: 'Example',
        },
        {
          sessionId: 's-1',
          turnCount: 2,
          recentActions: [],
        },
        {
          failedAction: {
            type: 'click',
            params: { selector: { css: '#submit' } },
          },
          errorMessage: 'Not found',
          retryCount: 1,
        },
      );

      expect(enriched).toContain('## Session Context');
      expect(enriched).toContain('## Current Page State');
      expect(enriched).toContain('## Action Failed — Recovery Needed');
      expect(enriched).toContain('## User Request\nPlease continue');
      expect(enriched).toContain('\n\n---\n\n');
    });

    it('buildContinuationPrompt summarizes completed actions and remaining goal', () => {
      const prompt = buildContinuationPrompt(
        [
          { type: 'navigate', success: true, description: 'Opened page' },
          { type: 'click', success: false, description: 'Tried login button' },
        ],
        'Finish the login flow',
        {
          url: 'https://example.com/login',
          title: 'Login',
        },
      );

      expect(prompt).toContain('## Continuation — Previous Actions Completed');
      expect(prompt).toContain('✓ navigate: Opened page');
      expect(prompt).toContain('✗ click: Tried login button');
      expect(prompt).toContain('## Remaining Goal');
      expect(prompt).toContain('Finish the login flow');
    });

    it('buildConfirmationPrompt lists actions with sensitivity levels', () => {
      const prompt = buildConfirmationPrompt([
        {
          type: 'click',
          description: 'Submit payment form',
          sensitivityLevel: 'CRITICAL',
        },
        {
          type: 'navigate',
          description: 'Open account settings',
          sensitivityLevel: 'MEDIUM',
        },
      ]);

      expect(prompt).toContain('## Confirmation Required');
      expect(prompt).toContain('**click** [CRITICAL]: Submit payment form');
      expect(prompt).toContain('**navigate** [MEDIUM]: Open account settings');
      expect(prompt).toContain('Reply "yes" or "confirm"');
    });

    it('buildExtractTableDataPrompt emphasizes structured table extraction without hallucination', () => {
      const prompt = buildExtractTableDataPrompt();

      expect(prompt).toContain('Extract the most relevant table data from the current page.');
      expect(prompt).toContain('Return a structured result with:');
      expect(prompt).toContain('original headers, units, and important text kept exactly as shown');
      expect(prompt).toContain('Choose the single best matching table.');
      expect(prompt).toContain('Do not invent or fill missing values.');
      expect(prompt).toContain('If no table is present, say clearly: No table found.');
    });

    it('formatSelector builds human-readable selector text', () => {
      const formatted = formatSelector({
        testId: 'login-btn',
        ariaLabel: 'Sign in',
        role: 'button',
        css: '#submit',
        xpath: '//button[@type="submit"]',
        text: 'Sign in',
        textExact: 'Sign in',
        placeholder: 'Email',
        nearText: 'Password',
        nth: 1,
      });

      expect(formatted).toContain('[data-testid="login-btn"]');
      expect(formatted).toContain('[aria-label="Sign in"]');
      expect(formatted).toContain('[role="button"]');
      expect(formatted).toContain('#submit');
      expect(formatted).toContain('xpath: //button[@type="submit"]');
      expect(formatted).toContain('text≈"Sign in"');
      expect(formatted).toContain('text="Sign in"');
      expect(formatted).toContain('[placeholder="Email"]');
      expect(formatted).toContain('near "Password"');
      expect(formatted).toContain('[1]');
    });

    it('formatSelector returns fallback text for empty selector', () => {
      expect(formatSelector({})).toBe('(empty selector)');
    });
  });
});
