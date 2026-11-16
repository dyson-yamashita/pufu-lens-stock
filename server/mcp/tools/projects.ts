import { z } from 'zod';
import type { McpToolContext } from '../tool-context';
import { read } from '../tool-schemas';
export function registerProjectsTools(context: McpToolContext) {
  const { register, invoke, run, security } = context;
  register(
    'list_projects',
    {
      title: 'プロジェクト一覧',
      description:
        'アクセスを許可された保存先プロジェクトのID・名前・説明・全体一覧への表示設定を取得します。全体一覧に表示しないプロジェクトも含みます。',
      inputSchema: z.object({}),
      annotations: read,
      _meta: security('projects:read'),
    },
    () => run('projects:read', () => invoke('projects')),
  );
}
