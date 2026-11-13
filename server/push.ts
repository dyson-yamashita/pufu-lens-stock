import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnv, Env } from './env';

export function allowedPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      (url.hostname === 'fcm.googleapis.com' ||
        url.hostname === 'updates.push.services.mozilla.com' ||
        url.hostname === 'web.push.apple.com' ||
        url.hostname.endsWith('.push.apple.com'))
    );
  } catch {
    return false;
  }
}
const key = (length: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .refine((value) => {
      try {
        return (
          Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
            .length === length
        );
      } catch {
        return false;
      }
    });
const endpointSchema = z.string().max(2048).refine(allowedPushEndpoint);
const subscriptionSchema = z.object({
  endpoint: endpointSchema,
  keys: z.object({ p256dh: key(65), auth: key(16) }),
});
export function pushConfigured(env: Env): boolean {
  return (
    env.PUSH_ENABLED === 'true' &&
    key(65).safeParse(env.VAPID_PUBLIC_KEY).success &&
    key(32).safeParse(env.VAPID_PRIVATE_KEY).success &&
    /^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(env.VAPID_SUBJECT ?? '')
  );
}
export function pushApp() {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    if (c.get('principal').kind !== 'session') throw new HTTPException(403);
    await next();
  });
  app.get('/', (c) =>
    c.json({
      available: pushConfigured(c.env),
      publicKey: pushConfigured(c.env) ? c.env.VAPID_PUBLIC_KEY : null,
    }),
  );
  app.post('/status', async (c) => {
    const parsed = z
      .object({ endpoint: endpointSchema })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HTTPException(400);
    const row = await c.env.DB.prepare(
      'SELECT p.id FROM push_subscriptions p JOIN sessions s ON s.token_hash=p.session_hash WHERE p.endpoint=? AND p.user_id=? AND s.expires_at>?',
    )
      .bind(parsed.data.endpoint, c.get('principal').user.id, new Date().toISOString())
      .first();
    return c.json({ subscribed: Boolean(row) });
  });
  app.put('/subscription', async (c) => {
    if (!pushConfigured(c.env))
      throw new HTTPException(503, { message: 'Push notifications are not configured.' });
    const parsed = subscriptionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HTTPException(400);
    const { endpoint, keys } = parsed.data;
    try {
      await crypto.subtle.importKey(
        'raw',
        Uint8Array.from(atob(keys.p256dh.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
          c.charCodeAt(0),
        ),
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        [],
      );
    } catch {
      throw new HTTPException(400);
    }
    const principal = c.get('principal');
    if (!principal.sessionHash) throw new HTTPException(403);
    // Expired sessions cannot retain a device, and another account cannot take over its endpoint.
    await c.env.DB.prepare(
      'DELETE FROM push_subscriptions WHERE session_hash IN (SELECT token_hash FROM sessions WHERE expires_at<=?)',
    )
      .bind(new Date().toISOString())
      .run();
    const saved = await c.env.DB.prepare(
      `
      INSERT INTO push_subscriptions(id,user_id,session_hash,endpoint,p256dh,auth)
      SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM push_subscriptions WHERE user_id=?)<20
        OR EXISTS(SELECT 1 FROM push_subscriptions WHERE endpoint=? AND user_id=?)
      ON CONFLICT(endpoint) DO UPDATE SET session_hash=excluded.session_hash,p256dh=excluded.p256dh,auth=excluded.auth
      WHERE push_subscriptions.user_id=excluded.user_id RETURNING id
    `,
    )
      .bind(
        crypto.randomUUID(),
        principal.user.id,
        principal.sessionHash,
        endpoint,
        keys.p256dh,
        keys.auth,
        principal.user.id,
        endpoint,
        principal.user.id,
      )
      .first();
    if (!saved)
      throw new HTTPException(409, {
        message: 'This device is already registered or the device limit has been reached.',
      });
    return c.json({ ok: true });
  });
  app.delete('/subscription', async (c) => {
    const parsed = z
      .object({ endpoint: endpointSchema })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HTTPException(400);
    await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?')
      .bind(parsed.data.endpoint, c.get('principal').user.id)
      .run();
    return c.json({ ok: true });
  });
  return app;
}
