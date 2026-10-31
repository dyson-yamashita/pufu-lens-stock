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
  const [projectIds, setProjectIds] = useState<string[] | null>(
    connection.project_ids === undefined
      ? connection.project_id
        ? [connection.project_id]
        : null
      : connection.project_ids,
  );
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
                project_ids: projectIds,
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
        <fieldset disabled={projects === null}>
          <legend>{t('ui.mcp_connections.project')}</legend>
          <label className="mcp-permission">
            <input
              type="radio"
              name="project-access"
              checked={projectIds === null}
              onChange={() => setProjectIds(null)}
            />
            {t('ui.app.all_projects')}
          </label>
          <label className="mcp-permission">
            <input
              type="radio"
              name="project-access"
              checked={projectIds !== null}
              onChange={() => setProjectIds([])}
            />
            {t('ui.mcp_connections.selected_projects')}
          </label>
          {projectIds !== null && (
            <div className="mcp-project-options">
              {[
                ...(projects ?? []),
                ...projectIds
                  .filter((id) => !projects?.some((project) => project.id === id))
                  .map((id) => ({
                    id,
                    name:
                      connection.projects?.find((project) => project.id === id)?.name ??
                      connection.project_name ??
                      id,
                  })),
              ].map((project) => (
                <label className="mcp-permission" key={project.id}>
                  <input
                    type="checkbox"
                    checked={projectIds.includes(project.id)}
                    onChange={(event) =>
                      setProjectIds((current) =>
                        event.target.checked
                          ? [...(current ?? []), project.id]
                          : (current ?? []).filter((id) => id !== project.id),
                      )
                    }
                  />
                  {project.name}
                </label>
              ))}
            </div>
          )}
          <p>{t('ui.mcp_connections.projects_help')}</p>
        </fieldset>
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
            disabled={!name.trim() || projects === null || projectIds?.length === 0}
          >
            {t(saving ? 'ui.mcp_connections.saving' : 'ui.mcp_connections.save')}
          </button>
          <button type="button" className="button secondary" onClick={onCancel}>
            {t('ui.mcp_connections.cancel')}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
