import { z } from 'zod';
import type { McpToolContext } from '../tool-context';
import { add, id } from '../tool-schemas';
export function registerQuestionWriteTools(context: McpToolContext) {
  const { register, project, invoke, run, security } = context;
  register(
    'add_question',
    {
      title: '問い・気づき追加',
      description:
        'プロジェクトに問い・気づきを保存します。noteで任意のメモ（2,000文字以内）も一緒に保存できます。メモは公開ページやAIのメモリに含めません。stock_idsで同じプロジェクトの複数ストックを選べます。省略や空配列も可能です。旧stock_idも利用できますがstock_idsとの併用はできません。request_idは追加操作ごとに新しいUUIDを使い、再送ではメモも含め同じ内容と同じ値を使います。',
      inputSchema: z.object({
        project_id: id,
        stock_id: id.optional(),
        stock_ids: z.array(id).max(100).optional(),
        text: z.string().trim().min(1).max(500),
        note: z
          .string()
          .max(2000)
          .optional()
          .describe('問い・気づきに添える任意のメモ。省略時は空文字。'),
        request_id: z.uuid(),
      }),
      annotations: { ...add, openWorldHint: false },
      _meta: security('questions:write'),
    },
    (args) =>
      run('questions:write', async () => {
        project(args.project_id);
        const saved = (await invoke('questions', 'POST', args)) as { question: { id: string } };
        const stockIds = [
          ...new Set(args.stock_ids ?? (args.stock_id ? [args.stock_id] : [])),
        ].sort();
        // 作成許可だけの接続へ、関連先や再送後に本人が編集した情報を返さない。
        return {
          question: {
            id: saved.question.id,
            project_id: args.project_id,
            source: 'user',
            stock_id: stockIds[0] ?? null,
            stock_ids: stockIds,
            text: args.text,
            note: args.note ?? '',
          },
        };
      }),
  );
}
