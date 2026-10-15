import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, CircleHelp, LoaderCircle } from 'lucide-react';
import { userQuestionSchema, type Project, type Question, type Stock } from '../shared/domain';
import { api, createRequestId, send } from './api';

export default function QuestionForm({
  projects,
  projectId,
  onDone,
}: {
  projects: Project[];
  projectId: string | null;
  onDone: (projectId: string) => void;
}) {
  const [project, setProject] = useState(projectId ?? projects[0]?.id ?? '');
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [stockId, setStockId] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const key = useRef(createRequestId());
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(query);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (!project) {
      setStocks([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({ project_id: project, q: search, page: String(page) });
    void api<{ stocks: Stock[]; total: number }>(`/api/v1/stocks?${params}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) {
          setStocks(result.stocks);
          setTotal(result.total);
          setLoadError('');
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setStocks([]);
          setLoadError((e as Error).message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [project, search, page]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const result = userQuestionSchema.safeParse({
      project_id: project,
      stock_id: stockId || null,
      text,
      request_id: key.current,
    });
    if (!result.success) {
      setError(result.error.issues[0].message);
      document
        .getElementById(
          result.error.issues[0].path[0] === 'project_id' ? 'question-project' : 'question-text',
        )
        ?.focus();
      return;
    }
    setBusy(true);
    try {
      const saved = await send<{ question: Question }>('/api/v1/questions', result.data);
      onDone(saved.question.project_id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit}>
      <p className="form-intro">
        プロジェクトに自分の問いを保存します。関連するストックは任意で選べます。
      </p>
      <label htmlFor="question-project">プロジェクト</label>
      <select
        id="question-project"
        value={project}
        disabled={busy || !projects.length}
        onChange={(event) => {
          setProject(event.target.value);
          setStockId('');
          setQuery('');
          setSearch('');
          setPage(1);
          key.current = createRequestId();
        }}
      >
        {!project && (
          <option value="">
            {projects.length ? 'プロジェクトを選択してください' : 'プロジェクトがありません'}
          </option>
        )}
        {projects.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <label htmlFor="question-stock-search">
        ストックを検索<span className="optional">任意</span>
      </label>
      <input
        id="question-stock-search"
        value={query}
        placeholder="記事のタイトルなどで検索"
        disabled={busy || !project}
        onChange={(event) => {
          setQuery(event.target.value);
          setStockId('');
          key.current = createRequestId();
        }}
      />
      <label htmlFor="question-stock">
        紐づけるストック<span className="optional">任意</span>
      </label>
      <select
        id="question-stock"
        value={stockId}
        disabled={busy || loading || !stocks.length}
        onChange={(event) => {
          setStockId(event.target.value);
          key.current = createRequestId();
        }}
      >
        <option value="">
          {loading ? 'ストックを読み込んでいます…' : 'ストックを紐づけずに保存'}
        </option>
        {stocks.map((stock) => (
          <option key={stock.id} value={stock.id}>
            {stock.title}
          </option>
        ))}
      </select>
      {!loading && !stocks.length && (
        <p className="profile-hint">
          {query
            ? '該当するストックがありません。検索語を変えてください。'
            : 'ストックがなくても問いを保存できます。'}
        </p>
      )}
      {total > 24 && (
        <div className="question-stock-pages">
          <button
            type="button"
            className="button secondary"
            disabled={busy || loading || page === 1}
            onClick={() => {
              setPage((value) => value - 1);
              setStockId('');
              key.current = createRequestId();
            }}
          >
            <ChevronLeft size={16} aria-hidden="true" />
            前へ
          </button>
          <span>
            {page} / {Math.ceil(total / 24)}
          </span>
          <button
            type="button"
            className="button secondary"
            disabled={busy || loading || page * 24 >= total}
            onClick={() => {
              setPage((value) => value + 1);
              setStockId('');
              key.current = createRequestId();
            }}
          >
            次へ
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      <label htmlFor="question-text">問い</label>
      <textarea
        id="question-text"
        value={text}
        disabled={busy}
        required
        rows={4}
        maxLength={500}
        placeholder="考えたいこと、確かめたいことは？"
        aria-describedby="question-text-hint"
        onChange={(event) => {
          setText(event.target.value);
          setError('');
          key.current = createRequestId();
        }}
      />
      <p id="question-text-hint" className="profile-hint profile-bio-hint">
        <span>500文字まで。</span>
        <span>{text.length} / 500</span>
      </p>
      {(loadError || error) && (
        <p className="form-error" role="alert">
          {error || loadError}
        </p>
      )}
      <div className="form-actions">
        <button className="button primary" disabled={busy || !project}>
          {busy ? (
            <LoaderCircle className="spin" size={17} aria-hidden="true" />
          ) : (
            <CircleHelp size={17} aria-hidden="true" />
          )}
          {busy ? '保存中…' : '問いを追加'}
        </button>
      </div>
    </form>
  );
}
