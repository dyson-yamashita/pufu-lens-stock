import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { publicHref, publicPathPattern } from '../shared/public-route';
import App from './app/App';
import FaqPage from './features/faq/FaqPage';
import LegalPage from './features/legal/LegalPage';
import UserManual from './features/manual/UserManual';
import PublicProjectPage from './features/public-projects';
import PageLanguage from './i18n/PageLanguage';
import './styles/styles.css';

const publicRoute = publicPathPattern.exec(window.location.pathname);
if (publicRoute && window.location.hash) {
  const next = publicHref(`/p/${publicRoute[1]}`, window.location.hash);
  window.history.replaceState(null, '', next);
}
const legalRoute = /^\/(?:(en)\/)?(privacy|terms)\/?$/.exec(window.location.pathname);
const faqRoute = /^\/(?:(en)\/)?faq\/?$/.exec(window.location.pathname);
const manualRoute = /^\/(?:(en)\/)?manual\/?$/.exec(window.location.pathname);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {legalRoute ? (
      <LegalPage
        page={legalRoute[2] as 'privacy' | 'terms'}
        language={legalRoute[1] === 'en' ? 'en' : 'ja'}
      />
    ) : faqRoute ? (
      <PageLanguage browserOnly>
        <FaqPage language={faqRoute[1] === 'en' ? 'en' : 'ja'} />
      </PageLanguage>
    ) : manualRoute ? (
      <PageLanguage browserOnly>
        <UserManual language={manualRoute[1] === 'en' ? 'en' : 'ja'} />
      </PageLanguage>
    ) : publicRoute ? (
      <PageLanguage>
        <PublicProjectPage publicId={publicRoute[1]} />
      </PageLanguage>
    ) : (
      <App />
    )}
  </StrictMode>,
);
