import { useMemo, useState } from 'react';
import {
  publicFootprintEvidenceHref,
  type PublicFootprint,
  type PublicFootprintPage,
} from '../../../shared/footprints';
import { t, useLanguage } from '../../i18n/i18n';
import { FootprintDetailView } from '../footprints/FootprintDetailView';
import { FootprintTimeline } from '../footprints/FootprintTimeline';
import { Pagination } from './PublicLayout';
import { ResourceState } from './ResourceState';
import type { PublicListProps } from './types';
import { useResource } from './useResource';

function PublishedTimeline({ items, publicId }: { items: PublicFootprint[]; publicId: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const points = useMemo(() => [...items].reverse(), [items]);
  const point = points.find(({ id }) => id === selected) ?? points.at(-1);
  if (!point) return <p className="public-message">{t('footprints.public_empty')}</p>;
  return (
    <section className="footprints" aria-label={t('footprints.title')}>
      <FootprintTimeline
        points={points}
        selected={point.id}
        followLatest={selected === null}
        onSelect={setSelected}
      />
      {point.kind !== 'continuing' && (
        <article className="footprints-detail">
          <FootprintDetailView
            detail={point}
            evidenceHref={(link) => publicFootprintEvidenceHref(publicId, link)}
          />
        </article>
      )}
    </section>
  );
}

export function PublicFootprintList({
  root,
  publicId,
  page,
  onPageChange,
}: PublicListProps & { publicId: string }) {
  useLanguage();
  const { data, error, reload } = useResource<PublicFootprintPage>(
    `${root}/footprints?page=${page}`,
  );
  return !data ? (
    <ResourceState error={error} retry={reload} />
  ) : (
    <>
      <PublishedTimeline key={page} items={data.items} publicId={publicId} />
      <Pagination page={page} hasMore={data.has_more} onChange={onPageChange} />
    </>
  );
}
