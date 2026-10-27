import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, LoaderCircle, Network, Plus } from 'lucide-react';
import type { PufuListItem } from '../shared/pufu';
import { api } from './api';
import type { Project } from '../shared/domain';
import PufuForm from './PufuForm';
import PufuModal from './PufuModal';

const statusLabels = {
  queued: '生成待ち',
  generating: '生成中',
  ready: '作成済み',
  failed: '生成失敗',
};
export default function Pufus({
  projectId,
  projects,
  refresh,
  active,
  onPufu,
}: {
  projectId: string | null;
  projects: Pick<Project, 'id' | 'name'>[];
  refresh: number;
  active: boolean;
  onPufu: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pufus, setPufus] = useState<PufuListItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let inFlight = false;
    setLoading(true);
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      const params = new URLSearchParams({ page: String(page) });
      if (projectId) params.set('project_id', projectId);
      try {
        const result = await api<{ pufus: PufuListItem[]; total: number }>(
          `/api/v1/pufus?${params}`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          setPufus(result.pufus);
          setTotal(result.total);
          setError('');
          if (page > Math.max(1, Math.ceil(result.total / 24)))
            setPage(Math.max(1, Math.ceil(result.total / 24)));
        }
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) setLoading(false);
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
  }, [projectId, page, refresh, retry, active]);
  return (
    <section className="questions-page" aria-label="保存したプ譜">
      <div className="filter-row">
        <span className="result-count">{total}件</span>
        <button
          className="button primary"
          onClick={() => setAdding(true)}
          disabled={!projects.length}
        >
          <Plus size={18} aria-hidden="true" />
          プ譜を追加
        </button>
      </div>
      {adding && (
        <PufuModal title="プ譜を追加" wide={false} busy={creating} onClose={() => setAdding(false)}>
          <PufuForm
            projects={projects}
            projectId={projectId}
            onBusyChange={setCreating}
            onDone={(id) => {
              setAdding(false);
              onPufu(id);
            }}
          />
        </PufuModal>
      )}
      {error && (
        <div className="form-error" role="alert">
          {error}
          <button className="button text-button" onClick={() => setRetry((value) => value + 1)}>
            再読み込み
          </button>
        </div>
      )}
      {loading && !pufus.length ? (
        <div className="empty-state">
          <LoaderCircle className="spin" size={20} aria-hidden="true" />
          <p>プ譜を読み込んでいます。</p>
        </div>
      ) : !pufus.length ? (
        !error && (
          <div className="empty-state">
            <span className="empty-icon">
              <Network className="pufu-icon" size={28} aria-hidden="true" />
            </span>
            <h2>プ譜はまだありません</h2>
            <p>
              「プ譜を追加」から獲得目標を入力して作成できます。問い・気づきからも作成できます。
            </p>
          </div>
        )
      ) : (
        <div className="pufu-list">
          {pufus.map((pufu) => (
            <button key={pufu.id} className="pufu-list-item" onClick={() => onPufu(pufu.id)}>
              <span>
                <strong>{pufu.task}</strong>
                {(
                  pufu.questions ??
                  (pufu.question_id ? [{ id: pufu.question_id, text: pufu.question_text }] : [])
                ).map((question) => (
                  <small key={question.id}>問い・気づき：{question.text}</small>
                ))}
                {pufu.stocks?.map((stock) => (
                  <small key={stock.id}>ストック：{stock.title}</small>
                ))}
                <small>
                  {pufu.project_name} · {statusLabels[pufu.status]} · 第{pufu.current_phase}局面
                </small>
                <small>
                  <time dateTime={pufu.created_at}>
                    {new Intl.DateTimeFormat('ja-JP', {
                      dateStyle: 'medium',
                      timeZone: 'Asia/Tokyo',
                    }).format(new Date(pufu.created_at))}
                  </time>
                </small>
              </span>
            </button>
          ))}
        </div>
      )}
      {total > 24 && (
        <div className="pagination">
          <button
            className="button secondary"
            disabled={page === 1}
            onClick={() => setPage((value) => value - 1)}
          >
            <ChevronLeft size={17} aria-hidden="true" />
            前へ
          </button>
          <span>
            {page} / {Math.ceil(total / 24)}
          </span>
          <button
            className="button secondary"
            disabled={page * 24 >= total}
            onClick={() => setPage((value) => value + 1)}
          >
            次へ
            <ChevronRight size={17} aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
}
