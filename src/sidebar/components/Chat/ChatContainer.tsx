import React, { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';
import { InputArea } from './InputArea';
import { TypingIndicator } from './TypingIndicator';
import { ProviderSettings } from '../Settings/ProviderSettings';
import { useChatStore } from '../../stores/chatStore';
import { Bot } from 'lucide-react';

export const ChatContainer: React.FC = () => {
  const { messages, isLoading, sendMessage } = useChatStore();
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
        <ProviderSettings />
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Bot className="w-16 h-16 text-secondary mb-4" />
            <h2 className="text-lg font-medium mb-2">Welcome to Flux Agent</h2>
            <p className="text-sm text-secondary max-w-xs">
              I can help you navigate, fill forms, extract data, and automate tasks on any website.
            </p>
          </div>
        ) : (
          <>
            {messages.map(message => (
              <MessageBubble key={message.id} message={message} />
            ))}
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
