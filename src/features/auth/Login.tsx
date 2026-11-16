import { ArrowRight, ArrowUpRight, Bookmark, BookOpen, Sparkles } from 'lucide-react';
import { useState } from 'react';
import type { Config } from '../../../shared/domain';
import type { Language } from '../../../shared/locale';
import { Brand } from '../../components/Brand';
import { FormError } from '../../components/FormError';
import { Spinner } from '../../components/Spinner';
import {
  applicationError,
  homeHref,
  manualHref,
  setLanguage as persistLanguage,
  t,
  useLanguage,
} from '../../i18n/i18n';
import LanguageSelect from '../../i18n/LanguageSelect';
import LegalLinks from '../legal/LegalLinks';
import { PublicProjectDirectory } from '../public-projects';
import ThemeToggle from '../settings/ThemeToggle';

export function Login({ config, onLogin }: { config: Config; onLogin: () => Promise<void> }) {
  useLanguage();
  const { language } = useLanguage();
  const withdrawn = new URLSearchParams(window.location.search).get('withdrawn');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    new URLSearchParams(window.location.search).has('login_error')
      ? t('ui.app.google_sign_in_could_not_be_completed_please_try')
      : '',
  );
  const onLanguageChange = (next: Language) => {
    persistLanguage(next);
    const target = homeHref(next);
    const current = window.location.pathname.replace(/\/$/, '') || '/';
    const normalized = target.replace(/\/$/, '') || '/';
    if (current !== normalized && typeof window.location.assign === 'function') {
      window.location.assign(target);
    }
  };
  return (
    <div className="login-page">
      <header>
        <Brand />
        <div className="login-header-links">
          <span className="login-caption">{t('ui.app.read_collect_connect')}</span>
          <a className="text-link" href={manualHref(language)}>
            <BookOpen size={17} aria-hidden="true" />
            {t('ui.app.manual')}
          </a>
          <LanguageSelect id="site-language" value={language} onChange={onLanguageChange} />
          <ThemeToggle />
        </div>
      </header>
      <main className="login-main">
        <div className="login-copy">
          <h1>
            {t('ui.app.turn_collected_knowledge')}
            <br />
            {t('ui.app.into_connected')}
            <span>{t('ui.app.memory_2')}</span>
            {t('ui.app.separator')}
          </h1>
          <p className="login-description">
            {t('ui.app.save_interesting_articles_to_projects')}
            <br />
            {t('ui.app.connect_their_key_points_with_your_interests')}
            <br />
            {t('ui.app.and_grow_them_into_a_shared_memory')}
          </p>
          <a
            className={`button primary google-button ${!config.googleConfigured ? 'disabled' : ''}`}
            href={config.googleConfigured ? '/api/auth/google' : undefined}
            aria-disabled={!config.googleConfigured}
          >
            <span className="google-g" aria-hidden="true">
              G
            </span>
            {t('ui.app.sign_in_with_google')}
            <ArrowRight size={18} aria-hidden="true" />
          </a>
          {!config.googleConfigured && (
            <p className="login-help">
              {config.demo
                ? t('ui.app.try_the_app_with_the_local_demo')
                : t('ui.app.sign_in_is_being_prepared_please_contact_the_administrator')}
            </p>
          )}
          {config.demo && (
            <button
              className="button secondary demo-login"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await onLogin();
                } catch (e) {
                  setError(applicationError((e as Error).message));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Spinner /> : <BookOpen size={18} aria-hidden="true" />}
              {t('ui.app.open_local_demo')}
            </button>
          )}
          {['complete', 'pending'].includes(withdrawn ?? '') && (
            <p className="withdrawal-notice" role="status">
              {withdrawn === 'pending'
                ? config.demo
                  ? t('ui.app.your_account_was_deleted_remaining_demo_data_will_also')
                  : t('ui.app.your_account_was_deleted_remaining_data_will_continue_to')
                : t('ui.app.your_account_and_registered_data_have_been_deleted')}
            </p>
          )}
          <FormError error={error} />
        </div>
        <div className="login-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="floating-tag">
            <Bookmark size={16} />
            {t('ui.app.find_connections_beyond_what_you_read')}
          </div>
          <div className="art-article">
            <h3>
              {t('ui.app.today_s_article')}
              <br />
              {t('ui.app.tomorrow_s_idea')}
            </h3>
            <div className="art-rule" />
            <div className="art-rule short" />
            <div className="art-tags">
              <span>{t('ui.app.interests')}</span>
              <span>{t('ui.app.fresh_perspectives')}</span>
            </div>
          </div>
          <div className="art-memory">
            <div className="art-memory-icon">
              <Sparkles size={21} />
            </div>
            <div>
              <h3>{t('ui.app.grow_your_interests_and_knowledge')}</h3>
              <p>{t('ui.app.organize_themes_and_questions_from_saved_articles')}</p>
            </div>
            <ArrowUpRight size={20} />
          </div>
        </div>
      </main>
      <section
        id="what-you-can-do"
        className="what-you-can-do"
        aria-labelledby="what-you-can-do-heading"
      >
        <h2 id="what-you-can-do-heading">{t('ui.app.what_you_can_do')}</h2>
        <div className="what-you-can-do-steps">
          <article className="what-you-can-do-item">
            <div className="what-you-can-do-heading">
              <span className="what-you-can-do-number" aria-hidden="true">
                1
              </span>
              <h3>{t('ui.app.step_stock_title')}</h3>
            </div>
            <p>{t('ui.app.step_stock_body')}</p>
          </article>
          <article className="what-you-can-do-item">
            <div className="what-you-can-do-heading">
              <span className="what-you-can-do-number" aria-hidden="true">
                2
              </span>
              <h3>{t('ui.app.step_grow_title')}</h3>
            </div>
            <p>{t('ui.app.step_grow_body')}</p>
          </article>
          <article className="what-you-can-do-item">
            <div className="what-you-can-do-heading">
              <span className="what-you-can-do-number" aria-hidden="true">
                3
              </span>
              <h3>{t('ui.app.step_pufu_title')}</h3>
            </div>
            <p>{t('ui.app.step_pufu_body')}</p>
          </article>
          <article className="what-you-can-do-item">
            <div className="what-you-can-do-heading">
              <span className="what-you-can-do-number" aria-hidden="true">
                4
              </span>
              <h3>{t('ui.app.step_mcp_title')}</h3>
            </div>
            <p>{t('ui.app.step_mcp_body')}</p>
          </article>
        </div>
      </section>
      <section id="use-cases" className="what-you-can-do" aria-labelledby="use-cases-heading">
        <h2 id="use-cases-heading">{t('ui.app.use_cases')}</h2>
        <div className="use-case-list">
          {[
            ['ui.app.use_case_learning_title', 'ui.app.use_case_learning_body'],
            ['ui.app.use_case_business_title', 'ui.app.use_case_business_body'],
            ['ui.app.use_case_sharing_title', 'ui.app.use_case_sharing_body'],
          ].map(([title, body], index) => (
            <article className="what-you-can-do-item" key={title}>
              <div className="what-you-can-do-heading">
                <span className="what-you-can-do-number" aria-hidden="true">
                  {index + 1}
                </span>
                <h3>{t(title)}</h3>
              </div>
              <p>{t(body)}</p>
            </article>
          ))}
        </div>
      </section>
      <PublicProjectDirectory />
      <footer className="login-footer">
        <LegalLinks />
      </footer>
    </div>
  );
}
