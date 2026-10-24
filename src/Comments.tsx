import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { LoaderCircle, MessageSquare, RefreshCw } from 'lucide-react';
import type { CommentList, CommentTarget, EntityComment } from '../shared/comments';
import { api, createRequestId, send } from './api';

type CommentDraft = {
  body: string;
  request: { body: string; id: string } | null;
  busy: boolean;
  error: string;
  posted: EntityComment[];
  notice: string;
};
const emptyDraft: CommentDraft = {
  body: '',
  request: null,
  busy: false,
  error: '',
  posted: [],
  notice: '',
};
export default function Comments({
  targetType,
  targetId,
  phase,
}: {
  targetType: CommentTarget['target_type'];
  targetId: string;
  phase?: number;
}) {
  const [drafts, setDrafts] = useState<Record<string, CommentDraft>>({});
  const key = `${targetType}:${targetId}:${phase ?? ''}`;
  return (
    <CommentThread
      key={key}
      draft={drafts[key] ?? emptyDraft}
      updateDraft={(update) =>
        setDrafts((current) => ({ ...current, [key]: update(current[key] ?? emptyDraft) }))
      }
      target={{
        target_type: targetType,
        target_id: targetId,
        ...(phase === undefined ? {} : { phase }),
      }}
    />
  );
}
function mergeComments(current: EntityComment[], next: EntityComment[]) {
  return [...new Map([...current, ...next].map((item) => [item.id, item])).values()].sort(
    (a, b) => {
      return (
        Date.parse(a.created_at) - Date.parse(b.created_at) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      );
    },
  );
}
function CommentThread({
  target,
  draft,
  updateDraft,
}: {
  target: CommentTarget;
  draft: CommentDraft;
  updateDraft: (update: (current: CommentDraft) => CommentDraft) => void;
}) {
  const [comments, setComments] = useState<EntityComment[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const headingId = useId();
  const fieldId = useId();
  const hintId = useId();
  const controller = useRef<AbortController | null>(null);
  const targetType = target.target_type,
    targetId = target.target_id,
    phase = target.phase;
  const { body, busy, error: postError, notice } = draft;
  // 古いThreadでPOSTが完了しても、現在の局面の一覧へ成功結果を反映する。
  const visibleComments = mergeComments(draft.posted, comments);
  async function load(nextPage: number, signal: AbortSignal) {
    setLoading(true);
    setLoadError('');
    try {
      const query = new URLSearchParams({
        target_type: targetType,
        target_id: targetId,
        page: String(nextPage),
        ...(phase === undefined ? {} : { phase: String(phase) }),
      });
      const data = await api<CommentList>(`/api/v1/comments?${query}`, { signal });
      if (!signal.aborted) {
        setComments((current) =>
          nextPage === 1 ? data.comments : mergeComments(current, data.comments),
        );
        setPage(nextPage);
        setHasMore(data.has_more);
      }
    } catch (error) {
      if (!signal.aborted) setLoadError((error as Error).message);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    void load(1, active.signal);
    return () => active.abort();
    // 対象の変更は親のkeyで再マウントする。古い通信はabortして反映させない。
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || loading || !body.trim()) return;
    const text = body.trim();
    const request =
      draft.request?.body === text ? draft.request : { body: text, id: createRequestId() };
    updateDraft((current) => ({ ...current, request, busy: true, error: '', notice: '' }));
    try {
      const data = await send<{ comment: EntityComment }>('/api/v1/comments', {
        ...target,
        body: text,
        request_id: request.id,
      });
      updateDraft((current) => ({
        ...emptyDraft,
        posted: mergeComments(current.posted, [data.comment]),
        notice: 'コメントを追加しました。',
      }));
    } catch (error) {
      updateDraft((current) => ({ ...current, error: (error as Error).message }));
    } finally {
      updateDraft((current) => ({ ...current, busy: false }));
    }
  }
  return (
    <section className="comments" aria-labelledby={headingId}>
      <div className="comments-heading">
        <h2 id={headingId}>
          <MessageSquare size={18} aria-hidden="true" />
          {phase === undefined ? 'コメント' : `第${phase}局面のコメント`}
        </h2>
        <button
          type="button"
          className="button secondary"
          disabled={loading || busy}
          onClick={() => void load(1, controller.current!.signal)}
        >
          <RefreshCw size={15} aria-hidden="true" />
          更新
        </button>
      </div>
      <p className="field-hint" id={hintId}>
        自分用の記録です。公開ページやAIのメモリには含まれません。
      </p>
      {loadError && (
        <p className="form-error" role="alert">
          {loadError}「更新」で再試行できます。
        </p>
      )}
      {visibleComments.length > 0 ? (
        <ol className="comment-list">
          {visibleComments.map((item) => (
            <li key={item.id}>
              <div className="comment-meta">
                <span>
                  {item.author_name}・{item.author_kind === 'agent' ? 'AI連携' : '本人'}
                </span>
                <time dateTime={item.created_at}>
                  {new Intl.DateTimeFormat('ja-JP', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: 'Asia/Tokyo',
                  }).format(new Date(item.created_at))}
                </time>
              </div>
              <p>{item.body}</p>
            </li>
          ))}
        </ol>
      ) : (
        !loading && !loadError && <p className="field-hint">コメントはまだありません。</p>
      )}
      {loading && (
        <p className="content-loading" role="status">
          <LoaderCircle size={17} className="spin" aria-hidden="true" />
          コメントを読み込んでいます…
        </p>
      )}
      {hasMore && (
        <button
          type="button"
          className="button secondary"
          disabled={loading || busy}
          onClick={() => void load(page + 1, controller.current!.signal)}
        >
          続きを読み込む
        </button>
      )}
      <form onSubmit={submit}>
        <label htmlFor={fieldId}>コメントを追加</label>
        <textarea
          id={fieldId}
          aria-describedby={hintId}
          value={body}
          onInput={(event) => {
            const value = event.currentTarget.value;
            updateDraft((current) => ({ ...current, body: value }));
          }}
          rows={3}
          maxLength={2000}
          disabled={busy}
        />
        {postError && (
          <p className="form-error" role="alert">
            {postError}
          </p>
        )}
        {notice && (
          <p role="status" className="field-hint">
            {notice}
          </p>
        )}
        <div className="form-actions">
          <span className="field-hint">2,000文字まで</span>
          <button className="button primary" disabled={busy || loading || !body.trim()}>
            {busy && <LoaderCircle size={16} className="spin" aria-hidden="true" />}
            {busy ? '追加中…' : 'コメントを追加'}
          </button>
        </div>
      </form>
    </section>
  );
}
