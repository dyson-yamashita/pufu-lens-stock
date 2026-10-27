import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, LoaderCircle, RefreshCw } from 'lucide-react';
import type { Pufu } from '../shared/pufu';
import { api, send } from './api';
import PufuEditorLoadError, { clearPufuEditorLoadRetry } from './PufuEditorLoadError';
import PufuRelations from './PufuRelations';
import PufuFavoriteButton from './PufuFavoriteButton';

const PufuEditor = lazy(async () => {
  try {
    const editor = await import('./PufuEditor');
    clearPufuEditorLoadRetry();
    return editor;
  } catch {
    return { default: PufuEditorLoadError };
  }
});
export default function PufuPage({
  id,
  onQuestion,
  backLabel = 'プ譜の一覧に戻る',
  onBack,
  onGuard,
}: {
  id: string;
  onQuestion: (id: string) => void;
  backLabel?: string;
  onBack: () => void;
  onGuard: (guard: (() => boolean) | null) => void;
}) {
  const [pufu, setPufu] = useState<Pufu>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [editorBlocked, setEditorBlocked] = useState(false);
  const [relationsBusy, setRelationsBusy] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0);
  const questions =
    pufu?.questions ??
    (pufu?.question_id
      ? [{ id: pufu.question_id, text: pufu.context.question?.text ?? '関連する問い・気づき' }]
      : []);
  const favoriteVersion = useRef(0);
  const updateRevision = useCallback((revision: number) => {
    setPufu((current) => current && { ...current, revision });
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let complete = false,
      inFlight = false;
    const load = async () => {
      if (complete || inFlight) return;
      inFlight = true;
      const version = favoriteVersion.current;
      try {
        const result = await api<{ pufu: Pufu }>(`/api/v1/pufus/${encodeURIComponent(id)}`, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          complete = result.pufu.status === 'ready' || result.pufu.status === 'failed';
          setPufu((current) =>
            current?.id === result.pufu.id && version !== favoriteVersion.current
              ? { ...result.pufu, is_favorite: current.is_favorite }
              : result.pufu,
          );
          setError('');
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setError((e as Error).message);
          complete = true;
        }
      } finally {
        inFlight = false;
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 2500);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [id, retry]);
  return (
    <section className="pufu-page" aria-label="プ譜の編集">
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        {backLabel}
      </button>
      <header className="page-header">
        <div>
          <h1>プ譜</h1>
          <p>問い・気づきから、実行に向けた一枚へ。</p>
        </div>
        {pufu && (
          <PufuFavoriteButton
            key={pufu.id}
            pufu={pufu}
            onError={setError}
            onBusyChange={() => {
              favoriteVersion.current += 1;
            }}
            onSaved={(saved) => {
              setPufu((current) =>
                current?.id === saved.id ? { ...current, is_favorite: saved.is_favorite } : current,
              );
            }}
          />
        )}
      </header>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {pufu && (
        <div className="pufu-context">
          {questions.length > 0 && (
            <div>
              <span className="question-origin pufu-context-label">問い・気づき</span>
              <ul className="pufu-context-questions">
                {questions.map((question) => (
                  <li key={question.id}>
                    <button className="text-link" onClick={() => onQuestion(question.id)}>
                      {question.text}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="pufu-context-task">
            <span className="question-origin pufu-context-label">課題（獲得目標）</span>
            <p>{pufu.task}</p>
          </div>
          <span className="field-hint">{pufu.context.project.name}</span>
          {(pufu.stocks ?? (pufu.context.stock ? [pufu.context.stock] : [])).length > 0 && (
            <div className="pufu-related-stocks">
              <span className="field-hint">関連するストック</span>
              <ul>
                {(pufu.stocks ?? [pufu.context.stock!]).map((stock) => (
                  <li key={stock.id}>{stock.title}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {pufu && (
        <PufuRelations
          pufu={pufu}
          blocked={editorBlocked || pufu.status === 'queued' || pufu.status === 'generating'}
          onBusy={setRelationsBusy}
          onSaved={(saved) => {
            setPufu((current) =>
              current?.id === saved.id ? { ...saved, is_favorite: current.is_favorite } : saved,
            );
            setEditorVersion((value) => value + 1);
          }}
        />
      )}
      {pufu?.status === 'ready' && pufu.score ? (
        <Suspense
          fallback={
            <p className="content-loading">
              <LoaderCircle className="spin" size={20} aria-hidden="true" />
              エディターを読み込んでいます…
            </p>
          }
        >
          <div inert={relationsBusy} aria-busy={relationsBusy}>
            <PufuEditor
              key={`${id}-${editorVersion}`}
              pufu={pufu}
              onGuard={onGuard}
              onEditingStateChange={setEditorBlocked}
              onSaved={updateRevision}
            />
          </div>
        </Suspense>
      ) : pufu?.status === 'failed' ? (
        <div className="empty-state">
          <h2>プ譜を生成できませんでした</h2>
          <p>{pufu.error}</p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await send(`/api/v1/pufus/${encodeURIComponent(id)}/retry`);
                setPufu((current) => current && { ...current, status: 'queued', error: null });
                setRetry((value) => value + 1);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <RefreshCw size={17} className={busy ? 'spin' : ''} aria-hidden="true" />
            再試行
          </button>
        </div>
      ) : (
        !error && (
          <div className="empty-state" role="status">
            <LoaderCircle className="spin" size={25} aria-hidden="true" />
            <h2>{pufu ? 'プ譜を生成しています' : 'プ譜を読み込んでいます'}</h2>
            <p>
              {pufu
                ? '問い・気づき・課題・メモリから、勝利条件と実行の案を整理しています。この画面を閉じても生成を続けます。'
                : '保存した内容を取得しています。'}
            </p>
          </div>
        )
      )}
    </section>
  );
}
