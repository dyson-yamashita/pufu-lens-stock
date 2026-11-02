import { useEffect, useState, type ReactNode } from 'react';
import type { User } from '../shared/domain';
import { api } from './api';
import { applyAccountLanguage, initializeLanguage, useLanguage } from './i18n';

// Public routes can honor the account or follow this browser without requiring sign-in.
// Never block the first paint on identity lookup — a late /me response must not wipe SSR
// content or force a boot flash that expands public-main after paint (CLS).
export default function PageLanguage({
  children,
  browserOnly = false,
}: {
  children?: ReactNode;
  browserOnly?: boolean;
}) {
  useState(initializeLanguage);
  useLanguage();
  useEffect(() => {
    if (browserOnly) return;
    const controller = new AbortController();
    // A slow identity service must not make otherwise public content unavailable.
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    api<{ user: User }>('/api/v1/me', { signal: controller.signal })
      .then(({ user }) => {
        if (!controller.signal.aborted) applyAccountLanguage(user);
      })
      .catch(() => {
        // Browser/local language remains usable when signed out, offline, or during an outage.
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [browserOnly]);
  return <>{children}</>;
}
