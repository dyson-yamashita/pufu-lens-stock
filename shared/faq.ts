import type { Language } from './locale';
import { faqEn } from './locales/faq-en';
import { faqJa } from './locales/faq-ja';

export type FaqLink = { text: string; href: string };
export type FaqEntry = {
  id: string;
  question: string;
  answer: string | readonly (string | FaqLink)[];
};
export type FaqCategory = { id: string; title: string; entries: readonly FaqEntry[] };

export function faqCategories(language: Language): readonly FaqCategory[] {
  return language === 'en' ? faqEn : faqJa;
}

export function faqAnswerText(answer: FaqEntry['answer']): string {
  return typeof answer === 'string'
    ? answer
    : answer.map((part) => (typeof part === 'string' ? part : part.text)).join('');
}

const normalize = (value: string) => value.normalize('NFKC').toLowerCase();

/** Local keyword search only; the query is never sent to a server or interpreted as a regex. */
export function searchFaq(categories: readonly FaqCategory[], query: string): FaqCategory[] {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  return categories
    .map((category) => ({
      ...category,
      entries: category.entries.filter((entry) => {
        const text = normalize(
          `${category.title} ${entry.question} ${faqAnswerText(entry.answer)}`,
        );
        return words.every((word) => text.includes(word));
      }),
    }))
    .filter((category) => category.entries.length > 0);
}
