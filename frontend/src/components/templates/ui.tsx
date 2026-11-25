import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

/** Input style shared by the template builder. Uses the app's CSS variables, so dark mode works. */
export const inputCls = (error?: string) =>
  `w-full min-h-[42px] border rounded-xl px-3 py-2 bg-[var(--surface)] text-[var(--ink)] text-sm ` +
  `focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-60 disabled:cursor-not-allowed ` +
  (error ? 'border-[var(--ng)]' : 'border-[var(--line2)]');

interface FieldProps {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

export const Field: React.FC<FieldProps> = ({ label, htmlFor, error, hint, required, className = '', children }) => (
  <div className={`space-y-1 ${className}`}>
    <label htmlFor={htmlFor} className="block text-xs font-semibold text-[var(--ink)]">
      {label}
      {required && <span className="text-[var(--ng)]"> *</span>}
    </label>
    {children}
    {error ? (
      <p role="alert" className="text-xs text-[var(--ng)]">{error}</p>
    ) : hint ? (
      <p className="text-xs text-[var(--muted)]">{hint}</p>
    ) : null}
  </div>
);

interface NumberInputProps {
  id?: string;
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  error?: string;
  className?: string;
  ariaLabel?: string;
}

/** Keeps what the user is typing ("1.", "-") while exposing a clean number | null to the parent. */
export const NumberInput: React.FC<NumberInputProps> = ({ id, value, onChange, placeholder, error, className = '', ariaLabel }) => {
  const toText = (v: number | null) => (v == null ? '' : String(v));
  const [text, setText] = useState(toText(value));
  useEffect(() => {
    const parsed = text.trim() === '' ? null : Number(text);
    if (parsed !== value) setText(toText(value));
    // Only resync when the parent value changes (for example after Save or a type switch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      id={id}
      type="number"
      step="any"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        if (raw.trim() === '') onChange(null);
        else if (!Number.isNaN(Number(raw))) onChange(Number(raw));
      }}
      className={`${inputCls(error)} mono ${className}`}
    />
  );
};

interface ConfirmDialogProps {
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  /** When set, the confirm button stays disabled until this exact text is typed. */
  requireText?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title, children, confirmLabel, cancelLabel = 'Cancel', danger, requireText, busy, onConfirm, onCancel,
}) => {
  const [typed, setTyped] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  const blocked = busy || (requireText != null && typed.trim() !== requireText);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="sv-card w-full max-w-md space-y-4 !p-5">
        <div className="flex items-start gap-3">
          {danger && (
            <span className="shrink-0 w-9 h-9 rounded-full bg-[var(--ng-bg)] text-[var(--ng)] flex items-center justify-center">
              <AlertTriangle className="w-5 h-5" />
            </span>
          )}
          <div className="space-y-2 min-w-0">
            <h3 className="text-base font-semibold text-[var(--ink)]">{title}</h3>
            <div className="text-sm text-[var(--muted)] space-y-2">{children}</div>
          </div>
        </div>

        {requireText != null && (
          <Field label={`Type ${requireText} to confirm`} htmlFor="confirm-text">
            <input
              id="confirm-text"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className={`${inputCls()} mono`}
              autoComplete="off"
            />
          </Field>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn sm" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          <button
            type="button"
            className={`btn sm ${danger ? 'danger' : 'primary'} disabled:opacity-50`}
            onClick={onConfirm}
            disabled={blocked}
          >
            {busy ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
