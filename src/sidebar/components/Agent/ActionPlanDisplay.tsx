/**
 * Action Plan Display Component
 * Hiển thị plan và progress của agent actions
 */

import React from 'react';
import { 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  Clock, 
  Play, 
  Square,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from 'lucide-react';
import { useAgentStore } from '../../stores/agentStore';
import type { AgentAction, ActionStatus } from '../../../agent/types';

const STATUS_ICONS: Record<ActionStatus, React.ReactNode> = {
  pending: <Clock className="w-4 h-4 text-gray-400" />,
  running: <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />,
  completed: <CheckCircle2 className="w-4 h-4 text-green-500" />,
  failed: <XCircle className="w-4 h-4 text-red-500" />,
  cancelled: <Square className="w-4 h-4 text-gray-500" />,
  retrying: <RefreshCw className="w-4 h-4 text-yellow-500 animate-spin" />,
};

const STATUS_COLORS: Record<ActionStatus, string> = {
  pending: 'bg-gray-100 dark:bg-gray-700',
  running: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
  completed: 'bg-green-50 dark:bg-green-900/20',
  failed: 'bg-red-50 dark:bg-red-900/20',
  cancelled: 'bg-gray-100 dark:bg-gray-700',
  retrying: 'bg-yellow-50 dark:bg-yellow-900/20',
};

interface ActionItemProps {
  action: AgentAction;
  index: number;
  isActive: boolean;
}

const ActionItem: React.FC<ActionItemProps> = ({ action, index, isActive }) => {
  return (
    <div 
      className={`flex items-start gap-3 p-3 rounded-lg transition-colors ${
        STATUS_COLORS[action.status]
      } ${isActive ? 'ring-2 ring-blue-400' : ''}`}
    >
      <div className="flex-shrink-0 mt-0.5">
        {STATUS_ICONS[action.status]}
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
            #{index + 1}
          </span>
          <span className="text-sm font-medium truncate">
            {action.description}
          </span>
        </div>
        
        {action.error && (
          <p className="text-xs text-red-600 dark:text-red-400 mt-1">
            {action.error}
          </p>
        )}
        
        {action.result?.message && action.status === 'completed' && (
          <p className="text-xs text-green-600 dark:text-green-400 mt-1">
            {action.result.message}
          </p>
        )}
      </div>

      {action.retryCount > 0 && (
        <span className="text-xs text-yellow-600 dark:text-yellow-400">
          Retry {action.retryCount}
        </span>
      )}
    </div>
  );
};

export const ActionPlanDisplay: React.FC = () => {
  const { 
    currentPlan, 
    isExecuting, 
    showPlanPreview,
    setShowPlanPreview,
    executePlan, 
    cancelExecution,
  } = useAgentStore();

  const [expanded, setExpanded] = React.useState(true);

  if (!currentPlan) return null;

  const completedCount = currentPlan.actions.filter(a => a.status === 'completed').length;
  const totalCount = currentPlan.actions.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-white dark:bg-gray-800 shadow-sm">
      {/* Header */}
      <div 
        className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-750 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">🤖</span>
          <div>
            <h3 className="text-sm font-semibold">Action Plan</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {completedCount}/{totalCount} actions completed
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Progress indicator */}
          <div className="w-24 h-2 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
            <div 
              className="h-full bg-green-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>

          {expanded ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </div>

      {/* Actions list */}
      {expanded && (
        <>
          <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
            {currentPlan.actions.map((action, index) => (
              <ActionItem 
                key={action.id}
                action={action}
                index={index}
                isActive={index === currentPlan.currentActionIndex && isExecuting}
              />
            ))}
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750">
            <span className={`text-xs font-medium ${
              currentPlan.status === 'completed' ? 'text-green-600' :
              currentPlan.status === 'failed' ? 'text-red-600' :
              currentPlan.status === 'executing' ? 'text-blue-600' :
              'text-gray-500'
            }`}>
              {currentPlan.status.charAt(0).toUpperCase() + currentPlan.status.slice(1)}
            </span>

            <div className="flex gap-2">
              {isExecuting ? (
                <button
                  onClick={cancelExecution}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                >
                  <Square className="w-4 h-4" />
                  Stop
                </button>
              ) : currentPlan.status === 'ready' && (
                <button
                  onClick={executePlan}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                  <Play className="w-4 h-4" />
                  Execute
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ActionPlanDisplay;
