import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { addCommentSchema, listCommentsSchema } from '../../../shared/comments';
import type { AppEnv } from '../../env';
import { addComment, listComments } from '../../features/comments/comments';
import { body } from '../validation';

export function registerCommentsRoutes(app: Hono<AppEnv>) {
  app.get('/api/v1/comments', async (c) => {
    const query = c.req.query();
    const parsed = listCommentsSchema.safeParse({
      ...query,
      phase: query.phase ? Number(query.phase) : undefined,
      page: query.page ? Number(query.page) : undefined,
    });
    if (!parsed.success)
      throw new HTTPException(400, { message: 'コメントの対象と局面番号を確認してください。' });
    return c.json(await listComments(c.env, c.get('principal'), parsed.data));
  });

  app.post('/api/v1/comments', async (c) => {
    const input = await body(c, addCommentSchema);
    const { comment, created } = await addComment(c.env, c.get('principal'), input);
    return c.json({ comment }, created ? 201 : 200);
  });
}
