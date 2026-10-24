import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Folder, LoaderCircle, Plus, Star } from 'lucide-react';
import type { Project, Question, QuestionDetail } from '../shared/domain';
import { createPufuSchema, type PufuSummary } from '../shared/pufu';
import { api, createRequestId, send } from './api';
import QuestionLabels from './QuestionLabels';
import Comments from './Comments';
import DeleteAction from './DeleteAction';
import QuestionSettings from './QuestionSettings';

const detailTabs = [
  ['body', '本文'],
  ['pufus', 'プ譜'],
  ['comments', 'コメント'],
  ['settings', 'メモ・保存先'],
] as const;

export default function QuestionPage({
  id,
  resolve,
  projects,
  backLabel = '問い・気づきの一覧に戻る',
  onBack,
  onResolve,
  onPufu,
  onStock,
  onDeleted,
  onUpdated,
}: {
  id: string;
  resolve: boolean;
  projects: Pick<Project, 'id' | 'name'>[];
  backLabel?: string;
  onBack: () => void;
  onResolve: () => void;
  onPufu: (id: string) => void;
  onStock: (id: string) => Promise<void>;
  onDeleted: () => void;
  onUpdated: () => void;
}) {
  const [question, setQuestion] = useState<QuestionDetail>();
  const [tab, setTab] = useState<(typeof detailTabs)[number][0]>('body');
  const tabsId = useId();
  const [pufus, setPufus] = useState<PufuSummary[]>([]);
  const [task, setTask] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const request = useRef<{ task: string; id: string } | null>(null);
  const detailsVersion = useRef(0);
  useEffect(() => {
    if (deleting) return;
    const controller = new AbortController();
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      const version = detailsVersion.current;
      try {
        const result = await api<{ question: QuestionDetail; pufus: PufuSummary[] }>(
          `/api/v1/questions/${encodeURIComponent(id)}`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted && version === detailsVersion.current && version % 2 === 0) {
          setQuestion(result.question);
          setPufus(result.pufus);
        }
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        inFlight = false;
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 5000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [id, deleting]);
  async function generate(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const text = task.trim();
    if (request.current?.task !== text) request.current = { task: text, id: createRequestId() };
    const input = createPufuSchema.safeParse({ task: text, request_id: request.current.id });
    if (!input.success) {
      setError(input.error.issues[0].message);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await send<{ id: string }>(
        `/api/v1/questions/${encodeURIComponent(id)}/pufus`,
        input.data,
      );
      onPufu(result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="question-detail-page"
      aria-label={resolve ? '課題からプ譜を作成' : '問い・気づきの詳細'}
    >
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        {resolve ? '問い・気づきの詳細に戻る' : backLabel}
      </button>
      <header className="page-header">
        <div>
          <h1>{resolve ? '課題からプ譜を作成' : '問い・気づきの詳細'}</h1>
          <p>
            {resolve
              ? '実現したいことを課題として書き、解決に向けたプ譜をつくります。'
              : '問い・気づきを見つめ直し、次の一歩へ。'}
          </p>
        </div>
      </header>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!question ? (
        !error && (
          <p className="content-loading">
            <LoaderCircle className="spin" size={20} aria-hidden="true" />
            問い・気づきを読み込んでいます…
          </p>
        )
      ) : (
        <>
          {!resolve && (
            <div
              className="detail-tabs question-detail-tabs"
              role="tablist"
              aria-label="問い・気づきの詳細"
              onKeyDown={(event) => {
                const index = detailTabs.findIndex(([key]) => key === tab);
                const next =
                  event.key === 'ArrowRight'
                    ? (index + 1) % detailTabs.length
                    : event.key === 'ArrowLeft'
                      ? (index + detailTabs.length - 1) % detailTabs.length
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? detailTabs.length - 1
                          : -1;
                if (next < 0) return;
                event.preventDefault();
                setTab(detailTabs[next][0]);
                const buttons =
                  event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                buttons[next]?.focus();
              }}
            >
              {detailTabs.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  id={`${tabsId}-tab-${key}`}
                  aria-controls={`${tabsId}-panel-${key}`}
                  aria-selected={tab === key}
                  tabIndex={tab === key ? 0 : -1}
                  className={tab === key ? 'active' : ''}
                  onClick={() => setTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div
            role={resolve ? undefined : 'tabpanel'}
            id={`${tabsId}-panel-body`}
            aria-labelledby={resolve ? undefined : `${tabsId}-tab-body`}
            tabIndex={resolve ? undefined : 0}
            hidden={!resolve && tab !== 'body'}
          >
            <article className="question-detail-card">
              <div className="question-detail-meta">
                <QuestionLabels question={question} />
                <span>
                  <Folder size={15} aria-hidden="true" />
                  {question.project_name}
                </span>
              </div>
              <h2>
                {question.text ||
                  (question.status === 'failed'
                    ? '問い・気づきを生成できませんでした。'
                    : '問い・気づきを生成しています…')}
              </h2>
              {question.stock_id && (
                <div className="question-detail-source">
                  <button
                    onClick={async () => {
                      try {
                        await onStock(question.stock_id!);
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    <BookOpen size={17} aria-hidden="true" />
                    <span>{question.article_title}</span>
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                </div>
              )}
              <div className="question-card-footer">
                <time dateTime={question.created_at}>
                  {new Intl.DateTimeFormat('ja-JP', {
                    dateStyle: 'medium',
                    timeZone: 'Asia/Tokyo',
                  }).format(new Date(question.created_at))}
                </time>
                <div className="question-card-actions">
                  <button
                    type="button"
                    className="question-favorite"
                    disabled={favoriteBusy || deleting || saving}
                    aria-label={question.is_favorite ? 'お気に入りを解除' : 'お気に入りに追加'}
                    aria-pressed={Boolean(question.is_favorite)}
                    onClick={async () => {
                      detailsVersion.current += 1;
                      setFavoriteBusy(true);
                      setError('');
                      try {
                        const result = await send<Pick<Question, 'is_favorite'>>(
                          `/api/v1/questions/${encodeURIComponent(id)}/favorite`,
                          { is_favorite: !question.is_favorite },
                          'PATCH',
                        );
                        setQuestion(
                          (current) => current && { ...current, is_favorite: result.is_favorite },
                        );
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        detailsVersion.current += 1;
                        setFavoriteBusy(false);
                      }
                    }}
                  >
                    {favoriteBusy ? (
                      <LoaderCircle className="spin" size={20} aria-hidden="true" />
                    ) : (
                      <Star size={20} strokeWidth={1.5} aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>
            </article>
          </div>
          {resolve ? (
            <form className="pufu-task-form" onSubmit={generate}>
              <label htmlFor="pufu-task">
                問い・気づきから考える課題<span className="task-caption">獲得目標</span>
              </label>
              <p className="field-hint" id="pufu-task-help">
                この問い・気づきから、どんな状態を実現したいですか？
                入力した内容を、そのままプ譜の獲得目標にします。
              </p>
              <textarea
                id="pufu-task"
                aria-describedby="pufu-task-help"
                value={task}
                onChange={(event) => setTask(event.target.value)}
                rows={5}
                maxLength={1000}
                required
                disabled={busy}
                placeholder="例：記事の取得が途中で失敗しても、要約まで確実に完了できる仕組みをつくる。"
              />
              <p className="field-hint">
                問い・気づき・プロジェクトの説明・あなたとプロジェクトのメモリを参考に、勝利条件や施策を生成します。関連するストックがあれば、その要約とメモも使います。
              </p>
              <div className="form-actions">
                <button
                  className="button primary"
                  disabled={busy || question.status !== 'ready' || !task.trim()}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={18} aria-hidden="true" />
                  ) : (
                    <Plus size={18} aria-hidden="true" />
                  )}
                  {busy ? '作成を受け付けています…' : 'プ譜を作成'}
                </button>
              </div>
            </form>
          ) : (
            <>
              <div
                role="tabpanel"
                id={`${tabsId}-panel-pufus`}
                aria-labelledby={`${tabsId}-tab-pufus`}
                tabIndex={0}
                hidden={tab !== 'pufus'}
              >
                <div className="section-head pufu-list-heading">
                  <div>
                    <h2>この問い・気づきのプ譜</h2>
                    <p>課題ごとに案をつくり、編集して育てられます。</p>
                  </div>
                  <span className="result-count">{pufus.length}件</span>
                </div>
                {pufus.length ? (
                  <div className="pufu-list">
                    {pufus.map((pufu) => (
                      <button
                        className="pufu-list-item"
                        key={pufu.id}
                        onClick={() => onPufu(pufu.id)}
                      >
                        <span>
                          <strong>{pufu.task}</strong>
                          <small>
                            {pufu.status === 'ready'
                              ? '編集できます'
                              : pufu.status === 'failed'
                                ? '生成に失敗しました'
                                : 'プ譜を生成しています…'}
                          </small>
                        </span>
                        <ArrowRight size={18} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="pufu-empty">
                    <p>この問い・気づきのプ譜はまだありません。</p>
                    <p>取り組みたい課題から、実行に向けた案をつくれます。</p>
                  </div>
                )}
                <div className="question-resolve-action">
                  <button
                    className="button primary"
                    onClick={onResolve}
                    disabled={deleting || question.status !== 'ready' || !question.text}
                  >
                    問い・気づきから考える
                    <ArrowRight size={18} aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div
                role="tabpanel"
                id={`${tabsId}-panel-comments`}
                aria-labelledby={`${tabsId}-tab-comments`}
                tabIndex={0}
                hidden={tab !== 'comments'}
              >
                <Comments targetType="question" targetId={id} />
              </div>
              <div
                role="tabpanel"
                id={`${tabsId}-panel-settings`}
                aria-labelledby={`${tabsId}-tab-settings`}
                tabIndex={0}
                hidden={tab !== 'settings'}
              >
                <QuestionSettings
                  question={question}
                  projects={projects}
                  disabled={favoriteBusy || deleting || saving}
                  onSave={async (input) => {
                    detailsVersion.current += 1;
                    setSaving(true);
                    try {
                      const result = await send<{ question: QuestionDetail }>(
                        `/api/v1/questions/${encodeURIComponent(id)}`,
                        input,
                        'PATCH',
                      );
                      setQuestion(result.question);
                      onUpdated();
                    } finally {
                      detailsVersion.current += 1;
                      setSaving(false);
                    }
                  }}
                />
              </div>
              <DeleteAction
                label="問い・気づきを削除"
                title="問い・気づきを削除しますか？"
                disabled={deleting || favoriteBusy || saving}
                onDelete={async () => {
                  setDeleting(true);
                  try {
                    await api(`/api/v1/questions/${encodeURIComponent(id)}`, { method: 'DELETE' });
                    onDeleted();
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                <p className="delete-target">
                  {question.text ||
                    (question.status === 'queued'
                      ? '生成待ちの問い・気づき'
                      : '生成中・生成に失敗した問い・気づき')}
                </p>
                <p>プロジェクト：{question.project_name}</p>
                <p>
                  この問い・気づきと、紐づくすべてのプ譜・局面・コメントを削除します。ストックは残ります。この操作は取り消せません。
                </p>
              </DeleteAction>
            </>
          )}
        </>
      )}
    </section>
  );
}
