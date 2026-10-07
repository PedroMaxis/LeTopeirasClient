import { useEffect, type ReactNode } from 'react';

interface Props {
  title: string;
  confirmLabel: string;
  danger?: boolean;
  children: ReactNode;
  onConfirm(): void;
  onCancel(): void;
}

export function ConfirmDialog({
  title,
  confirmLabel,
  danger = false,
  children,
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className="modal confirm"
        role="dialog"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{title}</h2>
        <div className="confirm-body">{children}</div>
        <footer className="modal-footer">
          <button type="button" className="button ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className={`button ${danger ? 'danger' : 'primary'}`}
            autoFocus
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
