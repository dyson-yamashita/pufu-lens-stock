import { t, useLanguage } from '../i18n/i18n';
import BrandLogo from './BrandLogo';

export function Brand() {
  useLanguage();
  return (
    <a className="brand" href="#" aria-label={t('ui.app.pufu_lens_home')}>
      <BrandLogo />
    </a>
  );
}
