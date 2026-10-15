import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import type { MemoryCoverage, MemoryUpdateMode } from '../shared/domain';
import { api, createRequestId, send } from './api';

type Target = { name: string; coverage: MemoryCoverage; pending: boolean };

export function MemoryCoverageSummary({ coverage }: { coverage: MemoryCoverage }) {
  return (
    <p className="memory-coverage" role="status">
      <span>
        反映済み{' '}
        <strong>
          {coverage.reflected_count} / {coverage.ready_count}件
        </strong>
      </span>
      <span>
        未反映 <strong>{coverage.pending_count}件</strong>
      </span>
      <span>
        要約未完了 <strong>{coverage.waiting_count}件</strong>
      </span>
    </p>
  );
}

export default function MemoryRebuildForm({
  projectId,
  projectName,
  onDone,
  onClose,
}: {
  projectId: string | null;
  projectName?: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const [targets, setTargets] = useState<Target[]>([]);
  const [mode, setMode] = useState<MemoryUpdateMode>('incremental');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<{ mode: MemoryUpdateMode; id: string } | null>(null);
  const modeName = useId();
  const needsFull = targets.some((target) => target.coverage.full_rebuild_reason);
  const updating = targets.some((target) => target.pending);
  const pendingCount = targets.reduce((sum, target) => sum + target.coverage.pending_count, 0);

  useEffect(() => {
    const controller = new AbortController();
    const scopes = projectId
      ? [
          { name: `${projectName ?? 'プロジェクト'}のメモリ`, id: projectId },
          { name: 'あなたのメモリ', id: null },
        ]
      : [{ name: 'あなたのメモリ', id: null }];
    void Promise.all(
      scopes.map(async (scope) => ({
        name: scope.name,
        ...(await api<{ coverage: MemoryCoverage; pending: boolean }>(
          `/api/v1/memory${scope.id ? `?project_id=${encodeURIComponent(scope.id)}` : ''}`,
          { signal: controller.signal },
        )),
      })),
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setTargets(result);
        if (result.some((target) => target.coverage.full_rebuild_reason)) setMode('full');
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, projectName]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      busy ||
      loading ||
      updating ||
      !targets.length ||
      (mode === 'incremental' && (!pendingCount || needsFull))
    )
      return;
    setBusy(true);
    setError('');
    if (!request.current || request.current.mode !== mode)
      request.current = { mode, id: createRequestId() };
    try {
      await send('/api/v1/memory/rebuild', {
        project_id: projectId,
        mode,
        request_id: request.current.id,
      });
      onDone();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="memory-rebuild-form" aria-busy={loading || busy}>
      <p className="form-help">更新方法を選んでください。要約が完了したストックが対象です。</p>
      {projectId && <p className="form-help">この操作では「あなたのメモリ」も更新します。</p>}
      {loading && <p role="status">反映状況を確認しています…</p>}
      {targets.map((target) => (
        <div className="memory-update-target" key={target.name}>
          <h3>{target.name}</h3>
          <MemoryCoverageSummary coverage={target.coverage} />
          {target.coverage.full_rebuild_reason && (
            <p className="update-note">{target.coverage.full_rebuild_reason}</p>
          )}
        </div>
      ))}
      {updating && <p className="update-note">メモリを更新中です。完了後に開き直してください。</p>}
      <fieldset
        className="memory-update-options"
        disabled={loading || busy || updating || !targets.length}
      >
        <legend>更新方法</legend>
        <label className="memory-update-option">
          <input
            type="radio"
            name={modeName}
            value="incremental"
            checked={mode === 'incremental'}
            disabled={needsFull}
            onChange={() => setMode('incremental')}
          />
          <span>
            <strong>未反映分を反映</strong>
            <span>現在のメモリに、まだ取り込んでいない記事の要約だけを追加します。</span>
          </span>
        </label>
        <label className="memory-update-option">
          <input
            type="radio"
            name={modeName}
            value="full"
            checked={mode === 'full'}
            onChange={() => setMode('full')}
          />
          <span>
            <strong>全件から再生成</strong>
            <span>
              反映済みの記事も含め、すべての要約から作り直します。差分更新よりAIの消費が増えます。
            </span>
          </span>
        </label>
      </fieldset>
      {!loading && targets.length > 0 && !needsFull && !pendingCount && (
        <p className="form-help">
          未反映の要約はありません。内容を見直す場合は「全件から再生成」を選んでください。
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
          キャンセル
        </button>
        <button
          type="submit"
          className="button primary"
          disabled={
            loading ||
            busy ||
            updating ||
            !targets.length ||
            (mode === 'incremental' && (!pendingCount || needsFull))
          }
        >
          {busy ? (
            <LoaderCircle className="spin" size={16} aria-hidden="true" />
          ) : (
            <RefreshCw size={16} aria-hidden="true" />
          )}
          {mode === 'full' ? '全件から再生成' : '未反映分を反映'}
        </button>
      </div>
    </form>
  );
}
