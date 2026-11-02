import { useEffect, useId, useState } from 'react';
import { History, ChevronDown, ChevronUp } from 'lucide-react';
import type { MemoryVersion, MemoryVersionList } from '../shared/domain';
import { api } from './api';
import { t, intlLocale, useLanguage } from './i18n';

export default function MemoryHistory({
  projectId,
  currentRevision,
  updatedAt,
  onSelect,
}: {
  projectId?: string;
  currentRevision?: number;
  updatedAt?: string;
  onSelect: (version: MemoryVersion | null) => void;
}) {
  useLanguage();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<MemoryVersionList | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const scope = projectId ? `project_id=${encodeURIComponent(projectId)}&` : '';
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError('');
    void api<MemoryVersionList>(`/api/v1/memory/history?${scope}`)
      .then((data) => {
        if (active) setList(data);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, scope, updatedAt, retry]);
  async function select(revision: number | null) {
    if (revision === null || revision === currentRevision) {
      setSelected(null);
      onSelect(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { version } = await api<{ version: MemoryVersion }>(
        `/api/v1/memory/history/${revision}?${scope}`,
      );
      setSelected(revision);
      onSelect(version);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function more() {
    if (list?.next_before == null) return;
    setLoading(true);
    setError('');
    try {
      const next = await api<MemoryVersionList>(
        `/api/v1/memory/history?${scope}before=${list.next_before}`,
      );
      setList({ ...next, versions: [...list.versions, ...next.versions] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="memory-history">
      <button
        className="memory-history-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <History size={17} aria-hidden="true" />
        <span>{t('ui.memory_history.title')}</span>
        {open ? (
          <ChevronUp size={16} aria-hidden="true" />
        ) : (
          <ChevronDown size={16} aria-hidden="true" />
        )}
      </button>
      {open && (
        <div id={id} className="memory-history-body" aria-busy={loading}>
          <p className="memory-history-caption">{t('ui.memory_history.caption')}</p>
          <div className="memory-history-list" aria-label={t('ui.memory_history.title')}>
            <button
              className="memory-version"
              aria-pressed={selected === null}
              disabled={loading}
              onClick={() => void select(null)}
            >
              <span>{t('ui.memory_history.latest')}</span>
              <small>{t('ui.memory_history.current')}</small>
            </button>
            {list?.versions
              .filter((item) => item.revision !== currentRevision)
              .map((item) => (
                <button
                  key={item.revision}
                  className="memory-version"
                  aria-pressed={selected === item.revision}
                  disabled={loading}
                  onClick={() => void select(item.revision)}
                >
                  <span>
                    {new Date(item.saved_at).toLocaleString(intlLocale(), {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <small>
                    {t('ui.memory_history.version', {
                      revision: item.revision,
                      count: item.article_count,
                    })}
                  </small>
                </button>
              ))}
          </div>
          {list &&
            list.versions.filter((item) => item.revision !== currentRevision).length === 0 && (
              <p className="memory-history-caption">{t('ui.memory_history.empty')}</p>
            )}
          {list?.has_more && (
            <button className="button secondary" disabled={loading} onClick={() => void more()}>
              {t('ui.memory_history.more')}
            </button>
          )}
          {loading && (
            <p className="memory-history-caption" role="status">
              {t('ui.memory_history.loading')}
            </p>
          )}
          {error && (
            <div role="alert" className="form-error">
              {error}{' '}
              <button className="text-button" onClick={() => setRetry(retry + 1)}>
                {t('ui.memory_history.retry')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
