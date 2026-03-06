import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../App';

describe('Side panel App (U-03 input baseline)', () => {
  it('renders header, chat area, and input section', () => {
    render(<App />);

    const header = screen.getByTestId('sidepanel-header');
    expect(within(header).getByRole('heading', { level: 1, name: 'Flux Agent' })).toBeInTheDocument();

    const chatArea = screen.getByTestId('sidepanel-chat-area');
    expect(within(chatArea).getByTestId('sidepanel-action-log')).toBeInTheDocument();
    expect(within(chatArea).getByRole('button', { name: 'Expand action log' })).toBeInTheDocument();
    expect(within(chatArea).getByRole('region', { name: 'Chat conversation' })).toBeInTheDocument();
    expect(within(chatArea).getByTestId('message-bubble-user')).toBeInTheDocument();
    expect(within(chatArea).getByTestId('message-bubble-assistant')).toBeInTheDocument();

    const inputSection = screen.getByTestId('sidepanel-input-section');
    expect(within(inputSection).getByRole('textbox', { name: 'Message input' })).toBeInTheDocument();
    expect(within(inputSection).getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('keeps semantic layout order and accessible input labeling', () => {
    const { container } = render(<App />);

    const root = container.firstElementChild as HTMLElement;
    expect(root).toBeTruthy();

    const children = Array.from(root.children);
    expect(children).toHaveLength(3);
    expect(children[0].tagName).toBe('HEADER');
    expect(children[1].tagName).toBe('MAIN');
    expect(children[2].tagName).toBe('FOOTER');

    const textarea = screen.getByLabelText('Message input');
    expect(textarea).toHaveAttribute('id', 'sidepanel-input');

    const chatRegion = screen.getByRole('region', { name: 'Chat conversation' });
    expect(chatRegion).toHaveAttribute('aria-live', 'polite');

    const mainChildren = Array.from(children[1]?.children ?? []);
    expect(mainChildren).toHaveLength(2);
    expect(mainChildren[0]).toContainElement(chatRegion);
    expect(mainChildren[1]).toHaveAttribute('data-testid', 'sidepanel-action-log');
  });

  it('enables send button when user types a message', async () => {
    const user = userEvent.setup();
    render(<App />);

    const textbox = screen.getByRole('textbox', { name: 'Message input' });
    const sendButton = screen.getByRole('button', { name: 'Send' });

    expect(sendButton).toBeDisabled();
    await user.type(textbox, 'Run extraction');
    expect(sendButton).toBeEnabled();
  });

  it('shows slash command list only when input starts with slash', async () => {
    const user = userEvent.setup();
    render(<App />);

    const textbox = screen.getByRole('textbox', { name: 'Message input' });

    expect(screen.queryByTestId('slash-command-list')).not.toBeInTheDocument();

    await user.type(textbox, '/');
    expect(screen.getByTestId('slash-command-list')).toBeInTheDocument();
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await user.clear(textbox);
    expect(screen.queryByTestId('slash-command-list')).not.toBeInTheDocument();
  });

  it('expands the action log timeline from the sidepanel layout', async () => {
    const user = userEvent.setup();
    render(<App />);

    const toggle = screen.getByRole('button', { name: 'Expand action log' });
    await user.click(toggle);

    expect(screen.getByRole('button', { name: 'Collapse action log' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('list', { name: 'Executed actions timeline' })).toBeInTheDocument();
    expect(screen.getByTestId('action-timeline-icon-log-1')).toHaveAttribute('data-status', 'done');
    expect(screen.getByTestId('action-timeline-icon-log-2')).toHaveAttribute('data-status', 'failed');
    expect(screen.getByTestId('action-timeline-icon-log-3')).toHaveAttribute('data-status', 'running');
    expect(screen.getByTestId('action-timeline-icon-log-4')).toHaveAttribute('data-status', 'pending');
  });

  it('filters baseline slash commands by typed prefix', async () => {
    const user = userEvent.setup();
    render(<App />);

    const textbox = screen.getByRole('textbox', { name: 'Message input' });
    await user.type(textbox, '/su');

    expect(screen.getByText('/summarize')).toBeInTheDocument();
    expect(screen.queryByText('/extract')).not.toBeInTheDocument();
  });
});
