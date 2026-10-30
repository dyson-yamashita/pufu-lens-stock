import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import PublicProjectPage from './PublicProjects';
import UserManual from './UserManual';
import LegalPage from './LegalPage';
import PageLanguage from './PageLanguage';
import './styles.css';

const publicRoute = /^\/p\/([A-Za-z0-9_-]+)\/?$/.exec(window.location.pathname);
const legalRoute = /^\/(?:(en)\/)?(privacy|terms)\/?$/.exec(window.location.pathname);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {legalRoute ? (
      <LegalPage
        page={legalRoute[2] as 'privacy' | 'terms'}
        language={legalRoute[1] === 'en' ? 'en' : 'ja'}
      />
    ) : /^\/manual\/?$/.test(window.location.pathname) ? (
      <PageLanguage>
        <UserManual />
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
