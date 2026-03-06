import { render, screen, within } from '@testing-library/react';
import { App } from '../App';

describe('Side panel App (U-01 layout)', () => {
  it('renders header, chat area, and input section', () => {
    render(<App />);

    const header = screen.getByTestId('sidepanel-header');
    expect(within(header).getByRole('heading', { level: 1, name: 'Flux Agent' })).toBeInTheDocument();

    const chatArea = screen.getByTestId('sidepanel-chat-area');
    expect(within(chatArea).getByRole('region', { name: 'Chat conversation' })).toBeInTheDocument();
    expect(within(chatArea).getByText('Start a conversation')).toBeInTheDocument();

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
  });
});
