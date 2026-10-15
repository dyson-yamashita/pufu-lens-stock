import { lazy, Suspense, useEffect, useState } from 'react';
import { ArrowLeft, LoaderCircle, RefreshCw } from 'lucide-react';
import type { Pufu } from '../shared/pufu';
import { api, send } from './api';

const PufuEditor = lazy(() => import('./PufuEditor'));
export default function PufuPage({
  id,
  onQuestion,
  onGuard,
}: {
  id: string;
  onQuestion: (id: string) => void;
  onGuard: (guard: (() => boolean) | null) => void;
}) {
  const [pufu, setPufu] = useState<Pufu>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let complete = false,
      inFlight = false;
    const load = async () => {
      if (complete || inFlight) return;
      inFlight = true;
      try {
        const result = await api<{ pufu: Pufu }>(`/api/v1/pufus/${encodeURIComponent(id)}`, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          complete = result.pufu.status === 'ready' || result.pufu.status === 'failed';
          setPufu(result.pufu);
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
      <button className="back-link" onClick={() => onQuestion(pufu?.question_id ?? '')}>
        <ArrowLeft size={16} aria-hidden="true" />
        問いの詳細に戻る
      </button>
      <header className="page-header">
        <div>
          <h1>プ譜</h1>
          <p>問いから、実行に向けた一枚へ。</p>
        </div>
      </header>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {pufu && (
        <div className="pufu-context">
          <span className="question-origin pufu-context-label">問い</span>
          <p>{pufu.context.question.text}</p>
          <div className="pufu-context-task">
            <span className="question-origin pufu-context-label">課題（獲得目標）</span>
            <p>{pufu.task}</p>
          </div>
          <span className="field-hint">{pufu.context.project.name}</span>
        </div>
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
          <PufuEditor key={id} pufu={pufu} onGuard={onGuard} />
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
                ? '問い・課題・メモリから、勝利条件と実行の案を整理しています。この画面を閉じても生成を続けます。'
                : '保存した内容を取得しています。'}
            </p>
          </div>
        )
      )}
    </section>
  );
}
