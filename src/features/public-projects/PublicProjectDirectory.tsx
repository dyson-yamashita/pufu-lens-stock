import { ArrowRight, CircleHelp, Globe, Layers, Network } from 'lucide-react';
import { useState } from 'react';
import type { PublicList, PublicProject } from '../../../shared/public-project';
import { t, useLanguage } from '../../i18n/i18n';
import { initialPublicPage } from './public-routing';
import { Pagination } from './PublicLayout';
import { ResourceState } from './ResourceState';
import { useResource } from './useResource';

export function PublicProjectDirectory() {
  useLanguage();
  const [page, setPage] = useState(initialPublicPage);
  const { data, error, reload } = useResource<PublicList<PublicProject>>(
    `/api/public/projects?page=${page}`,
  );
  return (
    <section
      id="public-projects"
      className="public-directory"
      aria-labelledby="public-directory-heading"
    >
      <div className="public-section-heading">
        <h2 id="public-directory-heading">{t('ui.public_projects.public_projects')}</h2>
      </div>
      <p className="public-lead">
        {t('ui.public_projects.discover_your_next_idea_through_someone_else_s_interests')}
      </p>
      {!data ? (
        <ResourceState error={error} retry={reload} />
      ) : (
        <>
          <div className="public-project-grid">
            {data.items.map((project) => (
              <a
                className="public-project-card"
                key={project.public_id}
                href={`/p/${encodeURIComponent(project.public_id)}`}
              >
                <div className="public-project-card-top">
                  <span className="public-badge">
                    <Globe size={13} aria-hidden="true" />
                    {t('ui.public_projects.public')}
                  </span>
                  <ArrowRight size={18} aria-hidden="true" />
                </div>
                <h3 title={project.name}>{project.name}</h3>
                <p>
                  {project.public_description ||
                    t(
                      'ui.public_projects.sharing_collected_stocks_and_the_questions_and_insights_they',
                    )}
                </p>
                <div className="public-card-footer">
                  <span>
                    <Layers size={16} aria-hidden="true" />
                    {project.stock_count}
                    {t('ui.public_projects.stocks')}
                  </span>
                  <span>
                    <CircleHelp size={16} aria-hidden="true" />
                    {project.question_count}
                    {t('ui.public_projects.questions_insights')}
                  </span>
                  <span>
                    <Network size={16} aria-hidden="true" />
                    {project.pufu_count}
                    {t('ui.public_projects.pufus')}
                  </span>
                </div>
              </a>
            ))}
          </div>
          {data.items.length === 0 && (
            <p className="public-message">{t('ui.public_projects.no_public_projects_yet')}</p>
          )}
          <Pagination page={page} hasMore={data.has_more} onChange={setPage} />
        </>
      )}
    </section>
  );
}
