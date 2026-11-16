import { Check, Copy, KeyRound } from 'lucide-react';
import { useState } from 'react';
import type { Project } from '../../../shared/domain';
import { FormError } from '../../components/FormError';
import { Spinner } from '../../components/Spinner';
import { applicationError, t, useLanguage } from '../../i18n/i18n';
import { send } from '../../lib/api';

export function TokenForm({ projects }: { projects: Project[] }) {
  useLanguage();
  const [name, setName] = useState('iPhone');
  const [project, setProject] = useState('');
  const [days, setDays] = useState<number | null>(90);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  if (token)
    return (
      <div className="new-token">
        <div className="token-created">
          <Check size={24} aria-hidden="true" />
          <h3>{t('ui.app.token_created')}</h3>
        </div>
        <p>{t('ui.app.the_complete_token_is_shown_only_here_register_it')}</p>
        <label htmlFor="new-token-value">{t('ui.app.bearer_token')}</label>
        <textarea id="new-token-value" value={token} readOnly rows={3} />
        <button
          className="button primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(token);
              setCopied(true);
              setError('');
            } catch {
              setError(t('ui.app.could_not_copy_select_and_copy_the_token'));
            }
          }}
        >
          {copied ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}
          {copied ? t('ui.app.copied') : t('ui.app.copy_token')}
        </button>
        <FormError error={error} />
      </div>
    );
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
          const result = await send<{
            token: string;
          }>('/api/v1/tokens', {
            name,
            project_id: project || null,
            expires_days: days,
          });
          setToken(result.token);
        } catch (e) {
          setError(applicationError((e as Error).message));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="form-intro">{t('ui.app.create_a_token_for_each_device_or_purpose_so')}</p>
      <label htmlFor="token-name">{t('ui.app.token_name')}</label>
      <input
        id="token-name"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={80}
      />
      <label htmlFor="token-project">{t('ui.app.destination_restriction')}</label>
      <select id="token-project" value={project} onChange={(e) => setProject(e.target.value)}>
        <option value="">{t('ui.app.all_my_projects')}</option>
        {projects.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <label htmlFor="token-days">{t('ui.app.validity_period')}</label>
      <select
        id="token-days"
        value={days ?? 'unlimited'}
        onChange={(e) => setDays(e.target.value === 'unlimited' ? null : Number(e.target.value))}
      >
        <option value={30}>{t('ui.app.30_days')}</option>
        <option value={90}>{t('ui.app.90_days')}</option>
        <option value={365}>{t('ui.app.365_days')}</option>
        <option value="unlimited">{t('ui.app.no_expiration')}</option>
      </select>
      <FormError error={error} />
      <div className="form-actions">
        <button className="button primary" disabled={busy}>
          {busy ? <Spinner /> : <KeyRound size={17} aria-hidden="true" />}
          {t('ui.app.create')}
        </button>
      </div>
    </form>
  );
}
