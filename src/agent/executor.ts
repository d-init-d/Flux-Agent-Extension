/**
 * Action Executor
 * Thực thi các actions đã được plan
 */

import { messageHub } from '../background/message-hub';
import type { 
  AgentPlan, 
  AgentAction, 
  ActionResult, 
  ExecutorOptions,
  AgentEvent,
  AgentEventType,
} from './types';
import { DEFAULT_EXECUTOR_OPTIONS } from './types';
import { logger } from '@shared/logger';
import { generateId } from '@shared/utils';

type EventCallback = (event: AgentEvent) => void;

/**
 * Action Executor class
 * Handles execution of planned actions
 */
export class ActionExecutor {
  private options: ExecutorOptions;
  private eventCallbacks: EventCallback[] = [];
  private currentPlan: AgentPlan | null = null;
  private isExecuting = false;
  private abortController: AbortController | null = null;

  constructor(options: Partial<ExecutorOptions> = {}) {
    this.options = { ...DEFAULT_EXECUTOR_OPTIONS, ...options };
  }

  /**
   * Subscribe to executor events
   */
  onEvent(callback: EventCallback): () => void {
    this.eventCallbacks.push(callback);
    return () => {
      this.eventCallbacks = this.eventCallbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * Emit an event
   */
  private emit(type: AgentEventType, actionId?: string, data?: unknown): void {
    if (!this.currentPlan) return;

    const event: AgentEvent = {
      type,
      planId: this.currentPlan.id,
      actionId,
      data,
      timestamp: Date.now(),
    };

    for (const callback of this.eventCallbacks) {
      try {
        callback(event);
      } catch (error) {
        logger.error('Event callback error:', error);
      }
    }
  }

  /**
   * Execute a plan
   */
  async execute(plan: AgentPlan): Promise<AgentPlan> {
    if (this.isExecuting) {
      throw new Error('Already executing a plan');
    }

    this.currentPlan = { ...plan, status: 'executing', startedAt: Date.now() };
    this.isExecuting = true;
    this.abortController = new AbortController();

    this.emit('plan_started');

    try {
      while (this.currentPlan.currentActionIndex < this.currentPlan.actions.length) {
        // Check for abort
        if (this.abortController.signal.aborted) {
          this.currentPlan.status = 'cancelled';
          this.emit('plan_cancelled');
          break;
        }

        const actionIndex = this.currentPlan.currentActionIndex;
        const action = this.currentPlan.actions[actionIndex];

        // Execute action
        const result = await this.executeAction(action);

        // Update action with result
        this.currentPlan.actions[actionIndex] = {
          ...action,
          status: result.success ? 'completed' : 'failed',
          result,
          endTime: Date.now(),
        };

        if (result.success) {
          this.emit('action_completed', action.id, result);
        } else {
          this.emit('action_failed', action.id, result);

          // Handle failure
          if (this.options.stopOnError && action.retryCount >= this.options.maxRetries) {
            this.currentPlan.status = 'failed';
            this.currentPlan.failReason = result.message || 'Action failed';
            this.emit('plan_failed', action.id, { reason: result.message });
            break;
          }
        }

        // Move to next action
        this.currentPlan.currentActionIndex++;

        // Delay between actions
        if (this.options.actionDelay > 0 && 
            this.currentPlan.currentActionIndex < this.currentPlan.actions.length) {
          await this.sleep(this.options.actionDelay);
        }
      }

      // Mark plan as completed if all actions done
      if (this.currentPlan.status === 'executing') {
        this.currentPlan.status = 'completed';
        this.currentPlan.completedAt = Date.now();
        this.emit('plan_completed');
      }
    } catch (error) {
      logger.error('Plan execution error:', error);
      this.currentPlan.status = 'failed';
      this.currentPlan.failReason = String(error);
      this.emit('plan_failed', undefined, { error: String(error) });
    } finally {
      this.isExecuting = false;
      this.abortController = null;
    }

    return this.currentPlan;
  }

  /**
   * Execute a single action
   */
  async executeAction(action: AgentAction): Promise<ActionResult> {
    action.status = 'running';
    action.startTime = Date.now();
    this.emit('action_started', action.id);

    // Highlight element before action if enabled
    if (this.options.highlightBeforeAction) {
      await this.highlightTarget(action);
    }

    try {
      const result = await this.runToolAction(action);
      return result;
    } catch (error) {
      logger.error(`Action ${action.toolName} failed:`, error);

      // Retry logic
      if (action.retryCount < this.options.maxRetries) {
        action.retryCount++;
        action.status = 'retrying';
        this.emit('action_retrying', action.id, { attempt: action.retryCount });

        await this.sleep(1000 * action.retryCount); // Exponential backoff
        return this.executeAction(action);
      }

      return {
        success: false,
        message: String(error),
      };
    }
  }

  /**
   * Run the actual tool action
   */
  private async runToolAction(action: AgentAction): Promise<ActionResult> {
    const { toolName, arguments: args } = action;

    // Map tool to message type and execute
    switch (toolName) {
      case 'click':
        return this.sendToContent('CLICK', {
          selector: args.selector || this.buildSelector(args),
          options: {
            doubleClick: args.doubleClick,
            rightClick: args.rightClick,
          },
        });

      case 'type':
        return this.sendToContent('TYPE', {
          selector: args.selector || args.fieldName,
          text: args.text,
          options: {
            clearFirst: args.clearFirst !== false,
            pressEnter: args.pressEnter,
          },
        });

      case 'scroll':
        if (args.selector) {
          return this.sendToContent('SCROLL_TO', {
            selector: args.selector,
          });
        }
        return this.sendToContent('SCROLL', {
          direction: args.direction || 'down',
          amount: args.amount,
        });

      case 'hover':
        return this.sendToContent('HOVER', {
          selector: args.selector || this.buildSelector(args),
          duration: args.duration,
        });

      case 'extract_text':
        return this.sendToContent('EXTRACT_TEXT', {
          selector: args.selector,
          multiple: args.multiple,
        });

      case 'extract_table':
        return this.sendToContent('EXTRACT_TABLE', {
          selector: args.selector,
          includeHeaders: args.includeHeaders !== false,
          maxRows: args.maxRows,
        });

      case 'extract_links':
        return this.sendToContent('EXTRACT_LINKS', {
          selector: args.selector,
          filterExternal: args.filterExternal,
          filterInternal: args.filterInternal,
        });

      case 'screenshot':
        return this.takeScreenshot(args);

      case 'get_page_info':
        return this.sendToContent('PAGE_CONTEXT_REQUEST', args);

      case 'navigate':
        return this.navigate(args);

      case 'wait':
        return this.wait(args);

      case 'fill_form':
        return this.fillForm(args);

      default:
        return {
          success: false,
          message: `Unknown tool: ${toolName}`,
        };
    }
  }

  /**
   * Build selector from text or description
   */
  private buildSelector(args: Record<string, unknown>): string | undefined {
    if (args.text) {
      // Use text-based selector
      return `[text="${args.text}"], *:contains("${args.text}")`;
    }
    return undefined;
  }

  /**
   * Highlight target element before action
   */
  private async highlightTarget(action: AgentAction): Promise<void> {
    const selector = action.arguments.selector || 
                     this.buildSelector(action.arguments);
    
    if (selector) {
      try {
        await this.sendToContent('HIGHLIGHT', { selector });
        await this.sleep(300); // Brief pause to show highlight
      } catch {
        // Ignore highlight errors
      }
    }
  }

  /**
   * Send message to content script
   */
  private async sendToContent(
    type: string,
    payload: Record<string, unknown>
  ): Promise<ActionResult> {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        return { success: false, message: 'No active tab' };
      }

      const response = await chrome.tabs.sendMessage(tab.id, {
        type,
        payload,
        timestamp: Date.now(),
        id: generateId(),
      });

      if (response?.success !== undefined) {
        return {
          success: response.success,
          data: response.data,
          message: response.message || response.error,
        };
      }

      return { success: true, data: response };
    } catch (error) {
      return { success: false, message: String(error) };
    }
  }

  /**
   * Take screenshot
   */
  private async takeScreenshot(
    args: Record<string, unknown>
  ): Promise<ActionResult> {
    try {
      if (args.selector) {
        // Element screenshot - delegate to content
        return this.sendToContent('SCREENSHOT_REQUEST', { selector: args.selector });
      }

      // Viewport/full page screenshot
      const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
      return {
        success: true,
        data: { screenshot: dataUrl },
        screenshot: dataUrl,
      };
    } catch (error) {
      return { success: false, message: String(error) };
    }
  }

  /**
   * Navigate
   */
  private async navigate(args: Record<string, unknown>): Promise<ActionResult> {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        return { success: false, message: 'No active tab' };
      }

      if (args.url) {
        await chrome.tabs.update(tab.id, { url: args.url as string });
        await this.sleep(1000); // Wait for navigation
        return { success: true, message: `Navigated to ${args.url}` };
      }

      if (args.action === 'back') {
        await chrome.tabs.goBack(tab.id);
        return { success: true, message: 'Navigated back' };
      }

      if (args.action === 'forward') {
        await chrome.tabs.goForward(tab.id);
        return { success: true, message: 'Navigated forward' };
      }

      if (args.action === 'refresh') {
        await chrome.tabs.reload(tab.id);
        return { success: true, message: 'Page refreshed' };
      }

      return { success: false, message: 'No navigation action specified' };
    } catch (error) {
      return { success: false, message: String(error) };
    }
  }

  /**
   * Wait
   */
  private async wait(args: Record<string, unknown>): Promise<ActionResult> {
    if (args.milliseconds) {
      await this.sleep(args.milliseconds as number);
      return { success: true, message: `Waited ${args.milliseconds}ms` };
    }

    if (args.selector) {
      // Poll for element
      const maxWait = this.options.actionTimeout;
      const interval = 500;
      let waited = 0;

      while (waited < maxWait) {
        const result = await this.sendToContent('EXTRACT_TEXT', {
          selector: args.selector,
        });

        if (result.success) {
          return { success: true, message: `Element found: ${args.selector}` };
        }

        await this.sleep(interval);
        waited += interval;
      }

      return { success: false, message: `Timeout waiting for: ${args.selector}` };
    }

    return { success: true };
  }

  /**
   * Fill form
   */
  private async fillForm(args: Record<string, unknown>): Promise<ActionResult> {
    const fields = args.fields as Array<{ name?: string; selector?: string; value: string }>;
    
    if (!fields || fields.length === 0) {
      return { success: false, message: 'No fields to fill' };
    }

    const results: ActionResult[] = [];

    for (const field of fields) {
      const selector = field.selector || `[name="${field.name}"]`;
      const result = await this.sendToContent('TYPE', {
        selector,
        text: field.value,
        options: { clearFirst: true },
      });
      results.push(result);
    }

    const allSuccess = results.every(r => r.success);
    const failedCount = results.filter(r => !r.success).length;

    if (args.submit && allSuccess) {
      await this.sendToContent('CLICK', {
        selector: `${args.formSelector} button[type="submit"], ${args.formSelector} input[type="submit"]`,
      });
    }

    return {
      success: allSuccess,
      message: allSuccess 
        ? `Filled ${fields.length} fields` 
        : `${failedCount} fields failed to fill`,
      data: { results },
    };
  }

  /**
   * Cancel current execution
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * Get current plan
   */
  getCurrentPlan(): AgentPlan | null {
    return this.currentPlan;
  }

  /**
   * Check if executing
   */
  getIsExecuting(): boolean {
    return this.isExecuting;
  }

  /**
   * Update options
   */
  updateOptions(options: Partial<ExecutorOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const actionExecutor = new ActionExecutor();
export default actionExecutor;
