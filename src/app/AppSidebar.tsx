import {
  Bell,
  BookOpen,
  CircleHelp,
  Layers,
  LogOut,
  Network,
  Plug,
  Plus,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { Config, Project, User } from '../../shared/domain';
import { Brand } from '../components/Brand';
import { applicationError, manualHref, t } from '../i18n/i18n';
import { send } from '../lib/api';
import type { Route } from './navigation';
import type { ModalState } from './types';

type Props = {
  projects: Project[];
  mobileNav: boolean;
  sidebarOpen: boolean;
  isMobile: boolean;
  setMobileNav: Dispatch<SetStateAction<boolean>>;
  setDesktopNavCollapsed: Dispatch<SetStateAction<boolean>>;
  route: Route;
  filterProject: (projectId: string | null) => void;
  navigate: (
    view:
      | 'memory'
      | 'stocks'
      | 'stock'
      | 'shortcuts'
      | 'mcp'
      | 'sns'
      | 'announcements'
      | 'profile'
      | 'questions'
      | 'pufus'
      | 'settings'
      | 'question'
      | 'resolve'
      | 'pufu',
    projectId?: string | null,
  ) => void;
  allQuestionsActive: boolean;
  allPufusActive: boolean;
  setModal: Dispatch<SetStateAction<ModalState>>;
  integrationTab: 'shortcuts' | 'mcp' | 'sns' | null;
  user: User;
  config: Config;
  setUser: Dispatch<SetStateAction<User | null | undefined>>;
  setError: Dispatch<SetStateAction<string>>;
};
export function AppSidebar({
  projects,
  mobileNav,
  sidebarOpen,
  isMobile,
  setMobileNav,
  setDesktopNavCollapsed,
  route,
  filterProject,
  navigate,
  allQuestionsActive,
  allPufusActive,
  setModal,
  integrationTab,
  user,
  config,
  setUser,
  setError,
}: Props) {
  const listedProjects = projects.filter((project) => project.show_in_all_lists !== false);
  const allCount = listedProjects.reduce((count, project) => count + project.count, 0);
  const allQuestionCount = listedProjects.reduce(
    (count, project) => count + project.question_count,
    0,
  );
  const allPufuCount = listedProjects.reduce((count, project) => count + project.pufu_count, 0);
  return (
    <>
      <aside className={`sidebar ${mobileNav ? 'nav-open' : ''}`} id="sidebar" inert={!sidebarOpen}>
        <Brand />
        <button
          id="sidebar-close"
          className="icon-button sidebar-close"
          aria-label={t('ui.app.close_menu')}
          onClick={() => {
            if (isMobile) setMobileNav(false);
            else {
              setDesktopNavCollapsed(true);
              window.requestAnimationFrame(() =>
                document.getElementById('sidebar-toggle')?.focus(),
              );
            }
          }}
        >
          <X size={19} aria-hidden="true" />
        </button>
        <nav aria-label={t('ui.app.main_navigation')}>
          <button
            className={`nav-item ${route.view === 'stocks' && !route.projectId ? 'active' : ''}`}
            aria-current={route.view === 'stocks' && !route.projectId ? 'page' : undefined}
            onClick={() => {
              filterProject(null);
              navigate('stocks');
            }}
          >
            <Layers size={19} aria-hidden="true" />
            {t('ui.app.all_stocks')}
            <span className="nav-count">{allCount}</span>
          </button>
          <button
            className={`nav-item ${allQuestionsActive ? 'active' : ''}`}
            aria-current={allQuestionsActive ? 'page' : undefined}
            onClick={() => {
              filterProject(null);
              navigate('questions');
            }}
          >
            <CircleHelp size={19} aria-hidden="true" />
            {t('ui.app.all_questions_insights')}
            <span className="nav-count">{allQuestionCount}</span>
          </button>
          <button
            className={`nav-item ${allPufusActive ? 'active' : ''}`}
            aria-current={allPufusActive ? 'page' : undefined}
            onClick={() => {
              filterProject(null);
              navigate('pufus');
            }}
          >
            <Network className="pufu-icon" size={19} aria-hidden="true" />
            {t('ui.app.all_pufu')}
            <span className="nav-count">{allPufuCount}</span>
          </button>
          <button
            className={`nav-item ${route.view === 'memory' && !route.projectId ? 'active' : ''}`}
            onClick={() => navigate('memory')}
          >
            <Sparkles size={19} aria-hidden="true" />
            {t('ui.app.your_memory')}
          </button>
          <div className="nav-section">
            <span>{t('ui.app.projects')}</span>
            <button
              className="icon-button small"
              aria-label={t('ui.app.create_project')}
              onClick={() => {
                setModal({ type: 'project' });
                setMobileNav(false);
              }}
            >
              <Plus size={17} />
            </button>
          </div>
          {projects.map((project, index) => (
            <button
              key={project.id}
              className={`nav-item project-nav ${route.projectId === project.id ? 'active' : ''}`}
              onClick={() => navigate('stocks', project.id)}
            >
              <span className={`project-dot tone-${index % 4}`} />
              <span className="truncate">{project.name}</span>
              <span className="nav-count">{project.count}</span>
            </button>
          ))}
          {!projects.length && (
            <p className="sidebar-empty">
              {t('ui.app.create_your')}
              <br />
              {t('ui.app.first_project')}
            </p>
          )}
          <button className="new-project" onClick={() => setModal({ type: 'project' })}>
            <Plus size={17} aria-hidden="true" />
            {t('ui.app.add_project')}
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${route.view === 'profile' ? 'active' : ''}`}
            aria-current={route.view === 'profile' ? 'page' : undefined}
            onClick={() => navigate('profile')}
          >
            <UserRound size={18} aria-hidden="true" />
            {t('ui.app.profile')}
          </button>
          <button
            className={`nav-item ${route.view === 'announcements' ? 'active' : ''}`}
            aria-current={route.view === 'announcements' ? 'page' : undefined}
            onClick={() => navigate('announcements')}
          >
            <Bell size={18} aria-hidden="true" />
            {t('announcements.title')}
          </button>
          <a
            className="nav-item"
            href={manualHref()}
            target="_blank"
            rel="noreferrer"
            aria-label={t('ui.app.user_manual_opens_in_a_new_tab')}
          >
            <BookOpen size={18} aria-hidden="true" />
            {t('ui.app.user_manual')}
          </a>
          <button
            className={`nav-item ${integrationTab ? 'active' : ''}`}
            aria-current={integrationTab ? 'page' : undefined}
            onClick={() => navigate('shortcuts')}
          >
            <Plug size={18} aria-hidden="true" />
            {t('ui.app.integrations')}
          </button>
          <div className="user-row">
            <div className="avatar">{user.name.slice(0, 1)}</div>
            <div className="user-info">
              <strong>{user.name}</strong>
              {config.demo && <span>{t('ui.app.local_demo')}</span>}
            </div>
            <button
              className="icon-button"
              aria-label={t('ui.app.sign_out')}
              onClick={async () => {
                try {
                  await send('/api/v1/logout');
                  setUser(null);
                } catch (e) {
                  setError(applicationError((e as Error).message));
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
