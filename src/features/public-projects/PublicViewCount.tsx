import { Eye } from 'lucide-react';
import { intlLocale, t, useLanguage } from '../../i18n/i18n';

export function PublicViewCount({ count }: { count: number }) {
  useLanguage();
  const value = new Intl.NumberFormat(intlLocale()).format(count ?? 0);
  const label = t('ui.public_projects.view_count', { value });
  return (
    <span className="public-view-count" role="img" aria-label={label} title={label}>
      <Eye size={15} aria-hidden="true" />
      {value}
    </span>
  );
}
