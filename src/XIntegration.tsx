import { t, useLanguage } from './i18n';
import { useEffect, useState } from 'react';
import { api } from './api';
import DeleteAction from './DeleteAction';
type Status = {
  configured: boolean;
  available: boolean;
};
export default function XIntegration() {
  useLanguage();
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api<Status>('/api/v1/integrations/x', { signal: controller.signal })
      .then(setStatus)
      .catch(() => {
        if (!controller.signal.aborted)
          setError(t('ui.xintegration.could_not_load_x_integration_status'));
      });
    return () => controller.abort();
  }, []);
  return (
    <section className="connect-guide" aria-label={t('ui.mcp_connections.x_api_integration')}>
      <p>{t('ui.xintegration.register_an_official_x_api_bearer_token_to_retrieve')}</p>
      <p>{t('ui.xintegration.credentials_are_encrypted_on_the_server_and_used_only')}</p>
      <p role="status">
        {status
          ? status.configured
            ? t('ui.xintegration.registered_credentials_are_checked_when_retrieving_a_post')
            : t('ui.xintegration.not_registered')
          : t('ui.xintegration.loading')}
      </p>
      {status && !status.available && (
        <p>{t('ui.xintegration.the_administrator_must_configure_an_encryption_key')}</p>
      )}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          setNotice('');
          try {
            await api('/api/v1/integrations/x', { method: 'PUT', body: JSON.stringify({ token }) });
            setToken('');
            setStatus({ configured: true, available: true });
            setNotice(t('ui.xintegration.x_credentials_saved'));
          } catch {
            setError(t('ui.xintegration.could_not_save_check_the_token_format_and_integration'));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="x-token">X API Bearer Token</label>
        <input
          id="x-token"
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          value={token}
          minLength={10}
          maxLength={4096}
          required
          disabled={busy || !status?.available}
          onChange={(event) => setToken(event.target.value)}
          placeholder={
            status?.configured
              ? t('ui.xintegration.enter_only_to_change')
              : t('ui.xintegration.enter_bearer_token')
          }
        />
        <div className="form-actions">
          <button className="button primary" disabled={busy || !status?.available || !token.trim()}>
            {busy
              ? t('ui.xintegration.processing')
              : status?.configured
                ? t('ui.xintegration.update')
                : t('ui.xintegration.register')}
          </button>
        </div>
      </form>
      {status?.configured && (
        <DeleteAction
          summary={t('ui.xintegration.x_credential_deletion')}
          label={t('ui.xintegration.delete_x_credentials')}
          title={t('ui.xintegration.delete_x_credentials_2')}
          disabled={busy}
          onDelete={async () => {
            await api('/api/v1/integrations/x', { method: 'DELETE' });
            setStatus({ ...status, configured: false });
            setToken('');
            setError('');
            setNotice(t('ui.xintegration.x_credentials_deleted'));
          }}
        >
          <p>{t('ui.xintegration.delete_the_registered_x_api_credentials_to_retrieve_new')}</p>
          <p>{t('ui.xintegration.previously_saved_articles_remain')}</p>
        </DeleteAction>
      )}
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
