import OgImage from './OgImage';
import { Check, ExternalLink, Pencil, RefreshCw } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { Project, Stock } from '../../../shared/domain';
import { stockTextLimit } from '../../../shared/domain';
import { isYouTubeUrl, youtubeDisplayTitle } from '../../../shared/youtube';
import DeleteAction from '../../components/DeleteAction';
import { FormError } from '../../components/FormError';
import LinkedText from '../../components/LinkedText';
import { Spinner } from '../../components/Spinner';
import { applicationError, t, useLanguage } from '../../i18n/i18n';
import { api, send } from '../../lib/api';
import { fullDate } from '../../lib/dates';
import Comments from '../comments/Comments';
import { StockQuestion } from '../questions/Questions';
import { statusLabels } from './stock-labels';
import { StockFavoriteButton } from './StockFavoriteButton';
import StockImages from './StockImages';
import YouTubePlayer from './YouTubePlayer';

export function StockDetail({
  stock,
  projects,
  initialTab,
  onDone,
  onDeleted,
  onQuestion,
  onFavorite,
  favoriteBusy,
  onRename,
}: {
  stock: Stock;
  projects: Project[];
  initialTab: 'summary' | 'question';
  onDone: (message: string) => void;
  onDeleted: (message: string) => void;
  onQuestion: (id: string) => void;
  onFavorite: (stock: Stock) => Promise<void>;
  favoriteBusy: boolean;
  onRename: (stock: Stock, title: string) => Promise<void>;
}) {
  useLanguage();
  const youtube = stock.source_type === 'url' && isYouTubeUrl(stock.source_url);
  const displayTitle = youtube ? youtubeDisplayTitle(stock.title) : stock.title;
  const [tab, setTab] = useState<string>(youtube ? 'summary' : initialTab);
  const [note, setNote] = useState(stock.note);
  const [projectId, setProjectId] = useState(stock.project_id);
  const [content, setContent] = useState<string | null | undefined>();
  const [busy, setBusy] = useState(false);
  const [supplemental, setSupplemental] = useState('');
  const [error, setError] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(displayTitle);
  const [titleError, setTitleError] = useState('');
  const titleInput = useRef<HTMLInputElement>(null);
  const titleButton = useRef<HTMLButtonElement>(null);
  const noteInput = useRef<HTMLTextAreaElement>(null);
  const noteHintId = useId();
  const titleId = useId();
  useEffect(() => {
    if (tab === 'note') noteInput.current?.focus();
  }, [tab]);
  useEffect(() => {
    if (editingTitle) {
      titleInput.current?.focus();
      titleInput.current?.select();
    }
  }, [editingTitle]);
  const finishEditingTitle = () => {
    setEditingTitle(false);
    window.requestAnimationFrame(() => titleButton.current?.focus());
  };
  useEffect(() => {
    setContent(undefined);
  }, [stock.id, stock.status]);
  useEffect(() => {
    let active = true;
    if (tab === 'content' && content === undefined)
      void api<{
        content: string | null;
      }>(`/api/v1/stocks/${stock.id}/content`)
        .then((result) => {
          if (active) setContent(result.content);
        })
        .catch((e) => {
          if (active) setError(applicationError((e as Error).message));
        });
    return () => {
      active = false;
    };
  }, [tab, content, stock.id, stock.status]);
  return (
    <div className="stock-detail">
      <div className="detail-domain">
        {stock.source_type === 'text' ? t('ui.app.text') : stock.domain}{' '}
        {stock.status !== 'ready' && !youtube && (
          <span className={`status status-${stock.status}`}>{statusLabels()[stock.status]}</span>
        )}
      </div>
      {editingTitle ? (
        <form
          className="stock-title-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setTitleError('');
            try {
              await onRename(stock, title.trim());
              finishEditingTitle();
            } catch (e) {
              setTitleError(applicationError((e as Error).message));
            } finally {
              setBusy(false);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              if (!busy) finishEditingTitle();
            }
          }}
        >
          <label htmlFor={titleId}>{t('ui.app.title_2')}</label>
          <input
            ref={titleInput}
            id={titleId}
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            required
            disabled={busy}
            aria-invalid={!!titleError}
          />
          <FormError error={titleError} />
          <div className="form-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={finishEditingTitle}
            >
              {t('ui.app.cancel')}
            </button>
            <button className="button primary" disabled={busy || !title.trim()}>
              {busy ? <Spinner /> : <Check size={16} aria-hidden="true" />}
              {busy ? t('ui.app.saving') : t('ui.app.save')}
            </button>
          </div>
        </form>
      ) : (
        <div className="stock-detail-title">
          <h3>{displayTitle}</h3>
          <button
            ref={titleButton}
            type="button"
            className="icon-button"
            aria-label={t('ui.app.edit_title')}
            title={t('ui.app.edit_title')}
            disabled={busy}
            onClick={() => {
              setTitle(displayTitle);
              setTitleError('');
              setEditingTitle(true);
            }}
          >
            <Pencil size={18} aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="stock-detail-links">
        {stock.source_type === 'url' && (
          <a
            className="original-link"
            href={stock.source_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {youtube ? t('ui.app.open_on_youtube') : t('ui.app.open_original_article')}
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        )}
        <StockFavoriteButton
          stock={stock}
          busy={favoriteBusy}
          showLabel
          onClick={async () => {
            setError('');
            try {
              await onFavorite(stock);
            } catch (e) {
              setError(applicationError((e as Error).message));
            }
          }}
        />
      </div>
      <div className="detail-tabs" aria-label={t('ui.app.article_views')}>
        {(youtube
          ? [
              ['summary', t('ui.app.video')],
              ['images', t('stock_images.title')],
              ['comments', t('ui.app.comments')],
              ['note', t('ui.app.note_destination')],
            ]
          : [
              ['summary', t('ui.app.summary')],
              ['question', t('ui.app.questions_insights')],
              ['images', t('stock_images.title')],
              ['comments', t('ui.app.comments')],
              [
                'content',
                stock.source_type === 'text'
                  ? t('ui.app.entered_text')
                  : t('ui.app.retrieved_text'),
              ],
              ['note', t('ui.app.note_destination')],
            ]
        ).map(([value, label]) => (
          <button
            key={value}
            aria-pressed={tab === value}
            className={tab === value ? 'active' : ''}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'summary' ? (
        <div className="detail-summary">
          {!youtube && !!stock.has_og_image && (
            <OgImage src={`/api/v1/stocks/${encodeURIComponent(stock.id)}/og-image`} />
          )}
          {youtube ? (
            <>
              <YouTubePlayer url={stock.source_url} />
              <StockImages stockId={stock.id} view="summary" />
            </>
          ) : stock.summary ? (
            <>
              <p className={stock.summary.verbatim ? 'verbatim-content' : undefined}>
                <LinkedText text={stock.summary.overview} />
              </p>
              <StockImages stockId={stock.id} view="summary" />
              {stock.summary.shortSource && (
                <div className="local-model-note">
                  <p>{t('ui.app.this_text_is_short_so_the_original_is_shown')}</p>
                  {!stock.note.trim() && (
                    <>
                      <p>{t('ui.app.leave_a_short_note_about_why_it_caught_your')}</p>
                      <button className="button secondary" onClick={() => setTab('note')}>
                        {t('ui.app.leave_a_short_note')}
                      </button>
                    </>
                  )}
                </div>
              )}
              {stock.summary.keyPoints.length > 0 && <h4>{t('ui.app.key_points')}</h4>}
              <ul>
                {stock.summary.keyPoints.map((point, index) => (
                  <li key={index}>{point}</li>
                ))}
              </ul>
              <div className="article-tags">
                {stock.summary.topics.map((topic) => (
                  <span key={topic}>{topic}</span>
                ))}
              </div>
              {stock.model?.startsWith('local') || stock.model === 'demo-fixture' ? (
                <p className="local-model-note">
                  {t('ui.app.this_is_a_demo_summary_newly_saved_articles_show')}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p>
                {(applicationError(stock.error) || undefined) ??
                  t('ui.app.generating_the_summary_please_wait')}
              </p>
              <StockImages stockId={stock.id} view="summary" />
            </>
          )}
          {stock.status === 'failed' && !youtube && (
            <>
              {stock.source_type === 'url' && (
                <>
                  <label htmlFor="retry-content">
                    {t('ui.app.supply_article_text_and_retry_optional')}
                  </label>
                  <textarea
                    id="retry-content"
                    value={supplemental}
                    disabled={busy}
                    maxLength={stockTextLimit}
                    rows={5}
                    onChange={(event) => setSupplemental(event.target.value)}
                  />
                </>
              )}
              <button
                className="button secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await send(
                      `/api/v1/stocks/${stock.id}/retry`,
                      supplemental.trim() ? { supplemental_text: supplemental } : {},
                    );
                    setContent(undefined);
                    onDone(
                      stock.source_type === 'text'
                        ? t('ui.app.summary_retry_accepted')
                        : t('ui.app.article_retrieval_retry_accepted'),
                    );
                  } catch (e) {
                    setError(applicationError((e as Error).message));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <RefreshCw size={16} aria-hidden="true" />
                {supplemental.trim()
                  ? t('ui.app.retry_with_this_text')
                  : stock.source_type === 'text'
                    ? t('ui.app.retry_summary')
                    : t('ui.app.retry_retrieval')}
              </button>
            </>
          )}
        </div>
      ) : tab === 'question' ? (
        <StockQuestion stockId={stock.id} onQuestion={onQuestion} />
      ) : tab === 'images' ? (
        <StockImages key={stock.id} stockId={stock.id} />
      ) : tab === 'content' ? (
        content === undefined ? (
          <p className="content-loading">
            <Spinner />
            {t('ui.app.loading_article_text')}
          </p>
        ) : (
          <pre className="article-body">
            <LinkedText
              text={content ?? t('ui.app.no_retrieved_text_is_available_for_sample_articles_open')}
            />
          </pre>
        )
      ) : tab === 'note' ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            try {
              await send(`/api/v1/stocks/${stock.id}`, { note, project_id: projectId }, 'PATCH');
              onDone(
                stock.summary?.shortSource && note !== stock.note
                  ? t('ui.app.note_saved_it_will_inform_questions_insights_and_memory')
                  : t('ui.app.note_and_destination_updated'),
              );
            } catch (e) {
              setError(applicationError((e as Error).message));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="edit-note">
            {stock.summary?.shortSource
              ? t('ui.app.why_did_it_catch_your_attention_note')
              : t('ui.app.note_2')}
          </label>
          {stock.summary?.shortSource && (
            <p id={noteHintId} className="local-model-note">
              {t('ui.app.leave_a_short_note_to_inform_questions_insights_and')}
            </p>
          )}
          <textarea
            ref={noteInput}
            id="edit-note"
            aria-describedby={stock.summary?.shortSource ? noteHintId : undefined}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            maxLength={2000}
            disabled={busy}
          />
          <label htmlFor="edit-project">{t('ui.app.destination_project')}</label>
          <select
            id="edit-project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <div className="form-actions">
            <button className="button primary" disabled={busy}>
              {busy && <Spinner />}
              {t('ui.app.save_changes')}
            </button>
          </div>
        </form>
      ) : null}
      <div hidden={tab !== 'comments'}>
        <Comments targetType="stock" targetId={stock.id} />
      </div>
      <FormError error={error} />
      <div className="detail-footer">
        <span>
          {fullDate(stock.created_at)}
          {t('ui.app.saved_in')}
        </span>
      </div>
      <DeleteAction
        label={t('ui.app.delete_this_stock')}
        title={t('ui.app.delete_this_stock_2')}
        disabled={busy || favoriteBusy}
        onDelete={async () => {
          await api(`/api/v1/stocks/${stock.id}`, { method: 'DELETE' });
          onDeleted(t('ui.app.article_deleted_and_memory_update_accepted'));
        }}
      >
        <p className="delete-target">{displayTitle}</p>
        <p>
          {t('ui.app.destination')}
          {stock.project_name}
        </p>
        <p>{t('ui.app.delete_this_project_s_stock_and_its_comments_related')}</p>
        <p>{t('ui.app.this_cannot_be_undone')}</p>
      </DeleteAction>
    </div>
  );
}
