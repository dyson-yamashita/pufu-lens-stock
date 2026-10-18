import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import PublicProjectPage from './PublicProjects';
import UserManual from './UserManual';
import './styles.css';

const publicRoute = /^\/p\/([A-Za-z0-9_-]+)\/?$/.exec(window.location.pathname);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/^\/manual\/?$/.test(window.location.pathname) ? (
      <UserManual />
    ) : publicRoute ? (
      <PublicProjectPage publicId={publicRoute[1]} />
    ) : (
      <App />
    )}
  </StrictMode>,
);
