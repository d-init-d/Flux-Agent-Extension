/**
 * Action Planner
 * AI lên kế hoạch thực hiện multi-step actions
 */

import { providerManager } from '../providers';
import { allTools, getToolByName } from './tools';
import type { AgentPlan, AgentAction } from './types';
import type { ToolCall, ChatMessage } from '../providers/types';
import { logger } from '@shared/logger';
import { generateId } from '@shared/utils';

/**
 * System prompt cho agent mode
 */
const AGENT_SYSTEM_PROMPT = `You are Flux Agent, an AI assistant that can control web browsers.

## Your Capabilities
You have access to tools that let you interact with web pages:
- Click on buttons, links, and other elements
- Type text into input fields
- Scroll the page
- Hover over elements
- Extract text, tables, and links
- Take screenshots
- Navigate to URLs
- Fill out forms

## How to Respond
1. When the user asks you to do something on a webpage, analyze what needs to be done
2. Break down complex tasks into simple steps
3. Use the appropriate tools to accomplish each step
4. Explain what you're doing at each step
5. If you encounter an error, try an alternative approach

## Important Guidelines
- Always confirm destructive actions before executing
- If you're unsure about an element's selector, use text content or description
- For forms, try to fill all required fields before submitting
- If a page needs to load, use the wait tool
- Take screenshots when useful to show progress

## Current Context
You are viewing a webpage. The user will describe what they want to accomplish.
Analyze the task and use your tools to help them.`;

/**
 * Create a plan from AI tool calls
 */
function createPlanFromToolCalls(
  goal: string,
  toolCalls: ToolCall[]
): AgentPlan {
  const actions: AgentAction[] = toolCalls.map((tc, index) => ({
    id: generateId(),
    toolName: tc.name,
    arguments: tc.arguments,
    description: generateActionDescription(tc.name, tc.arguments),
    status: 'pending',
    retryCount: 0,
  }));

  return {
    id: generateId(),
    goal,
    actions,
    status: 'ready',
    createdAt: Date.now(),
    currentActionIndex: 0,
  };
}

/**
 * Generate human-readable description for an action
 */
function generateActionDescription(
  toolName: string,
  args: Record<string, unknown>
): string {
  switch (toolName) {
    case 'click':
      if (args.text) return `Click on "${args.text}"`;
      if (args.description) return `Click on ${args.description}`;
      if (args.selector) return `Click on element: ${args.selector}`;
      return 'Click on element';

    case 'type':
      const field = args.fieldName || args.selector || 'input field';
      const text = args.text as string;
      const preview = text.length > 20 ? text.slice(0, 20) + '...' : text;
      return `Type "${preview}" into ${field}`;

    case 'scroll':
      if (args.selector) return `Scroll to element: ${args.selector}`;
      if (args.direction) return `Scroll ${args.direction}`;
      return 'Scroll page';

    case 'hover':
      if (args.text) return `Hover over "${args.text}"`;
      if (args.selector) return `Hover over element: ${args.selector}`;
      return 'Hover over element';

    case 'extract_text':
      return `Extract text from: ${args.selector}`;

    case 'extract_table':
      return `Extract table data${args.selector ? ` from ${args.selector}` : ''}`;

    case 'extract_links':
      return `Extract links${args.selector ? ` from ${args.selector}` : ' from page'}`;

    case 'screenshot':
      if (args.fullPage) return 'Take full page screenshot';
      if (args.selector) return `Take screenshot of: ${args.selector}`;
      return 'Take screenshot of viewport';

    case 'get_page_info':
      return 'Get page information';

    case 'navigate':
      if (args.url) return `Navigate to: ${args.url}`;
      if (args.action) return `Navigate: ${args.action}`;
      return 'Navigate';

    case 'wait':
      if (args.selector) return `Wait for element: ${args.selector}`;
      if (args.text) return `Wait for text: "${args.text}"`;
      if (args.milliseconds) return `Wait ${args.milliseconds}ms`;
      return 'Wait';

    case 'fill_form':
      return `Fill form with ${(args.fields as unknown[])?.length || 0} fields`;

    default:
      return `Execute ${toolName}`;
  }
}

/**
 * Planner class
 */
export class ActionPlanner {
  /**
   * Create a plan for a user request
   */
  async createPlan(
    userMessage: string,
    pageContext?: string
  ): Promise<{ plan: AgentPlan | null; response: string }> {
    const provider = providerManager.getCurrentProvider();
    
    if (!provider || !provider.isReady()) {
      return {
        plan: null,
        response: 'No AI provider configured. Please add an API key in settings.',
      };
    }

    const messages: ChatMessage[] = [];

    // Add page context if available
    if (pageContext) {
      messages.push({
        role: 'user',
        content: `Current page context:\n${pageContext}`,
      });
      messages.push({
        role: 'assistant',
        content: 'I can see the page. How can I help you?',
      });
    }

    // Add user message
    messages.push({
      role: 'user',
      content: userMessage,
    });

    try {
      const response = await provider.chat(messages, {
        systemPrompt: AGENT_SYSTEM_PROMPT,
        tools: allTools,
        temperature: 0.3, // Lower temperature for more consistent tool usage
      });

      // Check if AI wants to use tools
      if (response.toolCalls && response.toolCalls.length > 0) {
        const plan = createPlanFromToolCalls(userMessage, response.toolCalls);
        
        // Generate explanation text
        let explanation = response.content || '';
        if (!explanation) {
          explanation = `I'll help you with that. Here's my plan:\n\n`;
          plan.actions.forEach((action, i) => {
            explanation += `${i + 1}. ${action.description}\n`;
          });
        }

        return { plan, response: explanation };
      }

      // No tools - just a text response
      return {
        plan: null,
        response: response.content,
      };
    } catch (error) {
      logger.error('Failed to create plan:', error);
      return {
        plan: null,
        response: `Error: ${String(error)}`,
      };
    }
  }

  /**
   * Continue planning after tool results
   */
  async continuePlanning(
    originalGoal: string,
    previousActions: AgentAction[],
    toolResults: { toolCallId: string; result: unknown; error?: string }[],
    pageContext?: string
  ): Promise<{ plan: AgentPlan | null; response: string; complete: boolean }> {
    const provider = providerManager.getCurrentProvider();
    
    if (!provider || !provider.isReady()) {
      return {
        plan: null,
        response: 'Provider not available',
        complete: true,
      };
    }

    const messages: ChatMessage[] = [];

    // Build conversation history
    if (pageContext) {
      messages.push({
        role: 'user',
        content: `Current page context:\n${pageContext}`,
      });
    }

    messages.push({
      role: 'user',
      content: originalGoal,
    });

    // Add previous actions as assistant messages
    // This simulates the conversation flow with tool use

    try {
      const response = await provider.chat(messages, {
        systemPrompt: AGENT_SYSTEM_PROMPT,
        tools: allTools,
        toolResults: toolResults.map(tr => ({
          toolCallId: tr.toolCallId,
          result: tr.result,
          error: tr.error,
        })),
      });

      if (response.toolCalls && response.toolCalls.length > 0) {
        const plan = createPlanFromToolCalls(originalGoal, response.toolCalls);
        return {
          plan,
          response: response.content || 'Continuing with next steps...',
          complete: false,
        };
      }

      return {
        plan: null,
        response: response.content,
        complete: true,
      };
    } catch (error) {
      logger.error('Failed to continue planning:', error);
      return {
        plan: null,
        response: `Error: ${String(error)}`,
        complete: true,
      };
    }
  }

  /**
   * Validate a plan before execution
   */
  validatePlan(plan: AgentPlan): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!plan.actions || plan.actions.length === 0) {
      errors.push('Plan has no actions');
    }

    for (const action of plan.actions) {
      const tool = getToolByName(action.toolName);
      if (!tool) {
        errors.push(`Unknown tool: ${action.toolName}`);
      }

      // Check required parameters
      if (tool?.parameters.required) {
        for (const required of tool.parameters.required) {
          if (!(required in action.arguments)) {
            errors.push(`Missing required parameter '${required}' for ${action.toolName}`);
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

export const actionPlanner = new ActionPlanner();
export default actionPlanner;
