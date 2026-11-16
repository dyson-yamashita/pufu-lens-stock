import { z } from 'zod';
import { addCommentSchema, listCommentsSchema } from '../../../shared/comments';
import type { McpToolContext } from '../tool-context';
import { add, read } from '../tool-schemas';
export function registerCommentsTools(context: McpToolContext) {
  const { t, register, invoke, run } = context;
  for (const write of [false, true]) {
    register(
      write ? 'add_comment' : 'list_comments',
      {
        title: write ? 'コメント追加' : 'コメント一覧',
        description: t(write ? 'mcp.comments.add' : 'mcp.comments.list'),
        inputSchema: write ? addCommentSchema : listCommentsSchema,
        annotations: write ? { ...add, openWorldHint: false } : read,
        _meta: {
          securitySchemes: ['stocks', 'questions'].map((kind) => ({
            type: 'oauth2',
            scopes: [`${kind}:${write ? 'write' : 'read'}`],
          })),
        },
      },
      (args: z.infer<typeof addCommentSchema> | z.infer<typeof listCommentsSchema>) =>
        run(
          `${args.target_type === 'stock' ? 'stocks' : 'questions'}:${write ? 'write' : 'read'}`,
          () =>
            write
              ? invoke('comments', 'POST', args)
              : invoke(
                  `comments?${new URLSearchParams(Object.entries(args).map(([key, value]) => [key, String(value)]))}`,
                ),
        ),
    );
  }
}
