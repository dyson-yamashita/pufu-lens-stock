import { applicationError, t, intlLocale, useLanguage } from './i18n';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { LoaderCircle, MessageSquare, RefreshCw } from 'lucide-react';
import type { CommentList, CommentTarget, EntityComment } from '../shared/comments';
import { api, createRequestId, send } from './api';
type CommentDraft = {
  body: string;
  request: {
    body: string;
    id: string;
  } | null;
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
  useLanguage();
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
  useLanguage();
  const [comments, setComments] = useState<EntityComment[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [focused, setFocused] = useState(false);
  const headingId = useId();
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
      if (!signal.aborted) setLoadError(applicationError((error as Error).message));
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
      const data = await send<{
        comment: EntityComment;
      }>('/api/v1/comments', {
        ...target,
        body: text,
        request_id: request.id,
      });
      updateDraft((current) => ({
        ...emptyDraft,
        posted: mergeComments(current.posted, [data.comment]),
        notice: t('ui.comments.comment_added'),
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
          {phase === undefined
            ? t('ui.app.comments')
            : t('ui.comments.comments_for_phase_value', { value0: phase })}
        </h2>
        <button
          type="button"
          className="button text-button"
          disabled={loading || busy}
          onClick={() => void load(1, controller.current!.signal)}
        >
          <RefreshCw size={15} aria-hidden="true" />
          {t('ui.comments.refresh')}
        </button>
      </div>
      {loadError && (
        <p className="form-error" role="alert">
          {loadError}
          {t('ui.comments.use_refresh_to_try_again')}
        </p>
      )}
      {visibleComments.length > 0 && (
        <ol className="comment-list">
          {visibleComments.map((item) => (
            <li key={item.id}>
              <div className="comment-meta">
                <span>
                  {item.author_name}
                  {t('ui.comments.separator')}
                  {item.author_kind === 'agent'
                    ? t('ui.comments.ai_integration')
                    : t('ui.comments.you')}
                </span>
                <time dateTime={item.created_at}>
                  {new Intl.DateTimeFormat(intlLocale(), {
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
      )}
      {loading && (
        <p className="content-loading" role="status">
          <LoaderCircle size={17} className="spin" aria-hidden="true" />
          {t('ui.comments.loading_comments')}
        </p>
      )}
      {hasMore && (
        <button
          type="button"
          className="button secondary"
          disabled={loading || busy}
          onClick={() => void load(page + 1, controller.current!.signal)}
        >
          {t('ui.comments.load_more')}
        </button>
      )}
      <form onSubmit={submit}>
        <textarea
          aria-label={t('ui.comments.add_comment')}
          aria-describedby={hintId}
          placeholder={t('ui.comments.add_a_comment')}
          value={body}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onInput={(event) => {
            const value = event.currentTarget.value;
            updateDraft((current) => ({ ...current, body: value }));
          }}
          rows={focused || body ? 3 : 1}
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
          <span className="field-hint" id={hintId}>
            {t('ui.comments.up_to_2_000_characters')}
          </span>
          <button className="button primary" disabled={busy || loading || !body.trim()}>
            {busy && <LoaderCircle size={16} className="spin" aria-hidden="true" />}
            {busy ? t('ui.comments.adding') : t('ui.comments.add_comment')}
          </button>
        </div>
      </form>
    </section>
  );
}
