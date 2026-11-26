import { CircleHelp, Layers, Network, Settings, Sparkles } from 'lucide-react';
import { t } from '../i18n/i18n';
import type { Route } from './navigation';

type Props = {
  route: Route;
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
};
export function AppLibraryTabs({ route, navigate }: Props) {
  return (
    <>
      <div
        className={`detail-tabs library-tabs${route.projectId ? ' project-tabs' : ''}`}
        aria-label={route.projectId ? t('ui.app.project_views') : t('ui.app.library_views')}
      >
        <button
          className={route.view === 'stocks' ? 'active' : ''}
          aria-pressed={route.view === 'stocks'}
          onClick={() => navigate('stocks', route.projectId)}
        >
          <Layers size={16} aria-hidden="true" />
          {t('ui.app.stocks')}
        </button>
        <button
          className={route.view === 'questions' ? 'active' : ''}
          aria-pressed={route.view === 'questions'}
          onClick={() => navigate('questions', route.projectId)}
        >
          <CircleHelp size={16} aria-hidden="true" />
          {t('ui.app.questions_insights')}
        </button>
        <button
          className={route.view === 'pufus' ? 'active' : ''}
          aria-pressed={route.view === 'pufus'}
          onClick={() => navigate('pufus', route.projectId)}
        >
          <Network className="pufu-icon" size={16} aria-hidden="true" />
          {t('ui.app.pufu')}
        </button>
        <button
          className={route.view === 'memory' ? 'active' : ''}
          aria-pressed={route.view === 'memory'}
          onClick={() => navigate('memory', route.projectId)}
        >
          <Sparkles size={16} aria-hidden="true" />
          {t(route.projectId ? 'ui.app.memory_footprints' : 'ui.app.memory')}
        </button>
        {route.projectId && (
          <button
            className={route.view === 'settings' ? 'active' : ''}
            aria-pressed={route.view === 'settings'}
            onClick={() => navigate('settings', route.projectId)}
          >
            <Settings size={16} aria-hidden="true" />
            {t('ui.app.settings')}
          </button>
        )}
      </div>
    </>
  );
}
