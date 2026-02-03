import React, { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';
import { InputArea } from './InputArea';
import { TypingIndicator } from './TypingIndicator';
import { ProviderSettings } from '../Settings/ProviderSettings';
import { ActionPlanDisplay } from '../Agent/ActionPlanDisplay';
import { useChatStore } from '../../stores/chatStore';
import { Bot, Sparkles } from 'lucide-react';

export const ChatContainer: React.FC = () => {
  const { messages, isLoading, currentPlan, isAgentMode, toggleAgentMode, sendMessage } = useChatStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-700 bg-background-light">
        <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
          <Bot className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <h1 className="text-base font-semibold">Flux Agent</h1>
          <p className="text-xs text-secondary">AI Browser Assistant</p>
        </div>
        
        {/* Agent Mode Toggle */}
        <button
          onClick={toggleAgentMode}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs transition-colors ${
            isAgentMode 
              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' 
              : 'bg-gray-100 dark:bg-gray-700 text-gray-500'
          }`}
          title={isAgentMode ? 'Agent Mode: AI can use tools' : 'Chat Mode: Simple conversation'}
        >
          <Sparkles className="w-3.5 h-3.5" />
          {isAgentMode ? 'Agent' : 'Chat'}
        </button>
        
        <ProviderSettings />
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Bot className="w-16 h-16 text-secondary mb-4" />
            <h2 className="text-lg font-medium mb-2">Welcome to Flux Agent</h2>
            <p className="text-sm text-secondary max-w-xs">
              I can help you navigate, fill forms, extract data, and automate tasks on any website.
            </p>
            <p className="text-xs text-gray-400 mt-4">
              {isAgentMode ? 
                '🤖 Agent mode: AI can use tools to interact with the page' : 
                '💬 Chat mode: Simple conversation'}
            </p>
          </div>
        ) : (
          <>
            {messages.map(message => (
              <MessageBubble key={message.id} message={message} />
            ))}
            
            {/* Action Plan Display */}
            {currentPlan && <ActionPlanDisplay />}
            
            {isLoading && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input Area */}
      <InputArea onSend={sendMessage} disabled={isLoading} />
    </div>
  );
};
