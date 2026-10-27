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
      setError(result.error.issues[0].message);
      document
        .getElementById(
          result.error.issues[0].path[0] === 'project_id' ? 'question-project' : 'question-text',
        )
        ?.focus();
      return;
    }
    setBusy(true);
    try {
      const saved = await send<{ question: Question }>('/api/v1/questions', result.data);
      onDone(saved.question.project_id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit}>
      <p className="form-intro">
        プロジェクトに自分の問い・気づきを保存します。関連するストックは任意で選べます。
      </p>
      <label htmlFor="question-project">プロジェクト</label>
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
            {projects.length ? 'プロジェクトを選択してください' : 'プロジェクトがありません'}
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
      <label htmlFor="question-text">問い・気づき</label>
      <textarea
        id="question-text"
        value={text}
        disabled={busy}
        required
        rows={4}
        maxLength={500}
        placeholder="考えたいこと、確かめたいこと、気づいたこと"
        aria-describedby="question-text-hint"
        onInput={(event) => {
          setText(event.currentTarget.value);
          setError('');
          key.current = createRequestId();
        }}
      />
      <p id="question-text-hint" className="profile-hint profile-bio-hint">
        <span>500文字まで。</span>
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
          {busy ? '保存中…' : '問い・気づきを追加'}
        </button>
      </div>
    </form>
  );
}
