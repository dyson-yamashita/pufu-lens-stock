import { footprintIntervals, type FootprintInterval } from '../../../shared/footprints';
import { Check, Copy } from 'lucide-react';
import { useId, useState } from 'react';
import type { Project } from '../../../shared/domain';
import { reflectionPeriods, type ReflectionPeriod } from '../../../shared/reflections';
import DeleteAction from '../../components/DeleteAction';
import { FormError } from '../../components/FormError';
import { Spinner } from '../../components/Spinner';
import { applicationError, t, useLanguage } from '../../i18n/i18n';
import { api, send } from '../../lib/api';
import { ProjectPublicationSettings } from '../public-projects';

export type ProjectSettings = Pick<
  Project,
  | 'name'
  | 'description'
  | 'show_in_all_lists'
  | 'include_in_user_memory'
  | 'auto_generate_questions'
  | 'reflection_period'
  | 'footprints_enabled'
  | 'footprint_interval'
>;

export function ProjectForm({
  project,
  onDone,
  onDelete,
}: {
  project?: Project;
  onDone: (id: string, settings: ProjectSettings) => void;
  onDelete: () => void;
}) {
  useLanguage();
  const [name, setName] = useState(project?.name ?? '');
  const nameId = useId();
  const [description, setDescription] = useState(project?.description ?? '');
  const descriptionId = useId();
  const [showInAllLists, setShowInAllLists] = useState(project?.show_in_all_lists ?? true);
  const listVisibilityId = useId();
  const [includeInUserMemory, setIncludeInUserMemory] = useState(
    project?.include_in_user_memory ?? true,
  );
  const userMemoryId = useId();
  const [autoGenerateQuestions, setAutoGenerateQuestions] = useState(
    project?.auto_generate_questions ?? true,
  );
  const autoQuestionsId = useId();
  const [reflectionPeriod, setReflectionPeriod] = useState<ReflectionPeriod>(
    project?.reflection_period ?? 'weekly',
  );
  const reflectionPeriodId = useId();
  const [footprintsEnabled, setFootprintsEnabled] = useState(project?.footprints_enabled ?? true);
  const [footprintInterval, setFootprintInterval] = useState<FootprintInterval>(
    project?.footprint_interval ?? 3,
  );
  const footprintsEnabledId = useId();
  const footprintIntervalId = useId();
  const [backfill, setBackfill] = useState<'idle' | 'busy' | 'accepted' | 'error'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [idCopied, setIdCopied] = useState(false);
  const [idCopyError, setIdCopyError] = useState('');
  return (
    <>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            const settings: ProjectSettings = {
              name: name.trim(),
              description: description.trim(),
              show_in_all_lists: showInAllLists,
              include_in_user_memory: includeInUserMemory,
              auto_generate_questions: autoGenerateQuestions,
              reflection_period: reflectionPeriod,
              footprints_enabled: footprintsEnabled,
              footprint_interval: footprintInterval,
            };
            const data = await send<{ id: string }>(
              project ? `/api/v1/projects/${project.id}` : '/api/v1/projects',
              settings,
              project ? 'PATCH' : 'POST',
            );
            onDone(project?.id ?? data.id, settings);
          } catch (e) {
            setError(applicationError((e as Error).message));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="form-intro">
          {project
            ? t('ui.app.change_the_project_s_name_and_description_these_are')
            : t('first_steps.project_examples')}
        </p>
        {project && (
          <>
            <dl className="project-id">
              <dt>{t('ui.app.project_id')}</dt>
              <dd className="project-id-row">
                <span className="project-id-value">{project.id}</span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t('ui.app.copy_project_id')}
                  title={t('ui.app.copy_project_id')}
                  onClick={async () => {
                    setIdCopied(false);
                    setIdCopyError('');
                    try {
                      await navigator.clipboard.writeText(project.id);
                      setIdCopied(true);
                    } catch {
                      setIdCopyError(t('ui.app.could_not_copy_select_and_copy_the_project_id'));
                    }
                  }}
                >
                  <Copy size={16} aria-hidden="true" />
                </button>
              </dd>
            </dl>
            <p className="guide-note" role="status">
              {idCopied && t('ui.app.project_id_copied')}
            </p>
            <FormError error={idCopyError} />
          </>
        )}
        <label htmlFor={nameId}>{t('ui.app.project_name')}</label>
        <input
          id={nameId}
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={80}
          autoFocus={!project}
          placeholder={t('ui.app.example_building_the_next_app')}
        />
        <label htmlFor={descriptionId}>
          {t('ui.app.project_description')}
          <span className="optional">{t('ui.app.optional')}</span>
        </label>
        <textarea
          id={descriptionId}
          value={description}
          disabled={busy}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={1000}
          rows={8}
          placeholder={t('ui.app.try_writing_about_what_you_want_to_achieve_and')}
        />
        <details className="project-advanced">
          <summary>{t('ui.app.advanced_settings')}</summary>
          <label className="project-memory-toggle" htmlFor={listVisibilityId}>
            <span>{t('ui.app.include_in_all_stocks_questions_insights_and_pufu_lists')}</span>
            <input
              id={listVisibilityId}
              type="checkbox"
              role="switch"
              checked={showInAllLists}
              disabled={busy}
              onChange={(event) => setShowInAllLists(event.target.checked)}
              aria-describedby={`${listVisibilityId}-hint`}
            />
          </label>
          <p id={`${listVisibilityId}-hint`} className="project-memory-hint">
            {t('ui.app.when_off_this_project_s_stocks_questions_insights_and')}
          </p>
          <label className="project-memory-toggle" htmlFor={userMemoryId}>
            <span>{t('ui.app.update_your_memory_when_adding_stocks')}</span>
            <input
              id={userMemoryId}
              type="checkbox"
              role="switch"
              checked={includeInUserMemory}
              disabled={busy}
              onChange={(event) => setIncludeInUserMemory(event.target.checked)}
              aria-describedby={`${userMemoryId}-hint`}
            />
          </label>
          <p id={`${userMemoryId}-hint`} className="project-memory-hint">
            {t('ui.app.project_memory_still_updates_when_off_articles_in_this')}
            {project && t('ui.app.saving_also_applies_changes_to_existing_memory')}
          </p>
          <label className="project-memory-toggle" htmlFor={autoQuestionsId}>
            <span>{t('ui.app.automatically_generate_questions_and_insights_from_stocks')}</span>
            <input
              id={autoQuestionsId}
              type="checkbox"
              role="switch"
              checked={autoGenerateQuestions}
              disabled={busy}
              onChange={(event) => setAutoGenerateQuestions(event.target.checked)}
              aria-describedby={`${autoQuestionsId}-hint`}
            />
          </label>
          <p id={`${autoQuestionsId}-hint`} className="project-memory-hint">
            {t('ui.app.when_off_no_questions_or_insights_are_automatically_generated')}
          </p>
          <label htmlFor={reflectionPeriodId}>{t('reflection.schedule')}</label>
          <select
            id={reflectionPeriodId}
            value={reflectionPeriod}
            disabled={busy || !autoGenerateQuestions}
            onChange={(event) => setReflectionPeriod(event.target.value as ReflectionPeriod)}
            aria-describedby={`${reflectionPeriodId}-hint`}
          >
            {reflectionPeriods.map((period) => (
              <option key={period} value={period}>
                {t(`reflection.period.${period}`)}
              </option>
            ))}
          </select>
          <p id={`${reflectionPeriodId}-hint`} className="project-memory-hint">
            {t('reflection.schedule_hint')}
          </p>
          <label className="project-memory-toggle" htmlFor={footprintsEnabledId}>
            <span>{t('footprints.auto_add')}</span>
            <input
              id={footprintsEnabledId}
              type="checkbox"
              role="switch"
              checked={footprintsEnabled}
              disabled={busy}
              onChange={(event) => setFootprintsEnabled(event.target.checked)}
            />
          </label>
          <label htmlFor={footprintIntervalId}>{t('footprints.interval')}</label>
          <select
            id={footprintIntervalId}
            value={footprintInterval}
            disabled={busy}
            onChange={(event) => {
              const value = footprintIntervals.find(
                (interval) => String(interval) === event.target.value,
              );
              if (value) setFootprintInterval(value);
            }}
          >
            {footprintIntervals.map((interval) => (
              <option key={interval} value={interval}>
                {t('footprints.interval_option', { count: interval })}
              </option>
            ))}
          </select>
          {project && (
            <>
              <p className="project-memory-hint">{t('footprints.backfill_hint')}</p>
              <button
                type="button"
                className="button secondary"
                disabled={busy || backfill === 'busy' || backfill === 'accepted'}
                onClick={async () => {
                  setBackfill('busy');
                  try {
                    await send(
                      `/api/v1/projects/${encodeURIComponent(project.id)}/footprints/backfill`,
                      {},
                      'POST',
                    );
                    setBackfill('accepted');
                  } catch {
                    setBackfill('error');
                  }
                }}
              >
                {t('footprints.backfill')}
              </button>
              <p role="status" className="project-memory-hint">
                {backfill === 'accepted' && t('footprints.backfill_accepted')}
                {backfill === 'error' && t('footprints.backfill_failed')}
              </p>
            </>
          )}
        </details>
        <FormError error={error} />
        <div className="form-actions">
          <button className="button primary" disabled={busy}>
            {busy ? <Spinner /> : <Check size={17} aria-hidden="true" />}
            {project ? t('ui.app.save') : t('ui.app.create_project')}
          </button>
        </div>
      </form>
      {project && (
        <>
          <ProjectPublicationSettings key={project.id} projectId={project.id} />
          <DeleteAction
            summary={t('ui.app.project_deletion')}
            label={t('ui.app.delete_project')}
            title={t('ui.app.delete_this_project')}
            disabled={busy}
            onDelete={async () => {
              await api(`/api/v1/projects/${project.id}`, { method: 'DELETE' });
              onDelete();
            }}
          >
            <p className="delete-target">{project.name}</p>
            <p>{t('ui.app.delete_this_project_s_stocks_questions_insights_pufu_all')}</p>
            <p>{t('ui.app.if_published_its_public_page_will_also_become_unavailable')}</p>
          </DeleteAction>
        </>
      )}
    </>
  );
}
