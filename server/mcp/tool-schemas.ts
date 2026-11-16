import { z } from 'zod';

export const id = z.string().min(1).max(100);

export const pufuSelection = z.object({
  question_id: id
    .nullable()
    .optional()
    .describe(
      '任意の問い・気づきID。pufu_idを指定する場合は省略できます。両方指定した場合は紐付けを検証します。',
    ),
  pufu_id: id
    .optional()
    .describe(
      'list_pufus/get_question/create_pufuが返すプ譜のID。問いなしのプ譜も取得できます。省略時はquestion_idが必須で、最新の完成済みプ譜を選びます。',
    ),
});

export const filters = {
  project_id: id
    .optional()
    .describe(
      '未指定では全体一覧への表示がオンのプロジェクトが対象です。指定時や対象プロジェクトを指定した接続では、そのプロジェクトの表示設定にかかわらず検索します。',
    ),
  q: z.string().max(200).optional(),
  page: z.number().int().min(1).max(5000).default(1),
  favorite: z.boolean().default(false),
  status: z.enum(['all', 'ready', 'processing', 'failed']).default('all'),
};

export const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

export const add = { readOnlyHint: false, destructiveHint: false, idempotentHint: true };
