import { Button } from '@/ui/components';
import { ChatContainer } from './components/ChatContainer';

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

      <main className="min-h-0 flex-1" data-testid="sidepanel-chat-area">
        <ChatContainer />
      </main>

      <footer
        className="border-t border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-primary))] px-4 py-3 sm:px-6"
        data-testid="sidepanel-input-section"
      >
        <form className="mx-auto flex w-full max-w-3xl items-end gap-2" onSubmit={(event) => event.preventDefault()}>
          <label htmlFor="sidepanel-input" className="sr-only">
            Message input
          </label>

          <textarea
            id="sidepanel-input"
            name="sidepanel-input"
            rows={2}
            placeholder="Type a message or command..."
            className="min-h-11 max-h-32 w-full resize-y rounded-xl border border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-primary))] px-3 py-2 text-sm leading-snug text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-tertiary))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-border-focus))]"
          />

          <Button type="submit" size="lg" className="min-w-20" disabled>
            Send
          </Button>
        </form>
      </footer>
    </div>
  );
}
