import { useLayoutEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export default function PufuModal({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      // DOMから外れる前に閉じ、native dialogのフォーカス復帰を働かせる。
      dialog.close();
      document.body.style.overflow = overflow;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog pufu-modal"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="dialog-head">
        <h2 id={id}>{title}</h2>
        <button className="icon-button" aria-label="閉じる" disabled={busy} onClick={onClose}>
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
