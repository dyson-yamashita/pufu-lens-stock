import type { PublicList, PublicPufuSummary } from '../../../shared/public-project';
import { pufuDisplayTitle } from '../../../shared/pufu';
import { intlLocale, t, useLanguage } from '../../i18n/i18n';
import { publicLink } from './public-routing';
import { Pagination } from './PublicLayout';
import { PublicViewCount } from './PublicViewCount';
import { ResourceState } from './ResourceState';
import type { PublicListProps } from './types';
import { useResource } from './useResource';

export function PublicPufuList({ root, page, onPageChange }: PublicListProps) {
  useLanguage();
  const { data, error, reload } = useResource<PublicList<PublicPufuSummary>>(
    `${root}/pufus?page=${page}`,
  );
  return !data ? (
    <ResourceState error={error} retry={reload} />
  ) : (
    <>
      <div className="public-content-grid">
        {data.items.map((pufu) => (
          <a
            className="public-content-card public-pufu-card"
            key={pufu.id}
            href={publicLink(`#pufu/${encodeURIComponent(pufu.id)}?from=pufus`)}
          >
            <h3>{pufuDisplayTitle(pufu)}</h3>
            {pufu.title && pufu.latest_gaining_goal && (
              <p className="public-pufu-goal">{pufu.latest_gaining_goal}</p>
            )}
            <p className="public-help">
              {t('phase.number', { number: pufu.current_phase })}
              {t('ui.public_projects.separator')}
              {pufu.current_phase % 2 === 0 ? t('ui.public_projects.reflection') : t('ui.app.pufu')}
            </p>
            <div className="public-card-footer">
              <time>{new Date(pufu.updated_at).toLocaleDateString(intlLocale())}</time>
              <PublicViewCount count={pufu.view_count} />
            </div>
          </a>
        ))}
      </div>
      {!data.items.length && (
        <p className="public-message">
          {t('ui.public_projects.no_pufu_available_for_publication_yet')}
        </p>
      )}
      <Pagination page={page} hasMore={data.has_more} onChange={onPageChange} />
    </>
  );
}
