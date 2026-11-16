import { ArrowDownToLine, Check, Copy, KeyRound, Plus } from 'lucide-react';
import { useState } from 'react';
import type { Project, TokenInfo } from '../../../shared/domain';
import shortcutSetupImage from '../../assets/shortcut-setup.png';
import { FormError } from '../../components/FormError';
import { t, useLanguage } from '../../i18n/i18n';
import { date, fullDate } from '../../lib/dates';

export function Shortcuts({
  baseUrl,
  projects,
  tokens,
  onCreate,
  onRevoke,
}: {
  baseUrl: string;
  projects: Project[];
  tokens: TokenInfo[];
  onCreate: () => void;
  onRevoke: (id: string) => Promise<void>;
}) {
  useLanguage();
  const base = baseUrl;
  const [projectId, setProjectId] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const example = JSON.stringify(
    {
      url: t('ui.app.article_url_from_step_03_magic_variable'),
      ...(projectId ? { project_id: projectId } : {}),
      note: '',
    },
    null,
    2,
  );
  return (
    <div className="shortcuts-page">
      <section className="connect-guide">
        <div className="guide-header">
          <span className="connect-symbol">
            <ArrowDownToLine size={23} aria-hidden="true" />
          </span>
          <div>
            <h2>{t('ui.app.save_articles_from_the_share_menu')}</h2>
            <p>{t('ui.app.save_an_article_from_the_share_menu_while_reading')}</p>
          </div>
        </div>
        <ol className="setup-steps">
          <li>
            <span>01</span>
            <div>
              <h3>{t('ui.app.create_a_token')}</h3>
              <p>{t('ui.app.use_create_token_below_you_can_restrict_the_destination')}</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <h3>{t('ui.app.receive_urls_from_the_share_sheet')}</h3>
              <p>{t('ui.app.in_the_iphone_shortcuts_app_create_a_shortcut_with')}</p>
              <p>{t('ui.app.the_first_action_says_receive_from_share_sheet_give')}</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <h3>{t('ui.app.add_get_urls_from_input')}</h3>
              <p>{t('ui.app.add_an_action_search_for_get_urls_and_set')}</p>
              <p>{t('ui.app.share_one_article_at_a_time_if_there_are')}</p>
            </div>
          </li>
          <li>
            <span>04</span>
            <div>
              <h3>{t('ui.app.post_with_get_contents_of_url')}</h3>
              <p>{t('ui.app.add_get_contents_of_url_and_paste_the_save')}</p>
              <p>{t('ui.app.choose_text_for_the_json_url_field_and_use')}</p>
              <p>{t('ui.app.send_the_token_to_the_save_api_below_do')}</p>
              <p>{t('ui.app.project_id_is_optional_if_omitted_a_project_restricted')}</p>
              <details>
                <summary>{t('ui.app.choose_a_destination_when_running_the_shortcut')}</summary>
                <p>{t('ui.app.get_the_following_url_with_the_same_authorization_header')}</p>
                <code>{base}/api/v1/projects</code>
              </details>
            </div>
          </li>
        </ol>
        <figure className="shortcut-setup-figure">
          <figcaption>{t('ui.app.shortcut_setup_example')}</figcaption>
          <img
            src={shortcutSetupImage}
            width={881}
            height={1785}
            loading="lazy"
            decoding="async"
            alt={t('ui.app.receive_urls_and_safari_web_pages_from_the_share')}
          />
          <p>{t('ui.app.use_the_following_url_for_the_save_api_url')}</p>
          <code>{base}/api/v1/stocks</code>
        </figure>
        <div className="api-example">
          <div>
            <span>POST</span>
            <code>{base}/api/v1/stocks</code>
            <button
              className="icon-button small"
              aria-label={t('ui.app.copy_save_api_url')}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`${base}/api/v1/stocks`);
                  setCopied(true);
                  setCopyError('');
                } catch {
                  setCopyError(t('ui.app.could_not_copy_select_and_copy_the_displayed_url'));
                }
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
          </div>
          <pre id="shortcut-body-example">
            {t('ui.app.authorization_bearer_lt_your_token_gt')}
            {'\n'}Content-Type: application/json
            {'\n\n'}
            {example}
          </pre>
        </div>
        <FormError error={copyError} />
        <label htmlFor="shortcut-project">{t('ui.app.example_destination_optional')}</label>
        <select
          id="shortcut-project"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="">{t('ui.app.unspecified_use_the_token_s_settings')}</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <p className="guide-note">{t('ui.app.selecting_a_project_puts_its_actual_id_in_the')}</p>
        <p className="guide-note">{t('ui.app.the_api_returns_an_id_when_a_save_is')}</p>
      </section>
      <section className="token-section">
        <div className="section-head">
          <div>
            <h2>{t('ui.app.integration_tokens')}</h2>
            <p>{t('ui.app.tokens_allow_listing_projects_and_saving_articles')}</p>
          </div>
          <button className="button primary" onClick={onCreate}>
            <Plus size={17} aria-hidden="true" />
            {t('ui.app.create_token')}
          </button>
        </div>
        {!tokens.length ? (
          <div className="token-empty">
            <KeyRound size={25} aria-hidden="true" />
            <p>{t('ui.app.no_tokens_have_been_created')}</p>
          </div>
        ) : (
          <div className="token-list">
            {tokens.map((token) => {
              const inactive =
                Boolean(token.revoked_at) ||
                (token.expires_at !== null && new Date(token.expires_at).getTime() <= Date.now());
              return (
                <div className={`token-row ${inactive ? 'token-inactive' : ''}`} key={token.id}>
                  <KeyRound size={19} aria-hidden="true" />
                  <div>
                    <strong>{token.name}</strong>
                    <code>{token.prefix}••••••••</code>
                    <span>
                      {projects.find((project) => project.id === token.project_id)?.name ??
                        t('ui.app.all_projects')}{' '}
                      ·{' '}
                      {inactive
                        ? token.revoked_at
                          ? t('ui.app.revoked')
                          : t('ui.app.expired')
                        : token.expires_at === null
                          ? t('ui.app.no_expiration')
                          : t('ui.app.valid_until_value', { value0: date(token.expires_at) })}
                    </span>
                    {token.last_used_at && (
                      <small>
                        {t('ui.app.last_used')}
                        {fullDate(token.last_used_at)}
                      </small>
                    )}
                  </div>
                  <button
                    className="button secondary"
                    disabled={inactive}
                    onClick={() => {
                      if (
                        window.confirm(
                          t('ui.app.revoke_this_token_configured_shortcuts_will_no_longer_be'),
                        )
                      )
                        void onRevoke(token.id);
                    }}
                  >
                    {t('ui.app.revoke')}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
