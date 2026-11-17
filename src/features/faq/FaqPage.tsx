import { ArrowUp, BookOpen, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { faqCategories, searchFaq } from '../../../shared/faq';
import type { Language } from '../../../shared/locale';
import { faqPath } from '../../../shared/site-paths';
import BrandLogo from '../../components/BrandLogo';
import { homeHref, manualHref, translateUi } from '../../i18n/i18n';
import LegalLinks from '../legal/LegalLinks';

export default function FaqPage({ language }: { language: Language }) {
  const tr = (key: string, values?: Record<string, string | number>) =>
    translateUi(language, key, values);
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const searching = query.trim().length > 0;
  const categories = searchFaq(faqCategories(language), query);
  const count = categories.reduce((total, category) => total + category.entries.length, 0);
  useEffect(() => {
    document.title = `${translateUi(language, 'faq.title')} | Pufu Lens`;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', translateUi(language, 'faq.description'));
    document.documentElement.lang = language;
    document.documentElement.dir = 'ltr';
  }, [language]);
  return (
    <div className="public-page faq-page" lang={language}>
      <header className="public-header">
        <a href={homeHref(language)} className="brand">
          <BrandLogo />
        </a>
        <a href={homeHref(language)} className="text-link">
          {tr('ui.user_manual.back_to_home')}
        </a>
      </header>
      <main className="manual-main faq-main">
        <header className="page-header" id="faq-start" tabIndex={-1}>
          <div>
            <h1>{tr('faq.title')}</h1>
            <p>{tr('faq.description')}</p>
            <nav className="legal-links" aria-label={tr('language.label')}>
              {(['ja', 'en'] as const).map((locale) => (
                <a
                  key={locale}
                  href={faqPath(locale)}
                  lang={locale}
                  aria-current={locale === language ? 'page' : undefined}
                >
                  {locale === 'ja' ? '日本語' : 'English'}
                </a>
              ))}
            </nav>
          </div>
        </header>
        <form
          className="faq-search"
          role="search"
          aria-label={tr('faq.search_label')}
          onSubmit={(event) => event.preventDefault()}
        >
          <label htmlFor="faq-search">{tr('faq.search_label')}</label>
          <div className="search-field">
            <Search size={18} aria-hidden="true" />
            <input
              id="faq-search"
              ref={input}
              type="search"
              value={query}
              maxLength={200}
              placeholder={tr('faq.search_placeholder')}
              aria-describedby="faq-search-hint"
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button
                type="button"
                className="icon-button"
                aria-label={tr('ui.search_field.clear_search')}
                onClick={() => {
                  setQuery('');
                  input.current?.focus();
                }}
              >
                <X size={18} aria-hidden="true" />
              </button>
            )}
          </div>
          <p id="faq-search-hint" className="faq-search-hint">
            {tr('faq.search_hint')}
          </p>
          <noscript>
            <p>{tr('faq.no_script')}</p>
          </noscript>
        </form>
        <p className="faq-count" role="status" aria-live="polite" aria-atomic="true">
          {tr('faq.results', { value0: count })}
        </p>
        {count > 0 ? (
          <>
            <nav className="manual-toc faq-toc" aria-label={tr('faq.categories')}>
              {categories.map((category) => (
                <a key={category.id} href={`#faq-${category.id}`}>
                  {category.title}
                </a>
              ))}
            </nav>
            {categories.map((category) => (
              <section
                key={category.id}
                className="manual-section"
                id={`faq-${category.id}`}
                aria-labelledby={`faq-${category.id}-heading`}
              >
                <h2 id={`faq-${category.id}-heading`}>{category.title}</h2>
                <div className="faq-items">
                  {category.entries.map((entry) => (
                    <details
                      key={`${entry.id}:${query}`}
                      className="faq-item"
                      id={`faq-${entry.id}`}
                      open={searching}
                    >
                      <summary>
                        <span className="faq-question-mark" aria-hidden="true">
                          Q.
                        </span>
                        <span>{entry.question}</span>
                      </summary>
                      <div className="faq-answer">
                        <p>
                          <span className="faq-answer-mark" aria-hidden="true">
                            A.{' '}
                          </span>
                          {typeof entry.answer === 'string'
                            ? entry.answer
                            : entry.answer.map((part, index) =>
                                typeof part === 'string' ? (
                                  part
                                ) : (
                                  <a key={index} href={part.href}>
                                    {part.text}
                                  </a>
                                ),
                              )}
                        </p>
                      </div>
                    </details>
                  ))}
                </div>
              </section>
            ))}
          </>
        ) : (
          <p className="manual-note">{tr('faq.empty')}</p>
        )}
        <a className="text-link faq-manual-link" href={manualHref(language)}>
          <BookOpen size={18} aria-hidden="true" />
          {tr('ui.app.user_manual')}
        </a>
        <a className="text-link manual-back-top" href="#faq-start">
          <ArrowUp size={16} aria-hidden="true" />
          {tr('ui.user_manual.back_to_top')}
        </a>
        <LegalLinks language={language} />
      </main>
    </div>
  );
}
