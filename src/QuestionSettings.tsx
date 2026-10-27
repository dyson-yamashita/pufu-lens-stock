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
  const [noteDraft, setNote] = useState<string>();
  const [projectDraft, setProjectId] = useState<string>();
  const [stocksDraft, setStocks] = useState<RelationOption[]>();
  const stocks =
    stocksDraft ??
    (question.stocks
      ? question.stocks.map((stock) => ({ id: stock.id, label: stock.title }))
      : question.stock_id
        ? [{ id: question.stock_id, label: question.article_title ?? '関連するストック' }]
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
            ? 'AIが作成した問いの保存先は元の記事と同じです。変更するときは、元の記事を開いてください。'
            : '保存先は関連するストックと同じです。元の記事から変更するか、ストックの関連を解除して保存してください。'}
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
          メモ・保存先・関連を保存しました。
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
