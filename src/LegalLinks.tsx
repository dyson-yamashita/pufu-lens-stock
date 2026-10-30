import { useLanguage, translateUi, legalHref } from './i18n';
import type { Language } from '../shared/locale';
export default function LegalLinks({
  newTab = false,
  language,
}: {
  language?: Language;
  newTab?: boolean;
}) {
  const current = useLanguage();
  const locale = language ?? current.language;
  const text = (message: string, values?: Record<string, string | number>) =>
    translateUi(locale, message, values);
  return (
    <nav className="legal-links" aria-label={text('ui.legal_links.policies_and_terms')}>
      {(['privacy', 'terms'] as const).map((page) => {
        const label = text(
          page === 'privacy' ? 'ui.legal_links.privacy_policy' : 'ui.legal_links.terms_of_service',
        );
        return (
          <a
            key={page}
            href={legalHref(page, locale)}
            target={newTab ? '_blank' : undefined}
            rel={newTab ? 'noreferrer' : undefined}
            aria-label={
              newTab
                ? text('ui.legal_links.value_opens_in_a_new_tab', { value0: label })
                : undefined
            }
          >
            {label}
          </a>
        );
      })}
    </nav>
  );
}
