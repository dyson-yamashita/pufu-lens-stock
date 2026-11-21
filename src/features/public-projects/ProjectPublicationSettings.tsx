import { Check, Copy, ExternalLink, Globe, LockKeyhole } from 'lucide-react';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import type {
  Publication,
  PublicViewStats,
  PublicViewTotals,
} from '../../../shared/public-project';
import { applicationError, t, useLanguage } from '../../i18n/i18n';
import { send } from '../../lib/api';
import { PublicViewCount } from './PublicViewCount';
import { ResourceState } from './ResourceState';
import { useResource } from './useResource';

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
      {saved.is_public && url && saved.view_stats && (
        <PublicationViews url={url} stats={saved.view_stats} />
      )}
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

const viewLabels = {
  project: 'ui.public_projects.project_page',
  stocks: 'ui.public_projects.stock_details',
  questions: 'ui.public_projects.question_or_insight_details',
  pufus: 'ui.public_projects.pufu_details',
} as const satisfies Record<keyof PublicViewTotals, string>;

function PublicationViews({ url, stats }: { url: string; stats: PublicViewStats }) {
  const id = useId();
  const kinds = ['project', 'stocks', 'questions', 'pufus'] as const;
  return (
    <section className="publication-views" aria-labelledby={id}>
      <h3 id={id}>{t('ui.public_projects.public_views')}</h3>
      <p className="public-help">{t('ui.public_projects.public_views_help')}</p>
      <dl>
        {kinds.map((kind) => (
          <div key={kind}>
            <dt>{t(viewLabels[kind])}</dt>
            <dd>
              <PublicViewCount count={stats.totals[kind]} />
            </dd>
          </div>
        ))}
      </dl>
      <h4>{t('ui.public_projects.top_details')}</h4>
      {stats.top.length > 0 ? (
        <ol>
          {stats.top.map((item) => (
            <li key={`${item.kind}/${item.id}`}>
              <div className="public-count-row">
                <div>
                  <span className="public-help">{t(viewLabels[item.kind])}</span>
                  <a
                    className="text-link"
                    href={`${url}/${item.kind}/${encodeURIComponent(item.id)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {item.title || t('ui.app.text')}
                  </a>
                </div>
                <PublicViewCount count={item.views} />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="public-help">{t('ui.public_projects.no_ranked_details')}</p>
      )}
    </section>
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
