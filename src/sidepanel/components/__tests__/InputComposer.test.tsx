import { render, screen } from '@testing-library/react';
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

    expect(screen.getByText('/summarize')).toBeInTheDocument();
    expect(screen.getByText('/extract')).toBeInTheDocument();
    expect(screen.getByText('/click')).toBeInTheDocument();
    expect(screen.getByText('/wait')).toBeInTheDocument();
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
});
