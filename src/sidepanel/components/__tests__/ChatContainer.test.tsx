import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChatContainer, MOCK_CONVERSATION } from '../ChatContainer';

describe('ChatContainer', () => {
  it('renders the mock conversation with all four bubble variants', () => {
    render(<ChatContainer messages={MOCK_CONVERSATION} />);

    expect(screen.getByLabelText('Chat conversation')).toBeInTheDocument();
    expect(screen.getByTestId('message-bubble-user')).toBeInTheDocument();
    expect(screen.getByTestId('message-bubble-assistant')).toBeInTheDocument();
    expect(screen.getByTestId('message-bubble-action')).toBeInTheDocument();
    expect(screen.getByTestId('message-bubble-error')).toBeInTheDocument();
    expect(screen.queryByText('Start a conversation')).not.toBeInTheDocument();
  });

  it('shows the empty state when no messages are provided', () => {
    render(<ChatContainer />);

    expect(screen.getByText('Start a conversation')).toBeInTheDocument();
    expect(screen.queryByTestId('message-bubble-user')).not.toBeInTheDocument();
  });
});
