import { publicHref, publicHash, publicPathPattern } from '../shared/public-route';
import { pufuDisplayTitle } from '../shared/pufu';
import { applicationError, t, intlLocale, useLanguage, manualHref } from './i18n';
import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CircleHelp,
  Copy,
  ExternalLink,
  Folder,
  Globe,
  Layers,
  LoaderCircle,
  LockKeyhole,
  Network,
  Triangle,
} from 'lucide-react';
import type {
  Publication,
  PublicList,
  PublicProject,
  PublicProjectDetail,
  PublicStock,
  PublicStockDetail,
  PublicQuestion,
  PublicPufu,
  PublicPufuSummary,
} from '../shared/public-project';
import { api, send } from './api';
import QuestionLabels from './QuestionLabels';
import YouTubePlayer from './YouTubePlayer';
import YouTubeThumbnail from './YouTubeThumbnail';
import { isYouTubeUrl, youtubeDisplayTitle } from '../shared/youtube';
const PublicPufuScore = lazy(async () => {
  try {
    return await import('./PublicPufuScore');
  } catch {
    return {
      default: () => (
        <ResourceState
          error={t('ui.public_projects.could_not_load_the_pufu_image_please_reload')}
          retry={() => window.location.reload()}
        />
      ),
    };
  }
});
function publicLink(hash: string) {
  const route = publicPathPattern.exec(window.location.pathname ?? '');
  return route ? publicHref(`/p/${route[1]}`, hash) : hash;
}
function useResource<T>(path: string) {
  const [state, setState] = useState<{
    path: string;
    data?: T;
    error?: string;
  }>({ path });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ path });
    api<T>(path, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setState({ path, data });
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setState({ path, error: e.message });
      });
    return () => controller.abort();
  }, [path, retry]);
  return { ...(state.path === path ? state : { path }), reload: () => setRetry((v) => v + 1) };
}
function ResourceState({ error, retry }: { error?: string; retry: () => void }) {
  useLanguage();
  return error ? (
    <div role="alert" className="public-message">
      <p>{error}</p>
      <button className="button secondary" onClick={retry}>
        {t('ui.app.reload')}
      </button>
    </div>
  ) : (
    <p role="status" className="public-message">
      <LoaderCircle className="spin" size={18} aria-hidden="true" />
      {t('ui.public_projects.loading')}
    </p>
  );
}
function PublicBrand() {
  useLanguage();
  return (
    <a href="/" className="brand">
      <img className="brand-mark" src="/pufu-lens-logo.png" alt="" width="38" height="38" />
      <span>Pufu Lens</span>
    </a>
  );
}
function initialPublicPage() {
  const value = Number(new URLSearchParams(window.location.search ?? '').get('page'));
  return Number.isInteger(value) && value >= 1 && value <= 5000 ? value : 1;
}
function Pagination({
  page,
  hasMore,
  onChange,
}: {
  page: number;
  hasMore: boolean;
  onChange: (page: number) => void;
}) {
  useLanguage();
  if (page === 1 && !hasMore) return null;
  const change = (next: number) => {
    const route = publicPathPattern.exec(window.location.pathname ?? '');
    if (route) {
      const url = new URL(window.location.href);
      if (next === 1) url.searchParams.delete('page');
      else url.searchParams.set('page', String(next));
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    onChange(next);
  };
  return (
    <nav className="public-pagination" aria-label={t('ui.public_projects.pagination')}>
      <button className="button secondary" disabled={page === 1} onClick={() => change(page - 1)}>
        {t('ui.app.previous')}
      </button>
      <span>{t('pagination.page', { page })}</span>
      <button className="button secondary" disabled={!hasMore} onClick={() => change(page + 1)}>
        {t('ui.app.next')}
      </button>
    </nav>
  );
}
export function PublicProjectDirectory() {
  useLanguage();
  const [page, setPage] = useState(initialPublicPage);
  const { data, error, reload } = useResource<PublicList<PublicProject>>(
    `/api/public/projects?page=${page}`,
  );
  return (
    <section
      id="public-projects"
      className="public-directory"
      aria-labelledby="public-directory-heading"
    >
      <div className="public-section-heading">
        <h2 id="public-directory-heading">{t('ui.public_projects.public_projects')}</h2>
      </div>
      <p className="public-lead">
        {t('ui.public_projects.discover_your_next_idea_through_someone_else_s_interests')}
      </p>
      {!data ? (
        <ResourceState error={error} retry={reload} />
      ) : (
        <>
          <div className="public-project-grid">
            {data.items.map((project) => (
              <a
                className="public-project-card"
                key={project.public_id}
                href={`/p/${encodeURIComponent(project.public_id)}`}
              >
                <span className="public-badge">
                  <Globe size={13} aria-hidden="true" />
                  {t('ui.public_projects.public')}
                </span>
                <h3 title={project.name}>{project.name}</h3>
                <p>
                  {project.public_description ||
                    t(
                      'ui.public_projects.sharing_collected_stocks_and_the_questions_and_insights_they',
                    )}
                </p>
                <div className="public-card-footer">
                  <span>
                    <Layers size={16} aria-hidden="true" />
                    {project.stock_count}
                    {t('ui.public_projects.stocks')}
                  </span>
                  <span>
                    <CircleHelp size={16} aria-hidden="true" />
                    {project.question_count}
                    {t('ui.public_projects.questions_insights')}
                  </span>
                </div>
              </a>
            ))}
          </div>
          {data.items.length === 0 && (
            <p className="public-message">{t('ui.public_projects.no_public_projects_yet')}</p>
          )}
          <Pagination page={page} hasMore={data.has_more} onChange={setPage} />
        </>
      )}
    </section>
  );
}
export function ProjectPublicationSettings({ projectId }: { projectId: string }) {
  useLanguage();
  const id = useId();
  const { data, error, reload } = useResource<{
    publication: Publication;
  }>(`/api/v1/projects/${encodeURIComponent(projectId)}/publication`);
  return (
    <section className="publication-settings" aria-labelledby={`${id}-title`}>
      <div className="public-section-heading">
        <h2 id={`${id}-title`}>
          <Globe size={20} aria-hidden="true" />
          {t('ui.public_projects.publication_settings')}
        </h2>
      </div>
      {data ? (
        <PublicationForm
          key={`${projectId}-${data.publication.public_id}`}
          initial={data.publication}
          projectId={projectId}
        />
      ) : (
        <ResourceState error={error} retry={reload} />
      )}
    </section>
  );
}
function PublicationForm({ initial, projectId }: { initial: Publication; projectId: string }) {
  useLanguage();
  const id = useId();
  const [saved, setSaved] = useState(initial);
  const [enabled, setEnabled] = useState(initial.is_public);
  const [searchIndexable, setSearchIndexable] = useState(initial.search_indexable ?? false);
  const [description, setDescription] = useState(initial.public_description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const saveRef = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const url = saved.public_id ? `${window.location.origin}/p/${saved.public_id}` : '';
  async function save() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await send<{
        publication: Publication;
      }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/publication`,
        {
          is_public: enabled,
          search_indexable: enabled && searchIndexable,
          public_description: description,
        },
        'PATCH',
      );
      setSaved(result.publication);
      setSearchIndexable(result.publication.search_indexable ?? false);
      setDescription(result.publication.public_description);
      setConfirming(false);
      setMessage(
        result.publication.is_public
          ? t('ui.public_projects.publication_settings_saved_the_project_is_also_listed_on')
          : t('ui.public_projects.the_project_is_private_its_public_url_is_no'),
      );
    } catch (e) {
      setError(applicationError((e as Error).message));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (inFlight.current || confirming) return;
          setError('');
          setMessage('');
          if (enabled && (!saved.is_public || (searchIndexable && !saved.search_indexable)))
            setConfirming(true);
          else void save();
        }}
      >
        <label className="project-memory-toggle" htmlFor={`${id}-toggle`}>
          <span>{t('ui.public_projects.publish_a_project')}</span>
          <input
            id={`${id}-toggle`}
            type="checkbox"
            role="switch"
            checked={enabled}
            disabled={busy}
            onChange={(e) => {
              setEnabled(e.target.checked);
              if (!e.target.checked) setSearchIndexable(false);
              setMessage('');
            }}
            aria-describedby={`${id}-scope`}
          />
        </label>
        <p className="public-help" id={`${id}-scope`}>
          {t('ui.public_projects.publishing_creates_a_url_viewable_without_sign_in_and')}
        </p>
        <label className="project-memory-toggle" htmlFor={`${id}-search`}>
          <span>{t('ui.public_projects.allow_search_indexing')}</span>
          <input
            id={`${id}-search`}
            type="checkbox"
            data-search-indexable
            checked={searchIndexable}
            disabled={busy || !enabled}
            onChange={(e) => setSearchIndexable(e.target.checked)}
            aria-describedby={`${id}-search-help`}
          />
        </label>
        <p className="public-help" id={`${id}-search-help`}>
          {t('ui.public_projects.search_indexing_help')}
        </p>
        <div className="publication-scope">
          <strong>{t('ui.public_projects.what_will_be_published')}</strong>
          <ul>
            <li>{t('ui.public_projects.project_name_and_public_introduction')}</li>
            <li>{t('ui.public_projects.stock_titles_urls_summaries_key_points_and_topics')}</li>
            <li>
              {t('ui.public_projects.questions_insights_and_the_latest_phases_and_reflections_of')}
            </li>
          </ul>
          <p>
            <LockKeyhole size={15} aria-hidden="true" />
            {t(
              'ui.public_projects.memories_private_notes_retrieved_article_text_and_internal_project',
            )}
          </p>
        </div>
        <p className="public-help">
          {t('ui.public_projects.additions_and_changes_made_while_published_are_also_reflected')}
        </p>
        <label htmlFor={`${id}-description`}>
          {t('ui.public_projects.public_introduction')}
          <span className="optional">{t('ui.app.optional')}</span>
        </label>
        <textarea
          id={`${id}-description`}
          rows={3}
          maxLength={1000}
          value={description}
          disabled={busy}
          placeholder={t('ui.public_projects.themes_collected_in_this_project_or_why_you_are')}
          onChange={(e) => setDescription(e.target.value)}
        />
        {saved.is_public && url && (
          <div className="publication-url">
            <label htmlFor={`${id}-url`}>{t('ui.public_projects.public_url')}</label>
            <input id={`${id}-url`} readOnly value={url} />
            <div>
              <a className="button secondary" href={url} target="_blank" rel="noreferrer">
                <ExternalLink size={16} aria-hidden="true" />
                {t('ui.public_projects.view_public_page')}
              </a>
              <button
                className="button subtle"
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(url);
                    setMessage(t('ui.public_projects.public_url_copied'));
                  } catch {
                    setError(t('ui.mcp_connections.select_and_copy_the_url'));
                  }
                }}
              >
                <Copy size={16} aria-hidden="true" />
                {t('ui.public_projects.copy')}
              </button>
            </div>
          </div>
        )}
        {error && !confirming && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="publication-success">
            <Check size={16} aria-hidden="true" />
            {message}
          </p>
        )}
        <div className="form-actions">
          <span className="public-help">
            {t('ui.public_projects.current_status')}
            {saved.is_public ? t('ui.public_projects.published') : t('ui.public_projects.private')}
          </span>
          <button ref={saveRef} className="button primary" disabled={busy}>
            {busy ? t('ui.app.saving') : t('ui.public_projects.save_publication_settings')}
          </button>
        </div>
      </form>
      {confirming && (
        <PublicationConfirmation
          triggerRef={saveRef}
          searchIndexable={searchIndexable}
          busy={busy}
          error={error}
          onClose={() => {
            if (inFlight.current) return;
            setConfirming(false);
            setError('');
          }}
          onConfirm={() => void save()}
        />
      )}
    </>
  );
}
const publicationChecks = () => [
  t('ui.public_projects.i_have_checked_that_the_published_content_contains_no'),
  t('ui.public_projects.i_have_checked_that_the_text_images_and_other'),
  t('ui.public_projects.i_understand_that_anyone_can_view_the_project_without'),
];
function PublicationConfirmation({
  triggerRef,
  searchIndexable,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  triggerRef: RefObject<HTMLButtonElement | null>;
  searchIndexable: boolean;
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  useLanguage();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [checked, setChecked] = useState(publicationChecks().map(() => false));
  const allChecked = checked.every(Boolean);
  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    cancelRef.current?.focus();
    return () => {
      dialog.close();
      triggerRef.current?.focus();
    };
  }, [triggerRef]);
  return (
    <dialog
      ref={dialogRef}
      className="dialog publication-confirmation"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-intro`}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="dialog-head">
        <h2 id={`${id}-title`}>{t('ui.public_projects.before_publishing')}</h2>
      </div>
      <p id={`${id}-intro`} className="public-help">
        {t('ui.public_projects.review_the_content_for_safe_sharing_check_every_box')}
      </p>
      {searchIndexable && (
        <p className="public-help">{t('ui.public_projects.search_indexing_confirmation')}</p>
      )}
      <div className="publication-checks">
        {publicationChecks().map((text, index) => (
          <label key={text} className="publication-check">
            <input
              type="checkbox"
              checked={checked[index]}
              disabled={busy}
              onChange={(event) => {
                const value = event.target.checked;
                setChecked((current) => current.map((item, i) => (i === index ? value : item)));
              }}
            />
            <span>{text}</span>
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button
          ref={cancelRef}
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={onClose}
        >
          {t('ui.app.cancel')}
        </button>
        <button
          type="button"
          className="button primary"
          disabled={!allChecked || busy}
          onClick={() => {
            if (allChecked && !busy) onConfirm();
          }}
        >
          {busy ? t('ui.app.saving') : 'OK'}
        </button>
      </div>
    </dialog>
  );
}
function StockTopics({ stock }: { stock: PublicStock }) {
  useLanguage();
  return (
    stock.summary && (
      <div className="public-topics">
        {stock.summary.topics.map((topic, i) => (
          <span key={i}>{topic}</span>
        ))}
      </div>
    )
  );
}
function StockCard({ stock }: { stock: PublicStock }) {
  useLanguage();
  const youtube = Boolean(stock.source_url && isYouTubeUrl(stock.source_url));
  return (
    <a
      className="public-content-card public-stock-card"
      href={publicLink(`#stock/${encodeURIComponent(stock.id)}`)}
    >
      <p className="public-meta">
        <BookOpen size={16} aria-hidden="true" />
        {stock.domain || t('ui.app.text')}
        <time>{new Date(stock.created_at).toLocaleDateString(intlLocale())}</time>
      </p>
      <h3>{youtube ? youtubeDisplayTitle(stock.title) : stock.title}</h3>
      {youtube && <YouTubeThumbnail url={stock.source_url!} />}
      <p className="public-summary">
        {youtube
          ? t('ui.public_projects.youtube_link_saved')
          : stock.summary?.overview || t('ui.public_projects.no_summary_yet')}
      </p>
      <StockTopics stock={stock} />
      <div className="public-card-footer">
        <span>{t('ui.public_projects.view_stock_details')}</span>
      </div>
    </a>
  );
}
function StockDetails({
  stock,
  heading: Heading = 'h3',
}: {
  stock: PublicStock;
  heading?: 'h3' | 'h4';
}) {
  useLanguage();
  const href = stock.source_url && /^https?:\/\//i.test(stock.source_url) ? stock.source_url : null;
  const youtube = Boolean(href && isYouTubeUrl(href));
  const PointsHeading = Heading === 'h4' ? 'h5' : 'h4';
  return (
    <article className="public-content-card public-stock-detail">
      <p className="public-meta">
        <BookOpen size={16} aria-hidden="true" />
        {stock.domain || t('ui.app.text')}
        <time>{new Date(stock.created_at).toLocaleDateString(intlLocale())}</time>
      </p>
      <Heading className="public-stock-title">
        {youtube ? youtubeDisplayTitle(stock.title) : stock.title}
      </Heading>
      {youtube ? (
        <YouTubePlayer url={href!} />
      ) : (
        <p className="public-summary">
          {stock.summary?.overview || t('ui.public_projects.no_summary_yet')}
        </p>
      )}
      {!youtube && stock.summary && (
        <section className="public-stock-points" aria-label={t('ui.public_projects.key_points')}>
          <PointsHeading>{t('ui.public_projects.key_points')}</PointsHeading>
          <ul>
            {stock.summary.keyPoints.map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ul>
        </section>
      )}
      <StockTopics stock={stock} />
      {href && (
        <a className="text-link" href={href} target="_blank" rel="noreferrer">
          {youtube ? t('ui.app.open_on_youtube') : t('ui.app.open_original_article')}{' '}
          <ExternalLink size={14} aria-hidden="true" />
        </a>
      )}
    </article>
  );
}
function PublicQuestionCard({ question }: { question: PublicQuestion }) {
  useLanguage();
  return (
    <a
      className="public-content-card public-question-card"
      href={publicLink(`#question/${encodeURIComponent(question.id)}`)}
    >
      <QuestionLabels
        question={{ source: question.source, has_pufu: question.pufu_count > 0 ? 1 : 0 }}
      />
      <h3>{question.text}</h3>
      {(
        question.stocks ??
        (question.stock_id ? [{ id: question.stock_id, title: question.article_title }] : [])
      ).map((stock) => (
        <p key={stock.id} className="public-help">
          {stock.title}
        </p>
      ))}
      <div className="public-card-footer">
        <span>
          {question.pufu_count
            ? t('ui.public_projects.value_pufu', { value0: question.pufu_count })
            : t('ui.public_projects.view_question_or_insight_details')}
        </span>
      </div>
    </a>
  );
}
function PublicStockDetailPage({ root, id }: { root: string; id: string }) {
  useLanguage();
  const [page, setPage] = useState(initialPublicPage);
  const { data, error, reload } = useResource<PublicStockDetail>(
    `${root}/stocks/${encodeURIComponent(id)}?page=${page}`,
  );
  return !data ? (
    <ResourceState error={error} retry={reload} />
  ) : (
    <section aria-label={t('ui.public_projects.stock_details')}>
      <a className="text-link" href={publicLink('#stocks')}>
        <ArrowLeft size={16} aria-hidden="true" />
        {t('ui.public_projects.back_to_stocks')}
      </a>
      <h2 className="public-detail-title">{t('ui.public_projects.stock_details')}</h2>
      <StockDetails stock={data.stock} />
      <h3 className="public-detail-title">{t('ui.public_projects.related_questions_insights')}</h3>
      <div className="public-content-grid">
        {data.questions.map((question) => (
          <PublicQuestionCard key={question.id} question={question} />
        ))}
      </div>
      {!data.questions.length && (
        <p className="public-message">
          {t('ui.public_projects.this_stock_has_no_questions_or_insights_available_for')}
        </p>
      )}
      <Pagination page={page} hasMore={data.has_more} onChange={setPage} />
    </section>
  );
}
type PublicListProps = {
  root: string;
  page: number;
  onPageChange: (page: number) => void;
};
function PublicStockList({ root, page, onPageChange }: PublicListProps) {
  useLanguage();
  const { data, error, reload } = useResource<PublicList<PublicStock>>(
    `${root}/stocks?page=${page}`,
  );
  return !data ? (
    <ResourceState error={error} retry={reload} />
  ) : (
    <>
      <div className="public-content-grid">
        {data.items.map((stock) => (
          <StockCard key={stock.id} stock={stock} />
        ))}
      </div>
      {!data.items.length && (
        <p className="public-message">{t('ui.public_projects.no_stocks_yet')}</p>
      )}
      <Pagination page={page} hasMore={data.has_more} onChange={onPageChange} />
    </>
  );
}
function PublicQuestionList({ root, page, onPageChange }: PublicListProps) {
  useLanguage();
  const { data, error, reload } = useResource<PublicList<PublicQuestion>>(
    `${root}/questions?page=${page}`,
  );
  return !data ? (
    <ResourceState error={error} retry={reload} />
  ) : (
    <>
      <div className="public-content-grid">
        {data.items.map((question) => (
          <PublicQuestionCard key={question.id} question={question} />
        ))}
      </div>
      {!data.items.length && (
        <p className="public-message">
          {t('ui.public_projects.no_questions_or_insights_available_for_publication_yet')}
        </p>
      )}
      <Pagination page={page} hasMore={data.has_more} onChange={onPageChange} />
    </>
  );
}
function PublicPufuList({ root, page, onPageChange }: PublicListProps) {
  useLanguage();
  const { data, error, reload } = useResource<PublicList<PublicPufuSummary>>(
    `${root}/pufus?page=${page}`,
  );
  return !data ? (
    <ResourceState error={error} retry={reload} />
  ) : (
    <>
      <div className="public-content-grid">
        {data.items.map((pufu) => (
          <a
            className="public-content-card public-pufu-card"
            key={pufu.id}
            href={publicLink(`#pufu/${encodeURIComponent(pufu.id)}?from=pufus`)}
          >
            <h3>{pufuDisplayTitle(pufu)}</h3>
            <p className="public-help">
              {t('phase.number', { number: pufu.current_phase })}
              {t('ui.public_projects.separator')}
              {pufu.current_phase % 2 === 0 ? t('ui.public_projects.reflection') : t('ui.app.pufu')}
            </p>
            <div className="public-card-footer">
              <time>{new Date(pufu.updated_at).toLocaleDateString(intlLocale())}</time>
            </div>
          </a>
        ))}
      </div>
      {!data.items.length && (
        <p className="public-message">
          {t('ui.public_projects.no_pufu_available_for_publication_yet')}
        </p>
      )}
      <Pagination page={page} hasMore={data.has_more} onChange={onPageChange} />
    </>
  );
}
function PublicQuestionDetail({
  root,
  id,
  projectName,
}: {
  root: string;
  id: string;
  projectName: string;
}) {
  useLanguage();
  const [page, setPage] = useState(initialPublicPage);
  const { data, error, reload } = useResource<{
    question: PublicQuestion;
    stock: PublicStock | null;
    stocks?: PublicStock[];
    pufus: PublicPufuSummary[];
    has_more: boolean;
  }>(`${root}/questions/${encodeURIComponent(id)}?page=${page}`);
  return !data ? (
    <ResourceState error={error} retry={reload} />
  ) : (
    <section
      className="question-detail-page public-question-detail"
      aria-label={t('ui.public_projects.question_or_insight_details')}
    >
      <a className="back-link" href={publicLink('#questions')}>
        <ArrowLeft size={16} aria-hidden="true" />
        {t('ui.public_projects.back_to_questions_insights')}
      </a>
      <header className="page-header">
        <div>
          <h2 className="page-title">{t('ui.public_projects.question_or_insight_details')}</h2>
          <p>{t('ui.public_projects.reflect_on_a_question_or_insight_and_take_the')}</p>
        </div>
      </header>
      <article className="question-detail-card">
        <div className="question-detail-meta">
          <QuestionLabels
            question={{
              source: data.question.source,
              has_pufu: data.question.pufu_count > 0 ? 1 : 0,
            }}
          />
          <span>
            <Folder size={15} aria-hidden="true" />
            {projectName}
          </span>
        </div>
        <h3 className="question-text">{data.question.text}</h3>
        {(data.question.stocks ?? (data.stock ? [data.stock] : [])).map((stock) => (
          <div className="question-detail-source" key={stock.id}>
            <a href={publicLink(`#stock/${encodeURIComponent(stock.id)}`)}>
              <BookOpen size={17} aria-hidden="true" />
              <span>{stock.title}</span>
              <ArrowRight size={16} aria-hidden="true" />
            </a>
          </div>
        ))}
        <div className="question-card-footer">
          <time dateTime={data.question.created_at}>
            {new Intl.DateTimeFormat(intlLocale(), {
              dateStyle: 'medium',
              timeZone: 'Asia/Tokyo',
            }).format(new Date(data.question.created_at))}
          </time>
        </div>
      </article>
      <div className="section-head pufu-list-heading">
        <div>
          <h3 className="section-title">
            {t('ui.public_projects.pufu_for_this_question_or_insight')}
          </h3>
          <p>{t('ui.public_projects.view_ideas_organized_by_task')}</p>
        </div>
        <span className="result-count">
          {t('count.items', { count: data.question.pufu_count })}
        </span>
      </div>
      {data.pufus.length ? (
        <div className="pufu-list">
          {data.pufus.map((pufu) => (
            <a
              className="pufu-list-item"
              key={pufu.id}
              href={publicLink(`#pufu/${encodeURIComponent(pufu.id)}`)}
            >
              <span>
                <strong>{pufuDisplayTitle(pufu)}</strong>
                <small>
                  {t('phase.number', { number: pufu.current_phase })}
                  {t('ui.public_projects.read_only')}
                </small>
              </span>
            </a>
          ))}
        </div>
      ) : (
        <div className="pufu-empty">
          <p>{t('ui.public_projects.no_pufu_for_this_question_or_insight_yet')}</p>
        </div>
      )}
      <Pagination page={page} hasMore={data.has_more} onChange={setPage} />
      {(data.stocks ?? (data.stock ? [data.stock] : [])).map((stock) => (
        <div key={stock.id}>
          <h3 className="public-detail-title">{t('ui.app.source_articles')}</h3>
          <StockDetails stock={stock} heading="h4" />
          <a
            className="text-link public-detail-link"
            href={publicLink(`#stock/${encodeURIComponent(stock.id)}`)}
          >
            {t('ui.public_projects.view_stock_details_2')}
            <ArrowRight size={16} aria-hidden="true" />
          </a>
        </div>
      ))}
    </section>
  );
}
function PublicPufuDetail({ root, id, fromList }: { root: string; id: string; fromList: boolean }) {
  useLanguage();
  const [selectedPhase, setSelectedPhase] = useState<number | undefined>(() => {
    const value = new URLSearchParams(window.location.search ?? '').get('phase');
    return value && /^[1-9]\d*$/.test(value) ? Number(value) : undefined;
  });
  const { data, error, reload } = useResource<{
    pufu: PublicPufu;
  }>(
    `${root}/pufus/${encodeURIComponent(id)}${selectedPhase === undefined ? '' : `?phase=${selectedPhase}`}`,
  );
  const phase = data ? (data.pufu.phase ?? data.pufu.current_phase) : 1;
  return !data ? (
    <ResourceState error={error} retry={reload} />
  ) : (
    <section>
      <a
        className="text-link"
        href={publicLink(
          fromList
            ? '#pufus'
            : data.pufu.question_id
              ? `#question/${encodeURIComponent(data.pufu.question_id)}`
              : '#questions',
        )}
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {fromList
          ? t('ui.app.back_to_pufu_list')
          : data.pufu.question_id
            ? t('ui.public_projects.back_to_question_or_insight')
            : t('ui.public_projects.back_to_questions_insights')}
      </a>
      <h2 className="public-detail-title">{data.pufu.title || t('ui.app.pufu')}</h2>
      <div className="pufu-context public-pufu-context">
        <section aria-label={t('ui.public_projects.task')}>
          <h3 className="question-origin pufu-context-label">{t('ui.public_projects.task')}</h3>
          <ul className="pufu-context-questions">
            <li>{data.pufu.task}</li>
          </ul>
        </section>
        {(data.pufu.questions?.length || data.pufu.question_id) && (
          <details className="pufu-related pufu-related-questions">
            <summary>{t('ui.public_projects.related_questions_insights')}</summary>
            <ul className="pufu-context-questions">
              {(
                data.pufu.questions ??
                (data.pufu.question_id
                  ? [{ id: data.pufu.question_id, text: data.pufu.question_text }]
                  : [])
              ).map((question) => (
                <li key={question.id}>
                  <a
                    className="text-link"
                    href={publicLink(`#question/${encodeURIComponent(question.id)}`)}
                  >
                    {question.text}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}
        {Boolean(data.pufu.stocks?.length) && (
          <details className="pufu-related pufu-related-stocks">
            <summary>{t('ui.public_projects.related_stocks')}</summary>
            <ul className="pufu-context-questions">
              {data.pufu.stocks?.map((stock) => (
                <li key={stock.id}>
                  <a
                    className="text-link"
                    href={publicLink(`#stock/${encodeURIComponent(stock.id)}`)}
                  >
                    {stock.title}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <p className="public-badge">
        {t('phase.number', { number: phase })} ·{' '}
        {phase % 2 === 0 ? t('ui.public_projects.reflection') : t('ui.app.pufu')}
        {t('ui.public_projects.read_only')}
      </p>
      <div className="pufu-toolbar">
        <div
          className="pufu-phase-navigation"
          role="group"
          aria-label={t('ui.pufu_editor.switch_phase')}
        >
          {phase > 1 && (
            <button
              className="icon-button pufu-phase-previous"
              aria-label={t('ui.pufu_editor.previous_phase')}
              onClick={() => setSelectedPhase(phase - 1)}
            >
              <Triangle size={12} fill="currentColor" strokeWidth={0} aria-hidden="true" />
            </button>
          )}
          <span className="pufu-phase-number" aria-live="polite">
            {t('phase.number', { number: phase })}
          </span>
          {phase < data.pufu.current_phase && (
            <button
              className="icon-button pufu-phase-next"
              aria-label={t('ui.pufu_editor.next_phase')}
              onClick={() => setSelectedPhase(phase + 1)}
            >
              <Triangle size={12} fill="currentColor" strokeWidth={0} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <Suspense fallback={<ResourceState retry={reload} />}>
        <PublicPufuScore key={`${id}-${phase}`} score={data.pufu.score} phase={phase} />
      </Suspense>
    </section>
  );
}
export default function PublicProjectPage({ publicId }: { publicId: string }) {
  const { language } = useLanguage();
  const root = `/api/public/projects/${encodeURIComponent(publicId)}`;
  const { data, error, reload } = useResource<{
    project: PublicProjectDetail;
  }>(root);
  const [hash, setHash] = useState(
    publicHash(window.location.pathname ?? '', window.location.search ?? '', window.location.hash),
  );
  const [stockPage, setStockPage] = useState(initialPublicPage);
  const [questionPage, setQuestionPage] = useState(initialPublicPage);
  const [pufuPage, setPufuPage] = useState(initialPublicPage);
  useEffect(() => {
    const listener = () => {
      setHash(
        publicHash(
          window.location.pathname ?? '',
          window.location.search ?? '',
          window.location.hash,
        ),
      );
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', listener);
    return () => window.removeEventListener('hashchange', listener);
  }, []);
  const match = /^#(stock|question|pufu)\/([^/?]+)(?:\?from=(pufus))?$/.exec(hash);
  let content: ReactNode;
  if (match)
    content =
      match[1] === 'stock' ? (
        <PublicStockDetailPage key={match[2]} root={root} id={match[2]} />
      ) : match[1] === 'pufu' ? (
        <PublicPufuDetail
          key={`${root}-${match[2]}`}
          root={root}
          id={match[2]}
          fromList={match[3] === 'pufus'}
        />
      ) : (
        <PublicQuestionDetail
          key={match[2]}
          root={root}
          id={match[2]}
          projectName={data?.project.name ?? ''}
        />
      );
  else
    content =
      hash === '#pufus' ? (
        <PublicPufuList root={root} page={pufuPage} onPageChange={setPufuPage} />
      ) : hash === '#questions' ? (
        <PublicQuestionList root={root} page={questionPage} onPageChange={setQuestionPage} />
      ) : (
        <PublicStockList root={root} page={stockPage} onPageChange={setStockPage} />
      );
  return (
    <div className="public-page">
      <header className="public-header">
        <PublicBrand />
        <a className="text-link" href="/">
          {t('ui.public_projects.home')}
          <ArrowRight size={16} aria-hidden="true" />
        </a>
      </header>
      <main className="public-main">
        {!data ? (
          <ResourceState error={error} retry={reload} />
        ) : (
          <>
            <span className="public-badge">
              <Globe size={14} aria-hidden="true" />
              {t('ui.public_projects.public')}
            </span>
            <h1>{data.project.name}</h1>
            {data.project.public_description && (
              <p className="public-lead">{data.project.public_description}</p>
            )}
            <nav className="public-tabs" aria-label={t('ui.public_projects.public_projects')}>
              <a
                href={publicLink('#stocks')}
                aria-current={
                  match?.[1] === 'stock' || (!match && !['#questions', '#pufus'].includes(hash))
                    ? 'page'
                    : undefined
                }
              >
                <Layers size={18} aria-hidden="true" />
                {t('ui.app.stocks')}
                <span>{data.project.stock_count}</span>
              </a>
              <a
                href={publicLink('#questions')}
                aria-current={
                  hash === '#questions' || match?.[1] === 'question' ? 'page' : undefined
                }
              >
                <CircleHelp size={18} aria-hidden="true" />
                {t('ui.app.questions_insights')}
                <span>{data.project.question_count}</span>
              </a>
              <a
                href={publicLink('#pufus')}
                aria-current={hash === '#pufus' || match?.[1] === 'pufu' ? 'page' : undefined}
              >
                <Network size={18} aria-hidden="true" />
                {t('ui.app.pufu')}
                <span>{data.project.pufu_count}</span>
              </a>
            </nav>
            {(hash === '#pufus' || match?.[1] === 'pufu') && (
              <p className="public-help public-pufu-help">
                {t('ui.public_projects.pufu_help')}{' '}
                <a className="text-link" href={`${manualHref(language)}#pufu`}>
                  {t('ui.public_projects.learn_more_about_pufu')}
                </a>
              </p>
            )}
            {content}
          </>
        )}
      </main>
      <footer className="public-footer">
        {t('ui.public_projects.pufu_lens_connect_knowledge_into_memory')}
      </footer>
    </div>
  );
}
