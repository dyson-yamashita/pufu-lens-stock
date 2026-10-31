import { applicationError, t, useLanguage } from './i18n';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, LoaderCircle, RefreshCw } from 'lucide-react';
import type { Pufu } from '../shared/pufu';
import { api, send } from './api';
import PufuEditorLoadError, { clearPufuEditorLoadRetry } from './PufuEditorLoadError';
import PufuRelations from './PufuRelations';
import PufuFavoriteButton from './PufuFavoriteButton';
const PufuEditor = lazy(async () => {
  try {
    const editor = await import('./PufuEditor');
    clearPufuEditorLoadRetry();
    return editor;
  } catch {
    return { default: PufuEditorLoadError };
  }
});
export default function PufuPage({
  id,
  onQuestion,
  backLabel = t('ui.app.back_to_pufu_list'),
  onBack,
  onGuard,
}: {
  id: string;
  onQuestion: (id: string) => void;
  backLabel?: string;
  onBack: () => void;
  onGuard: (guard: (() => boolean) | null) => void;
}) {
  useLanguage();
  const [pufu, setPufu] = useState<Pufu>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [editorBlocked, setEditorBlocked] = useState(false);
  const [relationsBusy, setRelationsBusy] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0);
  const questions =
    pufu?.questions ??
    (pufu?.question_id
      ? [
          {
            id: pufu.question_id,
            text: pufu.context.question?.text ?? t('ui.public_projects.related_questions_insights'),
          },
        ]
      : []);
  const favoriteVersion = useRef(0);
  const updateRevision = useCallback((revision: number) => {
    setPufu((current) => current && { ...current, revision });
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let complete = false,
      inFlight = false;
    const load = async () => {
      if (complete || inFlight) return;
      inFlight = true;
      const version = favoriteVersion.current;
      try {
        const result = await api<{
          pufu: Pufu;
        }>(`/api/v1/pufus/${encodeURIComponent(id)}`, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          complete = result.pufu.status === 'ready' || result.pufu.status === 'failed';
          setPufu((current) =>
            current?.id === result.pufu.id && version !== favoriteVersion.current
              ? { ...result.pufu, is_favorite: current.is_favorite }
              : result.pufu,
          );
          setError('');
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(applicationError((e as Error).message));
          complete = true;
        }
      } finally {
        inFlight = false;
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 2500);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [id, retry]);
  return (
    <section className="pufu-page" aria-label={t('ui.pufu_page.edit_pufu')}>
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        {backLabel}
      </button>
      <header className="page-header">
        <div>
          <h1>{t('ui.app.pufu')}</h1>
          <p>{t('ui.pufu_page.from_a_question_or_insight_to_an_actionable_plan')}</p>
        </div>
        {pufu && (
          <PufuFavoriteButton
            key={pufu.id}
            pufu={pufu}
            onError={setError}
            onBusyChange={() => {
              favoriteVersion.current += 1;
            }}
            onSaved={(saved) => {
              setPufu((current) =>
                current?.id === saved.id ? { ...current, is_favorite: saved.is_favorite } : current,
              );
            }}
          />
        )}
      </header>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {pufu && (
        <div className="pufu-context">
          {questions.length > 0 && (
            <div>
              <span className="question-origin pufu-context-label">
                {t('ui.app.questions_insights')}
              </span>
              <ul className="pufu-context-questions">
                {questions.map((question) => (
                  <li key={question.id}>
                    <button className="text-link" onClick={() => onQuestion(question.id)}>
                      {question.text}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="pufu-context-task">
            <span className="question-origin pufu-context-label">
              {t('ui.pufu_page.task_gaining_goal')}
            </span>
            <p>{pufu.task}</p>
          </div>
          <span className="field-hint">{pufu.context.project.name}</span>
          {(pufu.stocks ?? (pufu.context.stock ? [pufu.context.stock] : [])).length > 0 && (
            <div className="pufu-related-stocks">
              <span className="field-hint">{t('ui.public_projects.related_stocks')}</span>
              <ul>
                {(pufu.stocks ?? [pufu.context.stock!]).map((stock) => (
                  <li key={stock.id}>{stock.title}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {pufu && (
        <PufuRelations
          pufu={pufu}
          blocked={editorBlocked || pufu.status === 'queued' || pufu.status === 'generating'}
          onBusy={setRelationsBusy}
          onSaved={(saved) => {
            setPufu((current) =>
              current?.id === saved.id ? { ...saved, is_favorite: current.is_favorite } : saved,
            );
            setEditorVersion((value) => value + 1);
          }}
        />
      )}
      {pufu?.status === 'ready' && pufu.score ? (
        <Suspense
          fallback={
            <p className="content-loading">
              <LoaderCircle className="spin" size={20} aria-hidden="true" />
              {t('ui.pufu_page.loading_editor')}
            </p>
          }
        >
          <div inert={relationsBusy} aria-busy={relationsBusy}>
            <PufuEditor
              key={`${id}-${editorVersion}`}
              pufu={pufu}
              onGuard={onGuard}
              onEditingStateChange={setEditorBlocked}
              onSaved={updateRevision}
            />
          </div>
        </Suspense>
      ) : pufu?.status === 'failed' ? (
        <div className="empty-state">
          <h2>{t('ui.pufu_page.could_not_generate_pufu')}</h2>
          <p>{applicationError(pufu.error)}</p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await send(`/api/v1/pufus/${encodeURIComponent(id)}/retry`);
                setPufu((current) => current && { ...current, status: 'queued', error: null });
                setRetry((value) => value + 1);
              } catch (e) {
                setError(applicationError((e as Error).message));
              } finally {
                setBusy(false);
              }
            }}
          >
            <RefreshCw size={17} className={busy ? 'spin' : ''} aria-hidden="true" />
            {t('ui.pufu_page.retry')}
          </button>
        </div>
      ) : (
        !error && (
          <div className="empty-state" role="status">
            <LoaderCircle className="spin" size={25} aria-hidden="true" />
            <h2>{pufu ? t('ui.pufu_page.generating_pufu') : t('ui.pufu_page.loading_pufu')}</h2>
            <p>
              {pufu
                ? t('ui.pufu_page.organizing_win_conditions_and_actions_from_the_question_insight')
                : t('ui.pufu_page.retrieving_saved_content')}
            </p>
          </div>
        )
      )}
    </section>
  );
}
