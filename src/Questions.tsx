import { applicationError, t, intlLocale, useLanguage } from './i18n';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Folder,
  LoaderCircle,
  RefreshCw,
  Star,
} from 'lucide-react';
import type { Question } from '../shared/domain';
import { api, send } from './api';
import SearchField from './SearchField';
import QuestionLabels from './QuestionLabels';
function QuestionBody({ question, onOpen }: { question: Question; onOpen?: () => void }) {
  useLanguage();
  return (
    <>
      {question.status === 'ready' && question.text ? (
        <p className="question-text">
          {onOpen ? (
            <button
              className="question-open"
              onClick={onOpen}
              aria-label={t('ui.questions.open_question_or_insight_value', {
                value0: question.text,
              })}
            >
              {question.text}
            </button>
          ) : (
            question.text
          )}
        </p>
      ) : (
        <p className={`question-message ${question.status === 'failed' ? 'question-error' : ''}`}>
          {question.status !== 'failed' && (
            <LoaderCircle className="spin" size={17} aria-hidden="true" />
          )}
          {applicationError(question.error) ||
            (question.article_status !== 'ready'
              ? t('ui.questions.one_question_or_insight_will_be_generated_after_the')
              : t('ui.questions.generating_a_question_or_insight_to_explore_this_article'))}
        </p>
      )}
    </>
  );
}
export function StockQuestion({
  stockId,
  onQuestion,
}: {
  stockId: string;
  onQuestion?: (id: string) => void;
}) {
  useLanguage();
  const [questions, setQuestions] = useState<Question[]>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await api<{
          questions: Question[];
        }>(`/api/v1/stocks/${stockId}/question`, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setQuestions(result.questions);
          setError('');
        }
      } catch (e) {
        if (!controller.signal.aborted) setError(applicationError((e as Error).message));
      } finally {
        inFlight = false;
      }
    };
    void load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 5000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [stockId, refresh]);
  return (
    <div className="stock-question-list">
      {questions?.length
        ? questions.map((question) => (
            <section className="stock-question" key={question.id}>
              <div className="question-kicker">
                <CircleHelp size={18} aria-hidden="true" />
                {t('ui.questions.questions_insights_from_this_article')}
                <QuestionLabels question={question} />
              </div>
              <QuestionBody
                question={question}
                onOpen={onQuestion ? () => onQuestion(question.id) : undefined}
              />
              {question.source === 'ai' && question.status === 'failed' && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      await send(
                        `/api/v1/stocks/${stockId}/${question.article_status === 'failed' ? 'retry' : 'question/retry'}`,
                      );
                      setRefresh((value) => value + 1);
                    } catch (e) {
                      setError(applicationError((e as Error).message));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <RefreshCw size={16} className={busy ? 'spin' : ''} aria-hidden="true" />
                  {question.article_status === 'failed'
                    ? t('ui.questions.retry_article_retrieval')
                    : t('ui.questions.retry_question_and_insight_generation')}
                </button>
              )}
            </section>
          ))
        : !error && (
            <p className="question-message">
              {questions === undefined && (
                <LoaderCircle className="spin" size={17} aria-hidden="true" />
              )}
              {questions === undefined
                ? t('ui.question_page.loading_questions_insights')
                : t('ui.questions.this_stock_has_no_questions_or_insights')}
            </p>
          )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
export default function Questions({
  projectId,
  refresh,
  onScope,
  onOpen,
  onQuestion,
  active = true,
}: {
  projectId: string | null;
  refresh: number;
  onScope: (projectId: string | null) => void;
  onOpen: (stockId: string) => Promise<void>;
  onQuestion: (id: string) => void;
  active?: boolean;
}) {
  useLanguage();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [opening, setOpening] = useState<string | null>(null);
  const [savingFavorites, setSavingFavorites] = useState<string[]>([]);
  const favoriteVersion = useRef(0);
  useEffect(() => setPage(1), [projectId]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let inFlight = false;
    setLoading(true);
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      const version = favoriteVersion.current;
      const params = new URLSearchParams({
        q: search,
        source: filter === 'favorites' ? 'all' : filter,
        page: String(page),
      });
      if (filter === 'favorites') params.set('favorite', 'true');
      if (projectId) params.set('project_id', projectId);
      try {
        const result = await api<{
          questions: Question[];
          total: number;
        }>(`/api/v1/questions?${params}`, { signal: controller.signal });
        if (!controller.signal.aborted && version === favoriteVersion.current) {
          setQuestions(result.questions);
          setTotal(result.total);
          setError('');
          if (page > Math.max(1, Math.ceil(result.total / 24)))
            setPage(Math.max(1, Math.ceil(result.total / 24)));
        }
      } catch (e) {
        if (!controller.signal.aborted) setError(applicationError((e as Error).message));
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 5000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [projectId, search, filter, page, refresh, reload, active]);
  return (
    <section className="questions-page" aria-label={t('ui.questions.project_questions_insights')}>
      <SearchField
        label={t('ui.questions.search_questions_insights')}
        placeholder={t('ui.questions.search_questions_insights_article_titles_and_notes')}
        value={query}
        clearable={Boolean(query || search)}
        onChange={setQuery}
        onSearch={() => {
          setSearch(query.trim());
          setPage(1);
          setReload((value) => value + 1);
        }}
        onClear={() => {
          setQuery('');
          setSearch('');
          setPage(1);
          setReload((value) => value + 1);
        }}
      />
      <div className="filter-row">
        <div className="filters" aria-label={t('ui.questions.question_and_insight_filters')}>
          {[
            ['all', t('ui.app.all')],
            ['ai', 'AI'],
            ['user', t('ui.app.user')],
            ['favorites', t('ui.app.favorites')],
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={filter === value}
              className={filter === value ? 'selected' : ''}
              onClick={() => {
                setFilter((current) => (current === value ? 'all' : value));
                setPage(1);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="result-count">{t('count.items', { count: total })}</span>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {loading && !questions.length ? (
        <div className="empty-state">
          <LoaderCircle className="spin" size={20} aria-hidden="true" />
          <p>{t('ui.questions.loading_questions_insights')}</p>
        </div>
      ) : !questions.length ? (
        <div className="empty-state">
          <span className="empty-icon">
            <CircleHelp size={28} aria-hidden="true" />
          </span>
          <h2>
            {search || filter !== 'all'
              ? t('ui.questions.no_matching_questions_or_insights')
              : t('ui.questions.take_the_next_step_with_questions_and_insights')}
          </h2>
          <p>
            {search || filter !== 'all'
              ? t('ui.app.try_a_different_search_or_filter')
              : t('ui.questions.use_add_question_or_insight_to_save_thoughts_from')}
          </p>
        </div>
      ) : (
        <div className="question-grid">
          {questions.map((question) => (
            <article className="question-card question-detail-card" key={question.id}>
              <div className="question-detail-meta">
                <QuestionLabels question={question} />
                <button className="question-project" onClick={() => onScope(question.project_id)}>
                  <Folder size={15} aria-hidden="true" />
                  <span>{question.project_name}</span>
                </button>
              </div>
              <QuestionBody question={question} onOpen={() => onQuestion(question.id)} />
              {(
                question.stocks ??
                (question.stock_id
                  ? [{ id: question.stock_id, title: question.article_title }]
                  : [])
              ).map((stock) => (
                <div className="question-detail-source" key={stock.id}>
                  <button
                    disabled={opening !== null}
                    onClick={async () => {
                      setOpening(stock.id);
                      try {
                        await onOpen(stock.id);
                      } catch (e) {
                        setError(applicationError((e as Error).message));
                      } finally {
                        setOpening(null);
                      }
                    }}
                  >
                    <BookOpen size={17} aria-hidden="true" />
                    <span>{stock.title}</span>
                    {opening === stock.id ? (
                      <LoaderCircle className="spin" size={16} aria-hidden="true" />
                    ) : (
                      <ArrowRight size={16} aria-hidden="true" />
                    )}
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
                    aria-label={
                      question.is_favorite
                        ? t('ui.app.remove_from_favorites')
                        : t('ui.app.add_to_favorites')
                    }
                    aria-pressed={Boolean(question.is_favorite)}
                    aria-busy={savingFavorites.includes(question.id)}
                    disabled={savingFavorites.includes(question.id)}
                    onClick={async () => {
                      favoriteVersion.current += 1;
                      setSavingFavorites((ids) => [...ids, question.id]);
                      setError('');
                      try {
                        const result = await send<Pick<Question, 'id' | 'is_favorite'>>(
                          `/api/v1/questions/${encodeURIComponent(question.id)}/favorite`,
                          { is_favorite: !question.is_favorite },
                          'PATCH',
                        );
                        setQuestions((items) =>
                          items.map((item) =>
                            item.id === result.id
                              ? { ...item, is_favorite: result.is_favorite }
                              : item,
                          ),
                        );
                        setReload((value) => value + 1);
                      } catch (e) {
                        setError(applicationError((e as Error).message));
                      } finally {
                        favoriteVersion.current += 1;
                        setSavingFavorites((ids) => ids.filter((id) => id !== question.id));
                      }
                    }}
                  >
                    {savingFavorites.includes(question.id) ? (
                      <LoaderCircle className="spin" size={20} aria-hidden="true" />
                    ) : (
                      <Star size={20} strokeWidth={1.5} aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {total > 24 && (
        <div className="pagination">
          <button
            className="button secondary"
            disabled={page === 1}
            onClick={() => setPage((value) => value - 1)}
          >
            <ChevronLeft size={17} aria-hidden="true" />
            {t('ui.app.previous')}
          </button>
          <span>
            {page} / {Math.ceil(total / 24)}
          </span>
          <button
            className="button secondary"
            disabled={page * 24 >= total}
            onClick={() => setPage((value) => value + 1)}
          >
            {t('ui.app.next')}
            <ChevronRight size={17} aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
}
