import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildComparePricesPrompt,
  buildExtractTableDataPrompt,
  buildFillFormFromProfilePrompt,
  buildMonitorPageChangesPrompt,
} from '@core/ai-client/prompts/templates';
import { Button } from '@/ui/components';

interface SlashCommand {
  id: string;
  command: string;
  description: string;
  insertText?: string;
}

interface InputComposerProps {
  onSend?: (value: string) => void;
  commands?: SlashCommand[];
  disabled?: boolean;
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
    id: 'extract-table',
    command: '/extract-table',
    description: 'Insert a prompt for extracting table data.',
    insertText: buildExtractTableDataPrompt(),
  },
  {
    id: 'compare-prices',
    command: '/compare-prices',
    description: 'Insert a prompt for comparing prices across relevant tabs.',
    insertText: buildComparePricesPrompt(),
  },
  {
    id: 'fill-from-profile',
    command: '/fill-from-profile',
    description: 'Insert a prompt for filling a form from saved profile data.',
    insertText: buildFillFormFromProfilePrompt(),
  },
  {
    id: 'monitor-page-changes',
    command: '/monitor-page-changes',
    description: 'Insert a prompt for checking the current page for meaningful changes.',
    insertText: buildMonitorPageChangesPrompt(),
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

const INPUT_MIN_HEIGHT_PX = 44;
const INPUT_MAX_HEIGHT_PX = 160;

function resizeTextarea(textarea: HTMLTextAreaElement): void {
  textarea.style.height = 'auto';

  const nextHeight = Math.min(Math.max(textarea.scrollHeight, INPUT_MIN_HEIGHT_PX), INPUT_MAX_HEIGHT_PX);
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = textarea.scrollHeight > INPUT_MAX_HEIGHT_PX ? 'auto' : 'hidden';
}

function getCommandInsertText(command: SlashCommand): string {
  return command.insertText ?? `${command.command} `;
}

function expandSlashCommandValue(value: string, commands: SlashCommand[]): string {
  const matchedCommand = commands.find((command) => command.command === value);
  if (!matchedCommand || !matchedCommand.insertText) {
    return value;
  }

  return matchedCommand.insertText;
}

export function InputComposer({ onSend, commands = DEFAULT_COMMANDS, disabled = false }: InputComposerProps) {
  const [inputValue, setInputValue] = useState('');
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const commandListId = 'sidepanel-command-list';
  const commandLabelId = 'sidepanel-command-label';
  const commandHintId = 'sidepanel-command-hint';

  const isSlashMode = inputValue.startsWith('/');
  const normalizedValue = inputValue.trim();
  const canSend = normalizedValue.length > 0 && !disabled;

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

  const activeOptionId =
    isSlashMode && filteredCommands.length > 0
      ? `sidepanel-command-option-${filteredCommands[activeCommandIndex]?.id}`
      : undefined;

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

  useEffect(() => {
    if (!inputRef.current) {
      return;
    }

    resizeTextarea(inputRef.current);
  }, [inputValue]);

  const applyCommand = (command: SlashCommand) => {
    setInputValue(getCommandInsertText(command));
    setActiveCommandIndex(0);
    inputRef.current?.focus();
  };

  const submitInput = () => {
    if (!canSend) {
      return;
    }

    onSend?.(expandSlashCommandValue(normalizedValue, commands));
    setInputValue('');
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const isSubmitShortcut =
      event.key === 'Enter' && !event.shiftKey && !event.altKey && (event.ctrlKey || event.metaKey);

    if (isSubmitShortcut) {
      event.preventDefault();
      submitInput();
      return;
    }

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

    const isAutocompleteEnter =
      event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
    const isAutocompleteTab = event.key === 'Tab' && !event.shiftKey;

    if ((isAutocompleteEnter || isAutocompleteTab) && filteredCommands.length > 0) {
      event.preventDefault();
      const selected = filteredCommands[activeCommandIndex] ?? filteredCommands[0];
      applyCommand(selected);
    }
  };

  const handleInputChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(event.target.value);
    resizeTextarea(event.currentTarget);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitInput();
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      {isSlashMode && (
        <section
          aria-label="Command suggestions"
          className="mb-2 overflow-hidden rounded-xl border border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-secondary))]"
          data-testid="slash-command-list"
        >
          <div
            id={commandLabelId}
            className="border-b border-[rgb(var(--color-border-default))] px-3 py-2 text-xs font-medium tracking-tight text-[rgb(var(--color-text-secondary))]"
          >
            Commands
          </div>

          <p id={commandHintId} className="sr-only" aria-live="polite">
            {filteredCommands.length > 0
              ? `${filteredCommands.length} command suggestions available. Use arrow keys to review and Enter or Tab to apply.`
              : 'No command suggestions available.'}
          </p>

          <ul
            id={commandListId}
            role="listbox"
            aria-labelledby={commandLabelId}
            className="max-h-44 overflow-y-auto py-1"
          >
            {filteredCommands.length > 0 ? (
              filteredCommands.map((item, index) => (
                <li
                  key={item.id}
                  id={`sidepanel-command-option-${item.id}`}
                  role="option"
                  aria-selected={index === activeCommandIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveCommandIndex(index)}
                  onClick={() => applyCommand(item)}
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
          disabled={disabled}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          placeholder={disabled ? 'Wait for the current response to finish...' : 'Type a message or command...'}
          aria-autocomplete="list"
          aria-haspopup={isSlashMode ? 'listbox' : undefined}
          aria-keyshortcuts="Control+Enter Meta+Enter"
          aria-controls={isSlashMode ? commandListId : undefined}
          aria-describedby={isSlashMode ? commandHintId : undefined}
          aria-activedescendant={activeOptionId}
          aria-expanded={isSlashMode}
          className="min-h-11 w-full resize-none rounded-xl border border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-primary))] px-3 py-2 text-sm leading-snug text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-tertiary))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-border-focus))]"
        />

        <Button type="submit" size="lg" className="min-w-20" disabled={!canSend}>
          Send
        </Button>
      </form>
    </div>
  );
}
