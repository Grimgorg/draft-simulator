import { useState } from "react";

interface ConfirmButtonProps {
  label: string;
  /** Shown instead of `label` while `disabled` is true (e.g. a request in flight). */
  pendingLabel?: string;
  confirmMessage: string;
  confirmLabel: string;
  className?: string;
  disabled?: boolean;
  onConfirm: () => void;
}

/**
 * A destructive action confirmed inline rather than via window.confirm().
 * window.confirm() blocks the JS main thread for as long as it's open,
 * which can starve socket.io's reconnect logic — if the underlying
 * connection drops while the dialog is up (as happens on a real pause to
 * read it), the emit fired right after confirming can be lost, silently
 * doing nothing until the page is refreshed. An inline prompt never blocks.
 */
export function ConfirmButton({
  label,
  pendingLabel,
  confirmMessage,
  confirmLabel,
  className,
  disabled,
  onConfirm,
}: ConfirmButtonProps) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button type="button" className={className} disabled={disabled} onClick={() => setConfirming(true)}>
        {disabled && pendingLabel ? pendingLabel : label}
      </button>
    );
  }

  return (
    <div className="confirm-prompt">
      <p className="subtitle">{confirmMessage}</p>
      <div className="confirm-prompt-actions">
        <button
          type="button"
          className={className}
          disabled={disabled}
          onClick={() => {
            setConfirming(false);
            onConfirm();
          }}
        >
          {confirmLabel}
        </button>
        <button type="button" className="confirm-prompt-dismiss" disabled={disabled} onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
