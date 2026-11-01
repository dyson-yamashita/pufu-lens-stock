import { translateUi } from './i18n';
import { homePath, legalPath, manualPath } from '../shared/site-paths';
import type { Language } from '../shared/locale';

/** Crawlable marketing shell for `/` and `/en`. React App replaces this after JS loads. */
export default function HomeShell({ language }: { language: Language }) {
  const tr = (key: string) => translateUi(language, key);
  const headline = `${tr('ui.app.turn_collected_knowledge')}${tr('ui.app.into_connected')}${tr('ui.app.memory_2')}${tr('ui.app.separator')}`;
  return (
    <div className="public-page">
      <header className="public-header">
        <a href={homePath(language)} className="brand">
          <img className="brand-mark" src="/pufu-lens-logo.png" alt="" width="38" height="38" />
          <span>Pufu Lens</span>
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
        <h1>{headline}</h1>
        <p>
          {tr('ui.app.save_interesting_articles_to_projects')}{' '}
          {tr('ui.app.connect_their_key_points_with_your_interests')}{' '}
          {tr('ui.app.and_grow_them_into_a_shared_memory')}
        </p>
        <p>{tr('site.description')}</p>
        <nav className="legal-links" aria-label={tr('ui.legal_links.policies_and_terms')}>
          <a href={legalPath('privacy', language)}>{tr('ui.legal_links.privacy_policy')}</a>
          <a href={legalPath('terms', language)}>{tr('ui.legal_links.terms_of_service')}</a>
        </nav>
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
