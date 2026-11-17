import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { publicHref, publicPathPattern } from '../shared/public-route';
import HomeEntry from './features/auth/HomeEntry';
import PageLoadError from './components/PageLoadError';
import { initializeLanguage } from './i18n/i18n';
import PageLanguage from './i18n/PageLanguage';
import './styles/public.css';

const publicRoute = publicPathPattern.exec(window.location.pathname);
if (publicRoute && window.location.hash) {
  const next = publicHref(`/p/${publicRoute[1]}`, window.location.hash);
  window.history.replaceState(null, '', next);
}
const legalRoute = /^\/(?:(en)\/)?(privacy|terms)\/?$/.exec(window.location.pathname);
const faqRoute = /^\/(?:(en)\/)?faq\/?$/.exec(window.location.pathname);
const manualRoute = /^\/(?:(en)\/)?manual\/?$/.exec(window.location.pathname);

// Keep the crawlable HTML visible until the selected route AND its CSS are ready.
async function start() {
  let page;
  if (legalRoute || faqRoute || manualRoute || publicRoute) {
    await import('./styles/styles.css');
    if (legalRoute) {
      const { default: LegalPage } = await import('./features/legal/LegalPage');
      page = (
        <LegalPage
          page={legalRoute[2] as 'privacy' | 'terms'}
          language={legalRoute[1] === 'en' ? 'en' : 'ja'}
        />
      );
    } else if (faqRoute) {
      const { default: FaqPage } = await import('./features/faq/FaqPage');
      page = (
        <PageLanguage browserOnly>
          <FaqPage language={faqRoute[1] === 'en' ? 'en' : 'ja'} />
        </PageLanguage>
      );
    } else if (manualRoute) {
      const { default: UserManual } = await import('./features/manual/UserManual');
      page = (
        <PageLanguage browserOnly>
          <UserManual language={manualRoute[1] === 'en' ? 'en' : 'ja'} />
        </PageLanguage>
      );
    } else if (publicRoute) {
      const { default: PublicProjectPage } =
        await import('./features/public-projects/PublicProjectPage');
      page = (
        <PageLanguage>
          <PublicProjectPage publicId={publicRoute[1]} />
        </PageLanguage>
      );
    }
  } else {
    page = <HomeEntry />;
  }
  createRoot(document.getElementById('root')!).render(<StrictMode>{page}</StrictMode>);
}
void start().catch(() => {
  initializeLanguage();
  createRoot(document.getElementById('root')!).render(<PageLoadError />);
});
