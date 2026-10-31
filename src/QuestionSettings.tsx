import { applicationError, t, useLanguage } from './i18n';
import { useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { Project, QuestionDetail } from '../shared/domain';
import RelationPicker, { type RelationOption } from './RelationPicker';
export default function QuestionSettings({
  question,
  projects,
  disabled,
  onSave,
}: {
  question: QuestionDetail;
  projects: Pick<Project, 'id' | 'name'>[];
  disabled: boolean;
  onSave: (input: { note: string; project_id: string; stock_ids: string[] }) => Promise<void>;
}) {
  useLanguage();
  const [noteDraft, setNote] = useState<string>();
  const [projectDraft, setProjectId] = useState<string>();
  const [stocksDraft, setStocks] = useState<RelationOption[]>();
  const stocks =
    stocksDraft ??
    (question.stocks
      ? question.stocks.map((stock) => ({ id: stock.id, label: stock.title }))
      : question.stock_id
        ? [
            {
              id: question.stock_id,
              label: question.article_title ?? t('ui.public_projects.related_stocks'),
            },
          ]
        : []);
  const note = noteDraft ?? question.note;
  const projectId = projectDraft ?? question.project_id;
  const savedStockCount = question.stocks?.length ?? (question.stock_id ? 1 : 0);
  const projectLocked =
    savedStockCount > 0 ||
    stocks.length > 0 ||
    (question.source === 'ai' && Boolean(question.stock_id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || disabled) return;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await onSave({ note, project_id: projectId, stock_ids: stocks.map((stock) => stock.id) });
      setNote(undefined);
      setProjectId(undefined);
      setStocks(undefined);
      setSaved(true);
    } catch (e) {
      setError(applicationError((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="question-settings" onSubmit={save}>
      <label htmlFor="question-note">{t('ui.app.note_2')}</label>
      <p className="field-hint" id="question-note-help">
        {t('ui.question_settings.leave_a_note_about_why_it_caught_your_attention')}
      </p>
      <textarea
        id="question-note"
        aria-describedby="question-note-help"
        value={note}
        onInput={(event) => {
          setNote(event.currentTarget.value);
          setSaved(false);
        }}
        rows={5}
        maxLength={2000}
        disabled={busy || disabled}
        placeholder={t('ui.question_settings.what_you_noticed_or_want_to_try_next')}
      />
      <label htmlFor="question-project">{t('ui.app.destination_project')}</label>
      <select
        id="question-project"
        value={projectId}
        disabled={busy || disabled || projectLocked}
        aria-describedby={projectLocked ? 'question-project-help' : undefined}
        onChange={(event) => {
          setProjectId(event.target.value);
          setSaved(false);
        }}
      >
        {!projects.some((project) => project.id === question.project_id) && (
          <option value={question.project_id}>{question.project_name}</option>
        )}
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
      {projectLocked && (
        <p className="field-hint" id="question-project-help">
          {question.source === 'ai' && question.stock_id
            ? t('ui.question_settings.ai_generated_questions_belong_to_the_same_project_as')
            : t('ui.question_settings.the_destination_matches_the_related_stocks_change_it_from')}
        </p>
      )}
      <RelationPicker
        key={projectId}
        kind="stocks"
        projectId={projectId}
        value={stocks}
        disabled={busy || disabled}
        onChange={(value) => {
          setStocks(value);
          setSaved(false);
        }}
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="field-hint" role="status">
          {t('ui.question_settings.note_destination_and_relations_saved')}
        </p>
      )}
      <div className="form-actions">
        <button className="button primary" disabled={busy || disabled}>
          {busy && <LoaderCircle className="spin" size={18} aria-hidden="true" />}
          {busy ? t('ui.app.saving') : t('ui.app.save_changes')}
        </button>
      </div>
    </form>
  );
}
