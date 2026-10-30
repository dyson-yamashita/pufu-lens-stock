import { applicationError, t, intlLocale, useLanguage } from './i18n';
import { useEffect, useState } from 'react';
import { Copy, Layers, LoaderCircle, Trash2 } from 'lucide-react';
import XIntegration from './XIntegration';
import { api } from './api';
import { mcpScopes, type McpConnection } from '../shared/mcp';
export default function McpConnections() {
  useLanguage();
  const [connections, setConnections] = useState<McpConnection[]>([]);
  const [url, setUrl] = useState(() => `${window.location.origin}/mcp`);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api<{
      enabled: boolean;
      url: string;
      connections: McpConnection[];
    }>('/api/v1/mcp/connections', {
      signal: controller.signal,
    })
      .then((data) => {
        setUrl(data.url);
        setEnabled(data.enabled);
        setConnections(data.connections);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(applicationError((error as Error).message));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  return (
    <div className="shortcuts-page">
      <h2 className="integration-heading">{t('ui.mcp_connections.x_api_integration')}</h2>
      <XIntegration />
      <h2 className="integration-heading">{t('ui.mcp_connections.mcp_integration')}</h2>
      <section className="connect-guide" aria-label={t('ui.mcp_connections.mcp_integration')}>
        <div className="guide-header">
          <span className="connect-symbol">
            <Layers size={23} aria-hidden="true" />
          </span>
          <div>
            <h3>
              {t('ui.mcp_connections.use_stocks_questions_and_insights_from_chatgpt_and_other')}
            </h3>
            <p>{t('ui.mcp_connections.use_your_saved_information_in_conversations')}</p>
          </div>
        </div>
        <p>{t('ui.mcp_connections.register_the_following_url_in_the_destination_app_and')}</p>
        <div className="mcp-endpoint-field">
          <label htmlFor="mcp-url">{t('ui.mcp_connections.mcp_server_url')}</label>
          <div className="mcp-endpoint">
            <input id="mcp-url" value={url} readOnly onFocus={(event) => event.target.select()} />
            <button
              className="icon-button"
              aria-label={t('ui.mcp_connections.copy_mcp_server_url')}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  setNotice(t('ui.mcp_connections.url_copied'));
                } catch {
                  setError(t('ui.mcp_connections.select_and_copy_the_url'));
                }
              }}
            >
              <Copy size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
        {enabled === false && (
          <p role="status">
            {t('ui.mcp_connections.mcp_integration_is_not_configured_yet_this_url_will')}
          </p>
        )}
        <p>{t('ui.mcp_connections.ask_the_connected_app_to_find_stocks_in_a')}</p>
      </section>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <section className="token-section">
        <div className="section-head">
          <h2>{t('ui.mcp_connections.connected_services')}</h2>
        </div>
        {loading ? (
          <p>
            <LoaderCircle className="spin" size={17} aria-hidden="true" />
            {t('ui.mcp_connections.loading')}
          </p>
        ) : enabled === null ? (
          <p className="token-empty">{t('ui.mcp_connections.could_not_load_connected_services')}</p>
        ) : enabled === false ? (
          <p className="token-empty">
            {t('ui.mcp_connections.connected_services_will_appear_here_once_mcp_integration_is')}
          </p>
        ) : !connections.length ? (
          <p className="token-empty">
            {t('ui.mcp_connections.no_connections_yet_register_the_url_above_in_the')}
          </p>
        ) : (
          <ul className="token-list mcp-connections">
            {connections.map((connection) => (
              <li className="token-row" key={connection.id}>
                <Layers size={19} aria-hidden="true" />
                <div>
                  <strong>{connection.client_name}</strong>
                  <p>{connection.project_name ?? t('ui.app.all_projects')}</p>
                  <p>
                    {connection.scopes
                      .map((scope) => mcpScopes[scope as keyof typeof mcpScopes] ?? scope)
                      .join(t('ui.comments.separator'))}
                  </p>
                  <small>
                    {t('ui.mcp_connections.connected')}
                    {new Date(connection.created_at).toLocaleDateString(intlLocale())}
                    {connection.expires_at &&
                      t('ui.mcp_connections.expires_value', {
                        value0: new Date(connection.expires_at).toLocaleDateString(intlLocale()),
                      })}
                  </small>
                </div>
                <button
                  className="button danger"
                  disabled={busy !== null}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        t('ui.mcp_connections.disconnect_value', {
                          value0: connection.client_name,
                        }),
                      )
                    )
                      return;
                    setBusy(connection.id);
                    setError('');
                    try {
                      await api(`/api/v1/mcp/connections/${encodeURIComponent(connection.id)}`, {
                        method: 'DELETE',
                      });
                      setConnections((items) => items.filter((item) => item.id !== connection.id));
                      setNotice(t('ui.mcp_connections.integration_disconnected'));
                    } catch (error) {
                      setError(applicationError((error as Error).message));
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  {busy === connection.id
                    ? t('ui.mcp_connections.disconnecting')
                    : t('ui.mcp_connections.disconnect')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
