import { z } from 'zod';
import type { McpToolContext } from '../tool-context';
import { filters, id, read } from '../tool-schemas';
export function registerQuestionReadTools(context: McpToolContext) {
  const { register, invoke, run, security, query, ownedDetail } = context;
  register(
    'list_questions',
    {
      title: '問い・気づき検索',
      description:
        '問い・気づきを本文・記事タイトル・メモから検索します。ストックに紐づかない問い・気づきも含み、24件ずつ返します。プロジェクト未指定では全体一覧への表示がオンのプロジェクトが対象です。対象プロジェクトを指定した接続やproject_idの指定時は、そのプロジェクトの表示設定にかかわらず検索します。',
      inputSchema: z.object({ ...filters, source: z.enum(['all', 'ai', 'user']).default('all') }),
      annotations: read,
      _meta: security('questions:read'),
    },
    (args) => run('questions:read', () => invoke(`questions?${query(args)}`)),
  );

  register(
    'get_question',
    {
      title: '問い・気づき詳細',
      description:
        '指定した問い・気づきと、任意の関連ストックのID・保存先、紐づくプ譜一覧pufusを取得します。pufus[].idをget_pufu/get_pufu_imageのpufu_idに指定すると、取得するプ譜を選べます。',
      inputSchema: z.object({ question_id: id }),
      annotations: read,
      _meta: security('questions:read'),
    },
    ({ question_id }) =>
      run('questions:read', async () => {
        const data = await ownedDetail('questions', question_id);
        return { question: data.question, pufus: data.pufus };
      }),
  );
}
