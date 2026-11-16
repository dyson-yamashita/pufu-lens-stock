import { t, useLanguage } from '../../i18n/i18n';

function PublicContentSkeleton({ announce = true }: { announce?: boolean } = {}) {
  useLanguage();
  return (
    <div
      className="public-content-skeleton"
      {...(announce
        ? {
            role: 'status' as const,
            'aria-busy': true,
            'aria-label': t('ui.public_projects.loading'),
          }
        : { 'aria-hidden': true })}
    >
      <div className="public-skeleton-card" />
      <div className="public-skeleton-card" />
      <div className="public-skeleton-card" />
      <div className="public-skeleton-card" />
    </div>
  );
}

export function PublicPageSkeleton() {
  useLanguage();
  return (
    <div
      className="public-page-skeleton"
      role="status"
      aria-busy="true"
      aria-label={t('ui.public_projects.loading')}
    >
      <div className="public-skeleton-badge" />
      <div className="public-skeleton-title" />
      <div className="public-skeleton-tabs" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <PublicContentSkeleton announce={false} />
    </div>
  );
}

export function PublicPufuScoreSkeleton() {
  useLanguage();
  return (
    <div
      className="public-pufu-score-skeleton"
      role="status"
      aria-busy="true"
      aria-label={t('ui.public_projects.loading')}
    />
  );
}

export function ResourceState({ error, retry }: { error?: string; retry: () => void }) {
  useLanguage();
  return error ? (
    <div role="alert" className="public-message">
      <p>{error}</p>
      <button className="button secondary" onClick={retry}>
        {t('ui.app.reload')}
      </button>
    </div>
  ) : (
    <PublicContentSkeleton />
  );
}
