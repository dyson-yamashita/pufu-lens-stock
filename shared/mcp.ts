export const mcpScopes = {
  'projects:read': 'プロジェクトの一覧を取得',
  'stocks:read': 'ストックを検索・閲覧（本文を含む）',
  'stocks:write': 'ストックを追加',
  'questions:read': '問いを検索・閲覧',
  'questions:write': '問いを追加',
  offline_access: '連携を継続するためにトークンを更新',
};
export type McpConnection = {
  id: string;
  client_name: string;
  project_id: string | null;
  project_name: string | null;
  scopes: string[];
  created_at: string;
  expires_at: string | null;
};
