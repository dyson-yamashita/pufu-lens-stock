import { ArrowLeft } from 'lucide-react';
import { useId, useState } from 'react';
import type {
  Publication,
  PublicList,
  PublicPufuSummary,
  PublicQuestion,
  PublicStock,
  PublicViewRankingItem,
} from '../../../shared/public-project';
import { pufuDisplayTitle } from '../../../shared/pufu';
import { t, useLanguage } from '../../i18n/i18n';
import { Pagination } from './PublicLayout';
import { PublicViewCount } from './PublicViewCount';
import { ResourceState } from './ResourceState';
import { publicViewLabels } from './types';
import { useResource } from './useResource';

const kindLabels = {
  stocks: 'ui.app.stocks',
  questions: 'ui.app.questions_insights',
  pufus: 'ui.app.pufu',
} as const;
const kinds = ['stocks', 'questions', 'pufus'] as const;
type Kind = keyof typeof kindLabels;
type Item = PublicStock | PublicQuestion | PublicPufuSummary;

function itemTitle(item: Item) {
  if ('task' in item) return pufuDisplayTitle(item) || t('ui.app.pufu');
  if ('text' in item) return item.text;
  return item.title.trim() || item.domain || t('ui.app.text');
}

export function PublicationViewDetails({ projectId }: { projectId: string }) {
  useLanguage();
  const id = encodeURIComponent(projectId);
  const { data, error, reload } = useResource<{ publication: Publication }>(
    `/api/v1/projects/${id}/publication`,
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
        <>
          <p className="public-help">{t('ui.public_projects.public_views_help')}</p>
          <ViewRanking publicId={publication.public_id} items={publication.view_stats?.top ?? []} />
          <ViewItems key={publication.public_id} publicId={publication.public_id} />
        </>
      ) : (
        <p className="public-help">{t('ui.public_projects.view_details_public_only')}</p>
      )}
    </section>
  );
}

function ViewRanking({ publicId, items }: { publicId: string; items: PublicViewRankingItem[] }) {
  const heading = useId();
  const publicPath = `/p/${encodeURIComponent(publicId)}`;
  return (
    <section className="publication-view-ranking" aria-labelledby={heading}>
      <h2 id={heading}>{t('ui.public_projects.top_details')}</h2>
      {items.length ? (
        <ol>
          {items.map((item) => (
            <li key={`${item.kind}/${item.id}`}>
              <div className="public-count-row">
                <div>
                  <span className="public-help">{t(publicViewLabels[item.kind])}</span>
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
      ) : (
        <p className="public-help">{t('ui.public_projects.no_ranked_details')}</p>
      )}
    </section>
  );
}

function ViewItems({ publicId }: { publicId: string }) {
  const [kind, setKind] = useState<Kind>('stocks');
  const [page, setPage] = useState(1);
  const publicPath = `/p/${encodeURIComponent(publicId)}`;
  const { data, error, reload } = useResource<PublicList<Item>>(
    `/api/public/projects/${encodeURIComponent(publicId)}/${kind}?sort=views&page=${page}`,
  );
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
              setPage(1);
            }}
          >
            {t(kindLabels[itemKind])}
          </button>
        ))}
      </div>
      {!data ? (
        <ResourceState error={error} retry={reload} />
      ) : data.items.length ? (
        <ul className="publication-view-rows">
          {data.items.map((item) => (
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
      {data && <Pagination page={page} hasMore={data.has_more} onChange={setPage} />}
    </>
  );
}
