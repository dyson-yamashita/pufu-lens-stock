import { useEffect, useRef } from 'react';
import type { FootprintPoint } from '../../../shared/footprints';
import { intlLocale, t, useLanguage } from '../../i18n/i18n';
import './footprints.css';

type TimelinePoint<Id> = Pick<FootprintPoint, 'end_at' | 'kind'> & { id: Id };

export function FootprintTimeline<Id extends string | number>({
  points,
  selected,
  followLatest,
  opensDialog = false,
  onSelect,
}: {
  points: TimelinePoint<Id>[];
  selected: Id;
  followLatest: boolean;
  opensDialog?: boolean;
  onSelect: (id: Id) => void;
}) {
  useLanguage();
  const timeline = useRef<HTMLDivElement>(null);
  const date = new Intl.DateTimeFormat(intlLocale(), { month: 'numeric', day: 'numeric' });
  useEffect(() => {
    if (followLatest && timeline.current)
      timeline.current.scrollLeft = timeline.current.scrollWidth;
  }, [followLatest, points]);
  return (
    <div
      className="footprints-timeline"
      ref={timeline}
      role="group"
      aria-label={t('footprints.title')}
    >
      {points.map(({ id, end_at, kind }) => (
        <button
          type="button"
          key={id}
          className={`footprints-point footprints-${kind}`}
          aria-pressed={id === selected}
          aria-haspopup={opensDialog && kind !== 'continuing' ? 'dialog' : undefined}
          disabled={kind === 'continuing'}
          onClick={() => onSelect(id)}
        >
          <time dateTime={end_at}>{date.format(new Date(end_at))}</time>
          <span className="footprints-dot" aria-hidden="true" />
          <span>{t(`footprints.kind.${kind}`)}</span>
        </button>
      ))}
    </div>
  );
}
