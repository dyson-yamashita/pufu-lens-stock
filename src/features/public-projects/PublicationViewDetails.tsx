import { ArrowLeft } from 'lucide-react';
import { Fragment, useId, useState } from 'react';
import { publicListPageLimit, publicListPageSize } from '../../../shared/public-project';
import type {
  Publication,
  PublicList,
  PublicPufuSummary,
  PublicQuestion,
  PublicStock,
  PublicViewRankingItem,
  PublicViewStats,
} from '../../../shared/public-project';
import { pufuDisplayTitle } from '../../../shared/pufu';
import { intlLocale, t, useLanguage } from '../../i18n/i18n';
import { Pagination } from './PublicLayout';
import { PublicViewCount } from './PublicViewCount';
import { ResourceState } from './ResourceState';
import { useResource } from './useResource';

const kindLabels = {
  stocks: 'ui.app.stocks',
  questions: 'ui.app.questions_insights',
  pufus: 'ui.app.pufu',
} as const;
const kinds = ['stocks', 'questions', 'pufus'] as const;
const rankingPeriods = ['week', 'month', 'all'] as const;
const rankingLabels = {
  week: 'ui.usage.week',
  month: 'ui.public_projects.by_month',
  all: 'ui.usage.all_time',
} as const;
type Kind = keyof typeof kindLabels;
type Item = PublicStock | PublicQuestion | PublicPufuSummary;

function itemTitle(item: Item) {
  if ('task' in item) return pufuDisplayTitle(item) || t('ui.app.pufu');
  if ('text' in item) return item.text;
  return item.title.trim() || item.domain || t('ui.app.text');
}

export function PublicationViewDetails({
  projectId,
  isMobile,
}: {
  projectId: string;
  isMobile: boolean;
}) {
  useLanguage();
  const id = encodeURIComponent(projectId);
  const publicationPath = `/api/v1/projects/${id}/publication`;
  const { data, error, reload } = useResource<{ publication: Publication }>(
    `${publicationPath}?view_period=week`,
  );
  const publication = data?.publication;
  return (
    <section className="publication-view-details" aria-label={t('ui.public_projects.view_details')}>
      <a className="text-link" href={`#settings/${id}`}>
        <ArrowLeft size={16} aria-hidden="true" />
        {t('ui.public_projects.back_to_publication_settings')}
      </a>
      {!publication ? (
        <ResourceState error={error} retry={reload} />
      ) : publication.is_public && publication.public_id ? (
        <Fragment key={publication.public_id}>
          <p className="public-help">{t('ui.public_projects.public_views_help')}</p>
          <ViewRanking
            publicId={publication.public_id}
            publicationPath={publicationPath}
            stats={publication.view_stats}
          />
          <ViewItems publicId={publication.public_id} isMobile={isMobile} />
        </Fragment>
      ) : (
        <p className="public-help">{t('ui.public_projects.view_details_public_only')}</p>
      )}
    </section>
  );
}

function rankingMonths({ first, current }: NonNullable<PublicViewStats['months']>) {
  const formatter = new Intl.DateTimeFormat(intlLocale(), {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  const start = new Date(`${first}-01T00:00:00Z`);
  const options = [];
  for (
    const date = new Date(`${current}-01T00:00:00Z`);
    date >= start;
    date.setUTCMonth(date.getUTCMonth() - 1)
  ) {
    options.push({ value: date.toISOString().slice(0, 7), label: formatter.format(date) });
  }
  return options;
}

function ViewRanking({
  publicId,
  publicationPath,
  stats,
}: {
  publicId: string;
  publicationPath: string;
  stats: PublicViewStats | null;
}) {
  const heading = useId();
  const [period, setPeriod] = useState<(typeof rankingPeriods)[number]>('week');
  const months = stats?.months;
  const [month, setMonth] = useState(months?.current ?? '');
  const query = new URLSearchParams({ view_period: period });
  if (period === 'month' && month) query.set('view_month', month);
  return (
    <section className="publication-view-ranking" aria-labelledby={heading}>
      <h2 id={heading}>{t('ui.public_projects.top_details')}</h2>
      <div className="publication-ranking-controls">
        <div className="detail-tabs" role="group" aria-label={t('ui.usage.period')}>
          {rankingPeriods.map((value) => (
            <button
              type="button"
              key={value}
              className={period === value ? 'active' : ''}
              aria-pressed={period === value}
              onClick={() => setPeriod(value)}
            >
              {t(rankingLabels[value])}
            </button>
          ))}
        </div>
        {period === 'month' && months && (
          <select
            aria-label={t('ui.public_projects.ranking_month')}
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          >
            {rankingMonths(months).map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        )}
      </div>
      {period === 'week' ? (
        <RankingList publicId={publicId} items={stats?.top ?? []} />
      ) : (
        <RankingResults publicId={publicId} path={`${publicationPath}?${query}`} />
      )}
    </section>
  );
}

function RankingResults({ publicId, path }: { publicId: string; path: string }) {
  const { data, error, reload } = useResource<{ publication: Publication }>(path);
  if (error) return <ResourceState error={error} retry={reload} />;
  if (!data)
    return (
      <p className="public-help" role="status">
        {t('ui.public_projects.loading')}
      </p>
    );
  if (!data.publication.is_public)
    return <p className="public-help">{t('ui.public_projects.view_details_public_only')}</p>;
  return <RankingList publicId={publicId} items={data.publication.view_stats?.top ?? []} />;
}

function RankingList({ publicId, items }: { publicId: string; items: PublicViewRankingItem[] }) {
  const publicPath = `/p/${encodeURIComponent(publicId)}`;
  if (!items.length)
    return <p className="public-help">{t('ui.public_projects.no_ranked_details')}</p>;
  return (
    <ol>
      {items.map((item) => (
        <li key={`${item.kind}/${item.id}`}>
          <div className="public-count-row">
            <div>
              <span className="public-help">{t(kindLabels[item.kind])}</span>{' '}
              <a
                className="text-link"
                href={`${publicPath}/${item.kind}/${encodeURIComponent(item.id)}`}
                target="_blank"
                rel="noreferrer"
              >
                {item.title || t('ui.app.text')}
              </a>
            </div>
            <PublicViewCount count={item.views} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function ViewItems({ publicId, isMobile }: { publicId: string; isMobile: boolean }) {
  const [kind, setKind] = useState<Kind>('stocks');
  // Keep the same item in view when the viewport crosses the mobile breakpoint.
  const [firstItemIndex, setFirstItemIndex] = useState(0);
  const pagesPerResponse = isMobile ? 2 : 1;
  const pageSize = publicListPageSize / pagesPerResponse;
  const pageIndex = Math.floor(firstItemIndex / pageSize);
  const page = pageIndex + 1;
  const requestPage = Math.floor(pageIndex / pagesPerResponse) + 1;
  const offset = (pageIndex % pagesPerResponse) * pageSize;
  const publicPath = `/p/${encodeURIComponent(publicId)}`;
  const { data, error, reload } = useResource<PublicList<Item>>(
    `/api/public/projects/${encodeURIComponent(publicId)}/${kind}?sort=views&page=${requestPage}`,
  );
  const items = data?.items.slice(offset, offset + pageSize) ?? [];
  const totalPages = data
    ? Math.min(publicListPageLimit * pagesPerResponse, Math.ceil(data.total / pageSize))
    : 0;
  return (
    <>
      <div className="detail-tabs" role="group" aria-label={t('ui.public_projects.view_details')}>
        {kinds.map((itemKind) => (
          <button
            key={itemKind}
            type="button"
            className={kind === itemKind ? 'active' : ''}
            aria-pressed={kind === itemKind}
            onClick={() => {
              setKind(itemKind);
              setFirstItemIndex(0);
            }}
          >
            {t(kindLabels[itemKind])}
          </button>
        ))}
      </div>
      {!data ? (
        <ResourceState error={error} retry={reload} />
      ) : items.length ? (
        <ul className="publication-view-rows">
          {items.map((item) => (
            <li className="public-count-row" key={item.id}>
              <a
                className="text-link"
                href={`${publicPath}/${kind}/${encodeURIComponent(item.id)}`}
                target="_blank"
                rel="noreferrer"
              >
                {itemTitle(item)}
              </a>
              <PublicViewCount count={item.view_count} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="public-message">{t('ui.public_projects.no_public_items')}</p>
      )}
      {data && (
        <Pagination
          page={page}
          hasMore={page < totalPages}
          totalPages={page <= totalPages ? totalPages : undefined}
          onChange={(nextPage) => setFirstItemIndex((nextPage - 1) * pageSize)}
        />
      )}
    </>
  );
}
