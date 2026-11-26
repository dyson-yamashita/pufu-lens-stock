import { useId, useState } from 'react';
import {
  footprintPublicationSummaryLimit,
  footprintPublicationTitleLimit,
  type FootprintPublication,
} from '../../../shared/footprints';
import { t } from '../../i18n/i18n';
import { api, send } from '../../lib/api';

export function FootprintPublicationEditor({
  endpoint,
  initial,
  enabled,
}: {
  endpoint: string;
  initial: FootprintPublication | null;
  enabled: boolean;
}) {
  const id = useId();
  const [published, setPublished] = useState(Boolean(initial));
  const [title, setTitle] = useState(initial?.title ?? '');
  const [summary, setSummary] = useState(initial?.summary ?? '');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'saved' | 'removed' | 'failed' | null>(null);
  async function save(remove: boolean) {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      if (remove) {
        await api(endpoint, { method: 'DELETE' });
        setPublished(false);
        setStatus('removed');
      } else {
        const { publication } = await send<{ publication: FootprintPublication }>(
          endpoint,
          { title, summary },
          'PATCH',
        );
        setTitle(publication.title);
        setSummary(publication.summary);
        setPublished(true);
        setStatus('saved');
      }
    } catch {
      setStatus('failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="footprints-publication">
      <summary>{t('footprints.publication_editor')}</summary>
      <p>{t(enabled ? 'footprints.publication_help' : 'footprints.publication_disabled')}</p>
      {(enabled || published) && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (enabled) void save(false);
          }}
        >
          <label htmlFor={`${id}-title`}>{t('footprints.publication_title')}</label>
          <input
            id={`${id}-title`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={footprintPublicationTitleLimit}
            disabled={busy || !enabled}
            required
          />
          <label htmlFor={`${id}-summary`}>{t('footprints.publication_summary')}</label>
          <textarea
            id={`${id}-summary`}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            maxLength={footprintPublicationSummaryLimit}
            rows={3}
            disabled={busy || !enabled}
            required
          />
          <div className="footprints-publication-actions">
            {enabled && (
              <button
                className="button secondary"
                disabled={busy || !title.trim() || !summary.trim()}
                type="submit"
              >
                {t(published ? 'footprints.publication_update' : 'footprints.publication_publish')}
              </button>
            )}
            {published && (
              <button
                className="button secondary"
                disabled={busy}
                type="button"
                onClick={() => void save(true)}
              >
                {t('footprints.publication_remove')}
              </button>
            )}
          </div>
        </form>
      )}
      {status && (
        <p role={status === 'failed' ? 'alert' : 'status'}>
          {t(`footprints.publication_${status}`)}
        </p>
      )}
    </details>
  );
}
