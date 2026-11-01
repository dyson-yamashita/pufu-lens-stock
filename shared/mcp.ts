export const mcpScopes = {
  'projects:read': 'プロジェクトの一覧を取得',
  'memories:read': 'プロジェクトのメモリを閲覧',
  'stocks:read': 'ストックを検索・閲覧（本文・コメントを含む）',
  'stocks:write': 'ストックとコメントを追加',
  'questions:read': '問い・気づきとプ譜を検索・閲覧、コメントを閲覧',
  'questions:write': '問い・気づきと、問い・気づき・プ譜のコメントを追加',
  'pufus:write': 'プ譜を作成・編集、問い・気づきへの紐付けを変更',
  offline_access: '連携を継続するためにトークンを更新',
};
export type McpConnection = {
  id: string;
  client_name: string;
  project_id: string | null;
  project_name: string | null;
  project_ids?: string[] | null;
  projects?: { id: string; name: string }[];
  scopes: string[];
  authorized_scopes?: string[];
  created_at: string;
  expires_at: string | null;
};
