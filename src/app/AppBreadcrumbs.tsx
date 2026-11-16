import { Menu } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { Project } from '../../shared/domain';
import { BrandMark } from '../components/BrandLogo';
import ScrollHeader from '../components/ScrollHeader';
import { t } from '../i18n/i18n';
import { globalHeaderLabels, headerLabels } from './labels';
import type { QuestionListContext, Route, StockOrigin } from './navigation';

type Props = {
  projects: Project[];
  questionListContext: QuestionListContext;
  stockFlow: boolean;
  route: Route;
  listLabel: string;
  stockOrigin: StockOrigin;
  questionFlow: boolean;
  isMobile: boolean;
  sidebarOpen: boolean;
  setMobileNav: Dispatch<SetStateAction<boolean>>;
  setDesktopNavCollapsed: Dispatch<SetStateAction<boolean>>;
  detailFlow: boolean;
};
export function AppBreadcrumbs({
  projects,
  questionListContext,
  stockFlow,
  route,
  listLabel,
  stockOrigin,
  questionFlow,
  isMobile,
  sidebarOpen,
  setMobileNav,
  setDesktopNavCollapsed,
  detailFlow,
}: Props) {
  const questionListProject = projects.find(
    (project) => project.id === questionListContext.projectId,
  );
  const breadcrumbListLabel = stockFlow
    ? t('ui.app.stocks')
    : route.view === 'pufu'
      ? t('ui.app.pufu')
      : listLabel;
  const breadcrumbListHash = stockFlow
    ? stockOrigin.projectId
      ? `#project/${encodeURIComponent(stockOrigin.projectId)}`
      : '#'
    : route.view === 'pufu'
      ? `#pufus${questionListContext.projectId ? `/${encodeURIComponent(questionListContext.projectId)}` : ''}`
      : questionListContext.hash;
  const breadcrumbProject = stockFlow
    ? projects.find((project) => project.id === stockOrigin.projectId)
    : questionListProject;
  const breadcrumbListHeading = breadcrumbProject
    ? t('ui.app.value_in_value', { value0: breadcrumbProject.name, value1: breadcrumbListLabel })
    : t('ui.app.all_value', { value0: breadcrumbListLabel });
  const headerProjectId = stockFlow
    ? stockOrigin.projectId
    : questionFlow
      ? questionListContext.projectId
      : route.projectId;
  const headerProject = projects.find((project) => project.id === headerProjectId);
  const headerLabel = headerProjectId
    ? headerLabels()[route.view]
    : (globalHeaderLabels()[route.view] ?? headerLabels()[route.view]);
  return (
    <>
      <ScrollHeader autoHide={isMobile}>
        {!sidebarOpen && (
          <button
            id="sidebar-toggle"
            className="icon-button sidebar-toggle"
            aria-label={t('ui.app.open_menu')}
            aria-controls="sidebar"
            aria-expanded={false}
            onClick={() => {
              if (isMobile) setMobileNav(true);
              else {
                setDesktopNavCollapsed(false);
                window.requestAnimationFrame(() =>
                  document.getElementById('sidebar-close')?.focus(),
                );
              }
            }}
          >
            <Menu size={22} aria-hidden="true" />
          </button>
        )}
        <nav className="breadcrumb" aria-label={t('ui.app.breadcrumbs')}>
          <a href="#" aria-label={t('ui.app.home')}>
            {!sidebarOpen && <BrandMark />}
            {t('ui.app.home')}
          </a>{' '}
          <span aria-hidden="true">/</span>{' '}
          {headerProjectId && (
            <>
              <a
                className="breadcrumb-project"
                href={`#project/${encodeURIComponent(headerProjectId)}`}
                title={headerProject?.name ?? t('ui.app.projects')}
              >
                <span className="breadcrumb-project-name">
                  {headerProject?.name ?? t('ui.app.projects')}
                </span>
              </a>{' '}
              <span aria-hidden="true">/</span>{' '}
            </>
          )}
          {detailFlow ? (
            <>
              <a href={breadcrumbListHash} title={breadcrumbListHeading}>
                {headerProjectId
                  ? breadcrumbListLabel
                  : t('ui.app.all_value', { value0: breadcrumbListLabel })}
              </a>{' '}
              <span aria-hidden="true">/</span>{' '}
              <a href={`#${route.view}/${encodeURIComponent(route.detailId!)}`} aria-current="page">
                {headerLabel}
              </a>
            </>
          ) : (
            <a href={window.location.hash || '#'} aria-current="page">
              {headerLabel}
            </a>
          )}
        </nav>
      </ScrollHeader>
    </>
  );
}
