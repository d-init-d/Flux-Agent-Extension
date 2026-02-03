/**
 * Agent Types
 * Types cho Agent System
 */

import type { ToolCall, ToolResult } from '../providers/types';

/**
 * Trạng thái của một action
 */
export type ActionStatus = 
  | 'pending'      // Chờ thực thi
  | 'running'      // Đang thực thi
  | 'completed'    // Hoàn thành
  | 'failed'       // Thất bại
  | 'cancelled'    // Bị hủy
  | 'retrying';    // Đang retry

/**
 * Một action trong plan
 */
export interface AgentAction {
  /** ID duy nhất */
  id: string;
  /** Tên tool */
  toolName: string;
  /** Arguments cho tool */
  arguments: Record<string, unknown>;
  /** Mô tả action (cho user) */
  description: string;
  /** Trạng thái */
  status: ActionStatus;
  /** Kết quả nếu có */
  result?: ActionResult;
  /** Thời gian bắt đầu */
  startTime?: number;
  /** Thời gian kết thúc */
  endTime?: number;
  /** Số lần retry */
  retryCount: number;
  /** Error message nếu failed */
  error?: string;
}

/**
 * Kết quả của một action
 */
export interface ActionResult {
  /** Thành công hay không */
  success: boolean;
  /** Data trả về */
  data?: unknown;
  /** Message */
  message?: string;
  /** Screenshot nếu có */
  screenshot?: string;
}

/**
 * Một plan hoàn chỉnh
 */
export interface AgentPlan {
  /** ID duy nhất */
  id: string;
  /** Goal/mục tiêu của plan */
  goal: string;
  /** Danh sách actions */
  actions: AgentAction[];
  /** Trạng thái tổng thể */
  status: 'planning' | 'ready' | 'executing' | 'completed' | 'failed' | 'cancelled';
  /** Thời gian tạo */
  createdAt: number;
  /** Thời gian bắt đầu thực thi */
  startedAt?: number;
  /** Thời gian hoàn thành */
  completedAt?: number;
  /** Index của action đang chạy */
  currentActionIndex: number;
  /** Lý do fail nếu có */
  failReason?: string;
}

/**
 * Options cho action executor
 */
export interface ExecutorOptions {
  /** Tự động tiếp tục khi một action hoàn thành */
  autoProgress: boolean;
  /** Dừng khi gặp lỗi */
  stopOnError: boolean;
  /** Số lần retry tối đa */
  maxRetries: number;
  /** Delay giữa các actions (ms) */
  actionDelay: number;
  /** Highlight element trước khi thực hiện action */
  highlightBeforeAction: boolean;
  /** Timeout cho mỗi action (ms) */
  actionTimeout: number;
}

/**
 * Default executor options
 */
export const DEFAULT_EXECUTOR_OPTIONS: ExecutorOptions = {
  autoProgress: true,
  stopOnError: true,
  maxRetries: 2,
  actionDelay: 500,
  highlightBeforeAction: true,
  actionTimeout: 30000,
};

/**
 * Event types cho agent
 */
export type AgentEventType =
  | 'plan_created'
  | 'plan_started'
  | 'plan_completed'
  | 'plan_failed'
  | 'plan_cancelled'
  | 'action_started'
  | 'action_completed'
  | 'action_failed'
  | 'action_retrying';

/**
 * Agent event
 */
export interface AgentEvent {
  type: AgentEventType;
  planId: string;
  actionId?: string;
  data?: unknown;
  timestamp: number;
}

/**
 * Agent state
 */
export interface AgentState {
  /** Plan hiện tại */
  currentPlan: AgentPlan | null;
  /** Lịch sử các plans */
  planHistory: AgentPlan[];
  /** Đang executing không */
  isExecuting: boolean;
  /** Executor options */
  options: ExecutorOptions;
}
