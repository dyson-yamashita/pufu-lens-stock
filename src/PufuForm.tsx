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
  const [project, setProject] = useState(projectId ?? projects[0]?.id ?? '');
  const [task, setTask] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<{ input: string; id: string } | null>(null);
  async function generate(event: FormEvent) {
    event.preventDefault();
    if (busy || disabled) return;
    const text = task.trim();
    const extra = details.trim();
    const key = JSON.stringify([project, questionId, text, extra]);
    if (request.current?.input !== key) request.current = { input: key, id: createRequestId() };
    const input = createPufuSchema.safeParse({
      task: text,
      details: extra,
      request_id: request.current.id,
    });
    if (!input.success) {
      setError(input.error.issues[0].message);
      return;
    }
    if (!project) {
      setError('プロジェクトを選択してください。');
      return;
    }
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    try {
      const result = await send<{ id: string }>(
        questionId
          ? `/api/v1/questions/${encodeURIComponent(questionId)}/pufus`
          : `/api/v1/projects/${encodeURIComponent(project)}/pufus/generate`,
        input.data,
      );
      onDone(result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  return (
    <form className={questionId ? 'pufu-task-form' : undefined} onSubmit={generate}>
      {!questionId && (
        <>
          <p className="form-intro">実現したいことから、解決に向けたプ譜をつくります。</p>
          <label htmlFor="pufu-project">プロジェクト</label>
          <select
            id="pufu-project"
            value={project}
            onChange={(event) => setProject(event.target.value)}
            disabled={busy || !projects.length}
            required
          >
            {!project && <option value="">プロジェクトを選択してください</option>}
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </>
      )}
      <label htmlFor="pufu-task">
        {questionId ? '問い・気づきから考える課題' : '課題'}
        <span className="task-caption">獲得目標</span>
      </label>
      <p className="field-hint" id="pufu-task-help">
        どんな状態を実現したいですか？ 入力した内容を、そのままプ譜の獲得目標にします。
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
        placeholder="例：記事の取得が途中で失敗しても、要約まで確実に完了できる仕組みをつくる。"
      />
      <label htmlFor="pufu-details">
        廟算八要素・取り組む予定の施策<span className="optional">任意</span>
      </label>
      <p className="field-hint" id="pufu-details-help">
        人員・予算・時間・品質・ビジネススキーム・環境・競合・外敵の状況や、取り組む予定の施策を自由に書けます。入力した内容をプ譜の生成に使います（4,000文字まで）。
      </p>
      <textarea
        id="pufu-details"
        aria-describedby="pufu-details-help"
        value={details}
        onInput={(event) => setDetails(event.currentTarget.value)}
        rows={6}
        maxLength={4000}
        disabled={busy}
        placeholder={
          '例：担当は2名、予算は月3万円、来月末までに検証する。\nまず小規模な試験運用を行い、利用者へのヒアリングを予定している。'
        }
      />
      <p className="field-hint">
        {questionId ? '問い・気づき・関連するストック・' : ''}
        プロジェクトの説明・あなたとプロジェクトのメモリも参考に、勝利条件や施策を生成します。
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
          {busy ? '作成を受け付けています…' : 'プ譜を作成'}
        </button>
      </div>
    </form>
  );
}
