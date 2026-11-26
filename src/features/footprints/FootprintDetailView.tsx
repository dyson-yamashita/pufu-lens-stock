import { History, Sprout } from 'lucide-react';
import type {
  FootprintDetail,
  FootprintEvidence,
  FootprintStatement,
  SharedFootprint,
} from '../../../shared/footprints';
import { intlLocale, t } from '../../i18n/i18n';

const linkKey = ({ kind, id, phase }: FootprintEvidence) => JSON.stringify([kind, id, phase]);

type EvidenceHref = (link: FootprintEvidence) => string;
const ownerEvidenceHref: EvidenceHref = ({ kind, id, phase }) =>
  `#${kind}/${encodeURIComponent(id)}${kind === 'pufu' && phase ? `/${phase}` : ''}`;

function EvidenceLinks({
  links,
  evidenceHref,
}: {
  links: FootprintEvidence[];
  evidenceHref: EvidenceHref;
}) {
  if (!links.length) return null;
  return (
    <ul className="footprints-evidence-links">
      {links.map((link) => {
        const phase = link.kind === 'pufu' ? link.phase : undefined;
        const label = link.label || t(`footprints.link.${link.kind}`);
        return (
          <li key={linkKey(link)}>
            <a href={evidenceHref(link)}>
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
  evidenceHref,
}: {
  heading: string;
  items: FootprintStatement[];
  quote?: boolean;
  evidenceHref: EvidenceHref;
}) {
  if (!items.length) return null;
  return (
    <section>
      <h4>{heading}</h4>
      <ul className="footprints-statements">
        {items.map(({ text, links }, index) => (
          <li key={index}>
            <p>{quote ? <q>{text}</q> : text}</p>
            <EvidenceLinks links={links} evidenceHref={evidenceHref} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FootprintDetailView({
  detail,
  evidenceHref = ownerEvidenceHref,
}: {
  detail: Omit<FootprintDetail, 'revision'> | Exclude<SharedFootprint, { kind: 'continuing' }>;
  evidenceHref?: EvidenceHref;
}) {
  const longDate = new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium' });
  const period = longDate.formatRange(new Date(detail.start_at), new Date(detail.end_at));
  const periodLabel = (
    <p className="footprints-period">
      {period} ／ {t(`footprints.kind.${detail.kind}`)}
    </p>
  );
  if (!('analysis' in detail))
    return (
      <>
        {periodLabel}
        <h3>{detail.title}</h3>
        <p className="footprints-approved-summary">{detail.summary}</p>
      </>
    );
  const { analysis, links } = detail;
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
      {periodLabel}
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
      <LinkedStatements
        heading={t('footprints.changes')}
        items={changes}
        evidenceHref={evidenceHref}
      />
      <LinkedStatements
        heading={t('footprints.triggers')}
        items={triggers}
        evidenceHref={evidenceHref}
        quote
      />
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
          <EvidenceLinks links={related} evidenceHref={evidenceHref} />
        </section>
      )}
    </>
  );
}
