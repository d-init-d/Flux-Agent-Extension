import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
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
    id: 'screenshot',
    command: '/screenshot',
    description: 'Capture the current page as an image.',
  },
  {
    id: 'extract',
    command: '/extract',
    description: 'Extract structured data from current page.',
  },
  {
    id: 'settings',
    command: '/settings',
    description: 'Open extension settings and preferences.',
  },
  {
    id: 'summarize',
    command: '/summarize',
    description: 'Summarize visible page content.',
  },
];

export function InputComposer({ onSend, commands = DEFAULT_COMMANDS }: InputComposerProps) {
  const [inputValue, setInputValue] = useState('');
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  useEffect(() => {
    if (!isSlashMode || filteredCommands.length === 0) {
      setActiveCommandIndex(0);
      return;
    }

    setActiveCommandIndex((current) => {
      if (current < 0 || current >= filteredCommands.length) {
        return 0;
      }

      return current;
    });
  }, [filteredCommands.length, isSlashMode]);

  const applyCommand = (command: string) => {
    setInputValue(`${command} `);
    setActiveCommandIndex(0);
    inputRef.current?.focus();
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isSlashMode) {
      return;
    }

    if (event.key === 'ArrowDown') {
      if (filteredCommands.length === 0) {
        return;
      }

      event.preventDefault();
      setActiveCommandIndex((current) => (current + 1) % filteredCommands.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      if (filteredCommands.length === 0) {
        return;
      }

      event.preventDefault();
      setActiveCommandIndex((current) =>
        current === 0 ? filteredCommands.length - 1 : current - 1,
      );
      return;
    }

    if ((event.key === 'Enter' || event.key === 'Tab') && filteredCommands.length > 0) {
      event.preventDefault();
      const selected = filteredCommands[activeCommandIndex] ?? filteredCommands[0];
      applyCommand(selected.command);
    }
  };

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
              filteredCommands.map((item, index) => (
                <li
                  key={item.id}
                  id={`sidepanel-command-option-${item.id}`}
                  role="option"
                  aria-selected={index === activeCommandIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveCommandIndex(index)}
                  onClick={() => applyCommand(item.command)}
                  className={`cursor-pointer px-3 py-2 text-sm leading-snug text-[rgb(var(--color-text-primary))] transition-colors ${
                    index === activeCommandIndex
                      ? 'bg-[rgb(var(--color-border-default)/0.35)]'
                      : 'hover:bg-[rgb(var(--color-border-default)/0.25)]'
                  }`}
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
          ref={inputRef}
          id="sidepanel-input"
          name="sidepanel-input"
          rows={2}
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="Type a message or command..."
          aria-autocomplete="list"
          aria-controls={isSlashMode ? 'sidepanel-command-list' : undefined}
          aria-activedescendant={
            isSlashMode && filteredCommands.length > 0
              ? `sidepanel-command-option-${filteredCommands[activeCommandIndex]?.id}`
              : undefined
          }
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
