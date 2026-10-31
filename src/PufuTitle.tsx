import { useEffect, useId, useRef, useState } from 'react';
import { Check, LoaderCircle, Pencil } from 'lucide-react';
import { pufuDisplayTitle, type PufuSummary } from '../shared/pufu';
import { send } from './api';
import { applicationError, t } from './i18n';

type SavedTitle = Pick<PufuSummary, 'id' | 'title'>;
export default function PufuTitle({
  pufu,
  onBusyChange,
  onSaved,
}: {
  pufu: Pick<PufuSummary, 'id' | 'title' | 'task' | 'first_phase_task'>;
  onBusyChange: () => void;
  onSaved: (saved: SavedTitle) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  const finish = () => {
    setEditing(false);
    window.requestAnimationFrame(() => button.current?.focus());
  };
  if (editing)
    return (
      <form
        className="pufu-title-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          onBusyChange();
          try {
            const saved = await send<SavedTitle>(
              `/api/v1/pufus/${encodeURIComponent(pufu.id)}/title`,
              { title: title.trim() },
              'PATCH',
            );
            onBusyChange();
            onSaved(saved);
            finish();
          } catch (e) {
            setError(applicationError((e as Error).message));
          } finally {
            setBusy(false);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (!busy) finish();
          }
        }}
      >
        <label htmlFor={id}>
          {t('ui.app.title_2')}
          <span className="optional">{t('ui.app.optional')}</span>
        </label>
        <input
          ref={input}
          id={id}
          value={title}
          onInput={(event) => setTitle(event.currentTarget.value)}
          maxLength={200}
          disabled={busy}
          aria-invalid={!!error}
          aria-describedby={`${id}-help`}
        />
        <p className="field-hint" id={`${id}-help`}>
          {t('pufu.title_hint')}
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={finish}>
            {t('ui.app.cancel')}
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={16} aria-hidden="true" />
            ) : (
              <Check size={16} aria-hidden="true" />
            )}
            {busy ? t('ui.app.saving') : t('ui.app.save')}
          </button>
        </div>
      </form>
    );
  return (
    <div className="pufu-title-row">
      <h2>{pufuDisplayTitle(pufu)}</h2>
      <button
        ref={button}
        type="button"
        className="icon-button"
        aria-label={t('ui.app.edit_title')}
        title={t('ui.app.edit_title')}
        onClick={() => {
          setTitle(pufu.title ?? '');
          setError('');
          setEditing(true);
        }}
      >
        <Pencil size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
