import { createInstance } from 'i18next';
import { useSyncExternalStore } from 'react';
import { browserLanguage, languages, resolveLanguage, type Language } from '../shared/locale';
import { ja } from './locales/ja';
import { en } from './locales/en';
import { errorKeys } from './locales/error-keys';

// Do not register initReactI18next: Pufu Editor owns the global React i18next instance.
const instance = createInstance();
const resources: Record<Language, { translation: Record<string, string> }> = {
  ja: { translation: ja },
  en: { translation: en },
};
void instance.init({
  lng: 'ja',
  fallbackLng: 'en',
  initImmediate: false,
  keySeparator: false,
  resources,
  interpolation: { escapeValue: false },
});
export const languagePreferenceKey = 'pufu-language';
type Store = { language: Language; listeners: Set<() => void> };
const stores = new WeakMap<Window, Store>();
const serverStore: Store = { language: 'ja', listeners: new Set() };
function store(): Store {
  if (typeof window === 'undefined') return serverStore;
  let current = stores.get(window);
  if (!current) {
    current = { language: 'ja', listeners: new Set() };
    stores.set(window, current);
  }
  return current;
}
export function initialLanguage(primaryLanguage: unknown, savedPreference: unknown): Language {
  return resolveLanguage(savedPreference, browserLanguage(primaryLanguage));
}
export function getLanguage(): Language {
  return store().language;
}
export function intlLocale(): string {
  return languages[getLanguage()].intlLocale;
}
export function legalHref(page: 'privacy' | 'terms', language = getLanguage()): string {
  return `${language === 'ja' ? '' : `/${language}`}/${page}`;
}
function updateDocument(language: Language) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language;
  document.documentElement.dir = languages[language].direction;
  document.title = translateUi(language, 'site.title');
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute('content', translateUi(language, 'site.description'));
}
export function initializeLanguage(): Language {
  let saved: unknown;
  try {
    saved = window.localStorage.getItem(languagePreferenceKey);
  } catch {
    /* Storage can be disabled. */
  }
  // Server rendering starts in Japanese; browser page entries resolve the primary preference.
  const primary = typeof window === 'undefined' ? 'ja' : (window.navigator?.language ?? 'ja');
  const language = initialLanguage(primary, saved);
  store().language = language;
  updateDocument(language);
  return language;
}
export function setLanguage(language: Language): void {
  const current = store();
  current.language = resolveLanguage(language);
  try {
    window.localStorage.setItem(languagePreferenceKey, current.language);
  } catch {
    /* Best effort for anonymous pages. */
  }
  updateDocument(current.language);
  for (const listener of current.listeners) listener();
}
export function applyAccountLanguage(
  user: { language?: Language; onboarding_completed_at?: string | null } | null,
): void {
  if (user?.onboarding_completed_at) setLanguage(resolveLanguage(user.language));
}
const subscribe = (listener: () => void) => {
  const current = store();
  current.listeners.add(listener);
  return () => {
    current.listeners.delete(listener);
  };
};
export function useLanguage(): { language: Language; setLanguage: typeof setLanguage } {
  const language = useSyncExternalStore(subscribe, getLanguage, () => 'ja' as Language);
  return { language, setLanguage };
}
export function t(message: string, values: Record<string, string | number> = {}): string {
  return translateUi(getLanguage(), message, values);
}

export function translateUi(
  language: Language,
  message: string,
  values: Record<string, string | number> = {},
): string {
  const localizedValues = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      typeof value === 'number'
        ? new Intl.NumberFormat(languages[language].intlLocale).format(value)
        : value,
    ]),
  );
  return instance.t(message, { lng: language, ...localizedValues });
}

// Restrict translation to known application errors; never apply this to article or user content.
export function applicationError(message: string | null | undefined): string {
  if (!message) return '';
  if (getLanguage() === 'ja') return message;
  const key = Object.hasOwn(errorKeys, message) ? errorKeys[message] : undefined;
  if (key) return t(key);
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(message) ? t('error.unknown') : message;
}
