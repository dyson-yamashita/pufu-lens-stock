import { useState } from 'react';
import App from '../src/app/App';
import { useAppSession } from '../src/features/auth/useAppSession';
import { initializeLanguage } from '../src/i18n/i18n';

// Exercise App synchronously in the DOM fixtures. Browser E2E covers HomeEntry's
// real module/CSS loading; the session owner and language initialization match it.
export default function AppRoot() {
  useState(initializeLanguage);
  const [error, setError] = useState('');
  const session = useAppSession(setError);
  return <App session={session} error={error} setError={setError} />;
}
