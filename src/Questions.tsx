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
  return (
    <>
      {question.status === 'ready' && question.text ? (
        <p className="question-text">
          {onOpen ? (
            <button
              className="question-open"
              onClick={onOpen}
              aria-label={`問いの詳細を開く：${question.text}`}
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
          {question.error ??
            (question.article_status !== 'ready'
              ? '記事の要約が完了したら、問いを1つ生成します。'
              : 'この記事から、考えを深める問いを生成しています。')}
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
        const result = await api<{ questions: Question[] }>(`/api/v1/stocks/${stockId}/question`, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setQuestions(result.questions);
          setError('');
        }
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
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
                この記事から生まれた問い
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
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <RefreshCw size={16} className={busy ? 'spin' : ''} aria-hidden="true" />
                  {question.article_status === 'failed'
                    ? '記事の再取得を試す'
                    : '問いの生成を再試行'}
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
                ? '問いを読み込んでいます…'
                : 'このストックには問いがありません。'}
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
        const result = await api<{ questions: Question[]; total: number }>(
          `/api/v1/questions?${params}`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted && version === favoriteVersion.current) {
          setQuestions(result.questions);
          setTotal(result.total);
          setError('');
          if (page > Math.max(1, Math.ceil(result.total / 24)))
            setPage(Math.max(1, Math.ceil(result.total / 24)));
        }
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
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
    <section className="questions-page" aria-label="プロジェクトの問い">
      <SearchField
        label="問いを検索"
        placeholder="問い、記事のタイトル、メモから検索"
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
        <div className="filters" aria-label="問いのフィルター">
          {[
            ['all', 'すべて'],
            ['ai', 'AI'],
            ['user', 'ユーザー'],
            ['favorites', 'お気に入り'],
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
        <span className="result-count">{total}件</span>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {loading && !questions.length ? (
        <div className="empty-state">
          <LoaderCircle className="spin" size={20} aria-hidden="true" />
          <p>問いを読み込んでいます。</p>
        </div>
      ) : !questions.length ? (
        <div className="empty-state">
          <span className="empty-icon">
            <CircleHelp size={28} aria-hidden="true" />
          </span>
          <h2>
            {search || filter !== 'all' ? '該当する問いはありません' : '問いから、次の一歩へ'}
          </h2>
          <p>
            {search || filter !== 'all'
              ? '検索語やフィルターを変えてお試しください。'
              : '「問いを追加」から、日常や会話で生まれた問いを保存できます。記事をストックすると、要約をもとにAIの問いも生成されます。'}
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
              {question.stock_id && (
                <div className="question-detail-source">
                  <button
                    disabled={opening !== null}
                    onClick={async () => {
                      setOpening(question.stock_id);
                      try {
                        await onOpen(question.stock_id!);
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setOpening(null);
                      }
                    }}
                  >
                    <BookOpen size={17} aria-hidden="true" />
                    <span>{question.article_title}</span>
                    {opening === question.stock_id ? (
                      <LoaderCircle className="spin" size={16} aria-hidden="true" />
                    ) : (
                      <ArrowRight size={16} aria-hidden="true" />
                    )}
                  </button>
                </div>
              )}
              <div className="question-card-footer">
                <time dateTime={question.created_at}>
                  {new Intl.DateTimeFormat('ja-JP', {
                    dateStyle: 'medium',
                    timeZone: 'Asia/Tokyo',
                  }).format(new Date(question.created_at))}
                </time>
                <div className="question-card-actions">
                  <button
                    type="button"
                    className="question-favorite"
                    aria-label={question.is_favorite ? 'お気に入りを解除' : 'お気に入りに追加'}
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
                        setError((e as Error).message);
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
            前へ
          </button>
          <span>
            {page} / {Math.ceil(total / 24)}
          </span>
          <button
            className="button secondary"
            disabled={page * 24 >= total}
            onClick={() => setPage((value) => value + 1)}
          >
            次へ
            <ChevronRight size={17} aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
}
