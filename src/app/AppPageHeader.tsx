import {
  Bell,
  BookOpen,
  ChevronDown,
  CircleHelp,
  Eye,
  Layers,
  Network,
  Plug,
  Plus,
  Settings,
  Sparkles,
  UserRound,
} from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { Project } from '../../shared/domain';
import { ShareLink } from '../features/public-projects/ShareLink';
import { t } from '../i18n/i18n';
import { globalHeaderLabels, headerLabels } from './labels';
import type { Route } from './navigation';
import type { ModalState } from './types';

type Props = {
  selected: Project | undefined;
  route: Route;
  integrationTab: 'shortcuts' | 'mcp' | 'sns' | null;
  libraryView: boolean;
  libraryProjectId: string | null;
  filterProject: (projectId: string | null) => void;
  projects: Project[];
  setModal: Dispatch<SetStateAction<ModalState>>;
};
export function AppPageHeader({
  selected,
  route,
  integrationTab,
  libraryView,
  libraryProjectId,
  filterProject,
  projects,
  setModal,
}: Props) {
  const projectHeading =
    selected &&
    ['stocks', 'questions', 'pufus', 'memory', 'settings', 'public-views'].includes(route.view);
  const HeadingIcon =
    (
      {
        stocks: Layers,
        questions: CircleHelp,
        pufus: Network,
        memory: Sparkles,
        settings: Settings,
        'public-views': Eye,
        profile: UserRound,
        announcements: Bell,
        mcp: Plug,
        shortcuts: Plug,
        sns: Plug,
      } as Partial<Record<Route['view'], typeof Layers>>
    )[route.view] ?? BookOpen;
  const heading =
    route.view === 'settings'
      ? t('ui.app.project_settings')
      : (globalHeaderLabels()[route.view] ?? headerLabels()[route.view]);
  const stockAction = route.view === 'stocks' && (
    <button
      className="button primary"
      onClick={() => setModal(projects.length ? { type: 'save' } : { type: 'project' })}
    >
      <Plus size={18} aria-hidden="true" />
      {projects.length ? t('ui.app.save_article') : t('ui.app.create_project')}
    </button>
  );
  return (
    <>
      <header className="page-header">
        <div className="share-anchor">
          <h1
            className="section-heading"
            aria-label={
              projectHeading
                ? `${selected.name}${t('ui.app.project_heading_suffix', { value0: headerLabels()[route.view] })}`
                : undefined
            }
          >
            {!projectHeading && (
              <HeadingIcon
                className={
                  route.view === 'pufus' ? 'section-heading-icon pufu-icon' : 'section-heading-icon'
                }
                aria-hidden="true"
              />
            )}
            <span className="section-heading-text">
              {projectHeading ? (
                <>
                  <span>{selected.name}</span>
                  <span className="section-heading-suffix">
                    {t('ui.app.project_heading_suffix', {
                      value0: headerLabels()[route.view],
                    })}
                  </span>
                </>
              ) : (
                heading
              )}
            </span>
          </h1>
          {route.view !== 'profile' && route.view !== 'public-views' && (
            <p>
              {route.view === 'announcements'
                ? t('announcements.description')
                : route.view === 'questions'
                  ? t('ui.app.collect_questions_and_insights_from_everyday_life_and_saved')
                  : route.view === 'pufus'
                    ? t('ui.app.review_ideas_for_solutions_inspired_by_your_questions_and')
                    : route.view === 'settings'
                      ? t('ui.app.edit_this_project_s_settings')
                      : integrationTab
                        ? t('ui.app.integrations_description')
                        : route.view === 'memory'
                          ? t(
                              'ui.app.interests_and_knowledge_from_your_articles_gradually_updated_with',
                            )
                          : selected?.description ||
                            t('ui.app.keep_interesting_articles_and_new_ideas_together')}
            </p>
          )}
          {selected && ['stocks', 'questions', 'pufus'].includes(route.view) && (
            <ShareLink
              key={`${selected.id}/${route.view}`}
              source={{ projectId: selected.id }}
              target={{ kind: 'project' }}
            />
          )}
        </div>
        <div className="header-actions">
          {libraryView && (
            <div className="header-project-select">
              <label htmlFor="project-scope">{t('ui.app.projects')}</label>
              <div className="project-select-control">
                <select
                  id="project-scope"
                  value={libraryProjectId ?? ''}
                  onChange={(event) => filterProject(event.target.value || null)}
                >
                  <option value="">{t('ui.app.all_projects')}</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={16} aria-hidden="true" />
              </div>
            </div>
          )}
          {stockAction}
          {route.view === 'questions' && (
            <button
              className="button primary"
              onClick={() => setModal({ type: projects.length ? 'question' : 'project' })}
            >
              <Plus size={18} aria-hidden="true" />
              {projects.length ? t('ui.app.add_question_or_insight') : t('ui.app.create_project')}
            </button>
          )}
          {route.view === 'pufus' && (
            <button
              className="button primary"
              onClick={() => setModal({ type: 'pufu' })}
              disabled={!projects.length}
            >
              <Plus size={18} aria-hidden="true" />
              {t('ui.app.add_pufu')}
            </button>
          )}
        </div>
      </header>
    </>
  );
}
