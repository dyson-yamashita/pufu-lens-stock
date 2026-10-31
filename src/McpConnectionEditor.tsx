import { useEffect, useState } from 'react';
import { api } from './api';
import { applicationError, t, useLanguage } from './i18n';
import { mcpScopes, type McpConnection } from '../shared/mcp';
import { translate } from '../shared/locale';

export default function McpConnectionEditor({
  connection,
  onSave,
  onCancel,
}: {
  connection: McpConnection;
  onSave: (connection: McpConnection) => void;
  onCancel: () => void;
}) {
  const { language } = useLanguage();
  const [name, setName] = useState(connection.client_name);
  const [projectId, setProjectId] = useState(connection.project_id ?? '');
  const [scopes, setScopes] = useState(connection.scopes);
  const [projects, setProjects] = useState<{ id: string; name: string }[] | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    api<{ projects: { id: string; name: string }[] }>('/api/v1/projects', {
      signal: controller.signal,
    })
      .then((data) => setProjects(data.projects))
      .catch((error) => {
        if (!controller.signal.aborted) setError(applicationError((error as Error).message));
      });
    return () => controller.abort();
  }, []);
  return (
    <form
      className="mcp-connection-editor"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        setError('');
        try {
          const result = await api<{ connection: McpConnection }>(
            `/api/v1/mcp/connections/${encodeURIComponent(connection.id)}`,
            {
              method: 'PATCH',
              body: JSON.stringify({
                client_name: name.trim(),
                project_id: projectId || null,
                scopes,
              }),
            },
          );
          onSave(result.connection);
        } catch (error) {
          setError(applicationError((error as Error).message));
        } finally {
          setSaving(false);
        }
      }}
    >
      <fieldset disabled={saving}>
        <legend>{t('ui.mcp_connections.edit')}</legend>
        <label>
          {t('ui.mcp_connections.name')}
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={100}
          />
        </label>
        <label>
          {t('ui.mcp_connections.project')}
          <select
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            disabled={projects === null}
          >
            <option value="">{t('ui.app.all_projects')}</option>
            {projectId && !projects?.some((project) => project.id === projectId) && (
              <option value={projectId}>{connection.project_name ?? projectId}</option>
            )}
            {projects?.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>{t('ui.mcp_connections.permissions')}</legend>
          {Object.entries(mcpScopes).map(([scope, label]) => (
            <label className="mcp-permission" key={scope}>
              <input
                type="checkbox"
                checked={scopes.includes(scope)}
                disabled={!(connection.authorized_scopes ?? connection.scopes).includes(scope)}
                onChange={(event) =>
                  setScopes((current) =>
                    event.target.checked
                      ? [...current, scope]
                      : current.filter((value) => value !== scope),
                  )
                }
              />
              {translate(language, label)}
            </label>
          ))}
        </fieldset>
        <p>{t('ui.mcp_connections.edit_help')}</p>
        {error && (
          <p role="alert" className="error-box">
            {error}
          </p>
        )}
        <div className="mcp-connection-actions">
          <button
            type="submit"
            className="button primary"
            disabled={!name.trim() || projects === null}
          >
            {t(saving ? 'ui.mcp_connections.saving' : 'ui.mcp_connections.save')}
          </button>
          <button type="button" className="button" onClick={onCancel}>
            {t('ui.mcp_connections.cancel')}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
