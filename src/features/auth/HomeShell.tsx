import type { Language } from '../../../shared/locale';
import { homePath, manualPath } from '../../../shared/site-paths';
import BrandLogo from '../../components/BrandLogo';
import { translateUi } from '../../i18n/i18n';
import LegalLinks from '../legal/LegalLinks';
import HomeSections from './HomeSections';

/** Crawlable marketing shell for `/` and `/en`. React App replaces this after JS loads. */
export default function HomeShell({ language }: { language: Language }) {
  const tr = (key: string) => translateUi(language, key);
  return (
    <div className="public-page">
      <header className="public-header">
        <a href={homePath(language)} className="brand">
          <BrandLogo />
        </a>
        <nav className="legal-links" aria-label={language === 'en' ? 'Site links' : 'サイトリンク'}>
          <a href={manualPath(language)}>{tr('ui.app.manual')}</a>
          <a
            href={homePath(language === 'en' ? 'ja' : 'en')}
            lang={language === 'en' ? 'ja' : 'en'}
          >
            {language === 'en' ? '日本語' : 'English'}
          </a>
        </nav>
      </header>
      <main className="manual-main">
        <h1>{tr('home.headline')}</h1>
        <p>
          {tr('home.description_intro')}
          <br />
          {tr('home.description_body')}
        </p>
        <a href={manualPath(language)}>{tr('home.view_manual')}</a>
        <HomeSections language={language} />
        <LegalLinks language={language} />
        <noscript>
          {language === 'en'
            ? 'Enable JavaScript to sign in and use the app. '
            : 'アプリを利用するにはJavaScriptを有効にしてください。 '}
          <a href={manualPath(language)}>{tr('ui.app.user_manual')}</a>
        </noscript>
      </main>
    </div>
  );
}
