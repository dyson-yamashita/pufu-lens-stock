import { useMemo, useState } from 'react';
import type { PublicFootprint, PublicFootprintPage } from '../../../shared/footprints';
import { intlLocale, t, useLanguage } from '../../i18n/i18n';
import { FootprintTimeline } from '../footprints/FootprintTimeline';
import { Pagination } from './PublicLayout';
import { ResourceState } from './ResourceState';
import type { PublicListProps } from './types';
import { useResource } from './useResource';

function PublishedTimeline({ items }: { items: PublicFootprint[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const points = useMemo(() => [...items].reverse(), [items]);
  const point = points.find(({ id }) => id === selected) ?? points.at(-1);
  if (!point) return <p className="public-message">{t('footprints.public_empty')}</p>;
  const date = new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium' });
  return (
    <section className="footprints" aria-label={t('footprints.title')}>
      <FootprintTimeline
        points={points}
        selected={point.id}
        followLatest={selected === null}
        onSelect={setSelected}
      />
      <article className="footprints-detail footprints-public-summary">
        <p className="footprints-period">
          {date.formatRange(new Date(point.start_at), new Date(point.end_at))}
        </p>
        <h2>{point.title}</h2>
        <p>{point.summary}</p>
      </article>
    </section>
  );
}

export function PublicFootprintList({ root, page, onPageChange }: PublicListProps) {
  useLanguage();
  const { data, error, reload } = useResource<PublicFootprintPage>(
    `${root}/footprints?page=${page}`,
  );
  return !data ? (
    <ResourceState error={error} retry={reload} />
  ) : (
    <>
      <PublishedTimeline key={page} items={data.items} />
      <Pagination page={page} hasMore={data.has_more} onChange={onPageChange} />
    </>
  );
}
