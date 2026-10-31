import { applicationError, t, useLanguage } from './i18n';
import { useRef, useState, type FormEvent } from 'react';
import { LoaderCircle, Plus } from 'lucide-react';
import type { Project } from '../shared/domain';
import { createPufuSchema } from '../shared/pufu';
import { createRequestId, send } from './api';
export default function PufuForm({
  projects,
  projectId,
  questionId,
  disabled = false,
  onBusyChange,
  onDone,
}: {
  projects: Pick<Project, 'id' | 'name'>[];
  projectId: string | null;
  questionId?: string;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onDone: (id: string) => void;
}) {
  useLanguage();
  const [project, setProject] = useState(projectId ?? projects[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [task, setTask] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<{
    input: string;
    id: string;
  } | null>(null);
  async function generate(event: FormEvent) {
    event.preventDefault();
    if (busy || disabled) return;
    const text = task.trim();
    const extra = details.trim();
    const key = JSON.stringify([project, questionId, title.trim(), text, extra]);
    if (request.current?.input !== key) request.current = { input: key, id: createRequestId() };
    const input = createPufuSchema.safeParse({
      title: title.trim(),
      task: text,
      details: extra,
      request_id: request.current.id,
    });
    if (!input.success) {
      setError(applicationError(input.error.issues[0].message));
      return;
    }
    if (!project) {
      setError(t('ui.pufu_form.select_a_project'));
      return;
    }
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    try {
      const result = await send<{
        id: string;
      }>(
        questionId
          ? `/api/v1/questions/${encodeURIComponent(questionId)}/pufus`
          : `/api/v1/projects/${encodeURIComponent(project)}/pufus/generate`,
        input.data,
      );
      onDone(result.id);
    } catch (e) {
      setError(applicationError((e as Error).message));
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  return (
    <form className={questionId ? 'pufu-task-form' : undefined} onSubmit={generate}>
      {!questionId && (
        <>
          <p className="form-intro">
            {t('ui.pufu_form.create_a_pufu_to_work_toward_the_state_you')}
          </p>
          <label htmlFor="pufu-project">{t('ui.app.projects')}</label>
          <select
            id="pufu-project"
            value={project}
            onChange={(event) => setProject(event.target.value)}
            disabled={busy || !projects.length}
            required
          >
            {!project && <option value="">{t('ui.app.select_a_project')}</option>}
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </>
      )}
      <label htmlFor="pufu-title">
        {t('ui.app.title_2')}
        <span className="optional">{t('ui.app.optional')}</span>
      </label>
      <input
        id="pufu-title"
        value={title}
        onInput={(event) => setTitle(event.currentTarget.value)}
        maxLength={200}
        disabled={busy}
        aria-describedby="pufu-title-help"
      />
      <p className="field-hint" id="pufu-title-help">
        {t('pufu.title_hint')}
      </p>
      <label htmlFor="pufu-task">
        {questionId
          ? t('ui.pufu_form.task_inspired_by_this_question_or_insight')
          : t('ui.public_projects.task')}
        <span className="task-caption">{t('ui.public_pufu_score.gaining_goal')}</span>
      </label>
      <p className="field-hint" id="pufu-task-help">
        {t('ui.pufu_form.what_state_do_you_want_to_achieve_your_text')}
      </p>
      <textarea
        id="pufu-task"
        aria-describedby="pufu-task-help"
        value={task}
        onInput={(event) => setTask(event.currentTarget.value)}
        rows={5}
        maxLength={1000}
        required
        disabled={busy}
        placeholder={t(
          'ui.pufu_form.example_build_a_system_that_reliably_completes_summaries_even',
        )}
      />
      <label htmlFor="pufu-details">
        {t('ui.pufu_form.eight_planning_factors_planned_measures')}
        <span className="optional">{t('ui.app.optional')}</span>
      </label>
      <p className="field-hint" id="pufu-details-help">
        {t('ui.pufu_form.describe_people_money_time_quality_business_scheme_environment_rivals')}
      </p>
      <textarea
        id="pufu-details"
        aria-describedby="pufu-details-help"
        value={details}
        onInput={(event) => setDetails(event.currentTarget.value)}
        rows={6}
        maxLength={4000}
        disabled={busy}
        placeholder={t('ui.pufu_form.example_two_people_a_budget_of_200_per_month')}
      />
      <p className="field-hint">
        {questionId ? t('ui.pufu_form.questions_insights_related_stocks') : ''}
        {t('ui.pufu_form.the_project_description_and_your_and_the_project_s')}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button className="button primary" disabled={busy || disabled || !project || !task.trim()}>
          {busy ? (
            <LoaderCircle className="spin" size={18} aria-hidden="true" />
          ) : (
            <Plus size={18} aria-hidden="true" />
          )}
          {busy ? t('ui.pufu_form.submitting_creation_request') : t('ui.app.create_pufu')}
        </button>
      </div>
    </form>
  );
}
