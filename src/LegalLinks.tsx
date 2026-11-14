import { useLanguage, translateUi, legalHref, homeHref } from './i18n';
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
      {[
        { href: legalHref('privacy', locale), label: text('ui.legal_links.privacy_policy') },
        { href: legalHref('terms', locale), label: text('ui.legal_links.terms_of_service') },
        { href: `${homeHref(locale)}#announcements`, label: text('announcements.title') },
      ].map(({ href, label }) => {
        return (
          <a
            key={href}
            href={href}
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
