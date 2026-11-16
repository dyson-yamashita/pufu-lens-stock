import { t } from '../../i18n/i18n';

export const statusLabels = () => ({
  queued: t('ui.app.queued'),
  extracting: t('ui.app.retrieving_article'),
  summarizing: t('ui.app.generating_summary'),
  ready: t('ui.app.summarized'),
  failed: t('ui.app.retrieval_failed'),
});
