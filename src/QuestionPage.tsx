import { applicationError, t, intlLocale, useLanguage } from './i18n';
import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Folder, LoaderCircle, Star } from 'lucide-react';
import type { Project, Question, QuestionDetail } from '../shared/domain';
import { type PufuSummary } from '../shared/pufu';
import { api, send } from './api';
import QuestionLabels from './QuestionLabels';
import Comments from './Comments';
import DeleteAction from './DeleteAction';
import QuestionSettings from './QuestionSettings';
import PufuForm from './PufuForm';
const detailTabs = () =>
  [
    ['body', t('ui.app.content')],
    ['pufus', t('ui.app.pufu')],
    ['comments', t('ui.app.comments')],
    ['settings', t('ui.app.note_destination')],
  ] as const;
export default function QuestionPage({
  id,
  resolve,
  projects,
  backLabel = t('ui.public_projects.back_to_questions_insights'),
  onBack,
  onResolve,
  onPufu,
  onStock,
  onDeleted,
  onUpdated,
}: {
  id: string;
  resolve: boolean;
  projects: Pick<Project, 'id' | 'name'>[];
  backLabel?: string;
  onBack: () => void;
  onResolve: () => void;
  onPufu: (id: string) => void;
  onStock: (id: string) => Promise<void>;
  onDeleted: () => void;
  onUpdated: () => void;
}) {
  useLanguage();
  const [question, setQuestion] = useState<QuestionDetail>();
  const [tab, setTab] = useState<ReturnType<typeof detailTabs>[number][0]>('body');
  const tabsId = useId();
  const [pufus, setPufus] = useState<PufuSummary[]>([]);
  const [error, setError] = useState('');
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const detailsVersion = useRef(0);
  useEffect(() => {
    if (deleting) return;
    const controller = new AbortController();
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      const version = detailsVersion.current;
      try {
        const result = await api<{
          question: QuestionDetail;
          pufus: PufuSummary[];
        }>(`/api/v1/questions/${encodeURIComponent(id)}`, { signal: controller.signal });
        if (!controller.signal.aborted && version === detailsVersion.current && version % 2 === 0) {
          setQuestion(result.question);
          setPufus(result.pufus);
        }
      } catch (e) {
        if (!controller.signal.aborted) setError(applicationError((e as Error).message));
      } finally {
        inFlight = false;
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 5000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [id, deleting]);
  return (
    <section
      className="question-detail-page"
      aria-label={
        resolve
          ? t('ui.question_page.create_pufu_from_a_task')
          : t('ui.public_projects.question_or_insight_details')
      }
    >
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        {resolve ? t('ui.app.back_to_question_or_insight') : backLabel}
      </button>
      <header className="page-header">
        <div>
          <h1>
            {resolve
              ? t('ui.question_page.create_pufu_from_a_task')
              : t('ui.public_projects.question_or_insight_details')}
          </h1>
          <p>
            {resolve
              ? t('ui.question_page.describe_what_you_want_to_achieve_as_a_task')
              : t('ui.public_projects.reflect_on_a_question_or_insight_and_take_the')}
          </p>
        </div>
      </header>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!question ? (
        !error && (
          <p className="content-loading">
            <LoaderCircle className="spin" size={20} aria-hidden="true" />
            {t('ui.question_page.loading_questions_insights')}
          </p>
        )
      ) : (
        <>
          {!resolve && (
            <div
              className="detail-tabs question-detail-tabs"
              role="tablist"
              aria-label={t('ui.public_projects.question_or_insight_details')}
              onKeyDown={(event) => {
                const index = detailTabs().findIndex(([key]) => key === tab);
                const next =
                  event.key === 'ArrowRight'
                    ? (index + 1) % detailTabs().length
                    : event.key === 'ArrowLeft'
                      ? (index + detailTabs().length - 1) % detailTabs().length
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? detailTabs().length - 1
                          : -1;
                if (next < 0) return;
                event.preventDefault();
                setTab(detailTabs()[next][0]);
                const buttons =
                  event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                buttons[next]?.focus();
              }}
            >
              {detailTabs().map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  id={`${tabsId}-tab-${key}`}
                  aria-controls={`${tabsId}-panel-${key}`}
                  aria-selected={tab === key}
                  tabIndex={tab === key ? 0 : -1}
                  className={tab === key ? 'active' : ''}
                  onClick={() => setTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div
            role={resolve ? undefined : 'tabpanel'}
            id={`${tabsId}-panel-body`}
            aria-labelledby={resolve ? undefined : `${tabsId}-tab-body`}
            tabIndex={resolve ? undefined : 0}
            hidden={!resolve && tab !== 'body'}
          >
            <article className="question-detail-card">
              <div className="question-detail-meta">
                <QuestionLabels question={question} />
                <span>
                  <Folder size={15} aria-hidden="true" />
                  {question.project_name}
                </span>
              </div>
              <h2>
                {question.text ||
                  (question.status === 'failed'
                    ? t('ui.question_page.could_not_generate_questions_or_insights')
                    : t('ui.question_page.generating_questions_insights'))}
              </h2>
              {(
                question.stocks ??
                (question.stock_id
                  ? [{ id: question.stock_id, title: question.article_title }]
                  : [])
              ).map((stock) => (
                <div className="question-detail-source" key={stock.id}>
                  <button
                    onClick={async () => {
                      try {
                        await onStock(stock.id);
                      } catch (e) {
                        setError(applicationError((e as Error).message));
                      }
                    }}
                  >
                    <BookOpen size={17} aria-hidden="true" />
                    <span>{stock.title}</span>
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                </div>
              ))}
              <div className="question-card-footer">
                <time dateTime={question.created_at}>
                  {new Intl.DateTimeFormat(intlLocale(), {
                    dateStyle: 'medium',
                    timeZone: 'Asia/Tokyo',
                  }).format(new Date(question.created_at))}
                </time>
                <div className="question-card-actions">
                  <button
                    type="button"
                    className="question-favorite"
                    disabled={favoriteBusy || deleting || saving}
                    aria-label={
                      question.is_favorite
                        ? t('ui.app.remove_from_favorites')
                        : t('ui.app.add_to_favorites')
                    }
                    aria-pressed={Boolean(question.is_favorite)}
                    onClick={async () => {
                      detailsVersion.current += 1;
                      setFavoriteBusy(true);
                      setError('');
                      try {
                        const result = await send<Pick<Question, 'is_favorite'>>(
                          `/api/v1/questions/${encodeURIComponent(id)}/favorite`,
                          { is_favorite: !question.is_favorite },
                          'PATCH',
                        );
                        setQuestion(
                          (current) => current && { ...current, is_favorite: result.is_favorite },
                        );
                      } catch (e) {
                        setError(applicationError((e as Error).message));
                      } finally {
                        detailsVersion.current += 1;
                        setFavoriteBusy(false);
                      }
                    }}
                  >
                    {favoriteBusy ? (
                      <LoaderCircle className="spin" size={20} aria-hidden="true" />
                    ) : (
                      <Star size={20} strokeWidth={1.5} aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>
            </article>
          </div>
          {resolve ? (
            <PufuForm
              projects={projects}
              projectId={question.project_id}
              questionId={id}
              disabled={question.status !== 'ready' || !question.text}
              onDone={onPufu}
            />
          ) : (
            <>
              <div
                role="tabpanel"
                id={`${tabsId}-panel-pufus`}
                aria-labelledby={`${tabsId}-tab-pufus`}
                tabIndex={0}
                hidden={tab !== 'pufus'}
              >
                <div className="section-head pufu-list-heading">
                  <div>
                    <h2>{t('ui.public_projects.pufu_for_this_question_or_insight')}</h2>
                    <p>
                      {t('ui.question_page.create_ideas_for_each_task_and_develop_them_through')}
                    </p>
                  </div>
                  <span className="result-count">{t('count.items', { count: pufus.length })}</span>
                </div>
                {pufus.length ? (
                  <div className="pufu-list">
                    {pufus.map((pufu) => (
                      <button
                        className="pufu-list-item"
                        key={pufu.id}
                        onClick={() => onPufu(pufu.id)}
                      >
                        <span>
                          <strong>{pufu.task}</strong>
                          <small>
                            {pufu.status === 'ready'
                              ? t('ui.question_page.editable')
                              : pufu.status === 'failed'
                                ? t('ui.question_page.generation_failed')
                                : t('ui.question_page.generating_pufu')}
                          </small>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="pufu-empty">
                    <p>{t('ui.public_projects.no_pufu_for_this_question_or_insight_yet')}</p>
                    <p>{t('ui.question_page.create_actionable_ideas_from_a_task_you_want_to')}</p>
                  </div>
                )}
                <div className="question-resolve-action">
                  <button
                    className="button primary"
                    onClick={onResolve}
                    disabled={deleting || question.status !== 'ready' || !question.text}
                  >
                    {t('ui.question_page.explore_this_question_or_insight')}
                    <ArrowRight size={18} aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div
                role="tabpanel"
                id={`${tabsId}-panel-comments`}
                aria-labelledby={`${tabsId}-tab-comments`}
                tabIndex={0}
                hidden={tab !== 'comments'}
              >
                <Comments targetType="question" targetId={id} />
              </div>
              <div
                role="tabpanel"
                id={`${tabsId}-panel-settings`}
                aria-labelledby={`${tabsId}-tab-settings`}
                tabIndex={0}
                hidden={tab !== 'settings'}
              >
                <QuestionSettings
                  question={question}
                  projects={projects}
                  disabled={favoriteBusy || deleting || saving}
                  onSave={async (input) => {
                    detailsVersion.current += 1;
                    setSaving(true);
                    try {
                      const result = await send<{
                        question: QuestionDetail;
                      }>(`/api/v1/questions/${encodeURIComponent(id)}`, input, 'PATCH');
                      setQuestion(result.question);
                      onUpdated();
                    } finally {
                      detailsVersion.current += 1;
                      setSaving(false);
                    }
                  }}
                />
              </div>
              <DeleteAction
                label={t('ui.question_page.delete_question_or_insight')}
                title={t('ui.question_page.delete_this_question_or_insight')}
                disabled={deleting || favoriteBusy || saving}
                onDelete={async () => {
                  setDeleting(true);
                  try {
                    await api(`/api/v1/questions/${encodeURIComponent(id)}`, { method: 'DELETE' });
                    onDeleted();
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                <p className="delete-target">
                  {question.text ||
                    (question.status === 'queued'
                      ? t('ui.question_page.question_or_insight_awaiting_generation')
                      : t('ui.question_page.question_or_insight_generating_or_failed'))}
                </p>
                <p>
                  {t('ui.question_page.project')}
                  {question.project_name}
                </p>
                <p>
                  {t('ui.question_page.delete_this_question_or_insight_and_its_comments_related')}
                </p>
              </DeleteAction>
            </>
          )}
        </>
      )}
    </section>
  );
}
