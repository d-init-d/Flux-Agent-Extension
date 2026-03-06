import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { InputComposer } from '../InputComposer';

describe('InputComposer', () => {
  it('keeps send disabled for whitespace-only input', async () => {
    const user = userEvent.setup();
    render(<InputComposer />);

    const textbox = screen.getByRole('textbox', { name: 'Message input' });
    const sendButton = screen.getByRole('button', { name: 'Send' });

    await user.type(textbox, '   ');
    expect(sendButton).toBeDisabled();
  });

  it('calls onSend with trimmed payload and resets input', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<InputComposer onSend={onSend} />);

    const textbox = screen.getByRole('textbox', { name: 'Message input' });
    const sendButton = screen.getByRole('button', { name: 'Send' });

    await user.type(textbox, '  run step  ');
    await user.click(sendButton);

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('run step');
    expect(textbox).toHaveValue('');
  });

  it('shows full default command list when input is only slash', async () => {
    const user = userEvent.setup();
    render(<InputComposer />);

    const textbox = screen.getByRole('textbox', { name: 'Message input' });
    await user.type(textbox, '/');

    expect(screen.getByText('/screenshot')).toBeInTheDocument();
    expect(screen.getByText('/extract')).toBeInTheDocument();
    expect(screen.getByText('/settings')).toBeInTheDocument();
    expect(screen.getByText('/summarize')).toBeInTheDocument();
  });

  it('hides slash list after submitting a slash command message', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<InputComposer onSend={onSend} />);

    const textbox = screen.getByRole('textbox', { name: 'Message input' });
    await user.type(textbox, '/extract');

    expect(screen.getByTestId('slash-command-list')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(onSend).toHaveBeenCalledWith('/extract');
    expect(screen.queryByTestId('slash-command-list')).not.toBeInTheDocument();
  });

  it('supports arrow navigation and enter selection in slash autocomplete', async () => {
    const user = userEvent.setup();
    render(<InputComposer />);

    const textbox = screen.getByRole('textbox', { name: 'Message input' });
    await user.type(textbox, '/');

    const screenshotOption = screen.getByRole('option', { name: /\/screenshot/i });
    const extractOption = screen.getByRole('option', { name: /\/extract/i });

    expect(screenshotOption).toHaveAttribute('aria-selected', 'true');
    expect(extractOption).toHaveAttribute('aria-selected', 'false');

    await user.keyboard('{ArrowDown}');

    expect(screenshotOption).toHaveAttribute('aria-selected', 'false');
    expect(extractOption).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Enter}');
    expect(textbox).toHaveValue('/extract ');
  });

  it('supports ArrowUp wrap-around to the last autocomplete option', async () => {
    const user = userEvent.setup();
    render(<InputComposer />);

    const textbox = screen.getByRole('textbox', { name: 'Message input' });
    await user.type(textbox, '/');

    const screenshotOption = screen.getByRole('option', { name: /\/screenshot/i });
    const summarizeOption = screen.getByRole('option', { name: /\/summarize/i });

    expect(screenshotOption).toHaveAttribute('aria-selected', 'true');
    expect(summarizeOption).toHaveAttribute('aria-selected', 'false');

    await user.keyboard('{ArrowUp}');

    expect(screenshotOption).toHaveAttribute('aria-selected', 'false');
    expect(summarizeOption).toHaveAttribute('aria-selected', 'true');
  });

  it('supports tab and mouse click selection in slash autocomplete', async () => {
    const user = userEvent.setup();
    render(<InputComposer />);

    const textbox = screen.getByRole('textbox', { name: 'Message input' });
    await user.type(textbox, '/se');
    await user.keyboard('{Tab}');

    expect(textbox).toHaveValue('/settings ');

    await user.clear(textbox);
    await user.type(textbox, '/');
    await user.click(screen.getByRole('option', { name: /\/screenshot/i }));

    expect(textbox).toHaveValue('/screenshot ');
  });

  it('does not send message on Ctrl+Enter before U-03c', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<InputComposer onSend={onSend} />);

    const textbox = screen.getByRole('textbox', { name: 'Message input' });
    await user.type(textbox, 'Draft command');
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(onSend).not.toHaveBeenCalled();
    expect(textbox).toHaveValue('Draft command');
  });

  it('adds newline on Shift+Enter during multiline editing', async () => {
    const user = userEvent.setup();
    render(<InputComposer />);

    const textbox = screen.getByRole('textbox', { name: 'Message input' });
    await user.type(textbox, 'Line one{Shift>}{Enter}{/Shift}Line two');

    expect(textbox).toHaveValue('Line one\nLine two');
  });

  it('does not consume Shift+Enter while in slash mode autocomplete', async () => {
    const user = userEvent.setup();
    render(<InputComposer />);

    const textbox = screen.getByRole('textbox', { name: 'Message input' });
    await user.type(textbox, '/se');
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    expect(textbox).toHaveValue('/se\n');
    expect(screen.getByTestId('slash-command-list')).toBeInTheDocument();
    expect(screen.getByText('No commands found.')).toBeInTheDocument();
  });

  it('auto-resizes textarea and caps height at max size', () => {
    render(<InputComposer />);

    const textbox = screen.getByRole('textbox', { name: 'Message input' }) as HTMLTextAreaElement;

    let mockScrollHeight = 80;
    Object.defineProperty(textbox, 'scrollHeight', {
      configurable: true,
      get: () => mockScrollHeight,
    });

    fireEvent.change(textbox, { target: { value: 'Short note' } });
    expect(textbox.style.height).toBe('80px');
    expect(textbox.style.overflowY).toBe('hidden');

    mockScrollHeight = 320;
    fireEvent.change(textbox, { target: { value: 'Very long\n'.repeat(50) } });

    expect(textbox.style.height).toBe('160px');
    expect(textbox.style.overflowY).toBe('auto');
  });
});
