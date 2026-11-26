import { ChevronDown, Footprints, History, Sparkles, GitBranch, Sprout } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { FootprintDetail, FootprintPoint } from '../../../shared/footprints';
import { intlLocale, t, useLanguage } from '../../i18n/i18n';
import { api } from '../../lib/api';
import './footprints.css';

function Detail({ detail }: { detail: FootprintDetail }) {
  const { analysis, links } = detail;
  const longDate = new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium' });
  const period = longDate.formatRange(new Date(detail.start_at), new Date(detail.end_at));
  const stages = [
    { key: 'before', icon: History, content: analysis.before },
    { key: 'triggers', icon: Sparkles, content: analysis.triggers },
    { key: 'process', icon: GitBranch, content: analysis.process },
    { key: 'current', icon: Sprout, content: analysis.current },
  ];
  const perspectives = Object.entries(analysis.perspectives).filter(([, value]) => value);
  return (
    <>
      <p className="footprints-period">
        {period} ／ {t(`footprints.kind.${detail.kind}`)}
      </p>
      <h3>{analysis.title}</h3>
      <div className="footprints-stages">
        {stages
          .filter(({ content }) => content.length > 0)
          .map(({ key, icon: Icon, content }) => (
            <div className="footprints-stage" key={key}>
              <Icon size={20} aria-hidden="true" />
              <div>
                <h4>{t(`footprints.${key}`)}</h4>
                {typeof content === 'string' ? (
                  <p>{content}</p>
                ) : (
                  <ul>
                    {content.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
      </div>
      {(['meaning', 'unchanged'] as const).map(
        (key) =>
          analysis[key] && (
            <section key={key}>
              <h4>{t(`footprints.${key}`)}</h4>
              <p>{analysis[key]}</p>
            </section>
          ),
      )}
      {perspectives.length > 0 && (
        <section>
          <h4>{t('footprints.perspectives')}</h4>
          <dl>
            {perspectives.map(([key, value]) => (
              <div key={key}>
                <dt>{t(`footprints.perspective.${key}`)}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {links.length > 0 && (
        <section>
          <h4>{t('footprints.evidence')}</h4>
          <ul>
            {links.map(({ kind, id, label }) => (
              <li key={`${kind}/${id}`}>
                <a href={`#${kind}/${encodeURIComponent(id)}`}>
                  {label || t(`footprints.link.${kind}`)}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export function ProjectFootprints({
  projectId,
  memoryRevision,
}: {
  projectId: string;
  memoryRevision?: number;
}) {
  useLanguage();
  const [points, setPoints] = useState<FootprintPoint[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<FootprintDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const panelId = useId();
  const titleId = useId();
  const timeline = useRef<HTMLDivElement>(null);
  const endpoint = `/api/v1/projects/${encodeURIComponent(projectId)}/footprints`;
  const point = points.find((item) => item.revision === selected) ?? points.at(-1);
  const revision = point?.revision;
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    let pending = true;
    const load = async () => {
      if (loading || document.visibilityState !== 'visible') return;
      loading = true;
      try {
        const response = await api<{ points: FootprintPoint[]; pending: boolean }>(endpoint, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          pending = response.pending;
          setPoints((current) =>
            JSON.stringify(current) === JSON.stringify(response.points) ? current : response.points,
          );
        }
      } catch {
        // The stock list remains available while the footprint endpoint recovers.
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (pending) void load();
    }, 15000);
    const refresh = () => void load();
    document.addEventListener('visibilitychange', refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [endpoint, memoryRevision]);
  useEffect(() => {
    if (selected === null && timeline.current)
      timeline.current.scrollLeft = timeline.current.scrollWidth;
  }, [points, selected]);
  useEffect(() => {
    if (!open || revision === undefined) return;
    const controller = new AbortController();
    void api<FootprintDetail>(`${endpoint}/${revision}`, { signal: controller.signal }).then(
      (result) => {
        if (!controller.signal.aborted) setDetail(result);
      },
      () => {
        if (!controller.signal.aborted) setFailed(true);
      },
    );
    return () => controller.abort();
  }, [endpoint, open, revision]);
  if (!point) return null;
  const date = new Intl.DateTimeFormat(intlLocale(), { month: 'numeric', day: 'numeric' });
  return (
    <section className="footprints" aria-labelledby={titleId}>
      <h2 id={titleId}>
        <Footprints size={18} aria-hidden="true" />
        {t('footprints.title')}
      </h2>
      <div
        className="footprints-timeline"
        ref={timeline}
        role="group"
        aria-label={t('footprints.title')}
      >
        {points.map(({ revision, end_at, kind }) => (
          <button
            type="button"
            key={revision}
            className={`footprints-point footprints-${kind}`}
            aria-pressed={revision === point.revision}
            onClick={() => {
              if (revision === point.revision) return;
              setDetail(null);
              setFailed(false);
              setSelected(revision);
            }}
          >
            <time dateTime={end_at}>{date.format(new Date(end_at))}</time>
            <span className="footprints-dot" aria-hidden="true" />
            <span>{t(`footprints.kind.${kind}`)}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="footprints-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setDetail(null);
          setFailed(false);
          if (!open) setSelected(point.revision);
          setOpen(!open);
        }}
      >
        {open
          ? t('footprints.close')
          : t('footprints.open', { date: date.format(new Date(point.end_at)) })}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <div id={panelId} className="footprints-detail" hidden={!open}>
        {open &&
          (detail && detail.revision === revision ? (
            <Detail detail={detail} />
          ) : (
            <p role="status">{t(failed ? 'footprints.load_failed' : 'push.loading')}</p>
          ))}
      </div>
    </section>
  );
}
