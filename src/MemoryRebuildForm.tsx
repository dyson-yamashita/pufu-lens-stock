import { applicationError, t, useLanguage } from './i18n';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import type { MemoryCoverage, MemoryUpdateMode } from '../shared/domain';
import { api, createRequestId, send } from './api';
type Target = {
  coverage: MemoryCoverage;
  pending: boolean;
};
export function MemoryCoverageSummary({ coverage }: { coverage: MemoryCoverage }) {
  useLanguage();
  return (
    <p className="memory-coverage" role="status">
      <span>
        {t('ui.memory_rebuild_form.included')}{' '}
        <strong>
          {coverage.reflected_count} / {t('count.items', { count: coverage.ready_count })}
        </strong>
      </span>
      <span>
        {t('ui.memory_rebuild_form.pending')}
        <strong>{t('count.items', { count: coverage.pending_count })}</strong>
      </span>
      <span>
        {t('ui.memory_rebuild_form.not_summarized')}
        <strong>{t('count.items', { count: coverage.waiting_count })}</strong>
      </span>
    </p>
  );
}
export default function MemoryRebuildForm({
  projectId,
  projectName,
  onDone,
  onClose,
}: {
  projectId: string | null;
  projectName?: string;
  onDone: () => void;
  onClose: () => void;
}) {
  useLanguage();
  const [target, setTarget] = useState<Target | null>(null);
  const [mode, setMode] = useState<MemoryUpdateMode>('incremental');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<{
    mode: MemoryUpdateMode;
    id: string;
  } | null>(null);
  const modeName = useId();
  const needsFull = Boolean(target?.coverage.full_rebuild_reason);
  const updating = Boolean(target?.pending);
  const pendingCount = target?.coverage.pending_count ?? 0;
  useEffect(() => {
    const controller = new AbortController();
    void api<Target>(
      `/api/v1/memory${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setTarget(result);
        if (result.coverage.full_rebuild_reason) setMode('full');
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setError(applicationError(error.message));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      busy ||
      loading ||
      updating ||
      !target ||
      (mode === 'incremental' && (!pendingCount || needsFull))
    )
      return;
    setBusy(true);
    setError('');
    if (!request.current || request.current.mode !== mode)
      request.current = { mode, id: createRequestId() };
    try {
      await send('/api/v1/memory/rebuild', {
        project_id: projectId,
        mode,
        request_id: request.current.id,
      });
      onDone();
    } catch (error) {
      setError(applicationError((error as Error).message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="memory-rebuild-form" aria-busy={loading || busy}>
      <p className="form-help">
        {t('ui.memory_rebuild_form.choose_an_update_method_only_summarized_stocks_are_included')}
      </p>
      {loading && <p role="status">{t('ui.memory_rebuild_form.checking_coverage')}</p>}
      {target && (
        <div className="memory-update-target">
          <h3>
            {projectId
              ? t('ui.app.memory_for_value', { value0: projectName ?? t('ui.app.projects') })
              : t('ui.app.your_memory')}
          </h3>
          <MemoryCoverageSummary coverage={target.coverage} />
          {target.coverage.full_rebuild_reason && (
            <p className="update-note">{applicationError(target.coverage.full_rebuild_reason)}</p>
          )}
        </div>
      )}
      {updating && (
        <p className="update-note">
          {t('ui.memory_rebuild_form.memory_is_updating_open_this_again_after_it_finishes')}
        </p>
      )}
      <fieldset className="memory-update-options" disabled={loading || busy || updating || !target}>
        <legend>{t('ui.memory_rebuild_form.update_method')}</legend>
        <label className="memory-update-option">
          <input
            type="radio"
            name={modeName}
            value="incremental"
            checked={mode === 'incremental'}
            disabled={needsFull}
            onChange={() => setMode('incremental')}
          />
          <span>
            <strong>{t('ui.memory_rebuild_form.include_pending_articles')}</strong>
            <span>
              {t('ui.memory_rebuild_form.add_only_article_summaries_that_have_not_yet_been')}
            </span>
          </span>
        </label>
        <label className="memory-update-option">
          <input
            type="radio"
            name={modeName}
            value="full"
            checked={mode === 'full'}
            onChange={() => setMode('full')}
          />
          <span>
            <strong>{t('ui.memory_rebuild_form.rebuild_from_all_articles')}</strong>
            <span>
              {t(
                'ui.memory_rebuild_form.rebuild_from_every_summary_including_articles_already_incorporated_this',
              )}
            </span>
          </span>
        </label>
      </fieldset>
      {!loading && target && !needsFull && !pendingCount && (
        <p className="form-help">
          {t('ui.memory_rebuild_form.there_are_no_pending_summaries_to_revise_the_content')}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
          {t('ui.app.cancel')}
        </button>
        <button
          type="submit"
          className="button primary"
          disabled={
            loading ||
            busy ||
            updating ||
            !target ||
            (mode === 'incremental' && (!pendingCount || needsFull))
          }
        >
          {busy ? (
            <LoaderCircle className="spin" size={16} aria-hidden="true" />
          ) : (
            <RefreshCw size={16} aria-hidden="true" />
          )}
          {mode === 'full'
            ? t('ui.memory_rebuild_form.rebuild_from_all_articles')
            : t('ui.memory_rebuild_form.include_pending_articles')}
        </button>
      </div>
    </form>
  );
}
