import { t } from '../i18n/i18n';
import type { Route } from './navigation';

export const headerLabels = (): Record<Route['view'], string> => ({
  stocks: t('ui.app.stocks'),
  stock: t('ui.app.details'),
  questions: t('ui.app.questions_insights'),
  pufus: t('ui.app.pufu'),
  memory: t('ui.app.memory'),
  settings: t('ui.app.settings'),
  'public-views': t('ui.public_projects.view_details'),
  announcements: t('announcements.title'),
  profile: t('ui.app.profile'),
  mcp: t('ui.app.integrations'),
  shortcuts: t('ui.app.integrations'),
  sns: t('ui.app.integrations'),
  question: t('ui.app.details'),
  resolve: t('ui.app.create_pufu'),
  pufu: t('ui.app.details'),
});

export const globalHeaderLabels = (): Partial<Record<Route['view'], string>> => ({
  stocks: t('ui.app.all_stocks'),
  questions: t('ui.app.all_questions_insights'),
  pufus: t('ui.app.all_pufu'),
  memory: t('ui.app.your_memory'),
});
