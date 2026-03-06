import { ActionLogPanel, MOCK_ACTION_LOG } from './components/ActionLogPanel';
import { ChatContainer, MOCK_CONVERSATION } from './components/ChatContainer';
import { InputComposer } from './components/InputComposer';

export function App() {
  return (
    <div className="flex h-screen min-h-0 flex-col bg-[rgb(var(--color-bg-primary))] text-[rgb(var(--color-text-primary))]">
      <header
        className="border-b border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-secondary))] px-4 py-4 sm:px-6"
        data-testid="sidepanel-header"
      >
        <div className="mx-auto flex w-full max-w-3xl items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold leading-snug tracking-tight">Flux Agent</h1>
            <p className="mt-1 text-sm text-[rgb(var(--color-text-secondary))]">
              Side Panel Assistant
            </p>
          </div>

          <span className="inline-flex h-7 items-center rounded-full border border-[rgb(var(--color-border-default))] px-3 text-xs font-medium text-[rgb(var(--color-text-secondary))]">
            Ready
          </span>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col" data-testid="sidepanel-chat-area">
        <div className="min-h-0 flex-1">
          <ChatContainer messages={MOCK_CONVERSATION} />
        </div>
        <ActionLogPanel actions={MOCK_ACTION_LOG} />
      </main>

      <footer
        className="border-t border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-primary))] px-4 py-3 sm:px-6"
        data-testid="sidepanel-input-section"
      >
        <InputComposer />
      </footer>
    </div>
  );
}
