import { useEffect, useId, useState } from 'react';
import { ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react';
import { api } from './api';

export type RelationOption = { id: string; label: string };

export default function RelationPicker({
  kind,
  projectId,
  value,
  onChange,
  disabled = false,
}: {
  kind: 'stocks' | 'questions';
  projectId: string;
  value: RelationOption[];
  onChange: (value: RelationOption[]) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const label = kind === 'stocks' ? 'ストック' : '問い・気づき';
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<RelationOption[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(query);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({ project_id: projectId, q: search, page: String(page) });
    if (kind === 'questions') params.set('status', 'ready');
    void api<{
      stocks?: { id: string; title: string }[];
      questions?: { id: string; text: string }[];
      total: number;
    }>(`/api/v1/${kind}?${params}`, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setItems(
          kind === 'stocks'
            ? (result.stocks ?? []).map((item) => ({ id: item.id, label: item.title }))
            : (result.questions ?? []).map((item) => ({ id: item.id, label: item.text })),
        );
        setTotal(result.total);
        setError('');
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) {
          setItems([]);
          setError(e.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [kind, projectId, search, page, retry]);
  const option = (item: RelationOption, checked: boolean) => (
    <label className="relation-option" key={item.id}>
      <input
        type="checkbox"
        value={item.id}
        checked={checked}
        disabled={disabled}
        onChange={() =>
          onChange(checked ? value.filter((entry) => entry.id !== item.id) : [...value, item])
        }
      />
      <span>{item.label}</span>
    </label>
  );
  return (
    <fieldset className="relation-picker" disabled={disabled || !projectId}>
      <legend>
        関連する{label}
        <span className="optional">任意・複数選択可</span>
      </legend>
      <div className="relation-selected">
        <p className="field-hint" aria-live="polite">
          選択済み {value.length}件
        </p>
        {value.map((item) => option(item, true))}
      </div>
      <label htmlFor={`${id}-search`}>{label}を検索</label>
      <input
        id={`${id}-search`}
        type="search"
        value={query}
        placeholder={kind === 'stocks' ? '記事のタイトルなどで検索' : '問い・気づきの本文で検索'}
        onInput={(event) => setQuery(event.currentTarget.value)}
      />
      <div className="relation-options" aria-busy={loading}>
        {loading ? (
          <p className="field-hint">
            <LoaderCircle className="spin" size={16} aria-hidden="true" /> 読み込んでいます…
          </p>
        ) : items.length ? (
          items
            .filter((item) => !value.some((selected) => selected.id === item.id))
            .map((item) => option(item, false))
        ) : (
          !error && (
            <p className="field-hint">
              {search
                ? '該当する候補がありません。検索語を変えてください。'
                : `関連付けられる${label}はありません。`}
            </p>
          )
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
          <button
            type="button"
            className="button text-button"
            onClick={() => setRetry((current) => current + 1)}
          >
            再読み込み
          </button>
        </p>
      )}
      {total > 24 && (
        <div className="question-stock-pages" aria-label={`${label}の候補ページ`}>
          <button
            type="button"
            className="button secondary"
            disabled={loading || page === 1}
            onClick={() => setPage((current) => current - 1)}
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
            disabled={loading || page * 24 >= total}
            onClick={() => setPage((current) => current + 1)}
          >
            次へ
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </fieldset>
  );
}
