import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildComparePricesPrompt,
  buildExtractTableDataPrompt,
  buildFillFormFromProfilePrompt,
  buildMonitorPageChangesPrompt,
} from '@core/ai-client/prompts/templates';
import { Button } from '@/ui/components';
import { ErrorCode } from '@shared/errors';
import { FILE_UPLOAD_LIMITS, type SerializedFileUpload } from '@shared/types';
import { generateId } from '@shared/utils';

interface SlashCommand {
  id: string;
  command: string;
  description: string;
  insertText?: string;
}

interface InputComposerProps {
  onSend?: (value: string, uploads?: SerializedFileUpload[]) => void | Promise<void>;
  commands?: SlashCommand[];
  disabled?: boolean;
}

interface SelectedUpload {
  id: string;
  file: File;
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

  const nextHeight = Math.min(
    Math.max(textarea.scrollHeight, INPUT_MIN_HEIGHT_PX),
    INPUT_MAX_HEIGHT_PX,
  );
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

export function InputComposer({
  onSend,
  commands = DEFAULT_COMMANDS,
  disabled = false,
}: InputComposerProps) {
  const [inputValue, setInputValue] = useState('');
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const [selectedUploads, setSelectedUploads] = useState<SelectedUpload[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const commandListId = 'sidepanel-command-list';
  const commandLabelId = 'sidepanel-command-label';
  const commandHintId = 'sidepanel-command-hint';

  const isSlashMode = inputValue.startsWith('/');
  const normalizedValue = inputValue.trim();
  const canSend = normalizedValue.length > 0 && !disabled && !isSending;

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

    void submitMessage();
  };

  const submitMessage = async (): Promise<void> => {
    try {
      setIsSending(true);
      setUploadError(null);
      const uploads = await serializeUploads(selectedUploads);
      const outgoingValue = expandSlashCommandValue(normalizedValue, commands);
      await onSend?.(outgoingValue, uploads.length > 0 ? uploads : undefined);
      setInputValue('');
      setSelectedUploads([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Failed to prepare files for upload');
    } finally {
      setIsSending(false);
    }
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

  const handleFileSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.target.files ?? []);

    try {
      validateFiles(nextFiles);
      setSelectedUploads(nextFiles.map((file) => ({ id: `file-${generateId(10)}`, file })));
      setUploadError(null);
    } catch (error) {
      setSelectedUploads([]);
      setUploadError(error instanceof Error ? error.message : 'Failed to select files');
    } finally {
      event.target.value = '';
    }
  };

  const handleRemoveUpload = (id: string) => {
    setSelectedUploads((current) => current.filter((upload) => upload.id !== id));
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="sr-only"
        aria-label="Choose files to upload"
        onChange={handleFileSelection}
        disabled={disabled || isSending}
      />

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
                  <span className="ml-2 text-[rgb(var(--color-text-secondary))]">
                    {item.description}
                  </span>
                </li>
              ))
            ) : (
              <li className="px-3 py-2 text-sm text-[rgb(var(--color-text-secondary))]">
                No commands found.
              </li>
            )}
          </ul>
        </section>
      )}

      {selectedUploads.length > 0 ? (
        <section
          className="mb-2 rounded-xl border border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-secondary))] px-3 py-2"
          aria-label="Selected files"
        >
          <div className="mb-2 text-xs font-medium tracking-tight text-[rgb(var(--color-text-secondary))]">
            {selectedUploads.length} file{selectedUploads.length === 1 ? '' : 's'} ready for upload
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedUploads.map((upload) => (
              <button
                key={upload.id}
                type="button"
                onClick={() => handleRemoveUpload(upload.id)}
                className="inline-flex items-center gap-2 rounded-full border border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-primary))] px-3 py-1 text-xs text-[rgb(var(--color-text-primary))]"
              >
                <span>{upload.file.name}</span>
                <span className="text-[rgb(var(--color-text-secondary))]">
                  {formatFileSize(upload.file.size)}
                </span>
                <span aria-hidden="true">x</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {uploadError ? (
        <p className="mb-2 text-sm text-[rgb(var(--color-error-700))]" role="status">
          {uploadError}
        </p>
      ) : null}

      <form className="flex w-full items-end gap-2" onSubmit={handleSubmit}>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="min-w-24"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || isSending}
        >
          Attach
        </Button>

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
          placeholder={
            disabled || isSending
              ? 'Wait for the current response to finish...'
              : 'Type a message or command...'
          }
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

function validateFiles(files: File[]): void {
  if (files.length > FILE_UPLOAD_LIMITS.maxFilesPerMessage) {
    throw new Error(
      `Select up to ${FILE_UPLOAD_LIMITS.maxFilesPerMessage} files at a time (${ErrorCode.FILE_UPLOAD_LIMIT_EXCEEDED})`,
    );
  }

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > FILE_UPLOAD_LIMITS.maxTotalSizeBytes) {
    throw new Error(
      `Selected files exceed ${formatFileSize(FILE_UPLOAD_LIMITS.maxTotalSizeBytes)} total (${ErrorCode.FILE_UPLOAD_LIMIT_EXCEEDED})`,
    );
  }

  for (const file of files) {
    if (file.size > FILE_UPLOAD_LIMITS.maxFileSizeBytes) {
      throw new Error(
        `File "${file.name}" exceeds ${formatFileSize(FILE_UPLOAD_LIMITS.maxFileSizeBytes)} (${ErrorCode.FILE_UPLOAD_LIMIT_EXCEEDED})`,
      );
    }
  }
}

async function serializeUploads(uploads: SelectedUpload[]): Promise<SerializedFileUpload[]> {
  return Promise.all(
    uploads.map(async ({ id, file }) => ({
      id,
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      lastModified: file.lastModified,
      base64Data: await fileToBase64(file),
    })),
  );
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }

  return btoa(binary);
}

function formatFileSize(value: number): string {
  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
