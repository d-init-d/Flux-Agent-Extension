/**
 * Flux Agent
 * Main agent controller that orchestrates planning and execution
 */

import { actionPlanner } from './planner';
import { actionExecutor } from './executor';
import { actionHistory } from './history';
import type { 
  AgentPlan, 
  AgentAction, 
  AgentState, 
  AgentEvent,
  ExecutorOptions,
} from './types';
import { DEFAULT_EXECUTOR_OPTIONS } from './types';
import { logger } from '@shared/logger';

type AgentEventCallback = (event: AgentEvent) => void;
type StateChangeCallback = (state: AgentState) => void;

/**
 * Main Agent class
 * Coordinates between planning, execution, and history
 */
export class FluxAgent {
  private state: AgentState = {
    currentPlan: null,
    planHistory: [],
    isExecuting: false,
    options: DEFAULT_EXECUTOR_OPTIONS,
  };

  private eventCallbacks: AgentEventCallback[] = [];
  private stateCallbacks: StateChangeCallback[] = [];

  constructor() {
    // Subscribe to executor events
    actionExecutor.onEvent(event => {
      this.handleExecutorEvent(event);
    });
  }

  /**
   * Initialize agent
   */
  async initialize(): Promise<void> {
    await actionHistory.load();
    logger.info('Flux Agent initialized');
  }

  /**
   * Subscribe to agent events
   */
  onEvent(callback: AgentEventCallback): () => void {
    this.eventCallbacks.push(callback);
    return () => {
      this.eventCallbacks = this.eventCallbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * Subscribe to state changes
   */
  onStateChange(callback: StateChangeCallback): () => void {
    this.stateCallbacks.push(callback);
    return () => {
      this.stateCallbacks = this.stateCallbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * Get current state
   */
  getState(): AgentState {
    return { ...this.state };
  }

  /**
   * Update state and notify subscribers
   */
  private updateState(updates: Partial<AgentState>): void {
    this.state = { ...this.state, ...updates };
    for (const callback of this.stateCallbacks) {
      try {
        callback(this.state);
      } catch (error) {
        logger.error('State callback error:', error);
      }
    }
  }

  /**
   * Handle user message - plan and optionally execute
   */
  async handleMessage(
    message: string,
    options: {
      pageContext?: string;
      autoExecute?: boolean;
    } = {}
  ): Promise<{
    response: string;
    plan: AgentPlan | null;
    executed: boolean;
  }> {
    const { pageContext, autoExecute = false } = options;

    // Create plan
    const { plan, response } = await actionPlanner.createPlan(message, pageContext);

    if (!plan) {
      return { response, plan: null, executed: false };
    }

    // Validate plan
    const validation = actionPlanner.validatePlan(plan);
    if (!validation.valid) {
      logger.warn('Plan validation failed:', validation.errors);
      return {
        response: `${response}\n\n⚠️ Some actions may not work: ${validation.errors.join(', ')}`,
        plan,
        executed: false,
      };
    }

    this.updateState({ currentPlan: plan });

    // Auto-execute if requested
    if (autoExecute) {
      await this.executePlan();
      return { response, plan: this.state.currentPlan, executed: true };
    }

    return { response, plan, executed: false };
  }

  /**
   * Execute current plan
   */
  async executePlan(): Promise<AgentPlan | null> {
    if (!this.state.currentPlan) {
      logger.warn('No plan to execute');
      return null;
    }

    if (this.state.isExecuting) {
      logger.warn('Already executing');
      return null;
    }

    this.updateState({ isExecuting: true });

    try {
      const result = await actionExecutor.execute(this.state.currentPlan);
      
      // Save to history
      await actionHistory.addPlan(result);
      
      this.updateState({ 
        currentPlan: result, 
        isExecuting: false,
        planHistory: [...this.state.planHistory, result],
      });

      return result;
    } catch (error) {
      logger.error('Plan execution failed:', error);
      this.updateState({ isExecuting: false });
      return null;
    }
  }

  /**
   * Execute a single action from current plan
   */
  async executeNextAction(): Promise<AgentAction | null> {
    if (!this.state.currentPlan) return null;

    const plan = this.state.currentPlan;
    if (plan.currentActionIndex >= plan.actions.length) {
      return null;
    }

    const action = plan.actions[plan.currentActionIndex];
    const result = await actionExecutor.executeAction(action);

    // Update action in plan
    plan.actions[plan.currentActionIndex] = {
      ...action,
      status: result.success ? 'completed' : 'failed',
      result,
      endTime: Date.now(),
    };
    plan.currentActionIndex++;

    this.updateState({ currentPlan: { ...plan } });

    return plan.actions[plan.currentActionIndex - 1];
  }

  /**
   * Cancel current execution
   */
  cancel(): void {
    actionExecutor.cancel();
    
    if (this.state.currentPlan) {
      this.updateState({
        currentPlan: { ...this.state.currentPlan, status: 'cancelled' },
        isExecuting: false,
      });
    }
  }

  /**
   * Clear current plan
   */
  clearPlan(): void {
    this.updateState({ currentPlan: null });
  }

  /**
   * Update executor options
   */
  updateOptions(options: Partial<ExecutorOptions>): void {
    const newOptions = { ...this.state.options, ...options };
    this.updateState({ options: newOptions });
    actionExecutor.updateOptions(newOptions);
  }

  /**
   * Get action history
   */
  getHistory() {
    return actionHistory;
  }

  /**
   * Handle executor events
   */
  private handleExecutorEvent(event: AgentEvent): void {
    // Forward to subscribers
    for (const callback of this.eventCallbacks) {
      try {
        callback(event);
      } catch (error) {
        logger.error('Event callback error:', error);
      }
    }

    // Update state based on event
    switch (event.type) {
      case 'plan_completed':
      case 'plan_failed':
      case 'plan_cancelled':
        this.updateState({ isExecuting: false });
        break;
    }
  }

  /**
   * Retry failed plan
   */
  async retryPlan(): Promise<AgentPlan | null> {
    if (!this.state.currentPlan) return null;

    // Reset failed actions to pending
    const plan = { ...this.state.currentPlan };
    plan.actions = plan.actions.map(a => ({
      ...a,
      status: a.status === 'failed' ? 'pending' : a.status,
      retryCount: 0,
      error: undefined,
    }));
    plan.status = 'ready';
    plan.currentActionIndex = plan.actions.findIndex(a => a.status === 'pending');

    this.updateState({ currentPlan: plan });
    return this.executePlan();
  }

  /**
   * Get plan summary
   */
  getPlanSummary(plan?: AgentPlan): string {
    const p = plan || this.state.currentPlan;
    if (!p) return 'No plan';

    const completed = p.actions.filter(a => a.status === 'completed').length;
    const failed = p.actions.filter(a => a.status === 'failed').length;
    const pending = p.actions.filter(a => a.status === 'pending').length;

    return `Plan: ${p.goal}\nStatus: ${p.status}\nActions: ${completed}/${p.actions.length} completed, ${failed} failed, ${pending} pending`;
  }
}

export const fluxAgent = new FluxAgent();
export default fluxAgent;
