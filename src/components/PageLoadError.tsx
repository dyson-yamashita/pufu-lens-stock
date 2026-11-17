import { t, useLanguage } from '../i18n/i18n';
import { Brand } from './Brand';

export default function PageLoadError() {
  useLanguage();
  return (
    <div className="boot">
      <Brand />
      <p role="alert">{t('ui.page_load_error.message')}</p>
      <button className="button secondary" onClick={() => window.location.reload()}>
        {t('ui.app.reload')}
      </button>
    </div>
  );
}
