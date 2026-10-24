import { useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { Project, QuestionDetail } from '../shared/domain';

export default function QuestionSettings({
  question,
  projects,
  disabled,
  onSave,
}: {
  question: QuestionDetail;
  projects: Pick<Project, 'id' | 'name'>[];
  disabled: boolean;
  onSave: (input: { note: string; project_id: string }) => Promise<void>;
}) {
  const [noteDraft, setNote] = useState<string>();
  const [projectDraft, setProjectId] = useState<string>();
  const note = noteDraft ?? question.note;
  const projectId = projectDraft ?? question.project_id;
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
      await onSave({ note, project_id: question.stock_id ? question.project_id : projectId });
      setNote(undefined);
      setProjectId(undefined);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="question-settings" onSubmit={save}>
      <label htmlFor="question-note">メモ</label>
      <p className="field-hint" id="question-note-help">
        気になった理由や、あとで考えたいことを残せます。公開ページやAIのメモリには含まれません。
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
        placeholder="気づいたこと、次に試したいことなど"
      />
      <label htmlFor="question-project">保存先プロジェクト</label>
      <select
        id="question-project"
        value={question.stock_id ? question.project_id : projectId}
        disabled={busy || disabled || Boolean(question.stock_id)}
        aria-describedby={question.stock_id ? 'question-project-help' : undefined}
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
      {question.stock_id && (
        <p className="field-hint" id="question-project-help">
          保存先は元の記事と同じです。変更するときは、本文タブから元の記事を開いてください。
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="field-hint" role="status">
          メモと保存先を保存しました。
        </p>
      )}
      <div className="form-actions">
        <button className="button primary" disabled={busy || disabled}>
          {busy && <LoaderCircle className="spin" size={18} aria-hidden="true" />}
          {busy ? '保存中…' : '変更を保存'}
        </button>
      </div>
    </form>
  );
}
