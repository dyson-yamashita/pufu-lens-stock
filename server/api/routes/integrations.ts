import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../env';
import { encryptToken } from '../../features/integrations/x';
import { body } from '../validation';

export function registerIntegrationsRoutes(app: Hono<AppEnv>) {
  app.get('/api/v1/integrations/x', async (c) => {
    const row = await c.env.DB.prepare(
      "SELECT updated_at FROM external_integrations WHERE user_id = ? AND provider = 'x'",
    )
      .bind(c.get('principal').user.id)
      .first<{ updated_at: string }>();
    return c.json({
      configured: Boolean(row),
      available: /^[a-f0-9]{64}$/i.test(c.env.INTEGRATION_ENCRYPTION_KEY ?? ''),
      updated_at: row?.updated_at ?? null,
    });
  });

  app.put('/api/v1/integrations/x', async (c) => {
    const { token } = await body(
      c,
      z.strictObject({
        token: z
          .string()
          .trim()
          .min(10)
          .max(4096)
          .regex(/^[A-Za-z0-9%._~+/=-]+$/),
      }),
    );
    const userId = c.get('principal').user.id;
    const encrypted = await encryptToken(c.env, userId, token);
    await c.env.DB.prepare(
      "INSERT INTO external_integrations (user_id, provider, encrypted_token) VALUES (?, 'x', ?) ON CONFLICT(user_id, provider) DO UPDATE SET encrypted_token = excluded.encrypted_token, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')",
    )
      .bind(userId, encrypted)
      .run();
    return c.json({ ok: true });
  });

  app.delete('/api/v1/integrations/x', async (c) => {
    await c.env.DB.prepare("DELETE FROM external_integrations WHERE user_id = ? AND provider = 'x'")
      .bind(c.get('principal').user.id)
      .run();
    return c.json({ ok: true });
  });
}
