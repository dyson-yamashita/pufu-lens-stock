import { lazy, Suspense, useState } from 'react';
import type { User } from '../../../shared/domain';
import { BootMessage } from '../../components/BootMessage';
import { Brand } from '../../components/Brand';
import PageLoadError from '../../components/PageLoadError';
import { applyAccountLanguage, initializeLanguage } from '../../i18n/i18n';
import { api, send } from '../../lib/api';
import { Login } from './Login';
import { useAppSession } from './useAppSession';

// Importing App also loads its CSS before React replaces the fallback.
const App = lazy(() => import('../../app/App').catch(() => ({ default: PageLoadError })));

export default function HomeEntry() {
  useState(initializeLanguage);
  const [error, setError] = useState('');
  const session = useAppSession(setError);
  const { config, user } = session;
  const boot = (
    <div className="boot">
      <Brand />
      {error ? <p role="status">{error}</p> : <BootMessage />}
    </div>
  );
  if (!config || user === undefined) return boot;
  if (!user)
    return (
      <Login
        config={config}
        onLogin={async () => {
          // App uses the same session; signing in never triggers a second identity lookup.
          await send('/api/auth/demo');
          const { user } = await api<{ user: User }>('/api/v1/me');
          applyAccountLanguage(user);
          session.setUser(user);
        }}
      />
    );
  return (
    <Suspense fallback={boot}>
      <App session={session} error={error} setError={setError} />
    </Suspense>
  );
}
