import { useEffect, useId, useRef, useState } from 'react';
import './ConfirmDialog.css';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal for confirmations and (with `inputLabel`) single-field prompts.
 * onConfirm receives the input value in prompt mode. `validate(value)` may return an error message.
 */
function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  inputLabel,
  defaultValue = '',
  validate,
  onConfirm,
  onCancel,
}) {
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const titleId = useId();
  const descId = useId();
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState(null);

  useEffect(() => {
    const previous = document.activeElement;
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    } else {
      const buttons = dialogRef.current.querySelectorAll('button');
      // Focus the safe action (cancel) for destructive dialogs
      (danger ? buttons[0] : buttons[buttons.length - 1])?.focus();
    }
    return () => {
      if (previous && typeof previous.focus === 'function') previous.focus();
    };
  }, [danger]);

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = dialogRef.current.querySelectorAll(FOCUSABLE);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (inputLabel !== undefined) {
      const problem = validate ? validate(value) : null;
      if (problem) {
        setError(problem);
        return;
      }
      onConfirm(value);
    } else {
      onConfirm();
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? descId : undefined}
        onKeyDown={handleKeyDown}
        onSubmit={handleSubmit}
      >
        <h2 id={titleId} className="dialog-title">{title}</h2>
        {message && <p id={descId} className="dialog-message">{message}</p>}
        {inputLabel !== undefined && (
          <div className="dialog-field">
            <label htmlFor={`${titleId}-input`}>{inputLabel}</label>
            <input
              id={`${titleId}-input`}
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => { setValue(e.target.value); setError(null); }}
              aria-invalid={!!error}
            />
            {error && <p className="dialog-error" role="alert">{error}</p>}
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="dialog-btn" onClick={onCancel}>{cancelLabel}</button>
          <button type="submit" className={`dialog-btn ${danger ? 'dialog-btn-danger' : 'dialog-btn-primary'}`}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

export default ConfirmDialog;
