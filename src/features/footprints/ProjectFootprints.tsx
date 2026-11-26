import { Footprints } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FootprintPoint, OwnedFootprintDetail } from '../../../shared/footprints';
import { Modal } from '../../components/Modal';
import { t, useLanguage } from '../../i18n/i18n';
import { api, ApiError, send } from '../../lib/api';
import { FootprintDetailView } from './FootprintDetailView';
import { FootprintTimeline } from './FootprintTimeline';

function FootprintDetailPanel({
  endpoint,
  onKind,
}: {
  endpoint: string;
  onKind: (revision: number, kind: FootprintPoint['kind']) => void;
}) {
  const [detail, setDetail] = useState<OwnedFootprintDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [failedGeneration, setFailedGeneration] = useState<number | null>(null);
  const [view, setView] = useState<'current' | 'original' | 'personal'>('current');

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    let pending = true;
    const load = async () => {
      try {
        const result = await api<OwnedFootprintDetail>(endpoint, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setDetail(result);
        onKind(result.revision, result.shared?.kind ?? result.kind);
        setFailed(false);
        pending = result.reanalysis?.status === 'pending';
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
          setDetail(null);
          pending = false;
        }
        setFailed(true);
      }
      if (pending) timer = window.setTimeout(() => void load(), 4000);
    };
    void load();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [endpoint, onKind, refresh]);

  if (!detail) return <p role="status">{t(failed ? 'footprints.load_failed' : 'push.loading')}</p>;
  const reanalysis = detail.reanalysis;
  const pending = reanalysis?.status === 'pending';
  const result = detail.shared ?? reanalysis?.result;
  const personal = detail.shared && !reanalysis?.shared ? reanalysis?.result : null;
  const displayed =
    view === 'original' && detail.original_available
      ? detail
      : ((view === 'personal' && personal ? personal : result) ?? detail);
  const canViewOriginal =
    detail.original_available &&
    (reanalysis?.result != null || (detail.shared && 'summary' in detail.shared));

  async function reanalyze() {
    if (reanalysis == null || pending || submitting) return;
    setSubmitting(true);
    setFailedGeneration(null);
    try {
      const { generation } = await send<{ generation: number }>(`${endpoint}/reanalysis`, {
        generation: reanalysis.generation,
      });
      setDetail((current) =>
        current
          ? { ...current, reanalysis: { ...reanalysis, generation, status: 'pending' } }
          : current,
      );
      setView('current');
    } catch {
      setFailedGeneration(reanalysis.generation);
    } finally {
      setSubmitting(false);
      setRefresh((value) => value + 1);
    }
  }

  const reanalysisFailed =
    reanalysis?.status === 'failed' || reanalysis?.generation === failedGeneration;
  return (
    <>
      {displayed.kind === 'continuing' ? (
        <p>{t('footprints.reanalysis_continuing')}</p>
      ) : (
        <FootprintDetailView detail={displayed} />
      )}
      {reanalysis && (
        <div className="footprints-reanalysis">
          <button
            type="button"
            className="button secondary"
            onClick={reanalyze}
            disabled={submitting || pending}
          >
            {t('footprints.reanalyze')}
          </button>
          {canViewOriginal && (
            <button
              type="button"
              className="button secondary"
              onClick={() => setView(view === 'original' ? 'current' : 'original')}
            >
              {t(
                view === 'original'
                  ? detail.shared
                    ? 'footprints.reanalysis_shared'
                    : 'footprints.reanalysis_result'
                  : 'footprints.reanalysis_original',
              )}
            </button>
          )}
          {personal && (
            <button
              type="button"
              className="button secondary"
              onClick={() => setView(view === 'personal' ? 'current' : 'personal')}
            >
              {t(
                view === 'personal'
                  ? 'footprints.reanalysis_shared'
                  : 'footprints.reanalysis_personal',
              )}
            </button>
          )}
          {(pending || reanalysisFailed || reanalysis.result) && (
            <p role="status">
              {t(
                pending
                  ? 'footprints.reanalysis_pending'
                  : reanalysisFailed
                    ? 'footprints.reanalysis_failed'
                    : 'footprints.reanalysis_saved',
              )}
            </p>
          )}
          {detail.publication_enabled && !detail.shared && !pending && (
            <p>{t('footprints.reanalysis_to_share')}</p>
          )}
        </div>
      )}
    </>
  );
}

export function ProjectFootprints({
  projectId,
  points,
  onKind,
}: {
  projectId: string;
  points: FootprintPoint[];
  onKind: (revision: number, kind: FootprintPoint['kind']) => void;
}) {
  useLanguage();
  const [selected, setSelected] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const timelineHeading = useRef<HTMLHeadingElement>(null);
  const timeline = useMemo(() => points.map((item) => ({ ...item, id: item.revision })), [points]);
  const endpoint = `/api/v1/projects/${encodeURIComponent(projectId)}/footprints`;
  const point = points.find((item) => item.revision === selected) ?? points.at(-1);
  if (!point) return null;
  return (
    <section className="footprints" aria-labelledby={titleId}>
      <h2 id={titleId} ref={timelineHeading} tabIndex={-1}>
        <Footprints size={18} aria-hidden="true" />
        {t('footprints.title')}
      </h2>
      <FootprintTimeline
        points={timeline}
        selected={point.revision}
        followLatest={selected === null}
        opensDialog
        onSelect={(revision) => {
          setSelected(revision);
          setOpen(true);
        }}
      />
      {open && point.revision === selected && (
        <Modal
          title={t('footprints.title')}
          onClose={() => {
            setOpen(false);
            if (point.kind === 'continuing')
              window.requestAnimationFrame(() => timelineHeading.current?.focus());
          }}
          className="footprints-modal"
        >
          <div className="footprints-detail">
            <FootprintDetailPanel
              key={`${endpoint}/${point.revision}`}
              endpoint={`${endpoint}/${point.revision}`}
              onKind={onKind}
            />
          </div>
        </Modal>
      )}
    </section>
  );
}
