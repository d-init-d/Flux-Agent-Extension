import { FormEvent, useMemo, useState } from 'react';
import { Button } from '@/ui/components';

interface SlashCommand {
  id: string;
  command: string;
  description: string;
}

interface InputComposerProps {
  onSend?: (value: string) => void;
  commands?: SlashCommand[];
}

const DEFAULT_COMMANDS: SlashCommand[] = [
  {
    id: 'summarize',
    command: '/summarize',
    description: 'Summarize visible page content.',
  },
  {
    id: 'extract',
    command: '/extract',
    description: 'Extract structured data from current page.',
  },
  {
    id: 'click',
    command: '/click',
    description: 'Trigger an element interaction by selector.',
  },
  {
    id: 'wait',
    command: '/wait',
    description: 'Pause workflow for a short duration.',
  },
];

export function InputComposer({ onSend, commands = DEFAULT_COMMANDS }: InputComposerProps) {
  const [inputValue, setInputValue] = useState('');

  const isSlashMode = inputValue.startsWith('/');
  const normalizedValue = inputValue.trim();
  const canSend = normalizedValue.length > 0;

  const filteredCommands = useMemo(() => {
    if (!isSlashMode) {
      return [];
    }

    const query = inputValue.slice(1).toLowerCase();
    if (!query) {
      return commands;
    }

    return commands.filter((item) => item.command.slice(1).toLowerCase().startsWith(query));
  }, [commands, inputValue, isSlashMode]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!canSend) {
      return;
    }

    onSend?.(normalizedValue);
    setInputValue('');
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      {isSlashMode && (
        <section
          aria-label="Command suggestions"
          className="mb-2 overflow-hidden rounded-xl border border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-secondary))]"
          data-testid="slash-command-list"
        >
          <div className="border-b border-[rgb(var(--color-border-default))] px-3 py-2 text-xs font-medium tracking-tight text-[rgb(var(--color-text-secondary))]">
            Commands
          </div>

          <ul id="sidepanel-command-list" role="listbox" className="max-h-44 overflow-y-auto py-1">
            {filteredCommands.length > 0 ? (
              filteredCommands.map((item) => (
                <li
                  key={item.id}
                  role="option"
                  aria-selected="false"
                  className="px-3 py-2 text-sm leading-snug text-[rgb(var(--color-text-primary))]"
                >
                  <span className="font-medium tracking-tight">{item.command}</span>
                  <span className="ml-2 text-[rgb(var(--color-text-secondary))]">{item.description}</span>
                </li>
              ))
            ) : (
              <li className="px-3 py-2 text-sm text-[rgb(var(--color-text-secondary))]">No commands found.</li>
            )}
          </ul>
        </section>
      )}

      <form className="flex w-full items-end gap-2" onSubmit={handleSubmit}>
        <label htmlFor="sidepanel-input" className="sr-only">
          Message input
        </label>

        <textarea
          id="sidepanel-input"
          name="sidepanel-input"
          rows={2}
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder="Type a message or command..."
          aria-autocomplete="list"
          aria-controls={isSlashMode ? 'sidepanel-command-list' : undefined}
          aria-expanded={isSlashMode}
          className="min-h-11 max-h-32 w-full resize-y rounded-xl border border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-primary))] px-3 py-2 text-sm leading-snug text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-tertiary))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-border-focus))]"
        />

        <Button type="submit" size="lg" className="min-w-20" disabled={!canSend}>
          Send
        </Button>
      </form>
    </div>
  );
}
