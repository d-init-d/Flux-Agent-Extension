import { MessageBubble } from './MessageBubble';
import { MOCK_CONVERSATION } from './mockConversation';

import type { MessageBubbleProps } from './MessageBubble';

interface ChatContainerProps {
  messages?: MessageBubbleProps[];
}

export function ChatContainer({ messages = [] }: ChatContainerProps) {

  if (messages.length === 0) {
    return (
      <section
        aria-label="Chat conversation"
        aria-live="polite"
        aria-atomic="false"
        className="flex h-full flex-1 overflow-y-auto px-4 py-5 sm:px-6"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-1 items-center justify-center">
          <div className="w-full rounded-2xl border border-dashed border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-secondary))] p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[rgb(var(--color-primary-100))] text-[rgb(var(--color-primary-700))]">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                className="h-6 w-6"
                aria-hidden="true"
              >
                <path d="M12 3.25 3.75 7.5v9L12 20.75l8.25-4.25v-9L12 3.25Z" />
                <path d="M12 11.75 3.75 7.5" />
                <path d="M12 11.75 20.25 7.5" />
                <path d="M12 11.75v9" />
              </svg>
            </div>

            <h2 className="text-lg font-semibold tracking-tight text-[rgb(var(--color-text-primary))]">
              Start a conversation
            </h2>
            <p className="mt-2 text-sm leading-snug text-[rgb(var(--color-text-secondary))]">
              This panel is ready for U-01 layout. Message rendering and command parsing will
              be added in the next tasks.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Chat conversation"
      aria-live="polite"
      aria-atomic="false"
      className="flex h-full flex-1 overflow-y-auto px-4 py-5 sm:px-6"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 self-start pb-4">
        {messages.map((message) => (
          <MessageBubble key={message.id} {...message} />
        ))}
      </div>
    </section>
  );
}

export { MOCK_CONVERSATION };
