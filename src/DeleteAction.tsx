import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { LoaderCircle, Trash2 } from 'lucide-react';

export default function DeleteAction({
  summary = 'その他の操作',
  label,
  title,
  children,
  disabled = false,
  onDelete,
}: {
  summary?: string;
  label: string;
  title: string;
  children: ReactNode;
  disabled?: boolean;
  onDelete: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <details className="delete-action">
        <summary>{summary}</summary>
        <button
          ref={triggerRef}
          type="button"
          className="button danger-text"
          disabled={disabled}
          onClick={() => setConfirming(true)}
        >
          <Trash2 size={16} aria-hidden="true" />
          {label}
        </button>
      </details>
      {confirming && (
        <DeleteDialog
          title={title}
          label={label}
          triggerRef={triggerRef}
          onClose={() => setConfirming(false)}
          onDelete={onDelete}
        >
          {children}
        </DeleteDialog>
      )}
    </>
  );
}

function DeleteDialog({
  title,
  label,
  children,
  triggerRef,
  onClose,
  onDelete,
}: {
  title: string;
  label: string;
  children: ReactNode;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const titleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    cancelRef.current?.focus();
    return () => {
      dialog.close();
      triggerRef.current?.focus();
    };
  }, [triggerRef]);
  async function remove() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await onDelete();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialogRef}
      className="dialog delete-confirmation"
      aria-labelledby={titleId}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!inFlight.current) onClose();
      }}
    >
      <div className="dialog-head">
        <h2 id={titleId}>{title}</h2>
      </div>
      <div className="delete-description">{children}</div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button
          ref={cancelRef}
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => {
            if (!inFlight.current) onClose();
          }}
        >
          キャンセル
        </button>
        <button
          type="button"
          className="button delete-confirm-button"
          disabled={busy}
          onClick={() => void remove()}
        >
          {busy ? (
            <LoaderCircle className="spin" size={16} aria-hidden="true" />
          ) : (
            <Trash2 size={16} aria-hidden="true" />
          )}
          {busy ? '削除中…' : label}
        </button>
      </div>
    </dialog>
  );
}
