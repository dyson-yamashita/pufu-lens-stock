import { publicPathPattern } from '../../../shared/public-route';
import BrandLogo from '../../components/BrandLogo';
import { t, useLanguage } from '../../i18n/i18n';

export function PublicBrand() {
  useLanguage();
  return (
    <a href="/" className="brand">
      <BrandLogo />
    </a>
  );
}

export function Pagination({
  page,
  hasMore,
  totalPages,
  onChange,
}: {
  page: number;
  hasMore: boolean;
  totalPages?: number;
  onChange: (page: number) => void;
}) {
  useLanguage();
  if (page === 1 && !hasMore && totalPages === undefined) return null;
  const change = (next: number) => {
    const route = publicPathPattern.exec(window.location.pathname ?? '');
    if (route) {
      const url = new URL(window.location.href);
      if (next === 1) url.searchParams.delete('page');
      else url.searchParams.set('page', String(next));
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    onChange(next);
  };
  return (
    <nav className="public-pagination" aria-label={t('ui.public_projects.pagination')}>
      <button className="button secondary" disabled={page === 1} onClick={() => change(page - 1)}>
        {t('ui.app.previous')}
      </button>
      <span>
        {totalPages === undefined
          ? t('pagination.page', { page })
          : t('pagination.page_total', { page, total: totalPages })}
      </span>
      <button className="button secondary" disabled={!hasMore} onClick={() => change(page + 1)}>
        {t('ui.app.next')}
      </button>
    </nav>
  );
}
