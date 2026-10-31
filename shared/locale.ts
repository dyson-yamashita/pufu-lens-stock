import { z } from 'zod';
import { ja } from './locales/ja';
import { en } from './locales/en';

export const languages = {
  ja: {
    name: '日本語',
    intlLocale: 'ja-JP',
    direction: 'ltr',
    generationInstruction: '必ず日本語で回答します。',
    editorLanguage: 'ja',
  },
  en: {
    name: 'English',
    intlLocale: 'en-US',
    direction: 'ltr',
    generationInstruction:
      'Always write generated prose in English, regardless of the source language.',
    editorLanguage: 'en',
  },
} as const;
export type Language = keyof typeof languages;
export const defaultLanguage: Language = 'ja';
export const fallbackLanguage: Language = 'en';
export const languageSchema = z.enum(Object.keys(languages) as [Language, ...Language[]]);

export function resolveLanguage(value: unknown, fallback: Language = defaultLanguage): Language {
  return typeof value === 'string' && Object.hasOwn(languages, value)
    ? (value as Language)
    : fallback;
}

// Only the browser's primary preference is considered. Other supported browser
// languages must not override a primary language the application cannot display.
export function browserLanguage(value: unknown): Language {
  if (typeof value !== 'string') return fallbackLanguage;
  let candidate = value.toLowerCase();
  while (candidate) {
    const supported = Object.keys(languages).find(
      (language) => language.toLowerCase() === candidate,
    );
    if (supported) return supported as Language;
    const separator = candidate.lastIndexOf('-');
    if (separator === -1) break;
    candidate = candidate.slice(0, separator);
  }
  return fallbackLanguage;
}

export const catalogs: Record<Language, Record<string, string>> = { ja, en };
export function translate(
  language: Language,
  message: string,
  values: Record<string, string | number> = {},
): string {
  const catalog = catalogs[language];
  const text = Object.hasOwn(catalog, message) ? catalog[message] : message;
  return text.replace(/\{\{(\w+)\}\}/g, (placeholder, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : placeholder,
  );
}
