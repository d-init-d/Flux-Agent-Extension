/**
 * Action History
 * Lưu và quản lý lịch sử các actions đã thực hiện
 */

import type { AgentPlan, AgentAction, AgentEvent } from './types';
import { logger } from '@shared/logger';

const HISTORY_STORAGE_KEY = 'flux_agent_history';
const MAX_HISTORY_ITEMS = 50;

/**
 * History entry
 */
export interface HistoryEntry {
  id: string;
  timestamp: number;
  goal: string;
  status: AgentPlan['status'];
  actionCount: number;
  successCount: number;
  failCount: number;
  duration: number;
  actions: HistoryAction[];
}

/**
 * Simplified action for history
 */
export interface HistoryAction {
  toolName: string;
  description: string;
  status: AgentAction['status'];
  duration: number;
  error?: string;
}

/**
 * Action History Manager
 */
export class ActionHistory {
  private entries: HistoryEntry[] = [];
  private loaded = false;

  /**
   * Load history from storage
   */
  async load(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(HISTORY_STORAGE_KEY);
      this.entries = result[HISTORY_STORAGE_KEY] || [];
      this.loaded = true;
      logger.debug(`Loaded ${this.entries.length} history entries`);
    } catch (error) {
      logger.error('Failed to load history:', error);
      this.entries = [];
    }
  }

  /**
   * Save history to storage
   */
  async save(): Promise<void> {
    try {
      // Trim to max size
      if (this.entries.length > MAX_HISTORY_ITEMS) {
        this.entries = this.entries.slice(-MAX_HISTORY_ITEMS);
      }
      
      await chrome.storage.local.set({ [HISTORY_STORAGE_KEY]: this.entries });
      logger.debug(`Saved ${this.entries.length} history entries`);
    } catch (error) {
      logger.error('Failed to save history:', error);
    }
  }

  /**
   * Add a completed plan to history
   */
  async addPlan(plan: AgentPlan): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }

    const actions: HistoryAction[] = plan.actions.map(a => ({
      toolName: a.toolName,
      description: a.description,
      status: a.status,
      duration: (a.endTime || Date.now()) - (a.startTime || plan.createdAt),
      error: a.error,
    }));

    const entry: HistoryEntry = {
      id: plan.id,
      timestamp: plan.createdAt,
      goal: plan.goal,
      status: plan.status,
      actionCount: plan.actions.length,
      successCount: plan.actions.filter(a => a.status === 'completed').length,
      failCount: plan.actions.filter(a => a.status === 'failed').length,
      duration: (plan.completedAt || Date.now()) - plan.createdAt,
      actions,
    };

    this.entries.push(entry);
    await this.save();
  }

  /**
   * Get all history entries
   */
  getAll(): HistoryEntry[] {
    return [...this.entries].reverse(); // Most recent first
  }

  /**
   * Get recent entries
   */
  getRecent(count = 10): HistoryEntry[] {
    return this.getAll().slice(0, count);
  }

  /**
   * Get entry by ID
   */
  getById(id: string): HistoryEntry | undefined {
    return this.entries.find(e => e.id === id);
  }

  /**
   * Clear all history
   */
  async clear(): Promise<void> {
    this.entries = [];
    await this.save();
  }

  /**
   * Delete specific entry
   */
  async delete(id: string): Promise<void> {
    this.entries = this.entries.filter(e => e.id !== id);
    await this.save();
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalPlans: number;
    totalActions: number;
    successRate: number;
    avgDuration: number;
    topTools: Array<{ tool: string; count: number }>;
  } {
    if (this.entries.length === 0) {
      return {
        totalPlans: 0,
        totalActions: 0,
        successRate: 0,
        avgDuration: 0,
        topTools: [],
      };
    }

    const totalPlans = this.entries.length;
    const totalActions = this.entries.reduce((sum, e) => sum + e.actionCount, 0);
    const totalSuccess = this.entries.reduce((sum, e) => sum + e.successCount, 0);
    const successRate = totalActions > 0 ? (totalSuccess / totalActions) * 100 : 0;
    const avgDuration = this.entries.reduce((sum, e) => sum + e.duration, 0) / totalPlans;

    // Count tool usage
    const toolCounts: Record<string, number> = {};
    for (const entry of this.entries) {
      for (const action of entry.actions) {
        toolCounts[action.toolName] = (toolCounts[action.toolName] || 0) + 1;
      }
    }

    const topTools = Object.entries(toolCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([tool, count]) => ({ tool, count }));

    return {
      totalPlans,
      totalActions,
      successRate: Math.round(successRate * 10) / 10,
      avgDuration: Math.round(avgDuration),
      topTools,
    };
  }

  /**
   * Search history
   */
  search(query: string): HistoryEntry[] {
    const lowerQuery = query.toLowerCase();
    return this.entries.filter(e => 
      e.goal.toLowerCase().includes(lowerQuery) ||
      e.actions.some(a => a.description.toLowerCase().includes(lowerQuery))
    ).reverse();
  }

  /**
   * Export history as JSON
   */
  export(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  /**
   * Import history from JSON
   */
  async import(json: string): Promise<number> {
    try {
      const imported = JSON.parse(json) as HistoryEntry[];
      const count = imported.length;
      
      // Merge with existing, avoiding duplicates
      const existingIds = new Set(this.entries.map(e => e.id));
      const newEntries = imported.filter(e => !existingIds.has(e.id));
      
      this.entries = [...this.entries, ...newEntries];
      await this.save();
      
      return newEntries.length;
    } catch (error) {
      logger.error('Failed to import history:', error);
      throw new Error('Invalid history format');
    }
  }
}

export const actionHistory = new ActionHistory();
export default actionHistory;
