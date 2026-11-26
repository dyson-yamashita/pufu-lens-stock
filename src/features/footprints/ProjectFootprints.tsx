import { ChevronDown, Footprints, History, Sprout } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import type {
  FootprintDetail,
  FootprintEvidence,
  FootprintPoint,
  FootprintStatement,
  OwnedFootprintDetail,
} from '../../../shared/footprints';
import { intlLocale, t, useLanguage } from '../../i18n/i18n';
import { api } from '../../lib/api';
import { FootprintPublicationEditor } from './FootprintPublicationEditor';
import { FootprintTimeline } from './FootprintTimeline';

const linkKey = ({ kind, id, phase }: FootprintEvidence) => JSON.stringify([kind, id, phase]);

function EvidenceLinks({ links }: { links: FootprintEvidence[] }) {
  if (!links.length) return null;
  return (
    <ul className="footprints-evidence-links">
      {links.map((link) => {
        const phase = link.kind === 'pufu' ? link.phase : undefined;
        const href = `#${link.kind}/${encodeURIComponent(link.id)}${phase ? `/${phase}` : ''}`;
        const label = link.label || t(`footprints.link.${link.kind}`);
        return (
          <li key={linkKey(link)}>
            <a href={href}>
              {phase ? `${label} · ${t('phase.number', { number: phase })}` : label}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function LinkedStatements({
  heading,
  items,
  quote,
}: {
  heading: string;
  items: FootprintStatement[];
  quote?: boolean;
}) {
  if (!items.length) return null;
  return (
    <section>
      <h4>{heading}</h4>
      <ul className="footprints-statements">
        {items.map(({ text, links }, index) => (
          <li key={index}>
            <p>{quote ? <q>{text}</q> : text}</p>
            <EvidenceLinks links={links} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Detail({ detail }: { detail: FootprintDetail }) {
  const { analysis, links } = detail;
  const longDate = new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium' });
  const period = longDate.formatRange(new Date(detail.start_at), new Date(detail.end_at));
  const stages = [
    { key: 'before', icon: History, content: analysis.before },
    { key: 'current', icon: Sprout, content: analysis.current },
  ];
  const changes = analysis.changes ?? [];
  const triggers = analysis.trigger_details ?? [];
  const earlierRecords = analysis.trigger_details === undefined ? analysis.triggers : [];
  const linked = new Set([...changes, ...triggers].flatMap(({ links }) => links.map(linkKey)));
  const related = links.filter((link) => !linked.has(linkKey(link)));
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
                <p>{content}</p>
              </div>
            </div>
          ))}
      </div>
      <LinkedStatements heading={t('footprints.changes')} items={changes} />
      <LinkedStatements heading={t('footprints.triggers')} items={triggers} quote />
      {(['process', 'meaning', 'interpretation', 'unchanged'] as const).map(
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
      {(earlierRecords.length > 0 || related.length > 0) && (
        <section>
          <h4>{t('footprints.evidence')}</h4>
          {earlierRecords.length > 0 && (
            <ul>
              {earlierRecords.map((text, index) => (
                <li key={index}>{text}</li>
              ))}
            </ul>
          )}
          <EvidenceLinks links={related} />
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
  const [detail, setDetail] = useState<OwnedFootprintDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const panelId = useId();
  const titleId = useId();
  const timeline = useMemo(() => points.map((item) => ({ ...item, id: item.revision })), [points]);
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
        // Memory remains available while the footprint endpoint recovers.
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
    if (!open || revision === undefined) return;
    const controller = new AbortController();
    void api<OwnedFootprintDetail>(`${endpoint}/${revision}`, { signal: controller.signal }).then(
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
      <FootprintTimeline
        points={timeline}
        selected={point.revision}
        followLatest={selected === null}
        onSelect={(revision) => {
          if (revision === point.revision) return;
          setDetail(null);
          setFailed(false);
          setSelected(revision);
        }}
      />
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
            <>
              <Detail detail={detail} />
              <FootprintPublicationEditor
                key={revision}
                endpoint={`${endpoint}/${revision}/publication`}
                initial={detail.publication}
                enabled={detail.publication_enabled}
              />
            </>
          ) : (
            <p role="status">{t(failed ? 'footprints.load_failed' : 'push.loading')}</p>
          ))}
      </div>
    </section>
  );
}
