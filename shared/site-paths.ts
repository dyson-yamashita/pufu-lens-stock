import type { Language } from './locale';

export type LegalPage = 'privacy' | 'terms';

/** Absolute site origin for crawlable markup. Prefer APP_URL when it is a real public host. */
export function siteOrigin(appUrl?: string | null): string {
  const raw = (appUrl ?? '').trim().replace(/\/$/, '');
  if (raw && !/localhost|127\.0\.0\.1|example\.invalid/i.test(raw)) return raw;
  return 'https://pufu-lens.dev';
}

export function homePath(language: Language): string {
  return language === 'en' ? '/en' : '/';
}

export function manualPath(language: Language): string {
  return language === 'en' ? '/en/manual' : '/manual';
}

export function legalPath(page: LegalPage, language: Language): string {
  return language === 'en' ? `/en/${page}` : `/${page}`;
}

export function absoluteUrl(path: string, origin?: string | null): string {
  const root = siteOrigin(origin);
  if (!path || path === '/') return `${root}/`;
  return new URL(path.startsWith('/') ? path : `/${path}`, `${root}/`).href;
}

/** Language forced by a public documentation / marketing URL. Null for app or /p routes. */
export function pathLanguage(pathname: string): Language | null {
  if (/^\/en(?:\/|$)/.test(pathname)) return 'en';
  if (pathname === '/' || /^\/(?:manual|privacy|terms)\/?$/.test(pathname) || pathname === '') {
    return 'ja';
  }
  return null;
}
