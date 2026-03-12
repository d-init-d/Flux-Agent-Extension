import React, { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ModalSize = 'sm' | 'md' | 'lg' | 'full';

interface ModalProps {
  /** Whether the modal is currently visible */
  open: boolean;
  /** Called when the modal should close (backdrop click, Escape key, close button) */
  onClose: () => void;
  /** Width preset */
  size?: ModalSize;
  /** Optional title rendered in the header */
  title?: string;
  /** Optional description rendered below the title */
  description?: string;
  /** Main content */
  children: React.ReactNode;
  /** Footer content (e.g. action buttons) */
  footer?: React.ReactNode;
  /** Whether clicking the backdrop closes the modal */
  closeOnBackdropClick?: boolean;
  /** Whether pressing Escape closes the modal */
  closeOnEscape?: boolean;
  /** Additional class on the panel */
  className?: string;
}

// ---------------------------------------------------------------------------
// Style Maps
// ---------------------------------------------------------------------------

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  full: 'max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)]',
};

// ---------------------------------------------------------------------------
// Close Icon
// ---------------------------------------------------------------------------

const CloseIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  size = 'md',
  title,
  description,
  children,
  footer,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  className = '',
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<Element | null>(null);

  // -----------------------------------------------------------------------
  // Focus trap (basic): focus the panel on open, restore on close
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (open) {
      previousActiveElement.current = document.activeElement;
      // Small delay so the animation can start
      const timer = setTimeout(() => {
        panelRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    } else if (previousActiveElement.current instanceof HTMLElement) {
      previousActiveElement.current.focus();
    }
  }, [open]);

  // -----------------------------------------------------------------------
  // Escape key handler
  // -----------------------------------------------------------------------
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEscape) {
        e.stopPropagation();
        onClose();
      }
    },
    [closeOnEscape, onClose],
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [open, handleKeyDown]);

  // -----------------------------------------------------------------------
  // Lock body scroll when open
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (open) {
      const original = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = original;
      };
    }
  }, [open]);

  // -----------------------------------------------------------------------
  // Tab trapping
  // -----------------------------------------------------------------------
  const handleTabTrap = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !panelRef.current) return;

    const focusable = panelRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  // -----------------------------------------------------------------------
  // Render nothing when closed
  // -----------------------------------------------------------------------
  if (!open) return null;

  const content = (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: 'var(--z-modal)' }}
      role="presentation"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-surface-overlay/60 animate-fade-in"
        style={{ zIndex: 'var(--z-modal-backdrop)' }}
        aria-hidden="true"
        onClick={closeOnBackdropClick ? onClose : undefined}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Dialog'}
        aria-describedby={description ? 'modal-description' : undefined}
        tabIndex={-1}
        onKeyDown={handleTabTrap}
        className={`
          relative w-full
          bg-surface-elevated
          rounded-xl shadow-xl
          animate-scale-in
          flex flex-col
          max-h-[85vh]
          focus:outline-none
          ${SIZE_CLASSES[size]}
          ${className}
        `.trim()}
        style={{ zIndex: 'var(--z-modal)' }}
      >
        {/* Header – always rendered so the close button is accessible */}
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
          <div className="flex-1 min-w-0">
            {title && (
              <h2 className="text-lg font-semibold tracking-tight text-content-primary leading-snug">
                {title}
              </h2>
            )}
            {description && (
              <p
                id="modal-description"
                className="mt-1 text-sm text-content-secondary leading-relaxed"
              >
                {description}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="
                shrink-0 p-1.5 -m-1.5 rounded-lg
                text-content-tertiary
                hover:text-content-primary hover:bg-surface-secondary
                transition-colors duration-fast
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus
              "
            aria-label="Close dialog"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-2 px-6 pt-2 pb-6 border-t border-border">
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(content, document.body);
};

export { Modal };
export type { ModalProps, ModalSize };
