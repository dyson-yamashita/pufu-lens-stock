import { useEffect, useState, type ReactNode } from 'react';
import type { User } from '../shared/domain';
import { api } from './api';
import { applyAccountLanguage, initializeLanguage, useLanguage } from './i18n';
import { BootMessage } from './BootMessage';

// Direct manual/public routes honor the account without requiring sign-in to read them.
export default function PageLanguage({ children }: { children?: ReactNode }) {
  useState(initializeLanguage);
  useLanguage();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    // A slow identity service must not make otherwise public content unavailable.
    const timeout = window.setTimeout(() => {
      controller.abort();
      setReady(true);
    }, 5000);
    api<{ user: User }>('/api/v1/me', { signal: controller.signal })
      .then(({ user }) => {
        if (!controller.signal.aborted) applyAccountLanguage(user);
      })
      .catch(() => {
        // Browser/local language remains usable when signed out, offline, or during an outage.
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (!controller.signal.aborted) setReady(true);
      });
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);
  return ready ? (
    <>{children}</>
  ) : (
    <div className="boot">
      <BootMessage />
    </div>
  );
}
