import { intlLocale } from '../i18n/i18n';

export const date = (value: string) =>
  new Intl.DateTimeFormat(intlLocale(), {
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(value));

export const fullDate = (value: string) =>
  new Intl.DateTimeFormat(intlLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(value));
