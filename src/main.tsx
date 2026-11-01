import { publicPathPattern, publicHref } from '../shared/public-route';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import PublicProjectPage from './PublicProjects';
import UserManual from './UserManual';
import LegalPage from './LegalPage';
import PageLanguage from './PageLanguage';
import './styles.css';

const publicRoute = publicPathPattern.exec(window.location.pathname);
if (publicRoute && window.location.hash) {
  const next = publicHref(`/p/${publicRoute[1]}`, window.location.hash);
  window.history.replaceState(null, '', next);
}
const legalRoute = /^\/(?:(en)\/)?(privacy|terms)\/?$/.exec(window.location.pathname);
const manualRoute = /^\/(?:(en)\/)?manual\/?$/.exec(window.location.pathname);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {legalRoute ? (
      <LegalPage
        page={legalRoute[2] as 'privacy' | 'terms'}
        language={legalRoute[1] === 'en' ? 'en' : 'ja'}
      />
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
