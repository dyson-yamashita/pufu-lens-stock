import type { Env } from './env';

export function getMcpConnectionSettings(env: Env, userId: string, grantId: string) {
  return env.DB.prepare(
    'SELECT client_name,project_id,scopes,revoked,project_ids FROM mcp_connection_settings WHERE user_id=? AND grant_id=?',
  )
    .bind(userId, grantId)
    .first<{
      client_name: string;
      project_id: string | null;
      scopes: string;
      revoked: number;
      project_ids: string | null;
    }>();
}
