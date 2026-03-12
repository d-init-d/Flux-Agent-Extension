import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from '../Modal';

// Helper: default props to reduce boilerplate
const defaultProps = {
  open: true,
  onClose: vi.fn(),
  title: 'Test Modal',
  children: <p>Modal body content</p>,
};

describe('Modal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up body overflow style after each test
    document.body.style.overflow = '';
  });

  // -------------------------------------------------------------------------
  // Open / Close
  // -------------------------------------------------------------------------

  it('renders nothing when open=false', () => {
    render(<Modal {...defaultProps} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders dialog when open=true', () => {
    render(<Modal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders content inside the dialog', () => {
    render(<Modal {...defaultProps} />);
    expect(screen.getByText('Modal body content')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // ARIA attributes
  // -------------------------------------------------------------------------

  it('has role="dialog" and aria-modal="true"', () => {
    render(<Modal {...defaultProps} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('sets aria-label to the title', () => {
    render(<Modal {...defaultProps} title="My Dialog" />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'My Dialog');
  });

  it('falls back to "Dialog" when no title provided', () => {
    render(<Modal {...defaultProps} title={undefined} />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Dialog');
  });

  // -------------------------------------------------------------------------
  // Title & Description
  // -------------------------------------------------------------------------

  it('renders title text', () => {
    render(<Modal {...defaultProps} title="Important" />);
    expect(screen.getByText('Important')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(<Modal {...defaultProps} description="Some extra info" />);
    expect(screen.getByText('Some extra info')).toBeInTheDocument();
  });

  it('sets aria-describedby when description is provided', () => {
    render(<Modal {...defaultProps} description="Description text" />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-describedby', 'modal-description');
  });

  // -------------------------------------------------------------------------
  // Footer
  // -------------------------------------------------------------------------

  it('renders footer when provided', () => {
    render(<Modal {...defaultProps} footer={<button>Confirm</button>} />);
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
  });

  it('does not render footer section when no footer prop', () => {
    const { container } = render(<Modal {...defaultProps} />);
    // The footer has a border-t class, check it's not present
    const footerDivs = container.querySelectorAll('.border-t');
    // In portal, check document.body
    const portalFooters = document.body.querySelectorAll('.border-t.border-border');
    expect(portalFooters.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Close button
  // -------------------------------------------------------------------------

  it('renders close button with aria-label="Close dialog"', () => {
    render(<Modal {...defaultProps} />);
    expect(screen.getByLabelText('Close dialog')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Modal {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByLabelText('Close dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Escape key
  // -------------------------------------------------------------------------

  it('calls onClose when Escape is pressed (closeOnEscape=true)', () => {
    const onClose = vi.fn();
    render(<Modal {...defaultProps} onClose={onClose} closeOnEscape />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose on Escape when closeOnEscape=false', () => {
    const onClose = vi.fn();
    render(<Modal {...defaultProps} onClose={onClose} closeOnEscape={false} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Backdrop click
  // -------------------------------------------------------------------------

  it('calls onClose when backdrop is clicked (closeOnBackdropClick=true)', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Modal {...defaultProps} onClose={onClose} closeOnBackdropClick />);

    // The backdrop has aria-hidden="true"
    const backdrop = document.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(backdrop).toBeTruthy();
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose on backdrop click when closeOnBackdropClick=false', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Modal {...defaultProps} onClose={onClose} closeOnBackdropClick={false} />);

    const backdrop = document.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(backdrop).toBeTruthy();
    await user.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Body scroll lock
  // -------------------------------------------------------------------------

  it('locks body scroll when open', () => {
    render(<Modal {...defaultProps} />);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('restores body scroll when closed', () => {
    const { rerender } = render(<Modal {...defaultProps} />);
    expect(document.body.style.overflow).toBe('hidden');

    rerender(<Modal {...defaultProps} open={false} />);
    expect(document.body.style.overflow).toBe('');
  });

  // -------------------------------------------------------------------------
  // Size classes
  // -------------------------------------------------------------------------

  it.each([
    ['sm', 'max-w-sm'],
    ['md', 'max-w-lg'],
    ['lg', 'max-w-2xl'],
    ['full', 'max-w-[calc(100vw-2rem)]'],
  ] as const)('applies correct size class for size="%s"', (size, expected) => {
    render(<Modal {...defaultProps} size={size} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain(expected);
  });

  // -------------------------------------------------------------------------
  // Portal rendering
  // -------------------------------------------------------------------------

  it('renders via createPortal into document.body', () => {
    const { container } = render(<Modal {...defaultProps} />);
    // The modal should NOT be inside the render container
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    // But should be in document.body
    expect(document.body.querySelector('[role="dialog"]')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Focus trap (basic Tab trap test)
  // -------------------------------------------------------------------------

  it('traps focus within the modal on Tab', async () => {
    render(
      <Modal {...defaultProps} footer={<button>Action</button>}>
        <input data-testid="modal-input" />
      </Modal>,
    );

    // Wait for the panel to be focused (50ms timeout in component)
    await waitFor(
      () => {
        expect(screen.getByRole('dialog')).toHaveFocus();
      },
      { timeout: 200 },
    );

    // Tab through: close button -> input -> action button -> back to close button
    const user = userEvent.setup();
    await user.tab();
    // The first focusable element (close button) should be focused
    expect(screen.getByLabelText('Close dialog')).toHaveFocus();
  });

  // -------------------------------------------------------------------------
  // Custom className
  // -------------------------------------------------------------------------

  it('merges custom className on the panel', () => {
    render(<Modal {...defaultProps} className="my-modal" />);
    expect(screen.getByRole('dialog').className).toContain('my-modal');
  });

  it('wraps focus from last to first element on Tab', async () => {
    render(
      <Modal {...defaultProps} footer={<button data-testid="footer-btn">OK</button>}>
        <button data-testid="body-btn">Body</button>
      </Modal>,
    );

    await waitFor(
      () => {
        expect(screen.getByRole('dialog')).toHaveFocus();
      },
      { timeout: 200 },
    );

    const footerBtn = screen.getByTestId('footer-btn');
    footerBtn.focus();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: false });

    expect(screen.getByLabelText('Close dialog')).toHaveFocus();
  });

  it('wraps focus from first to last element on Shift+Tab', async () => {
    render(
      <Modal {...defaultProps} footer={<button data-testid="footer-btn">OK</button>}>
        <button data-testid="body-btn">Body</button>
      </Modal>,
    );

    await waitFor(
      () => {
        expect(screen.getByRole('dialog')).toHaveFocus();
      },
      { timeout: 200 },
    );

    const closeBtn = screen.getByLabelText('Close dialog');
    closeBtn.focus();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true });

    expect(screen.getByTestId('footer-btn')).toHaveFocus();
  });

  it('does not trap when Tab key is not pressed', async () => {
    render(
      <Modal {...defaultProps} footer={<button data-testid="footer-btn">OK</button>}>
        <button data-testid="body-btn">Body</button>
      </Modal>,
    );

    await waitFor(
      () => {
        expect(screen.getByRole('dialog')).toHaveFocus();
      },
      { timeout: 200 },
    );

    const closeBtn = screen.getByLabelText('Close dialog');
    closeBtn.focus();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });

    expect(closeBtn).toHaveFocus();
  });

  it('restores focus to previously active element when closed', async () => {
    const triggerBtn = document.createElement('button');
    triggerBtn.textContent = 'Trigger';
    document.body.appendChild(triggerBtn);
    triggerBtn.focus();

    const { rerender } = render(<Modal {...defaultProps} />);

    await waitFor(
      () => {
        expect(screen.getByRole('dialog')).toHaveFocus();
      },
      { timeout: 200 },
    );

    rerender(<Modal {...defaultProps} open={false} />);

    expect(triggerBtn).toHaveFocus();
    document.body.removeChild(triggerBtn);
  });

  it('does not render description id when no description', () => {
    render(<Modal {...defaultProps} description={undefined} />);
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-describedby');
  });

  it('does not render title when not provided', () => {
    render(<Modal {...defaultProps} title={undefined} />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});
