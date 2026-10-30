import { applicationError, t, useLanguage, setLanguage, legalHref } from './i18n';
import LanguageSelect from './LanguageSelect';
import { useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { onboardingSchema, type User } from '../shared/domain';
import { legalVersions } from '../shared/legal';
import { send } from './api';
export default function Onboarding({
  onComplete,
  onLogout,
}: {
  onComplete: (user: User) => void;
  onLogout: () => void;
}) {
  useLanguage();
  const { language: currentLanguage } = useLanguage();
  const [language, chooseLanguage] = useState(currentLanguage);
  const [name, setName] = useState('');
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = {
    name,
    language,
    terms_accepted: terms,
    privacy_accepted: privacy,
    terms_version: legalVersions.terms,
    privacy_version: legalVersions.privacy,
  };
  const valid = onboardingSchema.safeParse(input).success;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = onboardingSchema.safeParse(input);
    if (busy || !parsed.success) return;
    setBusy(true);
    setError('');
    try {
      const result = await send<{
        user: User;
        redirect_to: string | null;
      }>('/api/v1/onboarding', parsed.data);
      setLanguage(result.user.language ?? language);
      if (result.redirect_to) window.location.assign(result.redirect_to);
      else onComplete(result.user);
    } catch (caught) {
      setError(applicationError((caught as Error).message));
      setBusy(false);
    }
  }
  return (
    <div className="onboarding-page">
      <a className="brand" href="/" aria-label={t('ui.app.pufu_lens_home')}>
        <img className="brand-mark" src="/pufu-lens-logo.png" alt="" width="38" height="38" />
        <span>Pufu Lens</span>
      </a>
      <main className="onboarding-card" aria-labelledby="onboarding-title">
        <h1 id="onboarding-title">{t('ui.onboarding.welcome_to_pufu_lens')}</h1>
        <form onSubmit={submit} noValidate aria-busy={busy}>
          <LanguageSelect
            id="onboarding-language"
            value={language}
            onChange={(next) => {
              chooseLanguage(next);
              setLanguage(next);
            }}
            disabled={busy}
            hint
          />
          <label htmlFor="onboarding-name">
            {t('ui.onboarding.nickname_display_name')}
            <span className="profile-required">{t('ui.onboarding.required')}</span>
          </label>
          <input
            id="onboarding-name"
            autoComplete="nickname"
            value={name}
            onInput={(event) => setName(event.currentTarget.value)}
            required
            maxLength={80}
            disabled={busy}
            aria-describedby="onboarding-name-hint"
          />
          <p id="onboarding-name-hint" className="profile-hint">
            {t('ui.onboarding.the_name_used_in_the_app_it_does_not')}
          </p>
          <fieldset className="onboarding-consents" disabled={busy}>
            <legend>{t('ui.onboarding.agree_to_the_terms')}</legend>
            <div className="onboarding-consent">
              <input
                id="onboarding-terms"
                type="checkbox"
                checked={terms}
                required
                onChange={(event) => setTerms(event.currentTarget.checked)}
              />
              <label htmlFor="onboarding-terms">
                {t('consent.prefix')}
                <a href={legalHref('terms')} target="_blank" rel="noreferrer">
                  {t('ui.legal_links.terms_of_service')}
                </a>
                {t('consent.suffix')}
              </label>
            </div>
            <div className="onboarding-consent">
              <input
                id="onboarding-privacy"
                type="checkbox"
                checked={privacy}
                required
                onChange={(event) => setPrivacy(event.currentTarget.checked)}
              />
              <label htmlFor="onboarding-privacy">
                {t('consent.prefix')}
                <a href={legalHref('privacy')} target="_blank" rel="noreferrer">
                  {t('ui.legal_links.privacy_policy')}
                </a>
                {t('consent.suffix')}
              </label>
            </div>
            <p className="profile-hint">
              {t('ui.onboarding.links_open_in_a_new_tab_please_review_both')}
            </p>
          </fieldset>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="button primary onboarding-submit"
            type="submit"
            disabled={!valid || busy}
          >
            {busy && <LoaderCircle className="spin" size={17} aria-hidden="true" />}OK
          </button>
        </form>
        <button
          className="text-button onboarding-logout"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await send('/api/v1/logout');
              onLogout();
            } catch (caught) {
              setError(applicationError((caught as Error).message));
              setBusy(false);
            }
          }}
        >
          {t('ui.app.sign_out')}
        </button>
      </main>
    </div>
  );
}
