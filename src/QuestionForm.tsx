import { applicationError, t, useLanguage } from './i18n';
import { useRef, useState, type FormEvent } from 'react';
import { CircleHelp, LoaderCircle } from 'lucide-react';
import { userQuestionSchema, type Project, type Question } from '../shared/domain';
import { createRequestId, send } from './api';
import RelationPicker, { type RelationOption } from './RelationPicker';
export default function QuestionForm({
  projects,
  projectId,
  onDone,
}: {
  projects: Project[];
  projectId: string | null;
  onDone: (projectId: string) => void;
}) {
  useLanguage();
  const [project, setProject] = useState(projectId ?? projects[0]?.id ?? '');
  const [stocks, setStocks] = useState<RelationOption[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = useRef(createRequestId());
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const result = userQuestionSchema.safeParse({
      project_id: project,
      stock_ids: stocks.map((stock) => stock.id),
      text,
      request_id: key.current,
    });
    if (!result.success) {
      setError(applicationError(result.error.issues[0].message));
      document
        .getElementById(
          result.error.issues[0].path[0] === 'project_id' ? 'question-project' : 'question-text',
        )
        ?.focus();
      return;
    }
    setBusy(true);
    try {
      const saved = await send<{
        question: Question;
      }>('/api/v1/questions', result.data);
      onDone(saved.question.project_id);
    } catch (e) {
      setError(applicationError((e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit}>
      <p className="form-intro">
        {t('ui.question_form.save_your_own_question_or_insight_in_a_project')}
      </p>
      <label htmlFor="question-project">{t('ui.app.projects')}</label>
      <select
        id="question-project"
        value={project}
        disabled={busy || !projects.length}
        onChange={(event) => {
          setProject(event.target.value);
          setStocks([]);
          key.current = createRequestId();
        }}
      >
        {!project && (
          <option value="">
            {projects.length
              ? t('ui.app.select_a_project')
              : t('ui.question_form.no_projects_available')}
          </option>
        )}
        {projects.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <RelationPicker
        key={project}
        kind="stocks"
        projectId={project}
        value={stocks}
        disabled={busy}
        onChange={(value) => {
          setStocks(value);
          key.current = createRequestId();
        }}
      />
      <label htmlFor="question-text">{t('ui.app.questions_insights')}</label>
      <textarea
        id="question-text"
        value={text}
        disabled={busy}
        required
        rows={4}
        maxLength={500}
        placeholder={t('ui.question_form.something_to_explore_verify_or_reflect_on')}
        aria-describedby="question-text-hint"
        onInput={(event) => {
          setText(event.currentTarget.value);
          setError('');
          key.current = createRequestId();
        }}
      />
      <p id="question-text-hint" className="profile-hint profile-bio-hint">
        <span>{t('ui.question_form.up_to_500_characters')}</span>
        <span>{text.length} / 500</span>
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button className="button primary" disabled={busy || !project}>
          {busy ? (
            <LoaderCircle className="spin" size={17} aria-hidden="true" />
          ) : (
            <CircleHelp size={17} aria-hidden="true" />
          )}
          {busy ? t('ui.app.saving') : t('ui.app.add_question_or_insight')}
        </button>
      </div>
    </form>
  );
}
