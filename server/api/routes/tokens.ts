import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnv } from '../../env';
import { now } from '../../infrastructure/db';
import { hash, randomSecret } from '../../infrastructure/security';
import { ownedProject } from '../context';
import { body } from '../validation';

export function registerTokensRoutes(app: Hono<AppEnv>) {
  app.get('/api/v1/tokens', async (c) => {
    const rows = await c.env.DB.prepare(
      'SELECT id, name, prefix, project_id, expires_at, revoked_at, last_used_at, created_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC',
    )
      .bind(c.get('principal').user.id)
      .all();
    return c.json({ tokens: rows.results });
  });

  app.post('/api/v1/tokens', async (c) => {
    const { user } = c.get('principal');
    const data = await body(
      c,
      z.object({
        name: z.string().trim().min(1).max(80),
        project_id: z.string().max(100).nullable().default(null),
        expires_days: z.number().int().min(1).max(365).nullable().default(90),
      }),
    );
    if (data.project_id) await ownedProject(c.env, user.id, data.project_id);
    const count = await c.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)',
    )
      .bind(user.id, now())
      .first<{ count: number }>();
    if (count!.count >= 20)
      throw new HTTPException(422, {
        message: '有効なトークンは20個までです。不要なトークンを失効してください。',
      });
    const token = `pls_${randomSecret()}`;
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      'INSERT INTO api_tokens (id, user_id, name, token_hash, prefix, project_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        id,
        user.id,
        data.name,
        await hash(token),
        token.slice(0, 11),
        data.project_id,
        data.expires_days === null
          ? null
          : new Date(Date.now() + data.expires_days * 86400000).toISOString(),
      )
      .run();
    return c.json({ id, token }, 201);
  });

  app.delete('/api/v1/tokens/:id', async (c) => {
    const result = await c.env.DB.prepare(
      'UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ?',
    )
      .bind(now(), c.req.param('id'), c.get('principal').user.id)
      .run();
    if (!result.meta.changes) throw new HTTPException(404);
    return c.json({ ok: true });
  });
}
